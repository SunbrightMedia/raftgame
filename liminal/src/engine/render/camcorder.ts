import * as THREE from 'three';
import { Rng } from '../../world/rng';
import { kelvinToLinear } from '../light/units';

/**
 * A camcorder look rebuilt from a frame capture of a reference game
 * (reference/complex/FINDINGS.md). Our own code and our own textures; the
 * numbers are the ones measured there.
 *
 *  1. Fixed exposure, then a warm multiplier on the picture (measured
 *     0.84 / 0.83 / 0.64).
 *  2. Glow from the whole picture, no threshold: 0.19 of it spread by three
 *     Gaussians fitted to the measured spread (σ 0.6%, 2.5%, 8% of the width,
 *     weights 0.61 / 0.24 / 0.15), times (1 + dirt × lens dirt).
 *  3. Colour fringe (red and green pulled in towards the middle), cos⁴
 *     vignette, the filmic tone curve with its default settings (ACES-based:
 *     glow and red modifiers, blue correction, gamut expansion, toe 0.55,
 *     shoulder 0.26, slope 0.88), sRGB.
 *  4. Luma sharpening (amount 7, 1 px cross), 25 steps per channel, grain,
 *     then the tape pass: slow hue wobble, lifted black, per-line colour
 *     noise, horizontal streaks.
 *  5. Lens bend and a 4:3 picture with black bars.
 *
 * Options for other camcorders, all off by default (the capture's camera has
 * none of them): white balance to the lamps' colour, auto exposure, a flatter
 * scene contrast, and a glow that only lamps make (threshold) and spreads
 * wider or tighter (size). The "Infinite house" look uses all of them
 * (STYLE.md, reference 6; maps/house_iv.json).
 */
export interface CamcorderParams {
  exposure: number;
  /** White balance in kelvin: light of this colour comes out neutral (0 = off, as the capture). */
  whiteBalance: number;
  /** Auto exposure: the picture's log-average is brought to `aeKey`, within ± `aeRange` stops of `exposure`. */
  autoExposure: boolean;
  aeKey: number;
  aeRange: number;
  /** How fast auto exposure follows (per second); ≥ 100 snaps (screenshots). */
  aeRate: number;
  /** Scene contrast before the tone curve, round mid grey (1 = as is; under 1 flatter, as Blender's Filmic view). */
  contrast: number;
  /** How wide the sharpening rims are, in thousandths of the picture (1 = the capture's). */
  sharpenRadius: number;
  tintR: number; tintG: number; tintB: number;
  glow: number;
  /** Scales the glow's three widths (1 = the capture's). */
  glowSize: number;
  /** Only light brighter than this (tone-curve input units) glows; 0 = the whole picture, as the capture. */
  glowThreshold: number;
  dirt: number;
  fringe: number;
  vignette: number;
  /** Gaussian blur of the picture before everything else, σ in output pixels (the game's upscaler softness). */
  soften: number;
  sharpen: number;
  posterize: number;
  grain: number;
  lift: number;
  lineChroma: number;
  hueWobble: number;
  streaks: number;
  lens: number;
  bars: boolean;
}

// ---------------------------------------------------------------- colour maths (rows)
type M3 = number[][];
const mm = (a: M3, b: M3): M3 => a.map((r) => b[0].map((_, j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
function inv(m: M3): M3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}
const SRGB_2_AP1: M3 = [[0.613097, 0.339523, 0.047379], [0.070194, 0.916354, 0.013452], [0.020616, 0.10957, 0.869815]];
const AP1_2_SRGB: M3 = [[1.70505, -0.621792, -0.083259], [-0.130256, 1.14081, -0.010548], [-0.024003, -0.128969, 1.15297]];
const AP1_2_AP0: M3 = [[0.6954522414, 0.1406786965, 0.1638690622], [0.0447945634, 0.8596711185, 0.0955343182], [-0.0055258826, 0.0040252103, 1.0015006723]];
const AP0_2_AP1: M3 = [[1.4514393161, -0.2365107469, -0.2149285693], [-0.0765537734, 1.1762296998, -0.0996759264], [0.0083161484, -0.006032449, 0.9977163014]];
const XYZ_2_AP1: M3 = [[1.6410233797, -0.3248032942, -0.2364246952], [-0.6636628587, 1.6153315917, 0.0167563477], [0.0117218943, -0.008284442, 0.9883948585]];
/** A gamut between P3 and AP1, used to push bright saturated colours outwards. */
const WIDE_2_XYZ: M3 = [[0.5441691, 0.2395926, 0.1666943], [0.2394656, 0.702153, 0.0583814], [-0.0023439, 0.0361834, 1.0552183]];
/** Blue correction (keeps bright blue lights from going purple), in AP0. */
const BLUE: M3 = [[0.9404372683, -0.0183068787, 0.0778696104], [0.0083786969, 0.8286599939, 0.1629613092], [0.0005471261, -0.0008833746, 1.0003362486]];
const BLUE_AP1 = mm(AP0_2_AP1, mm(BLUE, AP1_2_AP0));
const BLUE_INV_AP1 = mm(AP0_2_AP1, mm(inv(BLUE), AP1_2_AP0));
const EXPAND = mm(XYZ_2_AP1, mm(WIDE_2_XYZ, AP1_2_SRGB));

const glslM = (name: string, m: M3) => `const vec3 ${name}0 = vec3(${m[0].map((x) => x.toFixed(10)).join(',')});\nconst vec3 ${name}1 = vec3(${m[1].map((x) => x.toFixed(10)).join(',')});\nconst vec3 ${name}2 = vec3(${m[2].map((x) => x.toFixed(10)).join(',')});\n`;

/** The filmic curve's matching points for slope 0.88, toe 0.55, shoulder 0.26, black clip 0, white clip 0.04. */
function curve(slope = 0.88, toe = 0.55, shoulder = 0.26, black = 0, white = 0.04) {
  const ts = 1 + black - toe, ss = 1 + white - shoulder;
  const bt = (0.18 + black) / ts - 1;
  const toeM = Math.log10(0.18) - 0.5 * Math.log((1 + bt) / (1 - bt)) * (ts / slope);
  const strM = (1 - toe) / slope - toeM;
  const shM = shoulder / slope - strM;
  return { slope, ts, ss, toeM, strM, shM, black, white };
}
const C = curve();

const TONE = /* glsl */ `
${glslM('S2A', SRGB_2_AP1)}${glslM('A2S', AP1_2_SRGB)}${glslM('A1A0', AP1_2_AP0)}${glslM('A0A1', AP0_2_AP1)}${glslM('BLU', BLUE_AP1)}${glslM('BLI', BLUE_INV_AP1)}${glslM('EXP', EXPAND)}
const vec3 AP1Y = vec3(0.2722287168, 0.6740817658, 0.0536895174);
vec3 m3(vec3 r0, vec3 r1, vec3 r2, vec3 v) { return vec3(dot(r0, v), dot(r1, v), dot(r2, v)); }
vec3 film(vec3 c) {
  vec3 a0 = m3(A1A00, A1A01, A1A02, c);
  float mx = max(a0.r, max(a0.g, a0.b)), mn = min(a0.r, min(a0.g, a0.b));
  float sat = (max(mx, 1e-10) - max(mn, 1e-10)) / max(mx, 1e-2);
  float chroma = sqrt(max(0.0, a0.b * (a0.b - a0.g) + a0.g * (a0.g - a0.r) + a0.r * (a0.r - a0.b)));
  float yc = (a0.b + a0.g + a0.r + 1.75 * chroma) / 3.0;
  float xs = (sat - 0.4) / 0.2;
  float t = max(1.0 - abs(xs * 0.5), 0.0);
  float s = (1.0 + sign(xs) * (1.0 - t * t)) * 0.5;
  float gain = 0.05 * s;
  float glow = yc <= 0.0533333 ? gain : (yc >= 0.16 ? 0.0 : gain * (0.08 / max(yc, 1e-6) - 0.5));
  a0 *= 1.0 + glow;
  float hue = degrees(atan(1.7320508 * (a0.g - a0.b), 2.0 * a0.r - a0.g - a0.b));
  if (abs(a0.r - a0.g) < 1e-9 && abs(a0.g - a0.b) < 1e-9) hue = 0.0;
  hue = mod(hue, 360.0);
  float ch = hue > 180.0 ? hue - 360.0 : hue;
  float hw = clamp(1.0 - abs(2.0 * ch / 135.0), 0.0, 1.0);
  hw = hw * hw * (3.0 - 2.0 * hw);
  hw *= hw;
  a0.r += hw * sat * (0.03 - a0.r) * 0.18;
  vec3 w = max(m3(A0A10, A0A11, A0A12, a0), 0.0);
  w = mix(vec3(dot(w, AP1Y)), w, 0.96);
  vec3 L = log(max(w, vec3(1e-10))) * 0.4342944819;
  vec3 straight = ${C.slope.toFixed(6)} * (L + ${C.strM.toFixed(8)});
  vec3 toe = ${(-C.black).toFixed(6)} + ${(2 * C.ts).toFixed(8)} / (1.0 + exp(${((-2 * C.slope) / C.ts).toFixed(8)} * (L - ${C.toeM.toFixed(8)})));
  vec3 sh = ${(1 + C.white).toFixed(6)} - ${(2 * C.ss).toFixed(8)} / (1.0 + exp(${((2 * C.slope) / C.ss).toFixed(8)} * (L - ${C.shM.toFixed(8)})));
  toe = mix(straight, toe, vec3(lessThan(L, vec3(${C.toeM.toFixed(8)}))));
  sh = mix(straight, sh, vec3(greaterThan(L, vec3(${C.shM.toFixed(8)}))));
  vec3 tt = clamp((L - ${C.toeM.toFixed(8)}) / (${(C.shM - C.toeM).toFixed(8)}), 0.0, 1.0);
  ${C.shM < C.toeM ? 'tt = 1.0 - tt;' : ''}
  tt = (3.0 - 2.0 * tt) * tt * tt;
  vec3 tone = mix(toe, sh, tt);
  tone = mix(vec3(dot(tone, AP1Y)), tone, 0.93);
  return max(tone, 0.0);
}
vec3 grade(vec3 lin) {
  vec3 ap1 = m3(S2A0, S2A1, S2A2, lin);
  float luma = dot(ap1, AP1Y);
  vec3 chroma = ap1 / max(luma, 1e-10);
  float cd = dot(chroma - 1.0, chroma - 1.0);
  float amt = (1.0 - exp2(-4.0 * cd)) * (1.0 - exp2(-4.0 * luma * luma));
  ap1 = mix(ap1, m3(EXP0, EXP1, EXP2, ap1), amt);
  ap1 = mix(ap1, m3(BLU0, BLU1, BLU2, ap1), 0.6);
  ap1 = film(ap1);
  ap1 = mix(ap1, m3(BLI0, BLI1, BLI2, ap1), 0.6);
  vec3 rgb = max(m3(A2S0, A2S1, A2S2, ap1), 0.0);
  return mix(rgb * 12.92, 1.055 * pow(rgb, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, rgb));
}`;

// ---------------------------------------------------------------- passes
const QUAD = new THREE.PlaneGeometry(2, 2);
const METER_W = 64, METER_H = 48;
const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(QUAD, mat));
  return { scene, mat, u: uniforms };
}
const rt = (w: number, h: number, half = true) => new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
  depthBuffer: false, colorSpace: THREE.NoColorSpace, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  generateMipmaps: false, type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
});

/**
 * Lens dirt: an even film with large soft variations, a few faint smudges,
 * specks and hairs. Ours, made from a seed. The mean (≈0.022) is set so that
 * glow × (1 + 20 × dirt) gives the glow level measured in the capture
 * (≈0.27 of the picture overall); no single smudge stands out.
 */
function makeDirt(): THREE.DataTexture {
  const W = 512, H = 384, a = new Float32Array(W * H);
  const r = new Rng(9137);
  // large, smooth variation: a few octaves of value noise
  for (const [cells, amp] of [[3, 0.006], [7, 0.003], [15, 0.0015]] as const) {
    const gw = cells + 1, gh = Math.ceil((cells * H) / W) + 1;
    const grid = Array.from({ length: (gw + 1) * (gh + 1) }, () => r.range(-1, 1));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const gx = (x / W) * cells, gy = (y / W) * cells, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const g = (i: number, j: number) => grid[j * (gw + 1) + i];
      a[y * W + x] += amp * ((g(ix, iy) * (1 - sx) + g(ix + 1, iy) * sx) * (1 - sy) + (g(ix, iy + 1) * (1 - sx) + g(ix + 1, iy + 1) * sx) * sy);
    }
  }
  const blob = (cx: number, cy: number, rad: number, amp: number) => {
    for (let y = Math.max(0, Math.floor(cy - rad * 2)); y < Math.min(H, cy + rad * 2); y++) for (let x = Math.max(0, Math.floor(cx - rad * 2)); x < Math.min(W, cx + rad * 2); x++) {
      const d2 = ((x - cx) ** 2 + (y - cy) ** 2) / (rad * rad);
      a[y * W + x] += amp * Math.exp(-d2);
    }
  };
  for (let i = 0; i < 30; i++) blob(r.range(0, W), r.range(0, H), r.range(12, 60), r.range(0.001, 0.004));
  for (let i = 0; i < 120; i++) blob(r.range(0, W), r.range(0, H), r.range(0.8, 2.2), r.range(0.004, 0.02));
  for (let i = 0; i < 5; i++) {
    let x = r.range(0, W), y = r.range(0, H), ang = r.range(0, Math.PI * 2);
    for (let k = 0; k < 90; k++) { blob(x, y, 0.9, 0.006); ang += r.range(-0.15, 0.15); x += Math.cos(ang); y += Math.sin(ang); }
  }
  for (let i = 0; i < a.length; i++) a[i] = Math.max(0, a[i] + 0.0205);
  const tex = new THREE.DataTexture(a, W, H, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  return tex;
}

/** Grain: sparse bright specks, a little blue. Ours, made from a seed. */
function makeGrain(): THREE.DataTexture {
  const N = 256, d = new Uint8Array(N * N * 4), r = new Rng(4421);
  for (let i = 0; i < N * N; i++) {
    // mean 0.04 in blue, 0.01 in red and green; × the grain amount 0.2 that is the measured +0.008 / +0.002
    const v = Math.pow(r.next(), 7) * 0.32;
    d[i * 4] = d[i * 4 + 1] = Math.min(255, Math.round(v * 0.25 * 255)); d[i * 4 + 2] = Math.min(255, Math.round(v * 255)); d[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.needsUpdate = true;
  return tex;
}

/** Smooth value noise for the tape streaks. */
function makeStreak(): THREE.DataTexture {
  const N = 256, d = new Uint8Array(N * N * 4), r = new Rng(77);
  const G = 16, grid = Array.from({ length: (G + 1) * (G + 1) }, () => r.next());
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const gx = (x / N) * G, gy = (y / N) * G, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const g = (i: number, j: number) => grid[(j % G) * (G + 1) + (i % G)];
    const v = (g(ix, iy) * (1 - sx) + g(ix + 1, iy) * sx) * (1 - sy) + (g(ix, iy + 1) * (1 - sx) + g(ix + 1, iy + 1) * sx) * sy;
    d[(y * N + x) * 4] = d[(y * N + x) * 4 + 1] = d[(y * N + x) * 4 + 2] = Math.round(v * 255); d[(y * N + x) * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  return tex;
}

export class CamcorderPost {
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private down: THREE.WebGLRenderTarget[] = [];
  private tmp: THREE.WebGLRenderTarget[] = [];
  private glowRt: THREE.WebGLRenderTarget[] = [];
  private outA: THREE.WebGLRenderTarget | null = null;
  private outB: THREE.WebGLRenderTarget | null = null;
  private softA: THREE.WebGLRenderTarget | null = null;
  private softB: THREE.WebGLRenderTarget | null = null;
  private dirt = makeDirt();
  private grainTex = makeGrain();
  private streakTex = makeStreak();
  private time = 0;
  private frame = 0;
  /**
   * Tests: show this stage instead of the finished picture (no lens, no bars).
   * 'scene' and 'glow' show the tone pass's inputs, untinted, as sqrt(x / 40)
   * and sqrt(glow / 1.28) (glow before the lens dirt): the ranges of the
   * reference capture's own pictures, so the two can be compared number for number.
   */
  debugStage: 'scene' | 'glow' | 'tone' | 'sharp' | 'finish' | null = null;
  /** Tests: a fixed clock for the tape pass (seconds), or null for real time. */
  debugTime: number | null = null;

  // Auto exposure meter: log2 luminance of the picture (white-balanced, before exposure), 2^-16 .. 2^8 in 0..1.
  private meterPass = pass(/* glsl */ `
    uniform sampler2D src; uniform vec3 wb; varying vec2 vUv;
    void main() {
      float l = dot(texture2D(src, vUv).rgb * wb, vec3(0.2126, 0.7152, 0.0722));
      gl_FragColor = vec4(vec3(clamp((log2(max(l, 1e-7)) + 16.0) / 24.0, 0.0, 1.0)), 1.0);
    }`, { src: { value: null }, wb: { value: new THREE.Vector3(1, 1, 1) } });
  private meter = new THREE.WebGLRenderTarget(METER_W, METER_H, { depthBuffer: false, type: THREE.UnsignedByteType, colorSpace: THREE.NoColorSpace, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  private meterBuf = new Uint8Array(METER_W * METER_H * 4);
  /** The exposure auto exposure has reached (0 = not yet metered). */
  aeExposure = 0;
  private aeGoal = 0;

  private prep = pass(/* glsl */ `
    uniform sampler2D src; uniform vec2 texel; uniform vec3 scale; uniform float thresh; varying vec2 vUv;
    void main() {
      // 4 bilinear taps = a 4×4 box: the half-size picture, already exposed and tinted
      vec3 c = texture2D(src, vUv + texel * vec2(-0.5, -0.5)).rgb + texture2D(src, vUv + texel * vec2(0.5, -0.5)).rgb
             + texture2D(src, vUv + texel * vec2(-0.5, 0.5)).rgb + texture2D(src, vUv + texel * vec2(0.5, 0.5)).rgb;
      c = max(c * 0.25 * scale, 0.0);
      // With a threshold only what is brighter glows (as a renderer's glare effect), keeping its colour.
      if (thresh > 0.0) { float l = max(c.r, max(c.g, c.b)); c *= max(l - thresh, 0.0) / max(l, 1e-4); }
      gl_FragColor = vec4(c, 1.0);
    }`, { src: { value: null }, texel: { value: new THREE.Vector2() }, scale: { value: new THREE.Vector3(1, 1, 1) }, thresh: { value: 0 } });

  private half = pass(/* glsl */ `
    uniform sampler2D src; uniform vec2 texel; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(src, vUv + texel * vec2(-0.5, -0.5)).rgb + texture2D(src, vUv + texel * vec2(0.5, -0.5)).rgb
             + texture2D(src, vUv + texel * vec2(-0.5, 0.5)).rgb + texture2D(src, vUv + texel * vec2(0.5, 0.5)).rgb;
      gl_FragColor = vec4(c * 0.25, 1.0);
    }`, { src: { value: null }, texel: { value: new THREE.Vector2() } });

  private blur = pass(/* glsl */ `
    uniform sampler2D src; uniform vec2 dir; uniform float sigma; varying vec2 vUv;
    void main() {
      // Gaussian along dir (one texel × dir), 31 taps spread over ±3σ
      vec3 sum = vec3(0.0); float wsum = 0.0;
      float step = max(1.0, sigma / 5.0);
      for (int i = -15; i <= 15; i++) {
        float x = float(i) * step;
        float w = exp(-0.5 * x * x / (sigma * sigma));
        sum += texture2D(src, vUv + dir * x).rgb * w;
        wsum += w;
      }
      gl_FragColor = vec4(sum / wsum, 1.0);
    }`, { src: { value: null }, dir: { value: new THREE.Vector2() }, sigma: { value: 1 } });

  private tone = pass(/* glsl */ `
    uniform sampler2D src; uniform sampler2D g1; uniform sampler2D g2; uniform sampler2D g3; uniform sampler2D dirtTex;
    uniform vec3 scale; uniform vec3 glowW; uniform float dirt; uniform vec2 fringe; uniform float vignette; uniform float aspect; uniform float seed;
    uniform float dbg; uniform vec3 tint; uniform float contrast;
    varying vec2 vUv;
    ${TONE}
    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      vec3 sc;
      sc.r = texture2D(src, (p * (1.0 - fringe.x)) * 0.5 + 0.5).r;
      sc.g = texture2D(src, (p * (1.0 - fringe.y)) * 0.5 + 0.5).g;
      sc.b = texture2D(src, vUv).b;
      vec3 glow = texture2D(g1, vUv).rgb * glowW.x + texture2D(g2, vUv).rgb * glowW.y + texture2D(g3, vUv).rgb * glowW.z;
      if (dbg > 0.5) { gl_FragColor = vec4(sqrt(max(dbg < 1.5 ? sc * scale / tint / 40.0 : glow / tint / 1.28, 0.0)), 1.0); return; }
      glow *= 1.0 + dirt * texture2D(dirtTex, vUv).r;
      vec3 x = sc * scale + glow;
      // flatter (or steeper) round mid grey, on luminance so colours keep their hue and saturation
      if (contrast != 1.0) { float lx = max(dot(x, vec3(0.2126, 0.7152, 0.0722)), 1e-6); x *= pow(lx / 0.18, contrast - 1.0); }
      vec2 v = vec2(p.x, p.y / aspect) * (1.41421356 / sqrt(1.0 + 1.0 / (aspect * aspect))) * vignette;
      float k = 1.0 / (1.0 + dot(v, v));
      x *= k * k;
      vec3 c = grade(x);
      float n = fract(sin(dot(gl_FragCoord.xy + seed, vec2(12.9898, 78.233))) * 43758.5453);
      gl_FragColor = vec4(c + (n - 0.5) / 256.0, 1.0);
    }`, {
    src: { value: null }, g1: { value: null }, g2: { value: null }, g3: { value: null }, dirtTex: { value: null },
    scale: { value: new THREE.Vector3(1, 1, 1) }, glowW: { value: new THREE.Vector3() }, dirt: { value: 0 }, fringe: { value: new THREE.Vector2() },
    vignette: { value: 0.4 }, aspect: { value: 4 / 3 }, seed: { value: 0 }, dbg: { value: 0 }, tint: { value: new THREE.Vector3(1, 1, 1) }, contrast: { value: 1 },
  });

  private sharp = pass(/* glsl */ `
    uniform sampler2D src; uniform float amount; uniform float radius; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(src, vUv).rgb;
      vec3 n = texture2D(src, vUv + vec2(0.0, radius)).rgb + texture2D(src, vUv - vec2(0.0, radius)).rgb
             + texture2D(src, vUv + vec2(radius, 0.0)).rgb + texture2D(src, vUv - vec2(radius, 0.0)).rgb;
      vec3 d = (c - n * 0.25) * amount;
      gl_FragColor = vec4(max(c + dot(d, vec3(0.3, 0.59, 0.11)), 0.0), 1.0);
    }`, { src: { value: null }, amount: { value: 7 }, radius: { value: 0.001 } });

  private finish = pass(/* glsl */ `
    uniform sampler2D src; uniform sampler2D grainTex; uniform sampler2D streakTex;
    uniform float steps, grain, lift, lineChroma, hueAmp, streaks, time, lines; uniform vec2 jitter, outSize;
    varying vec2 vUv;
    uint hash(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
    void main() {
      vec3 c = texture2D(src, vUv).rgb;
      if (steps > 0.0) c = floor(c * steps + 0.5) / steps;
      // grain: sparse specks, new every frame
      c += grain * texture2D(grainTex, gl_FragCoord.xy / 256.0 + jitter).rgb;
      // tape: a slow hue wobble around the grey axis
      float ang = hueAmp * sin(time * 0.5236) * sin(time * 0.1745) * sin(time * 0.1047);
      vec3 k = vec3(0.57735027);
      vec3 cr = c * cos(ang) + cross(k, c) * sin(ang) + k * dot(k, c) * (1.0 - cos(ang));
      cr = cr + (1.0 - cr) * lift;
      // each line its own colour wave, re-rolled 50 times a second
      uint row = uint(floor(vUv.y * lines));
      uint tick = uint(floor(time * 50.0));
      float r1 = float(hash(row * 9781u + tick * 6271u) & 65535u) / 65535.0;
      float r2 = float(hash(row * 3301u + tick * 1187u + 17u) & 65535u) / 65535.0;
      float wave = 0.5 + 0.5 * cos(6.2831853 * (vUv.x / max(r1, 0.0001) + r2));
      vec3 band = mix(vec3(2.0, 0.0, 1.0), vec3(-1.0, 1.0, 0.0), wave);
      cr = mix(cr, band, lineChroma);
      // horizontal streaks
      float s = texture2D(streakTex, vec2(vUv.x * 0.1 + time * 3.0, vUv.y * 4.0)).r;
      vec3 n = texture2D(grainTex, vUv * 2.0 + time * vec2(9.0, 0.05)).rgb;
      cr += streaks * n * s * (1.0 - s);
      gl_FragColor = vec4(max(cr, 0.0), 1.0);
    }`, {
    src: { value: null }, grainTex: { value: null }, streakTex: { value: null }, steps: { value: 24 }, grain: { value: 0.2 }, lift: { value: 0.018 },
    lineChroma: { value: 0.012 }, hueAmp: { value: 0.1047 }, streaks: { value: 0.3 }, time: { value: 0 }, lines: { value: 1080 }, jitter: { value: new THREE.Vector2() }, outSize: { value: new THREE.Vector2() },
  });

  private lens = pass(/* glsl */ `
    uniform sampler2D src; uniform float a; uniform float aspect; uniform float on; varying vec2 vUv;
    void main() {
      vec2 ndc = vUv * 2.0 - 1.0;
      if (on < 0.5) { gl_FragColor = vec4(texture2D(src, vUv).rgb, 1.0); return; }
      // a wide lens bent like a fisheye: the middle is magnified, the edges pulled in
      vec2 asp = vec2(1.0, 1.0 / aspect);
      float diag = length(asp);
      float k = sin(atan(diag * tan(a)));
      vec2 q = ndc * asp / diag * k;
      float r = length(q);
      vec2 d = r > 1e-6 ? q / r : vec2(0.0);
      float th = asin(clamp(r, 0.0, 1.0));
      vec2 inp = th / a * d / asp;
      vec2 uv = inp * 0.5 + 0.5;
      gl_FragColor = vec4(texture2D(src, clamp(uv, 0.0, 1.0)).rgb, 1.0);
    }`, { src: { value: null }, a: { value: 1.2 }, aspect: { value: 4 / 3 }, on: { value: 1 } });

  private show(gl: THREE.WebGLRenderer, t: THREE.WebGLRenderTarget): void {
    const l = this.lens.u;
    l.src.value = t.texture; l.on.value = 0;
    gl.setRenderTarget(null);
    gl.render(this.lens.scene, this.cam);
  }

  private ensure(w: number, h: number, ow: number, oh: number): void {
    const dw = Math.max(1, Math.round(w / 2)), dh = Math.max(1, Math.round(h / 2));
    if (!this.down[0] || this.down[0].width !== dw || this.down[0].height !== dh) {
      for (const t of [...this.down, ...this.tmp, ...this.glowRt]) t.dispose();
      this.down = [rt(dw, dh), rt(dw / 2, dh / 2), rt(dw / 4, dh / 4), rt(dw / 8, dh / 8)];
      this.tmp = this.down.map((d) => rt(d.width, d.height));
      this.glowRt = [rt(this.down[0].width, this.down[0].height), rt(this.down[2].width, this.down[2].height), rt(this.down[3].width, this.down[3].height)];
    }
    if (!this.outA || this.outA.width !== ow || this.outA.height !== oh) {
      this.outA?.dispose(); this.outB?.dispose();
      this.outA = rt(ow, oh); this.outB = rt(ow, oh);
    }
  }

  private draw(gl: THREE.WebGLRenderer, p: { scene: THREE.Scene }, target: THREE.WebGLRenderTarget | null): void {
    gl.setRenderTarget(target);
    gl.render(p.scene, this.cam);
  }

  /**
   * The exposure that brings the picture's log-average (centre-weighted, as a camcorder meters; the darkest and
   * brightest tenth left out) to `aeKey`,
   * within ± aeRange stops of `exposure`; eased at `aeRate` per second, metered every fourth frame (the read
   * back from the graphics card stalls it). aeRate ≥ 100, or no exposure yet, snaps to it.
   */
  private autoExpose(gl: THREE.WebGLRenderer, src: THREE.WebGLRenderTarget, wb: [number, number, number], p: CamcorderParams, dt: number): number {
    const snap = p.aeRate >= 100 || this.aeExposure <= 0;
    if (snap || this.frame % 4 === 0) {
      const m = this.meterPass.u;
      m.src.value = src.texture; (m.wb.value as THREE.Vector3).set(wb[0] * p.tintR, wb[1] * p.tintG, wb[2] * p.tintB);
      this.draw(gl, this.meterPass, this.meter);
      gl.readRenderTargetPixels(this.meter, 0, 0, METER_W, METER_H, this.meterBuf);
      // centre-weighted mean of log2 luminance, leaving out the darkest and brightest tenth (lamps, black holes)
      const samples: [number, number][] = [];
      let wall = 0;
      for (let y = 0; y < METER_H; y++) for (let x = 0; x < METER_W; x++) {
        const u = (x + 0.5) / METER_W - 0.5, v = (y + 0.5) / METER_H - 0.5;
        const w = Math.exp(-(u * u + v * v) / 0.35);
        samples.push([this.meterBuf[(y * METER_W + x) * 4] / 255 * 24 - 16, w]); wall += w;
      }
      samples.sort((q, r) => q[0] - r[0]);
      let cum = 0, sum = 0, wsum = 0;
      for (const [l, w] of samples) {
        if (cum >= 0.1 * wall && cum + w <= 0.9 * wall) { sum += l * w; wsum += w; }
        cum += w;
      }
      const range = Math.pow(2, p.aeRange);
      this.aeGoal = Math.min(p.exposure * range, Math.max(p.exposure / range, p.aeKey / Math.pow(2, sum / Math.max(wsum, 1e-9))));
    }
    if (snap) this.aeExposure = this.aeGoal;
    else this.aeExposure *= Math.pow(this.aeGoal / this.aeExposure, Math.min(1, p.aeRate * dt));
    return this.aeExposure;
  }

  private gauss(gl: THREE.WebGLRenderer, src: THREE.WebGLRenderTarget, tmp: THREE.WebGLRenderTarget, out: THREE.WebGLRenderTarget, sigmaTexels: number): void {
    // One pass covers ±3σ with its 31 taps at most 1.5 texels apart (σ ≤ 7.5); a wider glow is several passes
    // (σ adds in quadrature). Wider taps skip texels and leave stripes.
    const s = Math.max(0.5, sigmaTexels), n = Math.min(16, Math.max(1, Math.ceil((s / 7.5) ** 2)));
    const u = this.blur.u;
    u.sigma.value = s / Math.sqrt(n);
    let from = src;
    for (let i = 0; i < n; i++) {
      u.src.value = from.texture; (u.dir.value as THREE.Vector2).set(1 / src.width, 0);
      this.draw(gl, this.blur, tmp);
      u.src.value = tmp.texture; (u.dir.value as THREE.Vector2).set(0, 1 / src.height);
      this.draw(gl, this.blur, out);
      from = out;
    }
  }

  /**
   * `src`: linear radiance. Draws the finished picture into the canvas, in a
   * centred 4:3 box with black bars when `p.bars`.
   */
  render(gl: THREE.WebGLRenderer, src: THREE.WebGLRenderTarget, p: CamcorderParams, hfovRad: number, dt: number): void {
    this.time = this.debugTime ?? this.time + dt;
    this.frame++;
    const size = gl.getSize(new THREE.Vector2());
    const cw = size.x, ch = size.y;
    const aspect = p.bars ? 4 / 3 : cw / ch;
    let ow = cw, oh = Math.round(cw / aspect);
    if (oh > ch) { oh = ch; ow = Math.round(ch * aspect); }
    this.ensure(src.width, src.height, ow, oh);
    const wb = whiteBalanceGains(p.whiteBalance ?? 0);
    let exposure = p.exposure;
    if (p.autoExposure) exposure = this.autoExpose(gl, src, wb, p, dt);
    else this.aeExposure = 0;
    const scale = new THREE.Vector3(p.tintR * wb[0], p.tintG * wb[1], p.tintB * wb[2]).multiplyScalar(exposure);
    // the upscaler's softness: blur the picture first (glow and tone both read it)
    if (p.soften > 0) {
      if (!this.softA || this.softA.width !== src.width || this.softA.height !== src.height) {
        this.softA?.dispose(); this.softB?.dispose();
        this.softA = rt(src.width, src.height); this.softB = rt(src.width, src.height);
      }
      this.gauss(gl, src, this.softA, this.softB!, (p.soften * src.width) / ow);
      src = this.softB!;
    }
    // glow chain
    const pr = this.prep.u;
    pr.src.value = src.texture; (pr.texel.value as THREE.Vector2).set(1 / src.width, 1 / src.height); (pr.scale.value as THREE.Vector3).copy(scale); pr.thresh.value = p.glowThreshold ?? 0;
    this.draw(gl, this.prep, this.down[0]);
    for (let i = 1; i < 4; i++) {
      const hu = this.half.u;
      hu.src.value = this.down[i - 1].texture; (hu.texel.value as THREE.Vector2).set(1 / this.down[i - 1].width, 1 / this.down[i - 1].height);
      this.draw(gl, this.half, this.down[i]);
    }
    const gs = Math.max(0.05, p.glowSize ?? 1);
    this.gauss(gl, this.down[0], this.tmp[0], this.glowRt[0], 0.006 * gs * this.down[0].width);
    this.gauss(gl, this.down[2], this.tmp[2], this.glowRt[1], 0.025 * gs * this.down[2].width);
    this.gauss(gl, this.down[3], this.tmp[3], this.glowRt[2], 0.08 * gs * this.down[3].width);
    // tone
    const t = this.tone.u;
    t.src.value = src.texture; t.g1.value = this.glowRt[0].texture; t.g2.value = this.glowRt[1].texture; t.g3.value = this.glowRt[2].texture; t.dirtTex.value = this.dirt;
    (t.scale.value as THREE.Vector3).copy(scale);
    (t.glowW.value as THREE.Vector3).set(0.612, 0.241, 0.147).multiplyScalar(p.glow);
    t.dirt.value = p.dirt;
    // fringe 0.3 → red 0.003087, green 0.001781 of the half-picture (wavelength-weighted)
    (t.fringe.value as THREE.Vector2).set(p.fringe * 0.01 * 1.029, p.fringe * 0.01 * 0.5936);
    t.vignette.value = p.vignette; t.contrast.value = p.contrast ?? 1;
    t.aspect.value = aspect;
    t.seed.value = (this.frame * 7.31) % 1000;
    t.dbg.value = this.debugStage === 'scene' ? 1 : this.debugStage === 'glow' ? 2 : 0;
    (t.tint.value as THREE.Vector3).set(p.tintR, p.tintG, p.tintB);
    this.draw(gl, this.tone, this.outA);
    if (this.debugStage === 'tone' || t.dbg.value > 0) return this.show(gl, this.outA!);
    // sharpen
    this.sharp.u.src.value = this.outA!.texture; this.sharp.u.amount.value = p.sharpen; this.sharp.u.radius.value = 0.001 * (p.sharpenRadius ?? 1);
    this.draw(gl, this.sharp, this.outB);
    if (this.debugStage === 'sharp') return this.show(gl, this.outB!);
    // banding, grain, tape
    const f = this.finish.u;
    f.src.value = this.outB!.texture; f.grainTex.value = this.grainTex; f.streakTex.value = this.streakTex;
    f.steps.value = p.posterize; f.grain.value = p.grain; f.lift.value = p.lift; f.lineChroma.value = p.lineChroma; f.hueAmp.value = p.hueWobble; f.streaks.value = p.streaks;
    f.time.value = this.time; f.lines.value = src.height;
    (f.jitter.value as THREE.Vector2).set(Math.random(), Math.random());
    this.draw(gl, this.finish, this.outA);
    if (this.debugStage === 'finish') return this.show(gl, this.outA!);
    // lens, into the 4:3 box of the canvas
    const l = this.lens.u;
    l.src.value = this.outA!.texture; l.a.value = p.lens * hfovRad; l.aspect.value = aspect; l.on.value = p.lens > 0 ? 1 : 0;
    gl.setRenderTarget(null);
    gl.setScissorTest(false);
    gl.setViewport(0, 0, cw, ch);
    gl.setClearColor(0x000000, 1);
    gl.clear(true, false, false);
    gl.setViewport(Math.round((cw - ow) / 2), Math.round((ch - oh) / 2), ow, oh);
    gl.render(this.lens.scene, this.cam);
    gl.setViewport(0, 0, cw, ch);
  }
}

/** Gains that make light of `kelvin` neutral, keeping its luminance (0 = none). */
export function whiteBalanceGains(kelvin: number): [number, number, number] {
  if (!(kelvin > 0)) return [1, 1, 1];
  const c = kelvinToLinear(kelvin);
  return [1 / c[0], 1 / c[1], 1 / c[2]];
}
