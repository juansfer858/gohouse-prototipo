import { createHash, randomUUID } from 'node:crypto';

export const REPORT_VERSION = 'llanos-reports-v49';
const TZ = 'America/Bogota';
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const uuidPattern = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { status }); };
const text = (v, max = 240) => String(v ?? '').trim().slice(0, max);
const paid = v => v === true || v === 'true' || v === 1;
const sum = (rows, key) => rows.reduce((s, r) => s + Math.round((r[key] ?? 0) * 100), 0) / 100;
function amount(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100000000000 ? Math.round(n * 100) / 100 : null;
}
export function localDay(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (typeof value === 'string') {
    value = value.trim();
    if (!value) return '';
    // A calendar date has no time zone: do not shift it to the previous day.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return validDay(value) ? value : '';
  }
  if (typeof value !== 'number' && typeof value !== 'string' && !(value instanceof Date)) return '';
  const d = new Date(typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value);
  if (!Number.isFinite(d.getTime())) return '';
  const p = Object.fromEntries(dateFormat.formatToParts(d).map(x => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  return validDay(day) ? day : '';
}
function retainedOrderDay(value) {
  if (typeof value !== 'string') return '';
  const s = value.trim();
  if (validDay(s)) return s;
  // The original panel/client write order.day using Date.toDateString().
  // Parse that calendar date explicitly, not as midnight in a server time zone.
  const m = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{4})$/.exec(s);
  if (!m) return '';
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[2])+1;
  const day = `${m[4]}-${String(month).padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  if (!validDay(day)) return '';
  const weekday = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(day+'T12:00:00Z').getUTCDay()];
  return weekday === m[1] ? day : '';
}
function validDay(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(v + 'T12:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v && v >= '2000-01-01' && v <= '2100-12-31';
}
export function filters(raw = {}) {
  const from = raw.from ?? '', to = raw.to ?? '', status = raw.status ?? '';
  if (typeof from !== 'string' || typeof to !== 'string' || (from && !validDay(from)) || (to && !validDay(to))) fail('REPORT_INVALID_DATES');
  if (from && to && from > to) fail('REPORT_REVERSED_DATES');
  if (typeof raw.employeeId !== 'undefined' && typeof raw.employeeId !== 'string') fail('REPORT_INVALID_EMPLOYEE');
  if (typeof status !== 'string' || !['', 'entregado', 'cancelado', 'active'].includes(status)) fail('REPORT_INVALID_STATUS');
  return { from, to, employeeId: text(raw.employeeId, 160), status };
}
function matchesStatus(row, status) {
  if (!status) return true;
  return status === 'active' ? !['entregado', 'cancelado'].includes(row.status) : row.status === status;
}
function roleFor(root, principal) {
  if (principal?.type !== 'panel') fail('FORBIDDEN', 403);
  const email = text(principal.email).toLowerCase();
  const users = Object.values(root?.['gohouse-data']?.usuariosPanel || {});
  const user = users.find(u => text(u?.email).toLowerCase() === email && u?.activo !== false);
  if (!user || !['administrador', 'operador', 'lectura'].includes(user.rol)) fail('FORBIDDEN', 403);
  return user.rol;
}
function dateFor(o) {
  const fields = o.estado === 'entregado' ? ['deliveredAt','entregadoAt']
    : o.estado === 'cancelado' ? ['canceladoAt','cancelledAt'] : ['createdAt'];
  for (const field of fields) {
    const date = localDay(o[field]);
    if (date) return { date, dateEstimated: false, dateSource: field };
  }
  const requested = localDay(o.createdAt);
  if (requested) return { date: requested, dateEstimated: true, dateSource: 'createdAt' };
  const retained = retainedOrderDay(o.day);
  return { date: retained, dateEstimated: true, dateSource: retained ? 'day' : 'missing' };
}
function employeeName(o, names, id) {
  return names.get(id) || text(o.repartidorNombre || o.domiciliarioNombre, 120) || (id ? `Empleado retirado (${id})` : 'Sin asignar');
}
function normalizeOrder(o, names, ledger) {
  const id = text(o.id, 160), record = ledger.get(id);
  const employeeId = text(o.repartidorId || o.canceladoRepartidorId, 160);
  const fare = amount(o.tarifa), purchase = amount(o.valorCompra);
  let company = amount(o.comisionCasa);
  if (company === null && fare !== null && amount(o.gananciaDomiciliario) !== null) company = Math.round((fare - amount(o.gananciaDomiciliario)) * 100) / 100;
  const valid = fare !== null && company !== null && company >= 0 && company <= fare;
  let row = {
    id, number: o.numero ?? '', ...dateFor(o), employeeId,
    employee: employeeName(o, names, employeeId), status: text(o.estado, 40),
    client: text(o.cliente, 160), address: text(o.direccion, 320),
    payment: text(o.pago || o.pagoEntrega, 120) || 'Sin definir', zone: text(o.zonaTarifaNombre, 120),
    fare, purchase: purchase ?? 0, company: valid ? company : null,
    earnings: valid ? Math.round((fare - company) * 100) / 100 : null,
    valid, settled: paid(o.liquidado), settlementId: '', settledAt: o.liquidadoAt || null
  };
  // Once settled, use the signed-off snapshot, even if an old client resends stale order data.
  if (record) row = { ...record.snapshot, settled: true, settlementId: record.settlement_id, settledAt: record.created_at };
  return row;
}
function totals(rows) {
  const delivered = rows.filter(r => r.status === 'entregado');
  const valid = delivered.filter(r => r.valid);
  const pending = valid.filter(r => !r.settled), settled = valid.filter(r => r.settled);
  return {
    orders: rows.length, services: delivered.length,
    cancelled: rows.filter(r => r.status === 'cancelado').length,
    active: rows.filter(r => !['entregado', 'cancelado'].includes(r.status)).length,
    fare: sum(delivered, 'fare'), purchases: sum(delivered, 'purchase'),
    company: sum(valid, 'company'), earnings: sum(valid, 'earnings'),
    pendingCount: pending.length, pendingAmount: sum(pending, 'earnings'),
    settledCount: settled.length, settledAmount: sum(settled, 'earnings'),
    missingAmounts: delivered.filter(r => !r.valid).length
  };
}
export function pendingHash(rows) {
  return createHash('sha256').update(JSON.stringify(rows.map(r => [r.id, r.employeeId, r.date, r.fare, r.company, r.earnings]).sort((a, b) => a[0].localeCompare(b[0])))).digest('hex');
}
export function buildReport(root, filter, ledgerRows = [], settlements = []) {
  filter = filters(filter);
  const g = root?.['gohouse-data'] || {};
  const names = new Map((g.repartidores || []).map(r => [text(r.id, 160), text(r.nombre, 120)]));
  const ledger = new Map(ledgerRows.map(x => [String(x.order_id), x]));
  const seen = new Set(), all = [];
  for (const o of (g.orders || [])) {
    if (!o?.id || seen.has(String(o.id))) continue;
    seen.add(String(o.id)); all.push(normalizeOrder(o, names, ledger));
  }
  // Settlement history survives deletion of an employee or an old order record.
  for (const item of ledgerRows) if (!seen.has(String(item.order_id))) all.push({ ...item.snapshot, settled: true, settlementId: item.settlement_id, settledAt: item.created_at });
  const employees = new Map([...names].map(([id, name]) => [id, { id, name, archived: false }]));
  all.forEach(r => { if (r.employeeId && !employees.has(r.employeeId)) employees.set(r.employeeId, { id: r.employeeId, name: r.employee, archived: true }); });
  const counts = new Map();
  all.forEach(r => counts.set(r.employeeId, (counts.get(r.employeeId) || 0) + 1));
  employees.forEach(e => { e.historyCount = counts.get(e.id) || 0; });
  // No date bounds means the entire recorded history, including records without a usable date.
  const employeeHistory = all.filter(r => !filter.employeeId || r.employeeId === filter.employeeId);
  const historyDates = employeeHistory.map(r => r.date).filter(Boolean).sort();
  const allTime = !filter.from && !filter.to;
  const within = employeeHistory.filter(r => allTime || (r.date && (!filter.from || r.date >= filter.from) && (!filter.to || r.date <= filter.to)));
  const rows = within.filter(r => matchesStatus(r, filter.status)).sort((a, b) => {
    if (!a.date || !b.date) return a.date ? -1 : b.date ? 1 : String(b.number).localeCompare(String(a.number), undefined, { numeric: true });
    return b.date.localeCompare(a.date) || String(b.number).localeCompare(String(a.number), undefined, { numeric: true });
  });
  const grouped = new Map();
  for (const r of rows) { const key = r.employeeId || ''; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(r); }
  const byEmployee = [...grouped].map(([id, list]) => ({ id, name: names.get(id) || list[0].employee, ...totals(list) })).sort((a, b) => a.name.localeCompare(b.name));
  const daily = new Map(), methods = new Map();
  for (const r of rows) {
    if (!daily.has(r.date)) daily.set(r.date, []); daily.get(r.date).push(r);
    if (!methods.has(r.payment)) methods.set(r.payment, []); methods.get(r.payment).push(r);
  }
  const pending = rows.filter(r => r.status === 'entregado' && !r.settled && r.valid && r.employeeId);
  const summary = totals(rows);
  return {
    version: REPORT_VERSION, timeZone: TZ, filter, allTime,
    history: { total: employeeHistory.length, firstDate: historyDates[0] || '', lastDate: historyDates.at(-1) || '',
      undated: employeeHistory.filter(r => !r.date).length, filteredOut: employeeHistory.length - rows.length },
    brand: text(g.config?.brandName, 120) || 'Domicilios',
    employees: [...employees.values()].sort((a, b) => a.name.localeCompare(b.name)),
    rows, summary, byEmployee,
    byDay: [...daily].map(([date, list]) => ({ date, ...totals(list) })),
    byPayment: [...methods].map(([method, list]) => ({ method, ...totals(list) })),
    pendingHash: pendingHash(pending), pendingIds: pending.map(r => r.id),
    canSettleSelection: !!filter.employeeId && !!filter.from && !!filter.to && (!filter.status || filter.status === 'entregado') && pending.length > 0 && summary.missingAmounts === 0,
    estimatedDates: rows.filter(r => r.date && r.dateEstimated).length,
    undatedOrders: employeeHistory.filter(r => !r.date).length,
    settlements: settlements.filter(s => (!filter.employeeId || s.employee_id === filter.employeeId) && (!filter.to || String(s.date_from).slice(0, 10) <= filter.to) && (!filter.from || String(s.date_to).slice(0, 10) >= filter.from)).slice(0, 100)
  };
}
async function loadLedger(db) {
  const items = await db.query('SELECT i.order_id,i.settlement_id,i.snapshot,s.created_at FROM llanos_employee_settlement_items i JOIN llanos_employee_settlements s ON s.id=i.settlement_id');
  const batches = await db.query('SELECT id,employee_id,employee_name,date_from::text,date_to::text,service_count,total_fare,company_amount,employee_amount,payment_method,payment_reference,created_by,created_at FROM llanos_employee_settlements ORDER BY created_at DESC');
  return { items: items.rows, batches: batches.rows };
}
export async function readReport(pool, principal, raw) {
  const f = filters(raw), db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows } = await db.query('SELECT data FROM app_state WHERE id=1');
    const root = rows[0]?.data || {}, role = roleFor(root, principal);
    const ledger = await loadLedger(db);
    const report = buildReport(root, f, ledger.items, ledger.batches);
    report.canSettle = role === 'administrador';
    await db.query('COMMIT');
    return report;
  } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; }
  finally { db.release(); }
}
export async function settleEmployee(pool, principal, raw = {}) {
  const f = filters(raw);
  if (!f.employeeId) fail('REPORT_EMPLOYEE_REQUIRED');
  if (!f.from || !f.to) fail('REPORT_SETTLEMENT_DATES_REQUIRED');
  if (f.status && f.status !== 'entregado') fail('REPORT_SETTLEMENT_FILTER_REQUIRED');
  if (!uuidPattern.test(String(raw.requestKey || ''))) fail('REPORT_REQUEST_KEY_REQUIRED');
  if (!/^[a-f\d]{64}$/.test(String(raw.previewHash || ''))) fail('REPORT_PREVIEW_REQUIRED');
  if (raw.confirmPaid !== true) fail('REPORT_PAYMENT_CONFIRMATION_REQUIRED');
  const payment = text(raw.paymentMethod, 80), reference = text(raw.paymentReference, 160);
  if (!['Efectivo', 'Transferencia', 'Otro'].includes(payment)) fail('REPORT_PAYMENT_METHOD_REQUIRED');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SET LOCAL lock_timeout='5s'");
    const { rows } = await db.query('SELECT data FROM app_state WHERE id=1 FOR UPDATE');
    const root = rows[0]?.data || {};
    if (roleFor(root, principal) !== 'administrador') fail('ADMIN_REQUIRED', 403);
    const replay = await db.query('SELECT * FROM llanos_employee_settlements WHERE request_key=$1', [raw.requestKey]);
    if (replay.rows[0]) {
      const s = replay.rows[0];
      if (s.employee_id !== f.employeeId || s.preview_hash !== raw.previewHash) fail('REPORT_REQUEST_REUSED', 409);
      await db.query('COMMIT'); return { ok: true, replay: true, settlement: s };
    }
    const ledger = await loadLedger(db);
    const report = buildReport(root, f, ledger.items, ledger.batches);
    if (report.pendingHash !== raw.previewHash) fail('REPORT_CHANGED', 409);
    if (report.summary.missingAmounts) fail('REPORT_MISSING_AMOUNTS', 409);
    const pending = report.rows.filter(r => report.pendingIds.includes(r.id));
    if (!pending.length) fail('REPORT_NOTHING_PENDING', 409);
    if (pending.length > 5000) fail('REPORT_BATCH_TOO_LARGE');
    const id = randomUUID(), at = Date.now(), actor = text(principal.email, 240);
    const result = await db.query(
      'INSERT INTO llanos_employee_settlements(id,request_key,employee_id,employee_name,date_from,date_to,preview_hash,service_count,total_fare,company_amount,employee_amount,payment_method,payment_reference,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',
      [id, raw.requestKey, f.employeeId, pending[0].employee, f.from, f.to, report.pendingHash, pending.length, sum(pending, 'fare'), sum(pending, 'company'), sum(pending, 'earnings'), payment, reference, actor]);
    await db.query('INSERT INTO llanos_employee_settlement_items(order_id,settlement_id,snapshot) SELECT x.id,$1,x.snapshot FROM jsonb_to_recordset($2::jsonb) AS x(id text,snapshot jsonb)',
      [id, JSON.stringify(pending.map(r => ({ id: r.id, snapshot: r })))]);
    const ids = new Set(pending.map(r => r.id));
    const orders = (root['gohouse-data'].orders || []).map(o => ids.has(String(o.id)) ? { ...o, liquidado: true, liquidadoAt: at, liquidacionId: id } : o);
    await db.query("UPDATE app_state SET data=jsonb_set(data::jsonb,'{gohouse-data,orders}',$1::jsonb,true),version=version+1,updated_at=now() WHERE id=1", [JSON.stringify(orders)]);
    await db.query('INSERT INTO audit_log(actor_type,actor_id,action,path,metadata) VALUES($1,$2,$3,$4,$5)', ['panel', actor, 'employee_settlement', 'reports/settlements/' + id, JSON.stringify({ employeeId: f.employeeId, from: f.from, to: f.to, count: pending.length, amount: sum(pending, 'earnings') })]);
    await db.query('COMMIT');
    return { ok: true, settlement: result.rows[0] };
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') fail('REPORT_ALREADY_SETTLED', 409);
    if (e.code === '55P03') fail('REPORT_BUSY_RETRY', 409);
    throw e;
  } finally { db.release(); }
}
export function registerReportRoutes(app, { pool, authMiddleware, broadcast }) {
  const route = fn => async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { await fn(req, res); } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
  };
  app.get('/api/reports/summary', authMiddleware(), route(async (req, res) => res.json(await readReport(pool, req.principal, req.query))));
  app.post('/api/reports/settlements', authMiddleware(), route(async (req, res) => {
    const out = await settleEmployee(pool, req.principal, req.body);
    try { broadcast('gohouse-data'); } catch {}
    res.status(out.replay ? 200 : 201).json(out);
  }));
  app.get('/api/reports/settlements/:id', authMiddleware(), route(async (req, res) => {
    if (!uuidPattern.test(req.params.id)) fail('REPORT_NOT_FOUND', 404);
    const state = await pool.query('SELECT data FROM app_state WHERE id=1');
    roleFor(state.rows[0]?.data || {}, req.principal);
    const batch = await pool.query('SELECT * FROM llanos_employee_settlements WHERE id=$1', [req.params.id]);
    if (!batch.rows[0]) fail('REPORT_NOT_FOUND', 404);
    const items = await pool.query('SELECT snapshot FROM llanos_employee_settlement_items WHERE settlement_id=$1 ORDER BY order_id', [req.params.id]);
    res.json({ settlement: batch.rows[0], rows: items.rows.map(r => r.snapshot) });
  }));
}
