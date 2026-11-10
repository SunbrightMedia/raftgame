/**
 * Camera poses for looking at the closed parts of a generated industrial world.
 * Run: npx vite-node tools/world/spots.ts -- [seed] [count per kind]
 * Prints lines "kind x,y,z,yaw,pitch" (for tools/studio views).
 */
import { makeLayout } from '../../src/world/industrial/layout';
import { industrial } from '../../src/world/industrial/world';

const args = process.argv.slice(2).filter((a) => a !== '--');
const seed = Number(args[0] ?? 1), per = Number(args[1] ?? 4);
const lay = makeLayout(seed, { streets: [[1, 2], [3, 5], [5, 2], [7, 1]] });
const N = lay.params.size, L = lay.params.levels, T = 128;
const zOf = (l: number) => (l - Math.floor(L / 2)) * 256;
const blockOf = (x: number, y: number) => lay.tileBlock[y * N + x];
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
const pose = (x: number, y: number, z: number, d: number, back = 0, pitch = 0) => `${Math.round(x * T + 64 - DX[d] * back)},${Math.round(y * T + 64 - DY[d] * back)},${z + 1},${d * 90},${pitch}`;
const out: Record<string, string[]> = { door: [], corridor: [], stair: [], room: [], end: [], out: [] };
for (const w of lay.walks) {
  const s = lay.segments[w.segment];
  if (!s.tunnel) continue;
  const up = w.lb >= w.la, seq = up ? s.tiles : [...s.tiles].reverse(), d = up ? s.dir : (s.dir + 2) % 4;
  const lo = Math.min(w.la, w.lb), hi = Math.max(w.la, w.lb);
  const i0 = lo === hi ? seq.length : Math.floor((seq.length - 4) / 2);
  const first = seq.findIndex(([x, y]) => blockOf(x, y) >= 0);
  if (first > 0) out.door.push(pose(seq[first - 1][0], seq[first - 1][1], zOf(lo), d, 100));
  if (first >= 0 && first + 1 < seq.length && lo === hi) out.corridor.push(pose(seq[first + 1][0], seq[first + 1][1], zOf(lo), d));
  if (lo !== hi && blockOf(seq[i0][0], seq[i0][1]) >= 0) { out.stair.push(pose(seq[i0 - 1][0], seq[i0 - 1][1], zOf(lo), d, 0, -15)); out.stair.push(pose(seq[i0 + 4][0], seq[i0 + 4][1], zOf(hi), (d + 2) % 4, 0, 20)); }
  const lastIn = seq.length - 1 - [...seq].reverse().findIndex(([x, y]) => blockOf(x, y) >= 0);
  if (lastIn < seq.length - 1 && lo === hi) out.out.push(pose(seq[lastIn - 1][0], seq[lastIn - 1][1], zOf(hi), d));
}
for (const [k, mask] of lay.nodes) {
  const [j, l] = k.split(':').map(Number);
  const J = lay.junctions[j];
  if (blockOf(J.x, J.y) < 0) continue;
  const open = [0, 1, 2, 3].filter((d) => mask & (1 << d));
  // Stand in the way in, look at the room.
  const d = (open[0] + 2) % 4;
  (open.length === 1 ? out.end : out.room).push(pose(J.x, J.y, zOf(l), d, 150));
}
for (const n of industrial(seed).notes) (out[n.kind] ??= []).push(`${Math.round(n.at[0])},${Math.round(n.at[1])},${n.at[2] + 1},${n.yaw},0`);
for (const [kind, list] of Object.entries(out)) {
  const step = Math.max(1, Math.floor(list.length / per));
  for (let i = 0, n = 0; i < list.length && n < per; i += step, n++) console.log(kind, list[i]);
}
console.error(Object.entries(out).map(([k, v]) => `${k} ${v.length}`).join(', '));
