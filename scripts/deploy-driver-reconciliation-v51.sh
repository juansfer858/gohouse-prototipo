#!/usr/bin/env bash
# GoHouse V51 - guarded deployment. Run as root on vantix-saas-01 only.
set -Eeuo pipefail
if [ "$(id -u)" != "0" ]; then
  echo "Run only with: sudo bash /home/vantix/llanos-reconciliation-v51/deploy-v51.sh" >&2
  exit 1
fi
exec 9>/run/lock/gohouse-v51.lock
flock -n 9 || { echo "A deployment is already in progress" >&2; exit 1; }

SRC=/home/vantix/llanos-reconciliation-v51
APP=/opt/gohouse
WEB="$APP/web"
SERVER="$APP/server/src"
URL=https://domicilios-llanos.vantixgc.com
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$APP/backups/reconciliation-v51-$STAMP"
DEPLOYED=0

check_sha() {
  local expected="$1" target="$2" actual
  actual="$(sha256sum "$target" | cut -d' ' -f1)"
  if [ "$actual" != "$expected" ]; then
    echo "Safety stop: unexpected SHA256 at $target" >&2
    echo "Expected: $expected; Actual: $actual" >&2
    return 2
  fi
}
rollback() {
  local exit_code=$?
  trap - ERR
  set +e
  if [ "$DEPLOYED" -eq 1 ]; then
    echo "Deployment verification failed. Restoring backup: $BACKUP" >&2
    cp -a "$BACKUP/llanos-reports.js" "$WEB/llanos-reports.js"
    cp -a "$BACKUP/gohouse-panel.html" "$WEB/gohouse-panel.html"
    cp -a "$BACKUP/reports.js" "$SERVER/reports.js"
    systemctl restart gohouse.service || true
  fi
  exit "$exit_code"
}
trap rollback ERR

# Do not overwrite an unreviewed hotfix or drift in production.
check_sha 5e4e88e422b67fd542c8f974e861651757c2153a4240890ba44bef5856ecf133 "$WEB/llanos-reports.js"
check_sha 071d38869db300390e9634dd94cc9885683d5a77b1067eff4650e6c341bf6890 "$WEB/gohouse-panel.html"
check_sha 2cdf3c0e59b817c472135e3278ca983e441d24c60308c940a866ed04af86df8d "$SERVER/reports.js"

# The inspected, tested release must also match its frozen fingerprints.
check_sha 50ea54bc1fabc5c1f8bdb812872fb3f1d978c4bd423500fe483dc559e9e20718 "$SRC/web/llanos-reports.js"
check_sha a06511629970378ae366cc4b9d7d65fb62326d7bde3292e52f071e59904c249d "$SRC/web/gohouse-panel.html"
check_sha 0237a5bcee801e41b64e7e3d0f84beaf4d3ec0e4aaeaad9b0f650b0930a5fe2d "$SRC/server/src/reports.js"
node --check "$SRC/web/llanos-reports.js"
node --check "$SRC/server/src/reports.js"
systemctl is-active --quiet gohouse.service
curl -fsS --max-time 10 "$URL/api/health" >/dev/null

mkdir -p -m 0700 "$BACKUP"
cp -a "$WEB/llanos-reports.js" "$BACKUP/llanos-reports.js"
cp -a "$WEB/gohouse-panel.html" "$BACKUP/gohouse-panel.html"
cp -a "$SERVER/reports.js" "$BACKUP/reports.js"
echo "Backup created: $BACKUP"

# Same-directory temp files, then atomic rename. Preserve production ownership/mode.
put_atomic() {
  local source="$1" dest="$2" tmp="$2.v51.$$.tmp"
  install -o "$(stat -c %u "$dest")" -g "$(stat -c %g "$dest")" -m "$(stat -c %a "$dest")" "$source" "$tmp"
  mv -f "$tmp" "$dest"
}
DEPLOYED=1
put_atomic "$SRC/web/llanos-reports.js" "$WEB/llanos-reports.js"
put_atomic "$SRC/web/gohouse-panel.html" "$WEB/gohouse-panel.html"
put_atomic "$SRC/server/src/reports.js" "$SERVER/reports.js"
systemctl restart gohouse.service

# Ensure the running API and the served frontend are the intended versions.
SUCCESS=0
for _ in $(seq 1 20); do
  if curl -fsS --max-time 3 "$URL/api/health" >/dev/null 2>&1; then SUCCESS=1; break; fi
  sleep 1
done
test "$SUCCESS" = "1"
check_sha 50ea54bc1fabc5c1f8bdb812872fb3f1d978c4bd423500fe483dc559e9e20718 "$WEB/llanos-reports.js"
check_sha a06511629970378ae366cc4b9d7d65fb62326d7bde3292e52f071e59904c249d "$WEB/gohouse-panel.html"
check_sha 0237a5bcee801e41b64e7e3d0f84beaf4d3ec0e4aaeaad9b0f650b0930a5fe2d "$SERVER/reports.js"
FETCHED_SHA="$(curl -fsS --max-time 10 "$URL/llanos-reports.js?v=20261010.51" | sha256sum | cut -d' ' -f1)"
test "$FETCHED_SHA" = 50ea54bc1fabc5c1f8bdb812872fb3f1d978c4bd423500fe483dc559e9e20718
AUTH_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$URL/api/reports/summary")"
test "$AUTH_STATUS" = 401

DEPLOYED=0
trap - ERR
echo "V51 deployed; unauthenticated report still protected; backup: $BACKUP"
echo "No database migration, no order updates, no settlement writes."
