/* GoHouse VPS compatibility adapter.
   Capa de compatibilidad para conservar la interfaz antigua sobre la API propia del VPS. */
(() => {
  'use strict';

  const API = '/api';
  const listeners = new Map();
  let ws = null;
  let wsTimer = null;
  let appKindGlobal = 'client';

  const appTokenKey = () => `gohouse-vps-token-${appKindGlobal}`;
  const appUserKey = () => `gohouse-vps-user-${appKindGlobal}`;
  const driverCredentialKey = 'domicilios-llanos-driver-credential-v1';

  function token(){ try{return localStorage.getItem(appTokenKey()) || '';}catch{return '';} }
  function storedUser(){ try{return JSON.parse(localStorage.getItem(appUserKey()) || 'null');}catch{return null;} }
  function storedDriverCredential(){
    try{return JSON.parse(localStorage.getItem(driverCredentialKey) || 'null');}catch{return null;}
  }
  function storeDriverCredential(driverId,pin){
    try{localStorage.setItem(driverCredentialKey,JSON.stringify({driverId:String(driverId||''),pin:String(pin||'')}));}catch{}
  }
  function clearDriverCredential(){ try{localStorage.removeItem(driverCredentialKey);}catch{} }

  function storeSession(t,u){
    try{
      if(t) localStorage.setItem(appTokenKey(),t); else localStorage.removeItem(appTokenKey());
      if(u) localStorage.setItem(appUserKey(),JSON.stringify(u)); else localStorage.removeItem(appUserKey());
    }catch{}
  }

  async function api(path, options={}){
    const headers = { ...(options.headers || {}) };
    if(options.body && !headers['Content-Type']) headers['Content-Type']='application/json';
    if(token()) headers.Authorization = `Bearer ${token()}`;
    const res = await fetch(`${API}${path}`, { ...options, headers });
    const text = await res.text();
    let body = null;
    try{ body = text ? JSON.parse(text) : null; }catch{ body = { error:text || `HTTP_${res.status}` }; }
    if(!res.ok){ const e=new Error(body?.error || `HTTP_${res.status}`); e.status=res.status; throw e; }
    return body;
  }

  function joinPath(a,b){ return [a,b].filter(Boolean).join('/').replace(/\/+/, '/').replace(/^\//,'').replace(/\/$/,''); }
  function intersects(a,b){
    a='/' + String(a||'').replace(/^\/+|\/+$/g,'');
    b='/' + String(b||'').replace(/^\/+|\/+$/g,'');
    return a===b || a.startsWith(b+'/') || b.startsWith(a+'/');
  }

  class Snapshot {
    constructor(value,key=null){ this._value=value; this.key=key; }
    val(){ return this._value == null ? null : this._value; }
    forEach(cb){
      const v=this._value;
      if(v == null || typeof v !== 'object') return false;
      const entries = Array.isArray(v) ? v.map((x,i)=>[String(i),x]) : Object.entries(v);
      for(const [k,x] of entries){ if(cb(new Snapshot(x,k))===true) return true; }
      return false;
    }
  }

  async function uploadDataUrls(value){
    if(typeof value === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(value) && value.length > 2048){
      const out = await api('/upload-data-url',{method:'POST',body:JSON.stringify({dataUrl:value})});
      return out.url;
    }
    if(Array.isArray(value)){
      const out=[]; for(const x of value) out.push(await uploadDataUrls(x)); return out;
    }
    if(value && typeof value === 'object'){
      const out={}; for(const [k,x] of Object.entries(value)) out[k]=await uploadDataUrls(x); return out;
    }
    return value;
  }

  class Ref {
    constructor(path=''){ this.path=String(path||'').replace(/^\/+|\/+$/g,''); this._lastValue=undefined; }
    child(key){ return new Ref(joinPath(this.path,String(key))); }
    get parent(){
      const p=this.path.split('/').filter(Boolean); p.pop(); return new Ref(p.join('/'));
    }
    async once(event){
      if(event!=='value') throw new Error('Solo se soporta evento value');
      const out=await api(`/data?path=${encodeURIComponent(this.path)}`);
      this._lastValue = structuredClone(out.value);
      return new Snapshot(out.value,this.path.split('/').at(-1)||null);
    }
    on(event,callback,errorCallback){
      if(event!=='value') throw new Error('Solo se soporta evento value');
      const key={ref:this,callback,errorCallback};
      if(!listeners.has(this.path)) listeners.set(this.path,new Set());
      listeners.get(this.path).add(key);
      this.once('value').then(callback).catch(e=>errorCallback?.(e));
      ensureWs();
      return callback;
    }
    off(event,callback){
      if(event && event!=='value') return;
      const set=listeners.get(this.path); if(!set) return;
      for(const item of [...set]) if(!callback || item.callback===callback) set.delete(item);
      if(!set.size) listeners.delete(this.path);
    }
    async set(value){
      const clean=await uploadDataUrls(value);
      const body={path:this.path,value:clean};
      if(this._lastValue!==undefined) body.baseValue=this._lastValue;
      const out=await api('/data',{method:'PUT',body:JSON.stringify(body)});
      this._lastValue=structuredClone(clean);
      return out;
    }
    async remove(){ return api(`/data?path=${encodeURIComponent(this.path)}`,{method:'DELETE'}); }
    async push(value){
      const clean=await uploadDataUrls(value);
      return api('/push-node',{method:'POST',body:JSON.stringify({path:this.path,value:clean})});
    }
  }

  function refreshListeners(changed=''){
    for(const [path,set] of listeners){
      if(changed && !intersects(path,changed)) continue;
      for(const item of set){
        item.ref.once('value').then(item.callback).catch(e=>item.errorCallback?.(e));
      }
    }
  }

  function ensureWs(force=false){
    if(force && ws){ try{ws.close();}catch{} ws=null; }
    if(ws || !token()) return;
    clearTimeout(wsTimer);
    const proto=location.protocol==='https:'?'wss:':'ws:';
    ws=new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(token())}`);
    ws.onmessage=(ev)=>{ try{const m=JSON.parse(ev.data); if(m.type==='changed') refreshListeners(m.path);}catch{} };
    ws.onclose=()=>{ ws=null; wsTimer=setTimeout(()=>ensureWs(),2500); };
    ws.onerror=()=>{ try{ws.close();}catch{} };
  }

  async function subscribePush(){
    try{
      if(!('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission==='denied') return;
      if(Notification.permission==='default') await Notification.requestPermission();
      if(Notification.permission!=='granted') return;
      const { publicKey }=await api('/push/public-key');
      if(!publicKey) return;
      const reg=await navigator.serviceWorker.ready;
      let sub=await reg.pushManager.getSubscription();
      if(!sub) sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(publicKey)});
      await api('/push/subscribe',{method:'POST',body:JSON.stringify({subscription:sub.toJSON()})});
    }catch(e){ console.warn('[GoHouse push]',e.message); }
  }

  function urlBase64ToUint8Array(base64String){
    const padding='='.repeat((4-base64String.length%4)%4);
    const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');
    const raw=atob(base64); return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
  }

  class Auth {
    constructor(appKind){
      this.appKind=appKind;
      this.currentUser=storedUser();
      this._callbacks=new Set();
      queueMicrotask(()=>this._restore());
    }
    async _restore(){
      const credential=this.appKind==='domiciliario' ? storedDriverCredential() : null;
      if(token()){
        try{
          const out=await api('/auth/session'); this.currentUser=out.user; storeSession(token(),this.currentUser); ensureWs(); this._emit(); return;
        }catch(e){
          this.currentUser=null; storeSession(null,null);
          if(e?.message==='DRIVER_REMOVED') clearDriverCredential();
        }
      }
      if(credential?.driverId && credential?.pin){
        try{
          const out=await api('/auth/driver',{method:'POST',headers:{Authorization:''},body:JSON.stringify(credential)});
          storeSession(out.token,out.user); this.currentUser=out.user; ensureWs(true); this._emit(); refreshListeners(); subscribePush(); return;
        }catch(e){
          if(e?.message==='DRIVER_REMOVED' || e?.message==='INVALID_PIN') clearDriverCredential();
        }
      }
      this.currentUser=null; this._emit();
    }
    _emit(){ for(const cb of this._callbacks) cb(this.currentUser); }
    onAuthStateChanged(cb){ this._callbacks.add(cb); queueMicrotask(()=>cb(this.currentUser)); return ()=>this._callbacks.delete(cb); }
    async signInAnonymously(){
      if(this.currentUser && (this.currentUser.type==='client' || this.currentUser.type==='driver_guest')) return {user:this.currentUser};
      const out=await api('/auth/anonymous',{method:'POST',headers:{Authorization:''},body:JSON.stringify({appKind:this.appKind})});
      storeSession(out.token,out.user); this.currentUser=out.user; ensureWs(true); this._emit(); refreshListeners(); subscribePush(); return out;
    }
    async signInWithEmailAndPassword(email,password){
      const out=await api('/auth/login',{method:'POST',headers:{Authorization:''},body:JSON.stringify({email,password})});
      storeSession(out.token,out.user); this.currentUser=out.user; ensureWs(true); this._emit(); refreshListeners(); subscribePush(); return out;
    }
    async signInDriver(driverId,pin){
      const out=await api('/auth/driver',{method:'POST',headers:{Authorization:''},body:JSON.stringify({driverId,pin})});
      storeDriverCredential(driverId,pin);
      storeSession(out.token,out.user); this.currentUser=out.user; ensureWs(true); this._emit(); refreshListeners(); subscribePush(); return out;
    }
    async signOut(){
      this.currentUser=null; storeSession(null,null); if(ws){try{ws.close();}catch{} ws=null;} this._emit(); refreshListeners();
    }
  }

  class App {
    constructor(config,name){
      this.name=name;
      this.appKind=config?.appKind || (name==='panel'?'panel':name==='domiciliarios'?'domiciliario':'client');
      appKindGlobal=this.appKind;
      this._auth=new Auth(this.appKind);
      this._db={ref:(path)=>new Ref(path)};
    }
    database(){return this._db;}
    auth(){return this._auth;}
  }

  window.gohouseCloud={
    initializeApp(config,name){ return new App(config,name); }
  };
  window.GoHouseVPS={api,refreshListeners,subscribePush};
})();
