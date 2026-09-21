# V43 · Flota en vivo, pagos configurados y referencias

## Flota en vivo
- El panel vuelve a cargar `gohouse-fleet-panel.js`.
- La app del domiciliario carga explícitamente `gohouse-fleet-driver.js` para reportar GPS según las reglas existentes.
- El tab **🗺️ Flota en vivo** vuelve a aparecer en el panel.

## Pago dinámico
El selector **Pago** se construye desde la configuración pública:
- Efectivo: siempre.
- Nequi: solo si hay número configurado.
- Daviplata: solo si hay número configurado.
- Banco: muestra el nombre configurado, por ejemplo **Bancolombia**, si existe banco o cuenta.
- Ya pagó: se conserva para compatibilidad con pedidos prepagados.

No se cambia la lógica de `crearPedido()`; solo se corrigen las opciones visibles.

## Referencias
- Nuevo botón **📍 Ver referencias** al lado de Pago.
- Lee `/api/public/tarifas`.
- Muestra únicamente referencias activas y su valor.
- Es una ayuda operativa de consulta; no altera automáticamente el pedido ni cambia tarifas ya fijadas.

No modifica pedidos existentes, tarifas almacenadas, liquidaciones, usuarios, documentos, QR, correo, publicidad ni notificaciones.
