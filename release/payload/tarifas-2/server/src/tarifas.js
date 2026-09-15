import crypto from 'node:crypto';
import { withTx } from './db.js';

export const TARIFF_VERSION = '2026.09.15-tarifas.2';
const STANDARD = 'estandar';
const sameName = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { status }); };
// jsonb reorders object keys: hash explicit ordered tuples, not object serialization.
export const tariffRevision = zones => crypto.createHash('sha256').update(JSON.stringify(zones.map(z => [z.id,z.nombre,z.tarifa,z.activa,!!z.predeterminada,z.orden]))).digest('hex');
export function validateZone(body, zones, existing = null) {
  const nombre = typeof body?.nombre === 'string' ? body.nombre.trim().replace(/\s+/g, ' ') : '';
  const tarifa = body?.tarifa;
  if (nombre.length < 2 || nombre.length > 80 || /[\u0000-\u001f\u007f]/.test(nombre)) fail('TARIFF_INVALID_NAME');
  if (typeof tarifa !== 'number' || !Number.isSafeInteger(tarifa) || tarifa < 1 || tarifa > 10000000) fail('TARIFF_INVALID_AMOUNT');
  if (typeof body.activa !== 'boolean') fail('TARIFF_INVALID_STATUS');
  if (existing?.id === STANDARD && (nombre !== 'Servicio estándar' || body.activa !== true)) fail('TARIFF_STANDARD_PROTECTED');
  if (zones.some(z => z.id !== existing?.id && sameName(String(z.nombre)) === sameName(nombre))) fail('TARIFF_DUPLICATE_NAME', 409);
  if (!existing && zones.length >= 250) fail('TARIFF_LIMIT');
  return { id: existing?.id || `zona-${crypto.randomUUID()}`, nombre, tarifa, activa: body.activa,
    predeterminada: existing?.id === STANDARD, orden: existing?.orden ?? Math.max(0, ...zones.map(z => Number(z.orden) || 0)) + 1 };
}
function readZones(data) {
  const zones = data?.['gohouse-data']?.config?.tarifasZonas;
  if (!Array.isArray(zones) || !zones.some(z => z.id === STANDARD && z.activa === true && z.tarifa > 0)) fail('TARIFF_NOT_CONFIGURED', 503);
  return zones;
}
export function registerTariffRoutes(app, { pool, authMiddleware, broadcast }) {
  const route = fn => async (req, res, next) => {
    try { await fn(req, res); } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  };
  const admin = (principal, data) => {
    if (principal?.type !== 'panel' || !principal.email) fail('ADMIN_REQUIRED', 403);
    const email = String(principal.email).trim().toLowerCase();
    const users = Object.values(data?.['gohouse-data']?.usuariosPanel || {});
    if (!users.some(u => u?.activo !== false && u?.rol === 'administrador' && String(u.email || '').toLowerCase() === email)) fail('ADMIN_REQUIRED', 403);
  };
  app.get('/api/public/tarifas', route(async (_req, res) => {
    const { rows } = await pool.query('SELECT data FROM app_state WHERE id=1');
    const zones = readZones(rows[0]?.data);
    res.set('Cache-Control', 'no-store').json({ version: TARIFF_VERSION,
      zones: zones.filter(z => z.activa === true).map(({id,nombre,tarifa,predeterminada,orden}) => ({id,nombre,tarifa,predeterminada:!!predeterminada,orden})),
      revision: tariffRevision(zones) });
  }));
  app.get('/api/tarifas', authMiddleware(), route(async (req, res) => {
    const { rows } = await pool.query('SELECT data FROM app_state WHERE id=1');
    admin(req.principal, rows[0]?.data);
    const zones = readZones(rows[0]?.data);
    res.set('Cache-Control', 'no-store').json({ zones, revision: tariffRevision(zones), version: TARIFF_VERSION });
  }));
  const mutate = operation => route(async (req, res) => {
    const response = await withTx(async connection => {
      const { rows } = await connection.query('SELECT data FROM app_state WHERE id=1 FOR UPDATE');
      const data = rows[0]?.data;
      admin(req.principal, data);
      const zones = readZones(data);
      if (typeof req.body?.revision !== 'string' || req.body.revision !== tariffRevision(zones)) fail('TARIFF_REVISION_CONFLICT', 409);
      let updated, zone, previous = null;
      if (operation === 'create') {
        zone = validateZone(req.body, zones);
        updated = [...zones, zone];
      } else {
        zone = zones.find(z => z.id === req.params.id);
        if (!zone) fail('TARIFF_NOT_FOUND', 404);
        previous = zone;
        if (operation === 'delete') {
          if (zone.id === STANDARD) fail('TARIFF_STANDARD_PROTECTED');
          updated = zones.filter(z => z.id !== zone.id);
        } else {
          zone = validateZone(req.body, zones, zone);
          updated = zones.map(z => z.id === zone.id ? zone : z);
        }
      }
      await connection.query("SELECT set_config('gohouse.tariff_edit','allowed',true)");
      await connection.query("UPDATE app_state SET data=jsonb_set(data::jsonb,'{gohouse-data,config,tarifasZonas}',$1::jsonb,true),version=version+1,updated_at=now() WHERE id=1", [JSON.stringify(updated)]);
      await connection.query('INSERT INTO audit_log(actor_type,actor_id,action,path,metadata) VALUES($1,$2,$3,$4,$5)', ['panel',req.principal.uid || req.principal.email,'tarifa_'+operation,'gohouse-data/config/tarifasZonas/'+zone.id,JSON.stringify({before:previous,after:operation==='delete'?null:zone})]);
      return { ok: true, zones: updated, revision: tariffRevision(updated), zoneId: zone.id };
    });
    broadcast('gohouse-data/config');
    res.status(operation === 'create' ? 201 : 200).json(response);
  });
  app.post('/api/tarifas', authMiddleware(), mutate('create'));
  app.patch('/api/tarifas/:id', authMiddleware(), mutate('update'));
  app.delete('/api/tarifas/:id', authMiddleware(), mutate('delete'));
}
