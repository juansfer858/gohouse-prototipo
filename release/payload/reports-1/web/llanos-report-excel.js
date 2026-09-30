/* Local-only XLSX writer. No report data is sent to any third-party service. */
(() => {
  'use strict';
  const numFormat = '"$"#,##0.00;[Red]-"$"#,##0.00';
  const state = s => ({ entregado: 'Entregado', cancelado: 'Cancelado', nuevo: 'Buscando domiciliario', aceptado: 'Aceptado', en_destino: 'En el lugar', camino: 'En camino' })[s] || s;
  const date = v => v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? new Date(String(v).slice(0, 10) + 'T00:00:00Z') : null;
  function formula(f, result) { return { formula: f, result: result ?? 0 }; }
  function build(ExcelJS, report, title = 'Informe general') {
    const wb = new ExcelJS.Workbook(); wb.addWorksheet('Resumen');
    wb.creator = report.brand; wb.created = new Date(); wb.calcProperties.fullCalcOnLoad = true;
    const period = report.filter.from + ' a ' + report.filter.to + ' · America/Bogota · COP';
    function sheet(name, headers, widths, rows, moneyCols = []) {
      const ws = wb.getWorksheet(name) || wb.addWorksheet(name); ws.views = [{ state: 'frozen', ySplit: 5 }]; ws.properties.defaultRowHeight = 21;
      ws.columns = widths.map(width => ({ width }));
      ws.mergeCells(1, 1, 1, headers.length); ws.getCell('A1').value = report.brand + ' — ' + title;
      ws.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FF1E312B' } }; ws.getRow(1).height = 30;
      ws.mergeCells(2, 1, 2, headers.length); ws.getCell('A2').value = period;
      ws.mergeCells(3, 1, 3, headers.length); ws.getCell('A3').value = 'Fecha de entrega para servicios completados; cancelación para cancelados; solicitud para abiertos.';
      ws.getRow(3).font = { size: 10, color: { argb: 'FF606B68' } };
      ws.getRow(5).values = headers; ws.getRow(5).height = 32;
      ws.getRow(5).eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E312B' } }; c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }; c.alignment = { vertical: 'middle', wrapText: true }; });
      rows.forEach((values, i) => {
        const row = ws.addRow(values); row.font = { name: 'Calibri', size: 11 };
        row.alignment = { vertical: 'top', wrapText: true }; row.height = 30;
        if (i % 2 === 1) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F6F4' } }; });
        moneyCols.forEach(col => { row.getCell(col).numFmt = numFormat; });
        row.eachCell(c => { if (c.value instanceof Date) c.numFmt = 'yyyy-mm-dd'; });
      });
      if (rows.length) ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + rows.length, column: headers.length } };
      ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:5' };
      return ws;
    }
    const data = report.rows || [], last = Math.max(6, data.length + 5);
    const rng = col => `Servicios!$${col}$6:$${col}$${last}`;
    const cond = (col, criterion) => `${rng(col)},${criterion}`;
    const count = (...conditions) => `COUNTIFS(${conditions.join(',')})`;
    const total = (col, ...conditions) => `SUMIFS(${rng(col)},${conditions.join(',')})`;
    const completed = cond('D', '"Entregado"');
    const serviceRows = data.map((r, i) => {
      const n = i + 6, delivered = r.status === 'entregado';
      return [String(r.number), date(r.date), r.employee, state(r.status), r.client, r.address, r.payment, r.zone,
        r.purchase, r.fare, delivered ? r.company : null,
        delivered && r.valid ? formula(`J${n}-K${n}`, r.earnings) : null,
        !delivered ? 'No aplica' : !r.valid ? 'Revisar valores' : r.settled ? 'Liquidado' : 'Pendiente',
        r.settlementId || (r.settled ? 'Registro anterior' : ''), r.settledAt ? date(new Date(r.settledAt).toISOString()) : null,
        r.dateEstimated ? 'Sí' : 'No', delivered && !r.valid ? 'Falta tarifa o comisión histórica válida; no se calcula con el porcentaje actual.' : '', r.employeeId];
    });
    const detail = sheet('Servicios', ['Pedido', 'Fecha del servicio', 'Empleado', 'Estado', 'Cliente', 'Dirección', 'Método de pago', 'Referencia / zona', 'Valor compra', 'Valor domicilio', 'Comisión empresa', 'Ganancia empleado', 'Liquidación', 'Número liquidación', 'Fecha liquidación (UTC)', 'Fecha estimada', 'Observaciones', 'ID empleado'], [12, 18, 27, 23, 26, 40, 22, 25, 19, 19, 20, 20, 18, 38, 20, 16, 40, 28], serviceRows, [9, 10, 11, 12]);
    detail.getColumn(18).hidden = true;
    const s = report.summary || {};
    const summaryRows = [
      ['Pedidos del período', data.length],
      ['Servicios entregados', formula(count(completed), s.services)],
      ['Pedidos cancelados', formula(count(cond('D', '"Cancelado"')), s.cancelled)],
      ['Pedidos activos', s.active],
      ['Valor de domicilios entregados', formula(total('J', completed), s.fare)],
      ['Compras (separadas del domicilio)', formula(total('I', completed), s.purchases)],
      ['Comisión empresa (valores válidos)', formula(total('K', completed), s.company)],
      ['Ganancia empleados (valores válidos)', formula(total('L', completed), s.earnings)],
      ['Servicios pendientes de liquidación', formula(count(completed, cond('M', '"Pendiente"')), s.pendingCount)],
      ['Valor pendiente de liquidación', formula(total('L', completed, cond('M', '"Pendiente"')), s.pendingAmount)],
      ['Servicios ya liquidados', formula(count(completed, cond('M', '"Liquidado"')), s.settledCount)],
      ['Valor ya liquidado', formula(total('L', completed, cond('M', '"Liquidado"')), s.settledAmount)],
      ['Servicios con valores por revisar', s.missingAmounts || 0],
      ['Servicios con fecha estimada', report.estimatedDates || 0],
      ['Pedidos sin fecha (fuera del filtro)', report.undatedOrders || 0],
      ['Empleado seleccionado', report.filter.employeeId ? report.employees?.find(e => e.id === report.filter.employeeId)?.name || report.filter.employeeId : 'Todos'],
      ['Criterio', 'Los cancelados y activos no generan ganancia en este informe. No se aplica la comisión actual a registros anteriores.'],
      ['Alcance', 'Liquidación de servicios, no liquidación laboral. No incluye anticipos, gastos ni conciliación de dinero recibido por el empleado.'],
      ['Pagos', 'El método de pago corresponde al registrado en el pedido; no acredita un abono bancario.'],
      ['Exportado', new Date().toISOString()]
    ];
    const overview = sheet('Resumen', ['Indicador', 'Valor / explicación'], [52, 72], summaryRows);
    [10, 11, 12, 13, 15, 17].forEach(r => { overview.getCell('B' + r).numFmt = numFormat; });
    [22, 23, 24].forEach(r => { overview.getRow(r).height = 44; });
    function groupRows(groups, kind) {
      return groups.map((g, i) => {
        const row = i + 6, key = kind === 'day' ? cond('B', `A${row}`) : kind === 'employee' ? cond('R', `J${row}`) : cond('G', `A${row}`);
        return [kind === 'day' ? date(g.date) : kind === 'employee' ? g.name : g.method,
          formula(count(completed, key), g.services), formula(count(cond('D', '"Cancelado"'), key), g.cancelled), g.active,
          formula(total('J', completed, key), g.fare), formula(total('K', completed, key), g.company), formula(total('L', completed, key), g.earnings),
          formula(total('L', completed, key, cond('M', '"Pendiente"')), g.pendingAmount), formula(total('L', completed, key, cond('M', '"Liquidado"')), g.settledAmount),
          kind === 'employee' ? g.id : ''];
      });
    }
    const h = ['Grupo', 'Entregados', 'Cancelados', 'Activos', 'Domicilios', 'Empresa', 'Empleado', 'Pendiente', 'Liquidado', 'ID empleado'];
    for (const [name, groups, kind] of [['Por día', report.byDay || [], 'day'], ['Por empleado', report.byEmployee || [], 'employee'], ['Por método de pago', report.byPayment || [], 'payment']]) {
      const ws = sheet(name, h, [30, 14, 14, 14, 21, 21, 21, 21, 21, 28], groupRows(groups, kind), [5, 6, 7, 8, 9]); ws.getColumn(10).hidden = true;
    }
    sheet('Liquidaciones', ['Número', 'Empleado', 'Desde', 'Hasta', 'Servicios', 'Domicilios', 'Empresa', 'Empleado pagado', 'Forma de pago', 'Referencia', 'Registró', 'Fecha de registro (UTC)'], [38, 28, 16, 16, 12, 21, 21, 21, 20, 28, 32, 28],
      (report.settlements || []).map(x => [x.id, x.employee_name, date(x.date_from), date(x.date_to), Number(x.service_count), Number(x.total_fare), Number(x.company_amount), Number(x.employee_amount), x.payment_method, x.payment_reference, x.created_by, x.created_at ? new Date(x.created_at).toISOString() : '']), [6, 7, 8]);
    return wb;
  }
  globalThis.LlanosReportExcel = { build };
})();
