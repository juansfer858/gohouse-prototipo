import crypto from 'node:crypto';
import { pool } from './db.js';
import { getRoot } from './store.js';

const MAX_FILE = 8 * 1024 * 1024;
const DEFAULT_DOCS = [
  {id:'cedula',category:'personal',name:'Cédula',number:'',expiryDate:'',fileId:null,fileName:''},
  {id:'licencia',category:'personal',name:'Licencia de conducción',number:'',expiryDate:'',fileId:null,fileName:''},
  {id:'propiedad',category:'vehiculo',name:'Tarjeta de propiedad',number:'',expiryDate:'',fileId:null,fileName:''},
  {id:'soat',category:'vehiculo',name:'SOAT',number:'',expiryDate:'',fileId:null,fileName:''},
  {id:'rtm',category:'vehiculo',name:'RTM / Tecnomecánica',number:'',expiryDate:'',fileId:null,fileName:''}
];

function fail(message,status=400){const e=new Error(message);e.status=status;throw e;}
function cleanText(v,max=120){return String(v??'').trim().slice(0,max);}
function normalizeDate(v){const s=cleanText(v,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';}
function daysUntil(date){if(!date)return null;const d=new Date(date+'T12:00:00Z');if(Number.isNaN(d.getTime()))return null;return Math.floor((d-Date.now())/86400000);}
function statusFor(expiryDate){const d=daysUntil(expiryDate);if(d===null)return 'sin_fecha';if(d<0)return 'vencido';if(d<=30)return 'por_vencer';return 'vigente';}
async function requireAdmin(principal){
  if(principal?.type!=='panel'||!principal.email)fail('ADMIN_REQUIRED',403);
  const {data}=await getRoot();
  const users=Object.values(data?.['gohouse-data']?.usuariosPanel||{});
  const email=String(principal.email).toLowerCase();
  if(!users.some(u=>u?.activo!==false&&u?.rol==='administrador'&&String(u.email||'').toLowerCase()===email))fail('ADMIN_REQUIRED',403);
  return data;
}
function driverExists(data,id){return (data?.['gohouse-data']?.repartidores||[]).some(r=>String(r.id)===String(id));}
function normalizeRecord(body={}){
  const personal={
    nombreCompleto:cleanText(body.personal?.nombreCompleto,120),
    documento:cleanText(body.personal?.documento,40),
    celular:cleanText(body.personal?.celular,30),
    direccion:cleanText(body.personal?.direccion,180),
    contactoEmergencia:cleanText(body.personal?.contactoEmergencia,120),
    telefonoEmergencia:cleanText(body.personal?.telefonoEmergencia,30)
  };
  const vehicle={
    tipo:cleanText(body.vehicle?.tipo,40),
    placa:cleanText(body.vehicle?.placa,20).toUpperCase(),
    marca:cleanText(body.vehicle?.marca,60),
    linea:cleanText(body.vehicle?.linea,60),
    modelo:cleanText(body.vehicle?.modelo,20),
    color:cleanText(body.vehicle?.color,40)
  };
  const documents=(Array.isArray(body.documents)?body.documents:[]).slice(0,40).map((d,i)=>({
    id:cleanText(d?.id,80)||`doc-${i+1}`,
    category:['personal','vehiculo','otro'].includes(d?.category)?d.category:'otro',
    name:cleanText(d?.name,100)||'Documento',
    number:cleanText(d?.number,80),
    expiryDate:normalizeDate(d?.expiryDate),
    fileId:d?.fileId?cleanText(d.fileId,80):null,
    fileName:cleanText(d?.fileName,180),
    fileMime:cleanText(d?.fileMime,80)
  }));
  return {personal,vehicle,documents:documents.length?documents:structuredClone(DEFAULT_DOCS)};
}
function summary(record){const docs=record.documents||[];let vencidos=0,porVencer=0,vigentes=0;for(const d of docs){const s=statusFor(d.expiryDate);if(s==='vencido')vencidos++;else if(s==='por_vencer')porVencer++;else if(s==='vigente')vigentes++;}return {vencidos,porVencer,vigentes,total:docs.length};}
export function registerDriverDocumentRoutes(app,{authMiddleware}){
  const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};
  app.get('/api/driver-documents/summary',authMiddleware(),wrap(async(req,res)=>{
    const data=await requireAdmin(req.principal);
    const ids=(data?.['gohouse-data']?.repartidores||[]).map(r=>String(r.id));
    const {rows}=await pool.query('SELECT driver_id,documents FROM driver_document_records WHERE driver_id = ANY($1::text[])',[ids]);
    const out={};for(const id of ids)out[id]={vencidos:0,porVencer:0,vigentes:0,total:0};for(const row of rows)out[row.driver_id]=summary({documents:row.documents});
    res.set('Cache-Control','no-store').json(out);
  }));
  app.get('/api/driver-documents/:driverId',authMiddleware(),wrap(async(req,res)=>{
    const data=await requireAdmin(req.principal);const id=String(req.params.driverId);
    if(!driverExists(data,id))fail('DRIVER_NOT_FOUND',404);
    const {rows}=await pool.query('SELECT personal,vehicle,documents,updated_at FROM driver_document_records WHERE driver_id=$1',[id]);
    const rec=rows[0]?normalizeRecord(rows[0]):normalizeRecord({});
    res.set('Cache-Control','no-store').json({...rec,summary:summary(rec),updatedAt:rows[0]?.updated_at||null});
  }));
  app.put('/api/driver-documents/:driverId',authMiddleware(),wrap(async(req,res)=>{
    const data=await requireAdmin(req.principal);const id=String(req.params.driverId);
    if(!driverExists(data,id))fail('DRIVER_NOT_FOUND',404);
    const rec=normalizeRecord(req.body||{});
    await pool.query(`INSERT INTO driver_document_records(driver_id,personal,vehicle,documents) VALUES($1,$2,$3,$4)
      ON CONFLICT(driver_id) DO UPDATE SET personal=EXCLUDED.personal,vehicle=EXCLUDED.vehicle,documents=EXCLUDED.documents,updated_at=now()`,[id,rec.personal,rec.vehicle,rec.documents]);
    res.json({ok:true,...rec,summary:summary(rec)});
  }));
  app.post('/api/driver-documents/:driverId/files',authMiddleware(),wrap(async(req,res)=>{
    const data=await requireAdmin(req.principal);const driverId=String(req.params.driverId);
    if(!driverExists(data,driverId))fail('DRIVER_NOT_FOUND',404);
    const filename=cleanText(req.body?.filename,180)||'documento';const dataUrl=String(req.body?.dataUrl||'');
    const m=dataUrl.match(/^data:(application\/pdf|image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);if(!m)fail('INVALID_DOCUMENT_FILE');
    const raw=Buffer.from(m[2],'base64');if(!raw.length||raw.length>MAX_FILE)fail('DOCUMENT_FILE_TOO_LARGE',413);
    const id=crypto.randomUUID();await pool.query('INSERT INTO driver_document_files(id,driver_id,filename,mime_type,content,size_bytes) VALUES($1,$2,$3,$4,$5,$6)',[id,driverId,filename,m[1].toLowerCase(),raw,raw.length]);
    res.status(201).json({id,filename,mimeType:m[1].toLowerCase(),size:raw.length});
  }));
  app.get('/api/driver-documents/:driverId/files/:fileId',authMiddleware(),wrap(async(req,res)=>{
    await requireAdmin(req.principal);const {rows}=await pool.query('SELECT filename,mime_type,content FROM driver_document_files WHERE id=$1 AND driver_id=$2',[String(req.params.fileId),String(req.params.driverId)]);
    if(!rows[0])fail('DOCUMENT_FILE_NOT_FOUND',404);res.set('Cache-Control','private, no-store');res.set('Content-Type',rows[0].mime_type);res.set('Content-Disposition',`inline; filename="${rows[0].filename.replace(/["\\]/g,'_')}"`);res.send(rows[0].content);
  }));
}
