# V38 · corrección de congelamiento del panel

Causa encontrada:
- La V36 añadió un MutationObserver al panel para mantener visible el botón de notificaciones.
- El observer llamaba siempre a ensurePanelButton().
- ensurePanelButton() llamaba a updatePanelButton().
- updatePanelButton() reescribía textContent aunque el texto no hubiera cambiado.
- Esa escritura genera otra mutación del DOM y podía alimentar el mismo observer de forma repetitiva, consumiendo CPU del navegador y congelando el panel aunque el VPS siguiera respondiendo.

Corrección:
- El observer solo actúa si el botón ya no existe.
- El texto, estado y title del botón solo se escriben si realmente cambiaron.
- Se fuerza carga del runtime corregido con v=20260919.38.

No modifica pedidos, datos, tarifas, correo, publicidad, documentos, QR, chat ni backend.
