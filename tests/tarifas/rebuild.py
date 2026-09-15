import pathlib,subprocess,zipfile,io,shutil,re
root=pathlib.Path(__file__).resolve().parents[2]
target=pathlib.Path('/tmp/gohouse-tarifas-test/server');target.mkdir(parents=True,exist_ok=True)
raw=subprocess.check_output(['git','cat-file','blob','4a08fe162380ac168aa193f42898cdc6938c7f6b'],cwd=root)
z=zipfile.ZipFile(io.BytesIO(raw))
name=next(n for n in z.namelist() if n.endswith('server/src/db.js'))
prefix=name[:-len('src/db.js')]
for name in z.namelist():
    if not name.startswith(prefix) or name.endswith('/'):continue
    rel=pathlib.PurePosixPath(name[len(prefix):])
    if '..' in rel.parts or rel.is_absolute() or any(p.startswith('.') for p in rel.parts):continue
    if rel.parts[0] not in ['src','migrations'] and str(rel) not in ['package.json','package-lock.json']:continue
    p=target/pathlib.Path(str(rel));p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(z.read(name))
# Apply retained deltas in their commit order, exactly as the VPS file releases do.
files=list((root/'release/payload').glob('*/server/src/*.js'))
files.sort(key=lambda p:int(subprocess.check_output(['git','log','-1','--format=%ct','--',str(p.relative_to(root))],cwd=root,text=True).strip() or '0'))
for p in files:shutil.copyfile(p,target/'src'/p.name)
shutil.copyfile(root/'tests/tarifas/run.mjs',target/'tariff-tests.mjs')
print('Reconstructed canonical server dependencies; no production connection.')
print('DB_TRANSACTION_CONTRACT\n'+(target/'src/db.js').read_text())
print('CONFIG_ENV_KEYS',sorted(set(re.findall(r'process\.env\.([A-Z_0-9]+)',(target/'src/config.js').read_text()))))
