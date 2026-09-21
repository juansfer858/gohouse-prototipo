# V44 · cancelar pedidos desde el panel

- Añade **Cancelar pedido** a todos los pedidos activos del panel.
- Pide confirmación antes de cancelar.
- Si el pedido tenía domiciliario asignado, lo libera cuando no tiene otro servicio activo.
- El pedido queda con `estado: cancelado`, `cancelledAt` y `cancelledBy: panel`.
- Los cancelados dejan de contarse y mostrarse como pedidos activos.
- El registro no se borra.
- El push existente puede informar al cliente del estado **Cancelado**.

No modifica pedidos entregados, tarifas, liquidaciones, usuarios, documentos, QR, correo, publicidad ni notificaciones.
