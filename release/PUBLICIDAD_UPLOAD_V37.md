# V37 · corrección de subida de imágenes de Publicidad

Problema:
- Al guardar una publicidad con imagen, el adaptador convierte el data URL en una llamada a `/api/upload-data-url`.
- La ruta dependía directamente de `config.uploadDir`.
- En esta instalación esa propiedad no estaba definida, por lo que Node intentaba trabajar con una ruta `undefined` y respondía:
  `The "path" argument must be of type string or an instance of Buffer or URL. Received undefined`

Corrección:
- Usa `config.uploadDir` si existe.
- Si no existe, usa `GOHOUSE_UPLOAD_DIR`.
- Como respaldo final usa `/opt/gohouse/web/uploads`.
- El límite de imagen usa `config.maxUploadMb`, luego `GOHOUSE_MAX_UPLOAD_MB` y finalmente 8 MB.
- Se valida que la ruta no esté vacía antes de escribir.
- El endpoint sigue protegido por autenticación.

No modifica pedidos, tarifas, clientes, domicilios, correo, códigos, documentos, QR, chat ni notificaciones.
