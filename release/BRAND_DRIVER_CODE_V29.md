# V29 · marca visible y código permanente de domiciliarios

- La marca comercial visible queda en **Domicilios Llanos**; el nombre anterior se elimina de la configuración persistida y se filtra en interfaz, títulos y manifiestos instalables.
- El código/PIN asignado al crear un domiciliario queda inmutable mientras el domiciliario exista.
- Se elimina del panel la acción de generar/cambiar PIN y la API de cambio responde `DRIVER_CODE_IMMUTABLE`.
- La app conserva las credenciales del domiciliario y, si expira la sesión técnica, vuelve a autenticarse automáticamente con el mismo código.
- Al eliminar al domiciliario, los nuevos accesos se rechazan y las sesiones API anteriores quedan revocadas con `DRIVER_REMOVED`.
- No cambia pedidos, tarifas, caja, documentos, QR ni chat.

Nota de arquitectura: permanecen identificadores técnicos internos históricos (por ejemplo nombres de archivos/keys) para no romper compatibilidad; no se muestran como marca al usuario.
