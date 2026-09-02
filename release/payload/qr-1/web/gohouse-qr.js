/* White-label QR center for the operations panel. */
(() => {
  'use strict';
  if (window.__GOHOUSE_QR_PANEL__) return;
  window.__GOHOUSE_QR_PANEL__ = true;

  const $ = id => document.getElementById(id);
  const toast = msg => typeof window.showToast === 'function' ? window.showToast(msg) : console.log('[QR]', msg);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const publicUrl = () => new URL('/', location.origin).href;
  const brand = () => {
    const b = window.GoHouseBrand?.config || {};
    return {
      name: String(b.brandName || 'Domicilios').trim() || 'Domicilios',
      primary: String(b.primaryColor || '#E8863A'),
      accent: String(b.accentColor || '#34C6C0')
    };
  };
  const slug = () => brand().name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'domicilios';

  let qrLibPromise;
  function ensureQrLib(){
    if(window.QRCode) return Promise.resolve();
    if(qrLibPromise) return qrLibPromise;
    qrLibPromise = new Promise((resolve,reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      s.integrity = 'sha512-CNgIRecGo7nphbeZ04Sc13ka07paqdeTu0WR1IM4kNcpmBAUSHSQX0FslNhTDadL4O5SAGapGt4FodqL8My0mA==';
      s.crossOrigin = 'anonymous';
      s.referrerPolicy = 'no-referrer';
      s.onload = resolve;
      s.onerror = () => reject(new Error('No se pudo cargar el generador QR.'));
      document.head.appendChild(s);
    });
    return qrLibPromise;
  }

  function inject(){
    if($('tab-qr-pedidos')) return;
    const ajustes = $('tab-ajustes');
    const tabs = ajustes?.parentElement;
    const main = $('main');
    if(!tabs || !main) return;

    const tab = document.createElement('button');
    tab.className = 'btn btn-ghost';
    tab.id = 'tab-qr-pedidos';
    tab.style.flex = '1';
    tab.textContent = '📱 QR';
    tab.addEventListener('click', abrirQr);
    tabs.insertBefore(tab, ajustes);

    const view = document.createElement('div');
    view.id = 'vista-qr-pedidos';
    view.style.display = 'none';
    const vistaAjustes = $('vista-ajustes');
    main.insertBefore(view, vistaAjustes || null);

    if(typeof window.cambiarVistaPanel === 'function' && !window.cambiarVistaPanel.__qrWrapped){
      const original = window.cambiarVistaPanel;
      const wrapped = function(v){
        const qv = $('vista-qr-pedidos');
        const qt = $('tab-qr-pedidos');
        if(qv) qv.style.display = 'none';
        if(qt) qt.className = 'btn btn-ghost';
        return original.apply(this, arguments);
      };
      wrapped.__qrWrapped = true;
      window.cambiarVistaPanel = wrapped;
    }
  }

  function abrirQr(){
    inject();
    ['vista-pedidos','vista-informes','vista-usuarios','vista-ajustes'].forEach(id => { const el=$(id); if(el) el.style.display='none'; });
    ['tab-pedidos','tab-informes','tab-usuarios','tab-ajustes'].forEach(id => { const el=$(id); if(el) el.className='btn btn-ghost'; });
    const view = $('vista-qr-pedidos');
    const tab = $('tab-qr-pedidos');
    if(view) view.style.display='block';
    if(tab) tab.className='btn btn-primary';
    render();
  }

  function render(){
    const view = $('vista-qr-pedidos');
    if(!view) return;
    const b = brand();
    view.innerHTML = `
      <section>
        <h2>📱 QR de pedidos</h2>
        <div class="empty" style="text-align:left;padding:12px 14px;margin-bottom:14px;">
          Genera el acceso directo para tus clientes. Imprímelo para pegarlo en negocios, cajas, mostradores o volantes, o descarga una pieza vertical lista para estados e historias de redes sociales.
        </div>
        <div class="new-order">
          <div style="display:grid;grid-template-columns:minmax(250px,320px) 1fr;gap:22px;align-items:start;">
            <div style="background:#fff;border-radius:18px;padding:20px;display:flex;align-items:center;justify-content:center;min-height:304px;">
              <div id="qr-pedidos-render" style="width:260px;height:260px;display:flex;align-items:center;justify-content:center;"></div>
            </div>
            <div>
              <div style="font-family:'Fraunces',serif;font-size:1.7rem;font-weight:700;margin-bottom:5px;">${esc(b.name)}</div>
              <div style="color:var(--text-dim);margin-bottom:16px;">Escanea y pide tu domicilio</div>
              <label>Enlace del QR</label>
              <input id="qr-pedidos-url" value="${esc(publicUrl())}" readonly style="font-family:'JetBrains Mono',monospace;font-size:.82rem;">
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
                <button class="btn btn-primary" id="btn-crear-qr">Crear / actualizar QR</button>
                <button class="btn btn-ghost" id="btn-copiar-qr">🔗 Copiar enlace</button>
                <button class="btn btn-ghost" id="btn-descargar-qr">⬇️ Descargar QR</button>
                <button class="btn btn-ghost" id="btn-historia-qr">📲 Descargar historia</button>
                <button class="btn btn-ghost" id="btn-imprimir-qr">🖨️ Imprimir afiche</button>
              </div>
              <div class="empty" style="text-align:left;padding:10px 12px;margin-top:14px;">
                El QR abre <b>${esc(location.host)}</b>. Puedes cambiar logo, nombre y colores sin reimprimirlo. Sólo debes generar uno nuevo si cambias de dominio.
              </div>
            </div>
          </div>
        </div>
      </section>`;
    $('btn-crear-qr').onclick = generar;
    $('btn-copiar-qr').onclick = copiar;
    $('btn-descargar-qr').onclick = descargarQr;
    $('btn-historia-qr').onclick = descargarHistoria;
    $('btn-imprimir-qr').onclick = imprimir;
    generar();
  }

  async function generar(){
    const box = $('qr-pedidos-render');
    if(!box) return;
    box.innerHTML = '<div style="color:#555">Generando…</div>';
    try{
      await ensureQrLib();
      box.innerHTML='';
      new window.QRCode(box, {text:publicUrl(),width:260,height:260,colorDark:'#111111',colorLight:'#ffffff',correctLevel:window.QRCode.CorrectLevel.H});
    }catch(e){ box.innerHTML=`<div style="color:#8a2d2d;text-align:center">${esc(e.message)}</div>`; }
  }

  function sourceCanvas(){
    const box=$('qr-pedidos-render');
    if(!box) throw new Error('Abre primero la sección QR.');
    const canvas=box.querySelector('canvas');
    if(canvas) return canvas;
    const img=box.querySelector('img');
    if(img){ const c=document.createElement('canvas'); c.width=img.naturalWidth||260;c.height=img.naturalHeight||260;c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c; }
    throw new Error('Primero crea el código QR.');
  }

  function downloadCanvas(canvas,name){
    canvas.toBlob(blob=>{
      if(!blob){toast('No se pudo generar la imagen.');return;}
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();
      setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);
    },'image/png');
  }

  function rounded(ctx,x,y,w,h,r,fill){
    r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();ctx.fillStyle=fill;ctx.fill();
  }

  function wrap(ctx,text,x,y,maxWidth,lineHeight,maxLines=3){
    const words=String(text||'').split(/\s+/);let line='',lines=[];
    for(const word of words){const t=line?line+' '+word:word;if(ctx.measureText(t).width>maxWidth&&line){lines.push(line);line=word;}else line=t;}
    if(line)lines.push(line);lines.slice(0,maxLines).forEach((l,i)=>ctx.fillText(l,x,y+i*lineHeight));
  }

  function descargarQr(){
    try{
      const src=sourceCanvas(),b=brand(),out=document.createElement('canvas');out.width=1200;out.height=1450;const ctx=out.getContext('2d');
      ctx.fillStyle='#fff';ctx.fillRect(0,0,1200,1450);ctx.textAlign='center';ctx.fillStyle='#151515';ctx.font='700 68px Arial';ctx.fillText(b.name,600,95);ctx.font='600 42px Arial';ctx.fillText('Escanea y pide tu domicilio',600,165);ctx.drawImage(src,100,230,1000,1000);ctx.font='32px Arial';ctx.fillStyle='#444';ctx.fillText(location.host,600,1310);downloadCanvas(out,`${slug()}-qr-pedidos.png`);
    }catch(e){toast(e.message);}
  }

  function descargarHistoria(){
    try{
      const src=sourceCanvas(),b=brand(),out=document.createElement('canvas');out.width=1080;out.height=1920;const ctx=out.getContext('2d'),g=ctx.createLinearGradient(0,0,1080,1920);
      g.addColorStop(0,b.primary);g.addColorStop(1,b.accent);ctx.fillStyle=g;ctx.fillRect(0,0,1080,1920);ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font='700 82px Arial';wrap(ctx,b.name,540,170,900,90,2);ctx.font='600 48px Arial';ctx.fillText('Pide tu domicilio en segundos',540,390);rounded(ctx,110,500,860,1050,46,'#fff');ctx.drawImage(src,190,600,700,700);ctx.fillStyle='#151515';ctx.font='700 44px Arial';ctx.fillText('Escanea el código',540,1395);ctx.font='32px Arial';ctx.fillStyle='#4a4a4a';ctx.fillText('y haz tu pedido directamente',540,1450);ctx.fillStyle='#fff';ctx.font='600 34px Arial';ctx.fillText(location.host,540,1715);downloadCanvas(out,`${slug()}-historia-qr.png`);
    }catch(e){toast(e.message);}
  }

  async function copiar(){
    try{await navigator.clipboard.writeText(publicUrl());toast('Enlace copiado.');}
    catch{const input=$('qr-pedidos-url');input?.select();document.execCommand('copy');toast('Enlace copiado.');}
  }

  function imprimir(){
    try{
      const img=sourceCanvas().toDataURL('image/png'),b=brand(),w=window.open('','_blank');
      if(!w){toast('Permite ventanas emergentes para imprimir.');return;}
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR ${esc(b.name)}</title><style>@page{size:A4;margin:12mm}body{font-family:Arial,sans-serif;margin:0;color:#111}.sheet{min-height:270mm;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border:2px solid #111;border-radius:18px;padding:18mm;box-sizing:border-box}h1{font-size:34pt;margin:0 0 8mm}.lead{font-size:20pt;font-weight:700;margin-bottom:10mm}.qr{width:145mm;height:145mm;image-rendering:pixelated}.url{font-size:13pt;margin-top:8mm}.tip{font-size:11pt;color:#444;margin-top:5mm}@media print{button{display:none}}</style></head><body><div class="sheet"><h1>${esc(b.name)}</h1><div class="lead">Escanea y pide tu domicilio</div><img class="qr" src="${img}" alt="QR"><div class="url">${esc(publicUrl())}</div><div class="tip">Abre la cámara de tu celular y apunta al código.</div><button onclick="print()" style="margin-top:10mm;padding:10px 18px">Imprimir</button></div><script>setTimeout(()=>print(),350)<\/script></body></html>`);w.document.close();
    }catch(e){toast(e.message);}
  }

  function boot(){
    inject();
    const observer=new MutationObserver(()=>inject());
    observer.observe(document.documentElement,{childList:true,subtree:true});
    window.addEventListener('gohouse:brand-applied',()=>{if($('vista-qr-pedidos')?.style.display!=='none')render();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
