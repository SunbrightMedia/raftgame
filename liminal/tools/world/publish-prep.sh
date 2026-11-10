#!/bin/bash
# Generate the industrial world, pack what it uses, build the private page and stage it for publishing.
#   tools/world/publish-prep.sh [seed] [stage dir]
set -e
cd "$(dirname "$0")/../.."
SEED=${1:-1}
STAGE=${2:-dist-industrial-stage}
npx vite-node tools/world/gen.ts -- industrial "$SEED" | tail -2
.venv-look/bin/python tools/source/pack_catalogue.py --maps maps/iw/industrial.json --out catalogue-iw --tex 512
npx vite build --mode industrial | tail -3
rm -rf "$STAGE/assets"; mkdir -p "$STAGE"; cp -r dist-industrial/assets "$STAGE/"
JS=$(ls dist-industrial/assets | grep -E '^index-.*\.js$'); CSS=$(ls dist-industrial/assets | grep -E '^index-.*\.css$')
cat > "$STAGE/industrial.html" <<HTML
<title>Industrial World</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="assets/$CSS">
<style>:root{color-scheme:dark;--bg:#000}html,body{height:100%;background:var(--bg);margin:0;overflow:hidden}</style>
<canvas id="view"></canvas>
<script type="module" src="assets/$JS"></script>
HTML
(cd "$STAGE" && python3 -c "
import os, json
print(json.dumps(sorted('assets/'+f for f in os.listdir('assets'))))")
du -sh "$STAGE"
