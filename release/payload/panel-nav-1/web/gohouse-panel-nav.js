/* GoHouse panel navigation lifecycle.
   Garantiza que cada pestaña nativa se restaure y se renderice al volver a ella. */
(() => {
  'use strict';
  if (window.GoHousePanelNav) return;

  const $ = id => document.getElementById(id);
  const nativeTabs = {
    'tab-pedidos':  { view:'vista-pedidos',  panel:'pedidos' },
    'tab-informes': { view:'vista-informes', panel:'informes' },
    'tab-usuarios': { view:'vista-usuarios',  panel:'usuarios' },
    'tab-ajustes':  { view:'vista-ajustes',   panel:'ajustes' }
  };

  function isPanel(){
    const p = location.pathname.toLowerCase();
    return p.includes('/panel') || p.includes('gohouse-panel');
  }

  function setButtonState(activeId){
    ['tab-pedidos','tab-informes','tab-usuarios','tab-mensajes','tab-publicidad','tab-qr','tab-qr-public','tab-ajustes'].forEach(id => {
      const el = $(id);
      if (!el) return;
      el.className = 'btn ' + (id === activeId ? 'btn-primary' : 'btn-ghost');
    });
  }

  function closeAddonViews(){
    const messages = $('vista-mensajes');
    if (messages){
      messages.classList.remove('is-open');
      messages.style.display = 'none';
    }
    const ads = $('vista-publicidad');
    if (ads){
      ads.classList.remove('is-open');
      ads.style.display = 'none';
    }
  }

  function restoreNative(tabId){
    const cfg = nativeTabs[tabId];
    if (!cfg) return;

    closeAddonViews();
    Object.values(nativeTabs).forEach(item => {
      const view = $(item.view);
      if (view) view.style.display = item.view === cfg.view ? 'block' : 'none';
    });
    setButtonState(tabId);

    try {
      if (typeof window.render === 'function') window.render();
    } catch (err) {
      console.warn('[PanelNav] render()', err);
    }

    try {
      if (cfg.panel === 'informes' && typeof window.renderInformes === 'function') window.renderInformes();
      if (cfg.panel === 'usuarios' && typeof window.renderUsuarios === 'function') window.renderUsuarios();
      if (cfg.panel === 'ajustes' && typeof window.renderAjustes === 'function') window.renderAjustes();
    } catch (err) {
      console.warn('[PanelNav] render view', err);
    }
  }

  function refreshAddon(tabId){
    if (tabId === 'tab-mensajes'){
      setTimeout(() => {
        try { window.GoHouseAppShell?.renderPanelMessages?.(); } catch {}
      }, 0);
      return;
    }
    if (tabId === 'tab-publicidad'){
      setTimeout(() => {
        try { window.GoHouseAds?.openPanel?.(); } catch {}
      }, 0);
    }
  }

  function handleTabClick(event){
    const tab = event.target?.closest?.('button[id^="tab-"]');
    if (!tab) return;
    const id = tab.id;

    if (nativeTabs[id]){
      setTimeout(() => restoreNative(id), 0);
      requestAnimationFrame(() => requestAnimationFrame(() => restoreNative(id)));
      return;
    }
    refreshAddon(id);
  }

  function init(){
    if (!isPanel()) return;
    document.addEventListener('click', handleTabClick, false);
    window.addEventListener('pageshow', () => {
      const active = Object.keys(nativeTabs).find(id => $(id)?.classList.contains('btn-primary'));
      if (active) setTimeout(() => restoreNative(active), 0);
    });
  }

  window.GoHousePanelNav = { restoreNative };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
