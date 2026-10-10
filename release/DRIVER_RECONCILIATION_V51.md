# GoHouse – V51: domiciliarios activos y servicios por conciliar

Preparado: 10 de octubre de 2026. Estado: candidato verificado con datos sintéticos; no desplegado automáticamente.

## Hallazgo
La API V49 crea entradas históricas para identificadores que aparecen en pedidos, pero ya no existen en el padrón de domiciliarios. Si tampoco existe nombre guardado en el pedido, les asigna incorrectamente la etiqueta «Empleado retirado (UUID)». Esto no prueba que el operador haya retirado a nadie.

## Cambios acotados
- Selector y tabla principal: únicamente fichas en gohouse-data.repartidores, incluso si aún no tienen servicios en el período.
- Servicio histórico con ID ausente de ese padrón, incluso ID vacío: bloque «Servicios por conciliar» en liquidación e informe general, con conteos, valores pendientes, ya liquidados y detalle de pedidos de solo lectura.
- Los valores pendientes de un ID sin vincular no se reasignan automáticamente a ninguna de las dos fichas actuales; no se eliminan ni se marcan pagados.
- La etiqueta «retirado» desaparece del reporte nuevo; se reemplaza por «Sin vínculo comprobado».
- API: bloquea liquidaciones nuevas para identificadores fuera del padrón, devolviendo HTTP 409 REPORT_EMPLOYEE_NOT_ACTIVE. Las solicitudes previas completadas y repetidas con el mismo idempotency key mantienen su comportamiento.
- Se preservan fechas históricas, importes de origen, confirmación de pagos, Excel y flujo V50.

## Evidencia
Prueba independiente de backend e interfaz (jsdom) sobre datos inventados con dos domiciliarios activos, dos UUID sin vínculo, un pedido sin ID, un pedido ya pagado y pedidos pendientes/cancelados. No se utiliza información ni credenciales reales de la empresa. No se ejecutaron escrituras en producción durante QA.

## Publicación controlada
En el VPS vantix-saas-01, los tres archivos están preparados en /home/vantix/llanos-reconciliation-v51. Existe un instalador con SHA256 de base y destino, backup de tres archivos, cambios atómicos, reinicio únicamente de gohouse.service, verificación de salud y restauración si falla una comprobación.

Comando que debe ejecutar un administrador autorizado del VPS:

    sudo bash /home/vantix/llanos-reconciliation-v51/deploy-v51.sh

No ejecutar si el script indica un SHA distinto: otro cambio fue aplicado en producción y se necesita revisar el diferencial. El instalador no modifica bases de datos y no toca My Plaza ni otros servicios.

## Conciliación de datos reales
Tras desplegar, abrir «Servicios por conciliar». Verificar por número de pedido, fecha y evidencia a quién pertenece cada ID. No asignar ningún servicio a un empleado actual únicamente por suposición ni liquidarlo a un ID desvinculado. Para recuperar esas asociaciones hará falta una operación posterior explícita, validada y auditada contra los datos originales.
