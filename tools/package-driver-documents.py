from pathlib import Path
import json,hashlib,subprocess,datetime
root=Path(__file__).resolve().parents[1]
source='63a1b54cd9bece441a04e3132447822ea3c1c22a'
prefix='release/payload/driver-documents-1/'
paths=['server/src/server.js','server/src/driver-documents.js','web/gohouse-branding.js','web/gohouse-driver-documents.js']
def entry(p):
    b=subprocess.check_output(['git','show',source+':'+prefix+p],cwd=root)
    current=(root/(prefix+p)).read_bytes()
    if current!=b: raise SystemExit('Payload drift: '+p)
    return {'path':p,'url':'https://raw.githubusercontent.com/juansfer858/gohouse-prototipo/'+source+'/'+prefix+p,'sha256':hashlib.sha256(b).hexdigest()}
mig=entry('migrations/006_driver_documents.sql')
m={'version':'2026.09.17-white-label.28','published_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'release','files':[entry(p) for p in paths],'delete':[],'migrations':[mig]}
(root/'release/version.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
(root/'release/DRIVER_DOCUMENTS_V28.md').write_text('''# Domiciliarios · Documentos privados v28

Panel: https://domicilios-llanos.vantixgc.com/panel/

Botón 📁 junto al chat de cada domiciliario. Expediente privado por renglones: datos personales, vehículo y documentos. Incluye Cédula, Licencia de conducción, Tarjeta de propiedad, SOAT y RTM/Tecnomecánica, además de documentos personalizados.

Vencimientos: rojo vencido, amarillo hasta 30 días, verde vigente. Adjuntos PDF/JPG/PNG/WEBP hasta 8 MB.

Los expedientes no forman parte de gohouse-data ni del objeto repartidores. Las rutas y los adjuntos requieren una sesión de administrador. No modifica pedidos, tarifas, caja, chat, PIN, QR ni el flujo del domiciliario.
''')
print(json.dumps(m,ensure_ascii=False,indent=2))
