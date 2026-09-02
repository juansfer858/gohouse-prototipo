/* GoHouse white-label advertising module.
   Administra publicidad en el estado VPS y la muestra como carrusel al cliente. */
(() => {
  'use strict';

  if (window.GoHouseAds) return;

  const state = {
    ads: [],
    index: 0,
    timer: null,
    refreshTimer: null,
    editingId: null,
    pendingImage: '',
    panelReady: false,
    clientReady: false,
    originalCambiarVistaPanel: null
  };

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  function pageKind(){
    const p = location.pathname.toLowerCase();
    if (p.includes('panel') || $('tab-pedidos')) return 'panel';
    if (p.includes('domiciliario')) return 'driver';
    if ($('step-home') || p === '/' || p.includes('cliente')) return 'client';
    return 'other';
  }

  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  function safeNumber(value, fallback=0){
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeAd(raw, index=0){
    const a = raw && typeof raw === 'object' ? raw : {};
    return {
      id: String(a.id || `ad-${Date.now()}-${index}`),
      title: String(a.title || '').trim(),
      image: String(a.image || a.imagen || '').trim(),
      link: String(a.link || a.enlace || '').trim(),
      order: safeNumber(a.order ?? a.orden, index + 1),
      active: a.active !== false && a.activa !== false,
      createdAt: safeNumber(a.createdAt, Date.now()),
      updatedAt: safeNumber(a.updatedAt, Date.now())
    };
  }

  function normalizeAds(data){
    const list = Array.isArray(data?.publicidad) ? data.publicidad : [];
    return list.map(normalizeAd).filter(a => a.image).sort((a,b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.createdAt - b.createdAt;
    });
  }

  async function waitForShared(requireSave=false){
    for(let i=0;i<80;i++){
      const canLoad = typeof window.loadShared === 'function';
      const canSave = typeof window.saveShared === 'function';
      if (canLoad && (!requireSave || canSave)) return true;
      await sleep(200);
    }
    return false;
  }

  async function loadData(){
    if (!(await waitForShared(false))) throw new Error('La conexión con el VPS todavía no está disponible.');
    return await window.loadShared();
  }

  async function saveData(data){
    if (!(await waitForShared(true))) throw new Error('La conexión de administración todavía no está disponible.');
    await window.saveShared(data);
  }

  function addStyles(){
    if ($('gh-publicidad-style')) return;
    const st = document.createElement('style');
    st.id = 'gh-publicidad-style';
    st.textContent = `
      .gh-ads-client{margin-top:22px;display:none}
      .gh-ads-client.is-visible{display:block}
      .gh-ads-kicker{font:600 .68rem 'JetBrains Mono',monospace;letter-spacing:.05em;text-transform:uppercase;color:var(--text-dim,#93A7BE);margin:0 0 8px}
      .gh-ads-carousel{position:relative;border-radius:14px;overflow:hidden;border:1px solid var(--line,#2A415F);background:var(--surface,#16273D)}
      .gh-ads-track{position:relative;aspect-ratio:16/7;min-height:128px}
      .gh-ad-slide{position:absolute;inset:0;opacity:0;pointer-events:none;transition:opacity .28s ease;background:var(--surface,#16273D);border:0;padding:0;width:100%;height:100%;color:inherit;text-align:left}
      .gh-ad-slide.is-active{opacity:1;pointer-events:auto}
      .gh-ad-slide img{width:100%;height:100%;display:block;object-fit:cover}
      .gh-ad-slide.is-link{cursor:pointer}
      .gh-ad-caption{position:absolute;left:0;right:0;bottom:0;padding:28px 14px 12px;background:linear-gradient(transparent,rgba(0,0,0,.78));color:#fff;font-weight:700;font-size:.88rem}
      .gh-ad-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:3;width:38px;height:38px;border-radius:50%;border:1px solid rgba(255,255,255,.4);background:rgba(7,18,30,.62);color:#fff;font-size:24px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer}
      .gh-ad-nav.prev{left:8px}.gh-ad-nav.next{right:8px}
      .gh-ad-dots{display:flex;justify-content:center;gap:6px;padding:9px 0 2px}
      .gh-ad-dot{width:7px;height:7px;border:0;border-radius:999px;padding:0;background:var(--line,#2A415F);cursor:pointer}
      .gh-ad-dot.is-active{width:18px;background:var(--teal,var(--mango,#E8863A))}
      .gh-ads-admin{display:none}
      .gh-ads-admin.is-open{display:block}
      .gh-ads-admin .gh-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:16px;flex-wrap:wrap}
      .gh-ads-admin h2{margin:0 0 4px}
      .gh-muted{color:var(--text-dim,#A9B8B0);font-size:.82rem}
      .gh-ad-form{background:var(--surface,#1E312B);border:1px solid var(--line,#33473D);border-radius:10px;padding:16px;margin-bottom:18px}
      .gh-ad-form-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:14px}
      .gh-ad-form-fields{min-width:0}
      .gh-ad-image-box{min-height:180px;border:1px dashed var(--line,#33473D);border-radius:10px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--bg,#16231F);cursor:pointer;position:relative}
      .gh-ad-image-box img{width:100%;height:100%;min-height:180px;max-height:260px;object-fit:cover;display:none}
      .gh-ad-image-box.has-image img{display:block}
      .gh-ad-image-box.has-image .gh-upload-copy{display:none}
      .gh-upload-copy{text-align:center;padding:20px;color:var(--text-dim,#A9B8B0);font-size:.82rem}
      .gh-ad-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .gh-ad-active{display:flex;align-items:center;gap:8px;color:var(--text,#F3EFE6);font-size:.85rem;margin:10px 0}
      .gh-ad-active input{width:auto;margin:0}
      .gh-ad-list{display:grid;gap:10px}
      .gh-ad-row{display:grid;grid-template-columns:120px minmax(0,1fr) auto;gap:12px;align-items:center;background:var(--surface,#1E312B);border:1px solid var(--line,#33473D);border-radius:10px;padding:10px}
      .gh-ad-row img{width:120px;height:70px;object-fit:cover;border-radius:7px;background:var(--bg,#16231F)}
      .gh-ad-row-title{font-weight:700;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .gh-ad-row-meta{font-size:.72rem;color:var(--text-dim,#A9B8B0);margin-top:4px}
      .gh-ad-row-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
      .gh-ad-status{font-size:.68rem;border-radius:999px;padding:3px 8px;display:inline-block;margin-top:5px}
      .gh-ad-status.on{background:var(--green-dim,#2E4A3B);color:var(--green,#5FBF8B)}
      .gh-ad-status.off{background:var(--red-dim,#4A2E2C);color:var(--red,#E1685F)}
      .gh-empty{color:var(--text-dim,#A9B8B0);border:1px dashed var(--line,#33473D);border-radius:9px;padding:20px;text-align:center;font-size:.85rem}
      @media(max-width:720px){
        .gh-ad-form-grid{grid-template-columns:1fr}
        .gh-ad-row{grid-template-columns:88px minmax(0,1fr)}
        .gh-ad-row img{width:88px;height:60px}
        .gh-ad-row-actions{grid-column:1/-1;justify-content:flex-start}
      }
      @media(prefers-reduced-motion:reduce){.gh-ad-slide{transition:none}}
    `;
    document.head.appendChild(st);
  }

  function carouselContainer(){
    let box = $('gh-publicidad-carousel');
    if (box) return box;
    const home = $('step-home');
    if (!home) return null;
    box = document.createElement('section');
    box.id = 'gh-publicidad-carousel';
    box.className = 'gh-ads-client';
    box.setAttribute('aria-label','Publicidad');
    const cards = home.querySelectorAll('.home-card');
    if (cards.length) cards[cards.length - 1].insertAdjacentElement('afterend', box);
    else home.appendChild(box);
    return box;
  }

  function safeDestination(link){
    if (!link) return '';
    try{
      const url = new URL(link, location.origin);
      if (!['http:','https:'].includes(url.protocol)) return '';
      return url.href;
    }catch{
      return '';
    }
  }

  function openAd(ad){
    const dest = safeDestination(ad.link);
    if (!dest) return;
    const sameOrigin = new URL(dest).origin === location.origin;
    if (sameOrigin) location.href = dest;
    else window.open(dest,'_blank','noopener,noreferrer');
  }

  function stopAuto(){
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
  }

  function startAuto(){
    stopAuto();
    if (state.ads.length <= 1 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    state.timer = setInterval(() => showSlide(state.index + 1), 5000);
  }

  function showSlide(index){
    if (!state.ads.length) return;
    state.index = (index + state.ads.length) % state.ads.length;
    document.querySelectorAll('#gh-publicidad-carousel .gh-ad-slide').forEach((el,i) => el.classList.toggle('is-active', i === state.index));
    document.querySelectorAll('#gh-publicidad-carousel .gh-ad-dot').forEach((el,i) => el.classList.toggle('is-active', i === state.index));
  }

  function renderCarousel(ads){
    const box = carouselContainer();
    if (!box) return;
    state.ads = ads.filter(a => a.active && a.image);
    if (!state.ads.length){
      stopAuto();
      box.classList.remove('is-visible');
      box.innerHTML = '';
      return;
    }
    state.index = Math.min(state.index, state.ads.length - 1);
    const slides = state.ads.map((ad,i) => {
      const title = escapeHtml(ad.title || 'Publicidad');
      const linkClass = safeDestination(ad.link) ? ' is-link' : '';
      return `<button type="button" class="gh-ad-slide${i===state.index?' is-active':''}${linkClass}" data-ad-index="${i}" aria-label="${title}">
        <img src="${escapeHtml(ad.image)}" alt="${title}" loading="${i===0?'eager':'lazy'}">
        ${ad.title ? `<span class="gh-ad-caption">${title}</span>` : ''}
      </button>`;
    }).join('');
    const arrows = state.ads.length > 1
      ? `<button type="button" class="gh-ad-nav prev" aria-label="Publicidad anterior">‹</button>
         <button type="button" class="gh-ad-nav next" aria-label="Publicidad siguiente">›</button>`
      : '';
    const dots = state.ads.length > 1
      ? `<div class="gh-ad-dots">${state.ads.map((_,i)=>`<button type="button" class="gh-ad-dot${i===state.index?' is-active':''}" data-dot="${i}" aria-label="Ir a publicidad ${i+1}"></button>`).join('')}</div>`
      : '';
    box.innerHTML = `<div class="gh-ads-kicker">Publicidad</div>
      <div class="gh-ads-carousel"><div class="gh-ads-track">${slides}</div>${arrows}</div>${dots}`;
    box.classList.add('is-visible');

    box.querySelectorAll('[data-ad-index]').forEach(el => el.addEventListener('click', () => openAd(state.ads[Number(el.dataset.adIndex)])));
    box.querySelector('.gh-ad-nav.prev')?.addEventListener('click', (e) => { e.stopPropagation(); showSlide(state.index - 1); startAuto(); });
    box.querySelector('.gh-ad-nav.next')?.addEventListener('click', (e) => { e.stopPropagation(); showSlide(state.index + 1); startAuto(); });
    box.querySelectorAll('[data-dot]').forEach(el => el.addEventListener('click', () => { showSlide(Number(el.dataset.dot)); startAuto(); }));

    let startX = null;
    const track = box.querySelector('.gh-ads-track');
    track?.addEventListener('pointerdown', e => { startX = e.clientX; }, {passive:true});
    track?.addEventListener('pointerup', e => {
      if (startX == null) return;
      const dx = e.clientX - startX;
      startX = null;
      if (Math.abs(dx) < 45) return;
      showSlide(state.index + (dx < 0 ? 1 : -1));
      startAuto();
    }, {passive:true});
    startAuto();
  }

  async function refreshClientAds(){
    try{
      const data = await loadData();
      renderCarousel(normalizeAds(data));
    }catch(e){
      console.warn('[Publicidad]', e.message);
    }
  }

  function initClient(){
    if (state.clientReady) return;
    state.clientReady = true;
    addStyles();
    carouselContainer();
    refreshClientAds();
    state.refreshTimer = setInterval(() => {
      if (!document.hidden) refreshClientAds();
    }, 30000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopAuto();
      else { refreshClientAds(); startAuto(); }
    });
  }

  function panelView(){
    let view = $('vista-publicidad');
    if (view) return view;
    const main = $('main');
    if (!main) return null;
    view = document.createElement('div');
    view.id = 'vista-publicidad';
    view.className = 'gh-ads-admin';
    view.innerHTML = `
      <div class="gh-head">
        <div>
          <h2>📣 Publicidad</h2>
          <div class="gh-muted">Lo que publiques aquí aparece en el carrusel del inicio del cliente.</div>
        </div>
      </div>
      <div class="gh-ad-form">
        <div class="gh-ad-form-grid">
          <div>
            <label for="gh-ad-file">Imagen publicitaria</label>
            <div class="gh-ad-image-box" id="gh-ad-image-box" tabindex="0" role="button" aria-label="Seleccionar imagen">
              <img id="gh-ad-preview" alt="Vista previa de publicidad">
              <div class="gh-upload-copy">📷 Toca para seleccionar una imagen<br><small>Recomendado: formato horizontal, 1600 × 700 px aprox.</small></div>
            </div>
            <input type="file" id="gh-ad-file" accept="image/*" style="display:none">
          </div>
          <div class="gh-ad-form-fields">
            <div class="field">
              <label for="gh-ad-title">Título opcional</label>
              <input id="gh-ad-title" maxlength="90" placeholder="Ej: 20% de descuento este fin de semana">
            </div>
            <div class="field">
              <label for="gh-ad-link">Enlace opcional</label>
              <input id="gh-ad-link" maxlength="400" placeholder="https://... o una página de la plataforma">
            </div>
            <div class="field">
              <label for="gh-ad-order">Orden</label>
              <input id="gh-ad-order" type="number" min="1" max="999" value="1">
            </div>
            <label class="gh-ad-active"><input id="gh-ad-active" type="checkbox" checked> Publicidad activa</label>
            <div class="gh-ad-actions">
              <button class="btn btn-primary" type="button" id="gh-ad-save">Guardar publicidad</button>
              <button class="btn btn-ghost" type="button" id="gh-ad-cancel" style="display:none">Cancelar edición</button>
            </div>
            <div class="gh-muted" id="gh-ad-status-text" style="margin-top:10px"></div>
          </div>
        </div>
      </div>
      <div id="gh-ad-list" class="gh-ad-list"></div>`;
    main.appendChild(view);

    $('gh-ad-image-box')?.addEventListener('click', () => $('gh-ad-file')?.click());
    $('gh-ad-image-box')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('gh-ad-file')?.click(); }
    });
    $('gh-ad-file')?.addEventListener('change', onAdminFile);
    $('gh-ad-save')?.addEventListener('click', saveAdminAd);
    $('gh-ad-cancel')?.addEventListener('click', resetAdminForm);
    return view;
  }

  function panelButton(){
    let btn = $('tab-publicidad');
    const row = $('tab-pedidos')?.parentElement;
    if (!row) return btn || null;
    row.style.flexWrap = 'wrap';
    if (!btn){
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost';
      btn.id = 'tab-publicidad';
      btn.style.flex = '1';
      btn.style.minWidth = '150px';
      btn.textContent = '📣 Publicidad';
      const anchor = $('tab-qr-public') || $('tab-ajustes');
      row.insertBefore(btn, anchor || null);
    }
    if (btn && !btn.dataset.ghAdsBound){
      btn.dataset.ghAdsBound = '1';
      btn.addEventListener('click', openPanel);
    }
    return btn;
  }

  function syncPanelPermission(){
    const btn = $('tab-publicidad');
    const settings = $('tab-ajustes');
    if (!btn || !settings) return;
    const hidden = settings.style.display === 'none' || getComputedStyle(settings).display === 'none';
    btn.style.display = hidden ? 'none' : '';
  }

  function hideAdminView(){
    $('vista-publicidad')?.classList.remove('is-open');
    const btn = $('tab-publicidad');
    if (btn) btn.className = 'btn btn-ghost';
  }

  function hideKnownPanelViews(){
    ['vista-pedidos','vista-informes','vista-usuarios','vista-ajustes','vista-configuracion'].forEach(id => {
      const el = $(id);
      if (el) el.style.display = 'none';
    });
    ['tab-pedidos','tab-informes','tab-usuarios','tab-ajustes','tab-qr-public'].forEach(id => {
      const el = $(id);
      if (el && id !== 'tab-qr-public') el.className = 'btn btn-ghost';
    });
  }

  async function openPanel(){
    addStyles();
    const view = panelView();
    const btn = panelButton();
    if (!view || !btn) return;
    hideKnownPanelViews();
    view.style.display = 'block';
    view.classList.add('is-open');
    btn.className = 'btn btn-primary';
    await renderAdminAds();
  }

  function patchPanelNavigation(){
    if (state.originalCambiarVistaPanel || typeof window.cambiarVistaPanel !== 'function') return;
    state.originalCambiarVistaPanel = window.cambiarVistaPanel;
    window.cambiarVistaPanel = function(v){
      if (v === 'publicidad') return openPanel();
      hideAdminView();
      const view = $('vista-publicidad');
      if (view) view.style.display = 'none';
      return state.originalCambiarVistaPanel.apply(this, arguments);
    };
  }

  async function fileToCompressedDataUrl(file){
    if (!file || !file.type.startsWith('image/')) throw new Error('Selecciona una imagen válida.');
    const raw = await new Promise((resolve,reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      r.readAsDataURL(file);
    });
    const img = await new Promise((resolve,reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('No se pudo procesar la imagen.'));
      im.src = raw;
    });
    const maxW = 1600, maxH = 900;
    const scale = Math.min(1, maxW / img.width, maxH / img.height);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.84);
  }

  async function onAdminFile(e){
    const file = e.target.files?.[0];
    if (!file) return;
    const status = $('gh-ad-status-text');
    try{
      if (status) status.textContent = 'Procesando imagen...';
      state.pendingImage = await fileToCompressedDataUrl(file);
      const box = $('gh-ad-image-box');
      const preview = $('gh-ad-preview');
      if (preview) preview.src = state.pendingImage;
      box?.classList.add('has-image');
      if (status) status.textContent = 'Imagen lista para guardar.';
    }catch(err){
      if (status) status.textContent = err.message;
    }
  }

  function resetAdminForm(){
    state.editingId = null;
    state.pendingImage = '';
    if ($('gh-ad-title')) $('gh-ad-title').value = '';
    if ($('gh-ad-link')) $('gh-ad-link').value = '';
    if ($('gh-ad-order')) $('gh-ad-order').value = String((state.ads.length || 0) + 1);
    if ($('gh-ad-active')) $('gh-ad-active').checked = true;
    if ($('gh-ad-file')) $('gh-ad-file').value = '';
    const box = $('gh-ad-image-box');
    box?.classList.remove('has-image');
    if ($('gh-ad-preview')) $('gh-ad-preview').removeAttribute('src');
    if ($('gh-ad-cancel')) $('gh-ad-cancel').style.display = 'none';
    if ($('gh-ad-save')) $('gh-ad-save').textContent = 'Guardar publicidad';
    if ($('gh-ad-status-text')) $('gh-ad-status-text').textContent = '';
  }

  function editAdminAd(id){
    const ad = state.ads.find(x => x.id === id);
    if (!ad) return;
    state.editingId = id;
    state.pendingImage = ad.image;
    $('gh-ad-title').value = ad.title;
    $('gh-ad-link').value = ad.link;
    $('gh-ad-order').value = String(ad.order);
    $('gh-ad-active').checked = ad.active;
    $('gh-ad-preview').src = ad.image;
    $('gh-ad-image-box').classList.add('has-image');
    $('gh-ad-cancel').style.display = '';
    $('gh-ad-save').textContent = 'Guardar cambios';
    $('gh-ad-status-text').textContent = 'Editando publicidad.';
    $('gh-ad-title').focus();
  }

  async function saveAdminAd(){
    const btn = $('gh-ad-save');
    const status = $('gh-ad-status-text');
    const title = $('gh-ad-title')?.value.trim() || '';
    const link = $('gh-ad-link')?.value.trim() || '';
    const order = Math.max(1, Math.min(999, Math.round(safeNumber($('gh-ad-order')?.value, 1))));
    const active = !!$('gh-ad-active')?.checked;
    if (!state.pendingImage){
      if (status) status.textContent = 'Selecciona una imagen publicitaria.';
      return;
    }
    if (link && !safeDestination(link)){
      if (status) status.textContent = 'El enlace debe ser una URL http/https válida o una ruta de esta plataforma.';
      return;
    }
    if (btn){ btn.disabled = true; btn.textContent = 'Guardando...'; }
    try{
      const data = await loadData();
      if (!Array.isArray(data.publicidad)) data.publicidad = [];
      const now = Date.now();
      if (state.editingId){
        const idx = data.publicidad.findIndex(x => String(x?.id) === state.editingId);
        const prev = idx >= 0 ? normalizeAd(data.publicidad[idx], idx) : null;
        const next = {
          id: state.editingId,
          title,
          image: state.pendingImage,
          link,
          order,
          active,
          createdAt: prev?.createdAt || now,
          updatedAt: now
        };
        if (idx >= 0) data.publicidad[idx] = next;
        else data.publicidad.push(next);
      }else{
        data.publicidad.push({
          id: `ad-${now}-${Math.random().toString(36).slice(2,8)}`,
          title,
          image: state.pendingImage,
          link,
          order,
          active,
          createdAt: now,
          updatedAt: now
        });
      }
      await saveData(data);
      if (status) status.textContent = 'Publicidad guardada y publicada.';
      resetAdminForm();
      await renderAdminAds();
    }catch(err){
      console.error('[Publicidad]',err);
      if (status) status.textContent = 'No se pudo guardar: ' + err.message;
    }finally{
      if (btn){ btn.disabled = false; btn.textContent = state.editingId ? 'Guardar cambios' : 'Guardar publicidad'; }
    }
  }

  async function toggleAdminAd(id){
    try{
      const data = await loadData();
      if (!Array.isArray(data.publicidad)) return;
      const idx = data.publicidad.findIndex(x => String(x?.id) === id);
      if (idx < 0) return;
      const ad = normalizeAd(data.publicidad[idx], idx);
      data.publicidad[idx] = { ...ad, active: !ad.active, updatedAt: Date.now() };
      await saveData(data);
      await renderAdminAds();
    }catch(err){
      alert('No se pudo cambiar el estado: ' + err.message);
    }
  }

  async function deleteAdminAd(id){
    const ad = state.ads.find(x => x.id === id);
    if (!ad) return;
    if (!confirm(`¿Eliminar esta publicidad${ad.title ? `: ${ad.title}` : ''}?`)) return;
    try{
      const data = await loadData();
      if (!Array.isArray(data.publicidad)) return;
      data.publicidad = data.publicidad.filter(x => String(x?.id) !== id);
      await saveData(data);
      if (state.editingId === id) resetAdminForm();
      await renderAdminAds();
    }catch(err){
      alert('No se pudo eliminar: ' + err.message);
    }
  }

  async function renderAdminAds(){
    const list = $('gh-ad-list');
    if (!list) return;
    list.innerHTML = '<div class="gh-empty">Cargando publicidad...</div>';
    try{
      const data = await loadData();
      state.ads = normalizeAds(data);
      if (!$('gh-ad-order')?.value) $('gh-ad-order').value = String(state.ads.length + 1);
      if (!state.ads.length){
        list.innerHTML = '<div class="gh-empty">Todavía no hay publicidad. Sube la primera imagen arriba.</div>';
        return;
      }
      list.innerHTML = state.ads.map(ad => `
        <div class="gh-ad-row" data-ad-id="${escapeHtml(ad.id)}">
          <img src="${escapeHtml(ad.image)}" alt="${escapeHtml(ad.title || 'Publicidad')}">
          <div style="min-width:0">
            <div class="gh-ad-row-title">${escapeHtml(ad.title || 'Publicidad sin título')}</div>
            <div class="gh-ad-row-meta">Orden ${ad.order}${ad.link ? ' · Con enlace' : ' · Sin enlace'}</div>
            <span class="gh-ad-status ${ad.active?'on':'off'}">${ad.active?'ACTIVA':'PAUSADA'}</span>
          </div>
          <div class="gh-ad-row-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-action="edit">Editar</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="toggle">${ad.active?'Pausar':'Activar'}</button>
            <button type="button" class="btn btn-danger-ghost btn-sm" data-action="delete">Eliminar</button>
          </div>
        </div>`).join('');
      list.querySelectorAll('[data-ad-id]').forEach(row => {
        const id = row.dataset.adId;
        row.querySelector('[data-action="edit"]')?.addEventListener('click', () => editAdminAd(id));
        row.querySelector('[data-action="toggle"]')?.addEventListener('click', () => toggleAdminAd(id));
        row.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteAdminAd(id));
      });
    }catch(err){
      list.innerHTML = `<div class="gh-empty">No se pudo cargar publicidad: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function initPanel(){
    if (state.panelReady) return;
    state.panelReady = true;
    addStyles();
    for(let i=0;i<60 && !$('tab-pedidos');i++) await sleep(200);
    panelButton();
    panelView();
    patchPanelNavigation();
    syncPanelPermission();
    setInterval(syncPanelPermission, 1000);
  }

  async function init(){
    const kind = pageKind();
    if (kind === 'client') initClient();
    else if (kind === 'panel') initPanel();
  }

  window.GoHouseAds = {
    openPanel,
    refreshClientAds,
    renderAdminAds
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();