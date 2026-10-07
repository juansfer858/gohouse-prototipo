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
        <div class="lr-filters"><div class="lr-employee-field"><label for="lr-employee">Empleado</label><select id="lr-employee"><option value="">Todos los empleados</option></select></div><div><label for="lr-from">Desde (opcional)</label><input type="date" id="lr-from" value="${applied.from}"></div><div><label for="lr-to">Hasta (opcional)</label><input type="date" id="lr-to" value="${applied.to}"></div><button type="button" class="btn btn-primary" id="lr-query">Consultar</button></div>
        <div class="lr-tools"><button type="button" class="btn btn-primary btn-sm" id="lr-all">Todo el historial</button><button type="button" class="btn btn-ghost btn-sm" id="lr-today">Hoy</button><button type="button" class="btn btn-ghost btn-sm" id="lr-week">Últimos 7 días</button><button type="button" class="btn btn-ghost btn-sm" id="lr-month">Este mes</button><label for="lr-status" style="align-self:center">Estado</label><select id="lr-status"><option value="">Todos los estados</option><option value="entregado">Entregados</option><option value="active">Pendientes / en curso</option><option value="cancelado">Cancelados</option></select></div>
        <p class="lr-hint">Al seleccionar un empleado se muestra todo su historial. Las fechas y el estado son filtros opcionales. Fechas inclusivas, hora de Colombia. Los servicios entregados se filtran por fecha de entrega; los cancelados, por fecha de cancelación; los abiertos, por fecha de solicitud.</p>
        <div id="lr-error" class="lr-error" role="alert" hidden></div><div id="lr-progress" class="lr-hint" role="status"></div><div id="lr-body"></div></section>`;
      $('lr-query').onclick = applyFilters;
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
    if (busy) return;
    if (loading) { queued = true; return; }
    loading = true; const seq = ++sequence, filter = { ...applied };
    if ($('lr-progress')) $('lr-progress').textContent = 'Actualizando informe…';
    try {
      const out = await api('/reports/summary?' + new URLSearchParams(filter));
      if (seq !== sequence) return;
      report = out; showError('');
      const select = $('lr-employee');
      if (select) {
        const signature = JSON.stringify(out.employees);
        if (select.dataset.signature !== signature) {
          select.innerHTML = '<option value="">Todos los empleados</option>' + out.employees.map(e => `<option value="${esc(e.id)}">${esc(e.name)}${e.archived ? ' · retirado' : ''}${Number.isInteger(e.historyCount) ? ' · ' + e.historyCount + ' servicios' : ''}</option>`).join('');
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
  function render() {
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
    const employeeRows = r.byEmployee.map(e => [`<button type="button" class="btn btn-ghost btn-sm" data-lr-employee="${esc(e.id)}">${esc(e.name)}</button>`, esc(e.services), money(e.fare), money(e.company), money(e.earnings), `<span class="lr-pending">${money(e.pendingAmount)}</span>`, `<span class="lr-paid">${money(e.settledAmount)}</span>`]);
    if (!chosen || mode === 'general') html += '<h3 class="lr-section">Por empleado</h3>' + table(['Empleado', 'Entregados', 'Domicilios', 'Empresa', 'Empleado', 'Pendiente', 'Liquidado'], employeeRows);
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
    body.querySelectorAll('[data-lr-receipt]').forEach(b => { b.onclick = () => exportReceipt(b.dataset.lrReceipt, r); });
    if ($('lr-prev')) $('lr-prev').onclick = () => { page--; render(); };
    if ($('lr-next')) $('lr-next').onclick = () => { page++; render(); };
  }
  function openEmployee(id) {
    mount(); mode = 'employee'; if ($('lr-employee')) $('lr-employee').value = id || ''; allHistory();
  }
  function preview(r) {
    if (!r.canSettle || !r.canSettleSelection) return;
    if ($('lr-dialog')) $('lr-dialog').remove();
    const dialog = document.createElement('dialog'); dialog.className = 'lr-dialog'; dialog.id = 'lr-dialog';
    const employee = r.employees.find(e => e.id === r.filter.employeeId)?.name || r.filter.employeeId;
    const requestKey = crypto.randomUUID();
    dialog.innerHTML = `<h3>Confirmar liquidación de servicios</h3><p><b>${esc(employee)}</b><br>${esc(r.filter.from)} a ${esc(r.filter.to)}</p><p>${r.pendingIds.length} servicios pendientes.<br>Valor empleado: <b>${money(r.summary.pendingAmount)}</b></p><p class="lr-hint">Solo se incluirán los pendientes de estas fechas. Los ya liquidados, cancelados y no entregados quedan excluidos.</p><label for="lr-pay">Forma de pago al empleado</label><select id="lr-pay"><option>Efectivo</option><option>Transferencia</option><option>Otro</option></select><label for="lr-ref">Referencia del pago (opcional)</label><input id="lr-ref" maxlength="160"><label class="lr-check"><input type="checkbox" id="lr-confirm">Confirmo que ya realicé o concilié este pago con el empleado.</label><div id="lr-modal-error" class="lr-error" hidden role="alert"></div><div class="lr-tools"><button type="button" class="btn btn-ghost" id="lr-cancel">Volver</button><button type="button" class="btn btn-primary" id="lr-confirm-pay" disabled>Registrar liquidación</button></div>`;
    document.body.appendChild(dialog);
    $('lr-confirm').onchange = () => { $('lr-confirm-pay').disabled = !$('lr-confirm').checked; };
    $('lr-cancel').onclick = () => dialog.close();
    dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
    $('lr-confirm-pay').onclick = async () => {
      if (busy || !$('lr-confirm').checked) return;
      busy = true; $('lr-confirm-pay').disabled = true; $('lr-cancel').disabled = true;
      try {
        const out = await api('/reports/settlements', { method: 'POST', body: JSON.stringify({ ...r.filter, previewHash: r.pendingHash, requestKey, confirmPaid: true, paymentMethod: $('lr-pay').value, paymentReference: $('lr-ref').value }) });
        dialog.close(); window.showToast?.('Liquidación registrada: ' + String(out.settlement.id).slice(0, 8));
      } catch (e) {
        const n = $('lr-modal-error'); n.hidden = false; n.textContent = friendly(e);
        if (['REPORT_CHANGED', 'REPORT_ALREADY_SETTLED', 'REPORT_NOTHING_PENDING'].includes(e.message)) $('lr-confirm').checked = false;
      } finally { busy = false; $('lr-cancel').disabled = false; $('lr-confirm-pay').disabled = !$('lr-confirm').checked; await load(); }
    };
    dialog.showModal();
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
  window.LlanosReports = { version: 'llanos-reports-v49', mount, openEmployee, refresh: load };
  if ($('vista-informes') && $('vista-informes').style.display !== 'none') mount();
})();
