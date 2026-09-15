import pathlib,subprocess,zipfile,io,shutil,re,tarfile,struct,zlib
root=pathlib.Path(__file__).resolve().parents[2]
target=pathlib.Path('/tmp/gohouse-tarifas-test/server');target.mkdir(parents=True,exist_ok=True)
raw=subprocess.check_output(['git','cat-file','blob','4a08fe162380ac168aa193f42898cdc6938c7f6b'],cwd=root)
print('RECOVERY_ARCHIVE_FORMAT',raw[:16].hex(),'BYTES',len(raw))
entries={}
if zipfile.is_zipfile(io.BytesIO(raw)):
    z=zipfile.ZipFile(io.BytesIO(raw));entries={n:z.read(n) for n in z.namelist() if not n.endswith('/')}
elif raw.startswith(b'PK\x03\x04'):
    # Retained recovery payload can lack a ZIP central directory. Recover only
    # complete, checksum-verified local entries for the disposable tests.
    offset=0
    while raw[offset:offset+4]==b'PK\x03\x04':
        h=struct.unpack_from('<4s5H3I2H',raw,offset)
        flags,method,crc,compressed,uncompressed,nlen,xlen=h[2],h[3],h[6],h[7],h[8],h[9],h[10]
        name=raw[offset+30:offset+30+nlen].decode('utf-8')
        pos=offset+30+nlen+xlen
        if flags & 8:
            assert method==8,'Unsupported streamed recovery entry'
            decoder=zlib.decompressobj(-15);content=decoder.decompress(raw[pos:],20*1024*1024)
            if not decoder.eof:break
            consumed=len(raw[pos:])-len(decoder.unused_data);end=pos+consumed
            if raw[end:end+4]==b'PK\x07\x08':end+=4
            crc,compressed,uncompressed=struct.unpack_from('<3I',raw,end);offset=end+12
        else:
            end=pos+compressed
            if end>len(raw):break
            content=zlib.decompress(raw[pos:end],-15) if method==8 else raw[pos:end]
            offset=end
        assert len(content)==uncompressed and zlib.crc32(content)&0xffffffff==crc, 'Recovery checksum failed '+name
        entries[name]=content
    print('COMPLETE_CHECKSUM_VERIFIED_ENTRIES',len(entries))
else:
    t=tarfile.open(fileobj=io.BytesIO(raw),mode='r:*')
    entries={m.name:t.extractfile(m).read() for m in t.getmembers() if m.isfile()}
print('RECOVERY_BACKEND_NAMES',[n for n in entries if n.endswith(('db.js','config.js','util.js','package.json'))])
name=next(n for n in entries if n.endswith('src/db.js'))
prefix=name[:-len('src/db.js')]
for name,content in entries.items():
    if not name.startswith(prefix):continue
    rel=pathlib.PurePosixPath(name[len(prefix):])
    if not rel.parts or '..' in rel.parts or rel.is_absolute() or any(p.startswith('.') for p in rel.parts):continue
    if rel.parts[0] not in ['src','migrations'] and str(rel) not in ['package.json','package-lock.json']:continue
    p=target/pathlib.Path(str(rel));p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(content)
files=list((root/'release/payload').glob('*/server/src/*.js'))
files.sort(key=lambda p:int(subprocess.check_output(['git','log','-1','--format=%ct','--',str(p.relative_to(root))],cwd=root,text=True).strip() or '0'))
for p in files:shutil.copyfile(p,target/'src'/p.name)
shutil.copyfile(root/'tests/tarifas/run.mjs',target/'tariff-tests.mjs')
print('Reconstructed canonical server dependencies; no production connection.')
print('DB_TRANSACTION_CONTRACT\n'+(target/'src/db.js').read_text())
print('CONFIG_ENV_KEYS',sorted(set(re.findall(r'process\.env\.([A-Z_0-9]+)',(target/'src/config.js').read_text()))))
