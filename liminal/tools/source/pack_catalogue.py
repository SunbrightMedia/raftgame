"""
Pack the catalogue's textures and models for the private catalogue page
(npm run build:catalogue). An artifact serves at most 511 files and 256 MB,
and no binary types beyond images and media, so:

  catalogue/sheets/sheet_NNN.jpg   textures at most TEX px, 64 per 2048 px sheet
  catalogue/textures.json          name -> [sheet, x, y, w, h]
  catalogue/packs/pack_NNN.png     model geometry, compacted, in a valid PNG
                                   (8-bit grey, one 4096-byte row per line,
                                   filter 0, deflated): the page inflates it
                                   itself, so the bytes come back exact
  catalogue/models.json            the model headers + where each one's data is

Model data per model (little-endian, 4-byte aligned parts): positions int16 x3
(quantized to the bounds), uvs int16 x2 (quantized to the uv range), normals
int8 x3, then indices uint16 (or uint32 past 65535 vertices).

    .venv-look/bin/python tools/source/pack_catalogue.py
    .venv-look/bin/python tools/source/pack_catalogue.py --maps maps/iw/industrial.json --out catalogue-iw --tex 512

--maps: pack only the textures and models these maps use (a small page for one world).
--out: the folder to write (default catalogue). --tex: texture size cap in the sheets (default 256).
"""
import json, os, glob, struct, sys, zlib, math
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '../..'))
ARGS = sys.argv[1:]
def _opt(name, default):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default
OUT = os.path.join(ROOT, _opt('--out', 'catalogue'))
TEX, SHEET = int(_opt('--tex', 256)), 2048
# --maps a.json b.json ...: everything after the flag up to the next flag.
MAPS = []
if '--maps' in ARGS:
    for a in ARGS[ARGS.index('--maps') + 1:]:
        if a.startswith('--'):
            break
        MAPS.append(os.path.join(ROOT, a))


def used_by_maps():
    """(texture names, model names) the chosen maps use: face textures, glow textures, props and their materials."""
    tex, models = set(), []
    for p in MAPS:
        m = json.load(open(p))
        for b in m['brushes']:
            if b.get('tex'):
                tex.add(b['tex'])
            for f in (b.get('faces') or {}).values():
                if f and f.get('tex'):
                    tex.add(f['tex'])
        for e in m['entities']:
            pr = e.get('props') or {}
            if e['class'] == 'prop' and pr.get('model') not in models:
                models.append(pr['model'])
            for k in ('tex', 'halo'):
                if e['class'] in ('glow', 'beam') and pr.get(k):
                    tex.add(pr[k])
    return tex, models
PACK_BYTES = 11 * 1024 * 1024


def png_bytes(data: bytes) -> bytes:
    W = 4096
    rows = math.ceil(len(data) / W) or 1
    data = data + b'\0' * (rows * W - len(data))
    raw = b''.join(b'\0' + data[r * W:(r + 1) * W] for r in range(rows))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', W, rows, 8, 0, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


def pack_textures(only=None):
    index = json.load(open(os.path.join(ROOT, 'textures/p2lib/index.json')))['textures']
    if only is not None:
        index = [t for t in index if t['name'] in only]
    os.makedirs(os.path.join(OUT, 'sheets'), exist_ok=True)
    per = (SHEET // TEX) ** 2
    out, sheet, n = {}, None, 0
    for i, t in enumerate(sorted(index, key=lambda t: t['name'])):
        k = i % per
        if k == 0:
            if sheet is not None:
                sheet.save(os.path.join(OUT, 'sheets', f'sheet_{n:03d}.jpg'), quality=85); n += 1
            sheet = Image.new('RGB', (SHEET, SHEET), (40, 40, 40))
        im = Image.open(os.path.join(ROOT, 'textures', t['file'])).convert('RGB')
        im.thumbnail((TEX, TEX), Image.LANCZOS)
        x, y = (k % (SHEET // TEX)) * TEX, (k // (SHEET // TEX)) * TEX
        sheet.paste(im, (x, y))
        out[t['name']] = [n, x, y, im.width, im.height]
    if sheet is not None:
        sheet.save(os.path.join(OUT, 'sheets', f'sheet_{n:03d}.jpg'), quality=85); n += 1
    json.dump({'sheets': n, 'textures': out}, open(os.path.join(OUT, 'textures.json'), 'w'))
    print(f'{len(out)} textures in {n} sheets')


def encode_model(h, binpath):
    n, ni = h['vertexCount'], h['indexCount']
    b = open(binpath, 'rb').read()
    pos = np.frombuffer(b, np.float32, n * 3, 0).reshape(n, 3)
    nrm = np.frombuffer(b, np.float32, n * 3, n * 12).reshape(n, 3)
    uv = np.frombuffer(b, np.float32, n * 2, n * 24).reshape(n, 2)
    idx = np.frombuffer(b, np.uint32, ni, n * 32)
    pos, nrm, uv = np.nan_to_num(pos), np.nan_to_num(nrm), np.nan_to_num(uv)   # a few models carry NaNs
    lo, hi = pos.min(0), pos.max(0)
    span = np.maximum(hi - lo, 1e-6)
    qp = np.round((pos - lo) / span * 65535 - 32768).astype(np.int16)
    ulo, uhi = uv.min(0), uv.max(0)
    uspan = np.maximum(uhi - ulo, 1e-6)
    qu = np.round((uv - ulo) / uspan * 65535 - 32768).astype(np.int16)
    qn = np.clip(np.round(nrm * 127), -127, 127).astype(np.int8)
    wide = n > 65535
    qi = idx.astype(np.uint32 if wide else np.uint16)
    pad = lambda x: x + b'\0' * (-len(x) % 4)
    blob = pad(qp.tobytes()) + pad(qu.tobytes()) + pad(qn.tobytes()) + pad(qi.tobytes())
    q = {'pos': [lo.round(4).tolist(), span.round(5).tolist()], 'uv': [ulo.round(5).tolist(), uspan.round(6).tolist()], 'wide': wide}
    return blob, q


def pack_models(only=None):
    # Models in the order the rooms place them, so a room reads few packs.
    order = []
    for r in range(10):
        p = os.path.join(ROOT, f'maps/p2lib/room{r}.json')
        if only is None and os.path.exists(p):
            for e in json.load(open(p))['entities']:
                if e['class'] == 'prop' and e['props']['model'] not in order:
                    order.append(e['props']['model'])
    if only is not None:
        order = list(only)
    headers = {}
    for f in glob.glob(os.path.join(ROOT, 'models/p2lib/**/*.json'), recursive=True):
        h = json.load(open(f))
        if h.get('format') == 'liminal-mesh':
            headers[h['source']] = (h, f[:-5] + '.bin')
    os.makedirs(os.path.join(OUT, 'packs'), exist_ok=True)
    out, buf, n = {}, bytearray(), 0
    def flush():
        nonlocal buf, n
        if buf:
            open(os.path.join(OUT, 'packs', f'pack_{n:03d}.png'), 'wb').write(png_bytes(bytes(buf)))
            n += 1; buf = bytearray()
    for name in order + (sorted(set(headers) - set(order)) if only is None else []):
        if name not in headers:
            continue
        h, binpath = headers[name]
        blob, q = encode_model(h, binpath)
        if buf and len(buf) + len(blob) > PACK_BYTES:
            flush()
        hh = {k: h[k] for k in ('format', 'version', 'source', 'vertexCount', 'indexCount', 'materials', 'skins', 'bounds', 'hull', 'meshes', 'collision') if k in h}
        hh['bin'] = ''
        hh['pack'] = {'n': n, 'offset': len(buf), 'length': len(blob), **q}
        out[name] = hh
        buf += blob
    flush()
    json.dump(out, open(os.path.join(OUT, 'models.json'), 'w'))
    print(f'{len(out)} models in {n} packs')


if __name__ == '__main__':
    if MAPS:
        tex, models = used_by_maps()
        # A used model's materials are textures too.
        heads = {}
        for f in glob.glob(os.path.join(ROOT, 'models/p2lib/**/*.json'), recursive=True):
            h = json.load(open(f))
            if h.get('format') == 'liminal-mesh':
                heads[h['source']] = h
        for name in models:
            tex.update(heads.get(name, {}).get('materials', []))
        for d in ('sheets', 'packs'):
            for f in glob.glob(os.path.join(OUT, d, '*')):
                os.remove(f)
        pack_textures(tex)
        pack_models(models)
    else:
        pack_textures()
        pack_models()
