# V48 · historial completo por domiciliario

## Corrección de consulta
V47 exigía fechas y abría inicialmente con el día actual. Además, la vista Liquidación empleado limitaba el detalle a servicios entregados.

V48 abre sin fechas ni estado preseleccionados. Al seleccionar un domiciliario —por ejemplo, Nodier— carga automáticamente todo el historial asociado a su identificador, sin arrastrar filtros del empleado anterior. No mezcla colaboradores por coincidencia de nombre.

- Todo el historial elimina los filtros de fechas y estado.
- Desde y Hasta son opcionales para consultar, incluso como límites independientes.
- Estados: todos, entregados, pendientes/en curso o cancelados.
- El detalle incluye todos los estados, también registros sin fecha válida (se identifican como Sin fecha registrada).
- Se muestran total de servicios, pendientes/en curso, entregados, cancelados, montos, pendientes de liquidación y liquidados.
- Cada empleado muestra su cantidad de registros históricos; el informe indica cuántos registros coinciden con el filtro frente al total de su historial.
- Una consulta sin coincidencias no oculta que existe historial fuera del filtro.
- Excel exporta toda la consulta, no solo la página visible, con el mismo criterio de fechas/estados y seis hojas.

## Liquidaciones y datos
Las fechas siguen siendo obligatorias para registrar una liquidación. Consultar todo el historial nunca registra pagos. Solo servicios entregados, válidos y pendientes pueden liquidarse, con confirmación, control de duplicados y valores históricos. Los activos y cancelados no se convierten en ingresos. No se reasignan carreras ni se fusionan empleados por nombre.

## Alcance y validación
Cambios publicados: reports.js, llanos-reports.js, llanos-report-excel.js y una sola referencia de versión en el panel vigente V47. Sin migraciones. El panel original Firebase no se utiliza. El servidor principal, cargador, pedidos, flota, publicidad, correo, chat y otros proyectos no se modifican.

QA aislada con PostgreSQL, navegador escritorio/móvil y XLSX: 76 comprobaciones, incluyendo historial de varios años, registros sin fecha, estados, empleado, filtros opcionales, reinicio de filtros al cambiar de empleado, permisos, transacciones, duplicados, concurrencia, valores históricos y exportación completa con más de 50 registros. No se liquidaron servicios de producción. Las pruebas usan datos de demostración; no certifican un total real de Nodier sin consultar su sesión autorizada.

Base: d4466934121c65620bfe44267ec1b5936b62cd86.
Respaldo: restore/20261006-before-reports-history-v48.
