/**
 * The Complex's temporal upscaler: Unreal's TAAU as that game runs it (its compute shader cs_19050, here 1008 x 756
 * -> 1440 x 1080), written again as our own fragment shader, one output pixel each. It computes the same maths with
 * the same numbers (read exactly from the shader's bytes in the deep export); the game's code is not copied.
 * Checked against the game's own compiled shader on the game's own inputs: tools/complex/check_taa.py --ours.
 *
 * Rows: row 0 = the picture's top, as everywhere in the chain (complexPost.ts). Positions on the screen ("screen")
 * run -1..1 with y up, as Unreal's.
 *
 * For each output pixel:
 *  1. Where its centre falls in the input picture, which is drawn with a new sub-pixel jitter each frame (Halton 2, 3;
 *     16 places for 70 %): the nearest input pixel, and the nearest depth among it and its four diagonal neighbours.
 *  2. Where it was last frame: that depth taken through the camera's motion (this frame's clip space -> last
 *     frame's), or a moving thing's own motion vector where one is drawn.
 *  3. The 3 x 3 input pixels around it in YCoCg: a filtered value (each weighted 1 - 1.9 x + 0.905 x^2 by its
 *     distance, and by 1 / (luma + 4) so that one bright pixel does not take over), and the box (min, max) of the
 *     centre and of the neighbours within a radius.
 *  4. Last frame's picture at that place (Catmull-Rom with 5 taps), held inside the box.
 *  5. The two blended: 4 % of the new frame at rest (more where things move, where the history flickers, on
 *     "responsive" pixels and on a camera cut), back to RGB, plus up to one half-float step of dither, then cut
 *     toward zero to a half float, as the card stores it.
 */

/** Unreal's Halton 2, 3 sample, centred: the jitter of frame `index` (input pixels, x right, y down). */
export function haltonJitter(index: number): [number, number] {
  const h = (i: number, b: number) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
  return [h(index + 1, 2) - 0.5, h(index + 1, 3) - 0.5];
}

/** How many jitter places the game cycles through: 8, times the drop in pixel count (Unreal's rule; 70 % -> 16). */
export function jitterCount(screenPercentage: number): number {
  return Math.max(1, Math.min(255, Math.floor(8 * Math.max(1, 1 / (screenPercentage * screenPercentage)))));
}

export const TAAU = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D t_scene;    // the input picture, this frame's jitter, exposed (row 0 = top)
uniform sampler2D t_depth;    // its depth (r); u_depthMap turns it into Unreal's (1 near, 0 far)
uniform sampler2D t_vel;      // moving things' motion vectors (rg, Unreal's encoding; 0 = none drawn): 1 x 1 zero if none
uniform sampler2D t_stencil;  // the stencil as a number (bit 8: "responsive"): 1 x 1 zero if none
uniform sampler2D t_hist;     // last frame's output (row 0 = top), filtered linearly
uniform vec4 u_out;           // output size, 1 / size                                   (the game's cb0[11])
uniform vec4 u_in;            // input view size, 1 / size                               (cb0[26])
uniform vec4 u_inMin;         // xy: the input view's first pixel; zw: this frame's jitter (cb0[27])
uniform vec4 u_buf;           // input buffer size, 1 / size                             (cb0[9])
uniform vec4 u_bufUV;         // output uv -> input buffer uv: scale xy, offset zw       (cb0[0])
uniform vec4 u_inClamp;       // input pixels read: first xy, last zw                    (cb0[10])
uniform vec4 u_hist;          // history size, 1 / size                                  (cb0[14])
uniform vec4 u_histClamp;     // history uv: min xy, max zw                              (cb0[15])
uniform vec4 u_toHist;        // screen -> history uv: scale xy, offset zw               (cb0[16])
uniform vec4 u_resp;          // z: history exposure correction; w: the new frame's share at rest (cb0[2])
uniform vec4 u_misc;          // x: camera cut (1: no history); y: input / output; z: output / input (cb0[3].x, cb0[28].xy); w: frame index
uniform vec4 u_dither;        // xyz: one output step (2^-10: half float)               (cb0[13])
uniform vec4 u_c2p0, u_c2p1, u_c2p2, u_c2p3;   // this frame's clip -> last frame's, as rows (row vector x matrix)
uniform vec4 u_depthMap;      // depth = stored * x + y; z = 1: t_depth's rows run from the bottom
uniform float u_exposure;     // eye adaptation / pre-exposure: brightness for the 1 / (luma + 4) weights
out vec4 o;

vec4 point(sampler2D t, ivec2 p) { return texelFetch(t, clamp(p, ivec2(0), textureSize(t, 0) - 1), 0); }
float depthAt(ivec2 p) {
  ivec2 s = textureSize(t_depth, 0);
  p = clamp(p, ivec2(0), s - 1);
  if (u_depthMap.z > 0.5) p.y = s.y - 1 - p.y;
  return texelFetch(t_depth, p, 0).r * u_depthMap.x + u_depthMap.y;
}
// one input pixel: YCoCg (Y = R + 2G + B) and its weight 1 / (Y x exposure + 4)
vec4 tap(ivec2 p) {
  vec3 c = texelFetch(t_scene, clamp(p, ivec2(u_inClamp.xy), ivec2(u_inClamp.zw)), 0).rgb;
  vec3 y = vec3(c.r + c.b + c.g * 2.0, c.r * 2.0 - c.b * 2.0, -c.r - c.b + c.g * 2.0);
  return vec4(y, 1.0 / (y.x * u_exposure + 4.0));
}
vec3 ycocg(vec3 c) { return vec3(c.r + c.b + c.g * 2.0, c.r * 2.0 - c.b * 2.0, -c.r - c.b + c.g * 2.0); }
float spatial(float d2, float u2) { float x = min(d2 * u2, 1.0); return (x * 0.904999971 - 1.89999998) * x + 1.0; }
// The card stores half floats by cutting toward zero (measured: the game's real output, frame 18325, matches that, not
// rounding to nearest). Done here, so the value written is a half float already and any card stores it unchanged.
vec3 halfDown(vec3 v) {
  vec3 n = uintBitsToFloat(floatBitsToUint(v) & 0xffffe000u);
  vec3 s = floor(v * 16777216.0) * 5.96046448e-08;
  return mix(s, n, greaterThanEqual(v, vec3(6.10351562e-05)));
}

void main() {
  ivec2 pix = ivec2(gl_FragCoord.xy);
  vec2 uv = (vec2(pix) + 0.5) * u_out.zw;
  vec2 screen = vec2(uv.x * 2.0 - 1.0, uv.y * -2.0 + 1.0);
  bool responsive = (uint(point(t_stencil, ivec2(trunc((uv * u_bufUV.xy + u_bufUV.zw) * u_buf.xy))).r) & 8u) != 0u;

  // 1. the input pixel nearest this pixel's centre, and the nearest depth among it and its diagonal neighbours
  vec2 ppco = uv * u_in.xy + u_inMin.zw;
  vec2 ppck = floor(ppco) + 0.5;
  vec2 kuv = (ppck + u_inMin.xy) * u_buf.zw;
  ivec2 kc = ivec2(floor(kuv * u_buf.xy));
  float d0 = depthAt(kc), d1 = depthAt(kc + ivec2(-1, -1)), d2 = depthAt(kc + ivec2(1, -1));
  float d3 = depthAt(kc + ivec2(-1, 1)), d4 = depthAt(kc + ivec2(1, 1));
  float xTop = d2 < d1 ? -1.0 : 1.0, xBot = d4 < d3 ? -1.0 : 1.0;
  float top = max(d2, d1), bot = max(d3, d4), best = max(bot, top);
  vec2 off = bot < top ? vec2(xTop, -1.0) : vec2(xBot, 1.0);
  float depth = d0; ivec2 offPx = ivec2(0);
  if (d0 < best) { depth = best; offPx = ivec2(off); }

  // 2. where it was last frame: the camera's motion at that depth, or a moving thing's own motion
  vec3 pc = u_c2p1.xyw * screen.y;
  pc = u_c2p0.xyw * screen.x + pc;
  pc = u_c2p2.xyw * depth + pc;
  pc = pc + u_c2p3.xyw;
  vec2 back = screen - pc.xy / pc.z;
  vec2 mv = point(t_vel, kc + offPx).xy;
  if (0.0 < mv.x) { vec2 e = mv * 4.00801611 - 2.00397754; back = abs(e) * e * 0.5; }
  vec2 bo = back * u_out.xy;
  float speed = sqrt(dot(bo, bo));
  vec2 prev = screen - back;
  bool offScreen = max(abs(prev.y), abs(prev.x)) >= 1.0;

  // 3. the 3 x 3 neighbourhood: distances to this pixel's centre (input pixels), and the box of the near ones
  vec2 dko = ppco - ppck;
  float rad = (u_misc.z - 1.0) * -0.210000038 + 1.50999999;
  rad *= rad;
  vec4 t[9]; float dd[9];
  for (int i = 0; i < 9; i++) {
    ivec2 k = ivec2(i % 3 - 1, i / 3 - 1);
    t[i] = tap(kc + k);
    vec2 v = vec2(k) - dko;
    dd[i] = dot(v, v);
  }
  vec3 lo = t[4].xyz, hi = t[4].xyz;
  for (int i = 0; i < 9; i++) if (i != 4 && dd[i] < rad) { lo = min(lo, t[i].xyz); hi = max(hi, t[i].xyz); }

  // 4. last frame's picture there: Catmull-Rom, the four corner taps left out and the rest reweighted
  vec2 huv = min(max(prev * u_toHist.xy + u_toHist.zw, u_histClamp.xy), u_histClamp.zw);
  vec2 fl = floor(huv * u_hist.xy - 0.5), tc = fl + 0.5;
  vec2 f = huv * u_hist.xy - tc;
  vec2 f2 = f * f, f3 = f * f2;
  vec2 w0 = f2 - (f2 * f + f) * 0.5;
  vec2 w1 = (f3 * 1.5 - f2 * 2.5) + 1.0;
  vec2 w3 = (f2 * f - f2) * 0.5;
  vec2 w2 = ((1.0 - w0) - w1) - w3;
  vec2 W1 = w2 + w1;
  vec2 s0 = (fl - 0.5) * u_hist.zw, s1 = (w2 * (1.0 / W1) + tc) * u_hist.zw, s2 = (fl + 2.5) * u_hist.zw;
  float k0 = w0.y * W1.x, k1 = w0.x * W1.y, k2 = W1.y * W1.x, k3 = W1.y * w3.x, k4 = W1.x * w3.y;
  float ksum = 1.0 / (((k1 + k0) + W1.x * W1.y) + w3.x * W1.y + w3.y * W1.x);
  vec2 lo0 = max(s0, u_histClamp.xy), hi2 = min(s2, u_histClamp.zw);
  vec4 h = textureLod(t_hist, vec2(s1.x, lo0.y), 0.0) * k0 + textureLod(t_hist, vec2(lo0.x, s1.y), 0.0) * k1;
  h += textureLod(t_hist, s1, 0.0) * k2;
  h += textureLod(t_hist, vec2(hi2.x, s1.y), 0.0) * k3;
  h += textureLod(t_hist, vec2(s1.x, hi2.y), 0.0) * k4;
  h *= ksum;
  vec3 hy = ycocg(h.rgb * u_resp.z);

  // no history: a camera cut, last frame's place off the screen, or a moving thing that has left this pixel
  bool cut = u_misc.x != 0.0;
  bool dynHere = 0.0 < point(t_vel, kc).x;
  bool dyn = dynHere || 0.0 < point(t_vel, kc + ivec2(0, -1)).x || 0.0 < point(t_vel, kc + ivec2(-1, 0)).x
          || 0.0 < point(t_vel, kc + ivec2(1, 0)).x || 0.0 < point(t_vel, kc + ivec2(0, 1)).x;
  bool ignore = cut || offScreen || (!dyn && 0.0 < h.a);
  vec3 hc = min(max(hy, lo), hi);

  // the filtered new frame: narrower with motion (down to input / output), weights over the 9 taps
  float fs = max(-(speed * u_misc.z) * 0.100000001 + (ignore ? 0.0 : 1.0), u_misc.y);
  float u2 = (fs * fs) * (u_misc.z * u_misc.z);
  vec3 sum = vec3(0.0); float wsum = 0.0;
  for (int i = 0; i < 9; i++) { float w = spatial(dd[i], u2); sum += t[i].xyz * (w * t[i].w); wsum += w * t[i].w; }
  float inv = 1.0 / wsum;
  vec3 filt = sum * inv;

  // 5. the new frame's share: 4 % at rest, up to 20 % with motion; more where the history's luma is near the new one
  float wc = spatial(dot(dko, dko), u2) * u2;
  float blend = min(speed * 0.0250000004, 1.0) * (-wc * u_resp.w + 0.200000003) + wc * u_resp.w;
  float a = hy.x * 0.00999999978, den = abs(sum.x * inv - hy.x);
  blend = max(den > 0.0 ? clamp(a / den, 0.0, 1.0) : (a > 0.0 ? 1.0 : 0.0), blend);
  if (responsive) blend = 0.25;
  if (cut) blend = 1.0;
  vec3 hv = ignore ? filt : hc;
  float wf = 1.0 / (filt.x * u_exposure + 4.0), wh = 1.0 / (hv.x * u_exposure + 4.0);
  float a1 = wh * (1.0 - blend), a2 = wf * blend;
  float s = 1.0 / ((1.0 - blend) * wh + a2);
  vec3 y = hv * (s * a1) + filt * (s * a2);
  vec3 q = y * 0.25;
  vec3 rgb = vec3(-y.z * 0.25 + (q.y + q.x), q.z + q.x, -y.z * 0.25 + (y.x * 0.25 - q.y));
  rgb = min(max(rgb, 0.0), 65504.0);
  // dither: up to one step of the half-float output, from Unreal's 3D PCG hash of the pixel and the frame
  uvec3 v = uvec3(uvec2(pix), uint(u_misc.w)) * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; v.x += v.y * v.z;
  float rnd = fract(float(v.x >> 16u) * 1.52587891e-05);
  vec3 stepv = uintBitsToFloat(floatBitsToUint(rgb * u_dither.xyz) & 0xff800000u);
  o = vec4(halfDown(stepv * rnd + rgb), dynHere ? 1.0 : 0.0);
}`;
