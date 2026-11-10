#!/bin/bash
# Pack what the industrial world's generator uses, build the private page and stage it for publishing.
# The page makes the world from a seed (N and B change it; ?seed=7 in the address sets it).
#   tools/world/publish-prep.sh [unused] [stage dir]
set -e
cd "$(dirname "$0")/../.."
SEED=${1:-1}
STAGE=${2:-dist-industrial-stage}
# The page makes the world itself (any seed), so pack every texture and model the generator can use.
npx vite-node tools/world/gen.ts -- kit | tail -1
.venv-look/bin/python tools/source/pack_catalogue.py --maps maps/iw/industrial-kit.json --out catalogue-iw --tex 512
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
