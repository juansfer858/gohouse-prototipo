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
