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
      html += '<div class="lr-flow-wait"><b>Primero elige a quién vas a liquidar.</b><br>Arriba selecciona un empleado. Puedes consultar todo su historial; para registrar una liquidación debes elegir un período.</div>';
      html += table(['Empleado', 'Entregados', 'Pendiente de liquidación', 'Ya liquidado', 'Acción'], r.byEmployee.filter(e => e.id).map(e => [esc(e.name), e.services, money(e.pendingAmount), money(e.settledAmount), `<button class="btn btn-ghost btn-sm" type="button" data-lr-employee="${esc(e.id)}">Revisar empleado</button>`]));
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
    $('lr-body').querySelectorAll('[data-lr-receipt]').forEach(b => { b.onclick = () => exportReceipt(b.dataset.lrReceipt, r); });
    if ($('lr-prev')) $('lr-prev').onclick = () => { page--; render(); };
    if ($('lr-next')) $('lr-next').onclick = () => { page++; render(); };
  }
