#!/usr/bin/env python3
"""Build a focused date-compatibility patch on verified V48 files."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, subprocess, sys
BASE=Path('release/payload/reports-history-1')
OUT=Path('release/payload/reports-dates-1')
HASHES={
 'server/src/reports.js':'712acc937725ff55737345ea26e3f8f6a406e71a8c96a2e611c4284386a2ddb6',
 'web/llanos-reports.js':'5f7e55dbdcff8a01095575f04243411815c8d1b5c542e3d661bc8782c1f941db',
 'web/gohouse-panel.html':'a710d2315595f739f7db324dba69a60f52390a6ec218b967edfdaec88cfe6b3b'
}
def digest(b): return hashlib.sha256(b).hexdigest()
def replace_once(s, old, new):
 assert s.count(old)==1, 'Ambiguous or changed replacement: '+old[:100]
 return s.replace(old,new,1)
def build():
 content={}
 for name, expected in HASHES.items():
  raw=(BASE/name).read_bytes(); assert digest(raw)==expected, name
  content[name]=raw.decode()
 s=content['server/src/reports.js']
 s=replace_once(s,"export const REPORT_VERSION = 'llanos-reports-v48';", "export const REPORT_VERSION = 'llanos-reports-v49';")
 old="""export function localDay(value) {
  if (value === null || value === undefined || value === '') return '';
  const d = new Date(typeof value === 'string' && /^\\d+$/.test(value) ? Number(value) : value);
  if (!Number.isFinite(d.getTime())) return '';
  const p = Object.fromEntries(dateFormat.formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}"""
 new=r"""export function localDay(value) {
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
}"""
 s=replace_once(s,old,new)
 old="""function dateFor(o) {
  const event = o.estado === 'entregado' ? (o.deliveredAt || o.entregadoAt)
    : o.estado === 'cancelado' ? (o.canceladoAt || o.cancelledAt) : o.createdAt;
  const day = localDay(event);
  if (day) return { date: day, dateEstimated: false };
  const fallback = localDay(o.createdAt) || (validDay(o.day) ? o.day : '');
  return { date: fallback, dateEstimated: true };
}"""
 new="""function dateFor(o) {
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
}"""
 s=replace_once(s,old,new); content['server/src/reports.js']=s
 s=content['web/llanos-reports.js']
 s=replace_once(s,"version: 'llanos-reports-v48'", "version: 'llanos-reports-v49'")
 marker="    $('lr-all').className"
 s=replace_once(s,marker,"    if (r.history?.firstDate) html += '<p class=\"lr-hint\" id=\"lr-history-range\">Fechas disponibles en el historial seleccionado: <b>' + esc(r.history.firstDate) + ' a ' + esc(r.history.lastDate) + '</b>. El rango elegido solo muestra las que coinciden.</p>';\n"+marker)
 content['web/llanos-reports.js']=s
 content['web/gohouse-panel.html']=replace_once(content['web/gohouse-panel.html'],'/llanos-reports.js?v=20261006.48','/llanos-reports.js?v=20261006.49')
 for name,s in content.items():
  target=OUT/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(s)
  print('BUILT',name,digest(target.read_bytes()))
 # Reuse the entire existing isolated transaction, browser and Excel test suite.
 s=Path('tests/reports-history-v48.mjs').read_text()
 s="import { dateChecks, weekBrowserChecks } from './reports-dates-v49-extra.mjs';\n"+s
 s=replace_once(s,"const outDir = path.resolve('qa-reports-v48');", "const outDir = path.resolve('qa-reports-v49');")
 marker="await pool.query('CREATE TABLE app_state"
 s=replace_once(s,marker,"dateChecks({ buildReport, filters, localDay, check });\n"+marker)
 marker="  check(pageErrors.length === 0, 'No browser runtime errors: ' + pageErrors.join('; '));"
 s=replace_once(s,marker,"  await weekBrowserChecks({ page, pool, base, fixture, check, outDir, ExcelJS });\n"+marker)
 Path('tests/reports-dates-v49.mjs').write_text(s)
def manifest():
 sha=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip();entries=[]
 for name in HASHES:
  path=OUT/name;b=subprocess.check_output(['git','show',sha+':'+path.as_posix()]);assert b==path.read_bytes()
  entries.append({'path':name,'url':f'https://raw.githubusercontent.com/juansfer858/gohouse-prototipo/{sha}/{path.as_posix()}','sha256':digest(b)})
 doc={'version':'2026.10.06-white-label.49','published_at':datetime.now(timezone.utc).isoformat(),'status':'release','files':entries,'delete':[],'migrations':[]}
 Path('release/version.json').write_text(json.dumps(doc,ensure_ascii=False,indent=2)+'\n')
 print('MANIFEST',doc['version'])
if '--manifest' in sys.argv:manifest()
else:build()
