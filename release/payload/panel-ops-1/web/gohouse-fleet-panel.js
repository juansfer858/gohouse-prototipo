/* Flota en vivo · Panel
   Mapa de última posición + recorrido reciente por servicio. */
(() => {
  'use strict';
  if(window.GoHouseFleetPanel) return;

  const $=id=>document.getElementById(id);
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let map=null,tileLayer=null,routeLayer=null,refreshTimer=null,open=false,fitted=false;
  const markers=new Map();

  function api(path,options){
    if(!window.GoHouseVPS?.api) throw new Error('API_NOT_READY');
    return window.GoHouseVPS.api(path,options);
  }
  function addStyles(){
    if($('gh-fleet-style'))return;
    const s=document.createElement('style');s.id='gh-fleet-style';s.textContent=`
      #vista-flota{display:none}.gh-fleet-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px}.gh-fleet-head h2{margin:0}.gh-fleet-sub{font-size:.78rem;color:var(--text-dim,#A9B8B0);margin-top:3px}.gh-fleet-grid{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(280px,.75fr);gap:16px;align-items:start}.gh-fleet-mapbox{background:var(--surface,#1E312B);border:1px solid var(--line,#33473D);border-radius:12px;overflow:hidden}.gh-fleet-map{height:min(62vh,620px);min-height:390px;background:var(--surface-2,#24392F)}.gh-fleet-map-note{padding:9px 12px;font-size:.7rem;color:var(--text-dim,#A9B8B0);border-top:1px solid var(--line,#33473D)}.gh-fleet-list{display:grid;gap:9px;max-height:min(68vh,680px);overflow:auto;padding-right:2px}.gh-fleet-card{background:var(--surface,#1E312B);border:1px solid var(--line,#33473D);border-radius:11px;padding:12px}.gh-fleet-card.live{border-color:var(--green,#5FBF8B)}.gh-fleet-card.stale{opacity:.82}.gh-fleet-row{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.gh-fleet-name{font-weight:800;font-size:.92rem}.gh-fleet-state{font:600 .63rem 'JetBrains Mono',monospace;text-transform:uppercase;color:var(--text-dim,#A9B8B0);margin-top:2px}.gh-fleet-badge{font:700 .62rem 'JetBrains Mono',monospace;border-radius:999px;padding:4px 7px;background:var(--surface-2,#24392F);white-space:nowrap}.gh-fleet-badge.ok{color:var(--green,#5FBF8B)}.gh-fleet-badge.warn{color:var(--mango,#E8863A)}.gh-fleet-meta{font-size:.75rem;color:var(--text-dim,#A9B8B0);line-height:1.45;margin-top:9px}.gh-fleet-actions{display:flex;gap:7px;margin-top:10px}.gh-fleet-actions button{flex:1}.gh-fleet-empty{border:1px dashed var(--line,#33473D);border-radius:10px;padding:22px;text-align:center;color:var(--text-dim,#A9B8B0);font-size:.82rem}.gh-fleet-summary{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.gh-fleet-pill{background:var(--surface,#1E312B);border:1px solid var(--line,#33473D);border-radius:999px;padding:6px 9px;font-size:.7rem;color:var(--text-dim,#A9B8B0)}.leaflet-container{font-family:Inter,system-ui,sans-serif}.leaflet-popup-content{margin:10px 12px;line-height:1.35}
      @media(max-width:850px){.gh-fleet-grid{grid-template-columns:1fr}.gh-fleet-map{height:50vh;min-height:320px}.gh-fleet-list{max-height:none}}
    `;document.head.appendChild(s);
  }
  function ensureLeaflet(){
    if(window.L)return Promise.resolve(window.L);
    if(window.__ghLeafletPromise)return window.__ghLeafletPromise;
    window.__ghLeafletPromise=new Promise((resolve,reject)=>{
      if(!document.querySelector('link[data-gh-leaflet]')){const l=document.createElement('link');l.rel='stylesheet';l.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';l.dataset.ghLeaflet='1';document.head.appendChild(l);}
      const s=document.createElement('script');s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';s.defer=true;s.dataset.ghLeaflet='1';s.onload=()=>resolve(window.L);s.onerror=()=>reject(new Error('MAP_LIBRARY'));document.head.appendChild(s);
    });return window.__ghLeafletPromise;
  }
  function stateText(d){
    if(d?.activeOrder?.estado==='aceptado')return 'Yendo al punto de recogida';
    if(d?.activeOrder?.estado==='camino')return 'En camino al cliente';
    if(d?.estado==='disponible')return 'Disponible';
    if(d?.estado==='en_ruta')return 'En servicio';
    return 'Fuera de servicio';
  }
  function ageInfo(loc){
    if(!loc?.recordedAt)return {text:'Sin GPS',tone:'warn',cls:'stale',ms:Infinity};
    const ms=Math.max(0,Date.now()-new Date(loc.recordedAt).getTime());
    if(ms<60000)return {text:ms<15000?'En vivo':`Hace ${Math.max(1,Math.round(ms/1000))} s`,tone:'ok',cls:'live',ms};
    if(ms<3600000)return {text:`Hace ${Math.round(ms/60000)} min`,tone:'warn',cls:'stale',ms};
    return {text:`Hace ${Math.round(ms/3600000)} h`,tone:'warn',cls:'stale',ms};
  }
  function accuracyText(loc){return Number.isFinite(Number(loc?.accuracy))?`±${Math.round(Number(loc.accuracy))} m`:'—';}
  function ensureUI(){
    const main=document.querySelector('main'),pedidos=$('tab-pedidos');if(!main||!pedidos)return false;
    addStyles();const bar=pedidos.parentElement;bar?.classList.add('gh-panel-tabs');
    let tab=$('tab-flota');if(!tab){tab=document.createElement('button');tab.type='button';tab.className='btn btn-ghost';tab.id='tab-flota';tab.textContent='🗺️ Flota en vivo';const anchor=$('tab-publicidad')||$('tab-qr')||$('tab-ajustes');if(anchor)bar.insertBefore(tab,anchor);else bar.appendChild(tab);tab.addEventListener('click',openFleet);}
    let view=$('vista-flota');if(!view){view=document.createElement('div');view.id='vista-flota';view.innerHTML=`<div class="gh-fleet-head"><div><h2>🗺️ Flota en vivo</h2><div class="gh-fleet-sub">Ubicación de domiciliarios únicamente mientras tienen un servicio activo.</div></div><button id="gh-fleet-refresh" class="btn btn-ghost btn-sm" type="button">Actualizar</button></div><div id="gh-fleet-summary" class="gh-fleet-summary"></div><div class="gh-fleet-grid"><div class="gh-fleet-mapbox"><div id="gh-fleet-map" class="gh-fleet-map"></div><div id="gh-fleet-map-note" class="gh-fleet-map-note">El mapa usa OpenStreetMap. La posición se actualiza mientras la PWA del domiciliario está activa.</div></div><div id="gh-fleet-list" class="gh-fleet-list"><div class="gh-fleet-empty">Cargando flota...</div></div></div>`;main.appendChild(view);$('gh-fleet-refresh')?.addEventListener('click',()=>refresh(true));}
    return true;
  }
  function closeFleet(){open=false;const v=$('vista-flota');if(v)v.style.display='none';const t=$('tab-flota');if(t)t.className='btn btn-ghost';if(refreshTimer){clearInterval(refreshTimer);refreshTimer=null;}}
  async function openFleet(){
    if(!ensureUI())return;open=true;
    document.querySelectorAll('main > [id^="vista-"]').forEach(v=>{if(v.id!=='vista-flota')v.style.display='none';});
    document.querySelectorAll('button[id^="tab-"]').forEach(b=>b.className='btn btn-ghost');
    const v=$('vista-flota');v.style.display='block';$('tab-flota').className='btn btn-primary';
    await initMap();await refresh(true);
    if(refreshTimer)clearInterval(refreshTimer);refreshTimer=setInterval(()=>refresh(false),10000);
  }
  async function initMap(){
    if(map){setTimeout(()=>map.invalidateSize(),60);return map;}
    try{
      const L=await ensureLeaflet();
      map=L.map('gh-fleet-map',{zoomControl:true}).setView([4.5709,-74.2973],5);
      tileLayer=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
      setTimeout(()=>map.invalidateSize(),80);return map;
    }catch(e){const c=$('gh-fleet-map');if(c)c.innerHTML='<div class="gh-fleet-empty" style="margin:20px">No se pudo cargar el mapa. La lista de estados seguirá funcionando.</div>';return null;}
  }
  function markerColor(d,age){if(age.ms>180000)return '#7D8D86';if(d?.activeOrder?.estado==='camino')return '#E8863A';if(d?.activeOrder?.estado==='aceptado')return '#34C6C0';return '#5FBF8B';}
  function popupHtml(d,age){const o=d.activeOrder;return `<b>${esc(d.nombre)}</b><br>${esc(stateText(d))}${o?`<br>Pedido #${esc(o.numero||o.id)}`:''}<br><small>${esc(age.text)} · GPS ${esc(accuracyText(d.lastLocation))}</small>`;}
  function renderMap(rows,fit){
    if(!map||!window.L)return;
    const seen=new Set(),bounds=[];
    for(const d of rows){const loc=d.lastLocation,lat=Number(loc?.latitude),lng=Number(loc?.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lng))continue;seen.add(d.id);bounds.push([lat,lng]);const age=ageInfo(loc),color=markerColor(d,age);let m=markers.get(d.id);if(!m){m=window.L.circleMarker([lat,lng],{radius:9,color,fillColor:color,fillOpacity:.9,weight:3}).addTo(map);markers.set(d.id,m);}else{m.setLatLng([lat,lng]);m.setStyle({color,fillColor:color});}m.bindPopup(popupHtml(d,age));}
    for(const [id,m] of markers)if(!seen.has(id)){map.removeLayer(m);markers.delete(id);}
    if((fit||!fitted)&&bounds.length){map.fitBounds(bounds,{padding:[35,35],maxZoom:16});fitted=true;}
  }
  function renderList(rows){
    const list=$('gh-fleet-list'),summary=$('gh-fleet-summary');if(!list||!summary)return;
    const active=rows.filter(d=>d.activeOrder).length,live=rows.filter(d=>ageInfo(d.lastLocation).ms<60000).length;
    summary.innerHTML=`<span class="gh-fleet-pill">${rows.length} domiciliarios</span><span class="gh-fleet-pill">${active} en servicio</span><span class="gh-fleet-pill">${live} con GPS reciente</span>`;
    if(!rows.length){list.innerHTML='<div class="gh-fleet-empty">No hay domiciliarios registrados.</div>';return;}
    list.innerHTML=rows.map(d=>{const age=ageInfo(d.lastLocation),o=d.activeOrder,loc=d.lastLocation;return `<article class="gh-fleet-card ${age.cls}"><div class="gh-fleet-row"><div><div class="gh-fleet-name">${esc(d.nombre)}</div><div class="gh-fleet-state">${esc(stateText(d))}</div></div><span class="gh-fleet-badge ${age.tone}">${esc(age.text)}</span></div><div class="gh-fleet-meta">${o?`Pedido <b>#${esc(o.numero||o.id)}</b>${o.cliente?` · ${esc(o.cliente)}`:''}<br>`:''}${loc?`Último GPS: ${esc(new Date(loc.recordedAt).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',second:'2-digit'}))} · ${esc(accuracyText(loc))}`:'Todavía no hay coordenadas registradas.'}</div>${loc?`<div class="gh-fleet-actions"><button class="btn btn-ghost btn-sm" type="button" data-fleet-center="${esc(d.id)}">Ubicar</button><button class="btn btn-ghost btn-sm" type="button" data-fleet-route="${esc(d.id)}" data-order-id="${esc(o?.id||'')}">Ver recorrido</button></div>`:''}</article>`;}).join('');
    list.querySelectorAll('[data-fleet-center]').forEach(b=>b.addEventListener('click',()=>centerDriver(b.dataset.fleetCenter)));
    list.querySelectorAll('[data-fleet-route]').forEach(b=>b.addEventListener('click',()=>showRoute(b.dataset.fleetRoute,b.dataset.orderId)));
  }
  async function refresh(fit=false){
    if(!open||!window.GoHouseVPS?.api)return;
    try{const data=await api('/fleet/live');const rows=Array.isArray(data?.drivers)?data.drivers:[];renderList(rows);renderMap(rows,fit);}catch(e){const list=$('gh-fleet-list');if(list)list.innerHTML=`<div class="gh-fleet-empty">No se pudo cargar la flota: ${esc(e?.message||'error')}</div>`;}
  }
  function centerDriver(id){const m=markers.get(String(id));if(m&&map){map.setView(m.getLatLng(),16);m.openPopup();}}
  async function showRoute(driverId,orderId){
    try{
      const q=orderId?`?orderId=${encodeURIComponent(orderId)}&limit=600`:'?limit=300';
      const data=await api(`/fleet/history/${encodeURIComponent(driverId)}${q}`),pts=(data?.points||[]).filter(p=>Number.isFinite(Number(p.latitude))&&Number.isFinite(Number(p.longitude)));
      if(!map||!window.L)return;
      if(routeLayer){map.removeLayer(routeLayer);routeLayer=null;}
      if(pts.length<2){window.showToast?.('Aún no hay suficientes puntos para dibujar el recorrido.');return;}
      const latlngs=pts.map(p=>[Number(p.latitude),Number(p.longitude)]);routeLayer=window.L.polyline(latlngs,{weight:5,opacity:.78}).addTo(map);map.fitBounds(routeLayer.getBounds(),{padding:[30,30],maxZoom:17});window.showToast?.(`Recorrido: ${pts.length} puntos GPS.`);
    }catch(e){window.showToast?.('No se pudo cargar el recorrido.');}
  }
  async function boot(){
    for(let i=0;i<80;i++){if(ensureUI()&&window.GoHouseVPS?.api)break;await sleep(250);}
    ensureUI();
    document.addEventListener('click',e=>{const b=e.target?.closest?.('button[id^="tab-"]');if(b&&b.id!=='tab-flota')closeFleet();},true);
    const obs=new MutationObserver(()=>ensureUI());obs.observe(document.body,{childList:true,subtree:true});
  }

  window.GoHouseFleetPanel={open:openFleet,refresh,showRoute};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
