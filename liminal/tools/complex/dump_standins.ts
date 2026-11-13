// Writes our stand-ins for the game's image files (complexPost.ts standInImages) as raw RGBA8 + a JSON index.
//   npx vite-node tools/complex/dump_standins.ts -- OUT_DIR
import { mkdirSync, writeFileSync } from 'node:fs';
import { standInImages } from '../../src/engine/render/complexPost';

const out = process.argv[process.argv.length - 1];
mkdirSync(out, { recursive: true });
const index: Record<string, unknown> = {};
for (const [name, im] of Object.entries(standInImages())) {
  writeFileSync(`${out}/${name}.rgba`, im.data);
  index[name] = { w: im.w, h: im.h, wrap: im.wrap, mips: im.mips };
}
writeFileSync(`${out}/index.json`, JSON.stringify(index));
console.log('stand-ins written to', out, JSON.stringify(index));
