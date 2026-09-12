import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool, withTx } from './db.js';
import { config } from './config.js';
import { signPrincipal } from './auth.js';
import { getRoot } from './store.js';
import { sendClientRecoveryCode, clientRecoveryMailReady } from './client-mail.js';

const EMAIL_RE=/^\S+@\S+\.\S+$/;
const RESET_TTL_MS=15*60*1000;
const RESET_MIN_INTERVAL_MS=60*1000;
const RESET_MAX_ATTEMPTS=6;

export { clientRecoveryMailReady };

function validation(message,status=400){ const e=new Error(message); e.status=status; return e; }
function cleanEmail(v){ return String(v||'').trim().toLowerCase(); }
function cleanPhone(v){ return String(v||'').replace(/\s+/g,' ').trim(); }
function normalizeProfile(raw={}){
  const p={
    nombre:String(raw.nombre||'').trim(),
    cedula:String(raw.cedula||'').trim(),
    celular:cleanPhone(raw.celular),
    direccion:String(raw.direccion||'').trim(),
    ciudad:String(raw.ciudad||'').trim()
  };
  if(!p.nombre||!p.cedula||!p.celular||!p.direccion||!p.ciudad) throw validation('PROFILE_INVALID');
  return p;
}
function validatePassword(v){ const p=String(v||''); if(p.length<8) throw validation('PASSWORD_TOO_SHORT'); return p; }
function accountPrincipal(row){ return {sub:row.id,uid:row.id,type:'client',email:row.email,account:true,sv:Number(row.session_version||1)}; }
function publicUser(row){ return {uid:row.id,email:row.email,type:'client',account:true}; }
function resetHash(clientId,code){ return crypto.createHmac('sha256',config.jwtSecret).update(`${clientId}:${code}`).digest('hex'); }

export async function registerClient({email,password,profile,legacyPrincipal=null}){
  email=cleanEmail(email); if(!EMAIL_RE.test(email)) throw validation('EMAIL_INVALIDO');
  password=validatePassword(password); profile=normalizeProfile(profile);
  const passwordHash=await bcrypt.hash(password,12); const id=crypto.randomUUID();

  const out=await withTx(async client=>{
    const existing=await client.query('SELECT id FROM client_accounts WHERE lower(email)=lower($1) LIMIT 1',[email]);
    if(existing.rowCount) throw validation('EMAIL_ALREADY_EXISTS',409);
    await client.query('INSERT INTO client_accounts(id,email,password_hash,enabled,session_version) VALUES($1,$2,$3,true,1)',[id,email,passwordHash]);

    const st=await client.query('SELECT data,version FROM app_state WHERE id=1 FOR UPDATE');
    const root=structuredClone(st.rows[0]?.data||{}); const version=Number(st.rows[0]?.version||0);
    root['gohouse-data']=root['gohouse-data']||{}; const g=root['gohouse-data'];
    g.clientes=g.clientes&&typeof g.clientes==='object'?g.clientes:{};
    g.orders=Array.isArray(g.orders)?g.orders:[];

    const legacyUid=(legacyPrincipal?.type==='client' && !legacyPrincipal?.account && legacyPrincipal?.uid) ? String(legacyPrincipal.uid) : '';
    const legacy=legacyUid && g.clientes[legacyUid] && typeof g.clientes[legacyUid]==='object' ? g.clientes[legacyUid] : null;
    const merged={...(legacy||{}),...profile,email,uid:id,registradoEn:legacy?.registradoEn||Date.now(),cuentaCreadaEn:Date.now()};
    g.clientes[id]=merged;
    if(legacyUid && legacyUid!==id){
      delete g.clientes[legacyUid];
      g.orders=g.orders.map(o=>o && String(o.clienteUid||'')===legacyUid ? {...o,clienteUid:id} : o);
    }
    await client.query('UPDATE app_state SET data=$1,version=$2,updated_at=now() WHERE id=1',[JSON.stringify(root),version+1]);
    return {profile:merged};
  });

  const row={id,email,session_version:1};
  return {token:signPrincipal(accountPrincipal(row)),user:publicUser(row),profile:out.profile};
}

export async function loginClient(email,password){
  email=cleanEmail(email); password=String(password||'');
  const {rows}=await pool.query('SELECT id,email,password_hash,enabled,session_version FROM client_accounts WHERE lower(email)=lower($1) LIMIT 1',[email]);
  const row=rows[0]; if(!row||!row.enabled||!(await bcrypt.compare(password,row.password_hash))) return null;
  const {data}=await getRoot();
  const profile=data?.['gohouse-data']?.clientes?.[row.id]||{uid:row.id,email:row.email};
  return {token:signPrincipal(accountPrincipal(row)),user:publicUser(row),profile:{...profile,email:row.email,uid:row.id}};
}

export async function getClientProfile(principal){
  if(principal?.type!=='client'||!principal?.account||!principal?.uid) throw validation('ACCOUNT_REQUIRED',403);
  const {rows}=await pool.query('SELECT id,email,enabled,session_version FROM client_accounts WHERE id=$1 LIMIT 1',[principal.uid]);
  const row=rows[0]; if(!row||!row.enabled) throw validation('INVALID_SESSION',401);
  const {data}=await getRoot();
  const p=data?.['gohouse-data']?.clientes?.[row.id];
  if(!p) throw validation('PROFILE_NOT_FOUND',404);
  return {...p,email:row.email,uid:row.id};
}

export async function requestClientPasswordReset(email){
  email=cleanEmail(email); if(!EMAIL_RE.test(email)) throw validation('EMAIL_INVALIDO');
  const {rows}=await pool.query('SELECT id,email,enabled FROM client_accounts WHERE lower(email)=lower($1) LIMIT 1',[email]);
  const account=rows[0];
  if(!account||!account.enabled) return {ok:true};
  if(!clientRecoveryMailReady()) throw validation('MAIL_NOT_CONFIGURED',503);

  const recent=await pool.query('SELECT created_at FROM client_password_resets WHERE client_id=$1 ORDER BY created_at DESC LIMIT 1',[account.id]);
  if(recent.rows[0] && Date.now()-new Date(recent.rows[0].created_at).getTime()<RESET_MIN_INTERVAL_MS) return {ok:true};

  const code=String(crypto.randomInt(100000,1000000));
  const hash=resetHash(account.id,code); const expires=new Date(Date.now()+RESET_TTL_MS);
  const {data}=await getRoot(); const brandName=String(data?.['gohouse-data']?.config?.brandName||'Domicilios').trim()||'Domicilios';
  const id=await withTx(async client=>{
    await client.query('UPDATE client_password_resets SET used=true WHERE client_id=$1 AND used=false',[account.id]);
    const ins=await client.query('INSERT INTO client_password_resets(client_id,code_hash,expires_at,attempts,used) VALUES($1,$2,$3,0,false) RETURNING id',[account.id,hash,expires]);
    return ins.rows[0].id;
  });
  try{ await sendClientRecoveryCode({to:account.email,code,brandName}); }
  catch(err){ await pool.query('UPDATE client_password_resets SET used=true WHERE id=$1',[id]).catch(()=>{}); throw err; }
  return {ok:true};
}

export async function resetClientPassword(email,code,newPassword){
  email=cleanEmail(email); if(!EMAIL_RE.test(email)) throw validation('EMAIL_INVALIDO');
  code=String(code||'').replace(/\D/g,''); if(!/^\d{6}$/.test(code)) throw validation('CODE_INVALID');
  newPassword=validatePassword(newPassword);
  const {rows}=await pool.query('SELECT id,email,enabled FROM client_accounts WHERE lower(email)=lower($1) LIMIT 1',[email]);
  const account=rows[0]; if(!account||!account.enabled) throw validation('CODE_INVALID');

  const rr=await pool.query('SELECT id,code_hash,expires_at,attempts,used FROM client_password_resets WHERE client_id=$1 AND used=false ORDER BY created_at DESC LIMIT 1',[account.id]);
  const reset=rr.rows[0]; if(!reset) throw validation('CODE_INVALID');
  if(new Date(reset.expires_at).getTime()<Date.now()){ await pool.query('UPDATE client_password_resets SET used=true WHERE id=$1',[reset.id]); throw validation('CODE_EXPIRED'); }
  if(Number(reset.attempts||0)>=RESET_MAX_ATTEMPTS){ await pool.query('UPDATE client_password_resets SET used=true WHERE id=$1',[reset.id]); throw validation('TOO_MANY_ATTEMPTS'); }
  const expected=resetHash(account.id,code);
  const a=Buffer.from(String(reset.code_hash),'hex'), b=Buffer.from(expected,'hex');
  const good=a.length===b.length && crypto.timingSafeEqual(a,b);
  if(!good){
    const attempts=Number(reset.attempts||0)+1;
    await pool.query('UPDATE client_password_resets SET attempts=$2,used=CASE WHEN $2 >= $3 THEN true ELSE used END WHERE id=$1',[reset.id,attempts,RESET_MAX_ATTEMPTS]);
    if(attempts>=RESET_MAX_ATTEMPTS) throw validation('TOO_MANY_ATTEMPTS');
    throw validation('CODE_INVALID');
  }
  const hash=await bcrypt.hash(newPassword,12);
  await withTx(async client=>{
    await client.query('UPDATE client_accounts SET password_hash=$2,session_version=session_version+1,updated_at=now() WHERE id=$1',[account.id,hash]);
    await client.query('UPDATE client_password_resets SET used=true WHERE client_id=$1 AND used=false',[account.id]);
    await client.query("DELETE FROM push_subscriptions WHERE principal_type='client' AND principal_id=$1",[account.id]);
  });
  return {ok:true};
}
