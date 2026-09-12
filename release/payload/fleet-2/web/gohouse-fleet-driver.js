/* Flota en vivo · Domiciliario
   Permiso GPS explícito + captura de hitos + tracking durante pedidos activos. */
(() => {
  'use strict';
  if(window.GoHouseFleetDriver) return;

  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let activeOrderId='';
  let activeState='';
  let watchId=null;
  let lastSent=null;
  let contextTimer=null;
  let permissionState='unknown';
  let driverSessionReady=false;

  function api(path,options){
    if(!window.GoHouseVPS?.api) throw new Error('API_NOT_READY');
    return window.GoHouseVPS.api(path,options);
  }
  function distanceMeters(a,b){
    if(!a||!b) return Infinity;
    const R=6371000,toRad=x=>x*Math.PI/180;
    const dLat=toRad(b.lat-a.lat),dLon=toRad(b.lng-a.lng);
    const x=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(x));
  }
  function gpsErrorStatus(err){
    if(err?.code===1) return 'denied';
    if(err?.code===3) return 'timeout';
    if(err?.code===2) return 'unavailable';
    return 'error';
  }
  function captureLocation(timeout=10000){
    return new Promise(resolve=>{
      if(!navigator.geolocation) return resolve({gpsStatus:'unavailable'});
      navigator.geolocation.getCurrentPosition(pos=>resolve({
        gpsStatus:'ok',latitude:pos.coords.latitude,longitude:pos.coords.longitude,
        accuracy:pos.coords.accuracy,speed:pos.coords.speed,heading:pos.coords.heading
      }),err=>resolve({gpsStatus:gpsErrorStatus(err)}),{enableHighAccuracy:true,timeout,maximumAge:2500});
    });
  }
  async function sendPoint(orderId,eventType,point){
    if(!orderId) return;
    const payload={orderId:String(orderId),eventType,gpsStatus:point?.gpsStatus||'unavailable'};
    for(const k of ['latitude','longitude','accuracy','speed','heading']) if(point?.[k]!==undefined&&point?.[k]!==null) payload[k]=point[k];
    try{ await api('/fleet/location',{method:'POST',body:JSON.stringify(payload)}); }
    catch(e){ console.warn('[Fleet GPS]',eventType,e?.message||e); }
  }

  function ensureStatus(){
    let el=document.getElementById('gh-fleet-driver-status');
    if(el) return el;
    el=document.createElement('div');el.id='gh-fleet-driver-status';
    el.style.cssText='margin:0 18px 10px;padding:8px 10px;border:1px solid var(--line,#2A415F);border-radius:9px;font-size:.72rem;color:var(--text-dim,#93A7BE);background:var(--surface,#16273D);display:none';
    const main=document.querySelector('main');
    if(main?.parentNode) main.parentNode.insertBefore(el,main);
    return el;
  }
  function setStatus(text,tone='normal'){
    const el=ensureStatus(); if(!el)return;
    el.style.display='block';el.textContent=text;
    el.style.color=tone==='ok'?'var(--green,#4FD98D)':tone==='warn'?'var(--orange,#FF8C42)':'var(--text-dim,#93A7BE)';
  }
  function hideStatus(){ const el=ensureStatus();if(el)el.style.display='none'; }

  function ensurePermissionCard(){
    let el=document.getElementById('gh-gps-permission-card');
    if(el) return el;
    el=document.createElement('div');el.id='gh-gps-permission-card';
    el.style.cssText='margin:0 18px 12px;padding:14px;border:1px solid var(--line,#2A415F);border-radius:12px;background:var(--surface,#16273D);display:none';
    const main=document.querySelector('main');
    if(main?.parentNode) main.parentNode.insertBefore(el,main);
    return el;
  }
  function renderPermissionCard(){
    const card=ensurePermissionCard(); if(!card)return;
    if(!driverSessionReady){card.style.display='none';return;}
    if(!navigator.geolocation){
      card.style.display='block';
      card.innerHTML='<div style="font-weight:800;margin-bottom:5px">📍 Ubicación no disponible</div><div style="font-size:.78rem;color:var(--text-dim,#93A7BE)">Este dispositivo o navegador no ofrece geolocalización.</div>';
      return;
    }
    if(permissionState==='granted'){
      card.style.display=activeOrderId?'block':'none';
      card.innerHTML='<div style="display:flex;align-items:center;gap:8px;font-weight:800;color:var(--green,#4FD98D)">✓ Ubicación activada</div><div style="font-size:.75rem;color:var(--text-dim,#93A7BE);margin-top:4px">Se comparte únicamente mientras tengas un domicilio activo.</div>';
      return;
    }
    const denied=permissionState==='denied';
    card.style.display='block';
    card.innerHTML=`<div style="font-weight:800;margin-bottom:5px">📍 ${denied?'Ubicación bloqueada':'Ubicación para trabajar'}</div>
      <div style="font-size:.78rem;color:var(--text-dim,#93A7BE);line-height:1.35;margin-bottom:10px">${denied?'El navegador tiene bloqueado el GPS. Habilita Ubicación en los permisos de este sitio o de la app y vuelve a intentarlo.':'La empresa necesita tu ubicación únicamente mientras tengas un domicilio activo.'}</div>
      <button type="button" id="gh-enable-gps" style="width:100%;border:0;border-radius:9px;padding:11px 14px;font-weight:800;cursor:pointer;background:var(--teal,#34C6C0);color:#06201E">${denied?'REINTENTAR UBICACIÓN':'ACTIVAR UBICACIÓN'}</button>`;
    document.getElementById('gh-enable-gps')?.addEventListener('click',requestLocationPermission,{once:true});
  }
  async function refreshPermissionState(){
    if(!navigator.geolocation){permissionState='unavailable';renderPermissionCard();return permissionState;}
    try{
      if(navigator.permissions?.query){
        const p=await navigator.permissions.query({name:'geolocation'});
        permissionState=p.state||'prompt';
        p.onchange=()=>{permissionState=p.state||'prompt';renderPermissionCard();if(permissionState==='granted'&&activeOrderId)startWatch();};
      } else if(permissionState==='unknown') permissionState='prompt';
    }catch{ if(permissionState==='unknown') permissionState='prompt'; }
    renderPermissionCard();
    return permissionState;
  }
  async function requestLocationPermission(){
    const btn=document.getElementById('gh-enable-gps');
    if(btn){btn.disabled=true;btn.textContent='SOLICITANDO UBICACIÓN…';}
    const point=await captureLocation(12000);
    if(point.gpsStatus==='ok'){
      permissionState='granted';
      setStatus('📍 Ubicación activada correctamente.','ok');
      if(activeOrderId) await sendPoint(activeOrderId,'track',point);
      renderPermissionCard();
      if(activeOrderId) startWatch();
      return true;
    }
    permissionState=point.gpsStatus==='denied'?'denied':'prompt';
    if(point.gpsStatus==='denied') setStatus('📍 Ubicación bloqueada. Habilítala en los permisos del navegador o de la app.','warn');
    else if(point.gpsStatus==='timeout') setStatus('📍 No pudimos obtener tu ubicación. Verifica que el GPS del teléfono esté encendido.','warn');
    else setStatus('📍 GPS no disponible en este momento.','warn');
    renderPermissionCard();
    return false;
  }

  async function syncContext(){
    if(!window.GoHouseVPS?.api) return;
    try{
      const ctx=await api('/fleet/me');
      driverSessionReady=true;
      const next=ctx?.activeOrder;
      activeOrderId=next?.id ? String(next.id) : '';
      activeState=String(next?.estado||'');
      await refreshPermissionState();
      if(activeOrderId && ['aceptado','camino'].includes(activeState) && permissionState==='granted') startWatch();
      else if(!activeOrderId) stopWatch();
      renderPermissionCard();
    }catch{
      driverSessionReady=false;
      renderPermissionCard();
    }
  }
  function startWatch(){
    if(watchId!==null || !activeOrderId) return;
    if(!navigator.geolocation){setStatus('📍 Este dispositivo no ofrece ubicación GPS.','warn');return;}
    watchId=navigator.geolocation.watchPosition(async pos=>{
      permissionState='granted';renderPermissionCard();setStatus('📍 GPS activo durante este servicio','ok');
      if(!activeOrderId) return;
      const now=Date.now(),point={lat:pos.coords.latitude,lng:pos.coords.longitude,at:now};
      const moved=distanceMeters(lastSent,point),elapsed=lastSent?now-lastSent.at:Infinity;
      if(moved<35 && elapsed<45000) return;
      lastSent=point;
      await sendPoint(activeOrderId,'track',{
        gpsStatus:'ok',latitude:pos.coords.latitude,longitude:pos.coords.longitude,
        accuracy:pos.coords.accuracy,speed:pos.coords.speed,heading:pos.coords.heading
      });
    },err=>{
      const status=gpsErrorStatus(err);
      if(status==='denied'){permissionState='denied';setStatus('📍 Ubicación bloqueada. Actívala en los permisos del navegador o de la app.','warn');}
      else setStatus('📍 GPS temporalmente no disponible. Los cambios de estado seguirán funcionando.','warn');
      renderPermissionCard();
    },{enableHighAccuracy:true,maximumAge:10000,timeout:20000});
  }
  function stopWatch(){
    if(watchId!==null){try{navigator.geolocation.clearWatch(watchId);}catch{}watchId=null;}
    lastSent=null;
    if(!activeOrderId) hideStatus();
    renderPermissionCard();
  }

  async function runMilestone(original,eventType,orderId,args,after){
    const pointPromise=captureLocation(10000);
    let result;
    try{ result=await original.apply(window,args); }
    catch(e){ throw e; }
    const point=await pointPromise;
    if(point.gpsStatus==='ok') permissionState='granted';
    if(point.gpsStatus==='denied') permissionState='denied';
    await sendPoint(orderId,eventType,point);
    if(point.gpsStatus==='denied') setStatus('📍 Ubicación bloqueada. El servicio continúa, pero no podremos mostrarte en Flota en vivo.','warn');
    renderPermissionCard();
    if(after==='start') await syncContext();
    if(after==='stop'){activeOrderId='';activeState='';stopWatch();}
    return result;
  }
  function patchFunction(name,eventType,after){
    const original=window[name];
    if(typeof original!=='function' || original.__ghFleetWrapped) return false;
    const wrapped=async function(orderId,...rest){ return runMilestone(original,eventType,orderId,[orderId,...rest],after); };
    wrapped.__ghFleetWrapped=true;wrapped.__ghFleetOriginal=original;window[name]=wrapped;return true;
  }
  function patchActions(){
    patchFunction('aceptarPedido','accepted','start');
    patchFunction('marcarEnCamino','pickup','start');
    patchFunction('marcarEntregado','delivered','stop');
    document.querySelectorAll('button[onclick*="marcarEnCamino"]').forEach(btn=>{
      if(!btn.dataset.ghFleetLabel){btn.dataset.ghFleetLabel='1';btn.textContent='Ya recogí / compré · Voy al cliente';}
    });
  }
  async function boot(){
    ensurePermissionCard();
    for(let i=0;i<80;i++){patchActions();if(window.GoHouseVPS?.api)break;await sleep(250);}
    patchActions();
    await syncContext();
    contextTimer=setInterval(syncContext,12000);
    const obs=new MutationObserver(()=>{patchActions();renderPermissionCard();});obs.observe(document.body,{childList:true,subtree:true});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncContext();});
    window.addEventListener('pagehide',()=>{if(contextTimer)clearInterval(contextTimer);stopWatch();},{once:true});
  }

  window.GoHouseFleetDriver={captureLocation,syncContext,requestLocationPermission};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
