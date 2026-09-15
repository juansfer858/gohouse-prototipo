# Zonas y tarifas · 2026.09.15-white-label.27

Panel destino: https://domicilios-llanos.vantixgc.com/panel/
Repositorio de entrega: rama gohouse-vps-recovery. No cambia main ni otros proyectos.
Payload probado y fijado: a8a284e50bbd794a7d415232204499fd6033b0ab.

27 comprobaciones pasaron en CI 35021531668: PostgreSQL real, módulo de tarifas,
store retenido sin modificaciones, HTML publicado y Chromium. La autenticación
del arnés y db/util son adaptadores aislados de prueba: no sustituyen una prueba
de autenticación real en producción ni certifican dependencias no recuperadas.

Configuración → Comisión del servicio → Zonas y tarifas. Botón permanente
+ Agregar referencia. CRUD de administrador con control de revisión y auditoría.
Servicio estándar conserva nombre, existencia y estado activo; precio editable.
Migración 005 solo precarga las 11 referencias si no existía un catálogo.
El Chaquiro se conserva en $1.000, según lo indicado.

Cliente: catálogo activo, valor visible antes de enviar y nueva confirmación
si cambia la referencia. Pedidos nuevos con referencia guardan precio y comisión
en el servidor. Domiciliario no modifica la tarifa. Pedidos anteriores y clientes
antiguos sin referencia conservan el flujo legado, sin recotización retroactiva.

Despliegue: manifiesto de 7 archivos y migración SQL; URLs inmutables + SHA256.
El autodeploy existente respalda web/server y PostgreSQL antes de aplicar.
No se crean pedidos ni usuarios de prueba en producción.

Rollback: restore/20260915-before-tariff-references apunta a
6a31877339738ca3029f4a6140de65c180f34f8e. Los respaldos locales existentes
están bajo /opt/gohouse/releases/rollback-*. NO restaurar automáticamente la
base completa después de que entren pedidos nuevos: perdería operaciones.
La restricción SQL de precio fijado debe conservarse mientras haya pedidos
tarifaFijada. Ante un fallo, preferir corrección hacia delante del módulo o
retirada de su entrada visual manteniendo tarifas.js y el guardado protegido.
El fallback anterior no entiende pedidos fijados y no es un rollback seguro
del flujo completo después de crear el primer pedido con referencia.
