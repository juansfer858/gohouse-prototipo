import assert from 'node:assert/strict';
import path from 'node:path';
const DAYS=['2026-09-30','2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05','2026-10-06'];
const EMPLOYEE='seven-days-qa-only';
function weekOrders(){
  return DAYS.map((day,i)=>({id:'date-compat-'+i,numero:i+1,repartidorId:EMPLOYEE,estado:'entregado',cliente:'Cliente QA',direccion:'Dirección de prueba',pago:'Efectivo',tarifa:4000,comisionCasa:1200,valorCompra:0,
    day:new Date(day+'T15:00:00Z').toDateString(),
    ...(i===6?{createdAt:Date.parse(day+'T15:00:00Z'),deliveredAt:Date.parse(day+'T16:00:00Z')}:{})}));
}
export function dateChecks({buildReport,filters,localDay,check}){
  const root={'gohouse-data':{repartidores:[{id:EMPLOYEE,nombre:'Empleado fechas QA'}],orders:weekOrders()}};
  const before=JSON.stringify(root);
  const f=filters({from:DAYS[0],to:DAYS.at(-1),employeeId:EMPLOYEE});
  let r=buildReport(root,f);
  check(r.rows.length===7&&r.summary.services===7,'Seven-day query retains six toDateString days plus today');
  check(new Set(r.byDay.map(x=>x.date)).size===7,'One service on each of seven distinct calendar days');
  check(r.summary.fare===28000&&r.summary.company===8400&&r.summary.earnings===19600,'Recovered date reads keep historical amounts exactly');
  check(r.estimatedDates===6&&r.undatedOrders===0,'Retained request-day fallback explicitly marked estimated, not undated');
  check(r.rows.filter(x=>x.dateSource==='day').length===6,'Retained-day date source is explicit');
  check(r.history.firstDate===DAYS[0]&&r.history.lastDate===DAYS.at(-1),'Available-history bounds match actual stored dates');
  check(JSON.stringify(root)===before,'Date normalization never writes or mutates stored orders');
  check(buildReport(root,{...f,from:DAYS.at(-1)}).rows.length===1,'Today excludes six older days');
  check(buildReport(root,{...f,from:'2026-10-02',to:'2026-10-03'}).rows.length===2,'Custom inclusive date window');
  check(localDay('2026-10-01')==='2026-10-01','Date-only ISO must not shift backward in Colombia');
  check(localDay('2026-10-01T04:59:59Z')==='2026-09-30','Timestamp keeps Colombia midnight boundary');
  check(localDay('2026-10-01T05:00:00Z')==='2026-10-01','Timestamp at Colombia midnight starts next day');
  check(localDay('2026-02-31')===''&&localDay(false)===''&&localDay({})==='','Invalid date/boolean/object never fabricated');
  const order=root['gohouse-data'].orders[0];
  order.deliveredAt='corrupt';order.entregadoAt='2026-10-02T18:00:00Z';
  r=buildReport(root,f);check(r.rows.find(x=>x.id===order.id).date==='2026-10-02','Valid alternate delivery timestamp used when first field is invalid');
  order.deliveredAt='2026-10-03T18:00:00Z';
  r=buildReport(root,f);check(r.rows.find(x=>x.id===order.id).date==='2026-10-03','Actual delivery date takes precedence over retained request day');
  delete order.deliveredAt;delete order.entregadoAt;order.day='Wed Sep 31 2026';
  r=buildReport(root,f);check(r.rows.length===6&&r.undatedOrders===1,'Invalid retained day excluded from dated queries with visible warning');
  check(buildReport(root,{employeeId:EMPLOYEE}).rows.length===7,'Unparseable date remains visible in full history');
  order.day='Wed Sep 30 2026';order.createdAt='2026-10-02';
  r=buildReport(root,f);check(r.rows.find(x=>x.id===order.id).date==='2026-10-02','Valid creation date is preferred to older retained day');
  const snap={...r.rows.find(x=>x.id===order.id),date:'2026-09-30',settled:true};
  const sealed=buildReport(root,f,[{order_id:order.id,settlement_id:'qa-existing-settlement',snapshot:snap,created_at:'2026-10-01T00:00:00Z'}]);
  check(sealed.rows.find(x=>x.id===order.id).date==='2026-09-30','Existing settled snapshot date remains immutable');
  const other={...order,id:'other-person',repartidorId:'other-id'};root['gohouse-data'].orders.push(other);
  check(buildReport(root,{employeeId:EMPLOYEE}).rows.every(x=>x.employeeId===EMPLOYEE),'Date compatibility never joins employees by name');
  console.log('DATE_COMPATIBILITY_UNIT_PASS');
}
export async function weekBrowserChecks({page,pool,base,fixture,check,outDir,ExcelJS}){
  const weekly=structuredClone(fixture);
  weekly['gohouse-data'].orders=weekOrders();
  weekly['gohouse-data'].repartidores.push({id:EMPLOYEE,nombre:'Empleado fechas QA'});
  await pool.query('UPDATE app_state SET data=$1 WHERE id=1',[JSON.stringify(weekly)]);
  await page.addInitScript(()=>{
    const OriginalDate=Date;
    class FixedDate extends OriginalDate{
      constructor(...args){super(...(args.length?args:['2026-10-06T15:00:00Z']));}
      static now(){return new OriginalDate('2026-10-06T15:00:00Z').getTime();}
    }
    window.Date=FixedDate;
  });
  await page.setViewportSize({width:1365,height:1000});
  await page.goto(base+'/test-harness');await page.waitForSelector('#lr-export');
  await page.selectOption('#lr-employee',EMPLOYEE);
  await page.waitForFunction(()=>document.querySelector('#lr-history-count')?.textContent.includes('7 de 7'));
  await page.click('#lr-today');
  await page.waitForFunction(()=>document.querySelector('#lr-history-count')?.textContent.includes('1 de 7'));
  const response=page.waitForResponse(r=>r.url().includes('/api/reports/summary?')&&r.url().includes('from=2026-09-30')&&r.url().includes('to=2026-10-06'));
  await page.click('#lr-week');
  const report=await (await response).json();
  check(report.rows.length===7&&report.byDay.length===7,'Real seven-day button response contains seven days, not only title change');
  await page.waitForFunction(()=>document.querySelector('#lr-history-count')?.textContent.includes('7 de 7'));
  check(await page.inputValue('#lr-from')==='2026-09-30'&&await page.inputValue('#lr-to')==='2026-10-06','Seven-day preset submits inclusive actual bounds');
  check((await page.locator('#lr-history-range').textContent()).includes('2026-09-30 a 2026-10-06'),'Available source date range visible');
  check((await page.locator('#lr-body').textContent()).includes('19.600'),'UI earnings include all seven unchanged fares');
  const downloading=page.waitForEvent('download');await page.click('#lr-export');const download=await downloading;
  await download.saveAs(path.join(outDir,'qa-siete-dias.xlsx'));
  const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(path.join(outDir,'qa-siete-dias.xlsx'));
  check(wb.getWorksheet('Servicios').rowCount===12,'Seven filtered service rows exported to Excel');
  check(wb.getWorksheet('Resumen').getCell('B7').result===7,'Excel delivered count equals backend and UI');
  check(wb.getWorksheet('Por día').rowCount===12,'Excel daily sheet includes all seven dates');
  const stored=(await pool.query('SELECT data FROM app_state WHERE id=1')).rows[0].data;
  assert.deepEqual(stored['gohouse-data'].orders,weekly['gohouse-data'].orders);
  check(true,'Consulting and exporting make no writes to order data');
  await page.screenshot({path:path.join(outDir,'week-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Date range hint does not overflow on mobile');
  await page.screenshot({path:path.join(outDir,'week-mobile.png'),fullPage:true});
  await page.fill('#lr-from','2026-10-02');await page.fill('#lr-to','2026-10-03');await page.click('#lr-query');
  await page.waitForFunction(()=>document.querySelector('#lr-history-count')?.textContent.includes('2 de 7'));
  check((await page.locator('#lr-body').textContent()).includes('5.600'),'Manual two-day filter uses matching records only');
  console.log('SEVEN_DAY_BROWSER_AND_XLSX_PASS');
}
