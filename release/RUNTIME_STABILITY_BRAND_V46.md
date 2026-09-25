# V46 · estabilidad del panel y marca dinámica del cliente

## Panel
- El cargador de `/panel/` ya no falla al primer error de red.
- Reintenta hasta 4 veces la descarga de `gohouse-panel.html`.
- Cada intento tiene timeout de 12 segundos.
- Si todos fallan, muestra un botón **Reintentar** en lugar de dejar una pantalla muerta.

## Cliente
Se eliminan cadenas operativas hardcodeadas con "GoHouse" y se usa siempre la marca configurada:
- Seguimiento: "AGUILAS EXPRES lo tiene registrado".
- Compartir por WhatsApp: "Mi domicilio de AGUILAS EXPRES #...".
- Mensaje tras cancelación.
- Avisos locales de chat.

## Diagnóstico que motivó el cambio
- `gohouse.service` llevaba 4 días activo con `NRestarts=0`.
- `/`, `/panel/`, `/gohouse-panel.html`, `/gohouse-cliente.html`, `/api/health` y `/api/public/config` respondían HTTP 200.
- La configuración pública reportaba `brandName: AGUILAS EXPRES`.
- El fallo visual del panel provino del cargador de una sola petición, no de una caída del servicio.
- La frase "Mi domicilio de GoHouse..." seguía hardcodeada en el cliente web.
