/* Zonas y tarifas de domicilios · Panel + Cliente + Domiciliario */
(() => {
  'use strict';
  if (window.GoHouseTarifas) return;

  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const money = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const slug = v => String(v||'zona').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50) || ('zona-'+Date.now());

  function kind(){
    const p=location.pathname.toLowerCase();
    if(p.includes('/panel')||p.includes('gohouse-panel')) return 'panel';
    if(p.includes('/domiciliario')||p.includes('gohouse-domiciliarios')) return 'driver';
    return 'client';
  }

  function normalizeZones(raw){
    return (Array.isArray(raw)?raw:[]).map((z,i)=>({
      id:String(z?.id||`zona-${i+1}`), nombre:String(z?.nombre||'Zona').trim(),
      tarifa:Math.max(0,Math.round(Number(z?.tarifa)||0)), activa:z?.activa!==false,
      predeterminada:z?.predeterminada===true, orden:Number.isFinite(Number(z?.orden))?Number(z.orden):i+1
    })).filter(z=>z.nombre&&z.tarifa>0).sort((a,b)=>a.orden-b.orden||a.nombre.localeCompare(b.nombre));
  }

  async function shared(){
    if(typeof window.loadShared==='function') return await window.loadShared();
    if(window.GoHouseVPS?.api){
      const r=await window.GoHouseVPS.api('/data?path=gohouse-data');
      return r?.value || r || {};
    }
    throw new Error('DATA_NOT_READY');
  }

  function addStyles(){
    if($('gh-tarifas-style')) return;
    const s=document.createElement('style');s.id='gh-tarifas-style';s.textContent=`
      .gh-tariff-list{display:grid;gap:8px;margin:12px 0}.gh-tariff-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:center;border:1px solid var(--line,#33473D);border-radius:10px;padding:11px 12px;background:var(--surface-2,#24392F)}
      .gh-tariff-name{font-weight:750}.gh-tariff-sub{font-size:.7rem;color:var(--text-dim,#A9B8B0);margin-top:2px}.gh-tariff-price{font-weight:800;white-space:nowrap}.gh-tariff-actions{display:flex;gap:6px}.gh-tariff-actions button{border:1px solid var(--line,#33473D);background:transparent;color:inherit;border-radius:7px;padding:6px 8px;cursor:pointer}.gh-tariff-editor{display:none;margin-top:12px;border-top:1px solid var(--line,#33473D);padding-top:12px}.gh-tariff-editor.show{display:block}
      #gh-client-tariff{margin:12px 0 16px;padding:14px;border:1px solid var(--line,#2A415F);border-radius:12px;background:var(--surface,#16273D)}#gh-client-tariff select{margin:7px 0 8px}#gh-client-tariff-price{font-size:1.15rem;font-weight:850;color:var(--teal,#34C6C0)}
      @media(max-width:600px){.gh-tariff-row{grid-template-columns:minmax(0,1fr) auto}.gh-tariff-actions{grid-column:1/-1}.gh-tariff-actions button{flex:1}}
    `;document.head.appendChild(s);
  }

  /* PANEL */
  async function panelIsAdmin(){
    try{
      const session=await window.GoHouseVPS?.api?.('/auth/session');
      const email=String(session?.user?.email||'').toLowerCase();
      const d=await shared();
      const users=d?.usuariosPanel||{};
      return Object.values(users).some(u=>String(u?.email||'').toLowerCase()===email&&u?.activo!==false&&u?.rol==='administrador');
    }catch{return false;}
  }

  async function mountPanel(){
    if(kind()!=='panel'||$('gh-zonas-tarifas')) return;
    const view=$('vista-ajustes'); if(!view||typeof window.saveShared!=='function'||!(await panelIsAdmin())) return;
    addStyles();
    const d=await shared(),zones=normalizeZones(d?.config?.tarifasZonas);
    const section=document.createElement('section');section.id='gh-zonas-tarifas';
    section.innerHTML=`<h2>🧭 Zonas y tarifas</h2><div class="new-order"><div style="font-size:.8rem;color:var(--text-dim,#A9B8B0)">Estas tarifas se cargan al pedido desde el cliente. El domiciliario recibe el valor ya definido.</div><div id="gh-tariff-list" class="gh-tariff-list"></div><button type="button" class="btn btn-primary btn-full" id="gh-add-tariff">+ Agregar referencia</button><div id="gh-tariff-editor" class="gh-tariff-editor"><div class="grid"><div class="field"><label>Nombre / referencia</label><input id="gh-tariff-name" placeholder="Ej: Nueva zona"></div><div class="field"><label>Tarifa</label><input id="gh-tariff-value" type="number" min="1" step="500" placeholder="5000"></div><div class="field full" style="display:flex;gap:8px;align-items:center"><input id="gh-tariff-active" type="checkbox" checked style="width:auto;margin:0"><label for="gh-tariff-active" style="margin:0;text-transform:none">Activa para clientes</label></div></div><div style="display:flex;gap:8px"><button class="btn btn-primary" id="gh-save-tariff" type="button" style="flex:1">Guardar</button><button class="btn btn-ghost" id="gh-cancel-tariff" type="button" style="flex:1">Cancelar</button></div><input type="hidden" id="gh-tariff-id"></div></div>`;
    const first=view.querySelector('section'); if(first?.nextSibling) view.insertBefore(section,first.nextSibling); else view.appendChild(section);
    $('gh-add-tariff').addEventListener('click',()=>openEditor());
    $('gh-cancel-tariff').addEventListener('click',closeEditor);
    $('gh-save-tariff').addEventListener('click',saveEditor);
    $('gh-tariff-list').addEventListener('click',onPanelListClick);
    renderPanelRows(zones);
  }

  function renderPanelRows(zones){
    const list=$('gh-tariff-list'); if(!list)return;
    list.innerHTML=zones.map(z=>`<div class="gh-tariff-row" data-zone="${esc(z.id)}"><div><div class="gh-tariff-name">${esc(z.nombre)}${z.predeterminada?' <span style="font-size:.62rem;color:var(--teal,#34C6C0)">PREDETERMINADA</span>':''}</div><div class="gh-tariff-sub">${z.activa?'Activa':'Inactiva'}</div></div><div class="gh-tariff-price">${money(z.tarifa)}</div><div class="gh-tariff-actions"><button type="button" data-edit="${esc(z.id)}">Editar</button>${z.predeterminada?'':`<button type="button" data-delete="${esc(z.id)}">Eliminar</button>`}</div></div>`).join('')||'<div class="empty">No hay referencias configuradas.</div>';
  }

  async function getPanelZones(){const d=await shared();return {d,zones:normalizeZones(d?.config?.tarifasZonas)};}
  function openEditor(z=null){$('gh-tariff-editor')?.classList.add('show');$('gh-tariff-id').value=z?.id||'';$('gh-tariff-name').value=z?.nombre||'';$('gh-tariff-value').value=z?.tarifa||'';$('gh-tariff-active').checked=z?.activa!==false;setTimeout(()=>$('gh-tariff-name')?.focus(),50);}
  function closeEditor(){$('gh-tariff-editor')?.classList.remove('show');}

  async function onPanelListClick(e){
    const edit=e.target?.dataset?.edit,del=e.target?.dataset?.delete;
    if(edit){const {zones}=await getPanelZones();openEditor(zones.find(z=>z.id===edit)||null);}
    if(del){if(!confirm('¿Eliminar esta referencia de tarifa?'))return;const {d,zones}=await getPanelZones();d.config=d.config||{};d.config.tarifasZonas=zones.filter(z=>z.id!==del).map((z,i)=>({...z,orden:i+1}));await window.saveShared(d);renderPanelRows(d.config.tarifasZonas);window.showToast?.('Referencia eliminada.');}
  }

  async function saveEditor(){
    const name=String($('gh-tariff-name')?.value||'').trim(),value=Math.round(Number($('gh-tariff-value')?.value)||0),id0=String($('gh-tariff-id')?.value||'');
    if(!name||value<=0){window.showToast?.('Escribe nombre y tarifa válidos.');return;}
    const {d,zones}=await getPanelZones();let id=id0||slug(name);if(!id0&&zones.some(z=>z.id===id))id+='-'+Date.now().toString(36).slice(-4);
    const old=zones.find(z=>z.id===id);const next={id,nombre:name,tarifa:value,activa:!!$('gh-tariff-active')?.checked,predeterminada:old?.predeterminada===true,orden:old?.orden||zones.length+1};
    const out=old?zones.map(z=>z.id===id?next:z):[...zones,next];d.config=d.config||{};d.config.tarifasZonas=out;await window.saveShared(d);renderPanelRows(out);closeEditor();window.showToast?.('Referencia guardada.');
  }

  /* CLIENTE */
  let clientZones=[],selectedZoneId='',clientSavePatched=false;
  async function mountClient(){
    if(kind()!=='client')return;
    const step=$('step-mandado'),button=$('btn-confirmar');if(!step||!button||typeof window.loadShared!=='function')return;
    addStyles();
    try{const d=await shared();clientZones=normalizeZones(d?.config?.tarifasZonas).filter(z=>z.activa);if(!clientZones.length)return;}
    catch{return;}
    let card=$('gh-client-tariff');
    if(!card){card=document.createElement('div');card.id='gh-client-tariff';button.parentNode.insertBefore(card,button);}
    const def=clientZones.find(z=>z.predeterminada)||clientZones[0];if(!clientZones.some(z=>z.id===selectedZoneId))selectedZoneId=def.id;
    card.innerHTML=`<label style="margin:0">Zona / referencia de entrega</label><select id="gh-client-zone">${clientZones.map(z=>`<option value="${esc(z.id)}" ${z.id===selectedZoneId?'selected':''}>${esc(z.nombre)} — ${money(z.tarifa)}</option>`).join('')}</select><div style="font-size:.72rem;color:var(--text-dim,#93A7BE)">El valor queda definido antes de enviar el domicilio.</div><div id="gh-client-tariff-price"></div>`;
    $('gh-client-zone').addEventListener('change',e=>{selectedZoneId=e.target.value;updateClientPrice();});updateClientPrice();patchClientSave();
  }
  function updateClientPrice(){const z=clientZones.find(x=>x.id===selectedZoneId);const el=$('gh-client-tariff-price');if(el&&z)el.textContent=`Valor del domicilio: ${money(z.tarifa)}`;}
  function patchClientSave(){
    if(clientSavePatched||typeof window.saveShared!=='function')return;const original=window.saveShared;if(original.__ghTarifas)return;
    const wrapped=async function(next){
      try{const now=Date.now(),z=clientZones.find(x=>x.id===selectedZoneId);if(z&&Array.isArray(next?.orders)){const o=next.orders.find(x=>x&&x.estado==='nuevo'&&!x.zonaTarifaId&&now-Number(x.createdAt||0)<90000);if(o){const pct=Number(next?.config?.porcentajeCasa)||0;o.zonaTarifaId=z.id;o.zonaTarifaNombre=z.nombre;o.tarifa=z.tarifa;o.tarifaFijada=true;o.porcentajeCasaSnapshot=pct;o.comisionCasa=Math.round(z.tarifa*pct/100);o.gananciaDomiciliario=z.tarifa-o.comisionCasa;}}}catch{}
      return original(next);
    };wrapped.__ghTarifas=true;window.saveShared=wrapped;clientSavePatched=true;
  }

  /* DOMICILIARIO */
  let driverBusy=false;
  async function patchDriver(){
    if(kind()!=='driver'||driverBusy||!window.GoHouseVPS?.api)return;const input=$('in-valor-servicio');if(!input)return;driverBusy=true;
    try{const r=await window.GoHouseVPS.api('/data?path=gohouse-data'),d=r?.value||{},orders=Array.isArray(d?.orders)?d.orders:[];const o=orders.find(x=>x&&x.estado==='camino'&&Number(x.tarifa)>0&&x.zonaTarifaId);if(!o)return;input.value=String(Math.round(Number(o.tarifa)));input.readOnly=true;input.setAttribute('aria-readonly','true');input.style.opacity='.9';input.style.cursor='default';const label=input.previousElementSibling;if(label?.tagName==='LABEL')label.textContent='Valor del domicilio (definido por zona)';const preview=$('preview-ganancia-entrega');if(preview){const mine=Number(o.gananciaDomiciliario);const house=Number(o.comisionCasa);preview.textContent=`${o.zonaTarifaNombre||'Tarifa definida'} · ${money(o.tarifa)}${Number.isFinite(mine)?` · Para ti ${money(mine)}`:''}${Number.isFinite(house)?` · Empresa ${money(house)}`:''}`;}}
    catch{}finally{driverBusy=false;}
  }

  async function boot(){
    addStyles();
    if(kind()==='panel'){
      for(let i=0;i<80;i++){if($('vista-ajustes')&&typeof window.loadShared==='function'&&typeof window.saveShared==='function'){await mountPanel();break;}await sleep(250);}
      document.addEventListener('click',e=>{if(e.target?.id==='tab-ajustes')setTimeout(mountPanel,80);},true);
    }else if(kind()==='client'){
      for(let i=0;i<80;i++){if($('step-mandado')&&typeof window.loadShared==='function'){await mountClient();break;}await sleep(250);}
      const obs=new MutationObserver(()=>{if(!$('gh-client-tariff'))setTimeout(mountClient,50);});obs.observe(document.body,{childList:true,subtree:true});
    }else{
      setInterval(patchDriver,2500);const obs=new MutationObserver(()=>setTimeout(patchDriver,50));obs.observe(document.body,{childList:true,subtree:true});setTimeout(patchDriver,500);
    }
  }

  window.GoHouseTarifas={mountPanel,mountClient,patchDriver};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
