/**
 * A picture of a layout's plan, its counts, and the maze's numbers (dead ends,
 * loops, how long the runs between choices are).
 * Run: npx vite-node tools/world/plan.ts -- [seed] [out.ppm]
 *
 * Masses are tinted by district kind (grey canyons, red alleys, green yards,
 * blue works, yellow racks); white = hall, dark = street. Lanes: blue = street,
 * orange = tunnel, green = bridge; a dot per junction. Walks in use are brighter.
 */
import { writeFileSync } from 'node:fs';
import { makeLayout } from '../../src/world/industrial/layout';

const args = process.argv.slice(2).filter((a) => a !== '--');
const seed = Number(args[0] ?? 1), out = args[1] ?? `maps/iw/plan_${seed}.ppm`;
const lay = makeLayout(seed);
const N = lay.params.size, S = 6;
const img = new Uint8Array(N * S * N * S * 3);
const put = (x: number, y: number, c: number[]) => { const yy = N * S - 1 - y; if (x < 0 || yy < 0 || x >= N * S || yy >= N * S) return; img.set(c, (yy * N * S + x) * 3); };
const fill = (tx: number, ty: number, c: number[], inset = 0) => { for (let y = inset; y < S - inset; y++) for (let x = inset; x < S - inset; x++) put(tx * S + x, ty * S + y, c); };
// Masses are tinted by their district's kind.
const TINT: Record<string, number[]> = { canyons: [100, 100, 108], alleys: [118, 96, 96], yards: [96, 116, 100], works: [86, 92, 122], racks: [120, 114, 90] };
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const b = lay.tileBlock[y * N + x];
  fill(x, y, b < 0 ? [26, 28, 32] : lay.blocks[b].kind === 'hall' ? [225, 225, 215] : TINT[lay.districtAt(x, y).kind]);
}
const usedSeg = new Map<number, number>();
for (const w of lay.walks) usedSeg.set(w.segment, (usedSeg.get(w.segment) ?? 0) + 1);
for (const s of lay.segments) {
  const n = usedSeg.get(s.id) ?? 0;
  for (const [x, y] of s.tiles) {
    const b = lay.tileBlock[y * N + x];
    const k = n ? 1 : 0.35;
    fill(x, y, (b < 0 ? [70, 140, 255] : lay.blocks[b].kind === 'hall' ? [20, 150, 60] : [255, 150, 40]).map((v) => Math.round(v * k)), 1);
  }
}
for (const j of lay.junctions) fill(j.x, j.y, lay.tileBlock[j.y * N + j.x] >= 0 ? [255, 60, 60] : [240, 240, 90], 1);
const S0 = lay.junctions[lay.start.junction];
fill(S0.x, S0.y, [60, 255, 90]);
writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${N * S} ${N * S}\n255\n`), Buffer.from(img)]));

// ---- the maze's numbers (docs/WORLD_DESIGN.md, "Measure each seed")
const runs = lay.walks.map((w) => lay.segments[w.segment].tiles.length + 1);   // tiles from one choice to the next
const share = (f: (n: number) => boolean) => Math.round((100 * runs.filter(f).length) / runs.length);
const perLevel = Array.from({ length: lay.params.levels }, (_, l) => [...lay.nodes.keys()].filter((k) => Number(k.split(':')[1]) === l).length);
const exits = [...lay.nodes.values()].map((m) => [1, 2, 4, 8].filter((b) => m & b).length);
const metrics = {
  deadEndShare: Math.round((100 * exits.filter((n) => n === 1).length) / exits.length) + '%',
  hubs: exits.filter((n) => n >= 3).length,
  loopShare: Math.round((100 * lay.walks.filter((w) => w.loop).length) / lay.walks.length) + '%',
  runsShortMediumLong: `${share((n) => n <= 5)}% / ${share((n) => n > 5 && n <= 14)}% / ${share((n) => n > 14)}%`,
  longestRunFeet: Math.round((Math.max(...runs) * 128) / 12),
  stairShare: Math.round((100 * lay.walks.filter((w) => w.la !== w.lb).length) / lay.walks.length) + '%',
  insideShare: Math.round((100 * lay.walks.filter((w) => lay.segments[w.segment].tunnel).length) / lay.walks.length) + '%',
  nodesPerLevel: perLevel.join(' '),
};
const inJ = lay.junctions.filter((j) => lay.tileBlock[j.y * N + j.x] >= 0).length;
const tun = lay.segments.filter((s) => s.tunnel);
const walksT = lay.walks.filter((w) => lay.segments[w.segment].tunnel);
const ends = [...lay.nodes.values()].filter((m) => [1, 2, 4, 8].includes(m)).length;
console.log(JSON.stringify({
  seed, districts: lay.districts.map((d) => d.kind).join(' '), blocks: lay.blocks.length, halls: lay.blocks.filter((b) => b.kind === 'hall').length, streets: lay.streets.length,
  junctions: lay.junctions.length, junctionsInside: inJ, segments: lay.segments.length, tunnelSegments: tun.length, tunnelStairable: tun.filter((s) => s.stair).length,
  walks: lay.walks.length, bridgeWalks: lay.walks.filter((w) => lay.segments[w.segment].bridge).length, tunnelWalks: walksT.length, tunnelStairs: walksT.filter((w) => w.la !== w.lb).length, stairs: lay.walks.filter((w) => w.la !== w.lb).length,
  loops: lay.walks.filter((w) => w.loop).length, nodes: lay.nodes.size, deadEnds: ends, out,
}));
console.log(JSON.stringify(metrics));
