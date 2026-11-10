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
import { TriGrid } from './trigrid';

/** Anything rays can be blocked by. */
export interface Occluder { occluded(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean }
import { lightProps, type LightmapProbe, type PropInstance, type PropModelData } from './vradProps';

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
export function gatherSample(dl: SourceLight, px: number, py: number, pz: number, normals: Axis[], dots: number[], grid: Occluder | null): number {
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

/** Is p (on the polygon's plane) inside the convex polygon, either winding? */
function insidePoly(poly: Axis[], p: Axis, n: Axis): boolean {
  let pos = true, neg = true;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length];
    const v = dot3(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [p[0] - a[0], p[1] - a[1], p[2] - a[2]]), n);
    if (v < -1e-6) pos = false;
    if (v > 1e-6) neg = false;
  }
  return pos || neg;
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
  /**
   * Brush entities (func_brush, func_lod, doors, trains...): they cast no
   * shadows in VRAD but their faces are patches like any other, so they
   * catch and reflect bounced light.
   */
  reflectors?: SolidPlanes[];
  /**
   * Static props' shadow shapes, world-space triangles (9 floats each): their
   * collision model or a hull per mesh, as VRAD uses. They block direct light
   * and bounce (VRAD has no patches on props: light hitting them is lost).
   */
  propShadows?: Float32Array;
  lights: SourceLight[];
  params: {
    /** VRAD -bounce (default 100). */
    bounces: number;
    /** Unused: transfers are VRAD's own (one visibility ray per patch pair), not sampled. */
    patchRays: number;
    /** VRAD -chop: patch size in luxels (default 4). */
    chop: number;
    /** Supersample luxels across shadow edges (VRAD's default; off for quick previews). */
    supersample: boolean;
    maxWidth: number;
  };
  /** Static props to light per vertex, as VRAD does (vradProps.ts). */
  props?: { models: PropModelData[]; instances: PropInstance[] };
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
  /** Per-vertex light of the props (Source linear, RGB per vertex; instance i starts at vertex propOffsets[i]). */
  propColors?: Float32Array;
  propOffsets?: Int32Array;
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
  /** Direct light per normal (slots × w × h × 3), per sample (cell). */
  direct: Float32Array;
  /** Per sample: centroid (s, t) and bounds (s0, t0, s1, t1) in luxel coordinates relative to the grid's min (BuildFacesamples). */
  coord: Float32Array;
  bounds: Float32Array;
  /** Direct light per luxel after VRAD's radial blend of samples (BuildLuxelRadial), slots × w × h × 3. */
  luxDirect: Float32Array;
  /** Faces VRAD blends across (PairEdges: sharing a vertex, normals within 45°). */
  neighbors: number[];
}

interface Patch {
  face: number; // index into lux
  /** VRAD face (a piece of ours cut at 32 luxels): patches don't see their own. */
  piece: number;
  origin: Axis;
  normal: Axis;
  planeDist: number;
  area: number;
  min: Axis;
  max: Axis;
  reflectivity: RGB;
  /** Direct light (samples ≥ 1 only, area-weighted, as AddSampleToPatch). */
  sampleArea: number;
  sampleLight: RGB;
  winding: Axis[];
  parent: number;
  child1: number;
  child2: number;
  /** False for buried leaves (and nodes with no living leaf). */
  alive: boolean;
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

export function bakeSource(input: SourceBakeInput): SourceBakeOutput {
  const t0 = Date.now();
  const P = input.params;
  const grid = new SolidGrid(input.occluders);
  const tris = input.propShadows?.length ? new TriGrid(input.propShadows) : null;
  const occ: Occluder = tris ? { occluded: (ax, ay, az, bx, by, bz) => grid.occluded(ax, ay, az, bx, by, bz) || tris.occluded(ax, ay, az, bx, by, bz) } : grid;
  const layout = sourceLayout(input.faces, input.info, P.maxWidth);
  const infoById = new Map(input.info.map((i) => [i.id, i]));
  const log = (m: string) => input.log?.(`${m} (${Date.now() - t0} ms)`);

  // ---- luxels and their sample points (BuildFacesamples / CalcPoints)
  const lux: Lux[] = [];
  const cellPoly = new Map<Lux, Map<number, Axis[]>>();
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
      coord: new Float32Array(n * 2), bounds: new Float32Array(n * 4), luxDirect: new Float32Array(n * 3 * rect.slots), neighbors: [],
    };
    // Sample (i, j) is the face clipped to luxel coordinates [min+i, min+i+1) × [min+j, min+j+1)
    // (BuildFacesamples, no -centersamples); the luxel itself sits at the corner min+i, min+j.
    const sN = normalize(g.lmS), tN = normalize(g.lmT);
    const sL = Math.hypot(...g.lmS), tL = Math.hypot(...g.lmT);
    for (let j = 0; j < g.h; j++) {
      for (let i = 0; i < g.w; i++) {
        const cs = g.minS + i, ct = g.minT + j;
        let pp = clipPoly(poly, sN, (cs + 1) / sL);
        pp = clipPoly(pp, [-sN[0], -sN[1], -sN[2]], -cs / sL);
        pp = clipPoly(pp, tN, (ct + 1) / tL);
        pp = clipPoly(pp, [-tN[0], -tN[1], -tN[2]], -ct / tL);
        const k = j * g.w + i;
        const ac = pp.length >= 3 ? areaCentroid(pp, f.n) : { area: 0, c: toWorld(cs + 0.5, ct + 0.5) };
        L.coord[k * 2] = dot3(ac.c, g.lmS) - g.minS; L.coord[k * 2 + 1] = dot3(ac.c, g.lmT) - g.minT;
        let b0 = Infinity, b1 = Infinity, b2 = -Infinity, b3 = -Infinity;
        for (const q of pp) { const a = dot3(q, g.lmS) - g.minS, b = dot3(q, g.lmT) - g.minT; b0 = Math.min(b0, a); b1 = Math.min(b1, b); b2 = Math.max(b2, a); b3 = Math.max(b3, b); }
        L.bounds.set(pp.length ? [b0, b1, b2, b3] : [i, j, i + 1, j + 1], k * 4);
        if (pp.length >= 3) { let m = cellPoly.get(L); if (!m) cellPoly.set(L, m = new Map()); m.set(k, pp); }
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
  // ---- face neighbours (PairEdges): faces touching at a vertex (or a T-junction, which VBSP splits into one), normals within 45°
  {
    const SMOOTH = 0.7071067;
    const polys = lux.map((L) => facePolygon(L.f));
    const boxes = polys.map((pp) => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (const q of pp) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k] - 0.1); hi[k] = Math.max(hi[k], q[k] + 0.1); } return [lo, hi]; });
    const onEdge = (q: Axis, pp: Axis[]) => {
      for (let k = 0; k < pp.length; k++) {
        const a = pp[k], b = pp[(k + 1) % pp.length];
        const ab: Axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], aq: Axis = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
        const t = Math.max(0, Math.min(1, dot3(aq, ab) / Math.max(1e-9, dot3(ab, ab))));
        if (Math.hypot(aq[0] - ab[0] * t, aq[1] - ab[1] * t, aq[2] - ab[2] * t) < 0.1) return true;
      }
      return false;
    };
    const CELLN = 256, cellMap = new Map<string, number[]>();
    boxes.forEach(([lo, hi], i) => {
      for (let x = Math.floor(lo[0] / CELLN); x <= Math.floor(hi[0] / CELLN); x++) for (let y = Math.floor(lo[1] / CELLN); y <= Math.floor(hi[1] / CELLN); y++) for (let z = Math.floor(lo[2] / CELLN); z <= Math.floor(hi[2] / CELLN); z++) {
        const key = `${x},${y},${z}`; const l = cellMap.get(key); if (l) l.push(i); else cellMap.set(key, [i]);
      }
    });
    const seen = new Set<number>();
    for (const list of cellMap.values()) for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const i = list[a], j = list[b], key = i * lux.length + j;
      if (seen.has(key)) continue; seen.add(key);
      if (lux[i].info.sky || lux[j].info.sky || dot3(lux[i].f.n, lux[j].f.n) < SMOOTH) continue;
      const [l1, h1] = boxes[i], [l2, h2] = boxes[j];
      if (l1[0] > h2[0] || l2[0] > h1[0] || l1[1] > h2[1] || l2[1] > h1[1] || l1[2] > h2[2] || l2[2] > h1[2]) continue;
      if (polys[i].some((q) => onEdge(q, polys[j])) || polys[j].some((q) => onEdge(q, polys[i]))) { lux[i].neighbors.push(j); lux[j].neighbors.push(i); }
    }
  }
  // ---- patches (MakePatchForFace + SubdividePatch), as VRAD's tree. Each face is first cut wherever its
  // lightmap would pass 32 luxels (VBSP SubdivideFace); each piece is a root patch, chopped along the widest
  // world axis at the middle. Leaves receive light; any node can be seen (TestPatchToPatch picks the level).
  const patches: Patch[] = [];
  const facePatches: number[][] = lux.map(() => []); // leaves
  const faceRoots: number[][] = lux.map(() => []);
  const chop = Math.max(1, P.chop);
  let pieces = 0;
  for (let fi = 0; fi < lux.length; fi++) {
    const L = lux[fi];
    if (L.info.sky || L.info.receiveOnly) continue;
    const luxscale = 1 / L.info.lightmapscale;
    const refl = L.info.reflectivity.map((r) => Math.min(0.99, r)) as RGB;
    const planeDist = dot3(L.f.n, L.f.origin);
    const node = (w: Axis[], parent: number, piece: number): number => {
      const min: Axis = [Infinity, Infinity, Infinity], max: Axis = [-Infinity, -Infinity, -Infinity];
      for (const p of w) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
      const ac = areaCentroid(w, L.f.n);
      // A face's root patch sits at its vertices' mean (WindingCenter); children at their balance points.
      const origin: Axis = parent < 0 ? [0, 1, 2].map((k) => w.reduce((t, q) => t + q[k], 0) / w.length) as Axis : ac.c;
      patches.push({ face: fi, piece, origin, normal: L.f.n, planeDist, area: ac.area, min, max, reflectivity: refl, sampleArea: 0, sampleLight: [0, 0, 0], winding: w, parent, child1: -1, child2: -1, alive: true });
      return patches.length - 1;
    };
    const subdivide = (idx: number, chopNow: number) => {
      const p = patches[idx];
      const total = [0, 1, 2].map((i) => (p.max[i] - p.min[i]) * luxscale);
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
        const mid = (p.min[widest] + p.max[widest]) / 2;
        const a = clipPoly(p.winding, axis, mid), b = clipPoly(p.winding, [-axis[0], -axis[1], -axis[2]], -mid);
        if (a.length >= 3 && b.length >= 3 && areaCentroid(a, L.f.n).area > 0 && areaCentroid(b, L.f.n).area > 0) {
          const c1 = node(a, idx, p.piece), c2 = node(b, idx, p.piece);
          p.child1 = c1; p.child2 = c2;
          subdivide(c1, chopNow); subdivide(c2, chopNow);
          return;
        }
      }
      // Buried under another brush (VBSP's CSG would have cut it away): nobody sees it.
      if (grid.inside([p.origin[0] + L.f.n[0] * 0.5, p.origin[1] + L.f.n[1] * 0.5, p.origin[2] + L.f.n[2] * 0.5])) { p.alive = false; return; }
      facePatches[fi].push(idx);
    };
    const vbsp = (w: Axis[]): Axis[][] => {
      for (const ax of [L.grid.lmS, L.grid.lmT]) {
        let lo = Infinity, hi = -Infinity;
        for (const q of w) { const v = dot3(q, ax); lo = Math.min(lo, v); hi = Math.max(hi, v); }
        if (hi - lo <= 32) continue;
        const len = Math.hypot(ax[0], ax[1], ax[2]), nrm: Axis = [ax[0] / len, ax[1] / len, ax[2] / len], dist = (lo + 31) / len;
        const back = clipPoly(w, nrm, dist), front = clipPoly(w, [-nrm[0], -nrm[1], -nrm[2]], -dist);
        if (back.length < 3 || front.length < 3) continue;
        return [...vbsp(front), ...vbsp(back)];
      }
      return [w];
    };
    for (const w of vbsp(facePolygon(L.f))) {
      if (!(areaCentroid(w, L.f.n).area > 0)) continue;
      const r = node(w, -1, pieces++);
      faceRoots[fi].push(r);
      subdivide(r, chop);
    }
  }
  // An inner node is alive if a child is (children always come after their parent). VBSP's CSG cuts buried
  // parts off a face, so a node's area and centre are those of its living leaves.
  for (let i = patches.length - 1; i >= 0; i--) {
    const p = patches[i];
    if (p.child1 < 0) continue;
    const a = patches[p.child1], b = patches[p.child2];
    p.alive = a.alive || b.alive;
    const wa = a.alive ? a.area : 0, wb = b.alive ? b.area : 0;
    if (wa + wb > 0 && (wa === 0 || wb === 0 || wa + wb < p.area * 0.999)) {
      p.origin = [0, 1, 2].map((k) => (wa * a.origin[k] + wb * b.origin[k]) / (wa + wb)) as Axis;
      p.area = wa + wb;
    }
  }
  const leaves = facePatches.flat();
  log(`patches: ${leaves.length} leaves of ${patches.length} nodes, ${pieces} faces`);
  // ---- texture lights (CreateDirectLights, emit_surface): one direct light per patch of a lights.rad texture
  const lights = [...input.lights];
  for (const pi of leaves) {
    const p = patches[pi];
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
      const fo = gatherSample(dl, x, y, z, L.normals, dots, occ);
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
    // BuildSupersampleFaceLights (do_extra, 4 passes): a sample whose intensity, as (Σrgb / 256)^(1/2.2) in any
    // slot, differs by ≥ 1/16 from any of its 8 neighbours is re-lit as the mean of a 4×4 grid, ¼ luxel apart,
    // centred on it (points outside a partial sample's piece of the face are dropped).
    const inten = new Float64Array(n * S);
    const setI = (k: number) => { for (let b = 0; b < S; b++) { const o = (b * n + k) * 3; inten[b * n + k] = Math.pow(Math.max(0, L.direct[o] + L.direct[o + 1] + L.direct[o + 2]) / 256, 1 / 2.2); } };
    for (let k = 0; k < n; k++) if (L.area[k] > 0) setI(k);
    const done = new Uint8Array(n);
    const full = 1 / (Math.hypot(...g.lmS) * Math.hypot(...g.lmT));
    for (let pass = 1; pass <= 4; pass++) {
      const redo: number[] = [];
      for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
        const k = j * g.w + i;
        if (done[k] || !(L.area[k] > 0)) continue;
        let grad = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= g.w || jj >= g.h) continue;
          for (let b = 0; b < S; b++) grad = Math.max(grad, Math.abs(inten[b * n + k] - inten[b * n + jj * g.w + ii]));
        }
        if (grad >= 0.0625) redo.push(k);
      }
      if (!redo.length) break;
      for (const k of redo) {
        done[k] = 1;
        const partial = L.area[k] < full - EQUAL_EPSILON ? cellPoly.get(L)?.get(k) : undefined;
        acc.fill(0);
        let m = 0;
        for (let si = 0; si < 4; si++) for (let sj = 0; sj < 4; sj++) {
          const p = L.toWorld(g.minS + L.coord[k * 2] - 0.375 + si * 0.25, g.minT + L.coord[k * 2 + 1] - 0.375 + sj * 0.25);
          if (partial && !insidePoly(partial, p, L.f.n)) continue;
          const x = p[0] + L.f.n[0], y = p[1] + L.f.n[1], z = p[2] + L.f.n[2];
          if (grid.inside([x, y, z])) continue;
          sampleAt(L, cand, x, y, z, one);
          for (let c = 0; c < S * 3; c++) acc[c] += one[c];
          m++;
        }
        if (!m) continue;
        for (let b = 0; b < S; b++) for (let c = 0; c < 3; c++) L.direct[(b * n + k) * 3 + c] = acc[b * 3 + c] / m;
        setI(k);
      }
    }
  }
  log('direct light');
  // ---- luxel direct light (BuildLuxelRadial / AddDirectToRadial / SampleRadial): each luxel (at a cell corner)
  // blends the samples around it, its own face's and its neighbours', weighted by overlap ÷ distance.
  const WEIGHT_EPS = 1e-5;
  const luxOk: Uint8Array[] = [];
  for (const L of lux) {
    const g = L.grid, S = L.rect.slots, n = g.w * g.h;
    const acc = new Float64Array(n * 3 * S), wt = new Float64Array(n);
    const add = (cs: number, ct: number, b0: number, b1: number, b2: number, b3: number, light: (slot: number, c: number) => number) => {
      const s0 = Math.max(0, Math.trunc(b0)), t0 = Math.max(0, Math.trunc(b1));
      const s1 = Math.min(g.w, Math.trunc(b2 + 0.9999) + 1), t1 = Math.min(g.h, Math.trunc(b3 + 0.9999) + 1);
      for (let si = s0; si < s1; si++) for (let ti = t0; ti < t1; ti++) {
        const a0 = Math.max(b0 - si, -1), c0 = Math.max(b1 - ti, -1), a1 = Math.min(b2 - si, 1), c1 = Math.min(b3 - ti, 1);
        const area = (a1 - a0) * (c1 - c0);
        if (!(area > EQUAL_EPSILON)) continue;
        const d = Math.max(Math.abs(cs - si), Math.abs(ct - ti));
        const r = d < 0.1 ? area / 0.1 : area / d;
        const k = si + ti * g.w;
        for (let sl = 0; sl < S; sl++) for (let c = 0; c < 3; c++) acc[(sl * n + k) * 3 + c] += r * light(sl, c);
        wt[k] += r;
      }
    };
    for (let k = 0; k < n; k++) {
      if (!L.valid[k]) continue;
      add(L.coord[k * 2], L.coord[k * 2 + 1], L.bounds[k * 4], L.bounds[k * 4 + 1], L.bounds[k * 4 + 2], L.bounds[k * 4 + 3], (sl, c) => L.direct[(sl * n + k) * 3 + c]);
    }
    const toL = (q: Axis): [number, number] => [dot3(q, g.lmS) - g.minS, dot3(q, g.lmT) - g.minT];
    for (const ni of L.neighbors) {
      const M = lux[ni], gm = M.grid, nm = gm.w * gm.h, Sm = M.rect.slots;
      for (let k = 0; k < nm; k++) {
        if (!M.valid[k]) continue;
        const [a0, a1] = toL(M.toWorld(gm.minS + M.bounds[k * 4], gm.minT + M.bounds[k * 4 + 1]));
        const [b0, b1] = toL(M.toWorld(gm.minS + M.bounds[k * 4 + 2], gm.minT + M.bounds[k * 4 + 3]));
        if (Math.max(a0, b0) < -1 || Math.min(a0, b0) > g.w || Math.max(a1, b1) < -1 || Math.min(a1, b1) > g.h) continue;
        const [c0, c1] = toL(M.toWorld(gm.minS + M.coord[k * 2], gm.minT + M.coord[k * 2 + 1]));
        // A bumped face takes a flat neighbour's light in every bump slot × 1/√3.
        add(c0, c1, a0, a1, b0, b1, (sl, c) => (sl === 0 || Sm === 4 ? M.direct[(sl * nm + k) * 3 + c] : M.direct[k * 3 + c] * OO_SQRT_3));
      }
    }
    const ok = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      if (!(wt[k] > WEIGHT_EPS)) continue;
      ok[k] = 1;
      for (let sl = 0; sl < S; sl++) for (let c = 0; c < 3; c++) L.luxDirect[(sl * n + k) * 3 + c] = acc[(sl * n + k) * 3 + c] / wt[k];
    }
    luxOk.push(ok);
  }
  log('luxel radial');
  // ---- patch direct light (AddSampleToPatch / BuildPatchLights): samples averaging ≥ 1 go to the leaves whose
  // bounds they touch (area-weighted); inner nodes sum their children's samples, then take their children's light.
  const N = patches.length;
  const emit = new Float32Array(N * 3);
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
      for (const pi of list) {
        const p = patches[pi];
        if (p.min[0] > x + rad || p.max[0] < x - rad || p.min[1] > y + rad || p.max[1] < y - rad || p.min[2] > z + rad || p.max[2] < z - rad) continue;
        p.sampleArea += L.area[k];
        p.sampleLight[0] += L.area[k] * r; p.sampleLight[1] += L.area[k] * gg; p.sampleLight[2] += L.area[k] * b;
      }
    }
  }
  for (let i = N - 1; i >= 0; i--) {
    const p = patches[i];
    if (p.parent >= 0) { const q = patches[p.parent]; q.sampleArea += p.sampleArea; for (let c = 0; c < 3; c++) q.sampleLight[c] += p.sampleLight[c]; }
  }
  const liveArea = (i: number) => (patches[i].alive ? patches[i].area : 0);
  for (let i = N - 1; i >= 0; i--) {
    const p = patches[i];
    if (p.sampleArea > 0) for (let c = 0; c < 3; c++) emit[i * 3 + c] = p.sampleLight[c] / p.sampleArea;
  }
  for (let i = N - 1; i >= 0; i--) {
    const p = patches[i];
    if (p.child1 < 0) continue;
    const a1 = liveArea(p.child1), a2 = liveArea(p.child2);
    if (a1 + a2 <= 0) continue;
    for (let c = 0; c < 3; c++) emit[i * 3 + c] = (a1 * emit[p.child1 * 3 + c] + a2 * emit[p.child2 * 3 + c]) / (a1 + a2);
  }

  // ---- transfers (BuildVisLeafs / TestPatchToFace / TestPatchToPatch / MakeTransfer / MakeScales): from each leaf,
  // every face in front; descend a face's tree while the node is near (d² / 16 < its area); one ray between the
  // two centres (each pushed 1 unit off its face) decides visibility; form factor point-to-point, or polygon-to-point
  // when the node is big for its distance; the total is scaled to 1/π (or 1/total past π).
  const PLANE_EPS = 0.01, TRANSFER_EPSILON = 0.0000001;
  const ox = new Float64Array(N * 3), on = new Float64Array(N * 3), od = new Float64Array(N), oa = new Float64Array(N);
  const c1 = new Int32Array(N), c2 = new Int32Array(N), piece = new Int32Array(N), alive = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const p = patches[i];
    ox.set(p.origin, i * 3); on.set(p.normal, i * 3); od[i] = p.planeDist; oa[i] = p.area;
    c1[i] = p.child1; c2[i] = p.child2; piece[i] = p.piece; alive[i] = p.alive ? 1 : 0;
  }
  const roots = faceRoots.flat().filter((r) => alive[r]);
  let tIdx = new Int32Array(1 << 22), tW = new Float32Array(1 << 22), tN = 0;
  const tStart = new Int32Array(N).fill(-1), tEnd = new Int32Array(N);
  const tmpI: number[] = [], tmpW: number[] = [];
  let rays = 0;
  const polyFF = (j: number, x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    const w = patches[j].winding;
    let ff = 0;
    for (let k = 0; k < w.length; k++) {
      const a = w[k], b = w[(k + 1) % w.length];
      let v1x = a[0] - x, v1y = a[1] - y, v1z = a[2] - z, v2x = b[0] - x, v2y = b[1] - y, v2z = b[2] - z;
      let l = Math.hypot(v1x, v1y, v1z) || 1; v1x /= l; v1y /= l; v1z /= l;
      l = Math.hypot(v2x, v2y, v2z) || 1; v2x /= l; v2y /= l; v2z /= l;
      let gx = v1y * v2z - v1z * v2y, gy = v1z * v2x - v1x * v2z, gz = v1x * v2y - v1y * v2x;
      const sa = Math.hypot(gx, gy, gz);
      if (sa > 0) { gx /= sa; gy /= sa; gz /= sa; }
      if (sa < -1 || sa > 1) return 0;
      const ang = Math.asin(sa);
      ff += ang * (gx * nx + gy * ny + gz * nz);
    }
    // VRAD's windings face the other way round from ours: the magnitude is what counts.
    return Math.abs(ff) * (0.5 / patches[j].area);
  };
  let pIdx = 0;
  for (const i of leaves) {
    if (!alive[i] || lux[patches[i].face].info.sky) continue;
    const x = ox[i * 3], y = ox[i * 3 + 1], z = ox[i * 3 + 2], nx = on[i * 3], ny = on[i * 3 + 1], nz = on[i * 3 + 2], d1 = od[i];
    const sx = x + nx, sy = y + ny, sz = z + nz;
    tmpI.length = 0; tmpW.length = 0;
    let total = 0;
    const visit = (j: number) => {
      if (!alive[j]) return;
      const dx = x - ox[j * 3], dy = y - ox[j * 3 + 1], dz = z - ox[j * 3 + 2], dd = dx * dx + dy * dy + dz * dz;
      if (c1[j] >= 0 && dd * 0.0625 < oa[j]) { visit(c1[j]); visit(c2[j]); return; }
      const jx = ox[j * 3], jy = ox[j * 3 + 1], jz = ox[j * 3 + 2];
      if (!(jx * nx + jy * ny + jz * nz > d1 + PLANE_EPS)) return;
      const ex = jx + on[j * 3], ey = jy + on[j * 3 + 1], ez = jz + on[j * 3 + 2];
      rays++;
      if (occ.occluded(sx, sy, sz, ex, ey, ez)) return;
      // MakeTransfer: FormFactorDiffToDiff(node, leaf)
      const len = Math.sqrt(dd) || 1, ux = -dx / len, uy = -dy / len, uz = -dz / len; // node − leaf
      let ff = -(ux * on[j * 3] + uy * on[j * 3 + 1] + uz * on[j * 3 + 2]) * (ux * nx + uy * ny + uz * nz) / (len * len);
      if (!(ff > 0)) return;
      if (Math.PI * 0.04 * dd < oa[j]) { ff = polyFF(j, x, y, z, nx, ny, nz); if (!(ff > 0)) return; }
      const t = oa[j] * ff;
      if (t <= TRANSFER_EPSILON) return;
      tmpI.push(j); tmpW.push(t); total += t;
    };
    for (const r of roots) {
      if (piece[r] === piece[i]) continue;
      if (x * on[r * 3] + y * on[r * 3 + 1] + z * on[r * 3 + 2] > od[r] + PLANE_EPS) visit(r);
    }
    const scale = total > Math.PI ? 1 / total : 1 / Math.PI;
    if (tN + tmpI.length > tIdx.length) {
      const cap = Math.max(tIdx.length * 2, tN + tmpI.length);
      const a = new Int32Array(cap); a.set(tIdx.subarray(0, tN)); tIdx = a;
      const b = new Float32Array(cap); b.set(tW.subarray(0, tN)); tW = b;
    }
    tStart[i] = tN;
    for (let k = 0; k < tmpI.length; k++) { tIdx[tN] = tmpI[k]; tW[tN] = tmpW[k] * scale; tN++; }
    tEnd[i] = tN;
    if (++pIdx % 20000 === 0) log(`transfers: ${pIdx}/${leaves.length} leaves, ${tN} transfers, ${rays} rays`);
  }
  log(`transfers: ${tN} (${(tN / Math.max(1, leaves.length)).toFixed(0)} per leaf), ${rays} rays`);

  // ---- bounce (BounceLight / GatherLight / CollectLight)
  const total = new Float32Array(N * 12); // bounced light received, 4 slots (flat + bump basis) × rgb
  const add = new Float32Array(N * 12);
  let bounces = 0;
  for (let it = 0; it < P.bounces; it++) {
    add.fill(0);
    for (const i of leaves) {
      const s0 = tStart[i];
      if (s0 < 0) continue;
      const L = lux[patches[i].face];
      const nx = on[i * 3], ny = on[i * 3 + 1], nz = on[i * 3 + 2];
      let r = 0, g = 0, b = 0;
      const bumped = L.info.bump && L.normals.length === 4;
      for (let t = s0; t < tEnd[i]; t++) {
        const j = tIdx[t], w = tW[t], rf = patches[j].reflectivity;
        const er = emit[j * 3] * rf[0] * w, eg = emit[j * 3 + 1] * rf[1] * w, eb = emit[j * 3 + 2] * rf[2] * w;
        if (!bumped) { r += er; g += eg; b += eb; continue; }
        let dx = ox[j * 3] - ox[i * 3], dy = ox[j * 3 + 1] - ox[i * 3 + 1], dz = ox[j * 3 + 2] - ox[i * 3 + 2];
        const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
        const sc = 1 / (dx * nx + dy * ny + dz * nz);
        for (let s = 0; s < 4; s++) {
          const bn = s === 0 ? patches[i].normal : L.normals[s];
          const dt = dx * bn[0] + dy * bn[1] + dz * bn[2];
          if (dt <= 0) continue;
          add[i * 12 + s * 3] += er * sc * dt; add[i * 12 + s * 3 + 1] += eg * sc * dt; add[i * 12 + s * 3 + 2] += eb * sc * dt;
        }
      }
      if (!bumped) { add[i * 12] = r; add[i * 12 + 1] = g; add[i * 12 + 2] = b; }
    }
    // CollectLight: leaves keep what they received and emit it next; inner nodes average their children.
    let ar = 0, ag = 0, ab = 0;
    for (let i = N - 1; i >= 0; i--) {
      const p = patches[i];
      if (p.child1 < 0) {
        if (!p.alive) continue;
        for (let s = 0; s < 12; s++) total[i * 12 + s] += add[i * 12 + s];
        emit[i * 3] = add[i * 12]; emit[i * 3 + 1] = add[i * 12 + 1]; emit[i * 3 + 2] = add[i * 12 + 2];
        ar += emit[i * 3]; ag += emit[i * 3 + 1]; ab += emit[i * 3 + 2];
      } else {
        const a1 = liveArea(p.child1), a2 = liveArea(p.child2);
        if (a1 + a2 <= 0) continue;
        const s1 = a1 / (a1 + a2), s2 = a2 / (a1 + a2);
        for (let s = 0; s < 12; s++) total[i * 12 + s] = s1 * total[p.child1 * 12 + s] + s2 * total[p.child2 * 12 + s];
        for (let c = 0; c < 3; c++) emit[i * 3 + c] = s1 * emit[p.child1 * 3 + c] + s2 * emit[p.child2 * 3 + c];
      }
    }
    bounces = it + 1;
    if (ar < 1 && ag < 1 && ab < 1) break;
  }

  log(`bounced ×${bounces}`);
  // ---- final luxels (FinalLightFace): radial direct + bounce from the leaf patches of the face and its neighbours
  // (BuildPatchRadial / AddBouncedToRadial: weight 2 − (Δs/patch width)² − (Δt/patch height)², in luxels).
  const W = layout.width, H = layout.height;
  const pixels = new Float32Array(W * H * 4);
  const faceAverage: [number, RGB][] = [];
  for (let fi = 0; fi < lux.length; fi++) {
    const L = lux[fi];
    const g = L.grid, S = L.rect.slots, n = g.w * g.h;
    const acc = new Float64Array(n * 3 * S), wt = new Float64Array(n);
    const bumped = S === 4;
    for (const ff of [fi, ...L.neighbors]) {
      for (const pi of facePatches[ff]) {
        const p = patches[pi];
        let m0 = Infinity, m1 = Infinity, x0 = -Infinity, x1 = -Infinity;
        for (const q of p.winding) { const a = dot3(q, g.lmS) - g.minS, b = dot3(q, g.lmT) - g.minT; m0 = Math.min(m0, a); m1 = Math.min(m1, b); x0 = Math.max(x0, a); x1 = Math.max(x1, b); }
        const cs = dot3(p.origin, g.lmS) - g.minS, ct = dot3(p.origin, g.lmT) - g.minT;
        const ds = Math.max(1, x0 - m0), dt = Math.max(1, x1 - m1);
        const s0 = Math.max(0, Math.trunc(cs - ds * 1.42)), t0 = Math.max(0, Math.trunc(ct - dt * 1.42));
        const s1 = Math.min(g.w, Math.trunc(cs + ds * 1.42 + 1)), t1 = Math.min(g.h, Math.trunc(ct + dt * 1.42 + 1));
        for (let si = s0; si < s1; si++) for (let ti = t0; ti < t1; ti++) {
          const a = (cs - si) / ds, b = (ct - ti) / dt, r = 2 - (a * a + b * b);
          if (r <= 0) continue;
          const k = si + ti * g.w;
          // A bumped face reads every slot of its neighbours' patches (zero on flat ones: VRAD passes this face's flag).
          for (let sl = 0; sl < (bumped ? 4 : 1); sl++) for (let c = 0; c < 3; c++) acc[(sl * n + k) * 3 + c] += r * total[pi * 12 + sl * 3 + c];
          wt[k] += r;
        }
      }
    }
    const out = new Float32Array(n * 3 * S);
    for (let k = 0; k < n; k++) for (let b = 0; b < S; b++) for (let c = 0; c < 3; c++) {
      out[(b * n + k) * 3 + c] = L.luxDirect[(b * n + k) * 3 + c] + (wt[k] > WEIGHT_EPS ? acc[(b * n + k) * 3 + c] / wt[k] : 0);
    }
    // Luxels outside the face or inside a solid: copy the nearest valid luxel's light (they're only seen at edges, filtered).
    dilateSlots(out, g.w, g.h, S, luxOk[fi]);
    let avg: RGB = [0, 0, 0], cnt = 0;
    for (let k = 0; k < n; k++) if (luxOk[fi][k]) { avg = [avg[0] + out[k * 3], avg[1] + out[k * 3 + 1], avg[2] + out[k * 3 + 2]]; cnt++; }
    faceAverage.push([L.f.id, cnt ? [avg[0] / cnt / 255, avg[1] / cnt / 255, avg[2] / cnt / 255] : [0, 0, 0]]);
    for (let b = 0; b < S; b++) for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
      const k = j * g.w + i, o = ((L.rect.y + j) * W + L.rect.x + b * g.w + i) * 4;
      pixels[o] = out[(b * n + k) * 3] / 255;
      pixels[o + 1] = out[(b * n + k) * 3 + 1] / 255;
      pixels[o + 2] = out[(b * n + k) * 3 + 2] / 255;
      pixels[o + 3] = 1;
    }
  }

  // ---- static props, per vertex, against the finished lightmaps
  let props: { colors: Float32Array; offsets: Int32Array } | undefined;
  if (input.props?.instances.length) {
    log(`lighting ${input.props.instances.length} props`);
    const probe: LightmapProbe = (faceId, x, y, z) => {
      const li = luxByFace.get(faceId);
      if (li === undefined) return null;
      const L = lux[li];
      if (L.info.sky) return null;
      const g = L.grid;
      const s = Math.min(g.w - 1, Math.max(0, Math.floor(x * g.lmS[0] + y * g.lmS[1] + z * g.lmS[2] - g.minS + 0.5)));
      const t = Math.min(g.h - 1, Math.max(0, Math.floor(x * g.lmT[0] + y * g.lmT[1] + z * g.lmT[2] - g.minT + 0.5)));
      const o = ((L.rect.y + t) * W + L.rect.x + s) * 4;
      return { light: [pixels[o], pixels[o + 1], pixels[o + 2]], reflectivity: L.info.reflectivity };
    };
    props = lightProps(input.props.models, input.props.instances, lights, grid, probe, undefined, occ);
  }

  return {
    width: W, height: H, pixels, rects: [...layout.rects], ms: Date.now() - t0, luxels, patches: leaves.length, bounces, faceAverage,
    propColors: props?.colors, propOffsets: props?.offsets,
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
