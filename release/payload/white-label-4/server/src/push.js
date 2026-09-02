import webpush from 'web-push';
import { pool } from './db.js';
import { config } from './config.js';

let configured = false;
if (config.vapidPublicKey && config.vapidPrivateKey) {
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
  configured = true;
}

export function pushReady() { return configured; }
export function publicKey() { return config.vapidPublicKey; }

export async function saveSubscription(principal, subscription) {
  const type = principal.type === 'client' ? 'client' : principal.type === 'driver' ? 'driver' : principal.type === 'panel' ? 'panel' : null;
  if (!type) throw new Error('ROLE_NO_PUSH');
  const id = principal.type === 'driver' ? principal.driverId : principal.uid;
  await pool.query(`INSERT INTO push_subscriptions(principal_type,principal_id,endpoint,subscription)
    VALUES($1,$2,$3,$4)
    ON CONFLICT(endpoint) DO UPDATE SET principal_type=excluded.principal_type,principal_id=excluded.principal_id,subscription=excluded.subscription,updated_at=now()`,
    [type, id, subscription.endpoint, JSON.stringify(subscription)]);
}

async function sendRows(rows, payload) {
  if (!configured) return;
  await Promise.all(rows.map(async row => {
    try { await webpush.sendNotification(row.subscription, JSON.stringify(payload)); }
    catch (e) {
      if ([404,410].includes(e.statusCode)) await pool.query('DELETE FROM push_subscriptions WHERE id=$1', [row.id]);
      else console.error('[push]', e.statusCode, e.message);
    }
  }));
}

export async function sendToType(type, payload) {
  if (!configured) return;
  const { rows } = await pool.query('SELECT id,subscription FROM push_subscriptions WHERE principal_type=$1', [type]);
  await sendRows(rows, payload);
}

export async function sendToPrincipal(type, id, payload) {
  if (!configured || !id) return;
  const { rows } = await pool.query('SELECT id,subscription FROM push_subscriptions WHERE principal_type=$1 AND principal_id=$2', [type, id]);
  await sendRows(rows, payload);
}

export async function notifyStateDiff(before, after) {
  const brandName = String(after?.['gohouse-data']?.config?.brandName || 'Domicilios').trim() || 'Domicilios';
  const a = before?.['gohouse-data']?.orders || [];
  const b = after?.['gohouse-data']?.orders || [];
  const byA = new Map(a.map(o => [String(o.id), o]));
  for (const order of b) {
    const prev = byA.get(String(order.id));
    if (!prev) {
      if (order.estado === 'nuevo') {
        const payload = { title:brandName, body:`Nuevo domicilio #${order.numero || order.id}`, url:'/domiciliario', tag:`order-${order.id}` };
        await Promise.all([sendToType('driver', payload), sendToType('panel', { ...payload, url:'/panel' })]);
      }
      continue;
    }
    if (prev.estado !== order.estado && order.clienteUid) {
      await sendToPrincipal('client', order.clienteUid, {
        title:`${brandName} · Actualización`, body:`Tu pedido #${order.numero || order.id}: ${label(order.estado)}`, url:'/', tag:`order-${order.id}`
      });
    }
  }
}

function label(s){ return ({nuevo:'Buscando domiciliario',aceptado:'Domiciliario asignado',en_destino:'En el punto de recogida',camino:'En camino',entregado:'Entregado',cancelado:'Cancelado'})[s] || s; }
