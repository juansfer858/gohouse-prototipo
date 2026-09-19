import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { WebSocketServer } from 'ws';
import { pool } from './db.js';
import { registerTariffRoutes } from './tarifas.js';
import { registerDriverDocumentRoutes } from './driver-documents.js';
import { config } from './config.js';
import { authMiddleware, createAnonymous, loginPanel, loginDriver, verifyToken, setDriverPin, createPanelUser, disablePanelUser, panelBootstrapStatus, bootstrapPanelAdmin } from './auth.js';
import { registerClient, loginClient, getClientProfile, requestClientPasswordReset, resetClientPassword, clientRecoveryMailReady } from './client-auth.js';
import { getRecoveryMailSettingsForAdmin, saveRecoveryMailSettings, sendRecoveryMailTest } from './client-mail.js';
import { getRoot, readPathForPrincipal, writeValue, removeValue, pushValue } from './store.js';
import { splitPath, getAtPath, stripPins, safeEmailKey } from './util.js';
import { pushReady, publicKey, pushTemplateVersion, saveSubscription, notifyStateDiff } from './push.js';
import { getPublicBranding, manifestFor } from './branding.js';
import { saveDriverLocation, getDriverFleetContext, getFleetLive, getFleetHistory } from './fleet.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy:'cross-origin' } }));
app.use(express.json({ limit: `${config.maxJsonMb}mb` }));

registerTariffRoutes(app, { pool, authMiddleware, broadcast });
registerDriverDocumentRoutes(app, { authMiddleware });

function scrubLegacyBrand(value) {
  return String(value ?? '').replace(/¡?GO!?\s*HOUSE|GOHOUSE/gi, 'Domicilios Llanos');
}
function publicBrandingWithoutLegacyName(raw={}) {
  const out={...raw};
  for (const key of ['brandName','shortName','legalName','supportText']) {
    if (key in out) out[key]=scrubLegacyBrand(out[key]);
  }
  if (!String(out.brandName||'').trim()) out.brandName='Domicilios Llanos';
  if (!String(out.shortName||'').trim()) out.shortName='Domicilios';
  return out;
}
async function driverExists(driverId) {
  const { data } = await getRoot();
  return Array.isArray(data?.['gohouse-data']?.repartidores)
    && data['gohouse-data'].repartidores.some(r => String(r?.id||'') === String(driverId||''));
}
async function requirePanelAdmin(principal) {
  if (principal?.type !== 'panel') return false;
  const { data } = await getRoot();
  const me = getAtPath(data, `gohouse-data/usuariosPanel/${safeEmailKey(principal.email)}`);
  return !!(me && me.activo !== false && me.rol === 'administrador');
}
async function saveDriverAdminCode(driverId,pin,principal) {
  await pool.query(
    `INSERT INTO driver_access_codes(driver_id,pin_plain,registered_by,registered_at)
     VALUES($1,$2,$3,now())
     ON CONFLICT(driver_id) DO UPDATE SET pin_plain=EXCLUDED.pin_plain,registered_by=EXCLUDED.registered_by,registered_at=now()`,
    [String(driverId),String(pin),String(principal?.email||'')]
  );
}

const SERVER_UPLOAD_DIR='/opt/gohouse/server/uploads';
function serverUploadStorageReady(){
  try{
    fsSync.accessSync('/opt/gohouse/server', fsSync.constants.W_OK);
    return true;
  }catch{
    return false;
  }
}

app.get('/api/health', async (_req,res) => {
  const { rows } = await pool.query('SELECT version,updated_at FROM app_state WHERE id=1');
  res.json({ ok:true, service:'domicilios-llanos-vps', db:true, push:pushReady(), pushTemplate:pushTemplateVersion(), driverCodeMode:'admin-set-v33', recoveryMailMode:'gmail-app-password-v35', uploadMode:'server-private-media-v41', uploadStorageReady:serverUploadStorageReady(), fleet:true, clientRecoveryMail:clientRecoveryMailReady(), state:rows[0] || null });
});

app.get('/api/public/config', async (_req,res,next) => {
  try {
    res.set('Cache-Control','no-store');
    res.json(publicBrandingWithoutLegacyName(await getPublicBranding()));
  } catch (e) { next(e); }
});

app.get('/api/public/ads', async (_req,res,next) => {
  try {
    const { data } = await getRoot();
    const raw = data?.publicidad;
    const source = Array.isArray(raw)
      ? raw
      : (raw && typeof raw === 'object' ? Object.values(raw) : []);
    const ads = source
      .filter(a => a && typeof a === 'object' && a.active !== false && a.activa !== false)
      .map((a,index) => {
        const image = String(a.image || a.imagen || '').trim();
        const order = Number(a.order ?? a.orden);
        return {
          id: String(a.id || `ad-${index}`),
          title: String(a.title || '').trim().slice(0,160),
          image,
          link: String(a.link || a.enlace || '').trim().slice(0,2048),
          order: Number.isFinite(order) ? order : index + 1
        };
      })
      .filter(a => a.image && (a.image.startsWith('/uploads/') || a.image.startsWith('/api/public/uploads/') || /^https?:\/\//i.test(a.image)))
      .sort((a,b) => a.order - b.order);
    res.set('Cache-Control','no-store');
    res.json({ ads });
  } catch (e) { next(e); }
});

app.get('/api/manifest.webmanifest', async (req,res,next) => {
  try {
    const cfg = publicBrandingWithoutLegacyName(await getPublicBranding());
    res.type('application/manifest+json');
    res.set('Cache-Control','no-cache, no-store, must-revalidate');
    res.json(manifestFor(String(req.query.app || 'client'), cfg));
  } catch (e) { next(e); }
});

app.get('/api/bootstrap/status', async (_req,res,next) => {
  try { res.json({ needsAdmin: await panelBootstrapStatus() }); } catch(e) { next(e); }
});
app.post('/api/bootstrap/admin', async (req,res,next) => {
  try {
    const admin = await bootstrapPanelAdmin(req.body?.email, req.body?.password);
    res.status(201).json({ ok:true, admin });
  } catch(e) { next(e); }
});

app.post('/api/auth/anonymous', (req,res) => res.json(createAnonymous(req.body?.appKind)));
app.post('/api/auth/login', async (req,res) => {
  const result = await loginPanel(String(req.body?.email || ''), String(req.body?.password || ''));
  if (!result) return res.status(401).json({ error:'INVALID_CREDENTIALS' });
  res.json(result);
});
app.post('/api/auth/driver', async (req,res,next) => {
  try {
    const driverId=String(req.body?.driverId || '');
    if (!await driverExists(driverId)) return res.status(401).json({ error:'DRIVER_REMOVED' });
    const result = await loginDriver(driverId, String(req.body?.pin || ''));
    if (!result) return res.status(401).json({ error:'INVALID_PIN' });
    res.json(result);
  } catch(e){ next(e); }
});

app.post('/api/auth/client/register', authMiddleware(true), async (req,res,next) => {
  try {
    const out=await registerClient({email:req.body?.email,password:req.body?.password,profile:req.body?.profile,legacyPrincipal:req.principal});
    res.status(201).json(out);
  } catch(e){ next(e); }
});
app.post('/api/auth/client/login', async (req,res,next) => {
  try {
    const out=await loginClient(req.body?.email,req.body?.password);
    if(!out) return res.status(401).json({error:'INVALID_CREDENTIALS'});
    res.json(out);
  } catch(e){ next(e); }
});
app.get('/api/auth/client/profile', authMiddleware(), async (req,res,next) => {
  try { res.json({profile:await getClientProfile(req.principal)}); }
  catch(e){ next(e); }
});
app.post('/api/auth/client/recover', async (req,res,next) => {
  try { res.json(await requestClientPasswordReset(req.body?.email)); }
  catch(e){ next(e); }
});
app.post('/api/auth/client/reset', async (req,res,next) => {
  try { res.json(await resetClientPassword(req.body?.email,req.body?.code,req.body?.password)); }
  catch(e){ next(e); }
});

app.get('/api/recovery-mail/settings', authMiddleware(), async (req,res,next) => {
  try {
    if (!await requirePanelAdmin(req.principal)) return res.status(403).json({error:'ADMIN_REQUIRED'});
    res.set('Cache-Control','no-store');
    res.json(await getRecoveryMailSettingsForAdmin());
  } catch(e){ next(e); }
});

app.put('/api/recovery-mail/settings', authMiddleware(), async (req,res,next) => {
  try {
    if (!await requirePanelAdmin(req.principal)) return res.status(403).json({error:'ADMIN_REQUIRED'});
    res.json(await saveRecoveryMailSettings(req.body||{}, req.principal.email));
  } catch(e){ next(e); }
});

app.post('/api/recovery-mail/test', authMiddleware(), async (req,res,next) => {
  try {
    if (!await requirePanelAdmin(req.principal)) return res.status(403).json({error:'ADMIN_REQUIRED'});
    res.json(await sendRecoveryMailTest());
  } catch(e){ next(e); }
});

app.get('/api/auth/session', authMiddleware(), async (req,res,next) => {
  try {
    if (req.principal.type === 'driver' && !await driverExists(req.principal.driverId)) {
      return res.status(401).json({ error:'DRIVER_REMOVED' });
    }
    res.json({ user: principalUser(req.principal) });
  } catch(e){ next(e); }
});

// Revoca inmediatamente las sesiones técnicas de un domiciliario eliminado.
// Para los demás tipos de usuario no altera el flujo existente.
app.use('/api', async (req,res,next) => {
  const h=String(req.headers.authorization || '');
  if (!h.startsWith('Bearer ')) return next();
  try {
    const principal=verifyToken(h.slice(7));
    if (principal?.type === 'driver' && !await driverExists(principal.driverId)) {
      return res.status(401).json({ error:'DRIVER_REMOVED' });
    }
  } catch {}
  next();
});

app.post('/api/fleet/location', authMiddleware(), async (req,res,next) => {
  try {
    const out=await saveDriverLocation(req.principal,req.body||{});
    broadcast('fleet');
    res.status(201).json(out);
  } catch(e){ next(e); }
});
app.get('/api/fleet/me', authMiddleware(), async (req,res,next) => {
  try { res.json(await getDriverFleetContext(req.principal)); }
  catch(e){ next(e); }
});
app.get('/api/fleet/live', authMiddleware(), async (req,res,next) => {
  try { res.json(await getFleetLive(req.principal)); }
  catch(e){ next(e); }
});
app.get('/api/fleet/history/:driverId', authMiddleware(), async (req,res,next) => {
  try { res.json(await getFleetHistory(req.principal,req.params.driverId,req.query.orderId,req.query.limit)); }
  catch(e){ next(e); }
});

app.get('/api/data', authMiddleware(), async (req,res) => {
  const pathName = String(req.query.path || '');
  const { data,version } = await getRoot();
  const value = readPathForPrincipal(data, req.principal, pathName);
  if (value === null && pathName && !canReturnNull(req.principal, pathName)) return res.status(403).json({ error:'FORBIDDEN' });
  res.json({ value, version });
});

app.put('/api/data', authMiddleware(), async (req,res,next) => {
  try {
    const { data:before } = await getRoot();
    const out = await writeValue(req.principal, String(req.body?.path || ''), req.body?.value, req.body?.baseValue);
    broadcast(String(req.body?.path || ''));
    notifyStateDiff(before, out.root).catch(console.error);
    res.json({ ok:true, version:out.version });
  } catch(e){ next(e); }
});

app.delete('/api/data', authMiddleware(), async (req,res,next) => {
  try {
    const { data:before } = await getRoot();
    const out = await removeValue(req.principal, String(req.query.path || ''));
    broadcast(String(req.query.path || ''));
    notifyStateDiff(before, out.root).catch(console.error);
    res.json({ ok:true, version:out.version });
  } catch(e){ next(e); }
});

app.post('/api/push-node', authMiddleware(), async (req,res,next) => {
  try {
    const { data:before } = await getRoot();
    const out = await pushValue(req.principal, String(req.body?.path || ''), req.body?.value);
    broadcast(String(req.body?.path || ''));
    notifyStateDiff(before, out.root).catch(console.error);
    res.json({ ok:true, key:out.key, version:out.version });
  } catch(e){ next(e); }
});

app.post('/api/drivers', authMiddleware(), async (req,res,next) => {
  try {
    if (req.principal.type !== 'panel') return res.status(403).json({error:'FORBIDDEN'});
    const nombre = String(req.body?.nombre || '').trim();
    const pin = String(req.body?.pin || '').trim();
    if (!nombre || !/^\d{4}$/.test(pin)) return res.status(400).json({error:'INVALID_DRIVER'});
    const id = cryptoId();
    const { data:before } = await getRoot();
    const g = structuredClone(before['gohouse-data'] || {});
    g.repartidores = Array.isArray(g.repartidores) ? g.repartidores : [];
    g.repartidores.push({ id,nombre,estado:'disponible' });
    await setDriverPin(id,pin);
    await saveDriverAdminCode(id,pin,req.principal);
    const out = await writeValue(req.principal, 'gohouse-data', g, before['gohouse-data'] || {});
    broadcast('gohouse-data');
    res.json({ id,nombre,estado:'disponible' });
  } catch(e){ next(e); }
});

app.put('/api/drivers/:id/pin', authMiddleware(), async (req,res) => {
  if (req.principal.type !== 'panel') return res.status(403).json({error:'FORBIDDEN'});
  res.status(409).json({error:'DRIVER_CODE_IMMUTABLE',message:'El código del domiciliario es permanente y solo se invalida al eliminarlo.'});
});

app.get('/api/driver-codes/:id', authMiddleware(), async (req,res,next) => {
  try {
    if (!await requirePanelAdmin(req.principal)) return res.status(403).json({error:'ADMIN_REQUIRED'});
    if (!await driverExists(req.params.id)) return res.status(404).json({error:'DRIVER_NOT_FOUND'});
    const { rows } = await pool.query(
      'SELECT pin_plain,registered_at FROM driver_access_codes WHERE driver_id=$1',
      [String(req.params.id)]
    );
    if (!rows[0]) return res.json({available:false});
    res.set('Cache-Control','no-store');
    res.json({available:true,code:rows[0].pin_plain,registeredAt:rows[0].registered_at});
  } catch(e){ next(e); }
});

app.post('/api/driver-codes/:id/register', authMiddleware(), async (req,res,next) => {
  try {
    if (!await requirePanelAdmin(req.principal)) return res.status(403).json({error:'ADMIN_REQUIRED'});
    const driverId=String(req.params.id||'');
    const pin=String(req.body?.pin||'').trim();
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({error:'INVALID_PIN'});
    if (!await driverExists(driverId)) return res.status(404).json({error:'DRIVER_NOT_FOUND'});
    await setDriverPin(driverId,pin);
    await saveDriverAdminCode(driverId,pin,req.principal);
    res.status(201).json({ok:true,code:pin});
  } catch(e){ next(e); }
});

app.post('/api/panel-users', authMiddleware(), async (req,res,next) => {
  try {
    if (req.principal.type !== 'panel') return res.status(403).json({error:'FORBIDDEN'});
    const { data } = await getRoot();
    const me = getAtPath(data, `gohouse-data/usuariosPanel/${safeEmailKey(req.principal.email)}`);
    if (!me || me.rol !== 'administrador') return res.status(403).json({error:'ADMIN_REQUIRED'});
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const rol = String(req.body?.rol || 'lectura');
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || !['administrador','operador','lectura'].includes(rol)) return res.status(400).json({error:'INVALID_USER'});
    await createPanelUser(email,password);
    const current = (await getRoot()).data;
    const g = structuredClone(current['gohouse-data'] || {});
    g.usuariosPanel = g.usuariosPanel || {};
    g.usuariosPanel[safeEmailKey(email)] = { email,rol,activo:true,creadoAt:Date.now() };
    await writeValue(req.principal,'gohouse-data',g,current['gohouse-data'] || {});
    broadcast('gohouse-data');
    res.status(201).json({ok:true,email,rol});
  } catch(e){ next(e); }
});

app.delete('/api/panel-users', authMiddleware(), async (req,res,next) => {
  try {
    if (req.principal.type !== 'panel') return res.status(403).json({error:'FORBIDDEN'});
    const { data } = await getRoot();
    const me = getAtPath(data, `gohouse-data/usuariosPanel/${safeEmailKey(req.principal.email)}`);
    if (!me || me.rol !== 'administrador') return res.status(403).json({error:'ADMIN_REQUIRED'});
    const email = String(req.body?.email || '').trim().toLowerCase();
    await disablePanelUser(email);
    const current = (await getRoot()).data;
    const g = structuredClone(current['gohouse-data'] || {});
    if (g.usuariosPanel?.[safeEmailKey(email)]) g.usuariosPanel[safeEmailKey(email)].activo = false;
    await writeValue(req.principal,'gohouse-data',g,current['gohouse-data'] || {});
    broadcast('gohouse-data');
    res.json({ok:true});
  } catch(e){ next(e); }
});

app.delete('/api/drivers/:id', authMiddleware(), async (req,res,next) => {
  try {
    if (req.principal.type !== 'panel') return res.status(403).json({error:'FORBIDDEN'});
    const { data:before } = await getRoot();
    const g = structuredClone(before['gohouse-data'] || {});
    g.repartidores = (g.repartidores || []).filter(r => r.id !== req.params.id);
    const out = await writeValue(req.principal,'gohouse-data',g,before['gohouse-data'] || {});
    await pool.query('DELETE FROM driver_access_codes WHERE driver_id=$1',[String(req.params.id)]);
    broadcast('gohouse-data');
    res.json({ok:true,version:out.version});
  } catch(e){ next(e); }
});

app.get('/api/push/public-key', (_req,res) => res.json({ publicKey: publicKey() }));
app.post('/api/push/subscribe', authMiddleware(), async (req,res,next) => {
  try { await saveSubscription(req.principal, req.body?.subscription); res.status(201).json({ok:true}); }
  catch(e){ next(e); }
});

app.post('/api/upload-data-url', authMiddleware(), async (req,res,next) => {
  try {
    const dataUrl = String(req.body?.dataUrl || '');
    const m = dataUrl.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
    if (!m) return res.status(400).json({error:'INVALID_IMAGE'});

    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const raw = Buffer.from(m[2],'base64');
    const maxUploadMb = Number(config.maxUploadMb || process.env.GOHOUSE_MAX_UPLOAD_MB || 8);
    if (raw.length > maxUploadMb * 1024 * 1024) {
      return res.status(413).json({error:'IMAGE_TOO_LARGE'});
    }

    await fs.mkdir(SERVER_UPLOAD_DIR,{recursive:true});
    const name = `${Date.now()}-${cryptoId()}.${ext}`;
    const target = path.join(SERVER_UPLOAD_DIR,name);
    await fs.writeFile(target,raw,{mode:0o640});

    res.status(201).json({url:`/api/public/uploads/${name}`});
  } catch(e){ next(e); }
});

app.get('/api/public/uploads/:name', async (req,res,next) => {
  try {
    const name=String(req.params.name||'');
    if(!/^\d+-[A-Za-z0-9-]+\.(jpg|png|webp)$/.test(name)) return res.status(404).end();
    const target=path.join(SERVER_UPLOAD_DIR,name);
    const raw=await fs.readFile(target).catch(err=>{
      if(err?.code==='ENOENT') return null;
      throw err;
    });
    if(!raw) return res.status(404).end();
    const ext=name.split('.').pop().toLowerCase();
    const mime=ext==='jpg'?'image/jpeg':`image/${ext}`;
    res.set('Content-Type',mime);
    res.set('Cache-Control','public, max-age=31536000, immutable');
    res.set('X-Content-Type-Options','nosniff');
    res.send(raw);
  } catch(e){ next(e); }
});

const server = app.listen(config.port, config.host, () => console.log(`Domicilios Llanos VPS API escuchando en ${config.host}:${config.port}`));
const wss = new WebSocketServer({ noServer:true });
const sockets = new Set();

server.on('upgrade',(req,socket,head) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname !== '/ws') return socket.destroy();
    const token = url.searchParams.get('token');
    const principal = verifyToken(token);
    wss.handleUpgrade(req,socket,head,ws => {
      ws.principal = principal;
      sockets.add(ws);
      ws.on('close',()=>sockets.delete(ws));
    });
  } catch { socket.destroy(); }
});

function broadcast(pathName='') {
  const msg = JSON.stringify({ type:'changed', path:pathName, at:Date.now() });
  for (const ws of sockets) if (ws.readyState === 1) ws.send(msg);
}

function principalUser(p) {
  if (p.type === 'panel') return {uid:p.uid,email:p.email,type:'panel'};
  if (p.type === 'driver') return {uid:p.uid,email:null,type:'driver',driverId:p.driverId};
  return {uid:p.uid,email:p.email || null,type:p.type,account:!!p.account};
}

function canReturnNull(principal,pathName) {
  const p = splitPath(pathName);
  if (principal.type === 'panel') return true;
  if (p[0] === 'gohouse-data') return true;
  if (principal.type === 'client' && ['chats','chatsClientes'].includes(p[0])) return true;
  if (principal.type === 'driver' && ['chats','chatsPanel'].includes(p[0])) return true;
  return false;
}

function cryptoId() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

app.use((err,req,res,_next) => {
  console.error(err);
  const tariffConflict = /^TARIFF_/.test(String(err.message || ''));
  const status = err.status || (tariffConflict || err.code === '23505' ? 409 : 500);
  res.status(status).json({ error: err.message || 'SERVER_ERROR' });
});
