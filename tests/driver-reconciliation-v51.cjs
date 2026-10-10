const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

const rootDir=process.env.RECONCILIATION_PAYLOAD || '/home/vantix/llanos-reconciliation-v51';
const A='ana', B='luis';
const OLD1='15ef7df4-ecec-4dfe-9bf8-72e0f2526cb5';
const OLD2='19bea640-3f7b-4d26-bf18-e99a29fae9fc';
const day='2026-10-07T18:20:00-05:00';
const order=(id,number,driver,state,fare,company,extra={})=>({
  id,numero:number,repartidorId:driver,estado:state,deliveredAt:day,createdAt:day,
  tarifa:fare,comisionCasa:company,cliente:'Pedido '+number,direccion:'Calle '+number,...extra
});
const root={'gohouse-data':{
  usuariosPanel:{admin:{email:'admin@qa.local',rol:'administrador',activo:true}},
  repartidores:[{id:A,nombre:'Ana'},{id:B,nombre:'Luis'}],
  orders:[
    order('a1',41,A,'entregado',5000,1500),
    order('a2',42,A,'entregado',4000,1000,{liquidado:true}),
    order('o1',43,OLD1,'entregado',2800,0),
    order('o2',44,OLD1,'entregado',4400,500),
    order('o3',45,OLD2,'entregado',6000,1200,{liquidado:true}),
    order('n1',46,null,'entregado',2300,300),
    order('a3',47,A,'cancelado',0,0,{canceladoAt:day})
  ]
}};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn, label, max=2000) {
  for(let n=0;n<max/10;n++) {if(fn()) return; await pause(10);}
  throw Error('Timed out: '+label);
}
async function run() {
  const {buildReport,settleEmployee}=await import(path.join(rootDir,'server/src/reports.js'));
  const common={from:'',to:'',employeeId:'',status:''};
  const all=buildReport(root,common);
  assert.deepEqual(all.employees.filter(x=>!x.archived).map(x=>x.name).sort(),['Ana','Luis']);
  assert.equal(all.employees.filter(x=>x.archived).length,2);
  assert.equal(all.rows.length,7);
  assert.ok(all.employees.find(x=>x.id===OLD1).name.startsWith('Sin vínculo comprobado'));
  assert.equal(buildReport(root,{...common,employeeId:OLD1,from:'2026-10-07',to:'2026-10-07'}).canSettleSelection,false);
  const selected=buildReport(root,{...common,employeeId:A,from:'2026-10-07',to:'2026-10-07'});
  assert.equal(selected.canSettleSelection,true);
  assert.deepEqual(selected.pendingIds,['a1']);
  assert.equal(selected.summary.pendingAmount,3500);
  const calls=[];
  const db={
    async query(q){calls.push(q);
      if(q.startsWith('SELECT data FROM app_state')) return {rows:[{data:root}]};
      if(q.startsWith('SELECT * FROM llanos_employee_settlements WHERE request_key'))return {rows:[]};
      if(q==='ROLLBACK'||q==='BEGIN'||q.startsWith('SET LOCAL'))return {rows:[]};
      throw Error('Unexpected database query: '+q);
    },
    release(){}
  };
  await assert.rejects(settleEmployee({connect:async()=>db},{type:'panel',email:'admin@qa.local'},{
    ...common,employeeId:OLD1,from:'2026-10-07',to:'2026-10-07',
    previewHash:'a'.repeat(64),requestKey:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    confirmPaid:true,paymentMethod:'Efectivo'
  }),e=>e.message==='REPORT_EMPLOYEE_NOT_ACTIVE' && e.status===409);
  assert.equal(calls.filter(x=>/^(UPDATE|INSERT|DELETE)/.test(x)).length,0);
  assert.ok(calls.includes('ROLLBACK'));

  const dom=new JSDOM('<!doctype html><html><head></head><body><div id="vista-informes"></div></body></html>',{
    url:'https://gohouse.test/',runScripts:'dangerously',pretendToBeVisual:true
  });
  const w=dom.window, document=w.document, q=x=>document.querySelector(x);
  let readCalls=[], writeCalls=[];
  w.GoHouseVPS={
    api:async (url,opts={})=>{
      const method=opts.method||'GET';
      if(method!=='GET') {writeCalls.push({url,method});throw Error('TEST_REJECTED_WRITE');}
      readCalls.push(url);
      if(!url.startsWith('/reports/summary?'))throw Error('Unexpected read '+url);
      const filters=Object.fromEntries(new URLSearchParams(url.split('?')[1]));
      const report=buildReport(root,filters);
      report.canSettle=true;
      return report;
    }
  };
  const source=fs.readFileSync(path.join(rootDir,'web/llanos-reports.js'),'utf8');
  w.eval(source);
  assert.equal(w.LlanosReports.version,'llanos-reconciliation-v51');
  w.LlanosReports.mount();
  await until(()=>q('#lr-unmatched'),'main reconciliation section');
  const options=[...document.querySelectorAll('#lr-employee option')].map(x=>x.textContent);
  assert.equal(options.length,3);
  assert.ok(options.some(x=>x.includes('Ana')));
  assert.ok(options.some(x=>x.includes('Luis')));
  assert.ok(!options.join('|').includes('retirado'));
  assert.ok(!q('#lr-body').textContent.includes('Empleado retirado'));
  const buttons=[...document.querySelectorAll('#lr-body button[data-lr-employee]')].map(x=>x.dataset.lrEmployee);
  assert.deepEqual(buttons.sort(),[A,B].sort());
  assert.equal(q('#lr-settle'),null);
  assert.equal(document.querySelectorAll('#lr-unmatched button[data-lr-unmatched]').length,3);
  q('#lr-unmatched button[data-lr-unmatched="'+OLD1+'"]').click();
  assert.ok(q('#lr-unmatched-review').textContent.includes(OLD1));
  assert.ok(q('#lr-unmatched-review').textContent.includes('2 registros'));
  assert.equal(q('#lr-settle'),null);
  w.LlanosReports.openEmployee(OLD1);
  assert.equal(q('#lr-settle'),null);
  assert.ok(q('#lr-error').textContent.includes('no pertenece'));
  const employeeSelect=q('#lr-employee');
  employeeSelect.value=A;
  employeeSelect.dispatchEvent(new w.Event('change',{bubbles:true}));
  await until(()=>q('#lr-review-title') && q('#lr-review-title').textContent.includes('Ana'),'Ana details');
  assert.equal(q('#lr-settle').disabled,true);
  q('#lr-from').value='2026-10-07';q('#lr-from').dispatchEvent(new w.Event('input',{bubbles:true}));
  q('#lr-to').value='2026-10-07';q('#lr-to').dispatchEvent(new w.Event('input',{bubbles:true}));
  q('#lr-query').click();
  await until(()=>q('#lr-settle') && !q('#lr-settle').disabled,'valid active employee preview');
  assert.ok(q('#lr-included summary').textContent.includes('(1)'));
  employeeSelect.value='';
  employeeSelect.dispatchEvent(new w.Event('change',{bubbles:true}));
  await until(()=>q('#lr-unmatched'),'global section reloaded');
  q('#lr-tab-general').click();
  assert.ok(q('#lr-body').textContent.includes('Por domiciliario activo'));
  assert.ok(q('#lr-body').textContent.includes('Servicios por conciliar'));
  assert.ok(!q('#lr-body').textContent.includes('Empleado retirado'));
  assert.equal(writeCalls.length,0);
  assert.equal(readCalls.length>2,true);
  const qa={
    version:'v51',passed:true,syntheticFixture:true,realProductionDataInspected:false,
    active:2,orphanIds:2,unassignedGroups:1,orders:7,
    readQueries:readCalls.length,productionWrites:0,
    checks:['read model','backend rejected unlinked settlement','active-only selector','two main rows',
      'orphan detail in separate section','no archived payout','active payout preview',
      'general report preserves unlinked entries','historical data untouched']
  };
  fs.writeFileSync(path.join(rootDir,'tests/qa-v51.json'),JSON.stringify(qa,null,2)+'\n');
  console.log('PASS '+JSON.stringify(qa));
  w.close();
}
run().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
