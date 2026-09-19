/* Configuración privada-operativa del correo de recuperación.
   No almacena contraseñas ni API keys: Google Workspace autoriza el VPS por IP. */
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
    return cards[0] || null;
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

  async function readConfig(){
    const data=await window.loadShared?.();
    const cfg=data?.config||{};
    return {
      enabled:cfg.recoveryMailEnabled===true,
      provider:String(cfg.recoveryMailProvider||'google_workspace'),
      fromName:String(cfg.recoveryFromName||cfg.brandName||'').trim(),
      fromEmail:String(cfg.recoveryFromEmail||'').trim(),
      replyTo:String(cfg.recoveryReplyTo||'').trim()
    };
  }

  function cardHtml(c){
    const ready=c.enabled&&/^\S+@\S+\.\S+$/.test(c.fromEmail);
    return `<section id="gh-recovery-mail-card" style="margin-top:18px">
      <h2>✉️ Correo y recuperación</h2>
      <div class="new-order">
        <div class="empty" style="text-align:left;margin-bottom:14px;padding:12px 14px">
          Los códigos de recuperación salen por Google Workspace. El sistema no guarda contraseñas de Gmail. El VPS se autoriza una sola vez por su IP pública.
        </div>
        <div class="grid">
          <div class="field"><label>Proveedor</label><select id="gh-mail-provider" disabled><option value="google_workspace">Google Workspace</option></select></div>
          <div class="field"><label>Estado</label><div id="gh-mail-status" style="padding:10px 0;font-size:.82rem;color:${ready?'var(--green,#5FBF8B)':'var(--text-dim,#A9B8B0)'}">${ready?'Configurado en el sistema':'Falta configurar el remitente'}</div></div>
          <div class="field"><label>Nombre del remitente</label><input id="gh-mail-name" value="${esc(c.fromName)}" placeholder="AGUILAS EXPRES"></div>
          <div class="field"><label>Correo remitente</label><input id="gh-mail-from" type="email" value="${esc(c.fromEmail)}" placeholder="no-reply@vantixgc.com"></div>
          <div class="field full"><label>Responder a (opcional)</label><input id="gh-mail-reply" type="email" value="${esc(c.replyTo)}" placeholder="soporte@vantixgc.com"></div>
          <div class="field full" style="display:flex;align-items:center;gap:10px"><input id="gh-mail-enabled" type="checkbox" style="width:auto;margin:0" ${c.enabled?'checked':''}><label for="gh-mail-enabled" style="margin:0;text-transform:none">Activar recuperación de contraseña por correo</label></div>
        </div>
        <button id="gh-mail-save" class="btn btn-primary" type="button">Guardar correo de recuperación</button>
        <div style="margin-top:10px;font-size:.72rem;color:var(--text-dim,#A9B8B0)">Transporte: smtp-relay.gmail.com · TLS · autorización por IP del VPS.</div>
      </div>
    </section>`;
  }

  async function mount(){
    if(location.pathname.toLowerCase().indexOf('panel')<0)return;
    if(!(await isAdmin()))return;
    const view=$('vista-ajustes');
    if(!view)return;
    if(dedupeCards())return;
    if(mounting)return;

    mounting=true;
    try{
      const cfg=await readConfig();

      // Puede haber varias llamadas simultáneas por MutationObserver.
      // Comprobamos de nuevo después del await para evitar duplicados.
      if(dedupeCards())return;

      const host=document.createElement('div');
      host.innerHTML=cardHtml(cfg);
      const card=host.firstElementChild;
      if(card)view.appendChild(card);
      $('gh-mail-save')?.addEventListener('click',save);
      dedupeCards();
    }catch(e){
      console.warn('[mail config]',e?.message||e);
    }finally{
      mounting=false;
    }
  }

  async function save(){
    const btn=$('gh-mail-save'); if(!btn)return;
    const fromName=String($('gh-mail-name')?.value||'').trim();
    const fromEmail=String($('gh-mail-from')?.value||'').trim().toLowerCase();
    const replyTo=String($('gh-mail-reply')?.value||'').trim().toLowerCase();
    const enabled=!!$('gh-mail-enabled')?.checked;
    if(enabled&&!/^\S+@\S+\.\S+$/.test(fromEmail)){window.showToast?.('Escribe un correo remitente válido.');return;}
    if(replyTo&&!/^\S+@\S+\.\S+$/.test(replyTo)){window.showToast?.('El correo de respuesta no es válido.');return;}
    btn.disabled=true;btn.textContent='Guardando...';
    try{
      const data=await window.loadShared();
      data.config=data.config||{};
      Object.assign(data.config,{recoveryMailProvider:'google_workspace',recoveryMailEnabled:enabled,recoveryFromName:fromName,recoveryFromEmail:fromEmail,recoveryReplyTo:replyTo});
      await window.saveShared(data);
      window.showToast?.('Correo de recuperación guardado.');
      $('gh-recovery-mail-status').textContent=enabled&&fromEmail?'Configurado en el sistema':'Desactivado';
      $('gh-recovery-mail-status').style.color=enabled&&fromEmail?'var(--green,#5FBF8B)':'var(--text-dim,#A9B8B0)';
    }catch(e){window.showToast?.('No se pudo guardar: '+(e?.message||'error'));}
    finally{btn.disabled=false;btn.textContent='Guardar correo de recuperación';}
  }

  async function boot(){
    for(let i=0;i<40;i++){if(window.loadShared&&$('vista-ajustes'))break;await sleep(250);}
    dedupeCards();
    mount();
    const obs=new MutationObserver(()=>{dedupeCards();mount();});obs.observe(document.body,{childList:true,subtree:true});
    document.addEventListener('click',e=>{if(e.target?.id==='tab-ajustes')setTimeout(mount,50);},true);
  }

  window.GoHouseMailConfig={mount};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
