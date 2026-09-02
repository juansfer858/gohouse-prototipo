# GoHouse VPS recovery / white-label

Baseline oficial: `2026.09.02-white-label.3`.

Esta versión convierte Go House en una plataforma de domicilios marca blanca y activa el autodespliegue controlado en `vantix-saas-01`.

El VPS consulta `release/version.json` aproximadamente cada minuto. Las versiones nuevas pueden publicarse como archivo binario o como Base64 (`base64_url`); el servidor valida SHA-256, hace backup de PostgreSQL y de la aplicación, ejecuta migraciones, cambia la versión, hace health-check y revierte automáticamente la aplicación si falla.

Los secretos de `/etc/gohouse/gohouse.env`, PostgreSQL, uploads y backups nunca forman parte del release.
