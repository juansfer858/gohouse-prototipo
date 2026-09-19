# V39 · ruta fija para imágenes de publicidad

La carpeta de subida queda fijada a:
`/opt/gohouse/web/uploads`

Se eliminan del flujo de publicidad:
- `config.uploadDir`
- `GOHOUSE_UPLOAD_DIR`

Esto evita que la marca comercial o variables heredadas formen rutas como:
`/opt/AGUILAS EXPRES/web/uploads`

Health expone:
- `uploadMode: fixed-opt-gohouse-v39`
- `uploadStorageReady`: confirma que `/opt/gohouse/web` es escribible por el servicio.

Sin cambios de datos, pedidos, tarifas, correo, códigos, documentos, QR, chat o notificaciones.
