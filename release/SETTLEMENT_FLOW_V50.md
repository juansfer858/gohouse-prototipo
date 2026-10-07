# V50 · liquidación de servicios guiada por empleado

## Operación
1. Elegir un solo empleado y las fechas Desde / Hasta. Pulsar Revisar servicios. Todo el historial sigue disponible como consulta, sin habilitar una liquidación masiva sin fechas.
2. Revisar los servicios entregados y pendientes incluidos. El resumen principal muestra solamente el valor de esos domicilios, la parte de la empresa y la parte del empleado. Los ya liquidados, cancelados y en curso se muestran separados y no se agregan al valor de esta liquidación.
3. Pulsar Revisar y confirmar. El sistema vuelve a consultar el servidor y abre una revisión final con empleado, período, cantidad y valores. Hay que confirmar que se revisaron los servicios y que el pago o conciliación ya se hizo. Si hay fechas estimadas, se requiere revisarlas explícitamente. Solo Registrar como liquidado guarda el registro.

Después de registrar aparece la confirmación con número de liquidación, empleado, período, número de servicios, valor, método y referencia. Permite descargar el comprobante Excel y elegir otro empleado. Las liquidaciones anteriores quedan accesibles en su sección.

## Qué significa el valor del empleado
La parte del empleado no es necesariamente el dinero que la empresa debe transferirle. El domiciliario puede haber cobrado al cliente. Este cambio no calcula el efectivo que debe entregar o recibir cada parte ni descuenta automáticamente anticipos, compras o gastos. Eso se concilia antes de registrar. Se permite indicar Otro / conciliación y anotar una referencia. Guardar no mueve dinero.

## Protecciones
- No se puede liquidar a todos los empleados al mismo tiempo ni con fechas vacías.
- Editar las fechas bloquea el botón hasta recalcular. La revisión final comprueba además que la consulta siga correspondiendo a los controles actuales.
- Se vuelve a leer el servidor antes de confirmar; los cambios de servicios se muestran para revisión.
- Dos confirmaciones explícitas separan revisión de servicios y pago/conciliación.
- Fechas estimadas necesitan una confirmación adicional.
- Doble clic no genera dos solicitudes.
- Ante una respuesta de guardado sin confirmar, no se pide volver a pagar. El botón Comprobar el mismo registro reutiliza exactamente la solicitud y su clave; permite cerrar y retomar esa comprobación en la misma página.
- Se conservan los permisos, transacciones, snapshots históricos, hash de revisión y protecciones contra duplicados de la API V49.
- Informe general y consulta detallada siguen disponibles por separado. Consultar y exportar no registra pagos.

## Fechas y datos
Se conserva la lectura de fechas V49. El intervalo solicitado y las fechas disponibles siguen visibles. Si en un rango amplio solo se encuentran pendientes de un día, se advierte antes de confirmar. Reorganizar la pantalla no recupera registros históricos ausentes ni cambia sus fechas.

## Alcance
Solo se publican web/llanos-reports.js y el cambio de versión del script en el panel VPS V49 verificado. No cambia código de servidor, migraciones, importes, pedidos reales, autenticación, flota, publicidad, correo, chat ni otros proyectos. El backend continúa identificado como llanos-reports-v49; la interfaz usa llanos-settlement-flow-v50.

## Validación
46 comprobaciones específicas del nuevo flujo con PostgreSQL y Chromium aislados, más las 76 comprobaciones existentes de API, historial, transacciones, concurrencia y Excel. Incluyen revisión, cancelación sin escritura, cambios de filtros, relectura, fechas estimadas, doble clic, comprobante descargado y respuesta perdida simulada después del commit con reintento de la misma clave. Capturas escritorio/móvil inspeccionadas y comprobante XLSX verificado. Datos ficticios: no se liquidaron servicios reales.

Base: 0a9db2e4aee39f7e38d1e27716ff1ba796445f65.
Respaldo: restore/20261006-before-settlement-flow-v50.
