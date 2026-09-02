import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { WebSocketServer } from 'ws';
import { pool } from './db.js';
import { config } from './config.js';
import { authMiddleware, createAnonymous, loginPanel, loginDriver, verifyToken, setDriverPin, createPanelUser, disablePanelUser, panelBootstrapStatus, bootstrapPanelAdmin } from './auth.js';
import { getRoot, readPathForPrincipal, writeValue, removeValue, pushValue } from './store.js';
import { splitPath, getAtPath, stripPins, safeEmailKey } from './util.js';
import { pushReady, publicKey, saveSubscription, notifyStateDiff } from './push.js';
import { getPublicBranding, manifestFor } from './branding.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy:'cross-origin' } }));
app.use(express.json({ limit: `${config.maxJsonMb}mb` }));

app.get('/api/health', async (_req,res) => {
  const { rows } = await pool.query('SELECT version,updated_at FROM app_state WHERE id=1');
  res.json({ ok:true, service:'gohouse-vps', db:true, push:pushReady(), state:rows[0] || null });
});

app.get('/api/public/config', async (_req,res,next) => {
  try {
    res.set('Cache-Control','no-store');
    res.json(await getPublicBranding());
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
      .filter(a => a.image && (a.image.startsWith('/uploads/') || /^https?:\/\//i.test(a.image)))
      .sort((a,b) => a.order - b.order);
    res.set('Cache-Control','no-store');
    res.json({ ads });
  } catch (e) { next(e); }
});

app.get('/api/manifest.webmanifest', async (req,res,next) => {
  try {
    const cfg = await getPublicBranding();
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
app.post('/api/auth/driver', async (req,res) => {
  const result = await loginDriver(String(req.body?.driverId || ''), String(req.body?.pin || ''));
  if (!result) return res.status(401).json({ error:'INVALID_PIN' });
  res.json(result);
});
app.get('/api/auth/session', authMiddleware(), (req,res) => res.json({ user: principalUser(req.principal) }));

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
    const out = await writeValue(req.principal, 'gohouse-data', g, before['gohouse-data'] || {});
    broadcast('gohouse-data');
    res.json({ id,nombre,estado:'disponible' });
  } catch(e){ next(e); }
});

app.put('/api/drivers/:id/pin', authMiddleware(), async (req,res,next) => {
  try {
    if (req.principal.type !== 'panel') return res.status(403).json({error:'FORBIDDEN'});
    await setDriverPin(req.params.id, String(req.body?.pin || ''));
    res.json({ok:true});
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
    if (raw.length > config.maxUploadMb * 1024 * 1024) return res.status(413).json({error:'IMAGE_TOO_LARGE'});
    await fs.mkdir(config.uploadDir,{recursive:true});
    const name = `${Date.now()}-${cryptoId()}.${ext}`;
    await fs.writeFile(path.join(config.uploadDir,name),raw,{mode:0o640});
    res.status(201).json({url:`/uploads/${name}`});
  } catch(e){ next(e); }
});

const server = app.listen(config.port, config.host, () => console.log(`GoHouse VPS API escuchando en ${config.host}:${config.port}`));
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
  return {uid:p.uid,email:null,type:p.type};
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
  const status = err.status || (err.code === '23505' ? 409 : 500);
  res.status(status).json({ error: err.message || 'SERVER_ERROR' });
});
