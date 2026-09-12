import { pool } from './db.js';
import { getRoot } from './store.js';

const EVENTS = new Set(['accepted','pickup','delivered','track']);
const GPS_STATUSES = new Set(['ok','unavailable','denied','timeout','error']);

function httpError(message,status=400){ const e=new Error(message); e.status=status; return e; }
function asText(v){ return String(v ?? '').trim(); }
function asOptionalNumber(v){
  if(v === null || v === undefined || v === '') return null;
  const n=Number(v); return Number.isFinite(n) ? n : null;
}
function validCoord(lat,lng){ return Number.isFinite(lat) && Number.isFinite(lng) && lat>=-90 && lat<=90 && lng>=-180 && lng<=180; }
function gh(root){ return root?.['gohouse-data'] || {}; }
function orders(root){ return Array.isArray(gh(root).orders) ? gh(root).orders : []; }
function drivers(root){ return Array.isArray(gh(root).repartidores) ? gh(root).repartidores : []; }
function activeForDriver(root,driverId){
  return orders(root).find(o=>String(o?.repartidorId||'')===String(driverId) && ['aceptado','camino'].includes(String(o?.estado||''))) || null;
}
function publicOrder(o){
  if(!o) return null;
  return { id:String(o.id||''), numero:o.numero ?? null, estado:String(o.estado||''), cliente:String(o.cliente||''), direccion:String(o.direccion||'') };
}
function publicLocation(r){
  if(!r) return null;
  return {
    driverId:String(r.driver_id||''), orderId:r.order_id ? String(r.order_id) : null,
    orderState:r.order_state || null, gpsStatus:r.gps_status || 'ok',
    latitude:r.latitude===null?null:Number(r.latitude), longitude:r.longitude===null?null:Number(r.longitude),
    accuracy:r.accuracy===null?null:Number(r.accuracy), speed:r.speed===null?null:Number(r.speed),
    heading:r.heading===null?null:Number(r.heading), recordedAt:r.recorded_at ? new Date(r.recorded_at).toISOString() : null
  };
}

export async function saveDriverLocation(principal,body={}){
  if(principal?.type!=='driver' || !principal.driverId) throw httpError('DRIVER_REQUIRED',403);
  const driverId=String(principal.driverId);
  const orderId=asText(body.orderId);
  const eventType=asText(body.eventType || 'track');
  const gpsStatus=GPS_STATUSES.has(asText(body.gpsStatus)) ? asText(body.gpsStatus) : 'ok';
  if(!EVENTS.has(eventType)) throw httpError('INVALID_FLEET_EVENT');
  if(!orderId) throw httpError('ORDER_REQUIRED');

  const { data:root }=await getRoot();
  const order=orders(root).find(o=>String(o?.id||'')===orderId);
  if(!order) throw httpError('ORDER_NOT_FOUND',404);
  if(String(order.repartidorId||'')!==driverId) throw httpError('ORDER_NOT_ASSIGNED_TO_DRIVER',403);
  const state=String(order.estado||'');
  if(eventType==='track' && !['aceptado','camino'].includes(state)) throw httpError('ORDER_NOT_ACTIVE',409);

  const lat=asOptionalNumber(body.latitude), lng=asOptionalNumber(body.longitude);
  const accuracy=asOptionalNumber(body.accuracy), speed=asOptionalNumber(body.speed), heading=asOptionalNumber(body.heading);
  const hasCoords=validCoord(lat,lng);
  if(gpsStatus==='ok' && !hasCoords) throw httpError('INVALID_COORDINATES');

  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const inserted=await client.query(`INSERT INTO driver_location_events
      (driver_id,order_id,event_type,order_state,gps_status,latitude,longitude,accuracy,speed,heading)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id,driver_id,order_id,event_type,order_state,gps_status,latitude,longitude,accuracy,speed,heading,recorded_at`,
      [driverId,orderId,eventType,state,gpsStatus,hasCoords?lat:null,hasCoords?lng:null,accuracy,speed,heading]);
    if(hasCoords){
      await client.query(`INSERT INTO driver_last_location
        (driver_id,order_id,order_state,gps_status,latitude,longitude,accuracy,speed,heading,recorded_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
        ON CONFLICT(driver_id) DO UPDATE SET
          order_id=excluded.order_id,order_state=excluded.order_state,gps_status=excluded.gps_status,
          latitude=excluded.latitude,longitude=excluded.longitude,accuracy=excluded.accuracy,
          speed=excluded.speed,heading=excluded.heading,recorded_at=excluded.recorded_at`,
        [driverId,orderId,state,gpsStatus,lat,lng,accuracy,speed,heading]);
    }
    await client.query('COMMIT');
    return {ok:true,eventId:inserted.rows[0].id,location:publicLocation(inserted.rows[0]),eventType,state};
  }catch(e){ await client.query('ROLLBACK').catch(()=>{}); throw e; }
  finally{ client.release(); }
}

export async function getDriverFleetContext(principal){
  if(principal?.type!=='driver' || !principal.driverId) throw httpError('DRIVER_REQUIRED',403);
  const driverId=String(principal.driverId);
  const { data:root }=await getRoot();
  const active=activeForDriver(root,driverId);
  const {rows}=await pool.query('SELECT * FROM driver_last_location WHERE driver_id=$1',[driverId]);
  return {driverId,activeOrder:publicOrder(active),lastLocation:publicLocation(rows[0]||null)};
}

export async function getFleetLive(principal){
  if(principal?.type!=='panel') throw httpError('PANEL_REQUIRED',403);
  const { data:root }=await getRoot();
  const reps=drivers(root), allOrders=orders(root);
  const {rows}=await pool.query('SELECT * FROM driver_last_location');
  const byDriver=new Map(rows.map(r=>[String(r.driver_id),r]));
  return {
    serverTime:new Date().toISOString(),
    drivers:reps.map(rep=>{
      const id=String(rep?.id||'');
      const active=allOrders.find(o=>String(o?.repartidorId||'')===id && ['aceptado','camino'].includes(String(o?.estado||''))) || null;
      return {id,nombre:String(rep?.nombre||'Domiciliario'),estado:String(rep?.estado||'fuera'),activeOrder:publicOrder(active),lastLocation:publicLocation(byDriver.get(id)||null)};
    })
  };
}

export async function getFleetHistory(principal,driverId,orderId,limit=500){
  if(principal?.type!=='panel') throw httpError('PANEL_REQUIRED',403);
  driverId=asText(driverId); orderId=asText(orderId);
  if(!driverId) throw httpError('DRIVER_REQUIRED');
  limit=Math.max(20,Math.min(800,Number(limit)||500));
  const params=[driverId];
  let where='driver_id=$1 AND latitude IS NOT NULL AND longitude IS NOT NULL';
  if(orderId){ params.push(orderId); where+=' AND order_id=$2'; }
  params.push(limit);
  const li=params.length;
  const {rows}=await pool.query(`SELECT id,driver_id,order_id,event_type,order_state,gps_status,latitude,longitude,accuracy,speed,heading,recorded_at
    FROM driver_location_events WHERE ${where} ORDER BY recorded_at DESC LIMIT $${li}`,params);
  return {driverId,orderId:orderId||null,points:rows.reverse().map(r=>({...publicLocation(r),id:r.id,eventType:r.event_type}))};
}
