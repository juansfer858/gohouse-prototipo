/* Asistente de instalación PWA para Cliente y Domiciliario.
   Android/Chromium: usa beforeinstallprompt cuando está disponible.
   iPhone/iPad: guía visual Compartir -> Agregar a pantalla de inicio -> Agregar. */
(() => {
  'use strict';
  if (window.GoHouseInstall) return;

  const $ = id => document.getElementById(id);
  const kind = (() => {
    const p = location.pathname.toLowerCase();
    if (p.includes('/panel') || p.includes('gohouse-panel')) return 'panel';
    if (p.includes('/domiciliario') || p.includes('gohouse-domiciliarios')) return 'driver';
    return 'client';
  })();
  if (kind === 'panel') return;

  const DISMISS_KEY = `gohouse-install-dismissed-${kind}`;
  const DISMISS_MS = 24 * 60 * 60 * 1000;
  let deferredPrompt = null;
  let installed = false;
  let modalShown = false;

  function brand(){
    const cfg = window.GoHouseBrand?.config || {};
    return {
      name: String(cfg.brandName || 'Domicilios').trim(),
      short: String(cfg.shortName || cfg.brandName || 'Domicilios').trim(),
      logo: String(cfg.appIconUrl || cfg.logoUrl || '').trim(),
      primary: String(cfg.primaryColor || '#E8863A').trim()
    };
  }

  function isStandalone(){
    return window.matchMedia?.('(display-mode: standalone)').matches ||
      window.matchMedia?.('(display-mode: fullscreen)').matches ||
      navigator.standalone === true;
  }

  function isIOS(){
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isAndroid(){ return /android/i.test(navigator.userAgent); }

  function recentlyDismissed(){
    try {
      const ts = Number(localStorage.getItem(DISMISS_KEY) || 0);
      return ts > 0 && (Date.now() - ts) < DISMISS_MS;
    } catch { return false; }
  }

  function rememberDismiss(){
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
  }

  function clearDismiss(){
    try { localStorage.removeItem(DISMISS_KEY); } catch {}
  }

  function ensureStyle(){
    if ($('gh-install-style')) return;
    const st = document.createElement('style');
    st.id = 'gh-install-style';
    st.textContent = `
      #gh-install-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(4,10,16,.76);display:flex;align-items:flex-end;justify-content:center;padding:14px;padding-bottom:calc(14px + env(safe-area-inset-bottom));backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
      #gh-install-card{width:min(520px,100%);max-height:min(760px,calc(100dvh - 28px));overflow:auto;background:var(--surface,#16273D);color:var(--text,#EAF1F7);border:1px solid var(--line,#2A415F);border-radius:22px;padding:20px;box-shadow:0 24px 70px rgba(0,0,0,.45);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .gh-install-brand{display:flex;align-items:center;gap:12px;margin-bottom:14px}.gh-install-icon{width:54px;height:54px;border-radius:14px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--surface-2,#1D3350);border:1px solid var(--line,#2A415F);font-size:28px;flex:none}.gh-install-icon img{width:100%;height:100%;object-fit:cover}.gh-install-name{font-size:.77rem;color:var(--text-dim,#93A7BE)}
      .gh-install-title{font-size:1.25rem;font-weight:800;line-height:1.2;margin:0}.gh-install-copy{font-size:.9rem;line-height:1.45;color:var(--text-dim,#A9B8B0);margin:10px 0 16px}.gh-install-actions{display:grid;gap:9px}.gh-install-primary,.gh-install-secondary{width:100%;min-height:50px;border-radius:12px;font-weight:800;font-size:1rem;padding:12px 16px;cursor:pointer}.gh-install-primary{border:0;background:var(--gh-install-primary,var(--mango,var(--teal,#E8863A)));color:#111}.gh-install-secondary{border:1px solid var(--line,#2A415F);background:transparent;color:var(--text,#EAF1F7)}
      .gh-ios-steps{display:grid;gap:10px;margin:14px 0 18px}.gh-ios-step{display:grid;grid-template-columns:38px minmax(0,1fr);gap:10px;align-items:center;background:var(--bg,#0F1B2B);border:1px solid var(--line,#2A415F);border-radius:12px;padding:10px 12px}.gh-ios-num{width:32px;height:32px;border-radius:999px;background:var(--gh-install-primary,var(--mango,var(--teal,#E8863A)));color:#111;font-weight:900;display:flex;align-items:center;justify-content:center}.gh-ios-step b{display:block;font-size:.92rem}.gh-ios-step span{display:block;font-size:.78rem;color:var(--text-dim,#93A7BE);margin-top:2px}.gh-share-icon{display:inline-flex;align-items:center;justify-content:center;border:1px solid currentColor;border-radius:5px;width:22px;height:22px;margin:0 3px;font-size:16px;line-height:1;vertical-align:middle}.gh-install-tip{font-size:.74rem;color:var(--text-dim,#93A7BE);text-align:center;margin-top:10px}
      @media(min-width:700px){#gh-install-backdrop{align-items:center}}
      @media(max-width:430px){#gh-install-card{border-radius:18px;padding:17px}.gh-install-title{font-size:1.15rem}}
    `;
    document.head.appendChild(st);
  }

  function close({remember=true}={}){
    $('gh-install-backdrop')?.remove();
    modalShown = false;
    if (remember) rememberDismiss();
  }

  function commonHeader(){
    const b = brand();
    return `<div class="gh-install-brand">
      <div class="gh-install-icon">${b.logo ? `<img src="${escapeHtml(b.logo)}" alt="Logo ${escapeHtml(b.name)}">` : '🏠'}</div>
      <div><div class="gh-install-name">${kind === 'driver' ? 'App para domiciliarios' : 'App para clientes'}</div><h2 class="gh-install-title">Instala ${escapeHtml(b.name)}</h2></div>
    </div>`;
  }

  function escapeHtml(v){
    return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function renderIOS(){
    const b = brand();
    return `${commonHeader()}
      <div class="gh-install-copy">Úsala como una aplicación normal desde tu pantalla de inicio. En iPhone o iPad son tres pasos:</div>
      <div class="gh-ios-steps">
        <div class="gh-ios-step"><div class="gh-ios-num">1</div><div><b>Toca Compartir <span class="gh-share-icon">↑</span></b><span>Está en la barra del navegador.</span></div></div>
        <div class="gh-ios-step"><div class="gh-ios-num">2</div><div><b>Elige “Agregar a pantalla de inicio”</b><span>Si no lo ves, desplázate hacia abajo en el menú.</span></div></div>
        <div class="gh-ios-step"><div class="gh-ios-num">3</div><div><b>Toca “Agregar”</b><span>Luego abre el ícono de ${escapeHtml(b.short)} desde tu pantalla de inicio.</span></div></div>
      </div>
      <div class="gh-install-actions"><button type="button" class="gh-install-secondary" id="gh-install-later">Continuar en el navegador</button></div>`;
  }

  function renderPromptCapable(){
    const b = brand();
    const deviceCopy = isAndroid()
      ? 'Instálala para abrirla como una app, sin buscar este enlace cada vez.'
      : 'Puedes instalarla en este dispositivo para abrirla como una aplicación.';
    return `${commonHeader()}
      <div class="gh-install-copy">${deviceCopy}</div>
      <div class="gh-install-actions">
        <button type="button" class="gh-install-primary" id="gh-install-now">Instalar aplicación</button>
        <button type="button" class="gh-install-secondary" id="gh-install-later">Ahora no</button>
      </div>
      <div class="gh-install-tip">Si ya la instalaste, abre el ícono de ${escapeHtml(b.short)} desde tu pantalla de inicio.</div>`;
  }

  function renderFallback(){
    const b = brand();
    return `${commonHeader()}
      <div class="gh-install-copy">Para tenerla como aplicación, abre el menú de tu navegador y busca <b>“Instalar aplicación”</b> o <b>“Agregar a pantalla de inicio”</b>.</div>
      <div class="gh-install-actions"><button type="button" class="gh-install-secondary" id="gh-install-later">Continuar en el navegador</button></div>
      <div class="gh-install-tip">Después podrás abrir ${escapeHtml(b.short)} directamente desde tu pantalla de inicio.</div>`;
  }

  function show(force=false){
    if (isStandalone() || installed || modalShown) return;
    if (!force && recentlyDismissed()) return;
    ensureStyle();
    const b = brand();
    document.documentElement.style.setProperty('--gh-install-primary', b.primary);
    const backdrop = document.createElement('div');
    backdrop.id = 'gh-install-backdrop';
    backdrop.setAttribute('role','dialog');
    backdrop.setAttribute('aria-modal','true');
    backdrop.setAttribute('aria-label','Instalar aplicación');
    const card = document.createElement('div');
    card.id = 'gh-install-card';
    card.innerHTML = isIOS() ? renderIOS() : (deferredPrompt ? renderPromptCapable() : renderFallback());
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    modalShown = true;

    $('gh-install-later')?.addEventListener('click', () => close({remember:true}));
    $('gh-install-now')?.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      const prompt = deferredPrompt;
      deferredPrompt = null;
      try {
        prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice?.outcome === 'accepted') {
          clearDismiss();
          installed = true;
          close({remember:false});
        }
      } catch (err) {
        console.warn('[PWA install]', err);
      }
    });
  }

  function refreshModalForPrompt(){
    if (!modalShown || isIOS()) return;
    const card = $('gh-install-card');
    if (!card) return;
    card.innerHTML = renderPromptCapable();
    $('gh-install-later')?.addEventListener('click', () => close({remember:true}));
    $('gh-install-now')?.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      const prompt = deferredPrompt;
      deferredPrompt = null;
      prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === 'accepted') {
        clearDismiss();
        installed = true;
        close({remember:false});
      }
    });
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    refreshModalForPrompt();
  });

  window.addEventListener('appinstalled', () => {
    installed = true;
    clearDismiss();
    close({remember:false});
  });

  function init(){
    if (isStandalone()) return;
    const run = () => setTimeout(() => show(false), 350);
    if (window.GoHouseBrand?.ready) window.GoHouseBrand.ready.then(run).catch(run);
    else run();
  }

  window.GoHouseInstall = { show: () => show(true), close, isStandalone };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
