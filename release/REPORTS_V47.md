# V47 · Informes y liquidación de servicios

Alcance: únicamente Domicilios Llanos / AGUILAS EXPRES (`gohouse-prototipo`).
Base verificada de producción: `9979e527402defedcb76654918062c62fa4fa087`.
Respaldo Git: `restore/20260930-before-reports-v47`.

## Panel
En Informes: Liquidación empleado e Informe general. Fechas Desde/Hasta inclusivas, empleado, Hoy, últimos 7 días y este mes. Tabla por día, empleado, método de pago y detalle paginado (50 registros). La exportación XLSX incluye todos los registros del filtro, no solo la página visible.

## Regla de fechas y valores
Hora America/Bogota. Entregados: fecha de entrega. Cancelados: fecha de cancelación. Abiertos: fecha de solicitud. Si falta la fecha del evento, se marca fecha estimada; si falta cualquier fecha válida, el registro se informa como excluido. No se aplica el porcentaje actual a comisiones históricas. Los servicios sin importes completos no se liquidan. Compras y tarifa de domicilio permanecen separadas. Los cancelados y activos no generan ganancias en el informe.

## Liquidar
Solo administradores; operador y lectura pueden consultar/exportar. Revisión explícita de empleado, fechas, servicios, monto y forma/referencia de pago. Confirmación de que el pago fue realizado o conciliado. No ejecuta transferencias bancarias. Es liquidación de servicios, no liquidación laboral ni conciliación de caja con anticipos/gastos.

Transacción PostgreSQL, bloqueo del estado, hash de la selección, clave de idempotencia y un índice único por pedido evitan dobles liquidaciones. Se respetan registros antiguos `liquidado=true`. Cada liquidación guarda partidas y nombre/importes históricos en tablas privadas separadas; se reflejan también las marcas de compatibilidad en los pedidos. No se crean pedidos ni se liquidan servicios reales como prueba.

## Excel
XLSX real: Resumen, Servicios, Por día, Por empleado, Por método de pago y Liquidaciones. Encabezados inmovilizados, filtros, fechas/moneda tipadas, fórmulas con resultados almacenados y textos externos tratados como texto. ExcelJS 4.4.0 y su licencia se incluyen localmente; no se envían datos del negocio a servicios de terceros. El libro conserva el filtro aplicado y la advertencia sobre datos incompletos.

## Integración
Se conserva el panel VPS V45, el cargador V46, cancelación, QR, publicidad PostgreSQL, GPS y branding V43. Se reemplaza solamente el cuerpo de informes y el acceso de liquidación anterior que ignoraba las fechas. No se publica la copia Firebase de la raíz del repositorio. El empaquetador comprueba hashes de la base real antes de modificarla.

## Verificación
`tests/reports-v47.mjs`: PostgreSQL y navegador Chromium aislados con datos ficticios; límites de fechas, comisiones históricas, cancelados, permisos, concurrencia, reintentos, datos obsoletos, Excel real, texto similar a fórmulas, confirmación, escritorio/móvil y persistencia al escribir. La prueba de producción posterior al despliegue es solo de lectura; no registra pagos.
