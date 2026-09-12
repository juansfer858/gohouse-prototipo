/* Cliente: cuenta persistente + login + recuperación por correo.
   Esta capa reemplaza el registro anónimo visible sin tocar el flujo de pedidos. */
(() => {
  'use strict';
  if (window.GoHouseClientAuth) return;

  const TOKEN_KEY = 'gohouse-vps-token-client';
  const USER_KEY = 'gohouse-vps-user-client';
  const PROFILE_KEY = 'gohouse-client-profile';
  const GATE_ID = 'gh-client-auth-gate';
  const STYLE_ID = 'gh-client-auth-style';

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function isClientPage(){
    const p = location.pathname.toLowerCase();
    return !p.includes('/panel') && !p.includes('gohouse-panel') && !p.includes('/domiciliario') && !p.includes('gohouse-domiciliarios');
  }

  function token(){ try{return localStorage.getItem(TOKEN_KEY)||'';}catch{return'';} }
  function storedUser(){ try{return JSON.parse(localStorage.getItem(USER_KEY)||'null');}catch{return null;} }
  function storedProfile(){ try{return JSON.parse(localStorage.getItem(PROFILE_KEY)||'null');}catch{return null;} }
  function saveSession(out){
    try{
      localStorage.setItem(TOKEN_KEY, out.token);
      localStorage.setItem(USER_KEY, JSON.stringify(out.user));
      if(out.profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(out.profile));
    }catch{}
  }
  function clearSession(){
    try{
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(PROFILE_KEY);
    }catch{}
  }

  function decodeJwtPayload(raw){
    try{
      const p=raw.split('.')[1]; if(!p)return null;
      const s=p.replace(/-/g,'+').replace(/_/g,'/');
      const json=decodeURIComponent(atob(s).split('').map(c=>'%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      return JSON.parse(json);
    }catch{return null;}
  }

  function isAccountToken(raw=token()){
    const p=decodeJwtPayload(raw);
    return !!(p && p.type==='client' && p.account===true && p.email);
  }

  async function rawApi(path, options={}){
    const headers={...(options.headers||{})};
    if(options.body && !headers['Content-Type']) headers['Content-Type']='application/json';
    if(token() && !('Authorization' in headers)) headers.Authorization=`Bearer ${token()}`;
    const res=await fetch(`/api${path}`,{...options,headers,cache:'no-store'});
    const text=await res.text();
    let body=null; try{body=text?JSON.parse(text):null;}catch{body={error:text||`HTTP_${res.status}`};}
    if(!res.ok){const e=new Error(body?.error||`HTTP_${res.status}`);e.status=res.status;e.body=body;throw e;}
    return body;
  }

  function brand(){
    return window.GoHouseBrand?.config || {brandName:'Domicilios',shortName:'Domicilios',logoUrl:'',primaryColor:'#E8863A'};
  }

  function addStyles(){
    if($(STYLE_ID)) return;
    const st=document.createElement('style'); st.id=STYLE_ID;
    st.textContent=`
      #${GATE_ID}{position:fixed;inset:0;z-index:2147483600;background:rgba(8,15,24,.96);display:flex;align-items:center;justify-content:center;padding:18px;overflow:auto;color:#eef4f7;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #${GATE_ID}[hidden]{display:none!important}
      .gh-auth-card{width:min(100%,480px);background:#16273d;border:1px solid #2a415f;border-radius:18px;padding:22px;box-shadow:0 26px 80px rgba(0,0,0,.38)}
      .gh-auth-brand{display:flex;align-items:center;gap:12px;margin-bottom:16px}.gh-auth-logo{width:52px;height:52px;border-radius:14px;object-fit:cover;background:#fff}.gh-auth-logo-fallback{width:52px;height:52px;border-radius:14px;background:var(--teal,#e8863a);display:flex;align-items:center;justify-content:center;font-weight:900;color:#102018;font-size:22px}
      .gh-auth-brand h2{margin:0;font-size:1.18rem}.gh-auth-brand p{margin:3px 0 0;color:#93a7be;font-size:.8rem}
      .gh-auth-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0 18px}.gh-auth-tabs button{border:1px solid #2a415f;background:#0f1b2b;color:#eaf1f7;border-radius:10px;padding:11px;font-weight:750;cursor:pointer}.gh-auth-tabs button.active{background:var(--teal,#e8863a);border-color:var(--teal,#e8863a);color:#102018}
      .gh-auth-view{display:none}.gh-auth-view.active{display:block}.gh-auth-intro{font-size:.84rem;color:#b5c2cc;line-height:1.45;margin:0 0 15px}.gh-auth-old{border:1px solid rgba(232,134,58,.55);background:rgba(232,134,58,.10);padding:11px 12px;border-radius:10px;margin-bottom:14px;font-size:.79rem;color:#f4d2b5}
      .gh-auth-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.gh-auth-grid .full{grid-column:1/-1}.gh-auth-card label{display:block;font-size:.69rem;text-transform:uppercase;letter-spacing:.04em;color:#93a7be;margin:0 0 5px}.gh-auth-card input{width:100%;box-sizing:border-box;background:#0f1b2b;border:1px solid #2a415f;color:#eaf1f7;border-radius:9px;padding:12px 11px;font-size:16px;margin:0}.gh-auth-card input:focus{outline:2px solid var(--teal,#e8863a);outline-offset:1px}
      .gh-auth-actions{display:grid;gap:9px;margin-top:16px}.gh-auth-primary,.gh-auth-secondary,.gh-auth-link{border:0;border-radius:10px;padding:12px 14px;font-weight:800;cursor:pointer;font-size:.9rem}.gh-auth-primary{background:var(--teal,#e8863a);color:#102018}.gh-auth-secondary{background:transparent;border:1px solid #2a415f;color:#eaf1f7}.gh-auth-link{background:transparent;color:var(--teal,#e8863a);padding:7px;text-decoration:underline;font-weight:650}.gh-auth-primary:disabled{opacity:.55;cursor:not-allowed}
      .gh-auth-status{min-height:18px;margin-top:10px;font-size:.78rem;color:#93a7be}.gh-auth-status.error{color:#ff8c8c}.gh-auth-status.ok{color:#79d9a2}.gh-auth-code{text-align:center;font:800 1.2rem "JetBrains Mono",monospace;letter-spacing:.16em}
      @media(max-width:560px){#${GATE_ID}{align-items:flex-start;padding:10px;padding-top:max(12px,env(safe-area-inset-top))}.gh-auth-card{border-radius:14px;padding:18px}.gh-auth-grid{grid-template-columns:1fr}.gh-auth-grid .full{grid-column:auto}}
    `;
    document.head.appendChild(st);
  }

  function gateMarkup(){
    const b=brand(), old=storedProfile();
    const logo=b.logoUrl ? `<img class="gh-auth-logo" src="${esc(b.logoUrl)}" alt="Logo">` : `<div class="gh-auth-logo-fallback">${esc((b.shortName||b.brandName||'D').slice(0,1).toUpperCase())}</div>`;
    return `<div class="gh-auth-card">
      <div class="gh-auth-brand">${logo}<div><h2>${esc(b.brandName||'Domicilios')}</h2><p>Tu cuenta de domicilios</p></div></div>
      ${old && !isAccountToken() ? `<div class="gh-auth-old"><strong>Ya encontramos tus datos en este dispositivo.</strong><br>Crea tu acceso con correo y contraseña para poder entrar desde cualquier teléfono sin perder tu historial.</div>` : ''}
      <div class="gh-auth-tabs"><button id="gh-auth-tab-login" type="button">Iniciar sesión</button><button id="gh-auth-tab-register" type="button">Crear cuenta</button></div>
      <section id="gh-auth-login" class="gh-auth-view">
        <p class="gh-auth-intro">Si ya te registraste, entra con el correo y la contraseña que creaste.</p>
        <label>Correo electrónico</label><input id="gh-login-email" type="email" autocomplete="email" inputmode="email" placeholder="correo@ejemplo.com">
        <div style="height:10px"></div><label>Contraseña</label><input id="gh-login-password" type="password" autocomplete="current-password" placeholder="Tu contraseña">
        <div class="gh-auth-actions"><button id="gh-login-submit" class="gh-auth-primary" type="button">Iniciar sesión</button><button id="gh-auth-forgot" class="gh-auth-link" type="button">Olvidé mi contraseña</button></div><div id="gh-login-status" class="gh-auth-status"></div>
      </section>
      <section id="gh-auth-register" class="gh-auth-view">
        <p class="gh-auth-intro">Regístrate una sola vez. El correo servirá también para recuperar tu contraseña.</p>
        <div class="gh-auth-grid">
          <div class="full"><label>Nombre completo</label><input id="gh-reg-name" autocomplete="name" value="${esc(old?.nombre||'')}"></div>
          <div><label>Documento</label><input id="gh-reg-doc" inputmode="numeric" value="${esc(old?.cedula||'')}"></div>
          <div><label>Celular</label><input id="gh-reg-phone" inputmode="tel" autocomplete="tel" value="${esc(old?.celular||'')}"></div>
          <div class="full"><label>Correo electrónico</label><input id="gh-reg-email" type="email" inputmode="email" autocomplete="email" value="${esc(old?.email||'')}"></div>
          <div class="full"><label>Dirección</label><input id="gh-reg-address" autocomplete="street-address" value="${esc(old?.direccion||'')}"></div>
          <div class="full"><label>Ciudad / municipio</label><input id="gh-reg-city" autocomplete="address-level2" value="${esc(old?.ciudad||b.city||'')}"></div>
          <div><label>Contraseña</label><input id="gh-reg-pass" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres"></div>
          <div><label>Confirmar contraseña</label><input id="gh-reg-pass2" type="password" autocomplete="new-password" placeholder="Repítela"></div>
        </div>
        <div class="gh-auth-actions"><button id="gh-reg-submit" class="gh-auth-primary" type="button">Crear mi cuenta</button></div><div id="gh-reg-status" class="gh-auth-status"></div>
      </section>
      <section id="gh-auth-recover" class="gh-auth-view">
        <p class="gh-auth-intro"><strong>Recuperar contraseña.</strong><br>Escribe el correo con el que te registraste y te enviaremos un código de 6 dígitos.</p>
        <label>Correo electrónico</label><input id="gh-rec-email" type="email" autocomplete="email" inputmode="email" placeholder="correo@ejemplo.com">
        <div class="gh-auth-actions"><button id="gh-rec-send" class="gh-auth-primary" type="button">Enviar código</button><button id="gh-rec-back" class="gh-auth-secondary" type="button">Volver a iniciar sesión</button></div><div id="gh-rec-status" class="gh-auth-status"></div>
      </section>
      <section id="gh-auth-reset" class="gh-auth-view">
        <p class="gh-auth-intro">Revisa tu correo. Ingresa el código recibido y crea una contraseña nueva.</p>
        <label>Código de 6 dígitos</label><input id="gh-reset-code" class="gh-auth-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000">
        <div style="height:10px"></div><label>Nueva contraseña</label><input id="gh-reset-pass" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres">
        <div style="height:10px"></div><label>Confirmar contraseña</label><input id="gh-reset-pass2" type="password" autocomplete="new-password" placeholder="Repítela">
        <div class="gh-auth-actions"><button id="gh-reset-submit" class="gh-auth-primary" type="button">Cambiar contraseña</button><button id="gh-reset-back" class="gh-auth-secondary" type="button">Volver</button></div><div id="gh-reset-status" class="gh-auth-status"></div>
      </section>
    </div>`;
  }

  function ensureGate(){
    addStyles(); let gate=$(GATE_ID); if(!gate){ gate=document.createElement('div'); gate.id=GATE_ID; document.body.appendChild(gate); }
    gate.innerHTML=gateMarkup(); gate.hidden=false; bindGate();
    const old=storedProfile(); showView(old && !isAccountToken() ? 'register' : 'login'); return gate;
  }

  function showView(name){
    ['login','register','recover','reset'].forEach(v=>$(`gh-auth-${v}`)?.classList.toggle('active',v===name));
    $('gh-auth-tab-login')?.classList.toggle('active',name==='login'); $('gh-auth-tab-register')?.classList.toggle('active',name==='register');
    const tabs=document.querySelector(`#${GATE_ID} .gh-auth-tabs`); if(tabs) tabs.style.display=['login','register'].includes(name)?'grid':'none';
  }
  function status(id,msg,type=''){ const el=$(id); if(!el)return; el.textContent=msg||''; el.className='gh-auth-status'+(type?' '+type:''); }
  function errorMessage(err){ const code=String(err?.message||''); return ({EMAIL_INVALIDO:'Escribe un correo válido.',PASSWORD_TOO_SHORT:'La contraseña debe tener mínimo 8 caracteres.',EMAIL_ALREADY_EXISTS:'Ese correo ya tiene una cuenta. Usa Iniciar sesión.',INVALID_CREDENTIALS:'Correo o contraseña incorrectos.',PROFILE_INVALID:'Completa nombre, documento, celular, dirección y ciudad.',CODE_INVALID:'El código no es correcto.',CODE_EXPIRED:'El código venció. Solicita uno nuevo.',TOO_MANY_ATTEMPTS:'Demasiados intentos. Solicita un código nuevo.',MAIL_NOT_CONFIGURED:'La recuperación por correo aún no está habilitada. Comunícate con la empresa de domicilios.',MAIL_SEND_FAILED:'No pudimos enviar el correo. Intenta nuevamente en unos minutos.'})[code] || 'No se pudo completar la operación. Intenta nuevamente.'; }

  async function register(){
    const profile={nombre:$('gh-reg-name').value.trim(),cedula:$('gh-reg-doc').value.trim(),celular:$('gh-reg-phone').value.trim(),email:$('gh-reg-email').value.trim().toLowerCase(),direccion:$('gh-reg-address').value.trim(),ciudad:$('gh-reg-city').value.trim()};
    const password=$('gh-reg-pass').value, pass2=$('gh-reg-pass2').value;
    if(!profile.nombre||!profile.cedula||!profile.celular||!profile.direccion||!profile.ciudad){status('gh-reg-status','Completa todos tus datos.','error');return;}
    if(!/^\S+@\S+\.\S+$/.test(profile.email)){status('gh-reg-status','Escribe un correo válido.','error');return;}
    if(password.length<8){status('gh-reg-status','La contraseña debe tener mínimo 8 caracteres.','error');return;}
    if(password!==pass2){status('gh-reg-status','Las contraseñas no coinciden.','error');return;}
    const btn=$('gh-reg-submit');btn.disabled=true;status('gh-reg-status','Creando tu cuenta...');
    try{const out=await rawApi('/auth/client/register',{method:'POST',body:JSON.stringify({email:profile.email,password,profile})});saveSession(out);status('gh-reg-status','Cuenta creada. Entrando...','ok');location.reload();}
    catch(e){status('gh-reg-status',errorMessage(e),'error');btn.disabled=false;}
  }
  async function login(){
    const email=$('gh-login-email').value.trim().toLowerCase(), password=$('gh-login-password').value;
    if(!email||!password){status('gh-login-status','Escribe tu correo y contraseña.','error');return;}
    const btn=$('gh-login-submit');btn.disabled=true;status('gh-login-status','Ingresando...');
    try{const out=await rawApi('/auth/client/login',{method:'POST',headers:{Authorization:''},body:JSON.stringify({email,password})});saveSession(out);status('gh-login-status','Sesión iniciada.','ok');location.reload();}
    catch(e){status('gh-login-status',errorMessage(e),'error');btn.disabled=false;}
  }

  let recoveryEmail='';
  async function sendRecovery(){
    const email=$('gh-rec-email').value.trim().toLowerCase(); if(!/^\S+@\S+\.\S+$/.test(email)){status('gh-rec-status','Escribe un correo válido.','error');return;}
    const btn=$('gh-rec-send');btn.disabled=true;status('gh-rec-status','Enviando código...');
    try{await rawApi('/auth/client/recover',{method:'POST',headers:{Authorization:''},body:JSON.stringify({email})});recoveryEmail=email;$('gh-reset-code').value='';$('gh-reset-pass').value='';$('gh-reset-pass2').value='';showView('reset');status('gh-reset-status',`Si ${email} está registrado, el código llegará en unos minutos.`,'ok');}
    catch(e){status('gh-rec-status',errorMessage(e),'error');btn.disabled=false;}
  }
  async function resetPassword(){
    const code=$('gh-reset-code').value.replace(/\D/g,''),password=$('gh-reset-pass').value,pass2=$('gh-reset-pass2').value;
    if(code.length!==6){status('gh-reset-status','Escribe el código de 6 dígitos.','error');return;} if(password.length<8){status('gh-reset-status','La contraseña debe tener mínimo 8 caracteres.','error');return;} if(password!==pass2){status('gh-reset-status','Las contraseñas no coinciden.','error');return;}
    const btn=$('gh-reset-submit');btn.disabled=true;status('gh-reset-status','Cambiando contraseña...');
    try{await rawApi('/auth/client/reset',{method:'POST',headers:{Authorization:''},body:JSON.stringify({email:recoveryEmail,code,password})});$('gh-login-email').value=recoveryEmail;$('gh-login-password').value='';showView('login');status('gh-login-status','Contraseña cambiada. Ya puedes iniciar sesión.','ok');}
    catch(e){status('gh-reset-status',errorMessage(e),'error');btn.disabled=false;}
  }

  function bindGate(){
    $('gh-auth-tab-login')?.addEventListener('click',()=>showView('login')); $('gh-auth-tab-register')?.addEventListener('click',()=>showView('register'));
    $('gh-auth-forgot')?.addEventListener('click',()=>{$('gh-rec-email').value=$('gh-login-email').value.trim();showView('recover');}); $('gh-rec-back')?.addEventListener('click',()=>showView('login')); $('gh-reset-back')?.addEventListener('click',()=>showView('recover'));
    $('gh-login-submit')?.addEventListener('click',login); $('gh-reg-submit')?.addEventListener('click',register); $('gh-rec-send')?.addEventListener('click',sendRecovery); $('gh-reset-submit')?.addEventListener('click',resetPassword);
    $('gh-login-password')?.addEventListener('keydown',e=>{if(e.key==='Enter')login();}); $('gh-reg-pass2')?.addEventListener('keydown',e=>{if(e.key==='Enter')register();}); $('gh-reset-pass2')?.addEventListener('keydown',e=>{if(e.key==='Enter')resetPassword();});
  }

  async function restoreAccount(){
    const t=token(); if(!t||!isAccountToken(t)) return false;
    try{const out=await rawApi('/auth/client/profile');if(out?.profile){localStorage.setItem(PROFILE_KEY,JSON.stringify(out.profile));const u=storedUser()||{};localStorage.setItem(USER_KEY,JSON.stringify({...u,uid:out.profile.uid,email:out.profile.email,type:'client',account:true}));}return !!out?.profile;}
    catch(e){if(e.status===401){clearSession();return false;}return false;}
  }

  function patchLogout(){
    const btn=document.querySelector('.logout-link'); if(btn){btn.textContent='Cerrar sesión';btn.setAttribute('aria-label','Cerrar sesión');}
    window.cerrarSesionDemo=function(){clearSession();location.reload();};
  }

  async function init(){
    if(!isClientPage()) return; addStyles(); for(let i=0;i<30&&!document.body;i++)await sleep(50);
    const hadLocal=!!storedProfile(); const ok=await restoreAccount();
    if(ok){patchLogout();if(!hadLocal&&!sessionStorage.getItem('gh-account-restored')){sessionStorage.setItem('gh-account-restored','1');location.reload();return;}$(GATE_ID)?.setAttribute('hidden','');return;}
    sessionStorage.removeItem('gh-account-restored'); ensureGate();
  }

  window.GoHouseClientAuth={init,showLogin:()=>{ensureGate();showView('login');},logout:()=>{clearSession();location.reload();}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
