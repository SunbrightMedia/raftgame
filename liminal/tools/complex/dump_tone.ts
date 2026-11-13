// Writes our tone table (src/engine/render/complexTone.ts) as raw float32 RGBA, red fastest, for
// tools/complex/check_tone.py to compare with the game's own step run by dxbc.py.
//   npx vite-node tools/complex/dump_tone.ts -- OUT.f32
import { writeFileSync } from 'node:fs';
import { makeToneTable } from '../../src/engine/render/complexTone';

const out = process.argv[process.argv.length - 1];
const t0 = performance.now();
const table = makeToneTable();
writeFileSync(out, Buffer.from(table.buffer));
console.log(`tone table: ${table.length / 4} cells in ${(performance.now() - t0).toFixed(0)} ms -> ${out}`);
