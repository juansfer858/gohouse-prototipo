import net from 'node:net';
import tls from 'node:tls';
import crypto, { randomUUID } from 'node:crypto';
import { pool } from './db.js';
import { config } from './config.js';

const SMTP_HOST='smtp.gmail.com';
const SMTP_PORT=587;

export function clientRecoveryMailReady(){
  return true;
}

export async function getRecoveryMailSettingsForAdmin(){
  const row=await getSettingsRow();
  if(!row){
    return {
      provider:'gmail',
      enabled:false,
      fromName:'',
      fromEmail:'',
      replyTo:'',
      hasAppPassword:false,
      smtpHost:SMTP_HOST,
      smtpPort:SMTP_PORT
    };
  }
  return publicSettings(row);
}

export async function saveRecoveryMailSettings(raw={},updatedBy=''){
  const existing=await getSettingsRow();
  const fromName=String(raw.fromName||'').trim();
  const fromEmail=cleanEmail(raw.fromEmail);
  const replyTo=cleanEmail(raw.replyTo);
  const enabled=raw.enabled===true;
  const suppliedPassword=normalizeAppPassword(raw.appPassword);
  const passwordEnc=suppliedPassword ? encryptSecret(suppliedPassword) : String(existing?.app_password_enc||'');

  if(!fromName) throw validation('RECOVERY_FROM_NAME_REQUIRED');
  if(!validEmail(fromEmail)) throw validation('RECOVERY_GMAIL_INVALID');
  if(replyTo && !validEmail(replyTo)) throw validation('RECOVERY_REPLY_TO_INVALID');
  if(suppliedPassword && !validAppPassword(suppliedPassword)) throw validation('APP_PASSWORD_INVALID');
  if(enabled && !passwordEnc) throw validation('APP_PASSWORD_REQUIRED');

  const {rows}=await pool.query(
    `INSERT INTO recovery_mail_settings(id,provider,from_name,from_email,app_password_enc,reply_to,enabled,updated_by,updated_at)
     VALUES(1,'gmail',$1,$2,$3,$4,$5,$6,now())
     ON CONFLICT(id) DO UPDATE SET
       provider='gmail',from_name=EXCLUDED.from_name,from_email=EXCLUDED.from_email,
       app_password_enc=EXCLUDED.app_password_enc,reply_to=EXCLUDED.reply_to,
       enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=now()
     RETURNING *`,
    [fromName,fromEmail,passwordEnc,replyTo,enabled,String(updatedBy||'')]
  );
  return publicSettings(rows[0]);
}

export async function sendClientRecoveryCode({to,code,brandName}){
  const mail=await operationalSettings(brandName);
  const subject=`${mail.fromName} · Código para recuperar tu contraseña`;
  const text=`Tu código de recuperación es ${code}.\n\nEste código vence en 15 minutos. Si no solicitaste este cambio, ignora este mensaje.`;
  const html=`<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f5f6f7;padding:28px"><div style="max-width:520px;margin:auto;background:#fff;border-radius:14px;padding:26px"><h2 style="margin-top:0">${escapeHtml(mail.fromName)}</h2><p>Usa este código para recuperar tu contraseña:</p><div style="font-size:32px;font-weight:800;letter-spacing:8px;margin:22px 0">${escapeHtml(code)}</div><p style="color:#5f6b75">El código vence en 15 minutos. Si no solicitaste este cambio, puedes ignorar este correo.</p></div></body></html>`;
  await sendSmtp({...mail,to,subject,text,html});
  return true;
}

export async function sendRecoveryMailTest(){
  const mail=await operationalSettings();
  const subject=`${mail.fromName} · Prueba de correo`;
  const text='La recuperación de contraseña por correo está configurada correctamente.';
  const html=`<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f5f6f7;padding:28px"><div style="max-width:520px;margin:auto;background:#fff;border-radius:14px;padding:26px"><h2 style="margin-top:0">${escapeHtml(mail.fromName)}</h2><p>La recuperación de contraseña por correo está configurada correctamente.</p></div></body></html>`;
  await sendSmtp({...mail,to:mail.fromEmail,subject,text,html});
  return {ok:true,to:mail.fromEmail};
}

async function operationalSettings(brandName=''){
  const row=await getSettingsRow();
  if(!row || row.enabled!==true || !row.from_email || !row.app_password_enc){
    throw validation('MAIL_NOT_CONFIGURED',503);
  }
  const appPassword=decryptSecret(row.app_password_enc);
  if(!appPassword) throw validation('MAIL_NOT_CONFIGURED',503);
  return {
    fromEmail:String(row.from_email).trim().toLowerCase(),
    fromName:String(row.from_name||brandName||'Domicilios').trim()||'Domicilios',
    replyTo:String(row.reply_to||'').trim().toLowerCase(),
    appPassword
  };
}

async function getSettingsRow(){
  const {rows}=await pool.query('SELECT * FROM recovery_mail_settings WHERE id=1 LIMIT 1');
  return rows[0]||null;
}

function publicSettings(row){
  return {
    provider:'gmail',
    enabled:row?.enabled===true,
    fromName:String(row?.from_name||''),
    fromEmail:String(row?.from_email||''),
    replyTo:String(row?.reply_to||''),
    hasAppPassword:!!String(row?.app_password_enc||''),
    smtpHost:SMTP_HOST,
    smtpPort:SMTP_PORT,
    updatedAt:row?.updated_at||null
  };
}

async function sendSmtp({fromEmail,fromName,replyTo,appPassword,to,subject,text,html}){
  if(!validEmail(to)) throw validation('INVALID_EMAIL');
  let socket=await connectPlain(SMTP_HOST,SMTP_PORT);
  let smtp=createProtocol(socket);
  try{
    await smtp.expect([220]);
    smtp.write('EHLO domicilios.vantixgc.com'); await smtp.expect([250]);
    smtp.write('STARTTLS'); await smtp.expect([220]);
    smtp.detach();
    socket=await upgradeTls(socket,SMTP_HOST);
    smtp=createProtocol(socket);
    smtp.write('EHLO domicilios.vantixgc.com'); await smtp.expect([250]);

    smtp.write('AUTH LOGIN'); await smtp.expect([334]);
    smtp.write(Buffer.from(fromEmail,'utf8').toString('base64')); await smtp.expect([334]);
    smtp.write(Buffer.from(appPassword,'utf8').toString('base64')); await smtp.expect([235]);

    smtp.write(`MAIL FROM:<${fromEmail}>`); await smtp.expect([250]);
    smtp.write(`RCPT TO:<${String(to).trim().toLowerCase()}>`); await smtp.expect([250,251]);
    smtp.write('DATA'); await smtp.expect([354]);
    socket.write(buildMessage({fromEmail,fromName,replyTo,to,subject,text,html})+'\r\n.\r\n');
    await smtp.expect([250]);
    smtp.write('QUIT'); await smtp.expect([221]).catch(()=>{});
  }catch(err){
    const raw=String(err?.message||'');
    let message='MAIL_SEND_FAILED';
    if(raw.startsWith('SMTP_535')) message='GMAIL_APP_PASSWORD_REJECTED';
    else if(raw.startsWith('SMTP_534')) message='GMAIL_AUTH_REQUIRED';
    else if(raw.startsWith('SMTP_')) message=raw;
    const e=new Error(message); e.status=502; e.cause=err; throw e;
  }finally{
    try{smtp?.detach?.();socket.end();}catch{}
  }
}

function connectPlain(host,port){
  return new Promise((resolve,reject)=>{
    const s=net.createConnection({host,port});
    s.setTimeout(15000,()=>s.destroy(new Error('SMTP_TIMEOUT')));
    s.once('connect',()=>resolve(s)); s.once('error',reject);
  });
}

function upgradeTls(socket,host){
  return new Promise((resolve,reject)=>{
    const s=tls.connect({socket,servername:host,rejectUnauthorized:true});
    s.setTimeout(15000,()=>s.destroy(new Error('SMTP_TLS_TIMEOUT')));
    s.once('secureConnect',()=>resolve(s)); s.once('error',reject);
  });
}

function createProtocol(socket){
  let buffer=''; const queue=[]; const waiters=[];
  const fail=err=>{while(waiters.length)waiters.shift().reject(err);};
  const pump=()=>{while(queue.length&&waiters.length){const item=queue.shift();const waiter=waiters.shift();waiter.resolve(item);}};
  const onData=chunk=>{
    buffer+=chunk.toString('utf8');
    for(;;){
      const idx=buffer.indexOf('\n'); if(idx<0)break;
      const line=buffer.slice(0,idx+1).replace(/\r?\n$/,''); buffer=buffer.slice(idx+1);
      queue.push(line); pump();
    }
  };
  const onError=err=>fail(err);
  const onClose=()=>fail(new Error('SMTP_CONNECTION_CLOSED'));
  socket.on('data',onData); socket.on('error',onError); socket.on('close',onClose);
  const readLine=()=>queue.length?Promise.resolve(queue.shift()):new Promise((resolve,reject)=>waiters.push({resolve,reject}));
  return {
    write(line){socket.write(line+'\r\n');},
    detach(){socket.off('data',onData);socket.off('error',onError);socket.off('close',onClose);},
    async expect(allowed){
      const lines=[];
      for(;;){
        const line=await readLine(); lines.push(line);
        const m=line.match(/^(\d{3})([ -])/); if(!m)continue;
        if(m[2]==='-')continue;
        const code=Number(m[1]);
        if(!allowed.includes(code)) throw new Error(`SMTP_${code}_${lines.join(' | ').slice(0,300)}`);
        return {code,lines};
      }
    }
  };
}

function secretKey(){
  const secret=String(config.jwtSecret||'');
  if(secret.length<16) throw validation('MAIL_SECRET_NOT_CONFIGURED',500);
  return crypto.createHash('sha256').update(secret,'utf8').digest();
}

function encryptSecret(value){
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',secretKey(),iv);
  const encrypted=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);
  const tag=cipher.getAuthTag();
  return ['v1',iv.toString('base64url'),tag.toString('base64url'),encrypted.toString('base64url')].join('.');
}

function decryptSecret(value){
  const parts=String(value||'').split('.');
  if(parts.length!==4||parts[0]!=='v1') return '';
  try{
    const iv=Buffer.from(parts[1],'base64url');
    const tag=Buffer.from(parts[2],'base64url');
    const data=Buffer.from(parts[3],'base64url');
    const decipher=crypto.createDecipheriv('aes-256-gcm',secretKey(),iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8');
  }catch{
    return '';
  }
}

function buildMessage({fromEmail,fromName,replyTo,to,subject,text,html}){
  const boundary='gh-'+randomUUID();
  const domain=fromEmail.split('@')[1]||'localhost';
  const headers=[
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    `From: ${mimeWord(fromName)} <${fromEmail}>`,
    `To: <${String(to).trim().toLowerCase()}>`,
    `Subject: ${mimeWord(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ];
  if(replyTo) headers.splice(4,0,`Reply-To: <${replyTo}>`);
  return headers.join('\r\n')+'\r\n\r\n'+
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(text)}\r\n`+
    `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(html)}\r\n`+
    `--${boundary}--`;
}

function validation(message,status=400){ const e=new Error(message); e.status=status; return e; }
function normalizeAppPassword(v){ return String(v||'').replace(/\s+/g,'').trim(); }
function validAppPassword(v){ return /^[A-Za-z0-9]{16}$/.test(String(v||'')); }
function cleanEmail(v){ return String(v||'').trim().toLowerCase(); }
function validEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||'')); }
function b64(v){ const s=Buffer.from(String(v),'utf8').toString('base64'); return (s.match(/.{1,76}/g)||['']).join('\r\n'); }
function mimeWord(v){ return `=?UTF-8?B?${Buffer.from(String(v),'utf8').toString('base64')}?=`; }
function escapeHtml(v){ return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c])); }
