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
  if (!subscription?.endpoint) throw new Error('INVALID_SUBSCRIPTION');
  const id = principal.type === 'driver' ? principal.driverId : principal.uid;
  await pool.query(`INSERT INTO push_subscriptions(principal_type,principal_id,endpoint,subscription)
    VALUES($1,$2,$3,$4)
    ON CONFLICT(endpoint) DO UPDATE SET principal_type=excluded.principal_type,principal_id=excluded.principal_id,subscription=excluded.subscription,updated_at=now()`,
    [type, id, subscription.endpoint, JSON.stringify(subscription)]);
}

async function sendRows(rows, payload) {
  if (!configured || !rows.length) return;
  await Promise.all(rows.map(async row => {
    try {
      const sub = typeof row.subscription === 'string' ? JSON.parse(row.subscription) : row.subscription;
      await webpush.sendNotification(sub, JSON.stringify(payload));
    } catch (e) {
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
  const { rows } = await pool.query('SELECT id,subscription FROM push_subscriptions WHERE principal_type=$1 AND principal_id=$2', [type, String(id)]);
  await sendRows(rows, payload);
}

function brandInfo(root) {
  const cfg = root?.['gohouse-data']?.config || {};
  return {
    name: String(cfg.brandName || 'Domicilios').trim() || 'Domicilios',
    icon: String(cfg.appIconUrl || '/icon-192.png').trim() || '/icon-192.png'
  };
}

function basePayload(root, extra={}) {
  const b = brandInfo(root);
  return { title:b.name, icon:b.icon, badge:b.icon, timestamp:Date.now(), renotify:true, ...extra };
}

function orderId(order) { return order?.numero || order?.id || ''; }
function stateLabel(s){
  return ({nuevo:'Buscando domiciliario',aceptado:'Domiciliario asignado',en_destino:'En el punto de recogida',camino:'En camino',entregado:'Entregado',cancelado:'Cancelado'})[s] || s;
}

function proofValue(order){
  if (!order || typeof order !== 'object') return '';
  const keys=['comprobante','comprobanteUrl','comprobantePago','paymentProof','receipt','receiptUrl'];
  for (const k of keys) if (order[k]) return String(order[k]);
  const pago=String(order.pago || '').toLowerCase();
  return pago.includes('comprobante') ? pago : '';
}

function messageEntries(node){
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node).filter(([,v])=>v && typeof v === 'object');
}

function newMessages(beforeNode, afterNode){
  const out=[];
  const before=beforeNode && typeof beforeNode==='object' ? beforeNode : {};
  const after=afterNode && typeof afterNode==='object' ? afterNode : {};
  for (const [conversationKey, messages] of Object.entries(after)) {
    if (!messages || typeof messages !== 'object') continue;
    const old = before[conversationKey] && typeof before[conversationKey] === 'object' ? before[conversationKey] : {};
    for (const [messageKey, message] of Object.entries(messages)) {
      if (!Object.prototype.hasOwnProperty.call(old,messageKey) && message && typeof message === 'object') {
        out.push({conversationKey,messageKey,message,messages});
      }
    }
  }
  return out;
}

function preview(message){
  if (message?.tipo === 'imagen') return '📷 Imagen';
  const text=String(message?.texto || message?.text || 'Nuevo mensaje').replace(/\s+/g,' ').trim();
  return text.length>110 ? text.slice(0,107)+'…' : text;
}

function latestClientUid(messages){
  return messageEntries(messages)
    .map(([,m])=>m)
    .sort((a,b)=>(Number(b?.hora)||0)-(Number(a?.hora)||0))
    .map(m=>String(m?.clienteUid || '').trim())
    .find(Boolean) || '';
}

async function notifyClientChats(before, after){
  const created=newMessages(before?.chatsClientes, after?.chatsClientes);
  for (const item of created) {
    const m=item.message, de=String(m.de || '').toLowerCase();
    if (de === 'cliente') {
      const name=String(m.clienteNombre || 'Cliente').trim() || 'Cliente';
      const phone=String(m.clienteCelular || item.conversationKey).trim();
      await sendToType('panel', basePayload(after, {
        title:`${brandInfo(after).name} · Mensaje de ${name}`,
        body:`${phone ? phone+' · ' : ''}${preview(m)}`,
        url:`/panel/?open=mensajes&chat=${encodeURIComponent(item.conversationKey)}`,
        tag:`client-chat-${item.conversationKey}`,
        kind:'client-chat'
      }));
    } else {
      const uid=String(m.clienteUid || latestClientUid(item.messages)).trim();
      if (!uid) continue;
      await sendToPrincipal('client', uid, basePayload(after, {
        title:`${brandInfo(after).name} · Nuevo mensaje`,
        body:preview(m),
        url:'/?open=chat',
        tag:`client-chat-${item.conversationKey}`,
        kind:'client-chat'
      }));
    }
  }
}

async function notifyDriverChats(before, after){
  const created=newMessages(before?.chatsPanel, after?.chatsPanel);
  for (const item of created) {
    const m=item.message, de=String(m.de || '').toLowerCase();
    if (de === 'domiciliario' || de === 'driver') {
      const name=String(m.domiciliarioNombre || m.nombre || 'Domiciliario').trim();
      await sendToType('panel', basePayload(after, {
        title:`${brandInfo(after).name} · Mensaje de ${name}`,
        body:preview(m),
        url:'/panel/?open=mensajes',
        tag:`driver-chat-${item.conversationKey}`,
        kind:'driver-chat'
      }));
    } else {
      await sendToPrincipal('driver', item.conversationKey, basePayload(after, {
        title:`${brandInfo(after).name} · Nuevo mensaje`,
        body:preview(m),
        url:'/domiciliario/',
        tag:`driver-chat-${item.conversationKey}`,
        kind:'driver-chat'
      }));
    }
  }
}

export async function notifyStateDiff(before, after) {
  if (!configured) return;
  const beforeOrders = Array.isArray(before?.['gohouse-data']?.orders) ? before['gohouse-data'].orders : [];
  const afterOrders = Array.isArray(after?.['gohouse-data']?.orders) ? after['gohouse-data'].orders : [];
  const byBefore = new Map(beforeOrders.map(o => [String(o.id), o]));

  for (const order of afterOrders) {
    const prev = byBefore.get(String(order.id));
    if (!prev) {
      if (order.estado === 'nuevo') {
        const payload = basePayload(after, { body:`Nuevo domicilio #${orderId(order)}`, url:'/domiciliario/', tag:`order-${order.id}`, kind:'new-order', requireInteraction:true });
        await Promise.all([
          sendToType('driver', payload),
          sendToType('panel', { ...payload, url:'/panel/?open=pedidos' })
        ]);
      }
      if (proofValue(order)) {
        await sendToType('panel', basePayload(after, { title:`${brandInfo(after).name} · Comprobante recibido`, body:`${order.cliente || 'Cliente'} envió comprobante del pedido #${orderId(order)}`, url:'/panel/?open=pedidos', tag:`receipt-${order.id}`, kind:'payment-proof' }));
      }
      continue;
    }

    if (prev.estado !== order.estado && order.clienteUid) {
      await sendToPrincipal('client', order.clienteUid, basePayload(after, {
        title:`${brandInfo(after).name} · Actualización`,
        body:`Tu pedido #${orderId(order)}: ${stateLabel(order.estado)}`,
        url:'/', tag:`order-${order.id}`, kind:'order-status'
      }));
    }

    if (!proofValue(prev) && proofValue(order)) {
      await sendToType('panel', basePayload(after, {
        title:`${brandInfo(after).name} · Comprobante recibido`,
        body:`${order.cliente || 'Cliente'} envió comprobante del pedido #${orderId(order)}`,
        url:'/panel/?open=pedidos', tag:`receipt-${order.id}`, kind:'payment-proof'
      }));
    }
  }

  await Promise.all([
    notifyClientChats(before,after),
    notifyDriverChats(before,after)
  ]);
}
