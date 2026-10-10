(() => {
  'use strict';
  if (window.LlanosReports) return;
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = n => n === null || n === undefined ? 'Por revisar' : '$' + Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 });
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const dayMinus = n => { const d = new Date(today() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const label = s => ({ entregado: 'Entregado', cancelado: 'Cancelado', nuevo: 'Buscando domiciliario', aceptado: 'Aceptado', en_destino: 'En el lugar', camino: 'En camino' })[s] || s;
  const errors = {
    REPORT_SETTLEMENT_DATES_REQUIRED: 'Para registrar una liquidación, selecciona Desde y Hasta.',
    REPORT_SETTLEMENT_FILTER_REQUIRED: 'Selecciona Todos los estados o Entregados antes de liquidar.',
    REPORT_INVALID_STATUS: 'Selecciona un estado válido.',
    REPORT_INVALID_DATES: 'Selecciona fechas válidas.', REPORT_REVERSED_DATES: 'La fecha inicial no puede ser posterior a la final.',
    REPORT_CHANGED: 'Los servicios cambiaron o alguien ya los liquidó. Actualiza y revisa el saldo antes de confirmar.',
    REPORT_MISSING_AMOUNTS: 'Hay servicios sin tarifa o comisión histórica válida. Deben revisarse antes de liquidar.',
    REPORT_NOTHING_PENDING: 'Ya no hay servicios pendientes en este rango.', REPORT_ALREADY_SETTLED: 'Algún servicio ya fue liquidado. Actualiza el informe.',
    REPORT_EMPLOYEE_NOT_ACTIVE: 'Este identificador no pertenece a un domiciliario activo. Revisa Servicios por conciliar.',
    REPORT_BUSY_RETRY: 'Hay otra operación en curso. Reintenta sin cambiar los datos.', REPORT_BATCH_TOO_LARGE: 'Selecciona un período menor (máximo 5.000 servicios por liquidación).',
    ADMIN_REQUIRED: 'Solo el administrador puede registrar una liquidación.', FORBIDDEN: 'Tu usuario no tiene permiso para esta operación.'
  };
  const friendly = e => errors[e?.message] || 'No se pudo completar la operación. Revisa la conexión e intenta de nuevo.';
  let mode = 'employee', report = null, applied = { from: '', to: '', employeeId: '', status: '' };
  let timer = null, loading = false, queued = false, sequence = 0, page = 0, busy = false, exportPromise = null;
  const api = (path, options = {}) => window.GoHouseVPS.api(path, options);
  function styles() {
    if ($('lr-style')) return;
    const s = document.createElement('style'); s.id = 'lr-style';
    s.textContent = `
      #lr-root{min-width:0}#lr-root button,#lr-root input,#lr-root select{min-height:40px}#lr-root .lr-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
      .lr-filters>div{min-width:0}.lr-filters{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) auto;gap:12px;align-items:end;padding:16px;background:var(--surface,#1e312b);border:1px solid var(--line,#33473d);border-radius:10px}
      .lr-filters label{display:block;font-size:.78rem;margin-bottom:6px}.lr-filters input,.lr-filters select{width:100%;box-sizing:border-box}.lr-tools{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
      .lr-hint{font-size:.82rem;line-height:1.5;color:var(--text-dim,#a9b8b0)}.lr-error{color:var(--red,#f18b86);padding:12px;border:1px solid currentColor;border-radius:8px;margin:12px 0}
      .lr-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:14px 0}.lr-kpi{padding:14px;background:var(--surface,#1e312b);border:1px solid var(--line,#33473d);border-radius:9px}.lr-kpi b{display:block;font-size:1.15rem;overflow-wrap:anywhere}.lr-kpi span{font-size:.78rem;color:var(--text-dim,#a9b8b0)}
      .lr-scroll{width:100%;overflow:auto;max-height:480px;border:1px solid var(--line,#33473d);border-radius:8px;margin:12px 0}.lr-table{width:100%;border-collapse:collapse;font-size:.84rem;min-width:660px}.lr-table th,.lr-table td{padding:10px;text-align:left;border-bottom:1px solid var(--line,#33473d)}.lr-table th{position:sticky;top:0;background:var(--surface,#1e312b);z-index:1;white-space:nowrap}.lr-table .lr-num{text-align:right;white-space:nowrap}
      .lr-paid{color:var(--green,#5fbf8b)}.lr-pending{color:var(--mango,#e8863a)}.lr-section{margin-top:24px}.lr-dialog{background:var(--surface,#1e312b);color:var(--text,#f3efe6);border:1px solid var(--line,#33473d);border-radius:14px;width:min(500px,calc(100vw - 48px));max-height:85vh;overflow:auto;padding:20px}.lr-dialog::backdrop{background:rgba(0,0,0,.65)}.lr-dialog label{display:block;margin:12px 0 6px}.lr-dialog input:not([type=checkbox]),.lr-dialog select{width:100%;min-height:40px;box-sizing:border-box}.lr-dialog .lr-check{display:flex;gap:10px;align-items:flex-start}.lr-dialog h3{margin:0 0 12px}.lr-dialog p{line-height:1.5}
      @media(max-width:760px){.lr-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.lr-employee-field{grid-column:1/-1}.lr-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.lr-tabs .btn{flex:1}.lr-dialog{max-height:80dvh}}
    `; document.head.appendChild(s);
  }
  function showError(message) { const n = $('lr-error'); if (n) { n.textContent = message; n.hidden = !message; } }
  function mount() {
    const host = $('vista-informes'); if (!host) return;
    styles();
    if (!$('lr-root')) {
      host.innerHTML = `<section id="lr-root"><div class="lr-tabs"><button type="button" class="btn btn-primary" id="lr-tab-employee">Liquidación empleado</button><button type="button" class="btn btn-ghost" id="lr-tab-general">Informe general</button></div>
        <div id="lr-flow-heading"><h2 class="lr-flow-title">Liquidar servicios de un empleado</h2><p class="lr-flow-intro lr-hint">Revisa primero. Solo al confirmar se registran los servicios como liquidados; consultar o exportar no mueve dinero.</p><div class="lr-steps" aria-label="Pasos para liquidar"><div class="lr-step"><b>1. Elige empleado y fechas</b><span>Define el período.</span></div><div class="lr-step"><b>2. Revisa los servicios</b><span>Solo entregados pendientes.</span></div><div class="lr-step"><b>3. Confirma y guarda</b><span>Conserva el comprobante.</span></div></div></div>
        <div class="lr-filters"><div class="lr-employee-field"><label for="lr-employee">Empleado</label><select id="lr-employee"><option value="">Todos los empleados</option></select></div><div><label for="lr-from">Desde (opcional)</label><input type="date" id="lr-from" value="${applied.from}"></div><div><label for="lr-to">Hasta (opcional)</label><input type="date" id="lr-to" value="${applied.to}"></div><button type="button" class="btn btn-primary" id="lr-query">Consultar</button></div>
        <div class="lr-tools"><button type="button" class="btn btn-primary btn-sm" id="lr-all">Todo el historial</button><button type="button" class="btn btn-ghost btn-sm" id="lr-today">Hoy</button><button type="button" class="btn btn-ghost btn-sm" id="lr-week">Últimos 7 días</button><button type="button" class="btn btn-ghost btn-sm" id="lr-month">Este mes</button><label for="lr-status" style="align-self:center">Estado</label><select id="lr-status"><option value="">Todos los estados</option><option value="entregado">Entregados</option><option value="active">Pendientes / en curso</option><option value="cancelado">Cancelados</option></select></div>
        <p class="lr-hint" id="lr-query-help">Al seleccionar un empleado se muestra todo su historial. Las fechas y el estado son filtros opcionales. Fechas inclusivas, hora de Colombia. Los servicios entregados se filtran por fecha de entrega; los cancelados, por fecha de cancelación; los abiertos, por fecha de solicitud.</p>
        <div id="lr-error" class="lr-error" role="alert" hidden></div><div id="lr-progress" class="lr-hint" role="status"></div><div id="lr-body"></div></section>`;
      $('lr-query').onclick = applyFilters;
      $('lr-from').oninput = markDraftChanged;
      $('lr-to').oninput = markDraftChanged;
      $('lr-all').onclick = allHistory;
      $('lr-status').onchange = applyFilters;
      $('lr-today').onclick = () => preset(today(), today());
      $('lr-week').onclick = () => preset(dayMinus(6), today());
      $('lr-month').onclick = () => preset(today().slice(0, 8) + '01', today());
      $('lr-tab-employee').onclick = () => setMode('employee');
      $('lr-tab-general').onclick = () => setMode('general');
      $('lr-employee').onchange = allHistory;
      load();
    } else if (!busy) { clearTimeout(timer); timer = setTimeout(load, 500); }
  }
  function setMode(next) { mode = next; page = 0; render(); }
  function preset(from, to) { $('lr-from').value = from; $('lr-to').value = to; applyFilters(); }
  function periodLabel(filter) {
    return filter.from && filter.to ? filter.from + ' a ' + filter.to
      : filter.from ? 'Desde ' + filter.from : filter.to ? 'Hasta ' + filter.to : 'Todo el historial';
  }
  function allHistory() {
    $('lr-from').value = ''; $('lr-to').value = ''; $('lr-status').value = '';
    applyFilters();
  }
  function applyFilters() {
    const from = $('lr-from').value, to = $('lr-to').value;
    if (from && to && from > to) { showError('Selecciona un rango válido: Desde debe ser anterior o igual a Hasta.'); return; }
    applied = { from, to, employeeId: $('lr-employee').value, status: $('lr-status').value }; page = 0; report = null; showError(''); $('lr-body').innerHTML = ''; sequence++; load();
  }
  async function load() {
    if (busy || reviewOpen) return;
    if (loading) { queued = true; return; }
    loading = true; const seq = ++sequence, filter = { ...applied };
    if ($('lr-progress')) $('lr-progress').textContent = 'Actualizando informe…';
    try {
      const out = await api('/reports/summary?' + new URLSearchParams(filter));
      if (seq !== sequence) return;
      report = normalizeUnmatchedReport(out); showError('');
      const select = $('lr-employee');
      if (select) {
        const signature = JSON.stringify(out.employees);
        if (select.dataset.signature !== signature) {
          select.innerHTML = '<option value="">Todos los empleados</option>' + currentEmployeeRows(report).map(e => `<option value="${esc(e.id)}">${esc(e.name)}${e.archived ? ' · retirado' : ''}${Number.isInteger(e.historyCount) ? ' · ' + e.historyCount + ' servicios' : ''}</option>`).join('');
          select.dataset.signature = signature;
        }
        select.value = applied.employeeId;
      }
      render();
    } catch (e) { if (seq === sequence) showError(friendly(e)); }
    finally {
      loading = false; if ($('lr-progress')) $('lr-progress').textContent = '';
      if (queued) { queued = false; load(); }
    }
  }
  function table(headers, rows) {
    if (!rows.length) return '<div class="empty">Sin registros para esta consulta.</div>';
    return '<div class="lr-scroll"><table class="lr-table"><thead><tr>' + headers.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(v => '<td>' + v + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  }
  function kpis(s) {
    return `<div class="lr-kpis">${[[s.orders, 'Total de servicios'], [s.active, 'Pendientes / en curso'], [s.services, 'Servicios entregados'], [money(s.fare), 'Valor de domicilios'], [money(s.company), 'Comisión empresa'], [money(s.earnings), 'Ganancia empleado(s)'], [s.pendingCount, 'Servicios pendientes de liquidar'], [money(s.pendingAmount), 'Pendiente de liquidación'], [money(s.settledAmount), 'Ya liquidado'], [s.cancelled, 'Pedidos cancelados (sin ingreso)']].map(([v, l]) => `<div class="lr-kpi"><b>${esc(v)}</b><span>${l}</span></div>`).join('')}</div>`;
  }
  // V51: show only registered drivers in the settlement roster.
    // Never modify orders, historical amounts or settled records while reporting.
    let reconciliationDetailId = null;
  function legacyEmployeeLabel(value, id) {
  const v = String(value ?? '');
  return /^Empleado retirado\s*\([a-f\d-]{20,}\)$/i.test(v) ? 'Sin vínculo comprobado (' + String(id || 'sin ID') + ')' : v;
}
  function normalizeUnmatchedReport(r) {
  (r.employees || []).forEach(e => { if (e.archived) e.name = legacyEmployeeLabel(e.name, e.id); });
  (r.byEmployee || []).forEach(e => { e.name = legacyEmployeeLabel(e.name, e.id); });
  (r.rows || []).forEach(o => { o.employee = legacyEmployeeLabel(o.employee, o.employeeId); });
  return r;
}
  function currentEmployeeRows(r) {
  const totals = new Map((r.byEmployee || []).map(e => [e.id, e]));
  return (r.employees || []).filter(e => e.id && !e.archived).map(e => ({
    orders: 0, services: 0, pendingCount: 0, pendingAmount: 0, settledCount: 0,
    settledAmount: 0, fare: 0, company: 0, earnings: 0, missingAmounts: 0,
    ...(totals.get(e.id) || {}), id: e.id, name: e.name, historyCount: e.historyCount
  }));
}
  function unlinkedEmployeeRows(r) {
  const activeIds = new Set(currentEmployeeRows(r).map(e => e.id));
  return (r.byEmployee || []).filter(e => !activeIds.has(e.id));
}
  function reconciliationSection(r) {
  const groups = unlinkedEmployeeRows(r);
  if (!groups.length || r.filter.employeeId) return '';
  const count = groups.reduce((n, e) => n + Number(e.pendingCount || 0), 0);
  const amount = groups.reduce((n, e) => n + Math.round(Number(e.pendingAmount || 0) * 100), 0) / 100;
  let html = '<details class="lr-details" id="lr-unmatched"><summary>Servicios por conciliar (' + groups.length + ' referencias, ' + count + ' entregados pendientes · ' + money(amount) + ')</summary>';
  html += '<p class="lr-hint">Estos pedidos no coinciden con los identificadores de los domiciliarios actuales. No son necesariamente empleados retirados. No se reasignan ni liquidan automáticamente. Verifica su identidad antes de asociarlos. El Excel general conserva estos registros.</p>';
  html += table(['Referencia original', 'Entregados', 'Pendientes', 'Monto pendiente', 'Ya liquidado', 'Revisión'],
    groups.map(e => [esc(e.id || 'Sin identificador'), esc(e.services), esc(e.pendingCount),
      '<span class="lr-pending">' + money(e.pendingAmount) + '</span>', money(e.settledAmount),
      '<button class="btn btn-ghost btn-sm" type="button" data-lr-unmatched="' + esc(e.id || '') + '">Ver pedidos</button>']));
  if (reconciliationDetailId !== null && groups.some(e => String(e.id || '') === reconciliationDetailId)) {
    const detail = (r.rows || []).filter(o => String(o.employeeId || '') === reconciliationDetailId);
    html += '<div class="lr-flow-note warning" id="lr-unmatched-review"><b>Consulta de servicios sin vínculo: ' + esc(reconciliationDetailId || 'Sin identificador') + '</b><p>Solo consulta; no se modifican empleados, servicios ni pagos. ' + detail.length + ' registros del período consultado.</p></div>';
    html += table(['Pedido', 'Fecha', 'Estado', 'Cliente / referencia', 'Domicilio', 'Parte domiciliario', 'Liquidación'],
      detail.slice(0, 100).map(o => [esc(o.number), esc(o.date || 'Sin fecha') + (o.dateEstimated ? ' · estimada' : ''),
        esc(label(o.status)), esc(o.client) + '<small> · ' + esc(o.zone || o.address) + '</small>',
        money(o.fare), o.valid ? money(o.earnings) : 'Por revisar',
        o.status !== 'entregado' ? 'No aplica' : !o.valid ? 'Importe por revisar' : o.settled ? 'Liquidado' : 'Pendiente']));
    if (detail.length > 100) html += '<p class="lr-hint">Primeros 100 servicios. Exporta el informe general para revisar todos.</p>';
  }
  return html + '</details>';
}
  function bindReconciliation(body) {
  body.querySelectorAll('[data-lr-unmatched]').forEach(b => {
    b.onclick = () => {
      reconciliationDetailId = b.dataset.lrUnmatched;
      render();
      if ($('lr-unmatched')) $('lr-unmatched').open = true;
    };
  });
}
  // V50: presentation only; financial truth and authorization stay in the V49 API.
  let reviewOpen = false, lastSettlement = null, uncertainAttempt = null;
  const cents = value => Math.round(Number(value || 0) * 100);
  const rowTotal = (rows, key) => rows.reduce((n, row) => n + cents(row[key]), 0) / 100;
  const dayLabel = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('/') : 'Sin fecha registrada';
  const employeeLabel = r => r.employees.find(e => e.id === r.filter.employeeId)?.name || r.filter.employeeId || 'Todos los empleados';
  function filterKey(f) { return JSON.stringify([f.from || '', f.to || '', f.employeeId || '', f.status || '']); }
  function draftMatches() {
    return !!report && filterKey(report.filter) === filterKey({from: $('lr-from')?.value, to: $('lr-to')?.value, employeeId: $('lr-employee')?.value, status: $('lr-status')?.value});
  }
  function settlementRows(r) {
    const ids = new Set(r.pendingIds || []);
    return r.rows.filter(row => ids.has(row.id));
  }
  function settlementBlocker(r) {
    if (!r?.filter.employeeId) return 'Selecciona un solo empleado para preparar su liquidación.';
    if (!(r.employees || []).some(e => e.id === r.filter.employeeId && !e.archived)) return 'Esta referencia no corresponde a un domiciliario registrado. Solo puede revisarse en Servicios por conciliar.';
    if (!r.canSettle) return 'Tu usuario puede consultar y exportar. Solo el administrador registra liquidaciones.';
    if (!r.filter.from || !r.filter.to) return 'Elige Desde y Hasta y pulsa Revisar servicios. Todo el historial sirve para consultar, no para liquidar de una vez.';
    if (r.filter.status && r.filter.status !== 'entregado') return 'Selecciona Todos los estados o Entregados para revisar una liquidación.';
    if (r.summary.missingAmounts) return 'Hay servicios con importes históricos por revisar. No se puede registrar esta liquidación todavía.';
    const rows = settlementRows(r);
    if (!rows.length) return 'No hay servicios entregados pendientes de liquidar en estas fechas.';
    if (rows.length > 5000) return 'Reduce el período: cada liquidación permite hasta 5.000 servicios.';
    if (rows.length !== r.summary.pendingCount || rows.some(x => x.employeeId !== r.filter.employeeId || x.status !== 'entregado' || x.settled || !x.valid) || cents(rowTotal(rows, 'earnings')) !== cents(r.summary.pendingAmount)) return 'El detalle no coincide con el resumen. Vuelve a consultar antes de continuar.';
    if (!r.canSettleSelection) return 'La selección todavía no está lista para liquidar. Revisa el empleado y las fechas.';
    return '';
  }
  function flowStyles() {
    if ($('lr-flow-style')) return;
    const style = document.createElement('style'); style.id = 'lr-flow-style';
    style.textContent = `
      #lr-root .lr-flow-title{margin:0 0 8px;font-size:1.35rem}#lr-root .lr-flow-intro{margin:0 0 16px;max-width:850px;line-height:1.5}
      .lr-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:14px 0 18px}.lr-step{padding:11px 12px;border:1px solid var(--line,#33473d);border-radius:8px;font-size:.83rem;line-height:1.4}.lr-step b{display:block}.lr-step.current{border-color:var(--mango,#e8863a);background:rgba(232,134,58,.08)}
      .lr-flow-card{padding:22px;border:1px solid var(--line,#33473d);background:var(--surface,#1e312b);border-radius:12px;margin:18px 0}.lr-flow-card h2,.lr-flow-card h3{margin:0 0 9px}.lr-flow-card p{line-height:1.5}.lr-flow-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}.lr-flow-heading h2{font-size:1.14rem}.lr-flow-heading p{margin:0}.lr-count-pill{padding:7px 10px;border:1px solid var(--line,#33473d);border-radius:8px;white-space:nowrap;font-size:.82rem}
      .lr-breakdown{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:20px 0 12px}.lr-breakdown>div{padding:14px 16px;background:rgba(0,0,0,.13);border-radius:9px;min-width:0}.lr-breakdown span{display:block;font-size:.82rem;line-height:1.4;color:var(--text-dim,#a9b8b0)}.lr-breakdown b{display:block;margin-top:7px;font-size:1.45rem;overflow-wrap:anywhere}.lr-breakdown .lr-employee-amount{border:1px solid var(--mango,#e8863a)}.lr-employee-amount b{color:var(--mango,#e8863a)}
      .lr-excluded{display:flex;flex-wrap:wrap;gap:8px 20px;padding:11px 0;font-size:.82rem;color:var(--text-dim,#a9b8b0)}.lr-excluded b{color:var(--text,#f3efe6)}.lr-reconcile{padding:12px 14px;border-left:3px solid var(--mango,#e8863a);background:rgba(232,134,58,.06);line-height:1.5;font-size:.84rem;margin:12px 0 16px}.lr-flow-note{padding:11px 13px;border:1px solid var(--line,#33473d);border-radius:8px;line-height:1.5;font-size:.84rem;margin:12px 0}.lr-flow-note.warning{border-color:var(--mango,#e8863a)}
      #lr-root details.lr-details{border:1px solid var(--line,#33473d);border-radius:9px;padding:12px 14px;margin:14px 0}#lr-root details.lr-details>summary{cursor:pointer;font-weight:600;line-height:1.5}#lr-root details.lr-details[open]>summary{margin-bottom:12px}.lr-flow-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:16px}.lr-flow-actions .btn{min-height:44px}.lr-flow-actions small{font-size:.8rem;color:var(--text-dim,#a9b8b0)}
      #lr-root .lr-success{border:1px solid var(--green,#5fbf8b);border-radius:12px;padding:20px;background:rgba(95,191,139,.08);margin:18px 0}.lr-success h2{margin:0 0 8px}.lr-success p{line-height:1.5;margin:8px 0}.lr-success code{overflow-wrap:anywhere}.lr-flow-wait{padding:24px;border:1px dashed var(--line,#33473d);border-radius:10px;margin:16px 0;line-height:1.6}
      #lr-dialog.lr-dialog{width:min(620px,calc(100vw - 48px));max-height:85dvh;box-sizing:border-box}#lr-dialog .lr-breakdown{grid-template-columns:1fr;margin:12px 0;gap:7px}#lr-dialog .lr-breakdown>div{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 12px}#lr-dialog .lr-breakdown b{font-size:1.13rem;margin:0}#lr-dialog .lr-check{padding:10px 0;font-size:.9rem;line-height:1.45}#lr-dialog input[type=checkbox]{width:19px;height:19px;flex-shrink:0;margin:2px 0 0}#lr-dialog .lr-check span{display:block}
      #lr-root [hidden],#lr-dialog [hidden]{display:none!important}#lr-root .btn:disabled,#lr-dialog button:disabled{opacity:.48;cursor:not-allowed}
      @media(max-width:760px){.lr-steps{grid-template-columns:1fr;gap:6px}.lr-step b{display:inline}.lr-step span{margin-left:6px}.lr-flow-card{padding:16px}.lr-flow-heading{display:block}.lr-count-pill{display:inline-block;margin-top:10px}.lr-breakdown{grid-template-columns:1fr;gap:8px}.lr-breakdown>div{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:12px}.lr-breakdown b{margin:0;font-size:1.2rem}.lr-flow-actions .btn{width:100%}#lr-dialog.lr-dialog{padding:16px;width:calc(100vw - 24px)}.lr-flow-heading p{overflow-wrap:anywhere}}
    `; document.head.appendChild(style);
  }
  function updateFlowShell() {
    const employee = mode === 'employee';
    $('lr-tab-employee').className = 'btn ' + (employee ? 'btn-primary' : 'btn-ghost');
    $('lr-tab-general').className = 'btn ' + (employee ? 'btn-ghost' : 'btn-primary');
    if ($('lr-flow-heading')) $('lr-flow-heading').hidden = !employee;
    if ($('lr-query')) $('lr-query').textContent = employee ? 'Revisar servicios' : 'Consultar';

    const fromLabel = document.querySelector('label[for="lr-from"]'), toLabel = document.querySelector('label[for="lr-to"]');
    if (fromLabel) fromLabel.textContent = employee ? 'Desde (liquidación)' : 'Desde (opcional)';
    if (toLabel) toLabel.textContent = employee ? 'Hasta (liquidación)' : 'Hasta (opcional)';
    if ($('lr-query-help')) $('lr-query-help').textContent = employee
      ? 'Sin fechas: consulta del historial. Para liquidar: elige Desde y Hasta y revisa los servicios entregados pendientes.'
      : 'Fechas inclusivas, hora de Colombia. Entregados: fecha de entrega; cancelados: fecha de cancelación; abiertos: fecha de solicitud.';
    const step = lastSettlement?.employee_id === report?.filter.employeeId ? 2 : report?.filter.employeeId && report.filter.from && report.filter.to ? 1 : 0;
    document.querySelectorAll('.lr-steps .lr-step').forEach((el, i) => el.classList.toggle('current', i === step));

  }
  function markDraftChanged() {
    if (!report || draftMatches()) { if (report) render(); return; }
    showError('Cambiaste las fechas. Pulsa Revisar servicios para recalcular antes de liquidar.');
    const button = $('lr-settle'); if (button) button.disabled = true;
    const dirty = $('lr-draft-note'); if (dirty) dirty.hidden = false;
  }
  function monetaryBreakdown(rows) {
    return `<div class="lr-breakdown"><div><span>Valor de los domicilios incluidos</span><b>${money(rowTotal(rows, 'fare'))}</b></div><div><span>Menos: parte de la empresa</span><b>${money(rowTotal(rows, 'company'))}</b></div><div class="lr-employee-amount"><span>Corresponde al empleado</span><b>${money(rowTotal(rows, 'earnings'))}</b></div></div>`;
  }
  function availableDates(r) {
    if (!r.history?.firstDate) return '<p class="lr-hint">No se encontraron fechas válidas en el historial disponible de esta cuenta.</p>';
    const first = dayLabel(r.history.firstDate), last = dayLabel(r.history.lastDate);
    return `<p class="lr-hint">Historial disponible para esta cuenta: <b>${esc(first === last ? first : first + ' a ' + last)}</b>. Fechas consultadas: ${esc(periodLabel(r.filter))}.</p>`;
  }
  function receiptHistory(r) {
    return '<h3 class="lr-section">Liquidaciones registradas</h3><p class="lr-hint">Estos servicios ya fueron liquidados. Abre el comprobante; no vuelvas a pagarlos. Se muestran hasta 100 liquidaciones del empleado y período consultados.</p>' + table(['Fecha de registro', 'Empleado', 'Desde / hasta', 'Servicios', 'Valor empleado', 'Cómo se liquidó', 'Comprobante'], r.settlements.map(x => [esc(new Date(x.created_at).toLocaleString('es-CO', {timeZone:'America/Bogota'})), esc(x.employee_name), esc(dayLabel(String(x.date_from).slice(0,10)) + ' – ' + dayLabel(String(x.date_to).slice(0,10))), x.service_count, money(x.employee_amount), esc(x.payment_method), `<button class="btn btn-ghost btn-sm" type="button" data-lr-receipt="${esc(x.id)}">Descargar Excel</button>`]));
  }
  function render() {
    if (!$('lr-root')) return;
    flowStyles(); updateFlowShell();
    if (mode === 'general') { renderGeneral(); updateFlowShell(); return; }
    if (!report) return;
    const r = report, s = r.summary, name = employeeLabel(r), chosen = !!r.filter.employeeId;
    const included = settlementRows(r), blocker = settlementBlocker(r), fresh = draftMatches();
    let html = '';
    if (uncertainAttempt) html += '<div class="lr-error" role="alert">Hay un registro cuya respuesta no se confirmó. No repitas el pago.<div class="lr-tools"><button type="button" class="btn btn-primary" id="lr-resume">Comprobar el mismo registro</button></div></div>';
    if (lastSettlement && lastSettlement.employee_id === r.filter.employeeId) {
      const x = lastSettlement;
      html += `<section class="lr-success" role="status"><h2>3 · Liquidación registrada</h2><p><b>${esc(x.employee_name)}</b> · ${esc(dayLabel(String(x.date_from).slice(0,10)))} a ${esc(dayLabel(String(x.date_to).slice(0,10)))}</p><p><b>${Number(x.service_count)} servicios</b> · Participación del empleado: <b>${money(x.employee_amount)}</b><br>Cómo se liquidó: ${esc(x.payment_method)}${x.payment_reference ? ' · ' + esc(x.payment_reference) : ''}</p><p class="lr-hint">Registro: <code>${esc(x.id)}</code>. Guardar este comprobante no realizó una transferencia.</p><div class="lr-flow-actions"><button class="btn btn-primary" type="button" data-lr-receipt="${esc(x.id)}">Descargar comprobante Excel</button><button class="btn btn-ghost" type="button" id="lr-another">Elegir otro empleado</button></div></section>`;
    }
    if (!chosen) {
      html += '<div class="lr-flow-wait"><b>Selecciona un domiciliario activo.</b><br>La lista muestra únicamente personal registrado. Los servicios sin vincular están separados abajo. Arriba selecciona un empleado. Puedes consultar todo su historial; para registrar una liquidación debes elegir un período.</div>';
      html += table(['Domiciliario activo', 'Entregados', 'Pendiente de liquidación', 'Ya liquidado', 'Acción'], currentEmployeeRows(r).map(e => [esc(e.name), e.services, money(e.pendingAmount), money(e.settledAmount), `<button class="btn btn-ghost btn-sm" type="button" data-lr-employee="${esc(e.id)}">Revisar empleado</button>`]));
      html += reconciliationSection(r);
    } else {
      html += `<section class="lr-flow-card" aria-labelledby="lr-review-title"><div class="lr-flow-heading"><div><h2 id="lr-review-title">2 · Revisa la liquidación de ${esc(name)}</h2><p>${esc(periodLabel(r.filter))}</p></div><span class="lr-count-pill">${included.length} servicios pendientes incluidos</span></div>`;
      html += `<p id="lr-history-count" class="lr-hint">Mostrando ${r.rows.length} de ${r.history?.total ?? r.rows.length} registros del historial · ${r.filter.status ? esc(r.filter.status === 'active' ? 'Pendientes / en curso' : label(r.filter.status)) : 'Todos los estados'}.</p>` + availableDates(r);
      html += `<div id="lr-draft-note" class="lr-flow-note warning" ${fresh ? 'hidden' : ''}>Las fechas de arriba cambiaron. Este resumen aún corresponde a la consulta anterior. Pulsa Revisar servicios.</div>`;
      if (blocker) html += `<div class="lr-flow-note ${included.length || s.missingAmounts ? 'warning' : ''}" id="lr-blocker">${esc(blocker)}</div>`;
      html += monetaryBreakdown(included);
      html += `<div class="lr-excluded"><span>Ya liquidados: <b>${s.settledCount} servicios · ${money(s.settledAmount)}</b></span><span>Cancelados: <b>${s.cancelled}</b></span><span>Pendientes / en curso: <b>${s.active}</b></span></div><p class="lr-hint">Los valores de arriba corresponden únicamente a servicios entregados y pendientes de liquidar. No incluyen compras ni servicios ya liquidados.</p>`;
      html += '<div class="lr-reconcile"><b>Liquidar no siempre significa transferir este valor.</b> Si el domiciliario cobró dinero al cliente, primero concilien cuánto debe entregar o recibir cada uno. Este módulo no descuenta automáticamente cobros, anticipos ni gastos.</div>';
      if (r.estimatedDates || r.undatedOrders || s.missingAmounts) html += `<p class="lr-flow-note warning">${r.estimatedDates ? `${r.estimatedDates} registros usan fecha estimada; revísala antes de confirmar. ` : ''}${r.undatedOrders ? `${r.undatedOrders} registros sin fecha válida ${r.allTime ? 'están visibles en el historial' : 'no entran en este rango; consúltalos en Todo el historial'}. ` : ''}${s.missingAmounts ? `${s.missingAmounts} servicios requieren revisar sus importes históricos.` : ''}</p>`;
      const days = [...new Set(included.map(o => o.date).filter(Boolean))];
      if (r.filter.from && r.filter.to && r.filter.from !== r.filter.to && days.length === 1) html += `<p class="lr-flow-note warning">En el período elegido, los servicios pendientes encontrados están fechados solo el <b>${esc(dayLabel(days[0]))}</b>. Confirma que ese es el alcance que deseas liquidar.</p>`;
      html += '<details class="lr-details" id="lr-included"><summary>Ver los servicios que se van a liquidar (' + included.length + ')</summary>' + table(['Pedido', 'Fecha', 'Domicilio', 'Empresa', 'Empleado'], included.slice(0,100).map(o => [esc(o.number), esc(dayLabel(o.date)) + (o.dateEstimated ? ' · estimada' : ''), money(o.fare), money(o.company), money(o.earnings)])) + (included.length > 100 ? '<p class="lr-hint">Primeros 100 servicios incluidos. El detalle del historial y el Excel permiten revisar el resto.</p>' : '') + '</details>';
      html += `<div class="lr-flow-actions"><button type="button" class="btn btn-primary" id="lr-settle" ${blocker || !fresh || uncertainAttempt ? 'disabled' : ''}>3 · Revisar y confirmar</button><small>Abrir la revisión no registra pagos ni cambia servicios.</small></div></section>`;
    }
    html += '<div class="lr-tools"><button type="button" class="btn btn-ghost" id="lr-export">Exportar consulta a Excel</button></div>';
    html += '<details class="lr-details" id="lr-history-details"><summary>Consultar detalle de servicios e informe por día</summary><p class="lr-hint">Este historial incluye todos los estados de la consulta. No es la lista de pagos a realizar.</p>';
    html += '<h3>Servicios por día</h3>' + table(['Fecha', 'Entregados', 'Cancelados', 'En curso', 'Domicilios', 'Empresa', 'Empleado', 'Pendiente'], r.byDay.map(d => [esc(dayLabel(d.date)), d.services, d.cancelled, d.active, money(d.fare), money(d.company), money(d.earnings), money(d.pendingAmount)]));
    const detail = r.rows, maxPage = Math.max(0, Math.ceil(detail.length / 50) - 1); page = Math.min(page, maxPage);
    html += '<h3>Detalle de todos los servicios</h3>' + table(['Pedido', 'Fecha', 'Empleado', 'Estado', 'Cliente / referencia', 'Pago', 'Domicilio', 'Empresa', 'Empleado', 'Liquidación'], detail.slice(page*50,page*50+50).map(o => [esc(o.number), esc(dayLabel(o.date)) + (o.date && o.dateEstimated ? ' *' : ''), esc(o.employee), esc(label(o.status)), esc(o.client) + '<br><small>' + esc(o.zone || o.address) + '</small>', esc(o.payment), money(o.fare), o.status === 'entregado' ? money(o.company) : '—', o.status === 'entregado' ? money(o.earnings) : '—', o.status !== 'entregado' ? 'No aplica' : !o.valid ? 'Revisar valores' : o.settled ? '<span class="lr-paid">Liquidado</span>' : '<span class="lr-pending">Pendiente</span>']));
    if (detail.length > 50) html += `<div class="lr-tools"><button type="button" class="btn btn-ghost" id="lr-prev" ${page === 0 ? 'disabled' : ''}>Anterior</button><span>Página ${page+1} de ${maxPage+1} · ${detail.length} registros. Excel incluye todos.</span><button type="button" class="btn btn-ghost" id="lr-next" ${page === maxPage ? 'disabled' : ''}>Siguiente</button></div>`;
    html += '</details>' + receiptHistory(r);
    const opened = [...document.querySelectorAll('#lr-body details[open]')].map(x => x.id);
    $('lr-body').innerHTML = html; opened.forEach(id => { if ($(id)) $(id).open = true; });
    $('lr-all').className = 'btn btn-sm ' + (!r.filter.from && !r.filter.to && !r.filter.status ? 'btn-primary' : 'btn-ghost');
    $('lr-export').onclick = () => exportReport(r, 'Consulta de servicios');
    if ($('lr-settle')) $('lr-settle').onclick = () => preview(r);
    if ($('lr-resume')) $('lr-resume').onclick = () => preview(uncertainAttempt.report, uncertainAttempt);
    if ($('lr-another')) $('lr-another').onclick = () => { lastSettlement = null; $('lr-employee').value = ''; allHistory(); $('lr-employee').focus(); };
    $('lr-body').querySelectorAll('[data-lr-employee]').forEach(b => { b.onclick = () => openEmployee(b.dataset.lrEmployee); });
    bindReconciliation($('lr-body'));
    if (reconciliationDetailId !== null && $('lr-unmatched')) $('lr-unmatched').open = true;
    $('lr-body').querySelectorAll('[data-lr-receipt]').forEach(b => { b.onclick = () => exportReceipt(b.dataset.lrReceipt, r); });
    if ($('lr-prev')) $('lr-prev').onclick = () => { page--; render(); };
    if ($('lr-next')) $('lr-next').onclick = () => { page++; render(); };
  }

  function renderGeneral() {
    if (!$('lr-root')) return;
    $('lr-tab-employee').className = 'btn ' + (mode === 'employee' ? 'btn-primary' : 'btn-ghost');
    $('lr-tab-general').className = 'btn ' + (mode === 'general' ? 'btn-primary' : 'btn-ghost');
    if (!report) return;
    const r = report, s = r.summary;
    const employee = r.employees.find(e => e.id === r.filter.employeeId)?.name || 'Todos los empleados';
    const chosen = !!r.filter.employeeId;
    let html = `<h2>${mode === 'employee' ? 'Liquidación empleado' : 'Informe general'}</h2><p><b>${esc(employee)}</b> · ${esc(periodLabel(r.filter))}</p><p class="lr-hint" id="lr-history-count">Mostrando ${r.rows.length} de ${r.history?.total ?? r.rows.length} registros del historial${r.filter.status ? ' · Estado: ' + esc(r.filter.status === 'active' ? 'Pendientes / en curso' : label(r.filter.status)) : ' · Todos los estados'}.</p>${kpis(s)}`;
    if (r.history?.firstDate) html += '<p class="lr-hint" id="lr-history-range">Fechas disponibles en el historial seleccionado: <b>' + esc(r.history.firstDate) + ' a ' + esc(r.history.lastDate) + '</b>. El rango elegido solo muestra las que coinciden.</p>';
    $('lr-all').className = 'btn btn-sm ' + (!r.filter.from && !r.filter.to && !r.filter.status ? 'btn-primary' : 'btn-ghost');
    if (s.missingAmounts || r.estimatedDates || r.undatedOrders) html += `<div class="lr-error">${s.missingAmounts ? esc(s.missingAmounts) + ' servicio(s) con valores históricos por revisar; no se liquidan ni se recalculan con el porcentaje actual. ' : ''}${r.estimatedDates ? esc(r.estimatedDates) + ' registro(s) usan fecha estimada de solicitud. ' : ''}${r.undatedOrders ? esc(r.undatedOrders) + (r.allTime ? ' pedido(s) sin fecha válida se muestran en el historial; no se asigna una fecha inventada.' : ' pedido(s) sin fecha válida quedaron fuera de estas fechas; puedes verlos en Todo el historial.') : ''}</div>`;
    html += `<div class="lr-tools"><button type="button" class="btn btn-ghost" id="lr-export">Exportar a Excel</button>${mode === 'employee' ? `<button type="button" class="btn btn-primary" id="lr-settle" ${!r.canSettle || !r.canSettleSelection ? 'disabled' : ''}>Liquidar pendientes del período</button>` : ''}</div>`;
    if (mode === 'employee' && !chosen) html += '<p class="lr-hint">Elige un empleado arriba o pulsa su nombre en la tabla para revisar y liquidar sus servicios.</p>';
    if (mode === 'employee' && (!r.filter.from || !r.filter.to)) html += '<p class="lr-hint">Para registrar una liquidación, elige Desde y Hasta y pulsa Consultar. Ver todo el historial o exportarlo no registra pagos.</p>';
    if (r.history?.total && r.rows.length === 0) html += '<p class="lr-hint">Este empleado sí tiene historial, pero no coincide con estos filtros. Pulsa Todo el historial para verlo completo.</p>';
    if (mode === 'employee' && !r.canSettle) html += '<p class="lr-hint">Puedes consultar y exportar. Solo el administrador registra el pago.</p>';
    html += '<p class="lr-hint">Esto liquida servicios realizados, no una liquidación laboral. Compras, anticipos y gastos no se descuentan del saldo automáticamente. Registrar una liquidación no hace una transferencia bancaria.</p>';
    const employeeRows = currentEmployeeRows(r).map(e => [`<button type="button" class="btn btn-ghost btn-sm" data-lr-employee="${esc(e.id)}">${esc(e.name)}</button>`, esc(e.services), money(e.fare), money(e.company), money(e.earnings), `<span class="lr-pending">${money(e.pendingAmount)}</span>`, `<span class="lr-paid">${money(e.settledAmount)}</span>`]);
    if (!chosen || mode === 'general') html += '<h3 class="lr-section">Por domiciliario activo</h3>' + table(['Empleado', 'Entregados', 'Domicilios', 'Empresa', 'Empleado', 'Pendiente', 'Liquidado'], employeeRows);
    if (!chosen || mode === 'general') {
      if (unlinkedEmployeeRows(r).length) html += '<p class="lr-hint">El informe general incluye también servicios sin vínculo identificado. No están atribuidos a los domiciliarios activos y se revisan por separado.</p>';
      html += reconciliationSection(r);
    }
    html += '<h3 class="lr-section">Servicios por día</h3>' + table(['Fecha', 'Entregados', 'Cancelados', 'Activos', 'Domicilios', 'Empresa', 'Empleado', 'Pendiente'], r.byDay.map(d => [esc(d.date || 'Sin fecha registrada'), d.services, d.cancelled, d.active, money(d.fare), money(d.company), money(d.earnings), money(d.pendingAmount)]));
    if (mode === 'general') html += '<h3 class="lr-section">Métodos de pago registrados</h3><p class="lr-hint">No acredita recepción de dinero. Compras separadas: ' + money(s.purchases) + '.</p>' + table(['Método', 'Entregados', 'Domicilios', 'Compras', 'Comisión empresa'], r.byPayment.map(p => [esc(p.method), p.services, money(p.fare), money(p.purchases), money(p.company)]));
    const detail = r.rows;
    const maxPage = Math.max(0, Math.ceil(detail.length / 50) - 1); page = Math.min(page, maxPage);
    html += '<h3 class="lr-section">Detalle de todos los servicios</h3>' + table(['Pedido', 'Fecha', 'Empleado', 'Estado', 'Cliente / referencia', 'Pago', 'Domicilio', 'Empresa', 'Empleado', 'Liquidación'], detail.slice(page * 50, page * 50 + 50).map(o => [esc(o.number), esc(o.date || 'Sin fecha registrada') + (o.date && o.dateEstimated ? ' *' : ''), esc(o.employee), esc(label(o.status)), esc(o.client) + '<br><small>' + esc(o.zone || o.address) + '</small>', esc(o.payment), money(o.fare), o.status === 'entregado' ? money(o.company) : '—', o.status === 'entregado' ? money(o.earnings) : '—', o.status !== 'entregado' ? 'No aplica' : !o.valid ? 'Revisar valores' : o.settled ? '<span class="lr-paid">Liquidado</span>' : '<span class="lr-pending">Pendiente</span>']));
    if (detail.length > 50) html += `<div class="lr-tools"><button type="button" class="btn btn-ghost" id="lr-prev" ${page === 0 ? 'disabled' : ''}>Anterior</button><span>Página ${page + 1} de ${maxPage + 1} · ${detail.length} registros. Excel incluye todos.</span><button type="button" class="btn btn-ghost" id="lr-next" ${page === maxPage ? 'disabled' : ''}>Siguiente</button></div>`;
    html += '<h3 class="lr-section">Liquidaciones registradas</h3><p class="lr-hint">Últimas 100 liquidaciones del empleado; las fechas limitan el período solo cuando las seleccionas. Los pagos anteriores sin comprobante se respetan en el detalle como liquidados.</p>' + table(['Registro', 'Empleado', 'Período', 'Servicios', 'Valor empleado', 'Pago', 'Comprobante'], r.settlements.map(x => [esc(String(x.created_at).slice(0, 10)), esc(x.employee_name), esc(String(x.date_from).slice(0, 10) + ' a ' + String(x.date_to).slice(0, 10)), x.service_count, money(x.employee_amount), esc(x.payment_method), `<button class="btn btn-ghost btn-sm" type="button" data-lr-receipt="${esc(x.id)}">Excel</button>`]));
    const body = $('lr-body'); body.innerHTML = html;
    $('lr-export').onclick = () => exportReport(r, mode === 'employee' ? 'Liquidacion empleado' : 'Informe general');
    if ($('lr-settle')) $('lr-settle').onclick = () => preview(r);
    body.querySelectorAll('[data-lr-employee]').forEach(b => { b.onclick = () => openEmployee(b.dataset.lrEmployee); });
    bindReconciliation(body);
    if (reconciliationDetailId !== null && $('lr-unmatched')) $('lr-unmatched').open = true;
    body.querySelectorAll('[data-lr-receipt]').forEach(b => { b.onclick = () => exportReceipt(b.dataset.lrReceipt, r); });
    if ($('lr-prev')) $('lr-prev').onclick = () => { page--; render(); };
    if ($('lr-next')) $('lr-next').onclick = () => { page++; render(); };
  }
  function openEmployee(id) {
    if (id && !(report?.employees || []).some(e => e.id === id && !e.archived)) { showError('La referencia no pertenece a un domiciliario activo. Consúltala en Servicios por conciliar.'); return; }
    mount(); mode = 'employee'; if ($('lr-employee')) $('lr-employee').value = id || ''; allHistory();
  }
  async function preview(previous, resume = null) {
    if (reviewOpen || busy) return;
    if (!resume && (!draftMatches() || settlementBlocker(previous) || uncertainAttempt)) {
      showError('Primero revisa el empleado, las fechas y los servicios de la consulta vigente.'); return;
    }
    reviewOpen = true; clearTimeout(timer);
    const dialog = document.createElement('dialog'); dialog.className = 'lr-dialog'; dialog.id = 'lr-dialog';
    dialog.setAttribute('aria-labelledby', 'lr-dialog-title');
    dialog.innerHTML = '<h3 id="lr-dialog-title">3 · Revisión final</h3><p role="status">Comprobando los servicios pendientes en el servidor…</p><button type="button" class="btn btn-ghost" id="lr-cancel">Volver sin registrar</button>';
    document.body.appendChild(dialog);
    let attempt = resume;
    const close = () => { if (!busy) dialog.close(); };
    $('lr-cancel').onclick = close;
    dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
    dialog.addEventListener('close', () => {
      reviewOpen = false; dialog.remove();
      if ($('lr-settle')) $('lr-settle').focus();
      load();
    }, {once:true});
    dialog.showModal();
    try {
      const r = resume ? resume.report : await api('/reports/summary?' + new URLSearchParams(previous.filter));
      if (!dialog.isConnected || !dialog.open) return;
      if (filterKey(r.filter) !== filterKey(previous.filter)) throw new Error('REPORT_CHANGED');
      const blocker = resume ? '' : settlementBlocker(r);
      if (blocker) {
        report = r;
        dialog.innerHTML = `<h3 id="lr-dialog-title">No se puede registrar todavía</h3><p class="lr-flow-note warning">${esc(blocker)}</p><p>No se ha registrado ningún pago desde esta revisión.</p><button type="button" class="btn btn-ghost" id="lr-cancel">Volver y revisar</button>`;
        $('lr-cancel').onclick = close; return;
      }
      const included = settlementRows(r), name = employeeLabel(r), estimated = included.filter(x => x.dateEstimated).length;
      if (!attempt) attempt = {report:r, requestKey:crypto.randomUUID(), payload:null};
      let changed = r.pendingHash !== previous.pendingHash;
      dialog.innerHTML = `<h3 id="lr-dialog-title">3 · Confirma la liquidación</h3><p><b>${esc(name)}</b><br>${esc(dayLabel(r.filter.from))} a ${esc(dayLabel(r.filter.to))}<br><b>${included.length} servicios entregados pendientes</b></p>${changed ? '<p class="lr-flow-note warning">Los servicios cambiaron desde la consulta. Estos son los valores actualizados; revísalos de nuevo.</p>' : ''}${monetaryBreakdown(included)}<div class="lr-reconcile">El valor del empleado es su participación en estos servicios, no necesariamente una transferencia pendiente. Verifica primero el dinero que cobró, los anticipos y los gastos. <b>Guardar no mueve dinero.</b></div><label for="lr-pay">¿Cómo se pagó o concilió?</label><select id="lr-pay"><option value="Efectivo">Efectivo</option><option value="Transferencia">Transferencia</option><option value="Otro">Otro / conciliación</option></select><label for="lr-ref">Referencia o nota de conciliación (opcional)</label><input id="lr-ref" maxlength="160" placeholder="Ej.: comprobante de pago o cierre de efectivo"><label class="lr-check"><input type="checkbox" id="lr-review-check"><span>Revisé el empleado, las fechas y los ${included.length} servicios incluidos.</span></label>${estimated ? `<label class="lr-check"><input type="checkbox" id="lr-date-check"><span>Revisé los ${estimated} servicios con fecha estimada y confirmo que corresponden a este período.</span></label>` : ''}<label class="lr-check"><input type="checkbox" id="lr-confirm"><span>Confirmo que este pago o conciliación ya se realizó con el empleado. No lo volveré a pagar al guardar.</span></label><div id="lr-modal-error" class="lr-error" hidden role="alert"></div><div class="lr-tools"><button type="button" class="btn btn-ghost" id="lr-cancel">Volver sin registrar</button><button type="button" class="btn btn-primary" id="lr-confirm-pay" disabled>Registrar como liquidado</button></div><p class="lr-hint">Se conserva un comprobante y estos servicios dejan de estar pendientes. No se incluyen los ya liquidados, cancelados ni en curso.</p>`;
      const ready = () => !!$('lr-review-check')?.checked && !!$('lr-confirm')?.checked && (!estimated || !!$('lr-date-check')?.checked);
      const checks = ['lr-review-check', 'lr-confirm', 'lr-date-check'].map($).filter(Boolean);
      checks.forEach(el => { el.onchange = () => { $('lr-confirm-pay').disabled = busy || !ready(); }; });
      $('lr-cancel').onclick = close;
      const freeze = value => { ['lr-pay', 'lr-ref', 'lr-review-check', 'lr-confirm', 'lr-date-check'].map($).filter(Boolean).forEach(el => { el.disabled = value; }); };
      if (attempt.payload) {
        checks.forEach(el => { el.checked = true; });
        $('lr-pay').value = attempt.payload.paymentMethod; $('lr-ref').value = attempt.payload.paymentReference;
        freeze(true);
        $('lr-modal-error').hidden = false;
        $('lr-modal-error').textContent = 'La respuesta anterior no se confirmó. No repitas el pago: comprueba el mismo registro con el botón de abajo.';
        $('lr-confirm-pay').textContent = 'Comprobar el mismo registro'; $('lr-confirm-pay').disabled = false;
      }
      $('lr-confirm-pay').onclick = async () => {
        if (busy || !ready()) return;
        if (!attempt.payload) attempt.payload = {
          ...r.filter, previewHash:r.pendingHash, requestKey:attempt.requestKey, confirmPaid:true,
          paymentMethod:$('lr-pay').value, paymentReference:$('lr-ref').value.trim()
        };
        busy = true; freeze(true); $('lr-cancel').disabled = true;
        $('lr-confirm-pay').disabled = true; $('lr-confirm-pay').textContent = 'Registrando…';
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
        let saved = false;
        try {
          const out = await api('/reports/settlements', {method:'POST', signal:controller.signal, body:JSON.stringify(attempt.payload)});
          if (!out?.ok || !out.settlement?.id) throw new Error('REPORT_RESPONSE_UNKNOWN');
          lastSettlement = out.settlement; uncertainAttempt = null; saved = true;
          window.showToast?.('Liquidación registrada. Descarga el comprobante.');
        } catch (e) {
          const definite = ['REPORT_CHANGED','REPORT_ALREADY_SETTLED','REPORT_NOTHING_PENDING','REPORT_MISSING_AMOUNTS','REPORT_SETTLEMENT_DATES_REQUIRED','REPORT_SETTLEMENT_FILTER_REQUIRED','REPORT_PREVIEW_REQUIRED','REPORT_PAYMENT_CONFIRMATION_REQUIRED','REPORT_PAYMENT_METHOD_REQUIRED','REPORT_REQUEST_REUSED','REPORT_INVALID_DATES','REPORT_REVERSED_DATES','ADMIN_REQUIRED','FORBIDDEN','REPORT_BATCH_TOO_LARGE'].includes(e.message);
          const node = $('lr-modal-error'); node.hidden = false;
          if (definite) {
            uncertainAttempt = null;
            node.textContent = friendly(e) + ' No repitas el pago. Vuelve a consultar y revisa las liquidaciones registradas.';
            $('lr-confirm-pay').textContent = 'Vuelve a consultar';
            checks.forEach(el => { el.checked = false; });
          } else {
            uncertainAttempt = attempt;
            node.textContent = 'No se confirmó la respuesta del registro. No vuelvas a pagar. Pulsa Comprobar el mismo registro: se reutiliza la misma operación para evitar duplicados.';
            $('lr-confirm-pay').textContent = 'Comprobar el mismo registro';
          }
        } finally {
          clearTimeout(timeout); busy = false;
          if (saved) dialog.close();
          else if (dialog.isConnected) { $('lr-cancel').disabled = false; $('lr-confirm-pay').disabled = !ready(); }
        }
      };
    } catch (e) {
      if (!dialog.isConnected) return;
      dialog.innerHTML = `<h3 id="lr-dialog-title">No se pudo comprobar la liquidación</h3><p>${esc(friendly(e))}</p><p>No se envió ninguna solicitud de liquidación. Vuelve a consultar.</p><button type="button" class="btn btn-ghost" id="lr-cancel">Volver sin registrar</button>`;
      $('lr-cancel').onclick = close;
    }
  }

  function loadScript(id, src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.id = id; s.src = src;
      const timer = setTimeout(() => { s.remove(); reject(new Error('EXPORT_TIMEOUT')); }, 30000);
      s.onload = () => { clearTimeout(timer); resolve(); }; s.onerror = () => { clearTimeout(timer); s.remove(); reject(new Error('EXPORT_LOAD_FAILED')); };
      document.head.appendChild(s);
    });
  }
  async function excelReady() {
    if (!exportPromise) exportPromise = (async () => {
      if (!window.ExcelJS) await loadScript('lr-exceljs', '/llanos-exceljs-4.4.0.min.js');
      if (!window.LlanosReportExcel) await loadScript('lr-exporter', '/llanos-report-excel.js?v=20261006.48');
    })().catch(e => { exportPromise = null; throw e; });
    return exportPromise;
  }
  async function exportReport(r, title) {
    const btn = $('lr-export'); if (btn) { btn.disabled = true; btn.textContent = 'Preparando Excel…'; }
    try {
      await excelReady(); const wb = window.LlanosReportExcel.build(window.ExcelJS, r, title);
      const bytes = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a'); a.href = url;
      const name = r.employees.find(e => e.id === r.filter.employeeId)?.name || 'General';
      a.download = (title + '_' + name + '_' + (r.filter.from || 'inicio') + '_' + (r.filter.to || 'todo_historial')).replace(/[^\p{L}\p{N}_-]/gu, '_') + '.xlsx';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { showError('No se pudo crear el archivo Excel. Revisa la conexión y vuelve a exportar.'); console.error('[reports export]', e); }
    finally { if (btn?.isConnected) { btn.disabled = false; btn.textContent = 'Exportar a Excel'; } }
  }
  async function exportReceipt(id, base) {
    try {
      const out = await api('/reports/settlements/' + encodeURIComponent(id)), s = out.settlement;
      const rows = out.rows.map(r => ({ ...r, settled: true, settlementId: s.id, settledAt: s.created_at }));
      await exportReport({ ...base, filter: { from: String(s.date_from).slice(0, 10), to: String(s.date_to).slice(0, 10), employeeId: s.employee_id }, rows,
        employees: [{ id: s.employee_id, name: s.employee_name }], byEmployee: [], byDay: [], byPayment: [], settlements: [s], estimatedDates: rows.filter(r => r.dateEstimated).length, undatedOrders: 0,
        summary: { services: rows.length, active: 0, cancelled: 0, fare: Number(s.total_fare), purchases: rows.reduce((a, r) => a + r.purchase, 0), company: Number(s.company_amount), earnings: Number(s.employee_amount), pendingCount: 0, pendingAmount: 0, settledCount: rows.length, settledAmount: Number(s.employee_amount), missingAmounts: 0 }
      }, 'Comprobante liquidacion ' + id.slice(0, 8));
    } catch (e) { showError(friendly(e)); }
  }
  window.LlanosReports = { version: 'llanos-reconciliation-v51', mount, openEmployee, refresh: load };
  if ($('vista-informes') && $('vista-informes').style.display !== 'none') mount();
})();
