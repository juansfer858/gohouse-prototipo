/* Domicilios: catálogo administrable y selección de tarifa antes de enviar. */
(() => {
  'use strict';
  if (window.GoHouseTarifas) return;
  const VERSION = '2026.09.15-tarifas.2';
  const $ = id => document.getElementById(id);
  const money = n => '$' + Number(n).toLocaleString('es-CO');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isPanel = /\/panel\/?$|gohouse-panel\.html$/i.test(location.pathname);
  const isDriver = /domiciliario/i.test(location.pathname);
  const messages = {
    TARIFF_INVALID_NAME: 'Escribe un nombre de 2 a 80 caracteres.',
    TARIFF_INVALID_AMOUNT: 'Escribe un valor entero entre $1 y $10.000.000.',
    TARIFF_INVALID_STATUS: 'Selecciona Activa o Inactiva.',
    TARIFF_STANDARD_PROTECTED: 'Servicio estándar siempre debe existir y permanecer activo.',
    TARIFF_DUPLICATE_NAME: 'Ya existe una referencia con ese nombre.',
    TARIFF_REVISION_CONFLICT: 'Otro administrador cambió las referencias. Recarga antes de guardar.',
    TARIFF_NOT_CONFIGURED: 'Las tarifas no están disponibles. Reintenta antes de enviar.',
    TARIFF_NOT_FOUND: 'Esta referencia ya no existe. Recarga la lista.',
    TARIFF_LIMIT: 'Se alcanzó el máximo de 250 referencias.',
    ADMIN_REQUIRED: 'Solo un administrador puede cambiar las referencias.',
    TARIFF_QUOTE_CHANGED: 'La zona o su tarifa cambió. Revisa el valor y confirma nuevamente.',
    TARIFF_ORDER_LOCKED: 'La tarifa de este pedido ya está fijada y no puede modificarse.'
  };
  const errorText = error => messages[error?.message] || 'No se pudo completar la operación. Revisa la conexión y reintenta.';
  let panelNode = null, catalog = null, loading = false, busy = false, editorRevision = '', panelTimer;
  let clientCatalog = null, selectedId = '', clientLoading = null;

  async function request(endpoint, options = {}) {
    if (endpoint === '/public/tarifas') {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch('/api' + endpoint, { cache: 'no-store', signal: controller.signal });
        const out = await res.json(); if (!res.ok) throw new Error(out.error || 'REQUEST_FAILED'); return out;
      } finally { clearTimeout(timer); }
    }
    if (!window.GoHouseVPS?.api) throw new Error('API_NOT_READY');
    return window.GoHouseVPS.api(endpoint, options);
  }
  function styles() {
    if ($('gh-tarifas-style')) return;
    const node = document.createElement('style'); node.id = 'gh-tarifas-style';
    node.textContent = `
      #gh-zonas-tarifas{margin-top:18px;padding-top:16px;border-top:1px solid var(--line,#33473d)}
      #gh-zonas-tarifas h3{font-size:1rem;margin:0 0 8px}.gh-tariff-hint{font-size:.8rem;color:var(--text-dim,#a9b8b0);line-height:1.5}
      .gh-tariff-list{display:grid;gap:8px;margin:12px 0}.gh-tariff-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;align-items:center;padding:12px;border:1px solid var(--line,#33473d);border-radius:8px;background:var(--surface-2,#24392f)}
      .gh-tariff-name{font-weight:700;overflow-wrap:anywhere}.gh-tariff-status{font-size:.73rem;color:var(--text-dim,#a9b8b0);margin-top:4px}.gh-tariff-price{font-weight:700;white-space:nowrap}.gh-tariff-actions{display:flex;gap:6px}
      #gh-add-tariff{width:100%;margin:4px 0 10px;min-height:44px}#gh-tariff-editor{margin-top:12px;padding:14px;border:1px solid var(--line,#33473d);border-radius:8px}#gh-tariff-editor[hidden]{display:none!important}
      #gh-tariff-error{font-size:.85rem;color:var(--red,#e1685f);line-height:1.5;margin:8px 0}#gh-client-tariff{padding:14px;border:1px solid var(--line,#33473d);border-radius:10px;margin:14px 0}#gh-client-tariff label{display:block}#gh-client-zone{width:100%;margin:8px 0;padding:10px}#gh-client-tariff-price{font-size:1.1rem;font-weight:750;margin-top:10px}#gh-client-tariff-error{font-size:.82rem;margin:8px 0;color:var(--red,#e1685f)}
      @media(max-width:600px){.gh-tariff-row{grid-template-columns:minmax(0,1fr) auto}.gh-tariff-actions{grid-column:1/-1}.gh-tariff-actions button{flex:1;min-height:40px}}
    `;
    document.head.appendChild(node);
  }
  function panelError(text) { const node = panelNode?.querySelector('#gh-tariff-error'); if (node) node.textContent = text; }
  function setBusy(value) {
    busy = value;
    panelNode?.querySelectorAll('button').forEach(button => { button.disabled = value; });
  }
  function renderRows() {
    const node = panelNode?.querySelector('#gh-tariff-list'); if (!node || !catalog) return;
    node.innerHTML = catalog.zones.map(z => `<div class="gh-tariff-row" data-zone="${escape(z.id)}"><div><div class="gh-tariff-name">${escape(z.nombre)}</div><div class="gh-tariff-status">${z.activa ? 'Activa' : 'Inactiva'}${z.id === 'estandar' ? ' · Predeterminada y protegida' : ''}</div></div><div class="gh-tariff-price">${money(z.tarifa)}</div><div class="gh-tariff-actions"><button type="button" class="btn btn-ghost btn-sm" data-edit="${escape(z.id)}" aria-label="Editar ${escape(z.nombre)}">Editar</button>${z.id === 'estandar' ? '' : `<button type="button" class="btn btn-danger-ghost btn-sm" data-delete="${escape(z.id)}" aria-label="Eliminar ${escape(z.nombre)}">Eliminar</button>`}</div></div>`).join('');
  }
  async function reloadPanel() {
    if (loading || busy) return;
    loading = true; panelError('');
    try { catalog = await request('/tarifas'); renderRows(); }
    catch (error) { panelError(errorText(error)); }
    finally { loading = false; }
  }
  function closeEditor() { const form = panelNode?.querySelector('#gh-tariff-editor'); if (form) form.hidden = true; }
  function openEditor(id = '') {
    if (busy || !catalog) return;
    const zone = catalog.zones.find(z => z.id === id); if (id && !zone) return;
    const protectedZone = id === 'estandar'; editorRevision = catalog.revision;
    $('gh-tariff-id').value = id; $('gh-tariff-name').value = zone?.nombre || '';
    $('gh-tariff-name').disabled = protectedZone;
    $('gh-tariff-value').value = zone?.tarifa ?? '';
    $('gh-tariff-active').value = zone?.activa === false ? 'false' : 'true';
    $('gh-tariff-active').disabled = protectedZone;
    $('gh-tariff-editor-title').textContent = id ? 'Editar referencia' : 'Agregar referencia';
    $('gh-tariff-editor').hidden = false; panelError('');
    (protectedZone ? $('gh-tariff-value') : $('gh-tariff-name')).focus();
  }
  async function saveEditor(event) {
    event.preventDefault(); if (busy || !catalog) return;
    const id = $('gh-tariff-id').value;
    const nombre = $('gh-tariff-name').value.trim();
    const raw = $('gh-tariff-value').value.trim(); const tarifa = Number(raw);
    if (nombre.length < 2 || nombre.length > 80) { panelError(messages.TARIFF_INVALID_NAME); return; }
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(tarifa) || tarifa < 1 || tarifa > 10000000) { panelError(messages.TARIFF_INVALID_AMOUNT); return; }
    const body = { nombre, tarifa, activa: $('gh-tariff-active').value === 'true', revision: editorRevision };
    setBusy(true); panelError('');
    try {
      catalog = await request('/tarifas' + (id ? '/' + encodeURIComponent(id) : ''), { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      renderRows(); closeEditor(); window.showToast?.('Referencia guardada.');
    } catch (error) { panelError(errorText(error)); }
    finally { setBusy(false); }
  }
  async function deleteZone(id) {
    if (busy || !catalog || id === 'estandar') return;
    const zone = catalog.zones.find(z => z.id === id); if (!zone) return;
    if (!window.confirm(`¿Eliminar «${zone.nombre}»? Los pedidos anteriores conservarán su tarifa.`)) return;
    setBusy(true); panelError('');
    try {
      catalog = await request('/tarifas/' + encodeURIComponent(id), { method: 'DELETE', body: JSON.stringify({ revision: catalog.revision }) });
      renderRows(); closeEditor(); window.showToast?.('Referencia eliminada.');
    } catch (error) { panelError(errorText(error)); }
    finally { setBusy(false); }
  }
  function mountPanel() {
    const anchor = $('in-porcentaje-casa')?.closest('section');
    if (!isPanel || !anchor || anchor.contains(panelNode)) return;
    if (!panelNode) {
      panelNode = document.createElement('div'); panelNode.id = 'gh-zonas-tarifas';
      panelNode.innerHTML = `<h3>Zonas y tarifas</h3><p class="gh-tariff-hint">Administra las referencias de entrega. Solo las activas aparecen al cliente. Los pedidos ya enviados conservan su valor.</p><div id="gh-tariff-list" class="gh-tariff-list">Cargando referencias…</div><button type="button" class="btn btn-primary" id="gh-add-tariff">+ Agregar referencia</button><button type="button" class="btn btn-ghost btn-sm" id="gh-reload-tariffs">Recargar referencias</button><div id="gh-tariff-error" role="alert" aria-live="polite"></div><form id="gh-tariff-editor" hidden><h3 id="gh-tariff-editor-title">Agregar referencia</h3><input type="hidden" id="gh-tariff-id"><div class="grid"><div class="field"><label for="gh-tariff-name">Nombre de la referencia</label><input id="gh-tariff-name" maxlength="80" minlength="2" required autocomplete="off"></div><div class="field"><label for="gh-tariff-value">Valor (COP)</label><input id="gh-tariff-value" type="number" inputmode="numeric" min="1" max="10000000" step="1" required></div><div class="field"><label for="gh-tariff-active">Estado</label><select id="gh-tariff-active"><option value="true">Activa</option><option value="false">Inactiva</option></select></div></div><div style="display:flex;gap:8px"><button class="btn btn-primary" type="submit" id="gh-save-tariff">Guardar</button><button class="btn btn-ghost" type="button" id="gh-cancel-tariff">Cancelar</button></div></form>`;
      panelNode.querySelector('#gh-add-tariff').addEventListener('click', () => openEditor());
      panelNode.querySelector('#gh-cancel-tariff').addEventListener('click', closeEditor);
      panelNode.querySelector('#gh-reload-tariffs').addEventListener('click', () => { closeEditor(); reloadPanel(); });
      panelNode.querySelector('#gh-tariff-editor').addEventListener('submit', saveEditor);
      panelNode.querySelector('#gh-tariff-list').addEventListener('click', event => {
        const button = event.target.closest('button'); if (button?.dataset.edit) openEditor(button.dataset.edit);
        if (button?.dataset.delete) deleteZone(button.dataset.delete);
      });
    }
    anchor.appendChild(panelNode); renderRows(); if (!busy && $('gh-tariff-editor').hidden) reloadPanel();
  }
  function schedulePanel() { clearTimeout(panelTimer); panelTimer = setTimeout(mountPanel, 40); }
  function clientCard() {
    const button = $('btn-confirmar'); if (!button) return null;
    let node = $('gh-client-tariff');
    if (!node) {
      node = document.createElement('div'); node.id = 'gh-client-tariff';
      node.innerHTML = `<label for="gh-client-zone">Zona / referencia de entrega</label><select id="gh-client-zone" aria-describedby="gh-client-tariff-price"><option value="">Cargando referencias…</option></select><div class="gh-tariff-hint">Este valor corresponde al domicilio. El valor de las compras se informa por separado.</div><div id="gh-client-tariff-price" aria-live="polite"></div><div id="gh-client-tariff-error" role="alert"></div><button type="button" class="btn btn-ghost" id="gh-client-reload">Actualizar tarifas</button>`;
      button.before(node);
      $('gh-client-zone').addEventListener('change', event => { selectedId = event.target.value; updateClientPrice(); });
      $('gh-client-reload').addEventListener('click', () => refreshClient());
    }
    return node;
  }
  function updateClientPrice() {
    const zone = clientCatalog?.zones.find(z => z.id === selectedId);
    if ($('gh-client-tariff-price')) $('gh-client-tariff-price').textContent = zone ? `Valor del domicilio: ${money(zone.tarifa)}` : 'Selecciona una referencia de entrega.';
  }
  function applyClientCatalog(next) {
    if (!Array.isArray(next?.zones) || !next.zones.length || next.zones.some(z => !z.id || !Number.isSafeInteger(z.tarifa) || z.tarifa <= 0)) throw new Error('TARIFF_NOT_CONFIGURED');
    clientCatalog = next; if (!clientCard()) return;
    if (!next.zones.some(z => z.id === selectedId)) selectedId = (next.zones.find(z => z.id === 'estandar') || next.zones[0]).id;
    const select = $('gh-client-zone');
    select.innerHTML = next.zones.map(z => `<option value="${escape(z.id)}">${escape(z.nombre)} — ${money(z.tarifa)}</option>`).join('');
    select.value = selectedId; select.disabled = false; updateClientPrice();
    $('gh-client-tariff-error').textContent = '';
  }
  async function refreshClient() {
    if (isPanel || isDriver || !clientCard()) return;
    if (clientLoading) return clientLoading;
    clientLoading = (async () => {
      try { applyClientCatalog(await request('/public/tarifas')); }
      catch (error) { $('gh-client-tariff-error').textContent = errorText(error); }
      finally { clientLoading = null; }
    })();
    return clientLoading;
  }
  async function quote() {
    const previous = clientCatalog?.zones.find(z => z.id === selectedId);
    const next = await request('/public/tarifas');
    const current = next?.zones?.find(z => z.id === selectedId);
    applyClientCatalog(next);
    if (!previous || !current || previous.tarifa !== current.tarifa || previous.nombre !== current.nombre) {
      $('gh-client-tariff-error').textContent = messages.TARIFF_QUOTE_CHANGED;
      throw new Error('TARIFF_QUOTE_CHANGED');
    }
    return { zonaTarifaId: current.id, zonaTarifaNombre: current.nombre, tarifa: current.tarifa, tarifaFijada: true };
  }
  function boot() {
    styles();
    if (isPanel) {
      const observer = new MutationObserver(() => {
        const anchor = $('in-porcentaje-casa')?.closest('section');
        if (anchor && !anchor.contains(panelNode)) schedulePanel();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      document.addEventListener('click', event => { if (event.target.closest('#tab-ajustes')) schedulePanel(); });
      schedulePanel();
    } else if (!isDriver) {
      clientCard(); refreshClient();
      const step = $('step-mandado');
      if (step) new MutationObserver(() => { if (step.classList.contains('active')) refreshClient(); }).observe(step, { attributes: true, attributeFilter: ['class'] });
      window.addEventListener('pageshow', refreshClient);
    }
  }
  window.GoHouseTarifas = { version: VERSION, mountPanel, refreshClient, quote, errorText };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
