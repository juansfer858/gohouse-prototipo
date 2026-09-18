(() => {
  'use strict';
  if (window.DriverCodeViewer) return;
  const api=(p,o={})=>window.GoHouseVPS.api(p,o);
  const $=id=>document.getElementById(id);
  let currentId='',currentName='';

  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));}
  function styles(){
    if($('gh-driver-code-style')) return;
    const s=document.createElement('style');s.id='gh-driver-code-style';s.textContent=`
      #gh-driver-code-overlay{position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:10050;display:none;align-items:center;justify-content:center;padding:18px}
      #gh-driver-code-modal{width:min(430px,100%);background:var(--surface,#1e312b);border:1px solid var(--line,#33473d);border-radius:16px;padding:20px;color:var(--text,#f3efe6)}
      #gh-driver-code-modal h3{margin:0 0 5px;font-size:1.15rem}#gh-driver-code-modal p{color:var(--text-dim,#a9b8b0);font-size:.86rem;line-height:1.45}
      .gh-code-value{font:700 2rem ui-monospace,monospace;letter-spacing:.24em;text-align:center;padding:18px;margin:14px 0;border:1px dashed var(--line,#33473d);border-radius:12px;background:rgba(0,0,0,.18)}
      .gh-code-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.gh-code-actions button{min-height:40px}
      .gh-code-input{width:100%;font:700 1.25rem ui-monospace,monospace;letter-spacing:.18em;text-align:center;margin:10px 0 14px}
      .gh-code-btn{position:relative}.gh-code-btn::after{content:'Código';font-size:.62rem;position:absolute;left:50%;transform:translateX(-50%);bottom:-13px;opacity:0;pointer-events:none}
    `;document.head.appendChild(s);
  }
  function ensureModal(){
    if($('gh-driver-code-overlay')) return;
    const d=document.createElement('div');d.id='gh-driver-code-overlay';
    d.innerHTML='<div id="gh-driver-code-modal"><div id="gh-driver-code-body"></div></div>';
    d.onclick=e=>{if(e.target===d)close();};document.body.appendChild(d);
  }
  function close(){const o=$('gh-driver-code-overlay');if(o)o.style.display='none';}
  async function copy(code){try{await navigator.clipboard.writeText(code);window.showToast?.('Código copiado.');}catch{}}
  async function open(driverId,name){
    styles();ensureModal();currentId=driverId;currentName=name||'Domiciliario';
    $('gh-driver-code-overlay').style.display='flex';
    $('gh-driver-code-body').innerHTML='<p>Cargando código…</p>';
    try{
      const out=await api('/driver-codes/'+encodeURIComponent(driverId));
      if(out.available) renderAvailable(out.code);
      else renderRegister();
    }catch(e){
      $('gh-driver-code-body').innerHTML='<h3>Ver código</h3><p>No se pudo consultar: '+esc(e.message)+'</p><div class="gh-code-actions"><button class="btn btn-ghost" id="gh-code-close">Cerrar</button></div>';
      $('gh-code-close').onclick=close;
    }
  }
  function renderAvailable(code){
    $('gh-driver-code-body').innerHTML=`
      <h3>Código de ${esc(currentName)}</h3>
      <p>Este es el código permanente asignado al domiciliario. No cambia al cerrar la app ni al reiniciar el teléfono.</p>
      <div class="gh-code-value">${esc(code)}</div>
      <div class="gh-code-actions"><button class="btn btn-ghost" id="gh-code-close">Cerrar</button><button class="btn btn-primary" id="gh-code-copy">Copiar código</button></div>`;
    $('gh-code-close').onclick=close;$('gh-code-copy').onclick=()=>copy(code);
  }
  function renderRegister(){
    $('gh-driver-code-body').innerHTML=`
      <h3>Registrar código actual</h3>
      <p>${esc(currentName)} fue creado antes de que el panel guardara una copia administrativa. Escribe su código actual; se verificará sin cambiarlo.</p>
      <input id="gh-code-input" class="gh-code-input" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••">
      <div class="gh-code-actions"><button class="btn btn-ghost" id="gh-code-close">Cancelar</button><button class="btn btn-primary" id="gh-code-register">Verificar y guardar</button></div>`;
    $('gh-code-close').onclick=close;
    $('gh-code-register').onclick=register;
  }
  async function register(){
    const input=$('gh-code-input'),pin=String(input?.value||'').trim();
    if(!/^\d{4}$/.test(pin)){window.showToast?.('El código debe tener 4 números.');return;}
    const b=$('gh-code-register');b.disabled=true;b.textContent='Verificando…';
    try{
      const out=await api('/driver-codes/'+encodeURIComponent(currentId)+'/register',{method:'POST',body:JSON.stringify({pin})});
      renderAvailable(out.code);
      window.showToast?.('Código verificado y guardado para consulta.');
    }catch(e){
      window.showToast?.(e.message==='INVALID_PIN'?'Ese no es el código actual del domiciliario.':'No se pudo registrar: '+e.message);
      b.disabled=false;b.textContent='Verificar y guardar';
    }
  }
  function decorate(){
    document.querySelectorAll('button[onclick*="abrirChatConDomiciliario"]').forEach(chat=>{
      const controls=chat.parentElement;if(!controls||controls.querySelector('.gh-code-btn'))return;
      const raw=chat.getAttribute('onclick')||'';
      const m=raw.match(/abrirChatConDomiciliario\('([^']+)'\s*,\s*'((?:\\'|[^'])*)'/);
      if(!m)return;
      const id=m[1],name=m[2].replace(/\\'/g,"'");
      const b=document.createElement('button');b.className='icon-btn gh-code-btn';b.title='Ver código permanente';b.textContent='🔑';
      b.onclick=()=>open(id,name);
      controls.insertBefore(b,chat.nextSibling);
    });
  }
  const obs=new MutationObserver(decorate);
  function boot(){styles();decorate();obs.observe(document.body,{childList:true,subtree:true});}
  window.DriverCodeViewer={open,decorate};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();