/* GoHouse Web Push runtime.
   Registra Cliente, Domiciliario y Panel en el VPS y gestiona permiso + deep links. */
(() => {
  'use strict';
  if (window.GoHousePush) return;

  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const DISMISS_KEY = 'gohouse-push-dismiss-until-v1';
  let registration = null;
  let session = null;
  let subscribing = false;
  let panelObserver = null;

  function kind(){
    const p = location.pathname.toLowerCase();
    if (p.includes('/panel') || p.includes('gohouse-panel')) return 'panel';
    if (p.includes('/domiciliario') || p.includes('gohouse-domiciliarios')) return 'driver';
    return 'client';
  }

  function standalone(){
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function isiOS(){ return /iphone|ipad|ipod/i.test(navigator.userAgent); }
  function supported(){ return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function brand(){ return window.GoHouseBrand?.config?.brandName || document.documentElement.dataset.brandName || 'Domicilios'; }

  function copyFor(k){
    if (k === 'driver') return { title:'Activa las notificaciones', body:'Recibe nuevos domicilios y avisos importantes aunque no tengas la app abierta.' };
    if (k === 'panel') return { title:'Activa las notificaciones', body:'Recibe nuevos pedidos, mensajes de clientes y comprobantes de pago.' };
    return { title:'Activa las notificaciones', body:'Recibe cambios de tu pedido y mensajes de la empresa aunque cierres la app.' };
  }

  function addStyles(){
    if ($('gh-push-style')) return;
    const s=document.createElement('style');s.id='gh-push-style';s.textContent=`
      #gh-push-card{position:fixed;left:12px;right:12px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:2147482400;max-width:520px;margin:auto;background:var(--surface,#16273D);color:var(--text,#EAF1F7);border:1px solid var(--line,#2A415F);border-radius:16px;padding:14px 14px 12px;box-shadow:0 18px 45px rgba(0,0,0,.38);display:none}
      #gh-push-card.show{display:block}
      .gh-push-row{display:grid;grid-template-columns:46px minmax(0,1fr);gap:11px;align-items:start}.gh-push-icon{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:var(--teal-dim,#1B4A48);font-size:23px}.gh-push-title{font-weight:800;font-size:.98rem;margin:1px 0 4px}.gh-push-body{font-size:.79rem;line-height:1.35;color:var(--text-dim,#93A7BE)}.gh-push-actions{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:12px}.gh-push-enable,.gh-push-later{border:0;border-radius:10px;padding:11px 13px;font-weight:800;font-size:.86rem;cursor:pointer}.gh-push-enable{background:var(--teal,#34C6C0);color:#06201E}.gh-push-later{background:transparent;color:var(--text-dim,#93A7BE);border:1px solid var(--line,#2A415F)}
      @media(max-width:520px){#gh-push-card{left:8px;right:8px}.gh-push-actions{grid-template-columns:1fr}.gh-push-later{order:2}}
    `;document.head.appendChild(s);
  }

  function hideCard(){ $('gh-push-card')?.classList.remove('show'); }

  function panelButtonLabel(){
    if (!supported()) return '🔕 Notificaciones no compatibles';
    if (Notification.permission === 'granted') return '🔔 Notificaciones activas';
    if (Notification.permission === 'denied') return '🔕 Notificaciones bloqueadas';
    return '🔔 Activar notificaciones';
  }

  function updatePanelButton(){
    const btn=$('gh-panel-push-button');
    if(!btn)return;
    const label=panelButtonLabel();
    const permission=supported()?Notification.permission:'unsupported';
    const title=Notification.permission==='granted'
      ? 'Este panel recibirá nuevos pedidos, mensajes de clientes y comprobantes.'
      : Notification.permission==='denied'
        ? 'El navegador bloqueó las notificaciones. Habilítalas desde el candado de la barra de direcciones.'
        : 'Activar notificaciones para este panel.';
    if(btn.textContent!==label) btn.textContent=label;
    if(btn.dataset.permission!==permission) btn.dataset.permission=permission;
    if(btn.title!==title) btn.title=title;
  }

  function ensurePanelButton(){
    if(kind()!=='panel')return;
    const main=$('main'); if(!main)return;
    let btn=$('gh-panel-push-button');
    if(!btn){
      btn=document.createElement('button');
      btn.id='gh-panel-push-button';
      btn.type='button';
      btn.className='btn btn-ghost';
      btn.style.cssText='margin:0 0 12px 0;min-height:40px;width:100%;font-weight:800;';
      btn.addEventListener('click',async()=>{
        if(!supported()){
          window.showToast?.('Este navegador no admite notificaciones push.');
          return;
        }
        if(Notification.permission==='denied'){
          window.showToast?.('Las notificaciones están bloqueadas. Actívalas desde el candado del navegador y recarga el panel.');
          updatePanelButton();
          return;
        }
        btn.disabled=true;
        try{
          const ok=await enable();
          updatePanelButton();
          if(ok){
            window.showToast?.('Notificaciones del panel activadas.');
            try{
              const reg=registration || await navigator.serviceWorker.ready;
              await reg.showNotification(`${brand()} · Notificaciones activas`,{
                body:'Recibirás nuevos pedidos, mensajes de clientes y comprobantes.',
                icon:'/icon-192.png',
                badge:'/icon-192.png',
                tag:'panel-push-ready',
                data:{url:'/panel/'}
              });
            }catch{}
          }else if(Notification.permission!=='granted'){
            window.showToast?.('No se concedió permiso para notificaciones.');
          }
        }finally{
          btn.disabled=false;
          updatePanelButton();
        }
      });
      main.insertBefore(btn,main.firstChild);
    }
    updatePanelButton();
  }
  function showCard(){
    if (!supported() || Notification.permission !== 'default') return;
    if (isiOS() && !standalone()) return; // iOS permite Web Push desde la PWA instalada.
    const until=Number(localStorage.getItem(DISMISS_KEY)||0);if(Date.now()<until)return;
    addStyles();let card=$('gh-push-card');if(!card){
      const c=copyFor(kind());card=document.createElement('aside');card.id='gh-push-card';card.innerHTML=`<div class="gh-push-row"><div class="gh-push-icon">🔔</div><div><div class="gh-push-title">${c.title}</div><div class="gh-push-body">${c.body}</div></div></div><div class="gh-push-actions"><button class="gh-push-enable" type="button">Activar notificaciones</button><button class="gh-push-later" type="button">Ahora no</button></div>`;document.body.appendChild(card);
      card.querySelector('.gh-push-enable')?.addEventListener('click',enable);
      card.querySelector('.gh-push-later')?.addEventListener('click',()=>{localStorage.setItem(DISMISS_KEY,String(Date.now()+24*60*60*1000));hideCard();});
    }
    card.classList.add('show');
  }

  function b64ToBytes(value){
    const pad='='.repeat((4-value.length%4)%4),base64=(value+pad).replace(/-/g,'+').replace(/_/g,'/'),raw=atob(base64),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;
  }

  async function waitForSession(maxMs=45000){
    const started=Date.now();
    while(Date.now()-started<maxMs){
      if (window.GoHouseVPS?.api){
        try{session=await window.GoHouseVPS.api('/auth/session');if(session?.user)return session.user;}catch{}
      }
      await sleep(500);
    }
    return null;
  }

  async function ensureRegistration(){
    if (!supported()) throw new Error('PUSH_UNSUPPORTED');
    registration = await navigator.serviceWorker.register('/service-worker.js',{scope:'/'});
    await registration.update().catch(()=>{});
    return navigator.serviceWorker.ready;
  }

  async function saveSubscription(sub){
    if (!window.GoHouseVPS?.api) throw new Error('API_NOT_READY');
    await window.GoHouseVPS.api('/push/subscribe',{method:'POST',body:JSON.stringify({subscription:sub.toJSON ? sub.toJSON() : sub})});
    localStorage.setItem('gohouse-push-registered-v1',String(Date.now()));
  }

  async function subscribe(){
    if (subscribing) return false;subscribing=true;
    try{
      const user=session?.user || await waitForSession();if(!user)throw new Error('SESSION_NOT_READY');
      const reg=await ensureRegistration();
      const keyRes=await fetch('/api/push/public-key',{cache:'no-store'});if(!keyRes.ok)throw new Error('PUSH_KEY');
      const {publicKey}=await keyRes.json();if(!publicKey)throw new Error('PUSH_NOT_CONFIGURED');
      let sub=await reg.pushManager.getSubscription();
      if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToBytes(publicKey)});
      await saveSubscription(sub);hideCard();updatePanelButton();return true;
    }finally{subscribing=false;}
  }

  async function enable(){
    try{
      const permission=await Notification.requestPermission();
      if(permission!=='granted'){hideCard();updatePanelButton();return false;}
      const ok=await subscribe();updatePanelButton();return ok;
    }catch(err){console.warn('[Push]',err?.message||err);return false;}
  }

  async function silentBootstrap(){
    if(!supported())return;
    await ensureRegistration().catch(()=>null);
    if(Notification.permission==='granted'){
      for(let i=0;i<8;i++){try{if(await subscribe())return;}catch{}await sleep(2000);}
    }else if(Notification.permission==='default'){
      const user=await waitForSession(30000);if(user)setTimeout(showCard,1000);
    }
  }

  async function handleDeepLink(){
    const q=new URLSearchParams(location.search),open=q.get('open'),chat=q.get('chat');if(!open)return;
    if(kind()==='client'&&open==='chat'){
      for(let i=0;i<30;i++){if(typeof window.toggleChatSoporte==='function'){try{window.toggleChatSoporte();}catch{}break;}await sleep(250);}
    }else if(kind()==='panel'&&open==='mensajes'){
      for(let i=0;i<30;i++){const tab=$('tab-mensajes');if(tab){tab.click();break;}await sleep(250);}
      if(chat){for(let i=0;i<30;i++){const row=document.querySelector(`[data-chat-key="${CSS.escape(chat)}"]`);if(row){row.click();break;}await sleep(250);}}
    }else if(kind()==='panel'&&open==='pedidos'){
      for(let i=0;i<20;i++){const tab=$('tab-pedidos');if(tab){tab.click();break;}await sleep(250);}
    }
    try{history.replaceState(history.state,'',location.pathname+location.hash);}catch{}
  }

  async function init(){
    addStyles();
    navigator.serviceWorker?.addEventListener?.('message',e=>{if(e.data?.type==='notification-click')handleDeepLink();});
    window.addEventListener('appinstalled',()=>setTimeout(silentBootstrap,1200));
    if(kind()==='panel'){
      ensurePanelButton();
      panelObserver=new MutationObserver(()=>{
        if(!$('gh-panel-push-button')) ensurePanelButton();
      });
      panelObserver.observe(document.body,{childList:true,subtree:true});
      document.addEventListener('visibilitychange',()=>{if(!document.hidden)updatePanelButton();});
    }
    silentBootstrap();
    setTimeout(handleDeepLink,1200);
  }

  window.GoHousePush={enable,subscribe,showPrompt:showCard,ensurePanelButton};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
