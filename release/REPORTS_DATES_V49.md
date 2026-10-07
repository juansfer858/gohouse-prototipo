# V49 · lectura de fechas históricas y rango de siete días

## Defecto reproducido
El panel y el cliente originales guardan `order.day` mediante `Date.toDateString()`, por ejemplo `Wed Sep 30 2026`. El informe V48 solo aceptaba `YYYY-MM-DD` en ese campo de respaldo. Si faltaban `deliveredAt`, `entregadoAt` y `createdAt`, un registro con día conservado quedaba sin fecha y se excluía al aplicar un rango.

Prueba aislada antes del cambio: siete servicios, uno por día del 30/09/2026 al 06/10/2026; seis únicamente conservaban `day` y el último tenía timestamps. La consulta devolvía solo el del último día y contaba los seis anteriores como sin fecha.

Esto demuestra un defecto de compatibilidad con el formato emitido por la aplicación, pero no certifica que esa sea la única causa de los registros concretos que el usuario echa de menos: no se ha accedido a su sesión privada ni a los totales reales de Nodier.

## Cambio acotado
- Reconoce el calendario explícito de `day` en formato ISO o `Date.toDateString()`, validando día, mes, año y día de semana.
- Evita desplazar al día anterior las fechas ISO sin hora.
- Usa la fecha de entrega/cancelación válida; si el primer campo está dañado, revisa el alternativo.
- Cuando no hay fecha del evento, mantiene el criterio existente de respaldo a solicitud: `createdAt` y finalmente `day`. Se identifica como fecha estimada; no se inventa una fecha de entrega.
- Nunca sustituye fechas faltantes por hoy.
- Conserva como sin fecha los valores inválidos; son visibles en Todo el historial.
- Añade en el informe las fechas disponibles del historial seleccionado para distinguir registros fuera del período de registros sin fecha.
- Mantiene ID de empleado, importes históricos, snapshots liquidados, confirmaciones y control de pagos duplicados.

Solo cambia `reports.js`, `llanos-reports.js` y la versión de carga de ese script en el panel V48 vigente. Sin migraciones ni cambios al servidor principal, pedidos almacenados, autenticación, flota, publicidad, correo, chat u otros proyectos.

## Validación
106 verificaciones pasadas con PostgreSQL y Chromium aislados, incluida la suite V48 completa. Se pulsaron realmente Hoy, Últimos 7 días y Consultar para un rango manual: devolvieron 1, 7 y 2 servicios respectivamente. El Excel descargado/reabierto mostró siete filas de servicios y siete días, con totales iguales al backend. Se confirmó estructuralmente que consultar/exportar no modificó los pedidos. Capturas de escritorio y móvil inspeccionadas.

Datos de QA ficticios, sin escrituras de datos de producción ni liquidaciones reales.

Base: 63877c78afd526ba9ed752f511205a42abd25632.
Respaldo: restore/20261006-before-reports-dates-v49.
