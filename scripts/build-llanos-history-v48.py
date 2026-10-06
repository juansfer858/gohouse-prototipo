#!/usr/bin/env python3
"""Build the four-file history fix from hash-verified V47 sources. No production writes."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone

BASE = Path('release/payload/reports-1')
OUT = Path('release/payload/reports-history-1')
FILES = ['server/src/reports.js', 'web/llanos-reports.js', 'web/llanos-report-excel.js', 'web/gohouse-panel.html']
patches = json.loads(Path('scripts/llanos-history-v48.patch.json').read_text())
assert set(patches) == set(FILES + ['@tests'])

def digest(data):
    return hashlib.sha256(data).hexdigest()

def replace_once(data, old, new):
    assert data.count(old) == 1, old
    return data.replace(old, new)

def built_bytes(name):
    spec = patches[name]
    src = Path('tests/reports-v47.mjs') if name == '@tests' else BASE / name
    data = src.read_bytes()
    assert digest(data) == spec['baseSha256'], f'Base changed: {src}'
    lines = data.decode('utf-8').splitlines(keepends=True)
    original_length = len(lines)
    previous = original_length
    for start, end, replacement in reversed(spec['edits']):
        assert 0 <= start <= end <= previous <= original_length
        assert isinstance(replacement, list) and all(isinstance(x, str) for x in replacement)
        lines[start:end] = replacement
        previous = start
    updated = ''.join(lines)
    assert digest(updated.encode('utf-8')) == spec['sha256'], f'Unexpected patch output: {name}'
    # A missing date is visible, but must not be described as a guessed/estimated date.
    if name == 'server/src/reports.js':
        updated = replace_once(updated, 'estimatedDates: rows.filter(r => r.dateEstimated).length', 'estimatedDates: rows.filter(r => r.date && r.dateEstimated).length')
    elif name == 'web/llanos-report-excel.js':
        updated = replace_once(updated, "r.dateEstimated ? 'Sí' : 'No'", "r.date && r.dateEstimated ? 'Sí' : 'No'")
    elif name == '@tests':
        updated = replace_once(updated, "check(!whole.canSettleSelection,", "check(whole.estimatedDates === 0, 'Undated records are not falsely described as estimated dates');\ncheck(!whole.canSettleSelection,")
        updated = replace_once(updated, "  await page.screenshot({ path: path.join(outDir, 'reports-desktop.png'), fullPage: true });", "  await page.click('#lr-all'); await page.click('#lr-tab-employee');\n  await page.waitForFunction(()=>document.querySelector('#lr-history-count')?.textContent.includes('10 de 10'));\n  await page.screenshot({ path: path.join(outDir, 'reports-desktop.png'), fullPage: true });")
    return updated.encode('utf-8')

def build():
    for name in patches:
        target = Path('tests/reports-history-v48.mjs') if name == '@tests' else OUT / name
        updated = built_bytes(name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(updated)
        print('VERIFIED', target, digest(updated))

def manifest():
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    assert len(source) == 40
    entries = []
    for name in FILES:
        path = OUT / name
        data = subprocess.check_output(['git', 'show', source + ':' + path.as_posix()])
        assert data == path.read_bytes() == built_bytes(name)
        entries.append({'path': name, 'url': f'https://raw.githubusercontent.com/juansfer858/gohouse-prototipo/{source}/{path.as_posix()}', 'sha256': digest(data)})
    doc = {'version': '2026.10.06-white-label.48', 'published_at': datetime.now(timezone.utc).isoformat(), 'status': 'release', 'files': entries, 'delete': [], 'migrations': []}
    Path('release/version.json').write_text(json.dumps(doc, ensure_ascii=False, indent=2) + '\n')
    print('MANIFEST_READY', doc['version'], 'files=', len(entries))

if '--manifest' in sys.argv:
    manifest()
else:
    build()
