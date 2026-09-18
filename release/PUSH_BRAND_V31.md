# V31 · marca del operador en notificaciones al cliente

Corrige la notificación de seguimiento del domicilio para que use siempre la empresa configurada en el panel.

Ejemplo con la configuración actual:
`Mi domicilio de AGUILAS EXPRES #14 va: Domiciliario asignado`

Reglas:
- La empresa sale de `config.brandName`.
- Nunca se usa "Go House" como nombre de respaldo.
- Si una configuración antigua todavía contuviera esa marca heredada, la notificación usa "Domicilios" en vez de mostrarla.
- Aplica a todos los cambios de estado enviados al cliente.
- No modifica pedidos, tarifas, códigos de domiciliarios, documentos, QR ni chat.
