/**
 * Which luxels of a Source-lit map's lightmap lie inside a box (for comparing bakes on one area only):
 *   npx vite-node tools/bench/luxel-mask.ts -- MAP OUT.bin x0,y0,z0,x1,y1,z1
 * Writes one byte per lightmap texel (1 = inside).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseMap } from '../../src/data/map';
import { buildFaces } from '../../src/engine/light/faces';
import { sourceLayout, SOURCE_LM_WIDTH } from '../../src/engine/light/vrad';
import { sourceBakeInfo } from '../../src/game/sourceLighting';

const [mapPath, outPath, boxArg] = process.argv.slice(2).filter((a) => a !== '--');
const b = boxArg.split(',').map(Number);
const map = parseMap(JSON.parse(readFileSync(mapPath, 'utf8')));
const idx = JSON.parse(readFileSync('textures/p2/index.json', 'utf8')).textures as { name: string; size: [number, number]; source: Record<string, unknown> }[];
const mats = new Map(idx.map((t) => [t.name, { size: t.size, source: t.source }]));
const faces = buildFaces(map.brushes);
const { info } = sourceBakeInfo(map, faces, (tex) => mats.get(tex) as never);
const lay = sourceLayout(faces, info, SOURCE_LM_WIDTH);
const mask = new Uint8Array(lay.width * lay.height);
const byId = new Map(faces.map((f) => [f.id, f]));
for (const [id, r] of lay.rects) {
  const f = byId.get(id)!, g = r.grid, d = f.n[0] * f.origin[0] + f.n[1] * f.origin[1] + f.n[2] * f.origin[2];
  // Solve p·lmS = s, p·lmT = t, p·n = d.
  const A = [g.lmS, g.lmT, f.n];
  const cr = (a: number[], c: number[]) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
  const i0 = cr(A[1], A[2]), i1 = cr(A[2], A[0]), i2 = cr(A[0], A[1]), det = A[0][0] * i0[0] + A[0][1] * i0[1] + A[0][2] * i0[2];
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
    const s = g.minS + i, t = g.minT + j;
    const p = [0, 1, 2].map((k) => (s * i0[k] + t * i1[k] + d * i2[k]) / det);
    if (p[0] < b[0] || p[1] < b[1] || p[2] < b[2] || p[0] > b[3] || p[1] > b[4] || p[2] > b[5]) continue;
    for (let sl = 0; sl < r.slots; sl++) mask[(r.y + j) * lay.width + r.x + sl * g.w + i] = 1;
  }
}
writeFileSync(outPath, mask);
console.log(`${mask.reduce((a, v) => a + v, 0)} luxels inside`);
