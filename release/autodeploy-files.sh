#!/usr/bin/env bash
set -euo pipefail

VERSION_URL="${GOHOUSE_VERSION_URL:-https://raw.githubusercontent.com/juansfer858/gohouse-prototipo/gohouse-vps-recovery/release/version.json}"
ROOT=/opt/gohouse
ENV_FILE=/etc/gohouse/gohouse.env
CURRENT_FILE="$ROOT/.deployed-version"
LOCK=/run/gohouse-autodeploy.lock

exec 9>"$LOCK"
flock -n 9 || exit 0

TMP=$(mktemp -d /tmp/gohouse-files-deploy.XXXXXX)
cleanup(){ rm -rf "$TMP"; }
trap cleanup EXIT
log(){ printf '[autodeploy] %s\n' "$*"; }
fail(){ log "ERROR: $*"; exit 1; }

[[ -s "$ENV_FILE" ]] || fail "No existe $ENV_FILE"
curl -fsSL --retry 3 --connect-timeout 10 "$VERSION_URL" -o "$TMP/version.json"

VERSION=$(python3 - "$TMP/version.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
v=str(x.get('version','')).strip()
if not v: raise SystemExit('Falta version')
print(v)
PY
)
CURRENT=$(cat "$CURRENT_FILE" 2>/dev/null || true)
if [[ "$CURRENT" == "$VERSION" ]]; then
  log "Sin cambios: $VERSION"
  exit 0
fi

log "Nueva versión: ${CURRENT:-ninguna} -> $VERSION"

python3 - "$TMP/version.json" "$TMP" <<'PY'
import json,sys,urllib.request,hashlib,os,pathlib
manifest=json.load(open(sys.argv[1])); root=pathlib.Path(sys.argv[2])
allowed=('server/','web/')
for i,item in enumerate(manifest.get('files',[]) or []):
    p=str(item.get('path','')).strip().lstrip('/')
    u=str(item.get('url','')).strip(); sha=str(item.get('sha256','')).strip().lower()
    if not p or not u or not sha: raise SystemExit(f'Archivo incompleto #{i}')
    if '..' in pathlib.PurePosixPath(p).parts or not p.startswith(allowed): raise SystemExit(f'Ruta no permitida: {p}')
    data=urllib.request.urlopen(u, timeout=20).read()
    got=hashlib.sha256(data).hexdigest()
    if got != sha: raise SystemExit(f'SHA inválido para {p}: {got}')
    out=root/'files'/p; out.parent.mkdir(parents=True,exist_ok=True); out.write_bytes(data)
for p in manifest.get('delete',[]) or []:
    p=str(p).strip().lstrip('/')
    if '..' in pathlib.PurePosixPath(p).parts or not p.startswith(allowed): raise SystemExit(f'Ruta delete no permitida: {p}')
for i,item in enumerate(manifest.get('migrations',[]) or []):
    u=str(item.get('url','')).strip(); sha=str(item.get('sha256','')).strip().lower()
    if not u or not sha: raise SystemExit(f'Migración incompleta #{i}')
    data=urllib.request.urlopen(u, timeout=20).read(); got=hashlib.sha256(data).hexdigest()
    if got != sha: raise SystemExit(f'SHA inválido migración #{i}: {got}')
    out=root/'migrations'/f'{i:03d}.sql'; out.parent.mkdir(parents=True,exist_ok=True); out.write_bytes(data)
PY

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
ROLLBACK="$ROOT/releases/rollback-$STAMP"
install -d -o root -g gohouse -m 0750 "$ROLLBACK"
cp -a "$ROOT/server" "$ROLLBACK/server"
cp -a "$ROOT/web" "$ROLLBACK/web"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
PGPASSWORD="$GOHOUSE_DB_PASSWORD" pg_dump -h 127.0.0.1 -U gohouse -d gohouse -Fc -f "$ROLLBACK/predeploy.dump"

rm -rf "$TMP/server" "$TMP/web"
cp -a "$ROOT/server" "$TMP/server"
cp -a "$ROOT/web" "$TMP/web"

if [[ -d "$TMP/files/server" ]]; then rsync -a "$TMP/files/server/" "$TMP/server/"; fi
if [[ -d "$TMP/files/web" ]]; then rsync -a "$TMP/files/web/" "$TMP/web/"; fi

python3 - "$TMP/version.json" "$TMP" <<'PY'
import json,sys,pathlib,shutil
x=json.load(open(sys.argv[1])); root=pathlib.Path(sys.argv[2])
for p in x.get('delete',[]) or []:
    p=str(p).strip().lstrip('/')
    base=root/('server' if p.startswith('server/') else 'web')
    rel=p.split('/',1)[1]
    t=base/rel
    if t.is_dir(): shutil.rmtree(t,ignore_errors=True)
    elif t.exists(): t.unlink()
PY

for f in "$TMP"/server/src/*.js "$TMP"/web/*.js; do [[ -f "$f" ]] && node --check "$f" >/dev/null; done
chown -R gohouse:gohouse "$TMP/server" "$TMP/web"
sudo -u gohouse env HOME=/opt/gohouse npm_config_cache=/opt/gohouse/.npm npm --prefix "$TMP/server" install --omit=dev --no-audit --no-fund >/dev/null

if compgen -G "$TMP/migrations/*.sql" >/dev/null; then
  for sql in "$TMP"/migrations/*.sql; do
    PGPASSWORD="$GOHOUSE_DB_PASSWORD" psql -h 127.0.0.1 -U gohouse -d gohouse -v ON_ERROR_STOP=1 -f "$sql" >/dev/null
  done
fi

rollback(){
  log "Despliegue falló; restaurando aplicación anterior"
  systemctl stop gohouse.service || true
  rm -rf "$ROOT/server" "$ROOT/web"
  cp -a "$ROLLBACK/server" "$ROOT/server"
  cp -a "$ROLLBACK/web" "$ROOT/web"
  chown -R gohouse:gohouse "$ROOT/server" "$ROOT/web"
  systemctl restart gohouse.service || true
}
trap 'rc=$?; if (( rc != 0 )); then rollback; fi; cleanup; exit $rc' EXIT

systemctl stop gohouse.service
rm -rf "$ROOT/server.new" "$ROOT/web.new"
cp -a "$TMP/server" "$ROOT/server.new"
cp -a "$TMP/web" "$ROOT/web.new"
chown -R gohouse:gohouse "$ROOT/server.new" "$ROOT/web.new"
rm -rf "$ROOT/server.old" "$ROOT/web.old"
mv "$ROOT/server" "$ROOT/server.old"
mv "$ROOT/web" "$ROOT/web.old"
mv "$ROOT/server.new" "$ROOT/server"
mv "$ROOT/web.new" "$ROOT/web"
systemctl restart gohouse.service

OK=0
for _ in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:8788/api/health >/dev/null 2>&1; then OK=1; break; fi
  sleep 1
done
[[ "$OK" == 1 ]] || fail "Health check local falló"

printf '%s\n' "$VERSION" > "$CURRENT_FILE"
rm -rf "$ROOT/server.old" "$ROOT/web.old"
find "$ROOT/releases" -mindepth 1 -maxdepth 1 -type d -name 'rollback-*' -printf '%T@ %p\n' | sort -nr | awk 'NR>5{print $2}' | xargs -r rm -rf
trap cleanup EXIT
log "Despliegue OK: $VERSION"
