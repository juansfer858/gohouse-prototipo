#!/usr/bin/env bash
set -euo pipefail

TARGET=/opt/gohouse/bin/autodeploy.sh
[[ -f "$TARGET" ]] || { echo "No existe $TARGET" >&2; exit 1; }

python3 - "$TARGET" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text()
needle='TMP=$(mktemp -d /tmp/gohouse-files-deploy.XXXXXX)\n'
patch=needle+'chown root:gohouse "$TMP"\nchmod 0750 "$TMP"\n'
if 'chmod 0750 "$TMP"' not in s:
    if needle not in s:
        raise SystemExit('No se encontró el punto de parche esperado')
    s=s.replace(needle,patch,1)
p.write_text(s)
PY

chown root:gohouse "$TARGET"
chmod 0750 "$TARGET"
bash -n "$TARGET"
systemctl daemon-reload
systemctl enable --now gohouse-autodeploy.timer >/dev/null

echo "[repair] autodeploy corregido"
"$TARGET"
