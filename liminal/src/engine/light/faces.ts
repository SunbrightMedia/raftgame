import { type BrushDef, type BoxBrushDef, type PrismBrushDef, type ConvexBrushDef, type FaceKey, FACE_KEYS, faceTex } from '../../data/map';
import { sidePolygon } from '../../data/convex';

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

/** Faces per brush in the id scheme (prisms may have up to 126 sides: curves need many). */
export const FACES_PER_BRUSH = 128;
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
  /** Source-style texture axes [x, y, z, shift] (FaceTex.uaxis/vaxis); replace scale/offset/rot when set. */
  ua?: [number, number, number, number];
  va?: [number, number, number, number];
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
  /**
   * Smoothing (Source's smoothing groups): the shading normal at s = 0 and
   * s = width, for prism sides that meet a neighbouring side at a shallow
   * angle (rounded corners). Lighting interpolates between them so a curve
   * built from flat segments shades round. Absent = flat.
   */
  nS?: [Axis, Axis];
}

/** Sides meeting at less than this angle are shaded as one smooth surface. */
const SMOOTH_DEG = 40;

/** A brush as a convex set of planes n·p ≤ d, with which face each plane is. */
export interface SolidPlanes { brushId: number; planes: { n: Axis; d: number; face: number }[]; min: Axis; max: Axis }

export function facePoint(f: Face, s: number, t: number, lift = 0): Axis {
  return [
    f.origin[0] + f.r[0] * s + f.u[0] * t + f.n[0] * lift,
    f.origin[1] + f.r[1] * s + f.u[1] * t + f.n[1] * lift,
    f.origin[2] + f.r[2] * s + f.u[2] * t + f.n[2] * lift,
  ];
}

/** A prism's local (a, b, w) → world, for its extrusion axis (cyclic, so handedness is kept). */
export function prismFrame(b: { axis?: 'x' | 'y' | 'z' }): (v: Axis) => Axis {
  if (b.axis === 'y') return (v) => [v[1], v[2], v[0]];
  if (b.axis === 'x') return (v) => [v[2], v[0], v[1]];
  return (v) => v;
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
  } else if (b.type === 'convex') {
    b.planes.forEach(([x, y, z, d], k) => planes.push({ n: [x, y, z], d, face: k }));
  } else {
    const pts = b.points;
    const W = prismFrame(b);
    pts.forEach(([x0, y0], k) => {
      const [x1, y1] = pts[(k + 1) % pts.length];
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      const n = W([(y1 - y0) / len, -(x1 - x0) / len, 0]); // outward for CCW
      const p0 = W([x0, y0, 0]);
      planes.push({ n, d: n[0] * p0[0] + n[1] * p0[1] + n[2] * p0[2], face: k });
    });
    planes.push({ n: W([0, 0, 1]), d: b.z1, face: pts.length }, { n: W([0, 0, -1]), d: -b.z0, face: pts.length + 1 });
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
  const ownOf = (b: BrushDef) => (b.type === 'box' ? boxFaces(b) : b.type === 'convex' ? convexFaces(b) : prismFaces(b));
  const drawn = (f: Face, b: BrushDef) => !(f.tex.startsWith('tools/') || b.group === 'clip');
  const all = brushes.map((b) => ({ b, own: ownOf(b) }));
  // What can hide a face: a solid brush that is itself seen. A brush with no drawn face at all (a clip brush, an
  // unseen ramp over a flight of steps) is not there to the eye, so what lies inside it still shows.
  const solids = all.filter(({ b, own }) => b.solid !== false && own.some((f) => drawn(f, b))).map(({ b }) => ({ b, s: solidPlanes(b) }));
  // Spatial hash of the solids, so a face only checks the brushes near it
  // (every face against every brush took ~9 s on a 6000-brush map).
  const CELL = 128, grid = new Map<string, typeof solids>();
  const cells = (lo: Axis, hi: Axis, f: (k: string) => void) => {
    for (let x = Math.floor(lo[0] / CELL); x <= Math.floor(hi[0] / CELL); x++)
      for (let y = Math.floor(lo[1] / CELL); y <= Math.floor(hi[1] / CELL); y++)
        for (let z = Math.floor(lo[2] / CELL); z <= Math.floor(hi[2] / CELL); z++) f(`${x},${y},${z}`);
  };
  for (const x of solids) cells(x.s.min, x.s.max, (k) => { const l = grid.get(k); if (l) l.push(x); else grid.set(k, [x]); });
  const faces: Face[] = [];
  for (const { b, own } of all) {
    for (const f of own) {
      // Tool faces (Source's nodraw, clip, skybox...) and clip brushes are never drawn or lit; they stay solid.
      if (!drawn(f, b)) continue;
      const a = facePoint(f, 0, 0, 0.5), c = facePoint(f, f.width, f.height, 0.5);
      const lo: Axis = [Math.min(a[0], c[0]) - 1, Math.min(a[1], c[1]) - 1, Math.min(a[2], c[2]) - 1];
      const hi: Axis = [Math.max(a[0], c[0]) + 1, Math.max(a[1], c[1]) + 1, Math.max(a[2], c[2]) + 1];
      const near = new Set<SolidPlanes>();
      cells(lo, hi, (k) => { for (const x of grid.get(k) ?? []) if (x.b !== b && x.s.max[0] >= lo[0] && x.s.min[0] <= hi[0] && x.s.max[1] >= lo[1] && x.s.min[1] <= hi[1] && x.s.max[2] >= lo[2] && x.s.min[2] <= hi[2]) near.add(x.s); });
      if (!isBuried(f, [...near])) faces.push(f);
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

/**
 * Faces of a convex brush: each plane's polygon. The face frame (r, u) is
 * taken from its texture's u axis when it has one (so lightmap luxels line up
 * with the texture, as in Source), else from the nearest axis-aligned frame.
 */
function convexFaces(b: ConvexBrushDef): Face[] {
  const out: Face[] = [];
  const solid = b.solid !== false;
  b.planes.forEach(([nx, ny, nz], k) => {
    const poly = sidePolygon(b.planes, k);
    if (poly.length < 3) return;
    const n: Axis = [nx, ny, nz];
    const ft = faceTex(b, String(k));
    const dom = Math.abs(nx) >= Math.abs(ny) && Math.abs(nx) >= Math.abs(nz) ? (nx > 0 ? 'px' : 'nx') : Math.abs(ny) >= Math.abs(nz) ? (ny > 0 ? 'py' : 'ny') : (nz > 0 ? 'pz' : 'nz');
    let r: Axis = ft.uaxis ? [ft.uaxis[0], ft.uaxis[1], ft.uaxis[2]] : [...FACE_FRAMES[dom as FaceKey].r];
    const rn = r[0] * n[0] + r[1] * n[1] + r[2] * n[2];
    r = [r[0] - rn * n[0], r[1] - rn * n[1], r[2] - rn * n[2]];
    let rl = Math.hypot(r[0], r[1], r[2]);
    if (rl < 1e-6) { r = [...FACE_FRAMES[dom as FaceKey].r]; rl = 1; }
    r = [r[0] / rl, r[1] / rl, r[2] / rl];
    const u: Axis = [n[1] * r[2] - n[2] * r[1], n[2] * r[0] - n[0] * r[2], n[0] * r[1] - n[1] * r[0]]; // r × u = n
    const S = poly.map((p) => p[0] * r[0] + p[1] * r[1] + p[2] * r[2]);
    const T = poly.map((p) => p[0] * u[0] + p[1] * u[1] + p[2] * u[2]);
    const s0 = Math.min(...S), t0 = Math.min(...T);
    const d = poly[0][0] * n[0] + poly[0][1] * n[1] + poly[0][2] * n[2];
    const origin: Axis = [0, 1, 2].map((i) => r[i] * s0 + u[i] * t0 + n[i] * d) as Axis;
    out.push({
      id: faceId(b.id, k), brushId: b.id, key: String(k), tex: ft.tex, scale: ft.scale, offset: ft.offset, rot: ft.rot,
      ...(ft.uaxis && ft.vaxis ? { ua: ft.uaxis, va: ft.vaxis } : {}),
      n, r, u, origin, width: Math.max(...S) - s0, height: Math.max(...T) - t0,
      poly: S.map((sv, i) => [sv - s0, T[i] - t0] as [number, number]),
      shade: 0.7 + 0.2 * Math.abs(n[1]) + 0.1 * Math.max(0, n[0]) + 0.1 * n[2], solid,
    });
  });
  return out;
}

function prismFaces(b: PrismBrushDef): Face[] {
  const out: Face[] = [];
  const pts = b.points;
  const h = b.z1 - b.z0;
  const solid = b.solid !== false;
  const W = prismFrame(b);
  const sideN = (k: number): Axis => {
    const [a0, b0] = pts[(k + pts.length) % pts.length], [a1, b1] = pts[(k + 1) % pts.length];
    const l = Math.hypot(a1 - a0, b1 - b0) || 1;
    return [(b1 - b0) / l, -(a1 - a0) / l, 0];
  };
  const cosSmooth = Math.cos((SMOOTH_DEG * Math.PI) / 180);
  const edgeN = (a: Axis, b: Axis): Axis => {
    if (a[0] * b[0] + a[1] * b[1] < cosSmooth) return a;
    const x = a[0] + b[0], y = a[1] + b[1], l = Math.hypot(x, y) || 1;
    return [x / l, y / l, 0];
  };
  pts.forEach(([x0, y0], k) => {
    const [x1, y1] = pts[(k + 1) % pts.length];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-6) return;
    const lr: Axis = [(x1 - x0) / len, (y1 - y0) / len, 0];
    const ln: Axis = [lr[1], -lr[0], 0];
    const nA = edgeN(ln, sideN(k - 1)), nB = edgeN(ln, sideN(k + 1));
    const smooth = nA !== ln || nB !== ln;
    const r = W(lr), n = W(ln);
    const ft = faceTex(b, `side${k}`);
    out.push({
      id: faceId(b.id, k), brushId: b.id, key: `side${k}`, tex: ft.tex, scale: ft.scale, offset: ft.offset, rot: ft.rot,
      n, r, u: W([0, 0, 1]), origin: W([x0, y0, b.z0]), width: len, height: h,
      shade: 0.7 + 0.2 * Math.abs(n[1]) + 0.1 * Math.max(0, n[0]) + 0.1 * n[2], solid,
      ...(smooth ? { nS: [W(nA), W(nB)] as [Axis, Axis] } : {}),
    });
  });
  if (b.axis === 'x' || b.axis === 'y') {
    // Ends of a sideways prism: polygons in the axial frame of their direction.
    for (const top of [true, false]) {
      const key = top ? 'pz' : 'nz'; // authoring keys: pz = the z1 end, nz = the z0 end
      const fr = FACE_FRAMES[(b.axis === 'x' ? (top ? 'px' : 'nx') : (top ? 'py' : 'ny')) as FaceKey];
      const w = top ? b.z1 : b.z0;
      const P = pts.map(([pa, pb]) => W([pa, pb, w]));
      const S = P.map((p) => p[0] * fr.r[0] + p[1] * fr.r[1] + p[2] * fr.r[2]);
      const T = P.map((p) => p[0] * fr.u[0] + p[1] * fr.u[1] + p[2] * fr.u[2]);
      const s0 = Math.min(...S), t0 = Math.min(...T);
      let poly = S.map((sv, i) => [sv - s0, T[i] - t0] as [number, number]);
      let area = 0;
      for (let i = 0; i < poly.length; i++) { const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length]; area += ax * by - bx * ay; }
      if (area < 0) poly = poly.reverse(); // counter-clockwise seen from outside
      const axisV = W([0, 0, 1]);
      const origin: Axis = [0, 1, 2].map((i) => fr.r[i] * s0 + fr.u[i] * t0 + axisV[i] * w) as Axis;
      const ft = faceTex(b, key);
      out.push({
        id: faceId(b.id, pts.length + (top ? 0 : 1)), brushId: b.id, key, tex: ft.tex, scale: ft.scale, offset: ft.offset, rot: ft.rot,
        n: fr.n, r: fr.r, u: fr.u, origin, width: Math.max(...S) - s0, height: Math.max(...T) - t0, poly, shade: fr.shade, solid,
      });
    }
    return out;
  }
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

export interface LightmapRect {
  x: number; y: number; w: number; h: number;
  /**
   * Source layout (engine/light/vrad.ts): luxel coordinate = p·lmS − minS (and t
   * likewise); `slots` lightmaps side by side (4 on bump-mapped faces).
   */
  src?: { lmS: Axis; lmT: Axis; minS: number; minT: number; slots: number };
}
export interface LightmapLayout { width: number; height: number; luxel: number; rects: Map<number, LightmapRect>; /** Source-lit (vrad.ts) */ source?: boolean }

/**
 * Give each face a block of luxels (lightmap pixels), one every `luxel` units
 * with samples on the face's edges, and pack the blocks into one atlas with a
 * simple shelf packer. 16 units per luxel is Source's default lightmap scale.
 */
export function layoutLightmap(faces: Face[], luxel: number, maxWidth = 2048, thin = 3): LightmapLayout {
  const items = faces.map((f) => {
    // Thin faces (baseboards, casing, girder flanges) get finer luxels ACROSS
    // so they have ~4 samples there, and keep the normal size along their
    // length (light along a 30' girder is smooth; fine luxels there only
    // bloated the atlas).
    const ls = Math.max(1, Math.min(luxel, f.width / thin)), lt = Math.max(1, Math.min(luxel, f.height / thin));
    return { id: f.id, w: Math.max(2, Math.ceil(f.width / ls) + 1), h: Math.max(2, Math.ceil(f.height / lt) + 1) };
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
