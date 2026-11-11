import { parseMap, serializeMap, type EntityDef, type MapFile } from '../data/map';
import { buildFaces, solidPlanes } from '../engine/light/faces';
import { faceBatches } from '../engine/render/faceBatches';
import { propSolids, type PropShape } from '../engine/collision/props';
import { buildLightGrid, lightSlot, CELL, LAMP_ROW, LAMP_TEXELS, type Box3, type GridLamp, type LightWindow, type LotLight } from '../engine/render/lightGridCore';
import { mapLamps } from '../engine/render/mapLamps';
import { industrialLots, GEOMETRY_SETTINGS } from './industrial/world';
import { LOT } from './industrial/lots';

/**
 * One lot of the endless world, made ready to show: everything that takes
 * time is done here, with no three.js and nothing of the page, so it can run
 * in a worker (world/lotWorker.ts). What comes out is plain arrays; the page
 * only hands them to the graphics card (game/lotWorld.ts).
 *
 * Places in a lot's own data are measured from the lot's south-west corner;
 * lamps are in world places (the lamp grid is one for the whole world).
 */
export const LOT_SIZE = LOT * 128;

/** What the builder must be told of the page: how big each texture is in the world, each model's collision, the lamp grid's window. */
export interface LotEnv {
  texSize: Record<string, [number, number]>;
  shapes: Record<string, PropShape>;
  window: LightWindow;
}

export interface LotBatch { tex: string; pos: Float32Array; nrm: Float32Array; uv: Float32Array; lm: Float32Array; lmoff: Float32Array; shade: Float32Array; gu: Float32Array; gv: Float32Array; idx: Uint32Array }
/** A solid for the player to stand on and walk into: planes n·p = d (four numbers each), n pointing out. */
export interface LotSolid { id: number; planes: Float32Array; min: [number, number, number]; max: [number, number, number]; material: string }
export interface LotPayload {
  seed: number; i: number; j: number;
  batches: LotBatch[];
  /** What the page builds itself from the map's own words: props, glows, beams, ropes, fog volumes. */
  entities: EntityDef[];
  solids: LotSolid[];
  light: LotLight | null;
  /** Milliseconds: making the lot, its faces and vertices, its lamp grid. Lamps listed, and how many were cut for want of room. */
  stats: { makeMs: number; meshMs: number; lightMs: number; brushes: number; props: number; lamps: number; dropped: number };
}

/** Lots already made, by seed and place: a lot is made once for itself and read again for each neighbour's lamp grid. */
const made = new Map<string, MapFile>();
function lotMap(seed: number, i: number, j: number): MapFile {
  const k = `${seed}:${i},${j}`;
  let m = made.get(k);
  if (!m) {
    m = parseMap(JSON.parse(serializeMap(industrialLots(seed, i, j, 1).map.toMap(`lot ${i},${j}`, GEOMETRY_SETTINGS))));
    if (made.size > 96) for (const old of [...made.keys()].slice(0, 32)) made.delete(old);
    made.set(k, m);
  }
  return m;
}

export function buildLot(seed: number, i: number, j: number, env: LotEnv): LotPayload {
  const t0 = performance.now();
  const map = lotMap(seed, i, j);
  const t1 = performance.now();

  // ---- what is drawn
  const faces = buildFaces(map.brushes);
  const batches: LotBatch[] = [];
  for (const [tex, b] of faceBatches(faces, (t) => { const s = env.texSize[t] ?? [512, 512]; return { worldW: s[0], worldH: s[1] }; }, null)) {
    batches.push({ tex, pos: new Float32Array(b.pos), nrm: new Float32Array(b.nrm), uv: new Float32Array(b.uv), lm: new Float32Array(b.lm), lmoff: new Float32Array(b.lmoff), shade: new Float32Array(b.shade), gu: new Float32Array(b.gu), gv: new Float32Array(b.gv), idx: new Uint32Array(b.idx) });
  }
  // ---- what is solid
  const solids: LotSolid[] = [];
  for (const b of map.brushes) {
    if (b.solid === false) continue;
    const sp = solidPlanes(b);
    solids.push({ id: b.id, planes: new Float32Array(sp.planes.flatMap((p) => [p.n[0], p.n[1], p.n[2], p.d])), min: [...b.min] as LotSolid['min'], max: [...b.max] as LotSolid['max'], material: b.material ?? 'default' });
  }
  for (const c of propSolids(map.entities, (m) => env.shapes[m.toLowerCase()])) {
    solids.push({ id: c.id, planes: new Float32Array(c.planes.flatMap((p) => [p.n.x, p.n.y, p.n.z, p.d])), min: [c.min.x, c.min.y, c.min.z], max: [c.max.x, c.max.y, c.max.z], material: c.material });
  }
  const t2 = performance.now();

  // ---- the lamp grid for this lot's own cells: lit by its lamps and by its eight neighbours' near the border
  const W = env.window;
  const lamps: GridLamp[] = [], shades: Box3[] = [], airs: Box3[] = [];
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const L = mapLamps(lotMap(seed, i + di, j + dj).entities);
    const ox = (i + di) * LOT_SIZE, oy = (j + dj) * LOT_SIZE;
    const move = (b: Box3): Box3 => ({ min: [b.min[0] + ox, b.min[1] + oy, b.min[2]], max: [b.max[0] + ox, b.max[1] + oy, b.max[2]] });
    for (const l of L.lamps) lamps.push({ ...l, pos: [l.pos[0] + ox, l.pos[1] + oy, l.pos[2]], box: l.box ? move(l.box) : undefined });
    for (const b of L.shades) shades.push(move(b));
    for (const b of L.airs) airs.push(move(b));
  }
  let light: LotLight | null = null, listed = 0, dropped = 0;
  const g = lamps.length ? buildLightGrid(lamps, shades, airs, { origin: [i * LOT_SIZE, j * LOT_SIZE, W.z0], dims: [W.lotCells, W.lotCells, W.nz] }) : null;
  if (g && g.stats.entries > 0) {
    const slot = lightSlot(W, i, j);
    const n = W.lotCells;
    light = { cells: new Float32Array(n * n * W.nz * 2), list: new Float32Array(W.listCap * 2).fill(-1), lamps: new Float32Array(W.lampCap * LAMP_TEXELS * 4), chains: new Float32Array(W.chainCap * 4) };
    // Only the lamps and the chains that some cell lists go in, numbered from this lot's slot.
    const lampAt = new Map<number, number>(), chainAt = new Map<number, number>();
    let lampN = 0, chainN = 0, listN = 0;
    for (let z = 0; z < W.nz; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const c = ((z * n + y) * n + x) * 2, from = g.grid[c], count = g.grid[c + 1];
      if (!count) continue;
      const first = listN;
      for (let q = 0; q < count && listN < W.listCap; q++) {
        const lamp = g.list[(from + q) * 2], chain = g.list[(from + q) * 2 + 1];
        let la = lampAt.get(lamp);
        if (la === undefined) {
          if (lampN >= W.lampCap) { dropped++; continue; }
          la = lampN++;
          lampAt.set(lamp, la);
          light.lamps.set(g.lamps.subarray(lamp * LAMP_TEXELS * 4, (lamp + 1) * LAMP_TEXELS * 4), la * LAMP_TEXELS * 4);
        }
        let ca = -1;
        if (chain >= 0) {
          const boxes = g.chains[chain * 4 + 3], texels = boxes * 2;
          const got = chainAt.get(chain);
          if (got !== undefined) ca = got;
          else if (chainN + texels <= W.chainCap) {
            ca = chainN;
            light.chains.set(g.chains.subarray(chain * 4, (chain + texels) * 4), ca * 4);
            chainAt.set(chain, ca);
            chainN += texels;
          } else { dropped++; continue; }   // no room for its chain: the lamp is left out of this cell (it would shine through walls)
        }
        light.list[listN * 2] = slot.lampAt + la;
        light.list[listN * 2 + 1] = ca < 0 ? -1 : slot.chainAt + ca;
        listN++;
      }
      // The window's own order of cells: a column of cells lies along the rows (lightGrid.ts).
      const to = ((y * W.nz + z) * n + x) * 2;
      light.cells[to] = slot.listAt + first;
      light.cells[to + 1] = listN - first;
    }
    listed = lampN;
    void LAMP_ROW; void CELL;
  }
  const t3 = performance.now();

  const drawn = new Set(['prop', 'glow', 'beam', 'rope', 'fog_volume', 'label']);
  return {
    seed, i, j, batches, solids, light,
    entities: map.entities.filter((e) => drawn.has(e.class)),
    stats: { makeMs: Math.round(t1 - t0), meshMs: Math.round(t2 - t1), lightMs: Math.round(t3 - t2), brushes: map.brushes.length, props: map.entities.filter((e) => e.class === 'prop').length, lamps: listed, dropped },
  };
}

/** The buffers of a payload, to hand over to the page without copying. */
export function payloadBuffers(p: LotPayload): ArrayBuffer[] {
  const out: ArrayBufferLike[] = [];
  for (const b of p.batches) out.push(b.pos.buffer, b.nrm.buffer, b.uv.buffer, b.lm.buffer, b.lmoff.buffer, b.shade.buffer, b.gu.buffer, b.gv.buffer, b.idx.buffer);
  for (const s of p.solids) out.push(s.planes.buffer);
  if (p.light) out.push(p.light.cells.buffer, p.light.list.buffer, p.light.lamps.buffer, p.light.chains.buffer);
  return out as ArrayBuffer[];
}
