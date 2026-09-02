/* GoHouse app shell runtime.
   UX adaptativa PWA + teclado móvil + bandeja identificada de chat cliente/empresa. */
(() => {
  'use strict';
  if (window.GoHouseAppShell) return;

  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const PROFILE_KEY = 'gohouse-client-profile';
  const PANEL_CHAT_READ_KEY = 'gohouse-panel-chat-read-v1';

  function pageKind(){
    const p = location.pathname.toLowerCase();
    if (p.includes('/panel') || p.includes('gohouse-panel')) return 'panel';
    if (p.includes('/domiciliario') || p.includes('gohouse-domiciliarios')) return 'driver';
    return 'client';
  }

  const kind = pageKind();
  document.documentElement.dataset.appKind = kind;

  function ensureViewport(){
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta){meta=document.createElement('meta');meta.name='viewport';document.head.appendChild(meta);}
    meta.content='width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content';
  }

  function addStyles(){
    if ($('gohouse-app-shell-style')) return;
    const st=document.createElement('style');
    st.id='gohouse-app-shell-style';
    st.textContent=`
      html{width:100%;min-height:100%;overflow-x:hidden;-webkit-text-size-adjust:100%;text-size-adjust:100%}
      body{width:100%;max-width:100vw;min-height:100vh;min-height:100dvh;overflow-x:hidden;overscroll-behavior-x:none}
      button,.btn,a,.home-card,[role="button"]{touch-action:manipulation}
      img,video,canvas,svg{max-width:100%}
      .app{width:100%;min-height:100vh;min-height:100dvh}
      header{padding-top:calc(14px + env(safe-area-inset-top))!important}
      main{padding-bottom:calc(22px + env(safe-area-inset-bottom))!important}
      .toast{bottom:calc(16px + env(safe-area-inset-bottom))!important}
      .chat-fab{bottom:calc(16px + env(safe-area-inset-bottom) + var(--gh-keyboard-offset,0px))!important}
      .chat-panel,.chat-panel-modal{bottom:calc(10px + env(safe-area-inset-bottom) + var(--gh-keyboard-offset,0px))!important;height:min(520px,calc(var(--gh-visible-height,100dvh) - 24px))!important;max-height:calc(var(--gh-visible-height,100dvh) - 24px)!important}
      .chat-mensajes{-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
      .chat-input-row{padding-bottom:calc(10px + env(safe-area-inset-bottom))!important}
      .gh-panel-tabs{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:8px!important;align-items:stretch}
      .gh-panel-tabs>.btn{width:100%;min-width:0;white-space:normal;line-height:1.15;min-height:48px}
      #badge-chats-sin-leer{display:none!important}
      #tab-mensajes{position:relative}
      #gh-msg-badge{position:absolute;top:-6px;right:-6px;background:#ff3b3b;color:#fff;border-radius:999px;min-width:19px;height:19px;padding:0 5px;font:700 .65rem/19px 'JetBrains Mono',monospace;text-align:center;display:none}
      #vista-mensajes{display:none}
      #vista-mensajes.is-open{display:block}
      .gh-msg-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap}
      .gh-msg-head h2{margin:0 0 3px}
      .gh-msg-sub{color:var(--text-dim,#93A7BE);font-size:.82rem}
      .gh-msg-list{display:grid;gap:9px}
      .gh-msg-row{width:100%;display:grid;grid-template-columns:46px minmax(0,1fr) auto;gap:11px;align-items:center;text-align:left;background:var(--surface,#16273D);border:1px solid var(--line,#2A415F);border-radius:11px;padding:11px 12px;color:var(--text,#EAF1F7);cursor:pointer}
      .gh-msg-row:hover{border-color:var(--mango,var(--teal,#E8863A))}
      .gh-msg-avatar{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--surface-2,#1D3350);font-weight:800;text-transform:uppercase}
      .gh-msg-name{font-weight:750;font-size:.92rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .gh-msg-meta{font-size:.7rem;color:var(--text-dim,#93A7BE);margin-top:2px}
      .gh-msg-last{font-size:.78rem;color:var(--text-dim,#93A7BE);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:5px}
      .gh-msg-right{text-align:right;align-self:stretch;display:flex;flex-direction:column;justify-content:space-between;align-items:flex-end;gap:5px}
      .gh-msg-time{font:500 .65rem 'JetBrains Mono',monospace;color:var(--text-dim,#93A7BE)}
      .gh-msg-unread{min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--mango,var(--teal,#E8863A));color:#101010;font:800 .66rem/20px 'JetBrains Mono',monospace;text-align:center}
      .gh-msg-empty{border:1px dashed var(--line,#2A415F);border-radius:10px;padding:24px;text-align:center;color:var(--text-dim,#93A7BE);font-size:.85rem}
      @media(max-width:900px){input,textarea,select{font-size:16px!important}main{padding-left:14px!important;padding-right:14px!important}}
      @media(max-width:560px){.app{max-width:none!important;margin:0!important}.chat-panel,.chat-panel-modal{left:8px!important;right:8px!important;width:auto!important;max-width:none!important;margin:0!important;border-radius:14px!important}.chat-fab{width:52px!important;height:52px!important}.gh-panel-tabs{grid-template-columns:repeat(2,minmax(0,1fr))!important}.gh-msg-row{grid-template-columns:42px minmax(0,1fr) auto;padding:10px}.gh-msg-avatar{width:38px;height:38px}}
      @media(min-width:1200px){html[data-app-kind="panel"] main{max-width:1400px!important}}
    `;
    document.head.appendChild(st);
  }

  function syncVisualViewport(){
    const vv=window.visualViewport;
    const visible=vv?vv.height:window.innerHeight;
    const offsetTop=vv?vv.offsetTop:0;
    const keyboard=vv?Math.max(0,window.innerHeight-vv.height-offsetTop):0;
    document.documentElement.style.setProperty('--gh-visible-height',`${Math.round(visible)}px`);
    document.documentElement.style.setProperty('--gh-keyboard-offset',`${Math.round(keyboard)}px`);
  }

  function bindKeyboardUx(){
    syncVisualViewport();
    window.visualViewport?.addEventListener('resize',syncVisualViewport,{passive:true});
    window.visualViewport?.addEventListener('scroll',syncVisualViewport,{passive:true});
    window.addEventListener('orientationchange',()=>setTimeout(syncVisualViewport,250),{passive:true});
    document.addEventListener('focusin',e=>{if(!e.target?.matches?.('input,textarea,select'))return;setTimeout(()=>{syncVisualViewport();if(e.target.closest('.chat-panel,.chat-panel-modal'))e.target.scrollIntoView({block:'nearest'});},180);});
  }

  function clientProfile(){try{return JSON.parse(localStorage.getItem(PROFILE_KEY)||'null');}catch{return null;}}
  function clientUser(){try{return JSON.parse(localStorage.getItem('gohouse-vps-user-client')||'null');}catch{return null;}}
  function phoneKey(phone){return String(phone||'').replace(/[.#$/\[\]\s]/g,'');}

  async function ensureClientSupportChat(){
    const profile=clientProfile();if(!profile?.celular)return;
    for(let i=0;i<40;i++){
      const btn=$('chat-soporte-btn');if(btn){btn.style.display='flex';btn.setAttribute('aria-label','Chat con la empresa de domicilios');}
      if(typeof window.abrirChatSoporte==='function'){try{window.abrirChatSoporte(profile.celular);}catch{}return;}
      await sleep(150);
    }
  }

  function patchClientSupportSender(){
    if(kind!=='client'||window.__ghSupportSenderPatched)return;
    window.__ghSupportSenderPatched=true;
    const original=typeof window.enviarMensajeChatSoporte==='function'?window.enviarMensajeChatSoporte:null;
    window.enviarMensajeChatSoporte=async function(){
      const input=$('chat-soporte-input'),texto=String(input?.value||'').trim();if(!texto)return;
      const profile=clientProfile(),key=phoneKey(profile?.celular);
      if(!key||!window.GoHouseVPS?.api){if(original)return original();return;}
      const user=clientUser();
      const payload={de:'cliente',texto,hora:Date.now(),clienteNombre:String(profile?.nombre||'Cliente').trim(),clienteCelular:String(profile?.celular||'').trim(),clienteUid:String(user?.uid||''),clienteCiudad:String(profile?.ciudad||'').trim()};
      input.disabled=true;
      try{await window.GoHouseVPS.api('/push-node',{method:'POST',body:JSON.stringify({path:`chatsClientes/${key}`,value:payload})});input.value='';input.focus({preventScroll:true});}
      catch(err){console.error('Error enviando chat de soporte:',err);if(typeof window.showToast==='function')window.showToast('No se pudo enviar: '+(err?.message||'error de conexión'));}
      finally{input.disabled=false;}
    };
  }

  function initials(name){return String(name||'C').trim().split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()||'C';}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function fmt(ts){const n=Number(ts||0);if(!n)return'';const d=new Date(n),now=new Date(),same=d.toDateString()===now.toDateString();return same?d.toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit'});}
  function loadReadMap(){try{return JSON.parse(localStorage.getItem(PANEL_CHAT_READ_KEY)||'{}')||{};}catch{return {};}}
  function saveReadMap(map){try{localStorage.setItem(PANEL_CHAT_READ_KEY,JSON.stringify(map));}catch{}}

  const panelChat={chats:{},clients:{},read:loadReadMap(),ready:false,app:null,chatsRef:null,clientsRef:null};
  function findClientByKey(key){return Object.values(panelChat.clients||{}).find(c=>phoneKey(c?.celular)===key)||null;}
  function convoRows(){
    const out=[];
    for(const [key,node] of Object.entries(panelChat.chats||{})){
      if(!node||typeof node!=='object')continue;
      const messages=Object.values(node).filter(Boolean).sort((a,b)=>(Number(a?.hora)||0)-(Number(b?.hora)||0));if(!messages.length)continue;
      const last=messages[messages.length-1]||{},profile=findClientByKey(key),metaMsg=[...messages].reverse().find(m=>m?.clienteNombre||m?.clienteCelular)||{};
      const name=String(metaMsg.clienteNombre||profile?.nombre||'Cliente').trim(),phone=String(metaMsg.clienteCelular||profile?.celular||key).trim(),city=String(metaMsg.clienteCiudad||profile?.ciudad||'').trim(),lastAt=Number(last.hora)||0;
      const unread=messages.filter(m=>m?.de==='cliente'&&(Number(m.hora)||0)>Number(panelChat.read[key]||0)).length;
      out.push({key,name,phone,city,last,lastAt,unread});
    }
    return out.sort((a,b)=>b.lastAt-a.lastAt);
  }

  function ensurePanelMessagesUI(){
    const main=$('main'),pedidos=$('tab-pedidos');if(!main||!pedidos)return false;
    const bar=pedidos.parentElement;bar?.classList.add('gh-panel-tabs');
    let tab=$('tab-mensajes');
    if(!tab){tab=document.createElement('button');tab.type='button';tab.className='btn btn-ghost';tab.id='tab-mensajes';tab.innerHTML='💬 Mensajes <span id="gh-msg-badge"></span>';const anchor=$('tab-publicidad')||$('tab-ajustes');if(anchor)bar.insertBefore(tab,anchor);else bar.appendChild(tab);tab.addEventListener('click',openMessagesView);}
    let view=$('vista-mensajes');
    if(!view){view=document.createElement('div');view.id='vista-mensajes';view.innerHTML='<div class="gh-msg-head"><div><h2>💬 Mensajes</h2><div class="gh-msg-sub">Conversaciones directas de clientes con la empresa de domicilios.</div></div></div><div id="gh-msg-list" class="gh-msg-list"><div class="gh-msg-empty">Cargando conversaciones...</div></div>';main.appendChild(view);}
    ['tab-pedidos','tab-informes','tab-usuarios','tab-publicidad','tab-qr','tab-qr-public','tab-ajustes'].forEach(id=>{const el=$(id);if(!el||el.dataset.ghCloseMessages)return;el.dataset.ghCloseMessages='1';el.addEventListener('click',closeMessagesView,true);});
    return true;
  }

  function closeMessagesView(){const view=$('vista-mensajes');if(view){view.classList.remove('is-open');view.style.display='none';}const tab=$('tab-mensajes');if(tab)tab.className='btn btn-ghost';}
  function openMessagesView(){
    if(!ensurePanelMessagesUI())return;
    document.querySelectorAll('#main > [id^="vista-"]').forEach(v=>{if(v.id!=='vista-mensajes')v.style.display='none';});const pub=$('vista-publicidad');if(pub)pub.classList.remove('is-open');
    const view=$('vista-mensajes');view.style.display='block';view.classList.add('is-open');
    ['tab-pedidos','tab-informes','tab-usuarios','tab-publicidad','tab-qr','tab-qr-public','tab-ajustes'].forEach(id=>{const el=$(id);if(el)el.className='btn btn-ghost';});const tab=$('tab-mensajes');if(tab)tab.className='btn btn-primary';renderPanelMessages();
  }

  function renderPanelMessages(){
    if(!ensurePanelMessagesUI())return;
    const rows=convoRows(),list=$('gh-msg-list'),unreadTotal=rows.reduce((n,r)=>n+(r.unread?1:0),0),badge=$('gh-msg-badge');if(badge){badge.textContent=String(unreadTotal);badge.style.display=unreadTotal?'block':'none';}if(!list)return;
    if(!rows.length){list.innerHTML='<div class="gh-msg-empty">Todavía no hay conversaciones de clientes.</div>';return;}
    list.innerHTML=rows.map(r=>{const preview=r.last?.tipo==='imagen'?'📷 Foto':String(r.last?.texto||'Mensaje');return `<button type="button" class="gh-msg-row" data-chat-key="${esc(r.key)}"><span class="gh-msg-avatar">${esc(initials(r.name))}</span><span style="min-width:0"><span class="gh-msg-name">${esc(r.name)}</span><span class="gh-msg-meta">${esc(r.phone)}${r.city?' · '+esc(r.city):''}</span><span class="gh-msg-last">${esc(preview)}</span></span><span class="gh-msg-right"><span class="gh-msg-time">${esc(fmt(r.lastAt))}</span>${r.unread?`<span class="gh-msg-unread">${r.unread}</span>`:''}</span></button>`;}).join('');
    list.querySelectorAll('[data-chat-key]').forEach(btn=>btn.addEventListener('click',()=>openConversation(btn.dataset.chatKey)));
  }

  function openConversation(key){const row=convoRows().find(r=>r.key===key);if(!row)return;panelChat.read[key]=Date.now();saveReadMap(panelChat.read);renderPanelMessages();if(typeof window.abrirChatConCliente==='function')window.abrirChatConCliente(row.phone,row.name);}

  async function initPanelMessages(){
    if(kind!=='panel'||panelChat.ready)return;panelChat.ready=true;
    for(let i=0;i<60&&(!window.gohouseCloud||!$('tab-pedidos'));i++)await sleep(200);if(!window.gohouseCloud)return;
    ensurePanelMessagesUI();panelChat.app=window.gohouseCloud.initializeApp({appKind:'panel'},'panel-mensajes-addon');const db=panelChat.app.database();panelChat.clientsRef=db.ref('gohouse-data/clientes');panelChat.chatsRef=db.ref('chatsClientes');
    panelChat.clientsRef.on('value',snap=>{panelChat.clients=snap.val()||{};renderPanelMessages();},()=>{});panelChat.chatsRef.on('value',snap=>{panelChat.chats=snap.val()||{};renderPanelMessages();},()=>{});
    const mo=new MutationObserver(()=>ensurePanelMessagesUI()),main=$('main');if(main)mo.observe(main,{childList:true,subtree:true});
  }

  async function init(){ensureViewport();addStyles();bindKeyboardUx();if(kind==='panel')initPanelMessages();if(kind==='client'){patchClientSupportSender();ensureClientSupportChat();[800,2000,5000].forEach(ms=>setTimeout(ensureClientSupportChat,ms));}}

  window.GoHouseAppShell={kind,syncVisualViewport,ensureClientSupportChat,renderPanelMessages};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
