# V40 · imágenes de publicidad almacenadas en PostgreSQL

La subida de imágenes de Publicidad deja de depender del sistema de archivos del VPS.

Flujo nuevo:
- el navegador comprime la imagen como antes;
- /api/upload-data-url valida tamaño y tipo;
- el binario se guarda en la tabla privada media_assets;
- el servidor devuelve /api/public/uploads/<id>;
- esa URL pública sirve la imagen con cache immutable.

Ventajas:
- no depende de /opt/... ni permisos de carpetas;
- no depende del nombre comercial;
- los logos/archivos antiguos bajo /uploads/ siguen funcionando;
- el endpoint de subida sigue protegido por autenticación.

Health:
- uploadMode: postgres-media-v40
- uploadStorageReady: true

No modifica pedidos, tarifas, clientes, correo, códigos, documentos, QR, chat ni notificaciones.
