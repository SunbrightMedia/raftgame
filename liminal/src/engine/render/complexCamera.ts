/**
 * The Complex's camera, step by step as that game draws it (after the scene and the glow): the tonemapper,
 * then five camera passes (sharpen, posterize, grain, tape, lens). Our own GLSL, written from what the
 * game's compiled steps compute (the user's frame capture, reference/complex/FINDINGS.md), and checked
 * against those steps run by tools/complex/dxbc.py (tools/complex/check_camera.py).
 *
 * Conventions (as the game's, so the maths reads the same): image row 0 is the TOP, in every texture and
 * target of this chain; gl_FragCoord.xy is then the game's pixel position and texture coordinates are its
 * UVs. Only the final present flips. Pictures between passes are 10-bit (RGB10_A2), as the game stores
 * them; the scene and glow inputs are R11G11B10 floats (R11F_G11F_B10F); the tone table is a 32^3
 * RGB10_A2 3D texture (complexTone.ts).
 *
 * Four inputs are the game's own image files (lens dirt, grain noise, two tape noises). They are not
 * copied: ours stand in for them (made from seeds, matched to measured statistics).
 */

const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
out vec4 o;
`;

/** Full-viewport triangle; the passes work from gl_FragCoord. */
export const COMPLEX_VERT = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

/**
 * Tonemapper. Colour fringe (red and green sampled nearer the middle), scene x colour multiplier + glow x
 * (1 + dirt x 20), x exposure, cos^4 vignette, log encoding, the 32^3 tone table, x 1.05, dither +-1/512.
 *  u_pos: centred-position map (game cb0[45]: bias xy, scale zw); u_ca (cb0[43]): red k, green k, start;
 *  u_caMap (cb0[46]); u_vp (cb0[10]): centred -> pixel; u_size (cb0[9]): scene w, h, 1/w, 1/h;
 *  u_clamp (cb0[15]): scene UV limits; u_bloomUV (cb0[33]), u_bloomClamp (cb0[34]); u_tint (cb0[41]);
 *  u_dirtK (cb0[42]); u_vig (cb0[44].x); u_lut (cb0[47].zw: scale, bias); u_invPre (1 / pre-exposure);
 *  u_exposure (eye adaptation buffer [0].x); u_apply (the glow's scene multiplier buffer [0].xyz);
 *  u_vigScale: aspect and normalisation of the vignette position (the vertex step's numbers);
 *  u_dither: the dither's per-frame offset (added to the UV, as the vertex step does).
 */
export const TONEMAP = HEAD + `
uniform sampler2D t_scene, t_bloom, t_dirt;
uniform sampler3D t_lut;
uniform vec4 u_pos, u_ca, u_caMap, u_vp, u_size, u_clamp, u_bloomUV, u_bloomClamp;
uniform vec3 u_tint, u_dirtK, u_apply;
uniform vec2 u_lut, u_vigScale, u_dither;
uniform float u_vig, u_invPre, u_exposure;
void main() {
  vec2 uv = gl_FragCoord.xy * u_size.zw;                                   // the scene UV at the pixel centre
  vec2 cpos = uv * vec2(2.0, -2.0) + vec2(-1.0, 1.0);                      // centred, y up
  vec2 vig = cpos * u_vigScale;
  vec2 dith = uv + u_dither;
  vec2 p = cpos * u_pos.zw + u_pos.xy;
  vec4 s = sign(p.xyxy) * clamp(abs(p.xyxy) - u_ca.z, 0.0, 1.0);
  vec4 q = -s * u_ca.xxyy + p.xyxy;
  q = q * u_caMap.zwzw + u_caMap.xyxy;
  q = q * u_vp.xyxy + u_vp.zwzw;
  q = q * u_size.zwzw;
  q = min(max(q, u_clamp.xyxy), u_clamp.zwzw);
  vec3 c;
  c.x = texture(t_scene, q.xy).x;
  c.y = texture(t_scene, q.zw).y;
  c.z = texture(t_scene, min(max(uv, u_clamp.xy), u_clamp.zw)).z;
  c = c * u_invPre;
  c = c * u_tint;
  vec2 buv = min(max(uv * u_bloomUV.xy + u_bloomUV.zw, u_bloomClamp.xy), u_bloomClamp.zw);
  vec3 bloom = texture(t_bloom, buv).xyz * u_invPre;
  vec3 dirt = texture(t_dirt, p * vec2(0.5, -0.5) + vec2(0.5, 0.5)).xyz;
  vec3 x = (dirt * u_dirtK + 1.0) * bloom;
  x = c * u_apply + x;
  x = u_exposure * x;
  vec2 vv = vig * u_vig;
  float v = 1.0 / (dot(vv, vv) + 1.0);
  v = v * v;
  x = x * v + 0.002668;
  x = clamp(log2(x) * (1.0 / 14.0) + 0.610727, 0.0, 1.0);
  x = x * u_lut.x + u_lut.y;
  vec3 g = texture(t_lut, x).xyz;
  float d = fract(sin(dith.y * 543.31 + dith.x) * 493013.0) * (1.0 / 256.0) - (1.0 / 512.0);
  o = vec4(g * 1.05 + d, 0.0);
}`;

/** The passes after the tonemapper read their input at the pixel's UV through the game's viewport map:
 *  u_view (cb0[37].xy: the viewport's top-left), u_inv (cb0[38].zw: 1 / size), u_map (cb0[5].xy scale,
 *  cb0[4].xy bias), u_clampP (cb0[6]). */
const VIEW = `
uniform vec2 u_view, u_inv;
uniform vec4 u_map, u_clampP;
`;

/** Sharpen: luma unsharp mask, taps 0.001 of the picture away, amount u_amount; then a blend to a colour
 *  (u_blend weight, u_blendColor), as the game's material does (weight 0 in the capture). */
export const SHARPEN = HEAD + VIEW + `
uniform sampler2D t_src;
uniform float u_amount, u_blend;
uniform vec3 u_blendColor;
vec3 at(vec2 a) { return texture(t_src, min(max(a * u_map.xy + u_map.zw, u_clampP.xy), u_clampP.zw)).xyz; }
void main() {
  vec2 r = gl_FragCoord.xy - u_view;
  vec4 v = r.xyxy * u_inv.xyxy + vec4(0.0, 0.001, 0.0, -0.001);
  vec3 ud = at(v.zw) + at(v.xy);
  vec4 h = r.xyxy * u_inv.xyxy + vec4(0.001, 0.0, -0.001, 0.0);
  vec3 c = at(r * u_inv);
  vec3 lr = at(h.zw) + at(h.xy);
  vec3 sum = ud + lr;
  vec3 d = (-sum * 0.25 + c) * u_amount;
  c = c + dot(d, vec3(0.3, 0.59, 0.11));
  c = u_blend * (u_blendColor - c) + c;
  o = vec4(max(c, 0.0), 0.0);
}`;

/** Posterize: 25 steps per channel (round half to even, as the game), then the blend. No UV clamp. */
export const POSTERIZE = HEAD + VIEW + `
uniform sampler2D t_src;
uniform float u_blend;
uniform vec3 u_blendColor;
void main() {
  vec2 uv = (gl_FragCoord.xy - u_view) * u_inv;
  vec3 c = texture(t_src, uv * u_map.xy + u_map.zw).xyz;
  vec3 q = roundEven(c * 24.0);
  vec3 a = q * (1.0 / 24.0);
  vec3 b = -q * (1.0 / 24.0) + u_blendColor;
  o = vec4(max(u_blend * b + a, 0.0), 0.0);
}`;

/** Grain: a noise image tiled u_tile times over the view, moving time x (9, 4) each second, x (1 - u_keep)
 *  (0.2 of it), added after an "overlay" blend that the game's settings (0.5, 0.5) make the identity. */
export const GRAIN = HEAD + VIEW + `
uniform sampler2D t_noise, t_src;
uniform float u_time, u_tile, u_keep, u_lift, u_hi, u_lo, u_blend;
uniform vec3 u_blendColor;
void main() {
  vec2 r = (gl_FragCoord.xy - u_view) * u_inv;
  vec2 suv = r * u_map.xy + u_map.zw;
  vec2 nuv = u_time * vec2(9.0, 4.0) + r * u_tile;
  vec3 n = texture(t_noise, nuv).xyz;
  n = u_keep * -n + n;
  vec3 s = texture(t_src, suv).xyz;
  vec3 hi = (1.0 - s) * u_hi;
  hi = -hi * 2.0 + 1.0;
  vec3 lo = s * u_lo;
  lo = lo + lo;
  s = mix(lo, hi, vec3(greaterThanEqual(s, vec3(0.5))));
  vec3 m = u_lift * (1.0 - n) + n;
  s = s + m;
  o = vec4(max(u_blend * (u_blendColor - s) + s, 0.0), 0.0);
}`;

/**
 * Tape: each picture row (of u_rows: the render height) gets a wave of random frequency along x, re-rolled
 * u_rate times a second, between two colours (u_colA -> u_colB), mixed in at u_mix; the colour turns slowly
 * round the grey axis (at most 6 degrees); a lift (u_liftK); streaks: noise (tiled u_tile, moving time x
 * (9, 0.05)) x s(1 - s) of a second noise stretched 10x along x and moving time x 3, x (1 - u_keep).
 * The row hash is Unreal's 16-bit PCG one (1664525, 1013904223).
 */
export const TAPE = HEAD + VIEW + `
uniform sampler2D t_noise, t_band, t_src;
uniform float u_time, u_rows, u_rate, u_tile, u_keep, u_liftK, u_lift2, u_mix, u_blend;
uniform vec3 u_colA, u_colB, u_blendColor;
void main() {
  float t50 = u_time * u_rate;
  float stepf = floor(t50);
  vec2 r = (gl_FragCoord.xy - u_view) * u_inv;
  float rowf = floor(r.y * u_rows);
  ivec2 k = ivec2(int(rowf), int(stepf));
  uvec2 a = uvec2(k) * 1664525u + 1013904223u;
  uint c = a.x * a.y + 1013904223u;
  a.x = a.y * c + a.x;
  a.y = c * a.x + a.y;
  c = a.x * a.y + c;
  uint d = a.y * c + a.x;
  vec2 h = vec2(uvec2(c, d) >> 16u);
  float fr = max(h.x * (1.0 / 65536.0), 0.0001);
  float ph = h.y * (1.0 / 65536.0) + r.x / fr;
  float w = (sin(ph * 6.283185) + 1.0) * 0.5;
  vec3 line = w * (u_colB - u_colA) + u_colA;
  vec3 s = texture(t_src, r * u_map.xy + u_map.zw).xyz;
  const float K = 0.57735;
  float g = dot(vec3(K), s);
  vec3 perp = -g * K + s;
  vec3 cr = perp.zxy * K;
  cr = perp.zxy * K - cr.zxy;
  vec3 tt = u_time * vec3(9.0, 0.05, 0.523599);
  vec3 n = texture(t_noise, r * u_tile + tt.xy).xyz;
  float ang = sin(tt.z) * sin(u_time * 0.174533);
  ang = sin(u_time * 0.10472) * ang;
  ang = ang * 0.10472;
  vec3 rot = perp * cos(ang) + cr * sin(ang);
  rot = g * K + rot;
  rot = u_liftK * (1.0 - rot) + rot;
  line = line - rot;
  vec3 mixed = u_mix * line + rot;
  float b = texture(t_band, r * vec2(0.1, 1.0) + vec2(u_time * 3.0, 0.0)).x;
  vec3 st = ((1.0 - b) * b) * n;
  st = u_keep * -st + st;
  st = u_lift2 * (1.0 - st) + st;
  vec3 res = mixed + st;
  o = vec4(max(u_blend * (u_blendColor - res) + res, 0.0), 0.0);
}`;

/** The compiler's arctangent (a 9th-order odd polynomial and the usual fix-ups), in float32. */
function atanGpu(x: number): number {
  const f = Math.fround;
  const ax = Math.abs(x);
  const m = f(f(1 / Math.max(ax, 1)) * Math.min(ax, 1));
  const m2 = f(m * m);
  let p = f(m2 * f(0.020835) + f(-0.085133));
  p = f(m2 * p + f(0.180141));
  p = f(m2 * p + f(-0.330299));
  p = f(m2 * p + f(0.999866));
  const corr = 1 < ax ? f(f(m * p) * -2 + f(1.570796)) : 0;
  const r = f(m * p + corr);
  return Math.min(x, 1) < -Math.min(x, 1) ? -r : r;
}

/**
 * The lens's per-frame numbers (the game's step computes them in every pixel; they depend only on the field
 * of view and the render size, so we compute them once, in float32, the same on every graphics card):
 * a = 0.7 x horizontal FOV (radians), f = W / tan a, diag = |(W, H)|, k = sin(atan(diag / f)).
 */
export function lensConstants(fov: number, W: number, H: number): { a: number; k: number; diagW: number; hw: [number, number] } {
  const f = Math.fround;
  const a = f(f(fov) * f(0.7));
  const tn = f(f(Math.sin(a)) / f(Math.cos(a)));
  const fpx = f(f(W) / tn);
  const diag = f(Math.sqrt(f(f(f(W) * f(W)) + f(f(H) * f(H)))));
  const k = f(Math.sin(f(atanGpu(f(diag / fpx)) * 1)));
  return { a, k, diagW: f(diag / f(W)), hw: [1, f(f(H) / f(W))] };
}

/**
 * Lens: output pixel -> input, a barrel bend. a = 0.7 x the horizontal field of view, f = W / tan a with W, H
 * the render size, k = sin(atan(diag / f)) (lensConstants); p = centred position x (1, H/W) x W / diag,
 * q = k p, theta = asin(|q|) (the compiler's arcsine polynomial, as the game runs it),
 * input = (theta / a) q / |q| / (1, H/W).
 */
export const LENS = HEAD + VIEW + `
uniform sampler2D t_src;
uniform float u_a, u_k, u_diagW, u_blend;
uniform vec2 u_hw;
uniform vec3 u_blendColor;
void main() {
  vec2 r = (gl_FragCoord.xy - u_view) * u_inv - 0.5;
  r = r + r;
  vec2 pp = (u_hw * r) / u_diagW;
  vec2 q = u_k * pp;
  float qq = dot(q, q);
  float c2 = 1.0 - qq;
  vec2 dir = inversesqrt(qq) * q;
  float x = sqrt(max(c2, 0.0));
  float ac = x * -0.018729 + 0.074261;
  ac = ac * x - 0.212114;
  ac = ac * x + 1.570729;
  float th = sqrt(1.0 - x) * ac;
  vec2 i = (th / u_a) * dir;
  i = i / u_hw;
  i = (i + 1.0) * u_map.xy;
  i = i * 0.5 + u_map.zw;
  i = min(max(i, u_clampP.xy), u_clampP.zw);
  vec3 c = texture(t_src, i).xyz;
  o = vec4(max(u_blend * (u_blendColor - c) + c, 0.0), 0.0);
}`;

export const COMPLEX_PASSES = { tonemap: TONEMAP, sharpen: SHARPEN, posterize: POSTERIZE, grain: GRAIN, tape: TAPE, lens: LENS };
