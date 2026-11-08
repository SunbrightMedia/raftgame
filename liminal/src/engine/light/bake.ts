import { type Axis, type Face, type LightmapRect, type SolidPlanes, facePoint, insideSolid } from './faces';

/**
 * Lightmap baker, in the spirit of Source's VRAD:
 *  - direct light from point lights and from light-emitting surfaces
 *    (Source's lights.rad: fluorescent panels light the room by themselves),
 *    with hard shadow rays against brushes,
 *  - inverse-square falloff controlled by a "fifty percent distance", like
 *    Source lights' _fifty_percent_distance,
 *  - optional bounce passes (gathered indirect light), which give the soft
 *    fill and corner darkening that make old Source maps look the way they do,
 *  - plus a flat ambient term.
 *
 * Pure data in, pixels out: no DOM or three.js, so it runs in a worker and in tests.
 */

export type RGB = [number, number, number];

export interface BakeLight {
  pos: Axis;
  /** Colour × intensity. 1 = full white at very close range. */
  color: RGB;
  /** Distance at which the light is at half strength. */
  fifty: number;
  /** Beyond this the light contributes nothing (smoothly). */
  range: number;
  /** If set, the light faces this way (surface lights, downlights). */
  dir?: Axis;
  /** Beam tightness: emission ∝ cos(angle)^cone. 1 = Lambertian, 3+ = a pot light's beam. */
  cone?: number;
}

export interface SurfaceEmitter { color: RGB; intensity: number }

export interface BakeParams {
  ambient: RGB;
  /** Multiplies every light. */
  lightScale: number;
  /** 0..2 bounce passes. */
  bounces: number;
  /** Strength multiplier for bounced light. */
  bounceScale: number;
  /** Rays per luxel per bounce. */
  bounceSamples: number;
  /** Spacing of the point samples a light-emitting surface is split into. */
  surfaceSpacing: number;
  surfaceFifty: number;
  /** Glow drawn on the emitting surface itself (lightmap value). */
  surfaceGlow: number;
  /**
   * Ambient occlusion: how much light is lost where surfaces close in
   * (wall-floor junctions, under furniture, inside corners). Uses the first
   * bounce pass's rays, so it needs bounces >= 1.
   */
  aoStrength?: number;
  /** Distance within which nearby surfaces count as occluding. */
  aoRadius?: number;
}

/** Shadow casters: every solid brush as a convex plane set. */
export type BakeBox = SolidPlanes;

export interface BakeInput {
  faces: Face[];
  width: number;
  height: number;
  rects: [number, LightmapRect][];
  boxes: BakeBox[];
  lights: BakeLight[];
  emissive: Record<string, SurfaceEmitter>;
  albedo: Record<string, RGB>;
  params: BakeParams;
}

export interface BakeOutput {
  /** RGBA8, lightmap value / 2 (shader multiplies by 2 for overbright). */
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  ms: number;
  luxels: number;
  lights: number;
}

interface FaceSamples {
  face: Face;
  rect: LightmapRect;
  stepS: number;
  stepT: number;
  /** Sample positions (lifted off the surface), xyz per luxel. */
  pos: Float64Array;
  valid: Uint8Array;
  direct: Float32Array;
  total: Float32Array;
  /** Ambient occlusion per luxel (3 channels, all equal), 1 = open. */
  ao: Float32Array;
  emitting: boolean;
}

const EPS = 1e-4;

export function bake(input: BakeInput): BakeOutput {
  const t0 = Date.now();
  const p = input.params;
  const rects = new Map(input.rects);
  const boxes = input.boxes;

  const lights: BakeLight[] = input.lights.map((l) => ({ ...l, color: scale3(l.color, p.lightScale) }));
  // Light-emitting surfaces become a grid of small Lambertian lights.
  for (const f of input.faces) {
    const em = input.emissive[f.tex];
    // intensity 0 = glows but casts no light (e.g. a pot light's lens; the light itself is an entity).
    if (!em || em.intensity <= 0) continue;
    const ns = Math.max(1, Math.round(f.width / p.surfaceSpacing));
    const nt = Math.max(1, Math.round(f.height / p.surfaceSpacing));
    const cell = (f.width / ns) * (f.height / nt);
    const k = (em.intensity * p.lightScale * cell) / (32 * 32);
    for (let i = 0; i < ns; i++) {
      for (let j = 0; j < nt; j++) {
        lights.push({
          pos: facePoint(f, ((i + 0.5) * f.width) / ns, ((j + 0.5) * f.height) / nt, 2),
          color: scale3(em.color, k),
          fifty: p.surfaceFifty,
          range: p.surfaceFifty * 5,
          dir: f.n,
        });
      }
    }
  }

  // Which brushes can shadow each light (only those inside its range).
  const lightBoxes = lights.map((l) => boxes.filter((b) => sphereBox(l.pos, l.range, b)));

  const samples: FaceSamples[] = [];
  const byId = new Map<number, FaceSamples>();
  let luxels = 0;
  for (const f of input.faces) {
    const rect = rects.get(f.id);
    if (!rect) continue;
    const n = rect.w * rect.h;
    luxels += n;
    const fs: FaceSamples = {
      face: f, rect,
      stepS: f.width / (rect.w - 1), stepT: f.height / (rect.h - 1),
      pos: new Float64Array(n * 3), valid: new Uint8Array(n),
      direct: new Float32Array(n * 3), total: new Float32Array(n * 3), ao: new Float32Array(n * 3).fill(1),
      emitting: !!input.emissive[f.tex],
    };
    for (let j = 0; j < rect.h; j++) {
      for (let i = 0; i < rect.w; i++) {
        const s = clamp(i * fs.stepS, 0.5, f.width - 0.5);
        const t = clamp(j * fs.stepT, 0.5, f.height - 0.5);
        const q = facePoint(f, s, t, 1);
        const k = j * rect.w + i;
        fs.pos[k * 3] = q[0]; fs.pos[k * 3 + 1] = q[1]; fs.pos[k * 3 + 2] = q[2];
        fs.valid[k] = insideAny(boxes, q) ? 0 : 1;
      }
    }
    samples.push(fs);
    byId.set(f.id, fs);
  }

  // ---- direct light
  for (const fs of samples) {
    const f = fs.face;
    if (fs.emitting) {
      const em = input.emissive[f.tex];
      fs.direct.fill(0);
      for (let k = 0; k < fs.valid.length; k++) {
        fs.direct[k * 3] = em.color[0] * p.surfaceGlow;
        fs.direct[k * 3 + 1] = em.color[1] * p.surfaceGlow;
        fs.direct[k * 3 + 2] = em.color[2] * p.surfaceGlow;
      }
      continue;
    }
    // Lights that can reach this face at all: in front of it and in range of its bounds.
    const lo = facePoint(f, 0, 0), hi = facePoint(f, f.width, f.height);
    const fmin: Axis = [Math.min(lo[0], hi[0]), Math.min(lo[1], hi[1]), Math.min(lo[2], hi[2])];
    const fmax: Axis = [Math.max(lo[0], hi[0]), Math.max(lo[1], hi[1]), Math.max(lo[2], hi[2])];
    const cand: number[] = [];
    for (let li = 0; li < lights.length; li++) {
      const l = lights[li];
      const side = (l.pos[0] - f.origin[0]) * f.n[0] + (l.pos[1] - f.origin[1]) * f.n[1] + (l.pos[2] - f.origin[2]) * f.n[2];
      if (side <= 0) continue;
      if (sphereBox(l.pos, l.range, { min: fmin, max: fmax })) cand.push(li);
    }
    for (let k = 0; k < fs.valid.length; k++) {
      if (!fs.valid[k]) continue;
      const px = fs.pos[k * 3], py = fs.pos[k * 3 + 1], pz = fs.pos[k * 3 + 2];
      let r = 0, g = 0, b = 0;
      for (const li of cand) {
        const l = lights[li];
        const dx = l.pos[0] - px, dy = l.pos[1] - py, dz = l.pos[2] - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > l.range * l.range) continue;
        const d = Math.sqrt(d2) || 1e-6;
        const ndotl = (dx * f.n[0] + dy * f.n[1] + dz * f.n[2]) / d;
        if (ndotl <= 0) continue;
        let emit = 1;
        if (l.dir) {
          emit = -(dx * l.dir[0] + dy * l.dir[1] + dz * l.dir[2]) / d;
          if (emit <= 0) continue;
          if (l.cone && l.cone !== 1) emit = Math.pow(emit, l.cone);
        }
        const att = falloff(d, l.fifty, l.range);
        if (att <= 0) continue;
        if (occluded(lightBoxes[li], px, py, pz, l.pos[0], l.pos[1], l.pos[2])) continue;
        const w = att * ndotl * emit;
        r += l.color[0] * w; g += l.color[1] * w; b += l.color[2] * w;
      }
      fs.direct[k * 3] = r; fs.direct[k * 3 + 1] = g; fs.direct[k * 3 + 2] = b;
    }
  }

  // ---- bounces: each luxel gathers the light reflected by whatever it sees.
  for (const fs of samples) { dilate(fs, fs.direct); fs.total.set(fs.direct); }
  const dirs = hemisphere(Math.max(1, Math.round(p.bounceSamples)));
  for (let pass = 0; pass < Math.min(2, Math.round(p.bounces)); pass++) {
    const gathered = new Map<FaceSamples, Float32Array>();
    for (const fs of samples) {
      const f = fs.face;
      const out = new Float32Array(fs.direct.length);
      gathered.set(fs, out);
      if (fs.emitting) continue;
      // Indirect light is smooth: gather on every 2nd luxel (plus the last
      // row/column) and interpolate the rest.
      const { w: rw, h: rh } = fs.rect;
      const onGrid = (i: number, n: number) => i % 2 === 0 || i === n - 1;
      for (let k = 0; k < fs.valid.length; k++) {
        const ki = k % rw, kj = (k - ki) / rw;
        if (!onGrid(ki, rw) || !onGrid(kj, rh)) continue;
        if (!fs.valid[k]) continue;
        const px = fs.pos[k * 3], py = fs.pos[k * 3 + 1], pz = fs.pos[k * 3 + 2];
        const rot = hash(k * 7919 + f.id * 104729) * Math.PI * 2;
        const cr = Math.cos(rot), sr = Math.sin(rot);
        let r = 0, g = 0, b = 0, occ = 0;
        const aoR = p.aoRadius ?? 24;
        for (const [a, c, h] of dirs) {
          const x = a * cr - c * sr, y = a * sr + c * cr; // rotate around the normal
          const dx = f.r[0] * x + f.u[0] * y + f.n[0] * h;
          const dy = f.r[1] * x + f.u[1] * y + f.n[1] * h;
          const dz = f.r[2] * x + f.u[2] * y + f.n[2] * h;
          const hit = castRay(boxes, px, py, pz, dx * 4096, dy * 4096, dz * 4096);
          if (!hit) continue;
          const dist = hit.t * 4096;
          if (pass === 0 && dist < aoR) occ += 1 - dist / aoR;
          const hs = byId.get(hit.faceId);
          if (!hs) continue;
          const v = lookup(hs, px + dx * 4096 * hit.t, py + dy * 4096 * hit.t, pz + dz * 4096 * hit.t);
          const alb = hs.emitting ? [0, 0, 0] : (input.albedo[hs.face.tex] ?? [0.5, 0.5, 0.5]);
          r += v[0] * alb[0]; g += v[1] * alb[1]; b += v[2] * alb[2];
        }
        out[k * 3] = (r / dirs.length) * p.bounceScale;
        out[k * 3 + 1] = (g / dirs.length) * p.bounceScale;
        out[k * 3 + 2] = (b / dirs.length) * p.bounceScale;
        if (pass === 0) {
          const ao = Math.max(0, 1 - (p.aoStrength ?? 0) * Math.min(1, (occ / dirs.length) * 2.2));
          fs.ao[k * 3] = fs.ao[k * 3 + 1] = fs.ao[k * 3 + 2] = ao;
        }
      }
      fillSkipped(out, rw, rh, fs.valid, onGrid);
      // Indirect light is smooth in reality; blur away sampling noise (blotches).
      smooth(out, rw, rh, fs.valid, 2);
      if (pass === 0) { fillSkipped(fs.ao, rw, rh, fs.valid, onGrid); smooth(fs.ao, rw, rh, fs.valid, 1); }
    }
    // Next pass bounces what this one gathered.
    for (const fs of samples) {
      const gth = gathered.get(fs)!;
      for (let i = 0; i < fs.total.length; i++) fs.total[i] = fs.direct[i] + gth[i];
    }
  }

  // ---- write the atlas
  const pixels = new Uint8ClampedArray(input.width * input.height * 4);
  for (const fs of samples) {
    dilate(fs, fs.total);
    dilate(fs, fs.direct);
    dilate(fs, fs.ao);
    const { rect } = fs;
    for (let j = 0; j < rect.h; j++) {
      for (let i = 0; i < rect.w; i++) {
        const k = j * rect.w + i;
        const o = ((rect.y + j) * input.width + rect.x + i) * 4;
        // Occlusion darkens indirect and ambient light fully, direct light a little
        // (contact shadows in corners and under furniture).
        const ao = fs.ao[k * 3], aoDirect = 1 - (1 - ao) * 0.35;
        for (let c = 0; c < 3; c++) {
          const direct = fs.direct[k * 3 + c], indirect = fs.total[k * 3 + c] - direct;
          pixels[o + c] = ((direct * aoDirect + (indirect + p.ambient[c]) * ao) / 2) * 255;
        }
        pixels[o + 3] = 255;
      }
    }
  }
  return { pixels, width: input.width, height: input.height, ms: Date.now() - t0, luxels, lights: lights.length };
}

/** Source-like inverse square with a "fifty percent" distance, faded to zero at `range`. */
export function falloff(d: number, fifty: number, range: number): number {
  const q = (x: number) => 1 / (1 + (x / Math.max(1, fifty)) ** 2);
  const end = q(range);
  return Math.max(0, (q(d) - end) / (1 - end));
}

/** 3×3 box blur over a face's valid luxels, `passes` times. */
function smooth(buf: Float32Array, w: number, h: number, valid: Uint8Array, passes: number): void {
  for (let p = 0; p < passes; p++) {
    const src = buf.slice();
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (!valid[k]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= w || jj >= h || !valid[jj * w + ii]) continue;
        const q = (jj * w + ii) * 3;
        r += src[q]; g += src[q + 1]; b += src[q + 2]; n++;
      }
      buf[k * 3] = r / n; buf[k * 3 + 1] = g / n; buf[k * 3 + 2] = b / n;
    }
  }
}

/** Interpolate the luxels the bounce pass skipped from the gathered grid around them. */
function fillSkipped(buf: Float32Array, w: number, h: number, valid: Uint8Array, onGrid: (i: number, n: number) => boolean): void {
  const at = (i: number, j: number, c: number) => buf[(j * w + i) * 3 + c];
  // Rows that were gathered: fill odd columns from left/right neighbours.
  for (let j = 0; j < h; j++) {
    if (!onGrid(j, h)) continue;
    for (let i = 0; i < w; i++) {
      if (onGrid(i, w)) continue;
      const a = valid[j * w + i - 1] ? i - 1 : i + 1, b = valid[j * w + i + 1] ? i + 1 : i - 1;
      for (let c = 0; c < 3; c++) buf[(j * w + i) * 3 + c] = (at(a, j, c) + at(b, j, c)) / 2;
    }
  }
  // Remaining rows from the rows above/below.
  for (let j = 0; j < h; j++) {
    if (onGrid(j, h)) continue;
    for (let i = 0; i < w; i++) {
      for (let c = 0; c < 3; c++) buf[(j * w + i) * 3 + c] = (at(i, j - 1, c) + at(i, j + 1, c)) / 2;
    }
  }
}

/** Fill luxels that sat inside solid geometry from their valid neighbours, so no dark bleed at wall bases. */
function dilate(fs: FaceSamples, buf: Float32Array): void {
  const { w, h } = fs.rect;
  let valid = fs.valid.slice();
  for (let pass = 0; pass < 8; pass++) {
    let missing = 0;
    const next = valid.slice();
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        if (valid[k]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue;
          const kk = jj * w + ii;
          if (!valid[kk]) continue;
          r += buf[kk * 3]; g += buf[kk * 3 + 1]; b += buf[kk * 3 + 2]; n++;
        }
        if (n) {
          buf[k * 3] = r / n; buf[k * 3 + 1] = g / n; buf[k * 3 + 2] = b / n;
          next[k] = 1;
        } else missing++;
      }
    }
    valid = next;
    if (!missing) break;
  }
}

function lookup(fs: FaceSamples, x: number, y: number, z: number): [number, number, number] {
  const f = fs.face;
  const ox = x - f.origin[0], oy = y - f.origin[1], oz = z - f.origin[2];
  const s = ox * f.r[0] + oy * f.r[1] + oz * f.r[2];
  const t = ox * f.u[0] + oy * f.u[1] + oz * f.u[2];
  const i = clamp(Math.round(s / fs.stepS), 0, fs.rect.w - 1);
  const j = clamp(Math.round(t / fs.stepT), 0, fs.rect.h - 1);
  const k = (j * fs.rect.w + i) * 3;
  // `total` holds the previous pass (direct only on the first).
  return [fs.total[k], fs.total[k + 1], fs.total[k + 2]];
}

/** Cosine-weighted hemisphere directions (local frame, z = normal), stratified. */
function hemisphere(n: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const r = Math.sqrt(u);
    const phi = i * golden;
    out.push([r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - u)]);
  }
  return out;
}

function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const scale3 = (c: RGB, s: number): RGB => [c[0] * s, c[1] * s, c[2] * s];

function sphereBox(c: Axis, r: number, b: { min: Axis; max: Axis }): boolean {
  let d = 0;
  for (let i = 0; i < 3; i++) {
    const v = c[i] < b.min[i] ? b.min[i] - c[i] : c[i] > b.max[i] ? c[i] - b.max[i] : 0;
    d += v * v;
  }
  return d <= r * r;
}

function insideAny(boxes: BakeBox[], p: Axis): boolean {
  for (const b of boxes) if (insideSolid(b, p, EPS)) return true;
  return false;
}

/** Does the segment (a → b) pass through any solid? */
function occluded(boxes: BakeBox[], ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  for (const b of boxes) {
    const t = clipRay(b, ax, ay, az, dx, dy, dz);
    if (t !== null && t.t0 < 1 - EPS && t.t1 > EPS) return true;
  }
  return false;
}

/** Nearest solid hit along o + d·t, t in (0, 1], and which face of it was entered. */
function castRay(boxes: BakeBox[], ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): { t: number; faceId: number } | null {
  let best: { t: number; faceId: number } | null = null;
  for (const b of boxes) {
    const t = clipRay(b, ox, oy, oz, dx, dy, dz);
    if (!t || t.t0 <= EPS || t.t0 > 1) continue;
    if (!best || t.t0 < best.t) best = { t: t.t0, faceId: b.brushId * 64 + t.face };
  }
  return best;
}

/** Clip a ray against a convex plane set: entry/exit parameters and the entry face. */
function clipRay(b: BakeBox, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): { t0: number; t1: number; face: number } | null {
  // Cheap bounding-box rejection first.
  let t0 = -Infinity, t1 = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) {
      if (o[i] <= b.min[i] || o[i] >= b.max[i]) return null;
      continue;
    }
    let a = (b.min[i] - o[i]) / d[i], c = (b.max[i] - o[i]) / d[i];
    if (a > c) { const tmp = a; a = c; c = tmp; }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return null;
  }
  t0 = -Infinity; t1 = Infinity;
  let face = -1;
  for (const pl of b.planes) {
    const denom = pl.n[0] * dx + pl.n[1] * dy + pl.n[2] * dz;
    const dist = pl.n[0] * ox + pl.n[1] * oy + pl.n[2] * oz - pl.d;
    if (Math.abs(denom) < 1e-12) {
      if (dist >= 0) return null;
      continue;
    }
    const t = -dist / denom;
    if (denom < 0) { if (t > t0) { t0 = t; face = pl.face; } }
    else if (t < t1) t1 = t;
    if (t0 > t1) return null;
  }
  return { t0, t1, face };
}
