"""
Fetch CC0 models from Poly Haven (polyhaven.com/license) as glTF packages into models/src/polyhaven/<id>/,
verify every file against the API's md5, write info.json per model and add credit rows to CREDITS.md.
The manifest is tools/models/polyhaven_models.json. Convert with tools/models/import_gltf.py afterwards.

    python3 -I tools/fetch_polyhaven_models.py                 # fetch every manifest id that is missing/incomplete
    python3 -I tools/fetch_polyhaven_models.py id [id ...]     # add ids to the manifest, then fetch them
    python3 -I tools/fetch_polyhaven_models.py --res 2k [...]  # other resolution (default: manifest "res", 1k)

Safety: a file over 40 MB or a package over 60 MB is not kept; that model is skipped and listed in the summary.
Stdlib only.
"""
import datetime, hashlib, json, os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, 'tools', 'models', 'polyhaven_models.json')
OUT = os.path.join(ROOT, 'models', 'src', 'polyhaven')
CREDITS = os.path.join(ROOT, 'CREDITS.md')
UA = 'liminal-asset-fetch/1.0'
MAX_FILE, MAX_PKG = 40 * 1024 * 1024, 60 * 1024 * 1024


def get(url):
    last = None
    for delay in (2, 4, 8, 16, None):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=120) as r:
                return r.read()
        except Exception as e:  # network and HTTP errors alike
            last = e
            if delay is None:
                break
            time.sleep(delay)
    raise RuntimeError(f'{url}: {last}')


def md5(b):
    return hashlib.md5(b).hexdigest()


def file_ok(path, meta):
    if not os.path.isfile(path) or os.path.getsize(path) != meta['size']:
        return False
    with open(path, 'rb') as f:
        return md5(f.read()) == meta['md5']


def safe_rel(rel):
    parts = rel.replace('\\', '/').split('/')
    if rel.startswith('/') or '..' in parts:
        raise RuntimeError('unsafe path in API data: ' + rel)
    return os.path.join(*parts)


def fetch_model(mid, res):
    info = json.loads(get(f'https://api.polyhaven.com/info/{mid}'))
    files = json.loads(get(f'https://api.polyhaven.com/files/{mid}'))
    pkg = files['gltf'][res]['gltf']
    entries = {os.path.basename(pkg['url']): pkg}
    for rel, m in pkg.get('include', {}).items():
        entries[rel] = m
    total = sum(m['size'] for m in entries.values())
    big = max(m['size'] for m in entries.values())
    if big > MAX_FILE or total > MAX_PKG:
        return {'skipped': True, 'bytes': total, 'why': f'largest file {big/1e6:.1f} MB, package {total/1e6:.1f} MB'}
    dest = os.path.join(OUT, mid)
    listing = []
    for rel, m in entries.items():
        path = os.path.join(dest, safe_rel(rel))
        if not file_ok(path, m):
            data = get(m['url'])
            if md5(data) != m['md5']:
                data = get(m['url'])  # one more try on a corrupt transfer
                if md5(data) != m['md5']:
                    raise RuntimeError(f'md5 mismatch for {mid}/{rel}')
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'wb') as f:
                f.write(data)
        listing.append({'path': rel.replace('\\', '/'), 'size': m['size'], 'md5': m['md5']})
    authors = list(info.get('authors', {}).keys())
    meta = {
        'id': mid, 'name': info.get('name', mid), 'url': f'https://polyhaven.com/a/{mid}', 'authors': authors,
        'licence': 'CC0 1.0', 'categories': info.get('categories', []), 'tags': info.get('tags', []),
        'dimensions_mm': info.get('dimensions'), 'polycount': info.get('polycount'),
        'date_published': info.get('date_published'), 'resolution': res, 'files': listing,
        'fetched': datetime.date.today().isoformat(),
    }
    with open(os.path.join(dest, 'info.json'), 'w') as f:
        json.dump(meta, f, indent=1)
        f.write('\n')
    return {'bytes': total, 'meta': meta}


def update_credits(metas):
    with open(CREDITS, encoding='utf-8') as f:
        lines = f.read().split('\n')
    start = next(i for i, l in enumerate(lines) if l.strip() == '## Models')
    end = start + 1
    while end < len(lines) and not lines[end].startswith('## '):
        end += 1
    last = max(i for i in range(start, end) if lines[i].startswith('|'))
    new = []
    for m in metas:
        key = f"| `ph/{m['id']}`"
        if any(l.startswith(key) for l in lines[start:end]):
            continue
        by = ', '.join(m['authors']) or 'Poly Haven'
        new.append(f"| `ph/{m['id']}` (source: models/src/polyhaven/{m['id']}) | "
                   f"[{m['name']} by {by}, Poly Haven]({m['url']}) | CC0 1.0 |")
    lines[last + 1:last + 1] = new
    with open(CREDITS, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))


def main():
    args = sys.argv[1:]
    man = json.load(open(MANIFEST))
    res = man.get('res', '1k')
    if '--res' in args:
        i = args.index('--res')
        res = args[i + 1]
        del args[i:i + 2]
    ids = args
    if not all(re.fullmatch(r'[A-Za-z0-9_]+', a) for a in ids):
        sys.exit('bad id in arguments')
    new_ids = [a for a in dict.fromkeys(ids) if a not in man['models']]
    if new_ids:
        man['models'] += new_ids
        with open(MANIFEST, 'w') as f:
            json.dump(man, f, indent=2)
            f.write('\n')
    todo = list(dict.fromkeys(ids)) or man['models']
    results, metas = {}, []
    for mid in todo:
        try:
            r = fetch_model(mid, res)
        except Exception as e:
            r = {'failed': True, 'bytes': 0, 'why': str(e)}
        results[mid] = r
        if 'meta' in r:
            metas.append(r['meta'])
        print(f"{mid}: {r['bytes']} bytes" + (' NOT KEPT: ' + r['why'] if 'why' in r else ''), flush=True)
    update_credits(metas)
    print('total bytes:', sum(r['bytes'] for r in results.values() if 'meta' in r))
    for mid, r in results.items():
        if 'why' in r:
            print('not kept:', mid, r['why'], f"({r['bytes']} bytes)")


main()
