const CACHE_NAME='gohouse-v3';
const CORE=['/gohouse-branding.js','/gohouse-app-shell.js','/gohouse-push.js','/icon-192.png'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(CORE).catch(()=>{})));
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname==='/ws')return;
  event.respondWith((async()=>{
    try{
      const res=await fetch(req);
      if(res&&res.ok){const cache=await caches.open(CACHE_NAME);cache.put(req,res.clone()).catch(()=>{});}
      return res;
    }catch{
      const cached=await caches.match(req);
      if(cached)return cached;
      if(req.mode==='navigate')return caches.match('/gohouse-cliente.html');
      throw new Error('OFFLINE');
    }
  })());
});

self.addEventListener('push',event=>{
  let payload={};
  try{payload=event.data?event.data.json():{};}catch{payload={body:event.data?.text?.()||''};}
  const title=payload.title||'Domicilios';
  const options={
    body:payload.body||'',
    icon:payload.icon||'/icon-192.png',
    badge:payload.badge||payload.icon||'/icon-192.png',
    tag:payload.tag||undefined,
    renotify:payload.renotify!==false,
    requireInteraction:payload.requireInteraction===true,
    data:{url:payload.url||'/',kind:payload.kind||'',id:payload.id||''},
    timestamp:Number(payload.timestamp)||Date.now(),
    vibrate:Array.isArray(payload.vibrate)?payload.vibrate:[180,90,180]
  };
  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const relative=event.notification?.data?.url||'/';
  const target=new URL(relative,self.location.origin).href;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){
      try{
        const current=new URL(client.url);
        if(current.origin===self.location.origin){
          if('navigate' in client)await client.navigate(target);
          await client.focus();
          client.postMessage({type:'notification-click',url:relative});
          return;
        }
      }catch{}
    }
    if(self.clients.openWindow)await self.clients.openWindow(target);
  })());
});
