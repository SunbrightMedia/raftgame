/**
 * A picture of a layout's plan, and its numbers.
 * Run: npx vite-node tools/world/plan.ts -- [seed] [out.ppm]
 *
 * Grey = mass, white = hall, dark = street; lanes in colour: blue = street
 * lane, orange = tunnel; a dot per junction. Walks in use are brighter.
 */
import { writeFileSync } from 'node:fs';
import { makeLayout } from '../../src/world/industrial/layout';

const args = process.argv.slice(2).filter((a) => a !== '--');
const seed = Number(args[0] ?? 1), out = args[1] ?? `maps/iw/plan_${seed}.ppm`;
const lay = makeLayout(seed, { streets: [[1, 2], [3, 5], [5, 2], [7, 1]] });
const N = lay.params.size, S = 6;
const img = new Uint8Array(N * S * N * S * 3);
const put = (x: number, y: number, c: number[]) => { const yy = N * S - 1 - y; if (x < 0 || yy < 0 || x >= N * S || yy >= N * S) return; img.set(c, (yy * N * S + x) * 3); };
const fill = (tx: number, ty: number, c: number[], inset = 0) => { for (let y = inset; y < S - inset; y++) for (let x = inset; x < S - inset; x++) put(tx * S + x, ty * S + y, c); };
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const b = lay.tileBlock[y * N + x];
  fill(x, y, b < 0 ? [26, 28, 32] : lay.blocks[b].kind === 'hall' ? [225, 225, 215] : [96, 98, 104]);
}
const usedSeg = new Map<number, number>();
for (const w of lay.walks) usedSeg.set(w.segment, (usedSeg.get(w.segment) ?? 0) + 1);
for (const s of lay.segments) {
  const n = usedSeg.get(s.id) ?? 0;
  for (const [x, y] of s.tiles) {
    const inside = lay.tileBlock[y * N + x] >= 0;
    const k = n ? 1 : 0.35;
    fill(x, y, (inside ? [255, 150, 40] : [70, 140, 255]).map((v) => Math.round(v * k)), 1);
  }
}
for (const j of lay.junctions) fill(j.x, j.y, lay.tileBlock[j.y * N + j.x] >= 0 ? [255, 60, 60] : [240, 240, 90], 1);
const S0 = lay.junctions[lay.start.junction];
fill(S0.x, S0.y, [60, 255, 90]);
writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${N * S} ${N * S}\n255\n`), Buffer.from(img)]));

const inJ = lay.junctions.filter((j) => lay.tileBlock[j.y * N + j.x] >= 0).length;
const tun = lay.segments.filter((s) => s.tunnel);
const walksT = lay.walks.filter((w) => lay.segments[w.segment].tunnel);
const ends = [...lay.nodes.values()].filter((m) => [1, 2, 4, 8].includes(m)).length;
console.log(JSON.stringify({
  seed, blocks: lay.blocks.length, halls: lay.blocks.filter((b) => b.kind === 'hall').length, streets: lay.streets.length,
  junctions: lay.junctions.length, junctionsInside: inJ, segments: lay.segments.length, tunnelSegments: tun.length, tunnelStairable: tun.filter((s) => s.stair).length,
  walks: lay.walks.length, tunnelWalks: walksT.length, tunnelStairs: walksT.filter((w) => w.la !== w.lb).length, stairs: lay.walks.filter((w) => w.la !== w.lb).length,
  loops: lay.walks.filter((w) => w.loop).length, nodes: lay.nodes.size, deadEnds: ends, out,
}));
