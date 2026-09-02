import { withTx, pool } from './db.js';
import { getAtPath, setAtPath, removeAtPath, pushKey, splitPath, stripPins, mergeObject, safeEmailKey } from './util.js';

export async function getRoot(client = pool) {
  const { rows } = await client.query('SELECT data,version FROM app_state WHERE id=1');
  return { data: rows[0]?.data || {}, version: Number(rows[0]?.version || 0) };
}

export function clientUid(principal) { return principal?.type === 'client' ? principal.uid : null; }

function panelRole(root, principal) {
  if (principal?.type !== 'panel') return null;
  const users = root?.['gohouse-data']?.usuariosPanel || {};
  return users[safeEmailKey(principal.email)]?.rol || (Object.keys(users).length === 0 ? 'bootstrap' : null);
}

function sanitizeOperatorWholeWrite(currentRoot, incomingG) {
  const currentG = currentRoot['gohouse-data'] || {};
  const inc = incomingG || {};
  const out = structuredClone(currentG);
  // Operación diaria: pedidos, domiciliarios y clientes. Ajustes y seguridad quedan fuera.
  if (Array.isArray(inc.orders)) out.orders = mergeObject(currentG.orders || [], inc.orders, currentG.orders || []);
  if (Array.isArray(inc.repartidores)) out.repartidores = mergeObject(currentG.repartidores || [], inc.repartidores, currentG.repartidores || []);
  if (inc.clientes && typeof inc.clientes === 'object') out.clientes = mergeObject(currentG.clientes || {}, inc.clientes, currentG.clientes || {});
  return out;
}

function clientOwnPhone(root, principal) {
  return root?.['gohouse-data']?.clientes?.[principal.uid]?.celular || null;
}

function orderOwnedByClient(order, principal) {
  return !!order && (order.clienteUid === principal.uid);
}

function orderAvailableToDriver(order, principal) {
  if (!order) return false;
  if (order.repartidorId === principal.driverId) return true;
  return order.estado === 'nuevo' && !order.repartidorId;
}

function publicAdvertising(g) {
  const list = Array.isArray(g?.publicidad) ? g.publicidad : [];
  return list
    .filter(a => a && typeof a === 'object' && a.active !== false && a.activa !== false)
    .map((a,index) => ({
      id: String(a.id || `ad-${index}`),
      title: String(a.title || '').trim().slice(0,160),
      image: String(a.image || a.imagen || '').trim(),
      link: String(a.link || a.enlace || '').trim().slice(0,2048),
      order: Number.isFinite(Number(a.order ?? a.orden)) ? Number(a.order ?? a.orden) : index + 1,
      active: true
    }))
    .filter(a => a.image)
    .sort((a,b) => a.order - b.order);
}

export function viewRootForPrincipal(root, principal) {
  const clean = stripPins(root);
  if (!principal) return {};
  if (principal.type === 'panel') {
    const role = panelRole(root, principal);
    if (['administrador','operador','lectura'].includes(role)) return clean;
    return { 'gohouse-data': { usuariosPanel: clean?.['gohouse-data']?.usuariosPanel || {} } };
  }
  if (principal.type === 'driver_guest') {
    const g = clean['gohouse-data'] || {};
    return { 'gohouse-data': { repartidores: g.repartidores || [], orders: [], config: g.config || {} } };
  }
  if (principal.type === 'driver') {
    const g = clean['gohouse-data'] || {};
    const orders = (g.orders || []).filter(o => orderAvailableToDriver(o, principal));
    return { 'gohouse-data': { orders, repartidores: g.repartidores || [], config: g.config || {} } };
  }
  if (principal.type === 'client') {
    const g = clean['gohouse-data'] || {};
    const me = g.clientes?.[principal.uid] || null;
    const orders = (g.orders || []).filter(o => orderOwnedByClient(o, principal));
    const clientes = me ? { [principal.uid]: me } : {};
    return { 'gohouse-data': { orders, clientes, repartidores: g.repartidores || [], config: g.config || {}, publicidad: publicAdvertising(g) } };
  }
  return {};
}

export function canReadPath(root, principal, path) {
  const p = splitPath(path);
  if (principal?.type === 'panel') {
    const role = panelRole(root, principal);
    if (['administrador','operador','lectura'].includes(role)) return true;
    const p0 = splitPath(path);
    return p0[0] === 'gohouse-data' && p0[1] === 'usuariosPanel';
  }
  if (p[0] === 'gohouse-data') return true; // filtered later
  if (principal?.type === 'client') {
    if (p[0] === 'chats' && p[1]) {
      const o = (root?.['gohouse-data']?.orders || []).find(x => x.id === p[1]);
      return orderOwnedByClient(o, principal);
    }
    if (p[0] === 'chatsClientes' && p[1]) {
      const phone = clientOwnPhone(root, principal);
      return phone && safePhoneKey(phone) === p[1];
    }
  }
  if (principal?.type === 'driver') {
    if (p[0] === 'chatsPanel' && p[1] === principal.driverId) return true;
    if (p[0] === 'chats' && p[1]) {
      const o = (root?.['gohouse-data']?.orders || []).find(x => x.id === p[1]);
      return !!o && o.repartidorId === principal.driverId;
    }
  }
  return false;
}

function safePhoneKey(phone) { return String(phone || '').replace(/[.#$/\[\]\s]/g, ''); }

export function readPathForPrincipal(root, principal, path) {
  if (!canReadPath(root, principal, path)) return null;
  if (splitPath(path)[0] !== 'gohouse-data') return getAtPath(root, path);
  return getAtPath(viewRootForPrincipal(root, principal), path);
}

function assignNewOrderNumbers(currentG, nextG) {
  const currentOrders = Array.isArray(currentG?.orders) ? currentG.orders : [];
  const nextOrders = Array.isArray(nextG?.orders) ? nextG.orders : [];
  const known = new Set(currentOrders.map(o => String(o.id)));
  let maxNumber = currentOrders.reduce((m,o) => Math.max(m, Number(o.numero) || 0), 0);
  // orders suele estar newest-first; numeramos nuevos en orden cronológico para mantener secuencia.
  const newOrders = nextOrders.filter(o => o?.id && !known.has(String(o.id))).sort((a,b)=>(Number(a.createdAt)||0)-(Number(b.createdAt)||0));
  for (const o of newOrders) o.numero = ++maxNumber;
  return nextG;
}

function sanitizeClientWholeWrite(currentRoot, principal, incomingG) {
  const currentG = currentRoot['gohouse-data'] || {};
  const out = structuredClone(currentG);
  const inc = incomingG || {};
  out.clientes = { ...(currentG.clientes || {}) };
  if (inc.clientes?.[principal.uid]) out.clientes[principal.uid] = structuredClone(inc.clientes[principal.uid]);

  const existing = new Map((currentG.orders || []).map(o => [String(o.id), o]));
  const incomingOwn = (inc.orders || []).filter(o => o && o.clienteUid === principal.uid);
  for (const order of incomingOwn) {
    const old = existing.get(String(order.id));
    if (!old) existing.set(String(order.id), structuredClone(order));
    else if (old.clienteUid === principal.uid) {
      const allowed = structuredClone(old);
      // Cliente puede actualizar pago/calificación y cancelar un pedido propio antes de la entrega.
      for (const k of ['pago','pagoEntrega','comprobante','calificacion','comentarioCalificacion']) if (k in order) allowed[k] = structuredClone(order[k]);
      if (old.estado !== 'entregado' && order.estado === 'cancelado') {
        allowed.estado = 'cancelado';
        allowed.canceladoAt = order.canceladoAt || Date.now();
        allowed.canceladoEnEstado = order.canceladoEnEstado || old.estado;
        if (old.repartidorId) {
          out.repartidores = (out.repartidores || []).map(r => r.id === old.repartidorId ? { ...r, estado:'disponible' } : r);
        }
      }
      existing.set(String(order.id), allowed);
    }
  }
  out.orders = [...existing.values()];
  return assignNewOrderNumbers(currentG, out);
}

function sanitizeDriverWholeWrite(currentRoot, principal, incomingG) {
  const currentG = currentRoot['gohouse-data'] || {};
  const inc = incomingG || {};
  const out = structuredClone(currentG);
  out.repartidores = (currentG.repartidores || []).map(r => {
    if (r.id !== principal.driverId) return r;
    const nr = (inc.repartidores || []).find(x => x.id === r.id);
    if (!nr) return r;
    return { ...r, estado: nr.estado ?? r.estado };
  });

  const currentOrders = new Map((currentG.orders || []).map(o => [String(o.id), o]));
  for (const next of (inc.orders || [])) {
    if (!next?.id) continue;
    const old = currentOrders.get(String(next.id));
    if (!old) continue;
    // aceptación atómica: sólo puede reclamar uno nuevo no asignado
    if (old.estado === 'nuevo' && !old.repartidorId && next.repartidorId === principal.driverId && next.estado === 'aceptado') {
      currentOrders.set(String(next.id), { ...old, ...next, repartidorId: principal.driverId, estado: 'aceptado' });
      continue;
    }
    if (next.repartidorId === principal.driverId && next.estado === 'aceptado' && old.repartidorId && old.repartidorId !== principal.driverId) throw conflict('ORDER_ALREADY_TAKEN');
    if (old.repartidorId !== principal.driverId) continue;
    const allowedFields = ['estado','valorCompra','valorServicio','tarifa','comisionCasa','gananciaDomiciliario','entregadoAt','deliveredAt','aceptadoAt','enDestinoAt','caminoAt','pago','pagoEntrega'];
    const merged = structuredClone(old);
    for (const k of allowedFields) if (k in next) merged[k] = structuredClone(next[k]);
    currentOrders.set(String(next.id), merged);
  }
  out.orders = [...currentOrders.values()];
  return out;
}

export async function writeValue(principal, path, value, baseValue = undefined) {
  return withTx(async client => {
    const { data: root, version } = await getRoot(client);
    let next = root;
    const p = splitPath(path);

    if (principal.type === 'panel') {
      const role = panelRole(root, principal);
      const isUsersPath = p[0] === 'gohouse-data' && p[1] === 'usuariosPanel';
      const bootstrapOwnUser = role === 'bootstrap' && isUsersPath && p[2] === safeEmailKey(principal.email);
      if (path === 'gohouse-data') {
        if (role === 'administrador') {
          const current = getAtPath(root, path) || {};
          const merged = baseValue !== undefined ? mergeObject(baseValue || {}, value || {}, current) : value;
          next = setAtPath(root, path, assignNewOrderNumbers(current, merged));
        } else if (role === 'operador') {
          next = setAtPath(root, path, assignNewOrderNumbers(root['gohouse-data'] || {}, sanitizeOperatorWholeWrite(root, value)));
        } else throw forbidden();
      } else if (isUsersPath) {
        if (role !== 'administrador' && !bootstrapOwnUser) throw forbidden();
        next = setAtPath(root, path, value);
      } else {
        if (!['administrador','operador'].includes(role)) throw forbidden();
        next = setAtPath(root, path, value);
      }
    } else if (principal.type === 'client') {
      if (path === 'gohouse-data') next = setAtPath(root, path, sanitizeClientWholeWrite(root, principal, value));
      else if (p[0] === 'gohouse-data' && p[1] === 'clientes' && p[2] === principal.uid) next = setAtPath(root, path, value);
      else throw forbidden();
    } else if (principal.type === 'driver') {
      if (path === 'gohouse-data') next = setAtPath(root, path, sanitizeDriverWholeWrite(root, principal, value));
      else throw forbidden();
    } else throw forbidden();

    const newVersion = version + 1;
    await client.query('UPDATE app_state SET data=$1,version=$2,updated_at=now() WHERE id=1', [JSON.stringify(next), newVersion]);
    await audit(client, principal, 'set', path, null);
    return { root: next, version: newVersion };
  });
}

export async function removeValue(principal, path) {
  return withTx(async client => {
    const { data: root, version } = await getRoot(client);
    if (principal.type !== 'panel' || panelRole(root, principal) !== 'administrador') throw forbidden();
    const next = removeAtPath(root, path);
    const newVersion = version + 1;
    await client.query('UPDATE app_state SET data=$1,version=$2,updated_at=now() WHERE id=1', [JSON.stringify(next), newVersion]);
    await audit(client, principal, 'remove', path, null);
    return { root: next, version: newVersion };
  });
}

export async function pushValue(principal, path, value) {
  return withTx(async client => {
    const { data: root, version } = await getRoot(client);
    if (!canReadPath(root, principal, path)) throw forbidden();
    if (principal.type === 'panel' && !['administrador','operador'].includes(panelRole(root, principal))) throw forbidden();
    const p = splitPath(path);
    if (!['chats','chatsClientes','chatsPanel'].includes(p[0])) throw forbidden();
    const key = pushKey();
    const next = setAtPath(root, [...p, key], value);
    const newVersion = version + 1;
    await client.query('UPDATE app_state SET data=$1,version=$2,updated_at=now() WHERE id=1', [JSON.stringify(next), newVersion]);
    await audit(client, principal, 'push', `${path}/${key}`, null);
    return { root: next, version: newVersion, key };
  });
}

async function audit(client, principal, action, path, metadata) {
  await client.query('INSERT INTO audit_log(actor_type,actor_id,action,path,metadata) VALUES($1,$2,$3,$4,$5)', [principal.type, principal.uid || principal.email || null, action, path, metadata ? JSON.stringify(metadata) : null]);
}

function forbidden() { const e = new Error('FORBIDDEN'); e.status = 403; return e; }
function conflict(message='CONFLICT') { const e = new Error(message); e.status = 409; return e; }
