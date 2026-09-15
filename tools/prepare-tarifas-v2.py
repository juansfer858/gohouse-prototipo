"""Prepare a small release from exact deployed sources; never write to the VPS."""
import hashlib, json, pathlib, re, subprocess, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'release/payload/tarifas-2'
BASE='https://domicilios-llanos.vantixgc.com'
EXPECTED={
 'gohouse-panel.html':'c274b66020d599d5858cc7bae5b08cf82f8deaa990b71cea445421f6574e451f',
 'gohouse-cliente.html':'c7a9930ee13eec025deaea794334eacb6c24fcbe8e00245fa4b6784c07e86c12',
 'gohouse-domiciliarios.html':'e8ee3a3a7186351adddda48213cb520ffb0aaa09b7ea4f799252fa9864e1796a',
 'gohouse-branding.js':'6a30bcd15fd662c02d1ba6499393b8b4de03d16d33f34da7c157c35d2588fc5e',
 'gohouse-vps-adapter.js':'cac7fa44b4e9df9bfb8ae4ebc592a664649381880a8824d3db7c3e2cba35e5a6'
}
fixtures=ROOT/'tests/tarifas/fixtures'
fixtures.mkdir(parents=True,exist_ok=True)
sources={}
for name,expected in EXPECTED.items():
    raw=urllib.request.urlopen(BASE+'/'+name,timeout=20).read()
    actual=hashlib.sha256(raw).hexdigest()
    assert actual==expected, f'LIVE_SOURCE_CHANGED {name}: {actual}'
    sources[name]=raw.decode('utf-8'); (fixtures/name).write_bytes(raw)
    print('VERIFIED_BASELINE',name,actual)

def replace_one(text,old,new):
    assert text.count(old)==1, 'PATCH_ANCHOR_COUNT '+repr(old[:120])+': '+str(text.count(old))
    return text.replace(old,new,1)
def write(name,text):
    file=OUT/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_text(text,encoding='utf-8')

s=sources['gohouse-cliente.html']
s=replace_one(s,"  btn.textContent = 'Enviando...';", """  btn.textContent = 'Enviando...';
  let tarifaSnapshot;
  try {
    if (!window.GoHouseTarifas) throw new Error('TARIFF_NOT_CONFIGURED');
    tarifaSnapshot = await window.GoHouseTarifas.quote();
  } catch (error) {
    btn.disabled = false; btn.textContent = 'Enviar domicilio';
    showToast(window.GoHouseTarifas?.errorText(error) || 'No se pudieron cargar las tarifas. Actualiza e intenta de nuevo.');
    return;
  }""")
s=replace_one(s,'    numero: (data.orders.length + 1),','    numero: (data.orders.length + 1),\n    ...tarifaSnapshot,')
write('web/gohouse-cliente.html',s)

s=sources['gohouse-domiciliarios.html']
s=replace_one(s,'  if(inputValorServicio){','  if(inputValorServicio && !orden.tarifaFijada){')
s=replace_one(s,'id="in-valor-servicio-salida" value="${cfg.valorSugerido}"', 'id="in-valor-servicio-salida" value="${miPedidoActivo.tarifaFijada ? miPedidoActivo.tarifa : cfg.valorSugerido}" ${miPedidoActivo.tarifaFijada ? \'readonly aria-readonly="true"\' : \'\'} data-comision="${miPedidoActivo.comisionCasa ?? 0}"')
s=replace_one(s,'    const comisionCasa = Math.round(valor * cfg.porcentajeCasa / 100);','    const comisionCasa = input.readOnly ? Number(input.dataset.comision) : Math.round(valor * cfg.porcentajeCasa / 100);') if '    const comisionCasa = Math.round(valor * cfg.porcentajeCasa / 100);' in s else replace_one(s,'  const comisionCasa = Math.round(valor * cfg.porcentajeCasa / 100);','  const comisionCasa = input.readOnly ? Number(input.dataset.comision) : Math.round(valor * cfg.porcentajeCasa / 100);')
s=replace_one(s,'<div class="pedido-text">${escapeHtml(miPedidoActivo.pedido)}</div>', '<div class="pedido-text">${escapeHtml(miPedidoActivo.pedido)}</div>\n          ${miPedidoActivo.tarifaFijada ? `<div class="hint" id="gh-driver-fixed-tariff"><b>${escapeHtml(miPedidoActivo.zonaTarifaNombre)} · Domicilio: $${Number(miPedidoActivo.tarifa).toLocaleString(\'es-CO\')}</b><br>Tarifa definida por el cliente; no requiere digitación.</div>` : \'\'}')
write('web/gohouse-domiciliarios.html',s)

s=sources['gohouse-panel.html']
# Keep the commission handler's existing config preservation contract.
lines=s.splitlines()
for i,line in enumerate(lines):
    if re.search(r'function guardar.*[Cc]onfig|Comisión del servicio|in-porcentaje-casa',line):
        print('PANEL_CONFIG_CONTEXT',i+1,'\n'.join(lines[max(0,i-2):i+20]))
# Tariff UI attaches to the existing commission section, not the branding section.
# The native document is unchanged. Wrapper and branding load the new controller.

s=sources['gohouse-branding.js']
s=replace_one(s,"    loadExtension('white-label-app-shell-script', '/gohouse-app-shell.js');", "    loadExtension('white-label-app-shell-script', '/gohouse-app-shell.js');\n    loadExtension('white-label-tarifas-script', '/gohouse-tarifas.js?v=20260915.2');")
write('web/gohouse-branding.js',s)

s=(ROOT/'release/payload/fleet-1/server/src/server.js').read_text()
s=replace_one(s,"import { pool } from './db.js';", "import { pool } from './db.js';\nimport { registerTariffRoutes } from './tarifas.js';")
s=replace_one(s,'app.get(\'/api/health\',', "registerTariffRoutes(app, { pool, authMiddleware, broadcast });\n\napp.get('/api/health',")
s=replace_one(s,"  const status = err.status || (err.code === '23505' ? 409 : 500);", "  const tariffConflict = /^TARIFF_/.test(String(err.message || ''));\n  const status = err.status || (tariffConflict || err.code === '23505' ? 409 : 500);")
write('server/src/server.js',s)
(OUT/'baseline-hashes.json').write_text(json.dumps(EXPECTED,indent=2)+'\n')
print('HISTORICAL_BACKEND_OBJECTS')
objects=subprocess.check_output(['git','rev-list','--all','--objects'],text=True)
for line in objects.splitlines():
    if re.search(r'(?:store\.js|\.zip|\.tar\.gz|\.b64|server/src/auth\.js)$',line):print(line)
