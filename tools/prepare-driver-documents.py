from pathlib import Path
root=Path(__file__).resolve().parents[1]
out=root/'release/payload/driver-documents-1'
server=(root/'release/payload/tarifas-2/server/src/server.js').read_text()
branding=(root/'release/payload/tarifas-2/web/gohouse-branding.js').read_text()
old="import { registerTariffRoutes } from './tarifas.js';"
new=old+"\nimport { registerDriverDocumentRoutes } from './driver-documents.js';"
assert server.count(old)==1
server=server.replace(old,new,1)
old="registerTariffRoutes(app, { pool, authMiddleware, broadcast });"
new=old+"\nregisterDriverDocumentRoutes(app, { authMiddleware });"
assert server.count(old)==1
server=server.replace(old,new,1)
(out/'server/src').mkdir(parents=True,exist_ok=True)
(out/'server/src/server.js').write_text(server)
old="    if (kind === 'panel') loadExtension('white-label-qr-script', '/gohouse-qr.js');"
new="    if (kind === 'panel') {\n      loadExtension('white-label-qr-script', '/gohouse-qr.js');\n      loadExtension('white-label-driver-documents-script', '/gohouse-driver-documents.js?v=20260917.1');\n    }"
assert branding.count(old)==1
branding=branding.replace(old,new,1)
(out/'web').mkdir(parents=True,exist_ok=True)
(out/'web/gohouse-branding.js').write_text(branding)
print('Prepared driver document module over v27 baseline.')
