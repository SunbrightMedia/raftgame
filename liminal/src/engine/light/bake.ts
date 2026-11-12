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
  /** A downward light's glow in every direction, as a fraction of its peak (a flush mount's glass sends ~6 % of its
   * peak intensity up and sideways, ~12 % of its light: what lights the ceiling round it). */
  iso?: number;
  /** Size of the glowing part, inches across (a dome's glass): widens its reflection on glossy surfaces. Default 2. */
  size?: number;
  /**
   * Direct light from this light is drawn per pixel by the shader (exact beam
   * edges, e.g. a can's scallop), so the lightmap stores only its bounce and
   * how shadowed each spot is (alpha channel), not its direct light.
   */
  dynamic?: boolean;
  /**
   * Shadow-mask channel (0..3) of a dynamic light. Each luxel stores one
   * shadow fraction per channel; lights near each other get different
   * channels, so a lamp behind a closed door can't borrow the shadow value of
   * a lamp in front of it (one shared value leaked light through doorways).
   */
  channel?: number;
  /**
   * false: the per-pixel direct light of this (dynamic) light ignores
   * geometry, like Unreal's unshadowed lights (the reference capture's ceiling
   * panels: no shadow passes in the frame). Its bounce stays shadowed, as
   * Lumen shadows its own bounce light.
   */
  shadows?: boolean;
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
   * 0..1. How bounce light is gathered. 0 = physically: each spot gathers
   * what its own side of the room sends it (a ceiling over a lit floor gets
   * far more than the floor does). 1 = as engines that keep bounce light in
   * probes in the air (Unreal's Lumen, in the reference capture): each spot
   * gets the average of what is around a point lifted into the room, from
   * both sides, so floor, walls and ceiling of a room get about the same.
   */
  bounceEven?: number;
  /** With bounceEven: how far into the room that point sits (world units). */
  bounceProbe?: number;
  /**
   * Open sky (outdoor maps): rays that escape see sky luminance (cd/m²),
   * coloured from horizon to zenith (linear, luminance 1 each). Absent = indoors.
   */
  sky?: { luminance: number; zenith: RGB; horizon: RGB; band: number };
  /** Falloff: occlusion is raised to this power before darkening, so open
   *  wall stays untouched and only tight creases darken. 1 = linear. */
  aoCurve?: number;
  /**
   * World spacing (units) of the points where bounce light is gathered; the luxels between are interpolated.
   * Indirect light is smooth, so a fine-luxel face (a door's 0.4" luxels) gathers on this grid like an ordinary
   * face instead of on every 2nd luxel: its few rays per point then average out over the same area, rather than
   * showing as specks. Default: every 2nd luxel.
   */
  gatherSpacing?: number;
  /**
   * Firefly limit. One bounce ray's light is capped at this many times the brightness that 99.5 % of the scene's
   * surface area stays under. A small, very bright spot (the ceiling an inch from a lamp) is otherwise a blotch
   * wherever some ray happens to hit it. 0 = off.
   */
  bounceClamp?: number;
}

/** Shadow casters: every solid brush as a convex plane set. */
export type BakeBox = SolidPlanes;

export interface BakeInput {
  /** Per texture: how far luxel samples sit off the surface (default 1"). Fine-luxel faces need less, or a
   * shallow recess (a door panel's step) could never shadow itself. */
  lift?: Record<string, number>;
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
  /**
   * Points on props (models) to light: world positions and normals, xyz each. Props have no lightmap: they
   * draw with this light per vertex (direct light from every light, shadowed by the room, plus the room's
   * bounced light gathered at the point and the ambient fill).
   */
  probes?: { pos: Float32Array; nrm: Float32Array };
  /** Solids from this index on are props' shadow shapes: they shadow the room, but not the probes. */
  propBoxStart?: number;
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
  /** RGBA float: per shadow-mask channel, the fraction of that channel's dynamic lights' direct light that reaches each texel. */
  maskPixels: Float32Array;
  width: number;
  height: number;
  ms: number;
  luxels: number;
  lights: number;
  /** Irradiance (lux, RGB) at each of input.probes. */
  probeLight?: Float32Array;
}

/** Below this irradiance (lux) a light is considered out of range. */
const MIN_LUX = 0.02;

/** Candela of light `l` towards direction (dx,dy,dz)/d, from the light outward. */
export function intensityToward(l: BakeLight, ux: number, uy: number, uz: number): number {
  if (!l.dir) return l.I0;
  const c = ux * l.dir[0] + uy * l.dir[1] + uz * l.dir[2];
  const iso = l.iso ? l.I0 * l.iso : 0;
  if (c <= 0) return iso;
  let I = l.I0 * Math.pow(c, l.n ?? 1);
  if (l.cutoffDeg !== undefined) {
    const ang = (Math.acos(Math.min(1, c)) * 180) / Math.PI;
    const soft = Math.max(0.01, l.softDeg ?? 2);
    const t = Math.min(1, Math.max(0, (l.cutoffDeg + soft - ang) / (2 * soft)));
    const sp = l.spill ?? 0;
    I *= sp + (1 - sp) * t * t * (3 - 2 * t);
  }
  return I + iso;
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
  /** Shadow fraction per mask channel: channels 0-2 here, channel 3 in mask3 (3 equal values). */
  mask: Float32Array;
  mask3: Float32Array;
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
  // One uniform grid over the solids: rays only test the brushes in the cells they pass through
  // (La Quinta's railing alone is ~900 brushes; testing every brush per ray took minutes).
  const grid = new SolidGrid(boxes);

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
      mask: new Float32Array(n * 3).fill(1), mask3: new Float32Array(n * 3).fill(1),
      emitting: !!input.emissive[f.tex],
    };
    // Samples keep half an inch off the face's edges (no light leaking in round corners), except on fine-luxel
    // faces, whose edge is where their small shadows fall.
    const fine = input.lift?.[f.tex], lift = fine ?? 1, edge = fine !== undefined ? 0.05 : 0.5;
    for (let j = 0; j < rect.h; j++) {
      for (let i = 0; i < rect.w; i++) {
        const s = clamp(i * fs.stepS, edge, f.width - edge);
        const t = clamp(j * fs.stepT, edge, f.height - edge);
        const q = facePoint(f, s, t, lift);
        const k = j * rect.w + i;
        fs.pos[k * 3] = q[0]; fs.pos[k * 3 + 1] = q[1]; fs.pos[k * 3 + 2] = q[2];
        fs.valid[k] = grid.inside(q) ? 0 : 1;
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
      const cu = [0, 0, 0, 0], cl = [0, 0, 0, 0];
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
        const ch = l.dynamic ? (l.channel ?? 0) : -1;
        if (ch >= 0) cu[ch] += w;
        const unshadowedLight = l.shadows === false;
        if (unshadowedLight) { if (perPixel) lit += w; if (ch >= 0) cl[ch] += w; }
        if (grid.occluded(px, py, pz, l.pos[0], l.pos[1], l.pos[2])) continue;
        r += l.color[0] * w; g += l.color[1] * w; b += l.color[2] * w;
        if (!unshadowedLight) { if (perPixel) lit += w; if (ch >= 0) cl[ch] += w; }
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
      for (let c = 0; c < 3; c++) fs.mask[k * 3 + c] = cu[c] > 1e-6 ? cl[c] / cu[c] : 1;
      fs.mask3[k * 3] = fs.mask3[k * 3 + 1] = fs.mask3[k * 3 + 2] = cu[3] > 1e-6 ? cl[3] / cu[3] : 1;
    }
  }

  // ---- bounces: each luxel gathers the light reflected by whatever it sees.
  for (const fs of samples) { dilate(fs, fs.direct); fs.total.set(fs.direct); }
  const dirs = hemisphere(Math.max(1, Math.round(p.bounceSamples)));
  const even = clamp(p.bounceEven ?? 0, 0, 1), probe = p.bounceProbe ?? 24;
  const lastGathered = new Map<FaceSamples, Float32Array>(), lastBounce = new Map<FaceSamples, Float32Array>();
  const clampK = p.bounceClamp ?? 4;
  let capLum = Infinity;
  for (let pass = 0; pass < Math.min(2, Math.round(p.bounces)); pass++) {
    const gathered = new Map<FaceSamples, Float32Array>();
    capLum = clampK > 0 ? clampK * exitanceQuantile(samples, input.albedo, 0.995) : Infinity;
    // A bounce ray's light (exitance of what it hit), capped (see bounceClamp).
    const cap = (r: number, g: number, b: number) => {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return l > capLum ? capLum / l : 1;
    };
    for (const fs of samples) {
      const f = fs.face;
      const out = new Float32Array(fs.direct.length);
      gathered.set(fs, out);
      const gS = new Float32Array(fs.direct.length), gT = new Float32Array(fs.direct.length);
      if (fs.emitting) continue;
      // Indirect light is smooth: gather on a grid (every 2nd luxel, or every `gatherSpacing` units on fine-luxel
      // faces; plus the last row/column) and interpolate the rest.
      const { w: rw, h: rh } = fs.rect;
      const si = gatherStride(p, fs.stepS), sj = gatherStride(p, fs.stepT);
      const onGrid = (i: number, n: number, s: number) => i % s === 0 || i === n - 1;
      for (let k = 0; k < fs.valid.length; k++) {
        const ki = k % rw, kj = (k - ki) / rw;
        if (!onGrid(ki, rw, si) || !onGrid(kj, rh, sj)) continue;
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
          const hit = grid.cast(px, py, pz, dx * 4096, dy * 4096, dz * 4096);
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
          const er = v[0] * alb[0], eg = v[1] * alb[1], eb = v[2] * alb[2], kc = cap(er, eg, eb);
          r += er * kc; g += eg * kc; b += eb * kc;
          acc(er * kc, eg * kc, eb * kc, dx, dy, dz);
          qr += alb[0]; qg += alb[1]; qb += alb[2];
        }
        if (even > 0) {
          // The other half of a probe in the room's air: from a point lifted off the
          // surface (never past whatever is in front of it), the hemisphere facing
          // back towards the surface. Averaged with the half above, it is the light
          // all around that point, whichever way the surface faces.
          const lift = grid.cast(px, py, pz, f.n[0] * probe, f.n[1] * probe, f.n[2] * probe);
          const d = lift ? Math.max(0.5, lift.t * probe * 0.5) : probe;
          const ox = px + f.n[0] * d, oy = py + f.n[1] * d, oz = pz + f.n[2] * d;
          let er = 0, eg = 0, eb = 0;
          for (const [a, c, h] of dirs) {
            const x = a * cr - c * sr, y = a * sr + c * cr;
            const dx = f.r[0] * x + f.u[0] * y - f.n[0] * h;
            const dy = f.r[1] * x + f.u[1] * y - f.n[1] * h;
            const dz = f.r[2] * x + f.u[2] * y - f.n[2] * h;
            const hit = grid.cast(ox, oy, oz, dx * 4096, dy * 4096, dz * 4096);
            if (!hit) {
              if (p.sky && dz > 0) {
                const t = 1 - Math.exp(-dz / p.sky.band), L = p.sky.luminance * Math.PI;
                er += L * (p.sky.horizon[0] + (p.sky.zenith[0] - p.sky.horizon[0]) * t);
                eg += L * (p.sky.horizon[1] + (p.sky.zenith[1] - p.sky.horizon[1]) * t);
                eb += L * (p.sky.horizon[2] + (p.sky.zenith[2] - p.sky.horizon[2]) * t);
              }
              continue;
            }
            const hs = byId.get(hit.faceId);
            if (!hs || hs.emitting) continue;
            const v = lookup(hs, ox + dx * 4096 * hit.t, oy + dy * 4096 * hit.t, oz + dz * 4096 * hit.t);
            const alb = input.albedo[hs.face.tex] ?? [0.5, 0.5, 0.5];
            const kc = cap(v[0] * alb[0], v[1] * alb[1], v[2] * alb[2]);
            er += v[0] * alb[0] * kc; eg += v[1] * alb[1] * kc; eb += v[2] * alb[2] * kc;
          }
          const w = even / 2;
          r = r * (1 - w) + er * w; g = g * (1 - w) + eg * w; b = b * (1 - w) + eb * w;
          // The even part has no direction: it only weakens the directional lightmap.
          sx *= 1 - w; sy *= 1 - w; sz *= 1 - w;
          st = st * (1 - w) + (0.2126 * er + 0.7152 * eg + 0.0722 * eb) * w;
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
      // Indirect light is smooth in reality; blur away sampling noise (blotches). On a coarse gather grid the grid
      // points are first averaged with their neighbours, as the luxel blur does on an ordinary face.
      const fill = (buf: Float32Array, passes: number) => {
        if (si > 2 || sj > 2) smoothGrid(buf, rw, rh, fs.valid, si, sj);
        fillSkipped(buf, rw, rh, fs.valid, si, sj);
        smooth(buf, rw, rh, fs.valid, passes);
      };
      fill(out, 2); fill(gS, 2); fill(gT, 2);
      fs.indS = gS; fs.indT = gT;
      if (pass === 0) { fill(fs.ao, 1); fill(fs.seen, 2); }
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

  // ---- props: light at their vertices, from the finished room (all bounces in)
  let probeLight: Float32Array | undefined;
  if (input.probes && input.probes.pos.length >= 3) {
    const own = input.propBoxStart !== undefined && input.propBoxStart < boxes.length ? new SolidGrid(boxes.slice(0, input.propBoxStart)) : grid;
    probeLight = lightProbes(input.probes, lights, ranges, own, byId, input.albedo, p, capLum);
  }

  // ---- write the atlas
  const pixels = new Float32Array(input.width * input.height * 4);
  const dirPixels = new Float32Array(input.width * input.height * 4);
  const maskPixels = new Float32Array(input.width * input.height * 4).fill(1);
  const ambLum = 0.2126 * p.ambient[0] + 0.7152 * p.ambient[1] + 0.0722 * p.ambient[2];
  for (const fs of samples) {
    dilate(fs, fs.total);
    dilate(fs, fs.direct);
    dilate(fs, fs.ao);
    dilate(fs, fs.dynDirect);
    dilate(fs, fs.shadow);
    dilate(fs, fs.dirS); dilate(fs, fs.dirT); dilate(fs, fs.indS); dilate(fs, fs.indT);
    dilate(fs, fs.mask); dilate(fs, fs.mask3);
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
        maskPixels[o] = fs.mask[k * 3]; maskPixels[o + 1] = fs.mask[k * 3 + 1]; maskPixels[o + 2] = fs.mask[k * 3 + 2]; maskPixels[o + 3] = fs.mask3[k * 3];
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
  return { pixels, dirPixels, maskPixels, width: input.width, height: input.height, ms: Date.now() - t0, luxels, lights: lights.length, ...(probeLight ? { probeLight } : {}) };
}

/**
 * Irradiance (lux, RGB) at points on props: direct light from every light (per-pixel ones too: a prop has no
 * per-pixel lights), shadowed by `grid`; the light the finished room reflects towards the point, gathered over
 * its hemisphere; the ambient fill, darkened by what is close round the point.
 */
function lightProbes(pr: { pos: Float32Array; nrm: Float32Array }, lights: BakeLight[], ranges: number[], grid: SolidGrid, byId: Map<number, FaceSamples>, albedo: Record<string, RGB>, p: BakeParams, capLum = Infinity): Float32Array {
  const n = pr.pos.length / 3, out = new Float32Array(n * 3);
  const dirs = hemisphere(Math.max(16, Math.round(p.bounceSamples)));
  const aoR = p.aoRadius ?? 24;
  for (let i = 0; i < n; i++) {
    let nx = pr.nrm[i * 3], ny = pr.nrm[i * 3 + 1], nz = pr.nrm[i * 3 + 2];
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const px = pr.pos[i * 3] + nx * 0.25, py = pr.pos[i * 3 + 1] + ny * 0.25, pz = pr.pos[i * 3 + 2] + nz * 0.25;
    let r = 0, g = 0, b = 0;
    for (let li = 0; li < lights.length; li++) {
      const l = lights[li];
      const dx = l.pos[0] - px, dy = l.pos[1] - py, dz = l.pos[2] - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > ranges[li] * ranges[li]) continue;
      const d = Math.sqrt(d2) || 1e-6;
      const ndotl = (dx * nx + dy * ny + dz * nz) / d;
      if (ndotl <= 0) continue;
      const I = intensityToward(l, -dx / d, -dy / d, -dz / d);
      if (I <= 0) continue;
      if (l.shadows !== false && grid.occluded(px, py, pz, l.pos[0], l.pos[1], l.pos[2])) continue;
      const dm = d * INCH, w = (I * ndotl) / (dm * dm);
      r += l.color[0] * w; g += l.color[1] * w; b += l.color[2] * w;
    }
    // a frame round the normal for the gather
    let tx = -ny, ty = nx, tz = 0;
    if (Math.abs(nz) > 0.9) { tx = 0; ty = -nz; tz = ny; }
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const rot = hash(i * 7919 + 17) * Math.PI * 2, cr = Math.cos(rot), sr = Math.sin(rot);
    let ir = 0, ig = 0, ib = 0, occ = 0;
    for (const [a, c, h] of dirs) {
      const x = a * cr - c * sr, y = a * sr + c * cr;
      const dx = tx * x + bx * y + nx * h, dy = ty * x + by * y + ny * h, dz = tz * x + bz * y + nz * h;
      const hit = grid.cast(px, py, pz, dx * 4096, dy * 4096, dz * 4096);
      if (!hit) {
        if (p.sky && dz > 0) {
          const t = 1 - Math.exp(-dz / p.sky.band), L = p.sky.luminance * Math.PI;
          ir += L * (p.sky.horizon[0] + (p.sky.zenith[0] - p.sky.horizon[0]) * t);
          ig += L * (p.sky.horizon[1] + (p.sky.zenith[1] - p.sky.horizon[1]) * t);
          ib += L * (p.sky.horizon[2] + (p.sky.zenith[2] - p.sky.horizon[2]) * t);
        }
        continue;
      }
      const dist = hit.t * 4096;
      if (dist < aoR) occ += 1 - dist / aoR;
      const hs = byId.get(hit.faceId);
      if (!hs || hs.emitting) continue;
      const v = lookup(hs, px + dx * 4096 * hit.t, py + dy * 4096 * hit.t, pz + dz * 4096 * hit.t);
      const alb = albedo[hs.face.tex] ?? [0.5, 0.5, 0.5];
      const er = v[0] * alb[0], eg = v[1] * alb[1], eb = v[2] * alb[2], el = 0.2126 * er + 0.7152 * eg + 0.0722 * eb;
      const kc = el > capLum ? capLum / el : 1;
      ir += er * kc; ig += eg * kc; ib += eb * kc;
    }
    const k = p.bounceScale / dirs.length;
    const o = Math.min(1, (occ / dirs.length) * 2.2), ao = 1 - (p.aoStrength ?? 0) * Math.pow(o, p.aoCurve ?? 1);
    out[i * 3] = r + (ir * k + p.ambient[0]) * ao;
    out[i * 3 + 1] = g + (ig * k + p.ambient[1]) * ao;
    out[i * 3 + 2] = b + (ib * k + p.ambient[2]) * ao;
  }
  return out;
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

/** Luxels between bounce-gather points along an axis with this luxel step (see BakeParams.gatherSpacing). */
function gatherStride(p: BakeParams, step: number): number {
  return p.gatherSpacing ? Math.max(2, Math.round(p.gatherSpacing / Math.max(1e-3, step))) : 2;
}

/**
 * Exitance (luminance of total light × albedo) that fraction `q` of the scene's surface AREA stays under. Area,
 * not luxel count: fine-luxel faces have many luxels and would otherwise set the level.
 */
function exitanceQuantile(samples: FaceSamples[], albedo: Record<string, RGB>, q: number): number {
  let count = 0;
  for (const fs of samples) if (!fs.emitting) count += fs.valid.length;
  const every = Math.max(1, Math.ceil(count / 200000));
  const vals: number[] = [], wts: number[] = [];
  let n = 0;
  for (const fs of samples) {
    if (fs.emitting) continue;
    const a = albedo[fs.face.tex] ?? [0.5, 0.5, 0.5], area = fs.stepS * fs.stepT;
    for (let k = 0; k < fs.valid.length; k++) {
      if (n++ % every || !fs.valid[k]) continue;
      vals.push(0.2126 * fs.total[k * 3] * a[0] + 0.7152 * fs.total[k * 3 + 1] * a[1] + 0.0722 * fs.total[k * 3 + 2] * a[2]);
      wts.push(area);
    }
  }
  if (!vals.length) return Infinity;
  const idx = vals.map((_, i) => i).sort((x, y) => vals[x] - vals[y]);
  let total = 0;
  for (const w of wts) total += w;
  let acc = 0;
  for (const i of idx) { acc += wts[i]; if (acc >= q * total) return Math.max(vals[i], 1e-6); }
  return vals[idx[idx.length - 1]];
}

/** One 3×3 average of the gather-grid points (every si-th column, sj-th row, plus the last) with their valid grid neighbours. */
function smoothGrid(buf: Float32Array, w: number, h: number, valid: Uint8Array, si: number, sj: number): void {
  const cols: number[] = [], rows: number[] = [];
  for (let i = 0; i < w; i++) if (i % si === 0 || i === w - 1) cols.push(i);
  for (let j = 0; j < h; j++) if (j % sj === 0 || j === h - 1) rows.push(j);
  const src = buf.slice();
  for (let b = 0; b < rows.length; b++) for (let a = 0; a < cols.length; a++) {
    const k = rows[b] * w + cols[a];
    if (!valid[k]) continue;
    let r = 0, g = 0, bl = 0, n = 0;
    for (let db = -1; db <= 1; db++) for (let da = -1; da <= 1; da++) {
      const aa = a + da, bb = b + db;
      if (aa < 0 || bb < 0 || aa >= cols.length || bb >= rows.length) continue;
      const q = rows[bb] * w + cols[aa];
      if (!valid[q]) continue;
      r += src[q * 3]; g += src[q * 3 + 1]; bl += src[q * 3 + 2]; n++;
    }
    buf[k * 3] = r / n; buf[k * 3 + 1] = g / n; buf[k * 3 + 2] = bl / n;
  }
}

/** Interpolate the luxels the bounce pass skipped (linearly) from the gathered grid points around them. */
function fillSkipped(buf: Float32Array, w: number, h: number, valid: Uint8Array, si = 2, sj = 2): void {
  const on = (i: number, n: number, s: number) => i % s === 0 || i === n - 1;
  // Which luxels hold a value: gathered grid points that are valid, then what is interpolated from them.
  const known = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    if (!on(j, h, sj)) continue;
    for (let i = 0; i < w; i++) if (on(i, w, si) && valid[j * w + i]) known[j * w + i] = 1;
  }
  const lerp = (k: number, k0: number, k1: number, t: number) => {
    const a = known[k0], b = known[k1];
    if (!a && !b) return;
    const u = !a ? 1 : !b ? 0 : t;
    for (let c = 0; c < 3; c++) buf[k * 3 + c] = buf[k0 * 3 + c] * (1 - u) + buf[k1 * 3 + c] * u;
    known[k] = 1;
  };
  // Grid rows: the columns between grid columns.
  for (let j = 0; j < h; j++) {
    if (!on(j, h, sj)) continue;
    for (let i = 0; i < w; i++) {
      if (on(i, w, si)) continue;
      const i0 = Math.floor(i / si) * si, i1 = Math.min(i0 + si, w - 1);
      lerp(j * w + i, j * w + i0, j * w + i1, (i - i0) / (i1 - i0));
    }
  }
  // Other rows: between the grid rows above and below.
  for (let j = 0; j < h; j++) {
    if (on(j, h, sj)) continue;
    const j0 = Math.floor(j / sj) * sj, j1 = Math.min(j0 + sj, h - 1);
    for (let i = 0; i < w; i++) lerp(j * w + i, j0 * w + i, j1 * w + i, (j - j0) / (j1 - j0));
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

/** Reference (every brush) versions of the grid queries; tests check the grid against them. */
export function insideAny(boxes: BakeBox[], p: Axis): boolean {
  for (const b of boxes) if (insideSolid(b, p, EPS)) return true;
  return false;
}

/** Does the segment (a → b) pass through any solid? */
export function occluded(boxes: BakeBox[], ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  for (const b of boxes) {
    const t = clipRay(b, ax, ay, az, dx, dy, dz);
    if (t !== null && t.t0 < 1 - EPS && t.t1 > EPS) return true;
  }
  return false;
}

/** Nearest solid hit along o + d·t, t in (0, 1], and which face of it was entered. */
export function castRay(boxes: BakeBox[], ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): { t: number; faceId: number } | null {
  let best: { t: number; faceId: number } | null = null;
  for (const b of boxes) {
    const t = clipRay(b, ox, oy, oz, dx, dy, dz);
    if (!t || t.t0 > 1 || t.t1 <= EPS) continue;
    // A ray that starts on (or in) another solid and heads into it is blocked right there.
    // Samples sit exactly on a solid where brushes touch (a jamb against a closed door);
    // skipping that hit let them gather light from the room behind the door.
    const t0 = Math.max(t.t0, EPS);
    if (!best || t0 < best.t) best = { t: t0, faceId: b.brushId * FACES_PER_BRUSH + t.face };
  }
  return best;
}

/**
 * Uniform grid over the solids (Amanatides & Woo 1987 traversal). Same answers
 * as testing every brush, but a ray only looks at brushes in the cells it crosses.
 */
export class SolidGrid {
  private min: Axis = [0, 0, 0];
  private max: Axis = [0, 0, 0];
  private cell = 1;
  private n: [number, number, number] = [1, 1, 1];
  private start: Int32Array;
  private items: Int32Array;
  private stamp: Int32Array;
  private mark = 0;

  constructor(private boxes: BakeBox[]) {
    const lo: Axis = [Infinity, Infinity, Infinity], hi: Axis = [-Infinity, -Infinity, -Infinity];
    for (const b of boxes) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], b.min[i]); hi[i] = Math.max(hi[i], b.max[i]); }
    if (!boxes.length) { lo[0] = lo[1] = lo[2] = 0; hi[0] = hi[1] = hi[2] = 1; }
    for (let i = 0; i < 3; i++) { this.min[i] = lo[i] - 1; this.max[i] = hi[i] + 1; }
    const ext = Math.max(this.max[0] - this.min[0], this.max[1] - this.min[1], this.max[2] - this.min[2]);
    this.cell = Math.max(12, ext / 64);
    this.n = [0, 1, 2].map((i) => Math.max(1, Math.ceil((this.max[i] - this.min[i]) / this.cell))) as [number, number, number];
    const total = this.n[0] * this.n[1] * this.n[2];
    const count = new Int32Array(total + 1);
    const span = (b: BakeBox, f: (c: number) => void) => {
      const a = [0, 1, 2].map((i) => this.idx(b.min[i], i)), z = [0, 1, 2].map((i) => this.idx(b.max[i], i));
      for (let x = a[0]; x <= z[0]; x++) for (let y = a[1]; y <= z[1]; y++) for (let w = a[2]; w <= z[2]; w++) f((w * this.n[1] + y) * this.n[0] + x);
    };
    for (const b of boxes) span(b, (c) => count[c + 1]++);
    for (let i = 0; i < total; i++) count[i + 1] += count[i];
    this.start = count;
    this.items = new Int32Array(count[total]);
    const fill = count.slice();
    boxes.forEach((b, bi) => span(b, (c) => { this.items[fill[c]++] = bi; }));
    this.stamp = new Int32Array(boxes.length);
  }

  private idx(v: number, axis: number): number {
    return Math.min(this.n[axis] - 1, Math.max(0, Math.floor((v - this.min[axis]) / this.cell)));
  }

  /** Visit the cells along o + d·t, t in [0, tMax], in order; `fn` returns true to stop. */
  private walk(o: Axis, d: Axis, tMax: number, fn: (cell: number, tExit: number) => boolean): void {
    let t0 = 0, t1 = tMax;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-12) { if (o[i] < this.min[i] || o[i] > this.max[i]) return; continue; }
      let a = (this.min[i] - o[i]) / d[i], b = (this.max[i] - o[i]) / d[i];
      if (a > b) { const t = a; a = b; b = t; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return;
    }
    const c = [0, 1, 2].map((i) => this.idx(o[i] + d[i] * t0, i));
    const step = [0, 1, 2].map((i) => (d[i] > 0 ? 1 : d[i] < 0 ? -1 : 0));
    const tNext = [0, 1, 2].map((i) => step[i] === 0 ? Infinity : (this.min[i] + (c[i] + (step[i] > 0 ? 1 : 0)) * this.cell - o[i]) / d[i]);
    const tDelta = [0, 1, 2].map((i) => step[i] === 0 ? Infinity : this.cell / Math.abs(d[i]));
    for (;;) {
      const tExit = Math.min(tNext[0], tNext[1], tNext[2], t1);
      if (fn((c[2] * this.n[1] + c[1]) * this.n[0] + c[0], tExit)) return;
      if (tExit >= t1) return;
      const a = tNext[0] <= tNext[1] && tNext[0] <= tNext[2] ? 0 : tNext[1] <= tNext[2] ? 1 : 2;
      c[a] += step[a];
      if (c[a] < 0 || c[a] >= this.n[a]) return;
      tNext[a] += tDelta[a];
    }
  }

  /** Nearest solid hit along o + d·t, t in (0, 1] (see castRay for the rules). */
  cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): { t: number; faceId: number } | null {
    let best: { t: number; faceId: number } | null = null;
    const m = ++this.mark;
    this.walk([ox, oy, oz], [dx, dy, dz], 1, (cell, tExit) => {
      for (let k = this.start[cell]; k < this.start[cell + 1]; k++) {
        const bi = this.items[k];
        if (this.stamp[bi] === m) continue;
        this.stamp[bi] = m;
        const b = this.boxes[bi];
        const t = clipRay(b, ox, oy, oz, dx, dy, dz);
        if (!t || t.t0 > 1 || t.t1 <= EPS) continue;
        const t0 = Math.max(t.t0, EPS);
        if (!best || t0 < best.t) best = { t: t0, faceId: b.brushId * FACES_PER_BRUSH + t.face };
      }
      return best !== null && best.t <= tExit;
    });
    return best;
  }

  /** Does the segment a → b pass through any solid? (as occluded()) */
  occluded(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    let hit = false;
    const m = ++this.mark;
    this.walk([ax, ay, az], [dx, dy, dz], 1, (cell) => {
      for (let k = this.start[cell]; k < this.start[cell + 1]; k++) {
        const bi = this.items[k];
        if (this.stamp[bi] === m) continue;
        this.stamp[bi] = m;
        const t = clipRay(this.boxes[bi], ax, ay, az, dx, dy, dz);
        if (t !== null && t.t0 < 1 - EPS && t.t1 > EPS) { hit = true; return true; }
      }
      return false;
    });
    return hit;
  }

  inside(p: Axis): boolean {
    for (let i = 0; i < 3; i++) if (p[i] < this.min[i] || p[i] > this.max[i]) return false;
    const cell = (this.idx(p[2], 2) * this.n[1] + this.idx(p[1], 1)) * this.n[0] + this.idx(p[0], 0);
    for (let k = this.start[cell]; k < this.start[cell + 1]; k++) if (insideSolid(this.boxes[this.items[k]], p, EPS)) return true;
    return false;
  }
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
