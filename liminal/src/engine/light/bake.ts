import { type Axis, type Face, type LightmapRect, type SolidPlanes, facePoint, insideSolid, FACES_PER_BRUSH } from './faces';
import { INCH } from './units';

/**
 * Lightmap baker, in physical units (see units.ts):
 *  - direct light from point lights and from light-emitting surfaces
 *    (Source's lights.rad idea: a fluorescent panel lights the room by
 *    itself), with hard shadow rays against brushes,
 *  - pure inverse-square falloff (Source's default attenuation) with real
 *    beam shapes: cos^n intensity and an optional hard-ish cutoff angle,
 *    which is what throws the scallop a recessed can leaves on a wall,
 *  - bounce passes using LINEAR albedo, so a surface reflects the fraction
 *    of light it really does,
 *  - ambient occlusion.
 * Output is irradiance in lux, linear, as floats. No clamping, no fudge factors.
 *
 * Pure data in, numbers out: no DOM or three.js, so it runs in a worker and in tests.
 */

export type RGB = [number, number, number];

export interface BakeLight {
  /** Position in world units (inches). */
  pos: Axis;
  /** Linear colour, normalised to luminance 1 (see kelvinToLinear). */
  color: RGB;
  /** Peak intensity in candela. */
  I0: number;
  /** Facing direction; without it the light is a bare bulb (same intensity every way). */
  dir?: Axis;
  /** Beam shape: intensity ∝ cos^n of the angle from `dir`. 1 = Lambertian. */
  n?: number;
  /** Light beyond this angle from `dir` is blocked (a can's housing). */
  cutoffDeg?: number;
  /** Softness of the cutoff edge (penumbra from the lamp's size). */
  softDeg?: number;
  /** Fraction of the beam that spills past the cutoff (reflector, trim). */
  spill?: number;
  /**
   * Direct light from this light is drawn per pixel by the shader (exact beam
   * edges, e.g. a can's scallop), so the lightmap stores only its bounce and
   * how shadowed each spot is (alpha channel), not its direct light.
   */
  dynamic?: boolean;
  /**
   * Reflected per pixel by the shader (light-emitting rectangles): counts
   * toward the alpha channel's shadow fraction, which hides reflections of
   * lights the spot can't see.
   */
  reflected?: boolean;
}

/** A light-emitting surface: its luminance in cd/m² (e.g. a fluorescent troffer ≈ 2000). */
export interface SurfaceEmitter { color: RGB; luminance: number }

export interface BakeParams {
  /** Flat extra irradiance, lux. Physically 0; a fill for taste. */
  ambient: RGB;
  /** Multiplies every light (an artist control; 1 = physical). */
  lightScale: number;
  /** 0..2 bounce passes. */
  bounces: number;
  /** 1 = physically correct bounce. */
  bounceScale: number;
  /** Rays per luxel per bounce. */
  bounceSamples: number;
  /** Spacing of the point samples a light-emitting surface is split into (world units). */
  surfaceSpacing: number;
  /** Ambient occlusion strength (needs bounces >= 1). */
  aoStrength?: number;
  /** Distance within which nearby surfaces count as occluding. */
  aoRadius?: number;
  /** How much of the occlusion also darkens baked direct light (0..1). */
  aoDirect?: number;
  /**
   * Bounces beyond the simulated ones, estimated per luxel as a geometric
   * series: last bounce × ρ/(1−ρ) per colour channel, where ρ is the average
   * albedo of the surfaces that luxel sees (Cohen et al. 1988's ambient term,
   * made local). Rooms take on the colour of their own surfaces. 0 = off.
   */
  extraBounces?: number;
  /**
   * Open sky (outdoor maps): rays that escape see sky luminance (cd/m²),
   * coloured from horizon to zenith (linear, luminance 1 each). Absent = indoors.
   */
  sky?: { luminance: number; zenith: RGB; horizon: RGB; band: number };
  /** Falloff: occlusion is raised to this power before darkening, so open
   *  wall stays untouched and only tight creases darken. 1 = linear. */
  aoCurve?: number;
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
  /** LINEAR average albedo per texture (0..1 reflectance). */
  albedo: Record<string, RGB>;
  params: BakeParams;
}

export interface BakeOutput {
  /**
   * RGBA float. RGB: irradiance in lux from baked lights' direct light plus
   * all indirect light. A: fraction of the per-pixel lights' (dynamic lights
   * and light-emitting surfaces) direct light that reaches this spot (1 = unshadowed).
   */
  pixels: Float32Array;
  /**
   * RGBA float, per texel: where the baked light (RGB above) comes from. XYZ:
   * its brightness-weighted mean direction (unit, world space); W: how
   * directional it is (|Σ lum·dir| / Σ lum: 1 = one light, 0 = even all round).
   * The shader shades the baked light with each pixel's bumped normal from it.
   */
  dirPixels: Float32Array;
  width: number;
  height: number;
  ms: number;
  luxels: number;
  lights: number;
}

/** Below this irradiance (lux) a light is considered out of range. */
const MIN_LUX = 0.02;

/** Candela of light `l` towards direction (dx,dy,dz)/d, from the light outward. */
export function intensityToward(l: BakeLight, ux: number, uy: number, uz: number): number {
  if (!l.dir) return l.I0;
  const c = ux * l.dir[0] + uy * l.dir[1] + uz * l.dir[2];
  if (c <= 0) return 0;
  let I = l.I0 * Math.pow(c, l.n ?? 1);
  if (l.cutoffDeg !== undefined) {
    const ang = (Math.acos(Math.min(1, c)) * 180) / Math.PI;
    const soft = Math.max(0.01, l.softDeg ?? 2);
    const t = Math.min(1, Math.max(0, (l.cutoffDeg + soft - ang) / (2 * soft)));
    const sp = l.spill ?? 0;
    I *= sp + (1 - sp) * t * t * (3 - 2 * t);
  }
  return I;
}

/** Distance (world units) beyond which a light gives less than MIN_LUX. */
const rangeOf = (l: BakeLight) => Math.sqrt((l.I0 * Math.max(...l.color)) / MIN_LUX) / INCH;

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
  /** Direct light from dynamic lights (already included in `direct`). */
  dynDirect: Float32Array;
  /** Shadowed/unshadowed ratio of dynamic lights' direct light (3 equal channels). */
  shadow: Float32Array;
  /** Average linear albedo of the surfaces this luxel sees (3 channels). */
  seen: Float32Array;
  /** Σ luminance × direction of the baked direct light (xyz), and Σ luminance (3 equal channels). */
  dirS: Float32Array;
  dirT: Float32Array;
  /** The same for the gathered (indirect) light of the last bounce pass. */
  indS: Float32Array;
  indT: Float32Array;
  emitting: boolean;
}

const EPS = 1e-4;

export function bake(input: BakeInput): BakeOutput {
  const t0 = Date.now();
  const p = input.params;
  const rects = new Map(input.rects);
  const boxes = input.boxes;

  const lights: BakeLight[] = input.lights.map((l) => ({ ...l, I0: l.I0 * p.lightScale }));
  // Light-emitting surfaces become a grid of small Lambertian emitters with
  // I0 = luminance × area (cd), facing out of the surface.
  for (const f of input.faces) {
    const em = input.emissive[f.tex];
    if (!em || em.luminance <= 0) continue;
    const ns = Math.max(1, Math.round(f.width / p.surfaceSpacing));
    const nt = Math.max(1, Math.round(f.height / p.surfaceSpacing));
    const cellM2 = ((f.width / ns) * (f.height / nt)) * INCH * INCH;
    for (let i = 0; i < ns; i++) {
      for (let j = 0; j < nt; j++) {
        lights.push({
          pos: facePoint(f, ((i + 0.5) * f.width) / ns, ((j + 0.5) * f.height) / nt, 0.5),
          color: em.color, I0: em.luminance * cellM2 * p.lightScale, dir: f.n, n: 1, reflected: true,
        });
      }
    }
  }
  const ranges = lights.map(rangeOf);

  // Which brushes can shadow each light (only those inside its range).
  const lightBoxes = lights.map((l, i) => boxes.filter((b) => sphereBox(l.pos, ranges[i], b)));

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
      dynDirect: new Float32Array(n * 3), shadow: new Float32Array(n * 3).fill(1), seen: new Float32Array(n * 3),
      dirS: new Float32Array(n * 3), dirT: new Float32Array(n * 3), indS: new Float32Array(n * 3), indT: new Float32Array(n * 3),
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
    // Light sources are self-lit in the shader; their lightmap stays dark.
    if (fs.emitting) continue;
    // Lights that can reach this face at all: in front of it and in range of its bounds.
    const lo = facePoint(f, 0, 0), hi = facePoint(f, f.width, f.height);
    const fmin: Axis = [Math.min(lo[0], hi[0]), Math.min(lo[1], hi[1]), Math.min(lo[2], hi[2])];
    const fmax: Axis = [Math.max(lo[0], hi[0]), Math.max(lo[1], hi[1]), Math.max(lo[2], hi[2])];
    const cand: number[] = [];
    for (let li = 0; li < lights.length; li++) {
      const l = lights[li];
      const side = (l.pos[0] - f.origin[0]) * f.n[0] + (l.pos[1] - f.origin[1]) * f.n[1] + (l.pos[2] - f.origin[2]) * f.n[2];
      if (side <= 0) continue;
      if (sphereBox(l.pos, ranges[li], { min: fmin, max: fmax })) cand.push(li);
    }
    for (let k = 0; k < fs.valid.length; k++) {
      if (!fs.valid[k]) continue;
      const px = fs.pos[k * 3], py = fs.pos[k * 3 + 1], pz = fs.pos[k * 3 + 2];
      // Shading normal: smoothed across rounded corners (Face.nS), else the face's.
      let nx = f.n[0], ny = f.n[1], nz = f.n[2];
      if (f.nS) {
        const t = Math.min(1, Math.max(0, ((k % fs.rect.w) * fs.stepS) / f.width));
        nx = f.nS[0][0] + (f.nS[1][0] - f.nS[0][0]) * t; ny = f.nS[0][1] + (f.nS[1][1] - f.nS[0][1]) * t; nz = f.nS[0][2] + (f.nS[1][2] - f.nS[0][2]) * t;
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      }
      let r = 0, g = 0, b = 0, dr = 0, dg = 0, db = 0, unshadowed = 0, lit = 0, sx = 0, sy = 0, sz = 0, st = 0;
      for (const li of cand) {
        const l = lights[li];
        const dx = l.pos[0] - px, dy = l.pos[1] - py, dz = l.pos[2] - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > ranges[li] * ranges[li]) continue;
        const d = Math.sqrt(d2) || 1e-6;
        const ndotl = (dx * nx + dy * ny + dz * nz) / d;
        if (ndotl <= 0) continue;
        const I = intensityToward(l, -dx / d, -dy / d, -dz / d);
        if (I <= 0) continue;
        // E = I·cosθ / d²  (lux, with d in metres)
        const dm = d * INCH;
        const w = (I * ndotl) / (dm * dm);
        const perPixel = l.dynamic || l.reflected;
        if (perPixel) unshadowed += w;
        if (occluded(lightBoxes[li], px, py, pz, l.pos[0], l.pos[1], l.pos[2])) continue;
        r += l.color[0] * w; g += l.color[1] * w; b += l.color[2] * w;
        if (perPixel) lit += w;
        if (l.dynamic) { dr += l.color[0] * w; dg += l.color[1] * w; db += l.color[2] * w; }
        else {
          const lum = (0.2126 * l.color[0] + 0.7152 * l.color[1] + 0.0722 * l.color[2]) * w;
          sx += (lum * dx) / d; sy += (lum * dy) / d; sz += (lum * dz) / d; st += lum;
        }
      }
      fs.dirS[k * 3] = sx; fs.dirS[k * 3 + 1] = sy; fs.dirS[k * 3 + 2] = sz;
      fs.dirT[k * 3] = fs.dirT[k * 3 + 1] = fs.dirT[k * 3 + 2] = st;
      fs.direct[k * 3] = r; fs.direct[k * 3 + 1] = g; fs.direct[k * 3 + 2] = b;
      fs.dynDirect[k * 3] = dr; fs.dynDirect[k * 3 + 1] = dg; fs.dynDirect[k * 3 + 2] = db;
      const sh = unshadowed > 1e-6 ? lit / unshadowed : 1;
      fs.shadow[k * 3] = fs.shadow[k * 3 + 1] = fs.shadow[k * 3 + 2] = sh;
    }
  }

  // ---- bounces: each luxel gathers the light reflected by whatever it sees.
  for (const fs of samples) { dilate(fs, fs.direct); fs.total.set(fs.direct); }
  const dirs = hemisphere(Math.max(1, Math.round(p.bounceSamples)));
  const lastGathered = new Map<FaceSamples, Float32Array>(), lastBounce = new Map<FaceSamples, Float32Array>();
  for (let pass = 0; pass < Math.min(2, Math.round(p.bounces)); pass++) {
    const gathered = new Map<FaceSamples, Float32Array>();
    for (const fs of samples) {
      const f = fs.face;
      const out = new Float32Array(fs.direct.length);
      gathered.set(fs, out);
      const gS = new Float32Array(fs.direct.length), gT = new Float32Array(fs.direct.length);
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
        let r = 0, g = 0, b = 0, occ = 0, qr = 0, qg = 0, qb = 0, sx = 0, sy = 0, sz = 0, st = 0;
        const acc = (lr: number, lg: number, lb: number, x: number, y: number, z: number) => {
          const lum = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
          sx += lum * x; sy += lum * y; sz += lum * z; st += lum;
        };
        const aoR = p.aoRadius ?? 24;
        for (const [a, c, h] of dirs) {
          const x = a * cr - c * sr, y = a * sr + c * cr; // rotate around the normal
          const dx = f.r[0] * x + f.u[0] * y + f.n[0] * h;
          const dy = f.r[1] * x + f.u[1] * y + f.n[1] * h;
          const dz = f.r[2] * x + f.u[2] * y + f.n[2] * h;
          const hit = castRay(boxes, px, py, pz, dx * 4096, dy * 4096, dz * 4096);
          if (!hit) {
            // Escaped: open sky above the horizon adds its radiance (π·L as exitance).
            if (p.sky && dz > 0) {
              const t = 1 - Math.exp(-dz / p.sky.band), L = p.sky.luminance * Math.PI;
              const kr = L * (p.sky.horizon[0] + (p.sky.zenith[0] - p.sky.horizon[0]) * t);
              const kg = L * (p.sky.horizon[1] + (p.sky.zenith[1] - p.sky.horizon[1]) * t);
              const kb = L * (p.sky.horizon[2] + (p.sky.zenith[2] - p.sky.horizon[2]) * t);
              r += kr; g += kg; b += kb;
              acc(kr, kg, kb, dx, dy, dz);
            }
            continue;
          }
          const dist = hit.t * 4096;
          if (pass === 0 && dist < aoR) occ += 1 - dist / aoR;
          const hs = byId.get(hit.faceId);
          if (!hs) continue;
          const v = lookup(hs, px + dx * 4096 * hit.t, py + dy * 4096 * hit.t, pz + dz * 4096 * hit.t);
          const alb = hs.emitting ? [0, 0, 0] : (input.albedo[hs.face.tex] ?? [0.5, 0.5, 0.5]);
          r += v[0] * alb[0]; g += v[1] * alb[1]; b += v[2] * alb[2];
          acc(v[0] * alb[0], v[1] * alb[1], v[2] * alb[2], dx, dy, dz);
          qr += alb[0]; qg += alb[1]; qb += alb[2];
        }
        out[k * 3] = (r / dirs.length) * p.bounceScale;
        out[k * 3 + 1] = (g / dirs.length) * p.bounceScale;
        out[k * 3 + 2] = (b / dirs.length) * p.bounceScale;
        const ks = p.bounceScale / dirs.length;
        gS[k * 3] = sx * ks; gS[k * 3 + 1] = sy * ks; gS[k * 3 + 2] = sz * ks;
        gT[k * 3] = gT[k * 3 + 1] = gT[k * 3 + 2] = st * ks;
        if (pass === 0) {
          fs.seen[k * 3] = qr / dirs.length; fs.seen[k * 3 + 1] = qg / dirs.length; fs.seen[k * 3 + 2] = qb / dirs.length;
          // Occlusion 0..1; the curve shapes WHERE it darkens (higher = only the
          // tightest creases), strength caps HOW MUCH (never below 1 - strength).
          const o = Math.min(1, (occ / dirs.length) * 2.2);
          const ao = 1 - (p.aoStrength ?? 0) * Math.pow(o, p.aoCurve ?? 1);
          fs.ao[k * 3] = fs.ao[k * 3 + 1] = fs.ao[k * 3 + 2] = ao;
        }
      }
      fillSkipped(out, rw, rh, fs.valid, onGrid);
      // Indirect light is smooth in reality; blur away sampling noise (blotches).
      smooth(out, rw, rh, fs.valid, 2);
      fillSkipped(gS, rw, rh, fs.valid, onGrid); smooth(gS, rw, rh, fs.valid, 2);
      fillSkipped(gT, rw, rh, fs.valid, onGrid); smooth(gT, rw, rh, fs.valid, 2);
      fs.indS = gS; fs.indT = gT;
      if (pass === 0) { fillSkipped(fs.ao, rw, rh, fs.valid, onGrid); smooth(fs.ao, rw, rh, fs.valid, 1); fillSkipped(fs.seen, rw, rh, fs.valid, onGrid); smooth(fs.seen, rw, rh, fs.valid, 2); }
    }
    // Next pass bounces what this one gathered.
    for (const fs of samples) {
      const gth = gathered.get(fs)!;
      const prev = lastGathered.get(fs);
      // The bounce added by this pass alone (pass 1 gathers bounce 1, pass 2 bounces 1+2).
      const only = new Float32Array(gth.length);
      for (let i = 0; i < gth.length; i++) only[i] = prev ? Math.max(0, gth[i] - prev[i]) : gth[i];
      lastBounce.set(fs, only);
      lastGathered.set(fs, gth);
      for (let i = 0; i < fs.total.length; i++) fs.total[i] = fs.direct[i] + gth[i];
    }
  }
  // The rest of the bounces, geometric series per channel.
  const xb = p.extraBounces ?? 0;
  if (xb > 0) for (const fs of samples) {
    const lb = lastBounce.get(fs);
    if (!lb || fs.emitting) continue;
    for (let i = 0; i < fs.total.length; i++) {
      const rho = Math.min(0.85, fs.seen[i]);
      fs.total[i] += xb * lb[i] * (rho / (1 - rho));
    }
  }

  // ---- write the atlas
  const pixels = new Float32Array(input.width * input.height * 4);
  const dirPixels = new Float32Array(input.width * input.height * 4);
  const ambLum = 0.2126 * p.ambient[0] + 0.7152 * p.ambient[1] + 0.0722 * p.ambient[2];
  for (const fs of samples) {
    dilate(fs, fs.total);
    dilate(fs, fs.direct);
    dilate(fs, fs.ao);
    dilate(fs, fs.dynDirect);
    dilate(fs, fs.shadow);
    dilate(fs, fs.dirS); dilate(fs, fs.dirT); dilate(fs, fs.indS); dilate(fs, fs.indT);
    const { rect } = fs;
    const fn = fs.face.n;
    for (let j = 0; j < rect.h; j++) {
      for (let i = 0; i < rect.w; i++) {
        const k = j * rect.w + i;
        const o = ((rect.y + j) * input.width + rect.x + i) * 4;
        // Occlusion darkens indirect and ambient light fully, direct light by
        // aoDirect: the dark band along the bottom of walls and into corners
        // that camcorder footage of real rooms shows (the Mall Run study).
        const ao = fs.ao[k * 3], aoDirect = 1 - (1 - ao) * (p.aoDirect ?? 0.35);
        for (let c = 0; c < 3; c++) {
          const direct = fs.direct[k * 3 + c], indirect = fs.total[k * 3 + c] - direct;
          const bakedDirect = direct - fs.dynDirect[k * 3 + c]; // dynamic lights are drawn per pixel
          pixels[o + c] = bakedDirect * aoDirect + (indirect + p.ambient[c]) * ao;
        }
        pixels[o + 3] = fs.shadow[k * 3];
        // Where the baked light comes from: direct (as attenuated above) + gathered + even ambient.
        const sx = fs.dirS[k * 3] * aoDirect + fs.indS[k * 3] * ao;
        const sy = fs.dirS[k * 3 + 1] * aoDirect + fs.indS[k * 3 + 1] * ao;
        const sz = fs.dirS[k * 3 + 2] * aoDirect + fs.indS[k * 3 + 2] * ao;
        const st = fs.dirT[k * 3] * aoDirect + fs.indT[k * 3] * ao + ambLum * ao;
        const len = Math.hypot(sx, sy, sz);
        if (len > 1e-9 && st > 1e-9) {
          dirPixels[o] = sx / len; dirPixels[o + 1] = sy / len; dirPixels[o + 2] = sz / len;
          dirPixels[o + 3] = Math.min(1, len / st);
        } else { dirPixels[o] = fn[0]; dirPixels[o + 1] = fn[1]; dirPixels[o + 2] = fn[2]; dirPixels[o + 3] = 0; }
      }
    }
  }
  return { pixels, dirPixels, width: input.width, height: input.height, ms: Date.now() - t0, luxels, lights: lights.length };
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
    if (!best || t.t0 < best.t) best = { t: t.t0, faceId: b.brushId * FACES_PER_BRUSH + t.face };
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
