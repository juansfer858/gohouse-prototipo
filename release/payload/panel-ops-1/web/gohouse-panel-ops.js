/* Panel operativo: formas de pago configuradas + referencias de cobro. */
(() => {
  'use strict';
  if (window.GoHousePanelOps) return;
  if (!/\/panel\/?$|gohouse-panel\.html$/i.test(location.pathname)) return;

  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => '$' + Number(n || 0).toLocaleString('es-CO');

  function styles(){
    if ($('gh-panel-ops-style')) return;
    const s = document.createElement('style');
    s.id = 'gh-panel-ops-style';
    s.textContent =
      '#gh-order-references-field .btn{width:100%;min-height:38px}' +
      '#gh-refs-modal{position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:10080;display:none;align-items:center;justify-content:center;padding:18px}' +
      '#gh-refs-modal.show{display:flex}' +
      '.gh-refs-box{width:min(520px,100%);max-height:min(78vh,720px);overflow:auto;background:var(--surface,#1e312b);border:1px solid var(--line,#33473d);border-radius:14px;padding:18px;color:var(--text,#f3efe6)}' +
      '.gh-refs-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}.gh-refs-head h3{margin:0}' +
      '.gh-refs-list{display:grid;gap:8px}.gh-ref-row{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:12px;border:1px solid var(--line,#33473d);border-radius:9px;background:var(--surface-2,#24392f)}' +
      '.gh-ref-name{font-weight:750}.gh-ref-price{font-weight:800;color:var(--mango,#e8863a);white-space:nowrap}' +
      '.gh-refs-note{font-size:.78rem;color:var(--text-dim,#a9b8b0);margin:0 0 12px}';
    document.head.appendChild(s);
  }

  function methodsFromConfig(cfg){
    cfg = cfg || {};
    const out = ['Efectivo'];
    if (String(cfg.nequiNumber || '').trim()) out.push('Nequi');
    if (String(cfg.daviplataNumber || '').trim()) out.push('Daviplata');
    const bank = String(cfg.bankName || '').trim();
    const account = String(cfg.bankAccount || '').trim();
    if (bank || account) out.push(bank || 'Transferencia bancaria');
    out.push('Ya pagó');
    return Array.from(new Set(out));
  }

  function syncPaymentMethods(cfg){
    const select = $('in-pago');
    if (!select) return false;
    const methods = methodsFromConfig(cfg);
    const sig = methods.join('|');
    if (select.dataset.ghPaymentSig === sig) return true;
    const current = select.value;
    select.innerHTML = methods.map(m => '<option value="' + esc(m) + '">' + esc(m) + '</option>').join('');
    select.value = methods.includes(current) ? current : methods[0];
    select.dataset.ghPaymentSig = sig;
    return true;
  }

  function ensureReferencesButton(){
    const select = $('in-pago');
    if (!select) return false;
    if ($('gh-order-references-field')) return true;
    const payField = select.closest('.field');
    if (!payField) return false;
    const field = document.createElement('div');
    field.className = 'field';
    field.id = 'gh-order-references-field';
    field.innerHTML = '<label>Referencias</label><button type="button" class="btn btn-ghost" id="gh-open-references">📍 Ver referencias</button>';
    payField.insertAdjacentElement('afterend', field);
    $('gh-open-references')?.addEventListener('click', openReferences);
    return true;
  }

  function ensureModal(){
    if ($('gh-refs-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'gh-refs-modal';
    modal.innerHTML = '<div class="gh-refs-box"><div class="gh-refs-head"><h3>📍 Referencias de cobro</h3><button type="button" class="btn btn-ghost btn-sm" id="gh-close-refs">Cerrar</button></div><p class="gh-refs-note">Consulta cuánto cobrar según la referencia o zona configurada.</p><div id="gh-refs-list" class="gh-refs-list"><div class="empty">Cargando referencias…</div></div></div>';
    modal.addEventListener('click', e => { if (e.target === modal) closeReferences(); });
    document.body.appendChild(modal);
    $('gh-close-refs')?.addEventListener('click', closeReferences);
  }

  async function openReferences(){
    ensureModal();
    const modal = $('gh-refs-modal');
    const list = $('gh-refs-list');
    modal?.classList.add('show');
    if (list) list.innerHTML = '<div class="empty">Cargando referencias…</div>';
    try {
      const res = await fetch('/api/public/tarifas', {cache:'no-store'});
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'No se pudieron cargar las referencias.');
      const zones = Array.isArray(data?.zones) ? data.zones.slice().sort((a,b)=>(Number(a.orden)||0)-(Number(b.orden)||0)) : [];
      if (!list) return;
      list.innerHTML = zones.length
        ? zones.map(z => '<div class="gh-ref-row"><span class="gh-ref-name">' + esc(z.nombre) + '</span><span class="gh-ref-price">' + money(z.tarifa) + '</span></div>').join('')
        : '<div class="empty">No hay referencias activas configuradas.</div>';
    } catch (e) {
      if (list) list.innerHTML = '<div class="empty">No se pudieron cargar las referencias: ' + esc(e?.message || 'error') + '</div>';
    }
  }

  function closeReferences(){ $('gh-refs-modal')?.classList.remove('show'); }

  async function readConfig(){
    if (window.GoHouseBrand?.ready) { try { await window.GoHouseBrand.ready; } catch {} }
    const cfg = window.GoHouseBrand?.config;
    if (cfg && Object.keys(cfg).length) return cfg;
    try {
      const r = await fetch('/api/public/config', {cache:'no-store'});
      return r.ok ? await r.json() : {};
    } catch { return {}; }
  }

  async function sync(){
    styles();
    ensureReferencesButton();
    syncPaymentMethods(await readConfig());
  }

  async function boot(){
    for (let i=0; i<80; i++) {
      if ($('in-pago')) break;
      await new Promise(r => setTimeout(r, 200));
    }
    await sync();
    window.addEventListener('gohouse:brand-applied', () => sync());
    document.addEventListener('click', e => { if (e.target?.id === 'tab-pedidos') setTimeout(sync, 50); }, true);
  }

  window.GoHousePanelOps = {sync, openReferences, closeReferences};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();