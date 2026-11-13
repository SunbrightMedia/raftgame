/**
 * The Complex camera's tone table: a 32 x 32 x 32 table from log-encoded scene light to display sRGB, made the
 * way that game's engine makes it each frame (its "CombineLUTs" step), then read by the tonemapper with
 * trilinear filtering. Our own code; its numbers are checked against the game's own compiled step, run by
 * tools/complex/dxbc.py (tools/complex/check_tone.py).
 *
 * Float32 throughout (f = Math.fround after every operation, mad = one rounding, as GPUs fuse it), so that
 * the table matches the game's to the 10-bit steps it is stored in.
 *
 * The path, for an sRGB screen (the only one we use):
 *  1. cell -> log-encoded colour (0..1) -> scene light: 2^((x - 444/1023) * 14) * 0.18 - (the same at 0)
 *  2. into AP1 (the working colour space's matrix)
 *  3. gamut expansion: bright saturated colours pushed outwards (towards a gamut between P3 and AP1)
 *  4. colour correction: saturation, contrast, gamma, gain, offset for shadows / midtones / highlights,
 *     blended by luma (neutral settings still run it: log/exp round trips)
 *  5. blue correction (0.6), the filmic curve (ACES-style glow and red modifiers, slope / toe / shoulder),
 *     the inverse blue correction
 *  6. back to sRGB, clipped at 0; mapping polynomial, colour scale / overlay, inverse gamma
 *  7. sRGB -> AP1 -> output gamut (sRGB), the sRGB transfer curve, / 1.05 (the tonemapper multiplies by 1.05)
 */

const f = Math.fround;
const add = (a: number, b: number) => f(a + b);
const sub = (a: number, b: number) => f(a - b);
const mul = (a: number, b: number) => f(a * b);
const div = (a: number, b: number) => f(a / b);
/** a * b + c rounded once (GPU fused multiply-add). */
const mad = (a: number, b: number, c: number) => f(a * b + c);
const log2 = (a: number) => f(Math.log2(a));
const exp2 = (a: number) => f(Math.pow(2, a));
const max = (a: number, b: number) => (a > b || Number.isNaN(b) ? a : b);
const min = (a: number, b: number) => (a < b || Number.isNaN(b) ? a : b);
const sat = (a: number) => (Number.isNaN(a) ? 0 : Math.min(1, Math.max(0, a)));

type V3 = [number, number, number];
type M3 = [V3, V3, V3];
/** dot product as GPUs run it: x*x', then two fused multiply-adds. */
const dot = (a: V3, b: V3) => mad(a[2], b[2], mad(a[1], b[1], mul(a[0], b[0])));
const xf = (m: M3, v: V3): V3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
const F3 = (v: number[]): V3 => [f(v[0]), f(v[1]), f(v[2])];
const M = (m: number[][]): M3 => [F3(m[0]), F3(m[1]), F3(m[2])];

export interface ToneSettings {
  size: number;
  /** log encoding: (x + offset) -> log2 / range + mid. Grey 0.18 sits at 444/1023. */
  expandGamut: number;
  blueCorrection: number;
  toneCurveAmount: number;
  filmSlope: number;
  filmToe: number;
  filmShoulder: number;
  filmBlackClip: number;
  filmWhiteClip: number;
  shadowsMax: number;
  highlightsMin: number;
  highlightsMax: number;
  /** Colour correction rows: saturation, contrast, gamma, gain, offset (xyz w), for global / shadows / midtones / highlights. */
  grading: { global: number[][]; shadows: number[][]; midtones: number[][]; highlights: number[][] };
  colorScale: V3;
  overlay: [number, number, number, number];
  /** mapping polynomial x^2 * a + x * b + c */
  polynomial: V3;
  inverseGamma: number;
  /** Working colour space (sRGB primaries): to AP1 and from AP1 (rows). */
  toAP1: M3;
  fromAP1: M3;
}

/** The capture's settings (frame 18325's CombineLUTs constants): neutral grading, defaults otherwise. */
export const COMPLEX_TONE: ToneSettings = {
  size: 32,
  expandGamut: 1,
  blueCorrection: 0.6,
  toneCurveAmount: 1,
  filmSlope: 0.88,
  filmToe: 0.55,
  filmShoulder: 0.26,
  filmBlackClip: 0,
  filmWhiteClip: 0.04,
  shadowsMax: 0.09,
  highlightsMin: 0.5,
  highlightsMax: 1,
  grading: {
    global: [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [0, 0, 0, 0]],
    shadows: [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [0, 0, 0, 0]],
    midtones: [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [0, 0, 0, 0]],
    highlights: [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [0, 0, 0, 0]],
  },
  colorScale: [1, 1, 1],
  overlay: [0, 0, 0, 0],
  polynomial: [0, 1, 0],
  inverseGamma: 1,
  toAP1: M([[0.613097012, 0.339522988, 0.0473789982], [0.0701939985, 0.916354001, 0.013452], [0.0206160005, 0.109569997, 0.869814992]]),
  fromAP1: M([[1.70505095, -0.621792018, -0.0832590014], [-0.130255997, 1.14080501, -0.0105480002], [-0.0240030009, -0.128968999, 1.15297198]]),
};

// ---- fixed matrices and constants of the path (standard ACES / colour-science values, as the step uses them)
const AP1_Y: V3 = F3([0.272229, 0.674082, 0.05369]);
/** sRGB-ish wide gamut used by the gamut expansion, as a matrix on AP1 colours */
const EXPAND: M3 = M([[1.370413, -0.329291, -0.063683], [-0.083434, 1.097091, -0.010862], [-0.025793, -0.098626, 1.203694]]);
const BLUE: M3 = M([[0.938639, 0, 0.061361], [0, 0.830794, 0.169206], [0, -0, 1]]);
const BLUE_INV: M3 = M([[1.065375, 0.000001, -0.065371], [-0, 1.203663, -0.203668], [0, 0, 1]]);
const AP1_AP0: M3 = M([[0.695452, 0.140679, 0.163869], [0.044795, 0.859671, 0.095534], [-0.005526, 0.004025, 1.001501]]);
const AP0_AP1: M3 = M([[1.451439, -0.236511, -0.214929], [-0.076554, 1.17623, -0.099676], [0.008316, -0.006032, 0.997716]]);
/** AP1 -> sRGB output gamut */
const AP1_OUT: M3 = M([[1.705052, -0.621791, -0.083258], [-0.130257, 1.140803, -0.010549], [-0.024003, -0.128969, 1.152972]]);
const LOG_MID = f(0.434018);      // 444 / 1023
const LOG_BLACK = f(0.002668);    // the light at log code 0
const INV_GREY = f(5.555555);     // 1 / 0.18
const SQRT3 = f(1.732051);
const RAD2DEG = f(57.29578);
const LOG10_2 = f(0.30103);
const LOG2_E = f(1.442695);
const HALF_LN2 = f(0.346574);
const LOG10_GREY = f(-0.744727);  // log10(0.18)
const INV_RED_WIDTH = f(0.014815); // 2 / 135

/** The compiler's arctangent: a 9th-order odd polynomial on [0, 1] and the usual quadrant fix-ups. */
function atan2gpu(y: number, x: number): number {
  const ay = Math.abs(y), ax = Math.abs(x);
  const lo = min(ay, ax), hi = max(ay, ax);
  const t = mul(div(1, hi), lo);
  const t2 = mul(t, t);
  let p = mad(t2, f(0.020835), f(-0.085133));
  p = mad(t2, p, f(0.180141));
  p = mad(t2, p, f(-0.330299));
  const q = mad(t2, p, f(0.999866));
  let corr = mad(mul(q, t), -2, f(1.570796));
  corr = ax < ay ? corr : 0;
  let a = mad(t, q, corr);
  a = add(x < -x ? f(-3.141593) : 0, a);
  const lo2 = min(y, x), hi2 = max(y, x);
  return lo2 < -lo2 && hi2 >= -hi2 ? -a : a;
}

/** ColorCorrect for one tonal range; rows [saturation, contrast, gamma, gain, offset] already combined with global. */
function colorCorrect(c: V3, luma: number, sat4: number[], con4: number[], gam4: number[], gain4: number[], off4: number[]): V3 {
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    let v = mad(mul(sat4[3], sat4[i]), sub(c[i], luma), luma);          // lerp(luma, c, saturation)
    v = mul(max(v, 0), INV_GREY);
    v = mul(exp2(mul(log2(v), mul(con4[3], con4[i]))), f(0.18));         // pow(x / 0.18, contrast) * 0.18
    v = exp2(mul(log2(v), div(1, mul(gam4[3], gam4[i]))));               // pow(x, 1 / gamma)
    v = mad(v, mul(gain4[3], gain4[i]), add(off4[3], off4[i]));          // * gain + offset
    out.push(v);
  }
  return out as V3;
}

/** Debugging the check: named intermediate values of the last toneCell call, when set. */
export let toneTrace: Record<string, number[]> | null = null;
export function traceTone(on: boolean): void { toneTrace = on ? {} : null; }
const tr = (k: string, v: number[] | number) => { if (toneTrace) toneTrace[k] = Array.isArray(v) ? [...v] : [v]; };

/** One cell of the table: log-encoded colour (0..1 per channel) -> stored value (sRGB / 1.05). */
export function toneCell(s: ToneSettings, enc: V3): V3 {
  // 1-2. scene light, into AP1
  const lin = enc.map((x) => mad(exp2(mul(add(x, -LOG_MID), 14)), f(0.18), -LOG_BLACK)) as V3;
  let ap1 = xf(s.toAP1, lin);
  tr('lin', lin); tr('ap1', ap1);
  // 3. gamut expansion
  {
    const luma = dot(ap1, AP1_Y);
    const ch = ap1.map((v) => add(div(v, luma), -1)) as V3;
    const dist = dot(ch, ch);
    const a = sub(1, exp2(mul(dist, -4)));
    const b = sub(1, exp2(mul(mul(mul(luma, luma), f(s.expandGamut)), -4)));
    const amount = mul(b, a);
    const ex = xf(EXPAND, ap1);
    ap1 = ap1.map((v, i) => mad(amount, sub(ex[i], v), v)) as V3;
  }
  tr('expanded', ap1);
  // 4. colour correction by tonal range
  {
    const luma = dot(ap1, AP1_Y);
    const G = s.grading;
    const comb = (r: number[][]) => [0, 1, 2, 3].map((k) => (k < 4 ? r[k].map((v, i) => mul(G.global[k][i], v)) : []));
    const offs = (r: number[][]) => r[4].map((v, i) => add(G.global[4][i], v));
    const cc = (r: number[][]) => { const m4 = comb(r); return colorCorrect(ap1, luma, m4[0], m4[1], m4[2], m4[3], offs(r)); };
    const shadows = cc(G.shadows), highlights = cc(G.highlights), midtones = cc(G.midtones);
    let ws = sat(mul(luma, div(1, f(s.shadowsMax))));
    ws = mad(-mad(ws, -2, 3), mul(ws, ws), 1);                             // 1 - smoothstep(0, max, luma)
    let wh = sat(mul(div(1, sub(f(s.highlightsMax), f(s.highlightsMin))), add(luma, -f(s.highlightsMin))));
    const wh3 = mad(wh, -2, 3);
    wh = mul(wh, wh);
    const whW = mul(wh, wh3);                                               // smoothstep(min, max, luma)
    const wm = mad(-wh3, wh, sub(1, ws));                                   // 1 - shadows - highlights
    ap1 = [0, 1, 2].map((i) => mad(highlights[i], whW, mad(shadows[i], ws, mul(wm, midtones[i])))) as V3;
  }
  tr('graded', ap1);
  // 5a. blue correction
  const bc = f(s.blueCorrection);
  {
    const b = xf(BLUE, ap1);
    ap1 = ap1.map((v, i) => mad(bc, sub(b[i], v), v)) as V3;
  }
  tr('blue', ap1);
  // 5b. the filmic curve
  const toned = filmToneMap(s, ap1);
  tr('toned', toned);
  ap1 = ap1.map((v, i) => mad(f(s.toneCurveAmount), sub(toned[i], v), v)) as V3;
  // 5c. inverse blue correction
  {
    const b = xf(BLUE_INV, ap1);
    ap1 = ap1.map((v, i) => mad(bc, sub(b[i], v), v)) as V3;
  }
  // 6. sRGB, clip, polynomial, colour scale and overlay, inverse gamma
  let rgb = xf(s.fromAP1, ap1).map((v) => max(v, 0)) as V3;
  rgb = rgb.map((v) => add(mad(f(s.polynomial[0]), mul(v, v), mul(v, f(s.polynomial[1]))), f(s.polynomial[2]))) as V3;
  rgb = rgb.map((v, i) => {
    const scaled = mul(v, f(s.colorScale[i]));
    return mad(f(s.overlay[3]), mad(-v, f(s.colorScale[i]), f(s.overlay[i])), scaled);
  }) as V3;
  rgb = rgb.map((v) => exp2(mul(log2(max(v, 0)), f(s.inverseGamma)))) as V3;
  tr('gamma', rgb);
  // 7. output gamut, transfer curve, / 1.05
  const out = xf(AP1_OUT, xf(s.toAP1, rgb));
  return out.map((v) => {
    const enc2 = v >= f(0.003131) ? mad(exp2(mul(log2(v), f(1 / 2.4))), f(1.055), f(-0.055)) : mul(v, f(12.92));
    return mul(enc2, f(1 / 1.05));
  }) as V3;
}

/** The filmic tone curve on an AP1 colour (glow and red modifiers in AP0, then the toe / straight / shoulder curve). */
function filmToneMap(s: ToneSettings, ap1: V3): V3 {
  const a0 = xf(AP1_AP0, ap1);
  tr('a0', a0);
  // saturation and "yc"
  const mn = max(min(min(a0[1], a0[0]), a0[2]), 0);
  const mx = max(max(a0[1], a0[0]), a0[2]);
  const sat0 = div(sub(max(mx, 0), mn), max(mx, f(0.01)));
  // chroma = sqrt(r (r - b) + g (g - r) + b (b - g)), summed as the step does: (g (g - r) + b (b - g)) first
  const R = a0[0], G = a0[1], B = a0[2];
  const chroma = f(Math.sqrt(mad(R, sub(R, B), add(mul(G, sub(G, R)), mul(B, sub(B, G))))));
  const yc3 = mad(chroma, f(1.75), add(R, add(G, B)));
  const yc = mul(yc3, f(1 / 3));
  // glow module
  const xs = add(sat0, f(-0.4));
  let t = max(add(-Math.abs(mul(xs, f(2.5))), 1), 0);
  const sign = xs > 0 ? 1 : xs < 0 ? -1 : 0;
  t = mad(sign, mad(-t, t, 1), 1);
  const gain = mul(t, f(0.025));
  let glow = mul(add(div(f(0.08), yc), f(-0.5)), gain);
  glow = yc3 >= f(0.48) ? 0 : glow;
  glow = f(0.16) >= yc3 ? gain : glow;
  const g1 = add(glow, 1);
  tr('sat0', sat0); tr('yc3', yc3); tr('g1', g1);
  const r = mul(g1, a0[0]), g = mul(g1, a0[1]), b = mul(g1, a0[2]);
  // red modifier: hue weight around red
  const grey = g === r && b === g;
  const y = mul(mad(a0[1], g1, -b), SQRT3);
  const x = mad(-a0[2], g1, mad(r, 2, -g));
  let hue = grey ? 0 : mul(atan2gpu(y, x), RAD2DEG);
  hue = hue < 0 ? add(hue, 360) : hue;
  hue = min(max(hue, 0), 360);
  hue = f(180) < hue ? add(hue, -360) : hue;
  tr('hue', hue);
  let hw = max(add(-Math.abs(mul(hue, INV_RED_WIDTH)), 1), 0);
  hw = mul(mul(mul(hw, hw), mad(hw, -2, 3)), 1);
  hw = mul(hw, hw);
  const rr = mad(mul(mul(sat0, hw), mad(-a0[0], g1, f(0.03))), f(0.18), r);
  tr('rr', rr);
  // back to AP1, pre-desaturate
  let w = xf(AP0_AP1, [rr, g, b]).map((v) => max(v, 0)) as V3;
  {
    const l = dot(w, AP1_Y);
    w = w.map((v) => mad(sub(v, l), f(0.96), l)) as V3;
  }
  tr('w', w);
  // the curve's matching points (from slope, toe, shoulder, clips)
  const slope = f(s.filmSlope), toe = f(s.filmToe), shoulder = f(s.filmShoulder), black = f(s.filmBlackClip), white = f(s.filmWhiteClip);
  const toeScale = sub(add(1, black), toe);
  const shoulderScale = sub(add(1, white), shoulder);
  let toeMatch: number;
  if (f(0.8) < toe) toeMatch = add(div(sub(f(0.82), toe), slope), LOG10_GREY);
  else {
    const bt = div(add(f(0.18), black), toeScale);
    const k = div(bt, sub(1, add(bt, -1)));
    toeMatch = mad(-mul(log2(k), HALF_LN2), div(toeScale, slope), LOG10_GREY);
  }
  const straightMatch = sub(div(sub(1, toe), slope), toeMatch);
  const shoulderMatch = sub(div(shoulder, slope), straightMatch);
  const out: number[] = [];
  const toeK = div(mul(-2, slope), toeScale);
  const shK = div(add(slope, slope), shoulderScale);
  for (let i = 0; i < 3; i++) {
    const lg2 = log2(w[i]);
    const logc = mul(lg2, LOG10_2);
    const straight = mul(mad(lg2, LOG10_2, straightMatch), slope);
    const dt = mad(lg2, LOG10_2, -toeMatch);
    const toeC = add(div(add(toeScale, toeScale), add(exp2(mul(mul(toeK, dt), LOG2_E)), 1)), -black);
    const ds = mul(shK, mad(lg2, LOG10_2, -shoulderMatch));
    const shC = sub(add(1, white), div(add(shoulderScale, shoulderScale), add(exp2(mul(ds, LOG2_E)), 1)));
    const lowC = logc < toeMatch ? toeC : straight;
    const highC = shoulderMatch < logc ? shC : straight;
    let tt = sat(div(dt, sub(shoulderMatch, toeMatch)));
    if (shoulderMatch < toeMatch) tt = sub(1, tt);
    tt = mul(mad(tt, -2, 3), mul(tt, tt));
    out.push(mad(tt, sub(highC, lowC), lowC));
  }
  // post-desaturate, positive
  const l = dot(out as V3, AP1_Y);
  return (out as V3).map((v) => max(mad(sub(v, l), f(0.93), l), 0)) as V3;
}

/** The whole table, red fastest: (size^3) cells x RGBA, before the 10-bit storage (A = 0). */
export function makeToneTable(s: ToneSettings = COMPLEX_TONE): Float32Array {
  const n = s.size, out = new Float32Array(n * n * n * 4);
  const step = f(n - 1);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    // the cell's coordinates as the step computes them: (uv - 0.5 / n) * n / (n - 1), layer / (n - 1)
    const u = f((x + 0.5) / n), v = f((y + 0.5) / n);
    const half = div(0.5, n);
    const enc: V3 = [div(mul(sub(u, half), n), step), div(mul(sub(v, half), n), step), div(z, step)];
    const c = toneCell(s, enc);
    const o = ((z * n + y) * n + x) * 4;
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
  }
  return out;
}

/** Round to the 10-bit steps the table is stored in (R10G10B10A2). */
export function to10bit(t: Float32Array): Float32Array {
  const out = new Float32Array(t.length);
  for (let i = 0; i < t.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, t[i])) * 1023) / 1023;
  return out;
}
