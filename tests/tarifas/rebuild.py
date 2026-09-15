"""Test retained production store and new routes with disposable infrastructure.
The historical ZIP is truncated. db/util below are TEST ADAPTERS, never deployable
payloads, not a claim to reconstruct missing production dependencies.
"""
import pathlib, shutil, json
root=pathlib.Path(__file__).resolve().parents[2]
target=pathlib.Path('/tmp/gohouse-tarifas-test/server')
(target/'src').mkdir(parents=True,exist_ok=True)
(target/'package.json').write_text(json.dumps({'private':True,'type':'module','dependencies':{'express':'4.21.2','pg':'8.16.3'}}))
(target/'src/db.js').write_text("""// TEST ONLY: real PostgreSQL, isolated database, serialized application writes.
import pg from 'pg';
if(process.env.GOHOUSE_TEST_ONLY!=='1'||!/^postgresql:\\/\\/[^@]+@127\\.0\\.0\\.1:5432\\/gohouse_tarifas_test$/.test(process.env.DATABASE_URL||''))throw new Error('TEST_DATABASE_REQUIRED');
export const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
export async function withTx(fn){const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM app_state WHERE id=1 FOR UPDATE');const out=await fn(c);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
""")
(target/'src/util.js').write_text("""// TEST ONLY: dependency adapters for the retained production store.
import crypto from 'node:crypto';
export const splitPath=p=>Array.isArray(p)?p:String(p||'').split('/').filter(Boolean);
// Match emailAKey in the actual published panel HTML.
export const safeEmailKey=e=>String(e||'').toLowerCase().replace(/\\./g,',');
export const pushKey=()=>crypto.randomUUID();
export function getAtPath(root,p){return splitPath(p).reduce((x,k)=>x?.[k],root)??null;}
export function setAtPath(root,p,v){const keys=splitPath(p);if(!keys.length)return structuredClone(v);const out=structuredClone(root);let n=out;for(const k of keys.slice(0,-1))n=n[k]??=( {} );n[keys.at(-1)]=structuredClone(v);return out;}
export function removeAtPath(root,p){const keys=splitPath(p),out=structuredClone(root);let n=out;for(const k of keys.slice(0,-1)){n=n?.[k];if(!n)return out;}delete n[keys.at(-1)];return out;}
export function stripPins(v){if(Array.isArray(v))return v.map(stripPins);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>!['pin','pinHash','passwordHash'].includes(k)).map(([k,x])=>[k,stripPins(x)]));return v;}
export function mergeObject(base,next,current){if(JSON.stringify(base)===JSON.stringify(next))return structuredClone(current);if(Array.isArray(next))return structuredClone(next);if(next&&typeof next==='object'){const out=structuredClone(current||{});for(const k of Object.keys(next))out[k]=mergeObject(base?.[k],next[k],current?.[k]);for(const k of Object.keys(base||{}))if(!(k in next))delete out[k];return out;}return structuredClone(next);}
""")
shutil.copyfile(root/'release/payload/publicidad-4/server/src/store.js',target/'src/store.js')
shutil.copyfile(root/'release/payload/tarifas-2/server/src/tarifas.js',target/'src/tarifas.js')
shutil.copyfile(root/'tests/tarifas/run.mjs',target/'tariff-tests.mjs')
print('Production store source: publicidad-4/server/src/store.js (unchanged).')
print('New tariff module + SQL: real PostgreSQL tests.')
print('db.js/util.js: explicit isolated test adapters; production auth and missing utility implementations NOT covered.')
print('No production connection or writes.')
