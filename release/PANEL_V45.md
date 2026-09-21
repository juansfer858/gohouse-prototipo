# V45 · restauración del panel VPS + cancelar pedido

Corrige la regresión introducida por V44.

- Restaura como base `release/payload/tarifas-2/web/gohouse-panel.html`, que usa:
  - `gohouse-vps-adapter.js`
  - `gohouse-branding.js`
  - autenticación del VPS
- Elimina la copia antigua que cargaba Firebase y mostraba GO! HOUSE / Food House.
- Conserva el flujo actual de pedidos, usuarios, mensajes, configuración y extensiones.
- Añade **Cancelar pedido** sobre la base correcta.
- La cancelación usa el formato ya existente:
  - `estado: cancelado`
  - `canceladoAt`
  - `canceladoEnEstado`
  - `canceladoPor: panel`
  - `canceladoRepartidorId`
- Libera al domiciliario cuando corresponde.
- El pedido cancelado queda en historial y no se borra.
