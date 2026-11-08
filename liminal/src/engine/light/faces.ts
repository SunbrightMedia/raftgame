import { type BrushDef, type FaceKey, FACE_KEYS, faceTex } from '../../data/map';

export type Axis = [number, number, number];

/**
 * Per face direction: outward normal, the "right" and "up" directions as seen
 * from outside (right × up = normal), and the fake directional shade used in
 * fullbright mode. UVs are world-aligned projections onto right/up, so
 * textures line up across neighbouring brushes, as in Hammer.
 */
export const FACE_FRAMES: Record<FaceKey, { n: Axis; r: Axis; u: Axis; shade: number }> = {
  px: { n: [1, 0, 0], r: [0, 1, 0], u: [0, 0, 1], shade: 0.82 },
  nx: { n: [-1, 0, 0], r: [0, -1, 0], u: [0, 0, 1], shade: 0.74 },
  py: { n: [0, 1, 0], r: [-1, 0, 0], u: [0, 0, 1], shade: 0.9 },
  ny: { n: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1], shade: 0.66 },
  pz: { n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0], shade: 1.0 },
  nz: { n: [0, 0, -1], r: [1, 0, 0], u: [0, -1, 0], shade: 0.58 },
};
const FACE_INDEX: Record<FaceKey, number> = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 };

/**
 * One rectangular brush face, in a form both the renderer and the light baker
 * use. Plain data (no three.js) so it can be posted to the bake worker.
 */
export interface Face {
  /** brushId * 6 + face index: stable lookup key. */
  id: number;
  brushId: number;
  key: FaceKey;
  tex: string;
  scale: [number, number];
  offset: [number, number];
  rot: number;
  n: Axis;
  r: Axis;
  u: Axis;
  /** World position of the face's (right=0, up=0) corner. */
  origin: Axis;
  /** Extent along r and u. */
  width: number;
  height: number;
  shade: number;
  solid: boolean;
}

export const faceId = (brushId: number, key: FaceKey) => brushId * 6 + FACE_INDEX[key];

/** Point on a face at (s, t) units along its right/up axes. */
export function facePoint(f: Face, s: number, t: number, lift = 0): Axis {
  return [
    f.origin[0] + f.r[0] * s + f.u[0] * t + f.n[0] * lift,
    f.origin[1] + f.r[1] * s + f.u[1] * t + f.n[1] * lift,
    f.origin[2] + f.r[2] * s + f.u[2] * t + f.n[2] * lift,
  ];
}

/**
 * Build every visible face. Faces buried inside another solid brush (a wall's
 * bottom sitting on the floor, two brushes touching) are dropped: nobody can
 * see them, and they would waste lightmap space and bake time.
 */
export function buildFaces(brushes: BrushDef[]): Face[] {
  const solids = brushes.filter((b) => b.solid !== false);
  const faces: Face[] = [];
  for (const b of brushes) {
    for (const key of FACE_KEYS) {
      const fr = FACE_FRAMES[key];
      const ax = fr.n.findIndex((c) => c !== 0);
      const ra = fr.r.findIndex((c) => c !== 0);
      const ua = fr.u.findIndex((c) => c !== 0);
      const width = b.max[ra] - b.min[ra];
      const height = b.max[ua] - b.min[ua];
      if (width <= 0 || height <= 0) continue;
      const origin: Axis = [0, 0, 0];
      origin[ax] = fr.n[ax] > 0 ? b.max[ax] : b.min[ax];
      origin[ra] = fr.r[ra] > 0 ? b.min[ra] : b.max[ra];
      origin[ua] = fr.u[ua] > 0 ? b.min[ua] : b.max[ua];
      const ft = faceTex(b, key);
      const f: Face = {
        id: faceId(b.id, key), brushId: b.id, key, tex: ft.tex, scale: ft.scale, offset: ft.offset, rot: ft.rot,
        n: fr.n, r: fr.r, u: fr.u, origin, width, height, shade: fr.shade, solid: b.solid !== false,
      };
      if (!isBuried(f, b, solids)) faces.push(f);
    }
  }
  return faces;
}

function isBuried(f: Face, self: BrushDef, solids: BrushDef[]): boolean {
  // Sample a grid of points just outside the face; if every one is inside
  // some other solid, the face can't be seen.
  const N = 4;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const s = Math.min(Math.max((f.width * i) / N, 0.5), f.width - 0.5);
      const t = Math.min(Math.max((f.height * j) / N, 0.5), f.height - 0.5);
      const p = facePoint(f, s, t, 0.5);
      if (!solids.some((b) => b !== self && inside(b, p))) return false;
    }
  }
  return true;
}

const inside = (b: BrushDef, p: Axis) =>
  p[0] > b.min[0] && p[0] < b.max[0] && p[1] > b.min[1] && p[1] < b.max[1] && p[2] > b.min[2] && p[2] < b.max[2];

// ---------------------------------------------------------------------------
// Lightmap layout

export interface LightmapRect { x: number; y: number; w: number; h: number }
export interface LightmapLayout { width: number; height: number; luxel: number; rects: Map<number, LightmapRect> }

/**
 * Give each face a block of luxels (lightmap pixels), one every `luxel` units
 * with samples on the face's edges, and pack the blocks into one atlas with a
 * simple shelf packer. 16 units per luxel is Source's default lightmap scale.
 */
export function layoutLightmap(faces: Face[], luxel: number, maxWidth = 2048): LightmapLayout {
  const items = faces.map((f) => ({
    id: f.id,
    w: Math.max(2, Math.ceil(f.width / luxel) + 1),
    h: Math.max(2, Math.ceil(f.height / luxel) + 1),
  }));
  items.sort((a, b) => b.h - a.h || b.w - a.w);
  const total = items.reduce((s, i) => s + i.w * i.h, 0);
  const width = Math.min(maxWidth, Math.max(256, 2 ** Math.ceil(Math.log2(Math.sqrt(total) * 1.15))));
  const rects = new Map<number, LightmapRect>();
  let x = 0, y = 0, shelf = 0;
  for (const it of items) {
    if (x + it.w > width) { x = 0; y += shelf; shelf = 0; }
    rects.set(it.id, { x, y, w: it.w, h: it.h });
    x += it.w;
    shelf = Math.max(shelf, it.h);
  }
  return { width, height: Math.max(1, y + shelf), luxel, rects };
}
