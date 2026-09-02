# GoHouse VPS recovery release

Release inicial para activar marca blanca y autodespliegue en `vantix-saas-01`.

- Version: `2026.09.02-white-label.2`
- Archive: `gohouse-vps-ready.tar.xz`
- SHA-256: `77ef0639b9571f2fb6eea03f7a084c780678e868c0f0ce69ac43f1cccccf6555`

El VPS debe instalar esta version una sola vez. A partir de ahi `gohouse-autodeploy.timer` consulta `release/version.json` y aplica versiones nuevas con health-check y rollback.
