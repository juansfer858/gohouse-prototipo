# V35 · recuperación de contraseña con Gmail

## Configuración del dueño
El panel muestra únicamente:
- Nombre del remitente
- Cuenta Gmail / Google Workspace
- Contraseña de aplicación de Google (16 caracteres)
- Correo para responder (opcional)
- Activar/desactivar
- Guardar configuración
- Enviar correo de prueba

SMTP queda fijo en el servidor:
- Host: smtp.gmail.com
- Puerto: 587
- Seguridad: STARTTLS
- Autenticación: AUTH LOGIN

## Seguridad
- No se usa la contraseña normal de Gmail.
- La contraseña de aplicación no se guarda en app_state.
- Se guarda cifrada con AES-256-GCM en una tabla privada.
- La clave de cifrado se deriva de config.jwtSecret del VPS.
- La API nunca devuelve la contraseña; solo informa si ya existe.
- Solo administradores del panel pueden leer/guardar/probar la configuración.

## Cliente
El flujo existente no cambia:
Olvidé mi contraseña → correo → código de 6 dígitos → contraseña nueva.
