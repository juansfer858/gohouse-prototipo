#!/usr/bin/env python3
import hashlib, json, pathlib, subprocess, sys, datetime
BASE = '9979e527402defedcb76654918062c62fa4fa087'
ROOT = pathlib.Path('release/payload/reports-1')
def base_file(path, expected):
    raw = subprocess.check_output(['git', 'show', BASE + ':' + path])
    assert hashlib.sha256(raw).hexdigest() == expected, 'Production base mismatch: ' + path
    return raw.decode('utf-8')
def write(path, value):
    dest = ROOT / path
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(value, encoding='utf-8')
def once(s, old, new):
    assert s.count(old) == 1, 'Expected exactly one marker: ' + old[:80]
    return s.replace(old, new, 1)
if '--manifest' in sys.argv:
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    names = ['server/src/server.js', 'server/src/reports.js', 'web/gohouse-panel.html', 'web/llanos-reports.js', 'web/llanos-report-excel.js', 'web/llanos-exceljs-4.4.0.min.js', 'web/llanos-exceljs-4.4.0.LICENSE.txt']
    def entry(path):
        b = (ROOT / path).read_bytes()
        return {'path': path, 'url': f'https://raw.githubusercontent.com/juansfer858/gohouse-prototipo/{sha}/{ROOT.as_posix()}/{path}', 'sha256': hashlib.sha256(b).hexdigest()}
    manifest = {'version': '2026.09.30-white-label.47', 'published_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'status': 'release', 'files': [entry(n) for n in names], 'delete': [], 'migrations': [entry('migrations/011_employee_settlements.sql')]}
    pathlib.Path('release/version.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print('MANIFEST', sha)
    sys.exit(0)
server = base_file('release/payload/publicidad-db-media-final-1/server/src/server.js', '4228b14a1284f8bf9ae0a0b757123fc31e8eaa6a262de74a17ee0ef62cf04a6d')
server = once(server, "import { registerTariffRoutes } from './tarifas.js';", "import { registerTariffRoutes } from './tarifas.js';\nimport { registerReportRoutes, REPORT_VERSION } from './reports.js';")
server = once(server, 'registerDriverDocumentRoutes(app, { authMiddleware });', 'registerDriverDocumentRoutes(app, { authMiddleware });\nregisterReportRoutes(app, { pool, authMiddleware, broadcast });')
server = once(server, "  const { rows } = await pool.query('SELECT version,updated_at FROM app_state WHERE id=1');", "  const { rows } = await pool.query('SELECT version,updated_at FROM app_state WHERE id=1');\n  const reportStorage = await pool.query(\"SELECT to_regclass('public.llanos_employee_settlements') IS NOT NULL AND to_regclass('public.llanos_employee_settlement_items') IS NOT NULL AS ready\");")
server = once(server, "uploadMode:'postgres-media-v42',", "reportsMode:REPORT_VERSION, reportsReady:reportStorage.rows[0]?.ready===true, uploadMode:'postgres-media-v42',")
write('server/src/server.js', server)
panel = base_file('release/payload/panel-v45/web/gohouse-panel.html', 'fe1bb1307db1cb785f3027a227bb299d5aa6160e62dc152e40a5fb4395856d34')
panel = once(panel, '<script defer src="gohouse-branding.js?v=20260915.2"></script>', '<script defer src="gohouse-branding.js?v=20260915.2"></script>\n<script defer src="/llanos-reports.js?v=20260930.47"></script>')
a, b = panel.index('function renderInformes(){'), panel.index('let domiciliarioSeleccionadoInforme = null;')
panel = panel[:a] + '''function renderInformes(){
  if(window.LlanosReports) return window.LlanosReports.mount();
  const cont=document.getElementById('vista-informes');
  if(cont && !cont.querySelector('#lr-loading')) cont.innerHTML='<div id="lr-loading" class="empty">Cargando informes. Si no aparecen, recarga el panel.</div>';
}

''' + panel[b:]
a, b = panel.index('function prepararLiquidacion(repId){'), panel.index('function cerrarModalLiquidacion(){')
panel = panel[:a] + '''function prepararLiquidacion(repId){
  cambiarVistaPanel('informes');
  if(window.LlanosReports) window.LlanosReports.openEmployee(repId);
}

''' + panel[b:]
a, b = panel.index('function confirmarLiquidacionPagada(){'), panel.index('function escapeHtml(str){')
panel = panel[:a] + '''function confirmarLiquidacionPagada(){
  showToast('Usa Informes → Liquidación empleado para revisar y registrar el pago.');
}

''' + panel[b:]
assert 'firebasejs' not in panel and 'cancelarPedidoPanel' in panel and 'gohouse-vps-adapter.js' in panel
assert 'orden.liquidado = true' not in panel
write('web/gohouse-panel.html', panel)
# Idempotent packaging refinements: suppress stale-filter actions and open Excel on Resumen.
ui = (ROOT / 'web/llanos-reports.js').read_text()
ui = ui.replace("report = null; sequence++; load();", "report = null; $('lr-body').innerHTML = ''; sequence++; load();")
write('web/llanos-reports.js', ui)
ex = (ROOT / 'web/llanos-report-excel.js').read_text()
ex = ex.replace('const wb = new ExcelJS.Workbook();', "const wb = new ExcelJS.Workbook(); wb.addWorksheet('Resumen');") if "wb.addWorksheet('Resumen');" not in ex else ex
ex = ex.replace("const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 5 }], properties: { defaultRowHeight: 21 } });", "const ws = wb.getWorksheet(name) || wb.addWorksheet(name); ws.views = [{ state: 'frozen', ySplit: 5 }]; ws.properties.defaultRowHeight = 21;")
ex = ex.replace('    overview.orderNo = 0;\n', '')
write('web/llanos-report-excel.js', ex)
print('BUILD_BASE_VERIFIED; only report integration points patched')
