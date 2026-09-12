/* Recuperación de contraseña por correo usando Resend HTTP API.
   No guarda credenciales en el código: usa RESEND_API_KEY y RESEND_FROM_EMAIL. */

export function clientRecoveryMailReady(){
  return Boolean(String(process.env.RESEND_API_KEY || '').trim() && String(process.env.RESEND_FROM_EMAIL || '').trim());
}

export async function sendClientRecoveryCode({to,code,brandName}){
  const apiKey=String(process.env.RESEND_API_KEY || '').trim();
  const fromEmail=String(process.env.RESEND_FROM_EMAIL || '').trim();
  if(!apiKey || !fromEmail){ const e=new Error('MAIL_NOT_CONFIGURED'); e.status=503; throw e; }
  const safeBrand=String(brandName || 'Domicilios').trim() || 'Domicilios';
  const fromName=String(process.env.RESEND_FROM_NAME || safeBrand).trim() || safeBrand;
  const subject=`${safeBrand} · Código para recuperar tu contraseña`;
  const text=`Tu código de recuperación es ${code}.\n\nEste código vence en 15 minutos. Si no solicitaste este cambio, ignora este mensaje.`;
  const html=`<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f5f6f7;padding:28px"><div style="max-width:520px;margin:auto;background:#fff;border-radius:14px;padding:26px"><h2 style="margin-top:0">${escapeHtml(safeBrand)}</h2><p>Usa este código para recuperar tu contraseña:</p><div style="font-size:32px;font-weight:800;letter-spacing:8px;margin:22px 0">${escapeHtml(code)}</div><p style="color:#5f6b75">El código vence en 15 minutos. Si no solicitaste este cambio, puedes ignorar este correo.</p></div></body></html>`;
  let res;
  try{
    res=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({from:`${fromName} <${fromEmail}>`,to:[to],subject,text,html})
    });
  }catch(err){
    const e=new Error('MAIL_SEND_FAILED'); e.status=502; e.cause=err; throw e;
  }
  if(!res.ok){
    const detail=await res.text().catch(()=>String(res.status));
    console.error('[client recovery mail]',res.status,detail.slice(0,500));
    const e=new Error('MAIL_SEND_FAILED'); e.status=502; throw e;
  }
  return true;
}

function escapeHtml(v){
  return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
