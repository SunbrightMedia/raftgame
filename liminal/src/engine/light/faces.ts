import { type BrushDef, type BoxBrushDef, type PrismBrushDef, type FaceKey, FACE_KEYS, faceTex } from '../../data/map';

export type Axis = [number, number, number];

/**
 * Per box face direction: outward normal, the "right" and "up" directions as
 * seen from outside (right × up = normal), and the fake directional shade
 * used in fullbright mode. UVs are world-aligned projections onto right/up,
 * so textures line up across neighbouring brushes, as in Hammer.
 */
export const FACE_FRAMES: Record<FaceKey, { n: Axis; r: Axis; u: Axis; shade: number }> = {
  px: { n: [1, 0, 0], r: [0, 1, 0], u: [0, 0, 1], shade: 0.82 },
  nx: { n: [-1, 0, 0], r: [0, -1, 0], u: [0, 0, 1], shade: 0.74 },
  py: { n: [0, 1, 0], r: [-1, 0, 0], u: [0, 0, 1], shade: 0.9 },
  ny: { n: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1], shade: 0.66 },
  pz: { n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0], shade: 1.0 },
  nz: { n: [0, 0, -1], r: [1, 0, 0], u: [0, -1, 0], shade: 0.58 },
};
const BOX_INDEX: Record<FaceKey, number> = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 };

/** Faces per brush in the id scheme (prisms may have up to 62 sides). */
export const FACES_PER_BRUSH = 64;
export const faceId = (brushId: number, index: number) => brushId * FACES_PER_BRUSH + index;

/**
 * One planar brush face, in a form both the renderer and the light baker use.
 * Plain data (no three.js) so it can be posted to the bake worker.
 * A face is a rectangle in its own (right, up) frame, or a convex polygon
 * inside that rectangle when `poly` is set.
 */
export interface Face {
  id: number;
  brushId: number;
  key: string;
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
  /** Convex outline in (s, t) face coordinates, counter-clockwise seen from outside. */
  poly?: [number, number][];
  shade: number;
  solid: boolean;
}

/** A brush as a convex set of planes n·p ≤ d, with which face each plane is. */
export interface SolidPlanes { brushId: number; planes: { n: Axis; d: number; face: number }[]; min: Axis; max: Axis }

export function facePoint(f: Face, s: number, t: number, lift = 0): Axis {
  return [
    f.origin[0] + f.r[0] * s + f.u[0] * t + f.n[0] * lift,
    f.origin[1] + f.r[1] * s + f.u[1] * t + f.n[1] * lift,
    f.origin[2] + f.r[2] * s + f.u[2] * t + f.n[2] * lift,
  ];
}

/** Planes of any brush. Box: 6 axial. Prism: one per side, then top, then bottom. */
export function solidPlanes(b: BrushDef): SolidPlanes {
  const planes: SolidPlanes['planes'] = [];
  if (b.type === 'box') {
    const { min, max } = b;
    planes.push(
      { n: [1, 0, 0], d: max[0], face: 0 }, { n: [-1, 0, 0], d: -min[0], face: 1 },
      { n: [0, 1, 0], d: max[1], face: 2 }, { n: [0, -1, 0], d: -min[1], face: 3 },
      { n: [0, 0, 1], d: max[2], face: 4 }, { n: [0, 0, -1], d: -min[2], face: 5 },
    );
  } else {
    const pts = b.points;
    pts.forEach(([x0, y0], k) => {
      const [x1, y1] = pts[(k + 1) % pts.length];
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      const n: Axis = [(y1 - y0) / len, -(x1 - x0) / len, 0]; // outward for CCW
      planes.push({ n, d: n[0] * x0 + n[1] * y0, face: k });
    });
    planes.push({ n: [0, 0, 1], d: b.z1, face: pts.length }, { n: [0, 0, -1], d: -b.z0, face: pts.length + 1 });
  }
  return { brushId: b.id, planes, min: [...b.min], max: [...b.max] };
}

export function insideSolid(s: SolidPlanes, p: Axis, eps = 1e-3): boolean {
  if (p[0] <= s.min[0] || p[0] >= s.max[0] || p[1] <= s.min[1] || p[1] >= s.max[1] || p[2] <= s.min[2] || p[2] >= s.max[2]) return false;
  for (const pl of s.planes) if (pl.n[0] * p[0] + pl.n[1] * p[1] + pl.n[2] * p[2] > pl.d - eps) return false;
  return true;
}

/**
 * Build every visible face. Faces buried inside another solid brush (a wall's
 * bottom sitting on the floor, two brushes touching) are dropped: nobody can
 * see them, and they'd waste lightmap space and bake time.
 */
export function buildFaces(brushes: BrushDef[]): Face[] {
  const solids = brushes.filter((b) => b.solid !== false).map((b) => ({ b, s: solidPlanes(b) }));
  const faces: Face[] = [];
  for (const b of brushes) {
    const own = b.type === 'box' ? boxFaces(b) : prismFaces(b);
    for (const f of own) {
      if (!isBuried(f, solids.filter((x) => x.b !== b).map((x) => x.s))) faces.push(f);
    }
  }
  return faces;
}

function boxFaces(b: BoxBrushDef): Face[] {
  const out: Face[] = [];
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
    out.push({
      id: faceId(b.id, BOX_INDEX[key]), brushId: b.id, key, tex: ft.tex, scale: ft.scale, offset: ft.offset, rot: ft.rot,
      n: fr.n, r: fr.r, u: fr.u, origin, width, height, shade: fr.shade, solid: b.solid !== false,
    });
  }
  return out;
}

function prismFaces(b: PrismBrushDef): Face[] {
  const out: Face[] = [];
  const pts = b.points;
  const h = b.z1 - b.z0;
  const solid = b.solid !== false;
  pts.forEach(([x0, y0], k) => {
    const [x1, y1] = pts[(k + 1) % pts.length];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-6) return;
    const r: Axis = [(x1 - x0) / len, (y1 - y0) / len, 0];
    const n: Axis = [r[1], -r[0], 0];
    const ft = faceTex(b, `side${k}`);
    out.push({
      id: faceId(b.id, k), brushId: b.id, key: `side${k}`, tex: ft.tex, scale: ft.scale, offset: ft.offset, rot: ft.rot,
      n, r, u: [0, 0, 1], origin: [x0, y0, b.z0], width: len, height: h,
      shade: 0.7 + 0.2 * Math.abs(n[1]) + 0.1 * Math.max(0, n[0]), solid,
    });
  });
  // Top and bottom: polygon faces in the same frames as box tops/bottoms.
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  for (const key of ['pz', 'nz'] as const) {
    const fr = FACE_FRAMES[key];
    const top = key === 'pz';
    // pz: r=+x, u=+y, origin at (minX, minY). nz: r=+x, u=-y, origin at (minX, maxY).
    const origin: Axis = [minX, top ? minY : maxY, top ? b.z1 : b.z0];
    let poly = pts.map(([x, y]) => [x - minX, top ? y - minY : maxY - y] as [number, number]);
    if (!top) poly = poly.reverse(); // keep counter-clockwise seen from outside
    const ft = faceTex(b, key);
    out.push({
      id: faceId(b.id, pts.length + (top ? 0 : 1)), brushId: b.id, key, tex: ft.tex, scale: ft.scale, offset: ft.offset, rot: ft.rot,
      n: fr.n, r: fr.r, u: fr.u, origin, width: maxX - minX, height: maxY - minY, poly, shade: fr.shade, solid,
    });
  }
  return out;
}

/** Is (s, t) inside the face (its polygon, or its rectangle)? */
export function inFace(f: Face, s: number, t: number): boolean {
  if (!f.poly) return s >= 0 && s <= f.width && t >= 0 && t <= f.height;
  const p = f.poly;
  for (let k = 0; k < p.length; k++) {
    const [ax, ay] = p[k], [bx, by] = p[(k + 1) % p.length];
    if ((bx - ax) * (t - ay) - (by - ay) * (s - ax) < -1e-6) return false;
  }
  return true;
}

function isBuried(f: Face, others: SolidPlanes[]): boolean {
  // Sample points just outside the face; if every one is inside some other
  // solid, the face can't be seen.
  const N = 4;
  let tested = 0;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const s = Math.min(Math.max((f.width * i) / N, 0.5), f.width - 0.5);
      const t = Math.min(Math.max((f.height * j) / N, 0.5), f.height - 0.5);
      if (!inFace(f, s, t)) continue;
      tested++;
      const p = facePoint(f, s, t, 0.5);
      if (!others.some((o) => insideSolid(o, p))) return false;
    }
  }
  return tested > 0;
}

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
  const items = faces.map((f) => {
    // Thin faces (baseboards, casing, counter edges) get finer luxels so they
    // have at least ~4 samples across, instead of one blurry/dotted row.
    const l = Math.max(1, Math.min(luxel, Math.min(f.width, f.height) / 3));
    return { id: f.id, w: Math.max(2, Math.ceil(f.width / l) + 1), h: Math.max(2, Math.ceil(f.height / l) + 1) };
  });
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
