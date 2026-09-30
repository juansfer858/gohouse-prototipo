import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import express from 'express';
import pg from 'pg';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright';
const rootPath = process.env.REPORT_PAYLOAD;
assert(rootPath, 'Test payload directory required');
const dsn = process.env.REPORT_TEST_DATABASE_URL;
assert(dsn && new URL(dsn).hostname === '127.0.0.1' && new URL(dsn).pathname === '/reports_test', 'Tests are restricted to the isolated reports_test database');
const { buildReport, filters, localDay, readReport, settleEmployee, registerReportRoutes } = await import(pathToFileURL(path.join(rootPath, 'server/src/reports.js')));
await import(pathToFileURL(path.join(rootPath, 'web/llanos-report-excel.js')));
const outDir = path.resolve('qa-reports-v47'); await fs.mkdir(outDir, { recursive: true });
const pool = new pg.Pool({ connectionString: dsn });
const admin = { type: 'panel', email: 'admin@example.test' };
const reader = { type: 'panel', email: 'reader@example.test' };
const f = { from: '2026-09-28', to: '2026-09-28', employeeId: 'a' };
const timestamp = s => Date.parse(s);
const delivered = (id, employee, t, fare, company, more = {}) => ({ id, numero: id, repartidorId: employee, estado: 'entregado', cliente: '=SUM(1,2)', direccion: 'Prueba <&> sin datos reales', pago: 'Bancolombia', deliveredAt: timestamp(t), createdAt: timestamp('2026-09-20T12:00:00Z'), tarifa: fare, comisionCasa: company, valorCompra: 10000, ...more });
let fixture = { 'gohouse-data': {
  config: { brandName: 'EMPRESA DEMO', porcentajeCasa: 90 },
  usuariosPanel: { a: { ...admin, rol: 'administrador', activo: true }, b: { ...reader, rol: 'lectura', activo: true }, z: { email: 'revoked@example.test', rol: 'administrador', activo: false } },
  repartidores: [{ id: 'a', nombre: 'Empleado A <&>' }, { id: 'b', nombre: 'Empleado B' }],
  orders: [
    delivered('start', 'a', '2026-09-28T05:00:00Z', 4000, 1200),
    delivered('end', 'a', '2026-09-29T04:59:59Z', 5000, 1500),
    delivered('before', 'a', '2026-09-28T04:59:59Z', 1000, 0),
    delivered('after', 'a', '2026-09-29T05:00:00Z', 1000, 0),
    delivered('legacy', 'a', '2026-09-28T15:00:00Z', 7000, 2100, { liquidado: true }),
    delivered('bad', 'a', '2026-09-28T16:00:00Z', 4000, null),
    delivered('other', 'b', '2026-09-28T15:00:00Z', 1000, 0),
    { id: 'cancel', numero: 8, estado: 'cancelado', canceladoRepartidorId: 'a', canceladoAt: timestamp('2026-09-28T18:00:00Z'), tarifa: 999999, comisionCasa: 200000 },
    { id: 'active', numero: 9, estado: 'nuevo', createdAt: timestamp('2026-09-28T18:00:00Z'), tarifa: 4000 },
    { id: 'undated', estado: 'entregado', repartidorId: 'a', tarifa: 4000, comisionCasa: 1200 }
  ]
} };
let assertions = 0;
function check(condition, message) { assert(condition, message); assertions++; }
async function rejected(fn, code) { await assert.rejects(fn, e => e.message === code); assertions++; }
await pool.query('CREATE TABLE app_state(id integer PRIMARY KEY, data jsonb NOT NULL, version bigint NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now())');
await pool.query('CREATE TABLE audit_log(actor_type text, actor_id text, action text, path text, metadata jsonb)');
await pool.query('INSERT INTO app_state(id,data) VALUES(1,$1)', [JSON.stringify(fixture)]);
const migration = await fs.readFile(path.join(rootPath, 'migrations/011_employee_settlements.sql'), 'utf8');
await pool.query(migration); await pool.query(migration);
check(localDay('2026-09-28T04:59:59Z') === '2026-09-27', 'Colombia start boundary');
check(localDay('2026-09-29T04:59:59Z') === '2026-09-28', 'Colombia end boundary');
assert.throws(() => filters({ from: '2026-02-31', to: '2026-03-02' }), /REPORT_INVALID_DATES/); assertions++;
assert.throws(() => filters({ from: '2026-09-29', to: '2026-09-28' }), /REPORT_REVERSED_DATES/); assertions++;
let report = await readReport(pool, admin, f);
check(report.summary.services === 4 && report.summary.fare === 20000, 'Delivered date not order creation date; cancellations excluded');
check(report.summary.missingAmounts === 1 && !report.canSettleSelection, 'Do not invent missing historic commissions');
check(report.summary.company === 4800, 'Current 90% commission must not rewrite history');
check(report.undatedOrders === 1, 'Undated records surfaced, not silently included');
const request = () => ({ ...f, requestKey: randomUUID(), previewHash: report.pendingHash, confirmPaid: true, paymentMethod: 'Efectivo' });
await rejected(() => settleEmployee(pool, admin, request()), 'REPORT_MISSING_AMOUNTS');
await rejected(() => readReport(pool, { type: 'driver', driverId: 'a' }, f), 'FORBIDDEN');
await rejected(() => readReport(pool, { type: 'panel', email: 'revoked@example.test' }, f), 'FORBIDDEN');
check((await readReport(pool, reader, f)).canSettle === false, 'Read-only can export but cannot settle');
await rejected(() => settleEmployee(pool, reader, request()), 'ADMIN_REQUIRED');
fixture['gohouse-data'].orders.find(o => o.id === 'bad').comisionCasa = 1200;
await pool.query('UPDATE app_state SET data=$1 WHERE id=1', [JSON.stringify(fixture)]);
report = await readReport(pool, admin, f);
check(report.summary.pendingCount === 3 && report.summary.pendingAmount === 9100, 'Pending excludes legacy paid');
check(report.summary.earnings === 14000 && report.summary.settledAmount === 4900, 'Amounts reconcile');
const previewBeforePayment = structuredClone(report);
const req1 = request(), req2 = request();
const race = await Promise.allSettled([settleEmployee(pool, admin, req1), settleEmployee(pool, admin, req2)]);
check(race.filter(r => r.status === 'fulfilled').length === 1, 'Concurrent settlement only succeeds once');
check(race.filter(r => r.status === 'rejected').length === 1, 'Second concurrent settlement rejected');
const winner = race[0].status === 'fulfilled' ? req1 : req2;
const replay = await settleEmployee(pool, admin, winner);
check(replay.replay === true, 'Network retry is idempotent');
check(Number((await pool.query('SELECT count(*) FROM llanos_employee_settlement_items')).rows[0].count) === 3, 'Three unique ledger items');
let stored = (await pool.query('SELECT data FROM app_state WHERE id=1')).rows[0].data;
check(!stored['gohouse-data'].orders.find(o => o.id === 'after').liquidado, 'No settlement outside chosen dates');
check(!stored['gohouse-data'].orders.find(o => o.id === 'other').liquidado, 'No settlement for other employee');
check(stored['gohouse-data'].orders.find(o => o.id === 'legacy').liquidado, 'Historic flag preserved');
report = await readReport(pool, admin, f);
check(report.summary.pendingAmount === 0 && report.summary.settledAmount === 14000, 'Fully reconciled report after payment');
const stale = structuredClone(stored); stale['gohouse-data'].orders.find(o => o.id === 'start').liquidado = false;
await pool.query('UPDATE app_state SET data=$1 WHERE id=1', [JSON.stringify(stale)]);
check((await readReport(pool, admin, f)).summary.pendingAmount === 0, 'Stale legacy snapshot cannot repay a ledger item');
await rejected(() => settleEmployee(pool, admin, { ...winner, requestKey: randomUUID() }), 'REPORT_CHANGED');
const removed = structuredClone(stale);
removed['gohouse-data'].repartidores = removed['gohouse-data'].repartidores.filter(e => e.id !== 'a');
removed['gohouse-data'].orders = removed['gohouse-data'].orders.filter(o => o.id !== 'start');
await pool.query('UPDATE app_state SET data=$1 WHERE id=1', [JSON.stringify(removed)]);
const history = await readReport(pool, admin, f);
check(history.rows.some(r => r.id === 'start' && r.employee === 'Empleado A <&>' && r.settled), 'Snapshot survives employee and order removal');
await pool.query('UPDATE app_state SET data=$1 WHERE id=1', [JSON.stringify(stale)]);
const unassigned = buildReport({ 'gohouse-data': { orders: [{ ...fixture['gohouse-data'].orders[0], repartidorId: null }] } }, { ...f, employeeId: '' });
check(!unassigned.canSettleSelection, 'No payout without employee');
const empty = await readReport(pool, admin, { from: '2025-01-01', to: '2025-01-02', employeeId: '' });
check(empty.rows.length === 0 && empty.summary.fare === 0, 'Empty date range');
const wb = globalThis.LlanosReportExcel.build(ExcelJS, previewBeforePayment, 'Liquidacion empleado');
await wb.xlsx.writeFile(path.join(outDir, 'demo-liquidacion.xlsx'));
const reloaded = new ExcelJS.Workbook(); await reloaded.xlsx.readFile(path.join(outDir, 'demo-liquidacion.xlsx'));
check(reloaded.worksheets.length === 6, 'Six workbook sheets');
check(reloaded.worksheets[0].name === 'Resumen', 'Workbook starts with summary');
const literalCells = [];
reloaded.getWorksheet('Servicios').getColumn(5).eachCell((cell, row) => { if (row >= 6 && cell.value === '=SUM(1,2)') literalCells.push(cell); });
check(literalCells.length === 4, 'All four formula-looking client names preserved as literal text');
check(literalCells.every(cell => cell.type === ExcelJS.ValueType.String), 'Untrusted text never becomes an Excel formula');
check(reloaded.getWorksheet('Resumen').getCell('B15').result === 9100, 'XLSX pending total matches UI/server');
check(reloaded.getWorksheet('Servicios').views[0].ySplit === 5, 'Frozen headers');
check(reloaded.getWorksheet('Servicios').getCell('B6').value instanceof Date, 'Real Excel dates');
const blankBook = globalThis.LlanosReportExcel.build(ExcelJS, empty); await blankBook.xlsx.writeBuffer(); assertions++;
const app = express(); app.use(express.json());
const authMiddleware = () => (req, res, next) => {
  const token = String(req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' });
  req.principal = token === 'admin' ? admin : token === 'reader' ? reader : { type: 'driver', driverId: 'a' }; next();
};
registerReportRoutes(app, { pool, authMiddleware, broadcast() {} });
app.use(express.static(path.join(rootPath, 'web')));
app.get('/test-harness', (req, res) => res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#16271f;color:#f5f5ee;font:15px Arial;margin:16px}input,select,button{padding:9px;border-radius:5px;border:1px solid #486153;background:#1e312b;color:white}.btn-primary{background:#e8863a;color:#111}h2{font-size:21px}h3{font-size:17px}</style></head><body><div id="vista-informes" style="display:block"></div><script>window.GoHouseVPS={api:async(p,o={})=>{const r=await fetch('/api'+p,{...o,headers:{'Content-Type':'application/json',Authorization:'Bearer admin'}});const j=await r.json();if(!r.ok)throw Error(j.error);return j;}};window.showToast=console.log;</script><script src="/llanos-reports.js"></script></body></html>`));
app.use((e, req, res, next) => res.status(e.status || 500).json({ error: e.message }));
const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.on('listening', r));
const base = 'http://127.0.0.1:' + server.address().port;
check((await fetch(base + '/api/reports/summary?from=2026-09-28&to=2026-09-28')).status === 401, 'Unauthenticated report protected');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1365, height: 1000 }, acceptDownloads: true });
  const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(base + '/test-harness'); await page.waitForSelector('#lr-export');
  await page.fill('#lr-from', f.from); await page.fill('#lr-to', f.to); await page.selectOption('#lr-employee', 'a');
  await page.waitForFunction(() => document.querySelector('#lr-body')?.textContent.includes('14.000'));
  check(await page.locator('#lr-settle').isDisabled(), 'Already paid employee cannot be settled in UI');
  await page.selectOption('#lr-employee', 'b'); await page.waitForFunction(() => document.querySelector('#lr-settle') && !document.querySelector('#lr-settle').disabled);
  await page.click('#lr-settle'); check(await page.locator('#lr-dialog').isVisible(), 'Review modal shown');
  check(await page.locator('#lr-confirm-pay').isDisabled(), 'Explicit paid confirmation required');
  await page.click('#lr-cancel');
  check((await readReport(pool, admin, { ...f, employeeId: 'b' })).summary.pendingAmount === 1000, 'Closing modal never marks paid');
  await page.click('#lr-tab-general'); await page.selectOption('#lr-employee', '');
  await page.waitForFunction(() => document.querySelector('#lr-body')?.textContent.includes('Empleado B'));
  const downloadEvent = page.waitForEvent('download'); await page.click('#lr-export'); const download = await downloadEvent;
  check(download.suggestedFilename().endsWith('.xlsx'), 'Browser downloads real xlsx extension');
  await download.saveAs(path.join(outDir, 'demo-informe-general.xlsx'));
  const downloaded = new ExcelJS.Workbook(); await downloaded.xlsx.readFile(path.join(outDir, 'demo-informe-general.xlsx'));
  check(downloaded.worksheets.length === 6, 'Downloaded XLSX roundtrip');
  await page.fill('#lr-from', '2026-09-20'); await page.evaluate(() => window.LlanosReports.mount()); await page.waitForTimeout(900);
  check(await page.inputValue('#lr-from') === '2026-09-20', 'Realtime refresh preserves date typing');
  await page.screenshot({ path: path.join(outDir, 'reports-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(outDir, 'reports-mobile.png'), fullPage: true });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Mobile: no page horizontal overflow');
  check(pageErrors.length === 0, 'No browser runtime errors: ' + pageErrors.join('; '));
} finally { await browser.close(); await new Promise(r => server.close(r)); await pool.end(); }
await fs.writeFile(path.join(outDir, 'qa.json'), JSON.stringify({ passed: true, assertions, productionWrites: 0, tests: ['date-boundaries', 'historic-values', 'cancelled-exclusion', 'legacy-paid', 'permissions', 'concurrent-settlements', 'idempotency', 'stale-client', 'archived-history', 'xlsx-roundtrip', 'formula-injection', 'browser-desktop-mobile', 'confirmation', 'typing-preserved'] }, null, 2));
console.log('REPORTS_QA_PASS', assertions, 'assertions; productionWrites=0');
