#!/usr/bin/env python3
"""Only rebuild report UI and its script reference; preserve backend and existing exporter."""
from pathlib import Path
import hashlib, json, subprocess, sys
from datetime import datetime, timezone
BASE=Path('release/payload/reports-dates-1/web')
OUT=Path('release/payload/settlement-flow-1/web')
HASHES={'llanos-reports.js':'4ddf593628a873a6be859720333651b1dd234ef08bf3bb1f3a40b17faa6ed280','gohouse-panel.html':'db8733621ea968ce21aa36228b16996d65fbeafe9c3ba81cf67b8856d04d8df3'}
def sha(b): return hashlib.sha256(b).hexdigest()
def build():
    for name,h in HASHES.items(): assert sha((BASE/name).read_bytes())==h, name+' base changed'
    ui=(BASE/'llanos-reports.js').read_text()
    assert ui.count('  function render() {')==1
    ui=ui.replace('  function render() {',Path('scripts/llanos-settlement-render-v50.js').read_text()+'\n  function renderGeneral() {',1)
    start=ui.index('  function preview(r) {');end=ui.index('  function loadScript(',start)
    ui=ui[:start]+Path('scripts/llanos-settlement-review-v50.js').read_text()+'\n'+ui[end:]
    marker="  async function load() {\n    if (busy) return;"
    assert marker in ui
    ui=ui.replace(marker,"  async function load() {\n    if (busy || reviewOpen) return;",1)
    marker="      $('lr-query').onclick = applyFilters;"
    assert marker in ui
    ui=ui.replace(marker,marker+"\n      $('lr-from').oninput = markDraftChanged;\n      $('lr-to').oninput = markDraftChanged;",1)
    marker='        <div class="lr-filters">'
    assert ui.count(marker)==1
    header='        <div id="lr-flow-heading"><h2 class="lr-flow-title">Liquidar servicios de un empleado</h2><p class="lr-flow-intro lr-hint">Revisa primero. Solo al confirmar se registran los servicios como liquidados; consultar o exportar no mueve dinero.</p><div class="lr-steps" aria-label="Pasos para liquidar"><div class="lr-step"><b>1. Elige empleado y fechas</b><span>Define el período.</span></div><div class="lr-step"><b>2. Revisa los servicios</b><span>Solo entregados pendientes.</span></div><div class="lr-step"><b>3. Confirma y guarda</b><span>Conserva el comprobante.</span></div></div></div>\n'
    ui=ui.replace(marker,header+marker,1)
    ui=ui.replace("version: 'llanos-reports-v49'","version: 'llanos-settlement-flow-v50'")
    assert "version: 'llanos-settlement-flow-v50'" in ui
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'llanos-reports.js').write_text(ui)
    panel=(BASE/'gohouse-panel.html').read_text()
    marker='/llanos-reports.js?v=20261006.49'
    assert panel.count(marker)==1
    (OUT/'gohouse-panel.html').write_text(panel.replace(marker,'/llanos-reports.js?v=20261006.50',1))
    for name in HASHES: print('BUILT',name,sha((OUT/name).read_bytes()))
def manifest():
    source=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
    entries=[]
    for name in HASHES:
        p=OUT/name;b=p.read_bytes()
        assert subprocess.check_output(['git','show',source+':'+str(p)])==b
        entries.append({'path':'web/'+name,'url':f'https://raw.githubusercontent.com/juansfer858/gohouse-prototipo/{source}/{p}','sha256':sha(b)})
    Path('release/version.json').write_text(json.dumps({'version':'2026.10.06-white-label.50','published_at':datetime.now(timezone.utc).isoformat(),'status':'release','files':entries,'delete':[],'migrations':[]},indent=2)+'\n')
if '--manifest' in sys.argv: manifest()
else: build()
