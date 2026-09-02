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
    // La sesión anónima/restaurada del cliente puede terminar unos instantes
    // después de que cargue este módulo. Reintentamos de forma acotada para
    // que el carrusel aparezca en el primer ingreso, sin esperar el ciclo de 30 s.
    [700, 1800, 3500, 6500].forEach(delay => {
      setTimeout(() => { if (!document.hidden) refreshClientAds(); }, delay);
    });
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
              <div class="gh-upload-copy">📷<br><strong>Seleccionar imagen</strong><br>Recomendado: 1600 × 700 px</div>
            </div>
            <input id="gh-ad-file" type="file" accept="image/png,image/jpeg,image/webp" style="display:none">
          </div>
          <div class="gh-ad-form-fields">
            <label for="gh-ad-title">Título opcional</label>
            <input id="gh-ad-title" maxlength="90" placeholder="Ej: 20% de descuento este fin de semana">
            <div style="height:9px"></div>
            <label for="gh-ad-link">Enlace opcional</label>
            <input id="gh-ad-link" maxlength="500" placeholder="https://... o una página de la plataforma">
            <div style="height:9px"></div>
            <label for="gh-ad-order">Orden</label>
            <input id="gh-ad-order" type="number" min="1" max="999" value="1">
            <label class="gh-ad-active"><input id="gh-ad-active" type="checkbox" checked> Publicidad activa</label>
            <div class="gh-ad-actions">
              <button class="btn btn-primary" type="button" id="gh-ad-save">Guardar publicidad</button>
              <button class="btn btn-ghost" type="button" id="gh-ad-cancel" style="display:none">Cancelar edición</button>
            </div>
            <div class="gh-muted" id="gh-ad-status-text" style="margin-top:9px"></div>
          </div>
        </div>
      </div>
      <div id="gh-ad-list" class="gh-ad-list"><div class="gh-empty">Cargando publicidad...</div></div>`;
    main.appendChild(view);
    return view;
  }

  function panelButton(){
    let btn = $('tab-publicidad');
    if (btn) return btn;
    const bar = $('tab-pedidos')?.parentElement;
    if (!bar) return null;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost';
    btn.style.flex = '1';
    btn.style.minWidth = '145px';
    btn.id = 'tab-publicidad';
    btn.textContent = '📣 Publicidad';
    const anchor = $('tab-qr-public') || $('tab-ajustes');
    if (anchor) bar.insertBefore(btn, anchor);
    else bar.appendChild(btn);
    return btn;
  }

  function hideBaseViews(){
    ['vista-pedidos','vista-informes','vista-usuarios','vista-ajustes','vista-qr'].forEach(id => {
      const el = $(id); if (el) el.style.display = 'none';
    });
    $('vista-publicidad')?.classList.add('is-open');
    ['tab-pedidos','tab-informes','tab-usuarios','tab-ajustes','tab-qr-public'].forEach(id => {
      const el = $(id);
      if (el && id !== 'tab-qr-public') el.className = 'btn btn-ghost';
    });
    const btn = $('tab-publicidad');
    if (btn) btn.className = 'btn btn-primary';
  }

  function closePanelView(){
    $('vista-publicidad')?.classList.remove('is-open');
    const btn = $('tab-publicidad');
    if (btn) btn.className = 'btn btn-ghost';
  }

  function patchPanelNavigation(){
    const btn = panelButton();
    if (btn && !btn.dataset.ghAdsBound){
      btn.dataset.ghAdsBound = '1';
      btn.addEventListener('click', openPanel);
    }
    if (!state.originalCambiarVistaPanel && typeof window.cambiarVistaPanel === 'function'){
      state.originalCambiarVistaPanel = window.cambiarVistaPanel;
      window.cambiarVistaPanel = function(v){
        if (v === 'publicidad') return openPanel();
        closePanelView();
        return state.originalCambiarVistaPanel.apply(this, arguments);
      };
    }
  }

  async function openPanel(){
    const view = panelView();
    if (!view) return;
    hideBaseViews();
    bindPanelEvents();
    await renderAdminAds();
  }

  function syncPanelPermission(){
    const btn = panelButton();
    if (!btn) return;
    const role = String(window.rolActual || '').toLowerCase();
    btn.style.display = role === 'administrador' || role === 'operador' || role === 'lectura' || !role ? '' : 'none';
  }

  function bindPanelEvents(){
    const file = $('gh-ad-file');
    const box = $('gh-ad-image-box');
    if (!file || file.dataset.bound) return;
    file.dataset.bound = '1';
    box?.addEventListener('click', () => file.click());
    box?.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); file.click(); } });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      try{
        state.pendingImage = await compressImage(f, 1600, 0.84);
        const preview = $('gh-ad-preview');
        if (preview) preview.src = state.pendingImage;
        box?.classList.add('has-image');
        $('gh-ad-status-text').textContent = 'Imagen lista para guardar.';
      }catch(err){
        alert('No se pudo preparar la imagen: ' + err.message);
      }
    });
    $('gh-ad-save')?.addEventListener('click', saveAdminAd);
    $('gh-ad-cancel')?.addEventListener('click', resetAdminForm);
  }

  function compressImage(file, maxWidth=1600, quality=.84){
    return new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('La imagen no es válida.'));
        img.onload = () => {
          const scale = Math.min(1, maxWidth / img.width);
          const width = Math.max(1, Math.round(img.width * scale));
          const height = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img,0,0,width,height);
          resolve(canvas.toDataURL('image/jpeg',quality));
        };
        img.src = String(reader.result || '');
      };
      reader.readAsDataURL(file);
    });
  }

  function resetAdminForm(){
    state.editingId = null;
    state.pendingImage = '';
    const file = $('gh-ad-file'); if(file) file.value = '';
    const title = $('gh-ad-title'); if(title) title.value = '';
    const link = $('gh-ad-link'); if(link) link.value = '';
    const order = $('gh-ad-order'); if(order) order.value = String((state.ads?.length || 0) + 1);
    const active = $('gh-ad-active'); if(active) active.checked = true;
    const box = $('gh-ad-image-box'); box?.classList.remove('has-image');
    const preview = $('gh-ad-preview'); if(preview) preview.removeAttribute('src');
    const cancel = $('gh-ad-cancel'); if(cancel) cancel.style.display = 'none';
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
    const preview = $('gh-ad-preview'); preview.src = ad.image;
    $('gh-ad-image-box')?.classList.add('has-image');
    $('gh-ad-cancel').style.display = '';
    $('gh-ad-save').textContent = 'Guardar cambios';
    $('gh-ad-status-text').textContent = 'Editando publicidad.';
    window.scrollTo({top:0,behavior:'smooth'});
  }

  async function saveAdminAd(){
    const btn = $('gh-ad-save');
    const status = $('gh-ad-status-text');
    try{
      const title = $('gh-ad-title').value.trim();
      const link = $('gh-ad-link').value.trim();
      const order = Math.min(999, Math.max(1, safeNumber($('gh-ad-order').value,1)));
      const active = $('gh-ad-active').checked;
      if (!state.pendingImage) throw new Error('Selecciona una imagen publicitaria.');
      const validLink = link ? safeDestination(link) : '';
      if (link && !validLink) throw new Error('El enlace no es válido. Usa http://, https:// o una ruta de la plataforma.');
      btn.disabled = true; btn.textContent = 'Guardando...';
      status.textContent = 'Subiendo y publicando...';
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
          link: validLink || '',
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
          link: validLink || '',
          order,
          active,
          createdAt: now,
          updatedAt: now
        });
      }
      await saveData(data);
      status.textContent = 'Publicidad guardada y publicada.';
      resetAdminForm();
      await renderAdminAds();
    }catch(err){
      status.textContent = 'No se pudo guardar: ' + err.message;
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
