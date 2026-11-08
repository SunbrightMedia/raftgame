"""Write CREDITS.md from textures/index.json. Called by every texture importer."""
import json, os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def write_credits():
    idx = json.load(open(os.path.join(ROOT, 'textures', 'index.json')))['textures']
    groups = defaultdict(list)
    for t in idx:
        groups[(t.get('credit', 'unknown'), t.get('url', ''), t.get('license', ''))].append(t['name'])
    with open(os.path.join(ROOT, 'CREDITS.md'), 'w') as f:
        f.write('# Credits\n\n')
        f.write('Third-party textures are CC0 1.0 (public domain) unless listed otherwise. CC0 needs no credit; it is given anyway.\n')
        f.write('Procedural textures (`dev/*`, `house/wallpaper_*`, `house/paneling`, `office/vinyl_tile`, `office/lightpanel`, `office/trim`) are original, generated in `src/engine/render/devTextures.ts`.\n\n')
        f.write('| source | licence | textures |\n|---|---|---|\n')
        for (credit, url, lic), names in sorted(groups.items(), key=lambda kv: (kv[0][2] != 'CC0 1.0', kv[0][0])):
            if credit == 'Freedoom':
                continue
            src = f'[{credit}]({url})' if url else credit
            f.write(f"| {src} | {lic} | {', '.join(f'`{n}`' for n in sorted(names))} |\n")
        fd = groups.get(('Freedoom', 'https://freedoom.github.io', 'BSD-3-Clause'))
        if fd:
            f.write(f'\n## Freedoom ({len(fd)} textures, `freedoom/*`)\n\n')
            f.write('From [Freedoom](https://freedoom.github.io), under the BSD 3-Clause licence, which requires this notice in any build that includes them. '
                    'Full licence text: `textures/freedoom/LICENSE.txt`.\n\n')
            f.write('Copyright © 2001-2024 Contributors to the Freedoom project. All rights reserved.\n')

if __name__ == '__main__':
    write_credits()
