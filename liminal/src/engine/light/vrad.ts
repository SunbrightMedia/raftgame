/**
 * Source's light compiler (VRAD), reimplemented from Valve's public SDK 2013
 * (src/utils/vrad: lightmap.cpp, vrad.cpp, radial.cpp, vradstaticprops.cpp,
 * vraddetailprops.cpp; src/mathlib: mathlib_base.cpp, bumpvects.cpp, halton.cpp).
 * See docs/SOURCE_LIGHTING.md. Same inputs, same formulas, same units:
 *
 *  - lights parse their keys exactly as VRAD does (LightForString,
 *    SetLightFalloffParams, ParseLightSpot): gamma-to-linear colour × brightness,
 *    a quadratic solved through the 50% and 0% distances, hard falloff with a
 *    quintic fade, spot cones with a linear fringe raised to an exponent;
 *  - luxels sit on Source's grid: texture axes normalised ÷ lightmapscale,
 *    integer luxel coordinates, the sample at the centre of the part of the
 *    luxel inside the face, pushed 1 unit off it; luxels across a shadow edge
 *    are supersampled;
 *  - bounce is patch radiosity run to convergence (≤ 100 bounces, stops when a
 *    bounce adds < 1), patches chopped to under 4 luxels along each world axis,
 *    each bounce tinted by the texture's reflectivity (≤ 0.99). VRAD computes
 *    exact form factors between every visible patch pair; here each patch's
 *    view of the others is sampled once with cosine-distributed rays and
 *    reused by every bounce (the same transfer, estimated);
 *  - bump-mapped faces get the three extra lightmaps in Valve's HL2 basis;
 *  - only world and func_detail brushes cast shadows (brush entities, glass
 *    and tool brushes don't, as in VRAD).
 * Values are in VRAD's units divided by 255: 1.0 is the light a white surface
 * shows at full brightness (Source's linear lightmap value).
 *
 * Pure data in, numbers out (worker and test friendly).
 */
import { type Axis, type Face, type SolidPlanes, facePoint } from './faces';
import { SolidGrid } from './bake';

export type RGB = [number, number, number];

// ---------------------------------------------------------------- lights

export interface SourceLight {
  type: 'point' | 'spot' | 'surface';
  origin: Axis;
  /** Spot direction, or a surface light's facing. */
  normal: Axis;
  /** VRAD units (linear 0..255 × brightness/255). */
  intensity: RGB;
  constant: number;
  linear: number;
  quadratic: number;
  startFade: number;
  endFade: number;
  capDist: number;
  /** Cosines of the inner and outer cone. */
  stopdot: number;
  stopdot2: number;
  exponent: number;
  style: number;
}

const EQUAL_EPSILON = 0.001;
const DIST_EPSILON = 0.03125;

/** LightForString: "r g b brightness [r g b brightness HDR]" → linear intensity, or null if not a legal light. */
export function lightForString(s: string | undefined, hdr = true, lightscale = 1): RGB | null {
  if (s === undefined) return null;
  const v: number[] = [];
  for (const tok of s.trim().split(/\s+/)) {
    if (!tok || v.length === 8) break;
    const x = parseFloat(tok);
    if (Number.isNaN(x)) break;
    v.push(x);
  }
  let [r, g, b, scaler] = [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0];
  let argCnt = v.length;
  if (argCnt === 8) {
    if (hdr) [r, g, b, scaler] = [v[4], v[5], v[6], v[7]];
    argCnt = 4;
  }
  if (r < 0 || g < 0 || b < 0 || scaler < 0) return null;
  const lin = (c: number) => Math.pow(c / 255, 2.2) * 255;
  let out: RGB;
  if (argCnt === 1) out = [lin(r), lin(r), lin(r)];
  else if (argCnt === 3 || argCnt === 4) {
    out = [lin(r), lin(g), lin(b)];
    if (argCnt === 4) out = [out[0] * scaler / 255, out[1] * scaler / 255, out[2] * scaler / 255];
  } else return null;
  return [out[0] * lightscale, out[1] * lightscale, out[2] * lightscale];
}

/** mathlib SolveInverseQuadratic: y = a x² + b x + c through three points. */
function solveInverseQuadratic(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): [number, number, number] | null {
  const det = (x1 - x2) * (x1 - x3) * (x2 - x3);
  if (det === 0) return null;
  const a = (x3 * (-y1 + y2) + x2 * (y1 - y3) + x1 * (-y2 + y3)) / det;
  const b = (x3 * x3 * (y1 - y2) + x1 * x1 * (y2 - y3) + x2 * x2 * (-y1 + y3)) / det;
  const c = (x1 * x3 * (-x1 + x3) * y2 + x2 * x2 * (x3 * y1 - x1 * y3) + x2 * (-(x3 * x3 * y1) + x1 * x1 * y3)) / det;
  return [a, b, c];
}

/** mathlib SolveInverseQuadraticMonotonic: moves the middle point towards the line until the curve is monotonic. */
export function solveInverseQuadraticMonotonic(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): [number, number, number] | null {
  const p = [[x1, y1], [x2, y2], [x3, y3]].sort((u, w) => u[0] - w[0]);
  [[x1, y1], [x2, y2], [x3, y3]] = p;
  let abc: [number, number, number] | null = null;
  // (float accumulation, as the original's loop counter)
  for (let blend = 0; blend <= 1.0; blend = Math.fround(blend + Math.fround(0.05))) {
    const lerp = y1 + (y3 - y1) * (x2 - x1) / (x3 - x1);
    const ty2 = (1 - blend) * y2 + blend * lerp;
    abc = solveInverseQuadratic(x1, y1, x2, ty2, x3, y3);
    if (!abc) return null;
    const derivative = 2.0 * abc[0] + abc[1];
    if (y1 < y2 && y2 < y3) { if (derivative >= 0) return abc; }
    else if (y1 > y2 && y2 > y3) { if (derivative <= 0) return abc; }
    else return abc;
  }
  return abc;
}

type Keys = Record<string, string>;
const num = (k: Keys, key: string) => { const v = parseFloat(k[key] ?? ''); return Number.isFinite(v) ? v : 0; };
const int = (k: Keys, key: string) => { const v = parseInt(k[key] ?? '', 10); return Number.isFinite(v) ? v : 0; };
const vec = (s: string | undefined): Axis => { const v = (s ?? '').trim().split(/\s+/).map(Number); return [v[0] || 0, v[1] || 0, v[2] || 0]; };

/** map_utils SetupLightNormalFromProps. */
function lightNormal(angles: Axis, angle: number, pitch: number): Axis {
  let out: Axis;
  if (angle === -1) out = [0, 0, 1];
  else if (angle === -2) out = [0, 0, -1];
  else {
    if (!angle) angle = angles[1];
    out = [Math.cos(angle / 180 * Math.PI), Math.sin(angle / 180 * Math.PI), 0];
  }
  if (!pitch) pitch = angles[0];
  out[2] = Math.sin(pitch / 180 * Math.PI);
  out[0] *= Math.cos(pitch / 180 * Math.PI);
  out[1] *= Math.cos(pitch / 180 * Math.PI);
  return out;
}

/**
 * A light entity's keys (lower-case, as the VMF importer stores them) → a
 * VRAD direct light, or null for entities VRAD doesn't bake (light_dynamic).
 * light_environment (sun and sky) is not handled yet.
 */
export function parseSourceLight(keys: Keys, origin: Axis, hdr = true): SourceLight | null {
  const cls = keys.classname ?? 'light';
  if (cls !== 'light' && cls !== 'light_spot') return null;
  let intensity = (hdr ? lightForString(keys._lighthdr, hdr) : null) ?? lightForString(keys._light, hdr) ?? [0, 0, 0];
  if (hdr) {
    const s = keys._lightscalehdr !== undefined ? num(keys, '_lightscalehdr') : 1;
    intensity = [intensity[0] * s, intensity[1] * s, intensity[2] * s];
  }
  const L: SourceLight = {
    type: 'point', origin, normal: lightNormal(vec(keys.angles), num(keys, 'angle'), num(keys, 'pitch')), intensity,
    constant: 0, linear: 0, quadratic: 0, startFade: 0, endFade: -1, capDist: 1e22,
    stopdot: 0, stopdot2: 0, exponent: 0, style: Math.trunc(num(keys, 'style')),
  };
  if (cls === 'light_spot') {
    L.type = 'spot';
    let stop = num(keys, '_inner_cone') || 10;
    let stop2 = num(keys, '_cone') || stop;
    if (stop2 < stop) stop2 = stop;
    if (stop === 180 && stop2 === 180) { L.type = 'point'; }
    else {
      stop = Math.min(90, stop); stop2 = Math.min(90, stop2);
      L.stopdot2 = Math.fround(Math.cos(stop2 / 180 * Math.PI));
      L.stopdot = Math.fround(Math.cos(stop / 180 * Math.PI));
      L.exponent = num(keys, '_exponent');
    }
  }
  setFalloff(L, keys);
  return L;
}

/** SetLightFalloffParams. */
function setFalloff(L: SourceLight, keys: Keys): void {
  const d50 = num(keys, '_fifty_percent_distance');
  if (d50) {
    let d0 = num(keys, '_zero_percent_distance');
    if (d0 < d50) d0 = 2 * d50;
    let [a, b, c] = solveInverseQuadraticMonotonic(0, 1, d50, 2, d0, 256) ?? [0, 1, 0];
    const v50 = c + d50 * (b + d50 * a);
    const scale = 2 / v50;
    a *= scale; b *= scale; c *= scale;
    L.quadratic = a; L.linear = b; L.constant = c;
    if (int(keys, '_hardfalloff')) {
      L.endFade = d0;
      L.startFade = 0.75 * d0 + 0.25 * d50;
    } else if (Math.abs(a) > 0) {
      const flMax = b / (-2 * a);
      if (flMax > 0) { L.capDist = flMax; L.startFade = flMax; L.endFade = 10 * flMax; }
    }
  } else {
    L.constant = num(keys, '_constant_attn');
    L.linear = num(keys, '_linear_attn');
    L.quadratic = num(keys, '_quadratic_attn');
    if (L.constant < EQUAL_EPSILON) L.constant = 0;
    if (L.linear < EQUAL_EPSILON) L.linear = 0;
    if (L.quadratic < EQUAL_EPSILON) L.quadratic = 0;
    if (L.constant < EQUAL_EPSILON && L.linear < EQUAL_EPSILON && L.quadratic < EQUAL_EPSILON) L.constant = 1;
    const ratio = L.constant + 100 * L.linear + 100 * 100 * L.quadratic;
    if (ratio > 0) L.intensity = [L.intensity[0] * ratio, L.intensity[1] * ratio, L.intensity[2] * ratio];
  }
}

/**
 * GatherSampleStandardLight for one point: the light's falloff (incl. cone and
 * fade) and the cosine to each of `normals` (normals[0] the surface normal;
 * zero when the light is behind it or blocked). Returns falloff 0 when unlit.
 */
export function gatherSample(dl: SourceLight, px: number, py: number, pz: number, normals: Axis[], dots: number[], grid: SolidGrid | null): number {
  for (let i = 0; i < normals.length; i++) dots[i] = 0;
  let sx = dl.origin[0], sy = dl.origin[1], sz = dl.origin[2];
  let dx = sx - px, dy = sy - py, dz = sz - pz;
  const dist2 = dx * dx + dy * dy + dz * dz;
  let dist = Math.sqrt(dist2);
  const inv = dist > 0 ? 1 / dist : 0;
  dx *= inv; dy *= inv; dz *= inv;
  const n0 = normals[0];
  let dot = Math.max(0, dx * n0[0] + dy * n0[1] + dz * n0[2]);
  if (dot <= 0) return 0;
  const hard = dl.endFade > dl.startFade;
  if (hard && dist > dl.endFade) return 0;
  dist = Math.max(dist, 1);
  const e = Math.min(dist, dl.capDist);
  let falloff: number;
  if (dl.type === 'point') {
    falloff = 1 / (dl.constant + dl.linear * e + dl.quadratic * e * e);
  } else if (dl.type === 'surface') {
    const dot2 = Math.max(0, -(dx * dl.normal[0] + dy * dl.normal[1] + dz * dl.normal[2]));
    falloff = dot2 / dist2;
    sx += dl.normal[0] * DIST_EPSILON; sy += dl.normal[1] * DIST_EPSILON; sz += dl.normal[2] * DIST_EPSILON;
  } else {
    const dot2 = -(dx * dl.normal[0] + dy * dl.normal[1] + dz * dl.normal[2]);
    if (!(dot2 > dl.stopdot2)) return 0;
    falloff = dot2 / (dl.constant + dl.linear * e + dl.quadratic * e * e);
    if (dot2 <= dl.stopdot) {
      let mult = Math.min(1, Math.max(0, (dot2 - dl.stopdot2) / (dl.stopdot - dl.stopdot2)));
      if (dl.exponent !== 0 && dl.exponent !== 1) mult = Math.pow(mult, dl.exponent);
      falloff *= mult;
    }
  }
  if (hard) {
    let t = Math.min(1, Math.max(0, (dist - dl.startFade) / (dl.endFade - dl.startFade)));
    t = 1 - t;
    falloff *= t * t * t * (t * (t * 6 - 15) + 10);
  }
  if (falloff <= 0) return 0;
  if (grid && grid.occluded(px, py, pz, sx, sy, sz)) return 0;
  dots[0] = dot;
  for (let i = 1; i < normals.length; i++) {
    const n = normals[i];
    dots[i] = Math.max(0, dx * n[0] + dy * n[1] + dz * n[2]);
  }
  return falloff;
}

// ---------------------------------------------------------------- bump basis (bumpvects)

const OO_SQRT_2 = 0.70710676908493042, OO_SQRT_3 = 0.57735025882720947, OO_SQRT_6 = 0.40824821591377258, OO_SQRT_2_OVER_3 = 0.81649661064147949;
/** g_localBumpBasis: Valve's HL2 tangent-space basis. */
export const LOCAL_BUMP_BASIS: Axis[] = [[OO_SQRT_2_OVER_3, 0, OO_SQRT_3], [-OO_SQRT_6, OO_SQRT_2, OO_SQRT_3], [-OO_SQRT_6, -OO_SQRT_2, OO_SQRT_3]];

const cross = (a: Axis, b: Axis): Axis => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: Axis, b: Axis) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (a: Axis): Axis => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * GetBumpNormals: the face's tangent frame (from texture axes s, t) and the
 * three world-space bump normals. frame[0] ≈ s, frame[1] ≈ t, frame[2] = n.
 */
export function bumpFrame(s: Axis, t: Axis, flat: Axis, phong: Axis = flat): { frame: [Axis, Axis, Axis]; normals: Axis[] } {
  const leftHanded = dot3(flat, cross(s, t)) < 0;
  let b1 = normalize(cross(phong, s));
  const b0 = normalize(cross(b1, phong));
  if (leftHanded) b1 = [-b1[0], -b1[1], -b1[2]];
  const frame: [Axis, Axis, Axis] = [b0, b1, phong];
  const normals = LOCAL_BUMP_BASIS.map((v) => [0, 1, 2].map((k) => v[0] * b0[k] + v[1] * b1[k] + v[2] * phong[k]) as Axis);
  return { frame, normals };
}

// ---------------------------------------------------------------- luxel grid

/** Where a face's luxels are: Source's lightmap axes and the face's extent on them. */
export interface SourceFaceGrid {
  /** Luxels per world unit along s and t (texture axes normalised ÷ lightmapscale). */
  lmS: Axis;
  lmT: Axis;
  /** Luxel coordinate of luxel 0 (floor of the face's minimum). */
  minS: number;
  minT: number;
  /** Luxels along s and t. */
  w: number;
  h: number;
}

/** The face as a 3D polygon. */
export function facePolygon(f: Face): Axis[] {
  const o: [number, number][] = f.poly ?? [[0, 0], [f.width, 0], [f.width, f.height], [0, f.height]];
  return o.map(([s, t]) => facePoint(f, s, t));
}

/** CalcFaceExtents for a face with Source texture axes (falls back to the face frame). */
export function sourceFaceGrid(f: Face, lightmapscale = 16): SourceFaceGrid {
  const sa: Axis = f.ua ? normalize([f.ua[0], f.ua[1], f.ua[2]]) : f.r;
  const ta: Axis = f.va ? normalize([f.va[0], f.va[1], f.va[2]]) : [-f.u[0], -f.u[1], -f.u[2]];
  const lmS: Axis = [sa[0] / lightmapscale, sa[1] / lightmapscale, sa[2] / lightmapscale];
  const lmT: Axis = [ta[0] / lightmapscale, ta[1] / lightmapscale, ta[2] / lightmapscale];
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (const p of facePolygon(f)) {
    const s = dot3(p, lmS), t = dot3(p, lmT);
    s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
  }
  const minS = Math.floor(s0 + 1e-4), minT = Math.floor(t0 + 1e-4);
  return { lmS, lmT, minS, minT, w: Math.ceil(s1 - 1e-4) - minS + 1, h: Math.ceil(t1 - 1e-4) - minT + 1 };
}

/** Solve p on the face plane with p·lmS = s, p·lmT = t. */
function luxelToWorld(g: SourceFaceGrid, n: Axis, d: number): (s: number, t: number) => Axis {
  // Rows: lmS, lmT, n. Inverse by cofactors.
  const a = g.lmS, b = g.lmT, c = n;
  const det = dot3(a, cross(b, c));
  const i0 = cross(b, c), i1 = cross(c, a), i2 = cross(a, b);
  return (s, t) => [0, 1, 2].map((k) => (s * i0[k] + t * i1[k] + d * i2[k]) / det) as Axis;
}

/** Clip a 3D polygon to n·p ≤ d. */
function clipPoly(poly: Axis[], n: Axis, d: number): Axis[] {
  const out: Axis[] = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length];
    const da = dot3(n, a) - d, db = dot3(n, b) - d;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}

/** Area and centroid of a planar polygon. */
function areaCentroid(poly: Axis[], n: Axis): { area: number; c: Axis } {
  let area = 0;
  const c: Axis = [0, 0, 0];
  const o = poly[0];
  for (let k = 1; k + 1 < poly.length; k++) {
    const a = poly[k], b = poly[k + 1];
    const ar = dot3(cross([a[0] - o[0], a[1] - o[1], a[2] - o[2]], [b[0] - o[0], b[1] - o[1], b[2] - o[2]]), n) / 2;
    area += ar;
    for (let i = 0; i < 3; i++) c[i] += ar * (o[i] + a[i] + b[i]) / 3;
  }
  if (Math.abs(area) < 1e-9) return { area: 0, c: poly[0] ?? [0, 0, 0] };
  return { area: Math.abs(area), c: [c[0] / area, c[1] / area, c[2] / area] };
}

// ---------------------------------------------------------------- the bake

/** Widest lightmap atlas (texels). */
export const SOURCE_LM_WIDTH = 4096;

export interface SourceBakeFace {
  /** Face.id */
  id: number;
  lightmapscale: number;
  /** Has a normal map: three more lightmaps in the bump basis. */
  bump: boolean;
  /** Linear reflectivity (VTF header), for bounce. */
  reflectivity: RGB;
  /** lights.rad value of its texture (LightForString), for texture lights. */
  texlight?: RGB;
  /** Texels per world unit along s and t (|texture axis| ÷ scale) and the texture's size, for texture lights. */
  texScale?: [number, number];
  texSize?: [number, number];
  /** Receives light but takes no part in the bounce (overlays: Source draws them with the face below's lightmap). */
  receiveOnly?: boolean;
  /** Sky: no lightmap, absorbs every bounce. */
  sky?: boolean;
}

export interface SourceBakeInput {
  faces: Face[];
  info: SourceBakeFace[];
  /** Shadow casters: world and func_detail brushes that aren't see-through. */
  occluders: SolidPlanes[];
  lights: SourceLight[];
  params: {
    /** VRAD -bounce (default 100). */
    bounces: number;
    /** Rays each patch uses to find what it sees (the transfers). */
    patchRays: number;
    /** VRAD -chop: patch size in luxels (default 4). */
    chop: number;
    /** Supersample luxels across shadow edges (VRAD's default; off for quick previews). */
    supersample: boolean;
    maxWidth: number;
  };
  /** Progress notes (stage, elapsed ms). */
  log?: (msg: string) => void;
}

export interface SourceLayoutRect {
  x: number;
  y: number;
  /** Luxels of one lightmap; bumped faces hold four side by side (flat, then the bump basis). */
  w: number;
  h: number;
  slots: number;
  grid: SourceFaceGrid;
}

export interface SourceBakeOutput {
  width: number;
  height: number;
  /** RGBA float, Source linear light (VRAD value ÷ 255). */
  pixels: Float32Array;
  rects: [number, SourceLayoutRect][];
  ms: number;
  luxels: number;
  patches: number;
  bounces: number;
  /** Average light per face (for prop indirect lighting, Source's dface average colour). */
  faceAverage: [number, RGB][];
}

interface Lux {
  f: Face;
  info: SourceBakeFace;
  grid: SourceFaceGrid;
  rect: SourceLayoutRect;
  toWorld: (s: number, t: number) => Axis;
  normals: Axis[];
  /** Per luxel: sample position (lifted 1 unit), sample area, valid. */
  pos: Float64Array;
  area: Float32Array;
  valid: Uint8Array;
  /** Direct light per normal (slots × w × h × 3). */
  direct: Float32Array;
}

interface Patch {
  face: number; // index into lux
  origin: Axis;
  normal: Axis;
  area: number;
  min: Axis;
  max: Axis;
  reflectivity: RGB;
  /** Direct light (samples ≥ 1 only, area-weighted, as AddSampleToPatch). */
  sampleArea: number;
  sampleLight: RGB;
  /** Hit list (patch indices, -1 = nothing) and, for bumped patches, the weight per bump normal. */
  hits: Int32Array;
  bumpW?: Float32Array;
}

/** Shelf-pack rects (tallest first). */
function pack(items: { id: number; w: number; h: number }[], maxWidth: number): { width: number; height: number; at: Map<number, [number, number]> } {
  const sorted = [...items].sort((a, b) => b.h - a.h || b.w - a.w);
  const total = sorted.reduce((s, i) => s + i.w * i.h, 0);
  const width = Math.min(maxWidth, Math.max(256, 2 ** Math.ceil(Math.log2(Math.sqrt(total) * 1.15))));
  const at = new Map<number, [number, number]>();
  let x = 0, y = 0, shelf = 0;
  for (const it of sorted) {
    if (x + it.w > width) { x = 0; y += shelf; shelf = 0; }
    at.set(it.id, [x, y]);
    x += it.w;
    shelf = Math.max(shelf, it.h);
  }
  return { width, height: Math.max(1, y + shelf), at };
}

/** The Source lightmap layout alone (renderer needs it before a bake finishes; same as the bake's). */
export function sourceLayout(faces: Face[], info: SourceBakeFace[], maxWidth: number): { width: number; height: number; rects: Map<number, SourceLayoutRect> } {
  const byId = new Map(info.map((i) => [i.id, i]));
  const items: { id: number; w: number; h: number; grid: SourceFaceGrid; slots: number }[] = [];
  for (const f of faces) {
    const fi = byId.get(f.id);
    if (!fi || fi.sky) continue;
    const grid = sourceFaceGrid(f, fi.lightmapscale);
    const slots = fi.bump ? 4 : 1;
    items.push({ id: f.id, w: grid.w * slots, h: grid.h, grid, slots });
  }
  const p = pack(items, maxWidth);
  const rects = new Map<number, SourceLayoutRect>();
  for (const it of items) {
    const [x, y] = p.at.get(it.id)!;
    rects.set(it.id, { x, y, w: it.grid.w, h: it.grid.h, slots: it.slots, grid: it.grid });
  }
  return { width: p.width, height: p.height, rects };
}

/** Halton radical inverse (mathlib halton.cpp: the generator's seed is already advanced). */
function halton(seed: number, base: number): number {
  let r = 0, f = 1 / base, s = seed;
  while (s) { r += (s % base) * f; f /= base; s = Math.floor(s / base); }
  return r;
}

export function bakeSource(input: SourceBakeInput): SourceBakeOutput {
  const t0 = Date.now();
  const P = input.params;
  const grid = new SolidGrid(input.occluders);
  const layout = sourceLayout(input.faces, input.info, P.maxWidth);
  const infoById = new Map(input.info.map((i) => [i.id, i]));
  const log = (m: string) => input.log?.(`${m} (${Date.now() - t0} ms)`);

  // ---- luxels and their sample points (BuildFacesamples / CalcPoints)
  const lux: Lux[] = [];
  const luxByFace = new Map<number, number>();
  let luxels = 0;
  for (const f of input.faces) {
    const rect = layout.rects.get(f.id);
    const info = infoById.get(f.id);
    if (!rect || !info) continue;
    const g = rect.grid;
    const d = dot3(f.n, f.origin);
    const toWorld = luxelToWorld(g, f.n, d);
    const poly = facePolygon(f);
    const n = g.w * g.h;
    luxels += n * rect.slots;
    const s = info.bump ? bumpFrame(f.ua ? [f.ua[0], f.ua[1], f.ua[2]] : f.r, f.va ? [f.va[0], f.va[1], f.va[2]] : [-f.u[0], -f.u[1], -f.u[2]], f.n) : null;
    const L: Lux = {
      f, info, grid: g, rect, toWorld, normals: s ? [f.n, ...s.normals] : [f.n],
      pos: new Float64Array(n * 3), area: new Float32Array(n), valid: new Uint8Array(n),
      direct: new Float32Array(n * 3 * rect.slots),
    };
    // Luxel (i, j) covers luxel coordinates [min+i-0.5, min+i+0.5]: clip the face to it.
    const sN = normalize(g.lmS), tN = normalize(g.lmT);
    const sL = Math.hypot(...g.lmS), tL = Math.hypot(...g.lmT);
    for (let j = 0; j < g.h; j++) {
      for (let i = 0; i < g.w; i++) {
        const cs = g.minS + i, ct = g.minT + j;
        let pp = clipPoly(poly, sN, (cs + 0.5) / sL);
        pp = clipPoly(pp, [-sN[0], -sN[1], -sN[2]], -(cs - 0.5) / sL);
        pp = clipPoly(pp, tN, (ct + 0.5) / tL);
        pp = clipPoly(pp, [-tN[0], -tN[1], -tN[2]], -(ct - 0.5) / tL);
        const k = j * g.w + i;
        const ac = pp.length >= 3 ? areaCentroid(pp, f.n) : { area: 0, c: toWorld(cs, ct) };
        const q: Axis = [ac.c[0] + f.n[0], ac.c[1] + f.n[1], ac.c[2] + f.n[2]];
        L.pos[k * 3] = q[0]; L.pos[k * 3 + 1] = q[1]; L.pos[k * 3 + 2] = q[2];
        L.area[k] = ac.area;
        L.valid[k] = ac.area > 1e-3 && !grid.inside(q) ? 1 : 0;
      }
    }
    luxByFace.set(f.id, lux.length);
    lux.push(L);
  }

  log(`luxels: ${luxels}`);
  // ---- patches (MakePatchForFace + SubdividePatch): chopped along the widest world axis at the middle
  const patches: Patch[] = [];
  const facePatches: number[][] = lux.map(() => []);
  const chop = Math.max(1, P.chop);
  for (let fi = 0; fi < lux.length; fi++) {
    const L = lux[fi];
    if (L.info.sky || L.info.receiveOnly) continue;
    const luxscale = 1 / L.info.lightmapscale;
    const refl = L.info.reflectivity.map((r) => Math.min(0.99, r)) as RGB;
    const split = (w: Axis[], chopNow: number) => {
      const min: Axis = [Infinity, Infinity, Infinity], max: Axis = [-Infinity, -Infinity, -Infinity];
      for (const p of w) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
      const total = [0, 1, 2].map((i) => (max[i] - min[i]) * luxscale);
      let widest = 0, sub = false;
      for (let i = 0; i < 3; i++) {
        if (total[i] > total[widest]) widest = i;
        if (total[i] >= chopNow && total[i] >= chop) sub = true;
      }
      if (!sub && total[widest] > total[(widest + 1) % 3] * 2 && total[widest] > total[(widest + 2) % 3] * 2 && chopNow > chop) {
        sub = true; chopNow = Math.max(chop, chopNow / 2);
      }
      if (sub) {
        const axis: Axis = [0, 0, 0]; axis[widest] = 1;
        const mid = (min[widest] + max[widest]) / 2;
        const a = clipPoly(w, axis, mid), b = clipPoly(w, [-axis[0], -axis[1], -axis[2]], -mid);
        if (a.length >= 3 && b.length >= 3 && areaCentroid(a, L.f.n).area > 0 && areaCentroid(b, L.f.n).area > 0) {
          split(a, chopNow); split(b, chopNow);
          return;
        }
      }
      const ac = areaCentroid(w, L.f.n);
      if (ac.area <= 0) return;
      // Buried under another brush (VBSP's CSG would have cut it away): nobody sees it.
      if (grid.inside([ac.c[0] + L.f.n[0] * 0.5, ac.c[1] + L.f.n[1] * 0.5, ac.c[2] + L.f.n[2] * 0.5])) return;
      facePatches[fi].push(patches.length);
      patches.push({ face: fi, origin: ac.c, normal: L.f.n, area: ac.area, min, max, reflectivity: refl, sampleArea: 0, sampleLight: [0, 0, 0], hits: new Int32Array(0) });
    };
    split(facePolygon(L.f), chop);
  }

  log(`patches: ${patches.length}`);
  // ---- texture lights (CreateDirectLights, emit_surface): one direct light per patch of a lights.rad texture
  const lights = [...input.lights];
  for (const p of patches) {
    const info = lux[p.face].info;
    if (!info.texlight || !info.texScale || !info.texSize) continue;
    const avg = (info.texlight[0] + info.texlight[1] + info.texlight[2]) / 3;
    if (avg < 0.1) continue; // dlight_threshold
    const k = p.area * info.texScale[0] * info.texScale[1] / (info.texSize[0] * info.texSize[1]) * 100 * 100;
    lights.push({
      type: 'surface', origin: p.origin, normal: p.normal, intensity: [info.texlight[0] * k, info.texlight[1] * k, info.texlight[2] * k],
      constant: 0, linear: 0, quadratic: 0, startFade: 0, endFade: -1, capDist: 1e22, stopdot: 0, stopdot2: 0, exponent: 0, style: 0,
    });
  }

  // Which lights can reach a face at all (in front of it; hard falloff limits range).
  const reach = (L: Lux, dl: SourceLight) => {
    const side = dot3([dl.origin[0] - L.f.origin[0], dl.origin[1] - L.f.origin[1], dl.origin[2] - L.f.origin[2]], L.f.n);
    if (side <= 0) return false;
    if (dl.endFade > dl.startFade) {
      // distance from the light to the face's bounds
      const poly = facePolygon(L.f);
      let d2 = 0;
      for (let i = 0; i < 3; i++) {
        const lo = Math.min(...poly.map((p) => p[i])), hi = Math.max(...poly.map((p) => p[i]));
        const v = dl.origin[i] < lo ? lo - dl.origin[i] : dl.origin[i] > hi ? dl.origin[i] - hi : 0;
        d2 += v * v;
      }
      if (d2 > dl.endFade * dl.endFade) return false;
    }
    return true;
  };

  // ---- direct light at the luxels (GatherSampleLightAt4Points), supersampled across edges
  const dots = [0, 0, 0, 0];
  const sampleAt = (L: Lux, cand: SourceLight[], x: number, y: number, z: number, out: Float64Array) => {
    out.fill(0);
    for (const dl of cand) {
      const fo = gatherSample(dl, x, y, z, L.normals, dots, grid);
      if (fo <= 0) continue;
      for (let b = 0; b < L.normals.length; b++) {
        const w = fo * dots[b];
        if (w <= 0) continue;
        out[b * 3] += w * dl.intensity[0]; out[b * 3 + 1] += w * dl.intensity[1]; out[b * 3 + 2] += w * dl.intensity[2];
      }
    }
  };
  const acc = new Float64Array(12), one = new Float64Array(12);
  for (const L of lux) {
    if (L.info.sky) continue;
    const cand = lights.filter((dl) => reach(L, dl));
    if (!cand.length) continue;
    const g = L.grid, S = L.rect.slots, n = g.w * g.h;
    for (let k = 0; k < n; k++) {
      if (!L.valid[k]) continue;
      sampleAt(L, cand, L.pos[k * 3], L.pos[k * 3 + 1], L.pos[k * 3 + 2], one);
      for (let b = 0; b < S; b++) for (let c = 0; c < 3; c++) L.direct[(b * n + k) * 3 + c] = one[b * 3 + c];
    }
    if (!P.supersample) continue;
    // Luxels whose light differs a lot from a neighbour's straddle a shadow or fade edge: average 4×4 points over the luxel.
    const lum = (k: number) => L.direct[k * 3] + L.direct[k * 3 + 1] + L.direct[k * 3 + 2];
    const redo: number[] = [];
    for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
      const k = j * g.w + i;
      if (!L.valid[k]) continue;
      const a = lum(k);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= g.w || jj >= g.h || !L.valid[jj * g.w + ii]) continue;
        const b = lum(jj * g.w + ii);
        if (Math.abs(a - b) > 3 && Math.abs(a - b) > 0.1 * Math.max(a, b)) { redo.push(k); break; }
      }
    }
    for (const k of redo) {
      acc.fill(0);
      let m = 0;
      const i = k % g.w, j = Math.floor(k / g.w);
      for (let sj = 0; sj < 4; sj++) for (let si = 0; si < 4; si++) {
        const p = L.toWorld(g.minS + i - 0.375 + si * 0.25, g.minT + j - 0.375 + sj * 0.25);
        const x = p[0] + L.f.n[0], y = p[1] + L.f.n[1], z = p[2] + L.f.n[2];
        if (grid.inside([x, y, z])) continue;
        sampleAt(L, cand, x, y, z, one);
        for (let c = 0; c < S * 3; c++) acc[c] += one[c];
        m++;
      }
      if (!m) continue;
      for (let b = 0; b < S; b++) for (let c = 0; c < 3; c++) L.direct[(b * n + k) * 3 + c] = acc[b * 3 + c] / m;
    }
  }

  log('direct light');
  // ---- transfers: what each patch sees, by cosine-distributed rays (stands in for VRAD's form factors)
  // Each face's patches indexed on a grid in the face's own (right, up) frame, for ray hits and the final blend.
  const CELL = 32;
  const index = facePatches.map((list, fi) => {
    if (list.length <= 8) return null;
    const f = lux[fi].f;
    const st = (x: number, y: number, z: number): [number, number] => {
      const dx = x - f.origin[0], dy = y - f.origin[1], dz = z - f.origin[2];
      return [dx * f.r[0] + dy * f.r[1] + dz * f.r[2], dx * f.u[0] + dy * f.u[1] + dz * f.u[2]];
    };
    const nx = Math.max(1, Math.ceil(f.width / CELL) + 1), ny = Math.max(1, Math.ceil(f.height / CELL) + 1);
    const cells: number[][] = Array.from({ length: nx * ny }, () => []);
    const ci = (v: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(v / CELL)));
    for (const pi of list) {
      const p = patches[pi];
      let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
      for (let c = 0; c < 8; c++) {
        const [a, b] = st(c & 1 ? p.max[0] : p.min[0], c & 2 ? p.max[1] : p.min[1], c & 4 ? p.max[2] : p.min[2]);
        s0 = Math.min(s0, a); s1 = Math.max(s1, a); t0 = Math.min(t0, b); t1 = Math.max(t1, b);
      }
      for (let y = ci(t0 - 1, ny); y <= ci(t1 + 1, ny); y++) for (let x = ci(s0 - 1, nx); x <= ci(s1 + 1, nx); x++) cells[y * nx + x].push(pi);
    }
    return { st, nx, ny, cells, ci };
  });
  /** The face's patches near a point (within `r` along the face). */
  const nearPatches = (fi: number, x: number, y: number, z: number, r: number): number[] => {
    const ix = index[fi];
    if (!ix) return facePatches[fi];
    const [a, b] = ix.st(x, y, z);
    if (r <= 0) return ix.cells[ix.ci(b, ix.ny) * ix.nx + ix.ci(a, ix.nx)];
    const out = new Set<number>();
    for (let yy = ix.ci(b - r, ix.ny); yy <= ix.ci(b + r, ix.ny); yy++) for (let xx = ix.ci(a - r, ix.nx); xx <= ix.ci(a + r, ix.nx); xx++) for (const pi of ix.cells[yy * ix.nx + xx]) out.add(pi);
    return [...out];
  };
  const patchAt = (fi: number, x: number, y: number, z: number): number => {
    let list = nearPatches(fi, x, y, z, 0);
    if (!list.length) list = facePatches[fi];
    let best = -1, bd = Infinity;
    for (const pi of list) {
      const p = patches[pi];
      const dx = x < p.min[0] ? p.min[0] - x : x > p.max[0] ? x - p.max[0] : 0;
      const dy = y < p.min[1] ? p.min[1] - y : y > p.max[1] ? y - p.max[1] : 0;
      const dz = z < p.min[2] ? p.min[2] - z : z > p.max[2] ? z - p.max[2] : 0;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = pi; if (d === 0) break; }
    }
    return best;
  };
  // ---- patch direct light (AddSampleToPatch / BuildPatchLights): samples averaging ≥ 1, area-weighted
  for (let fi = 0; fi < lux.length; fi++) {
    const L = lux[fi], list = facePatches[fi];
    if (!list.length) continue;
    const g = L.grid;
    for (let k = 0; k < g.w * g.h; k++) {
      if (!L.valid[k]) continue;
      const r = L.direct[k * 3], gg = L.direct[k * 3 + 1], b = L.direct[k * 3 + 2];
      if ((r + gg + b) / 3 < 1) continue;
      const x = L.pos[k * 3] - L.f.n[0], y = L.pos[k * 3 + 1] - L.f.n[1], z = L.pos[k * 3 + 2] - L.f.n[2];
      const rad = Math.sqrt(L.area[k]) / 2;
      for (const pi of nearPatches(fi, x, y, z, rad)) {
        const p = patches[pi];
        if (p.min[0] > x + rad || p.max[0] < x - rad || p.min[1] > y + rad || p.max[1] < y - rad || p.min[2] > z + rad || p.max[2] < z - rad) continue;
        p.sampleArea += L.area[k];
        p.sampleLight[0] += L.area[k] * r; p.sampleLight[1] += L.area[k] * gg; p.sampleLight[2] += L.area[k] * b;
      }
    }
  }

  const K = Math.max(8, Math.round(P.patchRays));
  // Stratified cosine-weighted directions (local frame), the same set for every patch, rotated per patch.
  const side = Math.ceil(Math.sqrt(K));
  const local: Axis[] = [];
  for (let a = 0; a < side; a++) for (let b = 0; b < side; b++) {
    if (local.length >= K) break;
    const u1 = (a + halton(local.length + 1, 2)) / side, u2 = (b + halton(local.length + 1, 3)) / side;
    const r = Math.sqrt(u1), phi = 2 * Math.PI * u2;
    local.push([r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(Math.max(0, 1 - u1))]);
  }
  const FAR = 65536;
  for (let pi = 0; pi < patches.length; pi++) {
    const p = patches[pi];
    const L = lux[p.face];
    const n = p.normal;
    const t1 = normalize(Math.abs(n[2]) < 0.9 ? cross([0, 0, 1], n) : cross([1, 0, 0], n));
    const t2 = cross(n, t1);
    const ox = p.origin[0] + n[0] * 0.5, oy = p.origin[1] + n[1] * 0.5, oz = p.origin[2] + n[2] * 0.5;
    const hits = new Int32Array(local.length).fill(-1);
    const bumped = L.info.bump;
    const bw = bumped ? new Float32Array(local.length * 3) : undefined;
    const rot = halton(pi + 1, 5) * 2 * Math.PI, cr = Math.cos(rot), sr = Math.sin(rot);
    for (let k = 0; k < local.length; k++) {
      const [lx0, ly0, lz] = local[k];
      const lx = lx0 * cr - ly0 * sr, ly = lx0 * sr + ly0 * cr;
      const dx = t1[0] * lx + t2[0] * ly + n[0] * lz, dy = t1[1] * lx + t2[1] * ly + n[1] * lz, dz = t1[2] * lx + t2[2] * ly + n[2] * lz;
      if (bw) {
        // GatherLight (bumped): the share of this direction for each bump normal, ÷ cos to the flat normal.
        for (let b = 0; b < 3; b++) {
          const bn = L.normals[b + 1];
          bw[k * 3 + b] = Math.max(0, dx * bn[0] + dy * bn[1] + dz * bn[2]) / Math.max(1e-4, lz);
        }
      }
      const hit = grid.cast(ox, oy, oz, dx * FAR, dy * FAR, dz * FAR);
      if (!hit) continue;
      const li = luxByFace.get(hit.faceId);
      if (li === undefined || lux[li].info.sky) continue;
      const t = hit.t * FAR;
      hits[k] = patchAt(li, ox + dx * t, oy + dy * t, oz + dz * t);
    }
    p.hits = hits;
    p.bumpW = bw;
  }

  log('transfers');
  // ---- bounce (BounceLight / GatherLight / CollectLight)
  const N = patches.length;
  const emit = new Float32Array(N * 3);
  const total = new Float32Array(N * 3);    // bounced light received (flat)
  const totalB = new Float32Array(N * 9);   // bounced light per bump normal
  for (let i = 0; i < N; i++) {
    const p = patches[i];
    if (p.sampleArea > 0) for (let c = 0; c < 3; c++) emit[i * 3 + c] = p.sampleLight[c] / p.sampleArea;
  }
  const add = new Float32Array(N * 3), addB = new Float32Array(N * 9);
  let bounces = 0;
  for (let it = 0; it < P.bounces; it++) {
    add.fill(0); addB.fill(0);
    for (let i = 0; i < N; i++) {
      const p = patches[i], hits = p.hits, m = hits.length;
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < m; k++) {
        const j = hits[k];
        if (j < 0) continue;
        const q = patches[j];
        const er = emit[j * 3] * q.reflectivity[0], eg = emit[j * 3 + 1] * q.reflectivity[1], eb = emit[j * 3 + 2] * q.reflectivity[2];
        r += er; g += eg; b += eb;
        if (p.bumpW) for (let s = 0; s < 3; s++) {
          const w = p.bumpW[k * 3 + s];
          addB[i * 9 + s * 3] += er * w; addB[i * 9 + s * 3 + 1] += eg * w; addB[i * 9 + s * 3 + 2] += eb * w;
        }
      }
      add[i * 3] = r / m; add[i * 3 + 1] = g / m; add[i * 3 + 2] = b / m;
      if (p.bumpW) for (let s = 0; s < 9; s++) addB[i * 9 + s] /= m;
    }
    let ar = 0, ag = 0, ab = 0;
    for (let i = 0; i < N; i++) {
      for (let c = 0; c < 3; c++) total[i * 3 + c] += add[i * 3 + c];
      for (let s = 0; s < 9; s++) totalB[i * 9 + s] += addB[i * 9 + s];
      emit[i * 3] = add[i * 3]; emit[i * 3 + 1] = add[i * 3 + 1]; emit[i * 3 + 2] = add[i * 3 + 2];
      ar += add[i * 3]; ag += add[i * 3 + 1]; ab += add[i * 3 + 2];
    }
    bounces = it + 1;
    if (ar < 1 && ag < 1 && ab < 1) break;
  }

  log(`bounced ×${bounces}`);
  // ---- final luxels (FinalLightFace): direct + bounce interpolated from the face's patches (radial blend)
  const W = layout.width, H = layout.height;
  const pixels = new Float32Array(W * H * 4);
  const faceAverage: [number, RGB][] = [];
  for (let fi = 0; fi < lux.length; fi++) {
    const L = lux[fi];
    const g = L.grid, S = L.rect.slots, n = g.w * g.h;
    const list = facePatches[fi];
    const rad2 = list.length ? Math.max(...list.map((pi) => { const p = patches[pi]; return (p.max[0] - p.min[0]) ** 2 + (p.max[1] - p.min[1]) ** 2 + (p.max[2] - p.min[2]) ** 2; })) : 0;
    const out = new Float32Array(n * 3 * S);
    for (let k = 0; k < n; k++) {
      // Invalid luxels take a valid neighbour's light below; their bounce is still interpolated.
      const x = L.pos[k * 3] - L.f.n[0], y = L.pos[k * 3 + 1] - L.f.n[1], z = L.pos[k * 3 + 2] - L.f.n[2];
      const ind = new Float64Array(3 * S);
      let wsum = 0;
      for (const pi of nearPatches(fi, x, y, z, Math.sqrt(rad2))) {
        const p = patches[pi];
        const d2 = (p.origin[0] - x) ** 2 + (p.origin[1] - y) ** 2 + (p.origin[2] - z) ** 2;
        const w = 1 - d2 / rad2;
        if (w <= 0) continue;
        wsum += w;
        for (let c = 0; c < 3; c++) ind[c] += w * total[pi * 3 + c];
        if (S === 4) for (let s = 0; s < 9; s++) ind[3 + s] += w * totalB[pi * 9 + s];
      }
      if (wsum <= 0 && list.length) {
        const pi = patchAt(fi, x, y, z);
        for (let c = 0; c < 3; c++) ind[c] = total[pi * 3 + c];
        if (S === 4) for (let s = 0; s < 9; s++) ind[3 + s] = totalB[pi * 9 + s];
        wsum = 1;
      }
      for (let b = 0; b < S; b++) for (let c = 0; c < 3; c++) {
        out[(b * n + k) * 3 + c] = L.direct[(b * n + k) * 3 + c] + (wsum > 0 ? ind[b * 3 + c] / wsum : 0);
      }
    }
    // Luxels outside the face or inside a solid: copy the nearest valid luxel's light (they're only seen at edges, filtered).
    dilateSlots(out, g.w, g.h, S, L.valid);
    let avg: RGB = [0, 0, 0], cnt = 0;
    for (let k = 0; k < n; k++) if (L.valid[k]) { avg = [avg[0] + out[k * 3], avg[1] + out[k * 3 + 1], avg[2] + out[k * 3 + 2]]; cnt++; }
    faceAverage.push([L.f.id, cnt ? [avg[0] / cnt / 255, avg[1] / cnt / 255, avg[2] / cnt / 255] : [0, 0, 0]]);
    for (let b = 0; b < S; b++) for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
      const k = j * g.w + i, o = ((L.rect.y + j) * W + L.rect.x + b * g.w + i) * 4;
      pixels[o] = out[(b * n + k) * 3] / 255;
      pixels[o + 1] = out[(b * n + k) * 3 + 1] / 255;
      pixels[o + 2] = out[(b * n + k) * 3 + 2] / 255;
      pixels[o + 3] = 1;
    }
  }

  return {
    width: W, height: H, pixels, rects: [...layout.rects], ms: Date.now() - t0, luxels, patches: patches.length, bounces, faceAverage,
  };
}

/** Fill invalid luxels from valid neighbours (repeated rings), every slot alike. */
function dilateSlots(buf: Float32Array, w: number, h: number, slots: number, valid: Uint8Array): void {
  const n = w * h;
  const ok = Uint8Array.from(valid);
  if (!ok.some((v) => v)) return;
  for (let pass = 0; pass < w + h; pass++) {
    let changed = false;
    const next = ok.slice();
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (ok[k]) continue;
      const acc = new Float64Array(3 * slots);
      let m = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= w || jj >= h || !ok[jj * w + ii]) continue;
        const q = jj * w + ii;
        for (let b = 0; b < slots; b++) for (let c = 0; c < 3; c++) acc[b * 3 + c] += buf[(b * n + q) * 3 + c];
        m++;
      }
      if (!m) continue;
      for (let b = 0; b < slots; b++) for (let c = 0; c < 3; c++) buf[(b * n + k) * 3 + c] = acc[b * 3 + c] / m;
      next[k] = 1;
      changed = true;
    }
    ok.set(next);
    if (!changed) break;
  }
}
