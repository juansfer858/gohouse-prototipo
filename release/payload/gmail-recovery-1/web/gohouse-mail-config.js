/* Gmail / Google Workspace recovery mail configuration.
   The app password is never stored in public app data and is never returned to the browser. */
(() => {
  'use strict';
  if (window.GoHouseMailConfig) return;

  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let allowed=null;
  let mounting=false;

  function dedupeCards(){
    const cards=[...document.querySelectorAll('#gh-recovery-mail-card')];
    cards.slice(1).forEach(card=>card.remove());
    return cards[0]||null;
  }

  async function isAdmin(){
    if(allowed!==null)return allowed;
    try{
      const session=await window.GoHouseVPS?.api?.('/auth/session');
      const email=String(session?.user?.email||'').trim().toLowerCase();
      if(!email)return allowed=false;
      const data=await window.loadShared?.();
      const users=data?.usuariosPanel||{};
      allowed=Object.values(users).some(u=>String(u?.email||'').trim().toLowerCase()===email&&u?.activo!==false&&u?.rol==='administrador');
      return allowed;
    }catch{return allowed=false;}
  }

  async function api(path,options={}){
    if(!window.GoHouseVPS?.api)throw new Error('API_NOT_READY');
    return window.GoHouseVPS.api(path,options);
  }

  function cardHtml(c){
    const ready=c.enabled&&c.hasAppPassword&&/^\S+@\S+\.\S+$/.test(c.fromEmail||'');
    const status=ready?'Configurado y activo':c.hasAppPassword?'Configurado pero desactivado':c.fromEmail?'Falta la contraseña de aplicación':'Falta configurar Gmail';
    return `<section id="gh-recovery-mail-card" style="margin-top:18px">
      <h2>✉️ Correo y recuperación</h2>
      <div class="new-order">
        <div class="empty" style="text-align:left;margin-bottom:14px;padding:12px 14px">
          El dueño conecta una cuenta de Gmail o Google Workspace. Usa una <strong>contraseña de aplicación de Google</strong>, no la contraseña normal del correo.
        </div>
        <div class="grid">
          <div class="field"><label>Proveedor</label><select disabled><option>Gmail / Google Workspace</option></select></div>
          <div class="field"><label>Estado</label><div id="gh-mail-status" style="padding:10px 0;font-size:.82rem;color:${ready?'var(--green,#5FBF8B)':'var(--text-dim,#A9B8B0)'}">${esc(status)}</div></div>
          <div class="field"><label>Nombre del remitente</label><input id="gh-mail-name" value="${esc(c.fromName||'')}" placeholder="AGUILAS EXPRES"></div>
          <div class="field"><label>Cuenta Gmail / Google</label><input id="gh-mail-from" type="email" autocomplete="email" value="${esc(c.fromEmail||'')}" placeholder="empresa@gmail.com"></div>
          <div class="field full"><label>Contraseña de aplicación</label><input id="gh-mail-password" type="password" autocomplete="new-password" placeholder="${c.hasAppPassword?'Ya configurada · déjala vacía para conservarla':'16 caracteres de Google'}"></div>
          <div class="field full"><label>Responder a (opcional)</label><input id="gh-mail-reply" type="email" value="${esc(c.replyTo||'')}" placeholder="soporte@empresa.com"></div>
          <div class="field full" style="display:flex;align-items:center;gap:10px"><input id="gh-mail-enabled" type="checkbox" style="width:auto;margin:0" ${c.enabled?'checked':''}><label for="gh-mail-enabled" style="margin:0;text-transform:none">Activar recuperación de contraseña por correo</label></div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button id="gh-mail-save" class="btn btn-primary" type="button">Guardar configuración</button>
          <button id="gh-mail-test" class="btn btn-ghost" type="button">Enviar correo de prueba</button>
        </div>
        <div style="margin-top:10px;font-size:.72rem;color:var(--text-dim,#A9B8B0)">SMTP configurado automáticamente: smtp.gmail.com · puerto 587 · STARTTLS.</div>
      </div>
    </section>`;
  }

  async function mount(){
    if(location.pathname.toLowerCase().indexOf('panel')<0)return;
    if(!(await isAdmin()))return;
    const view=$('vista-ajustes'); if(!view)return;
    if(dedupeCards()||mounting)return;
    mounting=true;
    try{
      const cfg=await api('/recovery-mail/settings');
      if(dedupeCards())return;
      const host=document.createElement('div');host.innerHTML=cardHtml(cfg);
      const card=host.firstElementChild;if(card)view.appendChild(card);
      $('gh-mail-save')?.addEventListener('click',save);
      $('gh-mail-test')?.addEventListener('click',testMail);
      dedupeCards();
    }catch(e){console.warn('[mail config]',e?.message||e);}
    finally{mounting=false;}
  }

  async function save(){
    const btn=$('gh-mail-save');if(!btn)return;
    const payload={
      fromName:String($('gh-mail-name')?.value||'').trim(),
      fromEmail:String($('gh-mail-from')?.value||'').trim().toLowerCase(),
      appPassword:String($('gh-mail-password')?.value||'').trim(),
      replyTo:String($('gh-mail-reply')?.value||'').trim().toLowerCase(),
      enabled:!!$('gh-mail-enabled')?.checked
    };
    if(!payload.fromName){window.showToast?.('Escribe el nombre del remitente.');return;}
    if(!/^\S+@\S+\.\S+$/.test(payload.fromEmail)){window.showToast?.('Escribe una cuenta Gmail o Google válida.');return;}
    if(payload.replyTo&&!/^\S+@\S+\.\S+$/.test(payload.replyTo)){window.showToast?.('El correo de respuesta no es válido.');return;}
    const compact=payload.appPassword.replace(/\s+/g,'');
    if(compact&&compact.length!==16){window.showToast?.('La contraseña de aplicación debe tener 16 caracteres.');return;}
    payload.appPassword=compact;

    btn.disabled=true;btn.textContent='Guardando...';
    try{
      const out=await api('/recovery-mail/settings',{method:'PUT',body:JSON.stringify(payload)});
      $('gh-mail-password').value='';
      $('gh-mail-password').placeholder='Ya configurada · déjala vacía para conservarla';
      $('gh-mail-status').textContent=out.enabled&&out.hasAppPassword?'Configurado y activo':out.hasAppPassword?'Configurado pero desactivado':'Falta la contraseña de aplicación';
      $('gh-mail-status').style.color=out.enabled&&out.hasAppPassword?'var(--green,#5FBF8B)':'var(--text-dim,#A9B8B0)';
      window.showToast?.('Configuración de Gmail guardada.');
    }catch(e){
      window.showToast?.('No se pudo guardar: '+friendlyError(e?.message));
    }finally{
      btn.disabled=false;btn.textContent='Guardar configuración';
    }
  }

  async function testMail(){
    const btn=$('gh-mail-test');if(!btn)return;
    btn.disabled=true;btn.textContent='Enviando prueba...';
    try{
      const out=await api('/recovery-mail/test',{method:'POST',body:'{}'});
      window.showToast?.('Correo de prueba enviado a '+(out.to||'la cuenta configurada')+'.');
    }catch(e){
      window.showToast?.('Prueba fallida: '+friendlyError(e?.message));
    }finally{
      btn.disabled=false;btn.textContent='Enviar correo de prueba';
    }
  }

  function friendlyError(code){
    return ({
      APP_PASSWORD_REQUIRED:'Falta la contraseña de aplicación de Google.',
      APP_PASSWORD_INVALID:'La contraseña de aplicación debe tener 16 caracteres.',
      GMAIL_APP_PASSWORD_REJECTED:'Google rechazó la contraseña de aplicación.',
      GMAIL_AUTH_REQUIRED:'Google requiere una contraseña de aplicación válida.',
      MAIL_NOT_CONFIGURED:'Primero guarda y activa la cuenta de Gmail.',
      RECOVERY_GMAIL_INVALID:'La cuenta de correo no es válida.'
    })[code]||String(code||'error');
  }

  async function boot(){
    for(let i=0;i<40;i++){if(window.loadShared&&$('vista-ajustes'))break;await sleep(250);}
    dedupeCards();mount();
    const obs=new MutationObserver(()=>{dedupeCards();mount();});obs.observe(document.body,{childList:true,subtree:true});
    document.addEventListener('click',e=>{if(e.target?.id==='tab-ajustes')setTimeout(mount,50);},true);
  }

  window.GoHouseMailConfig={mount};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
