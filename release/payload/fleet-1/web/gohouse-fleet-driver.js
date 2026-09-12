/* Flota en vivo · Domiciliario
   Captura hitos y ubicación periódica solamente durante pedidos activos. */
(() => {
  'use strict';
  if(window.GoHouseFleetDriver) return;

  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let activeOrderId='';
  let activeState='';
  let watchId=null;
  let lastSent=null;
  let patched=false;
  let contextTimer=null;

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
  function captureLocation(timeout=7000){
    return new Promise(resolve=>{
      if(!navigator.geolocation) return resolve({gpsStatus:'unavailable'});
      navigator.geolocation.getCurrentPosition(pos=>resolve({
        gpsStatus:'ok',latitude:pos.coords.latitude,longitude:pos.coords.longitude,
        accuracy:pos.coords.accuracy,speed:pos.coords.speed,heading:pos.coords.heading
      }),err=>resolve({gpsStatus:gpsErrorStatus(err)}),{enableHighAccuracy:true,timeout,maximumAge:4000});
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

  async function syncContext(){
    if(!window.GoHouseVPS?.api) return;
    try{
      const ctx=await api('/fleet/me');
      const next=ctx?.activeOrder;
      activeOrderId=next?.id ? String(next.id) : '';
      activeState=String(next?.estado||'');
      if(activeOrderId && ['aceptado','camino'].includes(activeState)) startWatch();
      else stopWatch();
    }catch{}
  }
  function startWatch(){
    if(watchId!==null || !activeOrderId) return;
    if(!navigator.geolocation){setStatus('📍 Este dispositivo no ofrece ubicación GPS.','warn');return;}
    setStatus('📍 GPS activo durante este servicio','ok');
    watchId=navigator.geolocation.watchPosition(async pos=>{
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
      if(status==='denied') setStatus('📍 Ubicación bloqueada. Actívala en los permisos del navegador.','warn');
      else setStatus('📍 GPS temporalmente no disponible. Los cambios de estado seguirán funcionando.','warn');
    },{enableHighAccuracy:true,maximumAge:10000,timeout:20000});
  }
  function stopWatch(){
    if(watchId!==null){try{navigator.geolocation.clearWatch(watchId);}catch{}watchId=null;}
    lastSent=null;
    if(!activeOrderId) hideStatus();
  }

  async function runMilestone(original,eventType,orderId,args,after){
    const pointPromise=captureLocation(7000);
    let result;
    try{ result=await original.apply(window,args); }
    catch(e){ throw e; }
    const point=await pointPromise;
    await sendPoint(orderId,eventType,point);
    if(point.gpsStatus==='denied') setStatus('📍 Ubicación bloqueada. El servicio continúa, pero no podremos mostrarte en Flota en vivo.','warn');
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
    const a=patchFunction('aceptarPedido','accepted','start');
    const b=patchFunction('marcarEnCamino','pickup','start');
    const c=patchFunction('marcarEntregado','delivered','stop');
    patched=patched||(a&&b&&c);
    document.querySelectorAll('button[onclick*="marcarEnCamino"]').forEach(btn=>{
      if(!btn.dataset.ghFleetLabel){btn.dataset.ghFleetLabel='1';btn.textContent='Ya recogí / compré · Voy al cliente';}
    });
  }
  async function boot(){
    for(let i=0;i<80;i++){patchActions();if(window.GoHouseVPS?.api)break;await sleep(250);}
    patchActions();
    await syncContext();
    contextTimer=setInterval(syncContext,12000);
    const obs=new MutationObserver(()=>patchActions());obs.observe(document.body,{childList:true,subtree:true});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncContext();});
    window.addEventListener('pagehide',()=>{if(contextTimer)clearInterval(contextTimer);stopWatch();},{once:true});
  }

  window.GoHouseFleetDriver={captureLocation,syncContext};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
