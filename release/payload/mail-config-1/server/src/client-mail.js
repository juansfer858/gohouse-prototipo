import net from 'node:net';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';
import { getRoot } from './store.js';

const SMTP_HOST='smtp-relay.gmail.com';
const SMTP_PORT=587;

export function clientRecoveryMailReady(){
  return true;
}

export async function sendClientRecoveryCode({to,code,brandName}){
  const mail=await getMailConfig(brandName);
  if(!mail.enabled || !mail.fromEmail){ const e=new Error('MAIL_NOT_CONFIGURED'); e.status=503; throw e; }
  const subject=`${mail.fromName} · Código para recuperar tu contraseña`;
  const text=`Tu código de recuperación es ${code}.\n\nEste código vence en 15 minutos. Si no solicitaste este cambio, ignora este mensaje.`;
  const html=`<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f5f6f7;padding:28px"><div style="max-width:520px;margin:auto;background:#fff;border-radius:14px;padding:26px"><h2 style="margin-top:0">${escapeHtml(mail.fromName)}</h2><p>Usa este código para recuperar tu contraseña:</p><div style="font-size:32px;font-weight:800;letter-spacing:8px;margin:22px 0">${escapeHtml(code)}</div><p style="color:#5f6b75">El código vence en 15 minutos. Si no solicitaste este cambio, puedes ignorar este correo.</p></div></body></html>`;
  await sendSmtp({fromEmail:mail.fromEmail,fromName:mail.fromName,replyTo:mail.replyTo,to,subject,text,html});
  return true;
}

async function getMailConfig(brandName){
  const { data }=await getRoot();
  const cfg=data?.['gohouse-data']?.config || {};
  const fromEmail=String(cfg.recoveryFromEmail || '').trim().toLowerCase();
  const fromName=String(cfg.recoveryFromName || brandName || cfg.brandName || 'Domicilios').trim() || 'Domicilios';
  const replyTo=String(cfg.recoveryReplyTo || '').trim().toLowerCase();
  const enabled=cfg.recoveryMailEnabled === true;
  if(fromEmail && !validEmail(fromEmail)){ const e=new Error('INVALID_RECOVERY_FROM_EMAIL'); e.status=400; throw e; }
  if(replyTo && !validEmail(replyTo)){ const e=new Error('INVALID_RECOVERY_REPLY_TO'); e.status=400; throw e; }
  return {enabled,fromEmail,fromName,replyTo};
}

async function sendSmtp({fromEmail,fromName,replyTo,to,subject,text,html}){
  if(!validEmail(to)){ const e=new Error('INVALID_EMAIL'); e.status=400; throw e; }
  let socket=await connectPlain(SMTP_HOST,SMTP_PORT);
  let smtp=createProtocol(socket);
  try{
    await smtp.expect([220]);
    const helo=fromEmail.split('@')[1] || 'vantixgc.com';
    smtp.write(`EHLO ${helo}`); await smtp.expect([250]);
    smtp.write('STARTTLS'); await smtp.expect([220]);
    smtp.detach();
    socket=await upgradeTls(socket,SMTP_HOST);
    smtp=createProtocol(socket);
    smtp.write(`EHLO ${helo}`); await smtp.expect([250]);
    smtp.write(`MAIL FROM:<${fromEmail}>`); await smtp.expect([250]);
    smtp.write(`RCPT TO:<${String(to).trim().toLowerCase()}>`); await smtp.expect([250,251]);
    smtp.write('DATA'); await smtp.expect([354]);
    socket.write(buildMessage({fromEmail,fromName,replyTo,to,subject,text,html})+'\r\n.\r\n');
    await smtp.expect([250]);
    smtp.write('QUIT'); await smtp.expect([221]).catch(()=>{});
  }catch(err){
    const e=new Error(err?.message?.startsWith('SMTP_') ? err.message : 'MAIL_SEND_FAILED'); e.status=502; e.cause=err; throw e;
  }finally{ try{smtp?.detach?.();socket.end();}catch{} }
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
  const pump=()=>{
    while(queue.length && waiters.length){
      const item=queue.shift(); const waiter=waiters.shift(); waiter.resolve(item);
    }
  };
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

function buildMessage({fromEmail,fromName,replyTo,to,subject,text,html}){
  const boundary='gh-'+randomUUID();
  const domain=fromEmail.split('@')[1] || 'localhost';
  const headers=[
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    `From: ${mimeWord(fromName)} <${fromEmail}>`,
    `To: <${String(to).trim().toLowerCase()}>`,
    `Subject: ${mimeWord(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ];
  if(replyTo)headers.splice(4,0,`Reply-To: <${replyTo}>`);
  return headers.join('\r\n')+'\r\n\r\n'+
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(text)}\r\n`+
    `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(html)}\r\n`+
    `--${boundary}--`;
}

function b64(v){ const s=Buffer.from(String(v),'utf8').toString('base64'); return (s.match(/.{1,76}/g)||['']).join('\r\n'); }
function mimeWord(v){ return `=?UTF-8?B?${Buffer.from(String(v),'utf8').toString('base64')}?=`; }
function validEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||'')); }
function escapeHtml(v){ return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
