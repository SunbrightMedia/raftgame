import { NODRAW, type MapOut, type Side, type V3 } from './mapOut';

/**
 * A solid box with rooms and corridors cut out of it.
 *
 * The box is cut along every side of every hollow, and the cells that stay
 * solid are joined again into bigger boxes, but only so far as each side of a
 * box still looks at one kind of thing all over: the outside, a hollow, or
 * more of the same solid. So every face is either seen whole or hidden whole.
 * (A face that is partly buried is a trap: the engine drops faces it judges
 * buried from a few sample points, and light baked on one bleeds dark from
 * its buried part.) A side that looks at a hollow gets that hollow's floor,
 * wall or ceiling finish; one that looks at the outside gets the shell's
 * texture; one that looks at more solid is not drawn.
 *
 * Hollows may overlap each other and may run out through the box's sides (a
 * doorway, a window). Everything is axis-aligned.
 */
export interface Finish {
  floor: string; wall: string; ceil: string;
  /** Texture scale (world units per texel) and lightmap scale of the hollow's surfaces. */
  scale?: number; lightmapscale?: number;
}
export interface Hollow { min: V3; max: V3; finish: Finish }
export interface Shell { tex: string; scale?: number; lightmapscale?: number }

const SIDES: Side[] = ['x-', 'x+', 'y-', 'y+', 'z-', 'z+'];
const SOLID = 0, OUTSIDE = 1;   // what a side looks at; 2 + n = a hollow with finish n

/** Sorted cut positions along one axis: the box's two ends and every hollow side between them. */
function cuts(lo: number, hi: number, hollows: Hollow[], k: 0 | 1 | 2): number[] {
  const s = new Set<number>([lo, hi]);
  for (const h of hollows) for (const v of [h.min[k], h.max[k]]) if (v > lo && v < hi) s.add(v);
  return [...s].sort((a, b) => a - b);
}

/**
 * Writes the box [min, max] less the hollows into the map. Returns the number
 * of brushes written.
 */
export function carve(m: MapOut, min: V3, max: V3, hollows: Hollow[], shell: Shell): number {
  const inside = hollows.filter((h) => h.min[0] < max[0] && h.max[0] > min[0] && h.min[1] < max[1] && h.max[1] > min[1] && h.min[2] < max[2] && h.max[2] > min[2]);
  if (!inside.length) {
    m.box(min, max, { tex: shell.tex, scale: shell.scale, lightmapscale: shell.lightmapscale });
    return 1;
  }
  const finishes: Finish[] = [];
  const xs = cuts(min[0], max[0], inside, 0), ys = cuts(min[1], max[1], inside, 1), zs = cuts(min[2], max[2], inside, 2);
  const nx = xs.length - 1, ny = ys.length - 1, nz = zs.length - 1;
  const at = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  // Per cell: SOLID, or 2 + the finish of the hollow it lies in.
  const cell = new Int32Array(nx * ny * nz);
  for (const h of inside) {
    let f = finishes.indexOf(h.finish);
    if (f < 0) f = finishes.push(h.finish) - 1;
    // A hollow that begins before the box starts at the box's own side (index 0).
    const i0 = Math.max(0, xs.findIndex((v) => v >= h.min[0])), j0 = Math.max(0, ys.findIndex((v) => v >= h.min[1])), k0 = Math.max(0, zs.findIndex((v) => v >= h.min[2]));
    for (let k = k0; k < nz && zs[k + 1] <= h.max[2]; k++)
      for (let j = j0; j < ny && ys[j + 1] <= h.max[1]; j++)
        for (let i = i0; i < nx && xs[i + 1] <= h.max[0]; i++)
          if (!cell[at(i, j, k)]) cell[at(i, j, k)] = 2 + f;
  }
  const what = (i: number, j: number, k: number) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? OUTSIDE : cell[at(i, j, k)]);

  const done = new Uint8Array(nx * ny * nz);
  const free = (i: number, j: number, k: number) => !cell[at(i, j, k)] && !done[at(i, j, k)];
  /** What one side of the box of cells [i..i1] × [j..j1] × [k..k1] looks at, or −1 if it is not the same all over. */
  const faces = (i: number, i1: number, j: number, j1: number, k: number, k1: number): number[] => {
    const one = (fix: 0 | 1 | 2, v: number): number => {
      let c = -2;
      const see = (n: number) => { if (c === -2) c = n; else if (c !== n) c = -1; };
      if (fix === 0) for (let z = k; z <= k1 && c !== -1; z++) for (let y = j; y <= j1 && c !== -1; y++) see(what(v, y, z));
      else if (fix === 1) for (let z = k; z <= k1 && c !== -1; z++) for (let x = i; x <= i1 && c !== -1; x++) see(what(x, v, z));
      else for (let y = j; y <= j1 && c !== -1; y++) for (let x = i; x <= i1 && c !== -1; x++) see(what(x, y, v));
      return c;
    };
    return [one(0, i - 1), one(0, i1 + 1), one(1, j - 1), one(1, j1 + 1), one(2, k - 1), one(2, k1 + 1)];
  };
  const whole = (i: number, i1: number, j: number, j1: number, k: number, k1: number) => !faces(i, i1, j, j1, k, k1).includes(-1);
  const allFree = (i: number, i1: number, j: number, j1: number, k: number, k1: number) => {
    for (let z = k; z <= k1; z++) for (let y = j; y <= j1; y++) for (let x = i; x <= i1; x++) if (!free(x, y, z)) return false;
    return true;
  };

  let count = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!free(i, j, k)) continue;
    // Grow along x, then y, then z, while the cells in the way are solid and unused and every side stays whole.
    let i1 = i, j1 = j, k1 = k;
    while (i1 + 1 < nx && free(i1 + 1, j, k) && whole(i, i1 + 1, j, j, k, k)) i1++;
    while (j1 + 1 < ny && allFree(i, i1, j1 + 1, j1 + 1, k, k) && whole(i, i1, j, j1 + 1, k, k)) j1++;
    while (k1 + 1 < nz && allFree(i, i1, j, j1, k1 + 1, k1 + 1) && whole(i, i1, j, j1, k, k1 + 1)) k1++;
    for (let z = k; z <= k1; z++) for (let y = j; y <= j1; y++) for (let x = i; x <= i1; x++) done[at(x, y, z)] = 1;

    const sees = faces(i, i1, j, j1, k, k1);
    if (sees.every((c) => c === SOLID)) continue;   // buried on every side: nothing to draw, and nothing can touch it
    const tex: Partial<Record<Side, string>> = {};
    const sides: Partial<Record<Side, { scale?: number; lightmapscale?: number }>> = {};
    SIDES.forEach((side, n) => {
      const c = sees[n];
      if (c === SOLID) tex[side] = NODRAW;
      else if (c === OUTSIDE) tex[side] = shell.tex;
      else {
        const f = finishes[c - 2];
        tex[side] = side === 'z+' ? f.floor : side === 'z-' ? f.ceil : f.wall;
        sides[side] = { scale: f.scale ?? shell.scale, lightmapscale: f.lightmapscale ?? shell.lightmapscale };
      }
    });
    m.box([xs[i], ys[j], zs[k]], [xs[i1 + 1], ys[j1 + 1], zs[k1 + 1]], { tex, scale: shell.scale, lightmapscale: shell.lightmapscale, sides });
    count++;
  }
  return count;
}
