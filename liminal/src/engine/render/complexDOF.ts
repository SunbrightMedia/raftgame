/**
 * The Complex's depth of field: Unreal 5's DiaphragmDOF as that game runs it (its steps cs_8836 setup, cs_8837 its
 * own temporal step, cs_19313 / cs_19314 the blur-size tiles, cs_8840 downsample, cs_19315 reduce, cs_8843 bokeh
 * shape, cs_8844 / cs_8848 / cs_8849 the near, far and slightly-out-of-focus gathers, cs_8845 post filter, cs_19317
 * recombine), written again as our own fragment shaders with the same maths and numbers (read from the shaders'
 * bytes in the deep export); the game's code is not copied. Checked step by step against the game's own steps
 * (tools/complex/check_dof.py).
 *
 * The game's focus: 67.9 cm, blur at infinity 0.086 % of the width; so everything past arm's length is a little
 * soft, and only things nearer than about 20 cm get a near-field blur (the same in all ten captured frames).
 *
 * Rows: row 0 = the top. Blur sizes ("CoC", circle of confusion radius) are signed: negative = in front of the focus.
 */

const COMMON = /* glsl */ `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
vec4 fetchClamp(sampler2D t, ivec2 p) { return texelFetch(t, clamp(p, ivec2(0), textureSize(t, 0) - 1), 0); }
vec4 pointUV(sampler2D t, vec2 uv) { ivec2 s = textureSize(t, 0); return texelFetch(t, clamp(ivec2(floor(uv * vec2(s))), ivec2(0), s - 1), 0); }
// The card stores half floats by cutting toward zero (measured on the upscaler's output): done here, sign kept, so
// any card stores the value unchanged. Every step's output goes through this.
vec4 h16(vec4 v) {
  v = clamp(v, -65504.0, 65504.0);
  vec4 n = uintBitsToFloat(floatBitsToUint(v) & 0xffffe000u);
  vec4 s = trunc(v * 16777216.0) * 5.96046448e-08;
  return mix(s, n, greaterThanEqual(abs(v), vec4(6.10351562e-05)));
}
`;

/** Shared by both setup passes: one full-size pixel's colour and blur size (in the units given by `scale`). */
const SETUP_FN = /* glsl */ `
uniform sampler2D t_scene, t_depth;
uniform vec4 u_buf;        // the scene's buffer: size, 1 / size              (the game's cb1[132])
uniform vec4 u_uvClamp;    // its view's uv bounds                            (cb1[133])
uniform vec4 u_zToCm;      // depth -> cm: d x + y + 1 / (d z - w)            (cb1[71])
uniform vec4 u_depthMap;   // stored depth -> the game's (1 near, 0 far) = d x + y; z = 1: rows from the bottom
uniform vec4 u_coc;        // x: blur at infinity (share of the width); y, z: its clamp  (cb0[1])
uniform vec4 u_blur;       // y: Unreal's depth blur radius; z: its rate     (cb0[2])
uniform float u_focus;     // the focus distance, cm                         (cb1[155].y)
float depthAt(ivec2 p) {
  ivec2 s = textureSize(t_depth, 0);
  p = clamp(p, ivec2(0), s - 1);
  if (u_depthMap.z > 0.5) p.y = s.y - 1 - p.y;
  return texelFetch(t_depth, p, 0).r * u_depthMap.x + u_depthMap.y;
}
vec4 setupPixel(ivec2 p, float scale) {
  vec2 uv = min(max((vec2(p) + 0.5) * u_buf.zw, u_uvClamp.xy), u_uvClamp.zw);
  ivec2 q = clamp(ivec2(floor(uv * u_buf.xy)), ivec2(0), ivec2(u_buf.xy) - 1);
  vec3 c = texelFetch(t_scene, q, 0).rgb;
  float d = depthAt(q);
  float z = 1.0 / (d * u_zToCm.z - u_zToCm.w) + (d * u_zToCm.x + u_zToCm.y);
  float r = (z - u_focus) / z * u_coc.x;
  float far_ = (1.0 - exp2(-z * u_blur.z)) * u_blur.y;
  float coc = clamp(max(far_, abs(r)) * sign(r), u_coc.y, u_coc.z);
  return vec4(c, coc * scale);
}
`;

/** 1a. Setup, full size: colour and blur size in full-size pixels of the half width (the game: x 504). */
export const DOF_SETUP_FULL = COMMON + SETUP_FN + /* glsl */ `
uniform vec2 u_scale;      // blur size -> pixels: full, half                 (cb0[4].xy)
out vec4 o;
void main() { o = h16(setupPixel(ivec2(gl_FragCoord.xy), u_scale.x)); }`;

/** 1b. Setup, half size: each 2 x 2 averaged (weighted toward the nearest blur), the smallest blur size kept. */
export const DOF_SETUP_HALF = COMMON + SETUP_FN + /* glsl */ `
uniform vec2 u_scale;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * 2;
  vec4 a = setupPixel(p, u_scale.y), b = setupPixel(p + ivec2(1, 0), u_scale.y), c = setupPixel(p + ivec2(0, 1), u_scale.y), d = setupPixel(p + ivec2(1, 1), u_scale.y);
  float m = min(min(a.w, b.w), min(c.w, d.w));
  vec4 w = clamp(vec4(m - a.w, m - b.w, m - c.w, m - d.w) * -64.0 + 1.0, 0.0, 1.0);
  vec3 s = b.rgb * w.y;
  s = a.rgb * w.x + s;
  s = c.rgb * w.z + s;
  s = d.rgb * w.w + s;
  o = h16(vec4(s * (1.0 / dot(vec4(1.0), w)), m));
}`;

/** 2. The depth of field's own temporal step: the half-size setup made over frames, at half the output size, as
 *  the upscaler (complexTAA.ts) but with 5 neighbours, the blur size carried in alpha and neighbours weighed by it. */
export const DOF_TAA = COMMON + /* glsl */ `
uniform sampler2D t_scene;   // the half-size setup (colour, blur size), this frame's jitter
uniform sampler2D t_depth;   // full-size depth
uniform sampler2D t_vel, t_stencil, t_hist;
uniform vec4 u_uvMax;        // xy: uv clamp; zw: 1 / output size             (the game's cb0[1])
uniform vec4 u_out;          // output size, 1 / size                          (cb0[11])
uniform vec4 u_in;           // input view size, 1 / size                      (cb0[26])
uniform vec4 u_inMin;        // xy: input view's first pixel; zw: jitter (input pixels)  (cb0[27])
uniform vec4 u_buf;          // input buffer size, 1 / size                    (cb0[9])
uniform vec4 u_bufUV;        // output uv -> input buffer uv, for the stencil  (cb0[0])
uniform vec4 u_inClamp;      // input pixels read: first xy, last zw          (cb0[10])
uniform vec4 u_hist, u_histClamp, u_toHist, u_resp, u_dither;   //            (cb0[14], [15], [16], [2], [13])
uniform vec4 u_misc;         // x: camera cut; y: input / output; z: output / input; w: frame index
uniform vec4 u_c2p0, u_c2p1, u_c2p2, u_c2p3;
uniform vec4 u_depthMap;
uniform float u_exposure;
out vec4 o;
vec4 point(sampler2D t, ivec2 p) { return fetchClamp(t, p); }
float depthAt(ivec2 p) {
  ivec2 s = textureSize(t_depth, 0);
  p = clamp(p, ivec2(0), s - 1);
  if (u_depthMap.z > 0.5) p.y = s.y - 1 - p.y;
  return texelFetch(t_depth, p, 0).r * u_depthMap.x + u_depthMap.y;
}
vec3 ycocg(vec3 c) { return vec3(c.r + c.b + c.g * 2.0, c.r * 2.0 - c.b * 2.0, -c.r - c.b + c.g * 2.0); }
vec4 tap(ivec2 p) { vec4 c = texelFetch(t_scene, clamp(p, ivec2(u_inClamp.xy), ivec2(u_inClamp.zw)), 0); return vec4(ycocg(c.rgb), c.a); }
float spatial(float d2, float u2) { float x = min(d2 * u2, 1.0); return (x * 0.904999971 - 1.89999998) * x + 1.0; }
void main() {
  ivec2 pix = ivec2(gl_FragCoord.xy);
  vec2 uv = min((vec2(pix) + 0.5) * u_uvMax.zw, u_uvMax.xy);
  vec2 screen = vec2(uv.x * 2.0 - 1.0, uv.y * -2.0 + 1.0);
  bool responsive = (uint(point(t_stencil, ivec2(trunc((uv * u_bufUV.xy + u_bufUV.zw) * u_buf.xy))).r) & 8u) != 0u;
  vec2 ppco = uv * u_in.xy + u_inMin.zw;
  vec2 ppck = floor(ppco) + 0.5;
  vec2 kuv = (ppck + u_inMin.xy) * u_buf.zw;
  // the nearest depth: the centre and four diagonal neighbours 4 full-size pixels away
  ivec2 dc = ivec2(floor(kuv * vec2(textureSize(t_depth, 0))));
  float d0 = depthAt(dc), d1 = depthAt(dc + ivec2(-4, -4)), d2 = depthAt(dc + ivec2(4, -4)), d3 = depthAt(dc + ivec2(-4, 4)), d4 = depthAt(dc + ivec2(4, 4));
  float xTop = d2 < d1 ? -4.0 : 4.0, xBot = d4 < d3 ? -4.0 : 4.0;
  float top = max(d2, d1), bot = max(d3, d4), best = max(bot, top);
  vec2 off = bot < top ? vec2(xTop, -4.0) : vec2(xBot, 4.0);
  float depth = d0; vec2 offUV = vec2(0.0);
  if (d0 < best) { depth = best; offUV = off * u_buf.zw; }
  vec3 pc = u_c2p1.xyw * screen.y;
  pc = u_c2p0.xyw * screen.x + pc;
  pc = u_c2p2.xyw * depth + pc;
  pc = pc + u_c2p3.xyw;
  vec2 back = screen - pc.xy / pc.z;
  vec2 mv = pointUV(t_vel, u_buf.zw * (ppck + u_inMin.xy) + offUV).xy;
  if (0.0 < mv.x) { vec2 e = mv * 4.00801611 - 2.00397754; back = abs(e) * e * 0.5; }
  vec2 bo = back * u_out.xy;
  float speed = sqrt(dot(bo, bo));
  vec2 prev = screen - back;
  bool offScreen = max(abs(prev.y), abs(prev.x)) >= 1.0;
  // five neighbours (a cross): colour as YCoCg, blur size
  ivec2 kc = ivec2(kuv * u_buf.xy);
  vec4 tN = tap(kc + ivec2(0, -1)), tW = tap(kc + ivec2(-1, 0)), tC = tap(kc), tE = tap(kc + ivec2(1, 0)), tS = tap(kc + ivec2(0, 1));
  vec3 lo = min(min(min(tC.xyz, tN.xyz), min(tW.xyz, tE.xyz)), tS.xyz), hi = max(max(max(tC.xyz, tN.xyz), max(tW.xyz, tE.xyz)), tS.xyz);
  float cLo = min(min(min(tW.w, tC.w), min(tN.w, tE.w)), tS.w), cHi = max(max(max(tW.w, tC.w), max(tN.w, tE.w)), tS.w);
  // last frame's picture there: Catmull-Rom, 5 taps
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
  bool cut = u_misc.x != 0.0;
  bool ignore = cut || offScreen;
  vec4 hc = vec4(min(max(hy, lo), hi), min(cHi, max(cLo, h.a)));
  float fs = max(-(speed * u_misc.z) * 0.100000001 + (ignore ? 0.0 : 1.0), u_misc.y);
  float u2 = (fs * fs) * (u_misc.z * u_misc.z);
  // the filtered new frame: 5 taps, each weighed by distance and by how close its blur size is to the centre's
  vec2 dko = ppco - ppck;
  float cw = 1.0 < abs(tC.w) ? 1.0 / abs(tC.w) : 1.0;
  float wN = spatial(dot(vec2(0.0, -1.0) - dko, vec2(0.0, -1.0) - dko), u2), aN = clamp(-(tC.w - tN.w) * cw + 1.0, 0.0, 1.0);
  float wW = spatial(dot(vec2(-1.0, 0.0) - dko, vec2(-1.0, 0.0) - dko), u2), aW = clamp(-(tC.w - tW.w) * cw + 1.0, 0.0, 1.0);
  float kN = wN * aN, kW = wW * aW;
  vec3 sum = tN.xyz * kN + tW.xyz * kW;
  float wsum = wN * aN + kW;
  float wC = spatial(dot(-dko, -dko), u2);
  sum = tC.xyz * wC + sum; wsum = wsum + wC;
  float wE = spatial(dot(vec2(1.0, 0.0) - dko, vec2(1.0, 0.0) - dko), u2), aE = clamp(-(tC.w - tE.w) * cw + 1.0, 0.0, 1.0);
  sum = tE.xyz * (aE * wE) + sum; wsum = wE * aE + wsum;
  float wS = spatial(dot(vec2(0.0, 1.0) - dko, vec2(0.0, 1.0) - dko), u2), aS = clamp(-(tC.w - tS.w) * cw + 1.0, 0.0, 1.0);
  sum = tS.xyz * (aS * wS) + sum; wsum = wS * aS + wsum;
  float inv = 1.0 / wsum;
  vec4 filt = vec4(sum * inv, tC.w);
  // the blend: as the upscaler's, held back where the history's blur size differs from the centre's
  float wc = spatial(dot(dko, dko), u2) * u2;
  float blend = min(speed * 0.0250000004, 1.0) * (-wc * u_resp.w + 0.200000003) + wc * u_resp.w;
  float a = hy.x * 0.00999999978, den = abs(sum.x * inv - hy.x);
  blend = max(den > 0.0 ? clamp(a / den, 0.0, 1.0) : (a > 0.0 ? 1.0 : 0.0), blend);
  float same = clamp(-abs(tC.w - hc.w) * cw + 1.0, 0.0, 1.0);
  blend = same * (responsive ? -0.75 : blend - 1.0) + 1.0;
  if (cut) blend = 1.0;
  vec4 hv = ignore ? filt : hc;
  float wf = 1.0 / (filt.x * u_exposure + 4.0), wh = 1.0 / (hv.x * u_exposure + 4.0);
  float a1 = wh * (1.0 - blend), a2 = wf * blend;
  float s = 1.0 / ((1.0 - blend) * wh + a2);
  vec4 y4 = hv * (s * a1) + filt * (s * a2);
  vec3 y = y4.xyz;
  vec3 q = y * 0.25;
  vec3 rgb = vec3(-y.z * 0.25 + (q.y + q.x), q.z + q.x, -y.z * 0.25 + (y.x * 0.25 - q.y));
  rgb = min(max(rgb, 0.0), 65504.0);
  float coc = isnan(y4.w) ? 0.0 : min(y4.w, 65504.0);
  uvec3 v = uvec3(uvec2(pix), uint(u_misc.w)) * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; v.x += v.y * v.z;
  float rnd = fract(float(v.x >> 16u) * 1.52587891e-05);
  vec3 stepv = uintBitsToFloat(floatBitsToUint(rgb * u_dither.xyz) & 0xff800000u);
  o = h16(vec4(stepv * rnd + rgb, coc));
}`;

/** 3. Blur-size tiles (8 x 8 threads, each reading a 2 x 2 of the temporal step's blur sizes): near (negative)
 *  smallest and largest; far largest and smallest; the smallest positive. Two pictures: (near min, near max), and
 *  (far max, far min, smallest positive, far min). */
export const DOF_FLATTEN = COMMON + /* glsl */ `
uniform sampler2D t_src;
uniform vec4 u_uv;          // thread -> uv: xy scale; zw max                 (the game's cb0[1])
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1;
void main() {
  ivec2 g = ivec2(gl_FragCoord.xy) * 8;
  ivec2 s = textureSize(t_src, 0);
  float nMin = 0.0, nMax = -3.0e38, fMax = 0.0, fMin = 3.0e38, pos = 16384.0;
  bool first = true;
  for (int i = 0; i < 64; i++) {
    vec2 uv = min((vec2(g + ivec2(i % 8, i / 8)) + 0.5) * u_uv.xy, u_uv.zw);
    ivec2 b = ivec2(floor(uv * vec2(s) - 0.5));
    vec4 c = vec4(fetchClamp(t_src, b + ivec2(0, 1)).a, fetchClamp(t_src, b + ivec2(1, 1)).a, fetchClamp(t_src, b + ivec2(1, 0)).a, fetchClamp(t_src, b).a);
    vec4 n = min(c, 0.0), f = max(c, 0.0);
    vec4 p = mix(vec4(16384.0), c, greaterThan(c, vec4(0.0)));
    float tnMin = min(min(n.x, n.y), min(n.z, n.w)), tnMax = max(max(n.x, n.y), max(n.z, n.w));
    float tfMax = max(max(f.x, f.y), max(f.z, f.w)), tfMin = min(min(f.x, f.y), min(f.z, f.w));
    float tp = min(min(p.x, p.y), min(p.z, p.w));
    if (first) { nMin = tnMin; nMax = tnMax; fMax = tfMax; fMin = tfMin; pos = tp; first = false; }
    else { nMin = min(nMin, tnMin); nMax = max(nMax, tnMax); fMax = max(fMax, tfMax); fMin = min(fMin, tfMin); pos = min(pos, tp); }
  }
  o0 = h16(vec4(nMin, nMax, 0.0, 0.0));
  o1 = h16(vec4(fMax, fMin, pos, fMin));
}`;

/** 4. Blur-size tiles spread to the neighbours a tile's blur reaches: ring 1 (8 tiles) always, ring 2 (16 tiles)
 *  where the blur reaches past 8 pixels; the far tiles' smallest sizes get 8 x `u_k.w` added for ring 2. */
export const DOF_DILATE = COMMON + /* glsl */ `
uniform sampler2D t_near, t_far;
uniform vec4 u_tiles;       // zw: tiles across, down                          (the game's cb0[0])
uniform vec4 u_k;           // z: blur size -> tiles reached; w: ring 2's penalty   (cb0[1])
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1;
void ring(ivec2 t, int r, inout float a[6]) {
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    if (max(abs(x), abs(y)) != r) continue;
    ivec2 q = t + ivec2(x, y);
    if (any(lessThan(q, ivec2(0))) || any(greaterThanEqual(q, ivec2(u_tiles.zw)))) continue;
    vec4 n = texelFetch(t_near, q, 0), f = texelFetch(t_far, q, 0);
    float add = r == 2 ? u_k.w * (abs(x) == 2 && abs(y) == 2 ? 11.3137083 : 8.0) : 0.0;   // ring 2's corners: 8 x sqrt 2
    a[0] = min(a[0], n.x); a[1] = max(a[1], n.y); a[2] = min(a[2], f.y); a[3] = max(a[3], f.x);
    a[4] = min(a[4], f.z + add); a[5] = min(a[5], f.w + add);
  }
}
void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  float r1[6] = float[6](0.0, -16384.0, 16384.0, 0.0, 16384.0, 16384.0);
  float r2[6] = float[6](0.0, -16384.0, 16384.0, 0.0, 16384.0, 16384.0);
  ring(t, 1, r1);
  ring(t, 2, r2);
  r2[4] = min(r2[4], 16384.0); r2[5] = min(r2[5], 16384.0);
  vec4 n = texelFetch(t_near, t, 0), f = texelFetch(t_far, t, 0);
  float nMin = n.x, nMax = n.y, fMax = f.x;
  if (0.0 < -r1[0] * u_k.z) nMin = min(r1[0], nMin);
  if (0.0 < r1[3] * u_k.z) fMax = max(f.x, r1[3]);
  if (8.0 < -r2[0] * u_k.z) nMin = min(r2[0], nMin);
  if (8.0 < r2[3] * u_k.z) fMax = max(fMax, r2[3]);
  float reachN = -nMin * u_k.z, reachF = fMax * u_k.z;
  nMax = 0.0 < reachN ? max(r1[1], nMax) : nMax;
  vec3 fr = f.yzw;
  if (0.0 < reachF) fr.xy = vec2(min(fr.x, r1[2]), min(fr.y, r1[4]));
  fr.z = min(fr.z, r1[5]);
  nMax = 8.0 < reachN ? max(nMax, r2[1]) : nMax;
  if (8.0 < reachF) fr.xy = vec2(min(r2[2], fr.x), min(r2[4], fr.y));
  fr.z = min(r2[5], fr.z);
  o0 = h16(vec4(nMin, nMax, 0.0, 0.0));
  o1 = h16(vec4(fMax, fr));
}`;

/** 5. Downsample to quarter size: each 2 x 2 weighed toward the blur size picked as the game picks it. */
export const DOF_DOWNSAMPLE = COMMON + /* glsl */ `
uniform sampler2D t_src;
uniform vec4 u_max;         // xy: uv clamp; z: blur size scale                (the game's cb0[1])
uniform vec4 u_inv;         // zw: 1 / source size                             (cb0[2])
out vec4 o;
void main() {
  vec2 c = (gl_FragCoord.xy * u_inv.zw) * 2.0;     // (pixel + 0.5) is gl_FragCoord
  vec4 a = pointUV(t_src, min(c + u_inv.zw * vec2(-0.5, -0.5), u_max.xy)), b = pointUV(t_src, min(c + u_inv.zw * vec2(0.5, -0.5), u_max.xy));
  vec4 d = pointUV(t_src, min(c + u_inv.zw * vec2(-0.5, 0.5), u_max.xy)), e = pointUV(t_src, min(c + u_inv.zw * vec2(0.5, 0.5), u_max.xy));
  float pick = b.w < abs(a.w) ? b.w : a.w;
  pick = d.w < abs(pick) ? d.w : pick;
  pick = e.w < abs(pick) ? e.w : pick;
  vec4 w = clamp(-vec4(pick - a.w, pick - b.w, pick - d.w, pick - e.w) * 64.0 + 1.0, 0.0, 1.0);
  vec3 s = b.rgb * w.y;
  s = a.rgb * w.x + s;
  s = d.rgb * w.z + s;
  s = e.rgb * w.w + s;
  o = h16(vec4(s * (1.0 / dot(vec4(1.0), w)), pick * u_max.z));
}`;

/** 6. Reduce, level 0: the temporal step's picture into the gathers' 720 x 544 input (rows past the picture repeat
 *  its last). The game also takes bright near pixels out here for bokeh sprites; that needs a near blur over 4.3
 *  half-size pixels (closer than 8.5 cm to the lens), which our player cannot reach, so nothing is taken out. */
export const DOF_REDUCE = COMMON + /* glsl */ `
uniform sampler2D t_src;
uniform vec4 u_uv;          // xy: uv clamp                                    (the game's cb0[1])
uniform vec4 u_inv;         // zw: 1 / source size                             (cb0[5])
out vec4 o;
void main() { o = h16(pointUV(t_src, min(gl_FragCoord.xy * u_inv.zw, u_uv.xy))); }`;

/** 7. The "slightly out of focus" gather (half size): rings of neighbours, each weighed by its blur's area and how
 *  far its blur reaches; alpha = how much of the gather is such blur. Tiles with no blur, or only blur too big for
 *  it, write nothing. */
export const DOF_GATHER_SLIGHT = COMMON + /* glsl */ `
uniform sampler2D t_src, t_near, t_far;
uniform vec4 u_view;        // zw: the view's size (pixels written)            (the game's cb0[1])
uniform vec4 u_uvScale;     // zw: pixel -> source uv                          (cb0[2])
uniform vec4 u_back;        // zw: source uv -> pixel                          (cb0[4])
uniform vec4 u_k;           // y: the largest blur it takes; z: x squash       (cb0[5])
uniform vec4 u_rings;       // y: most rings                                   (cb0[6])
uniform vec4 u_src;         // zw: 1 / source size                             (cb0[8])
uniform vec4 u_srcView;     // xy: source view size                            (cb0[9])
out vec4 o;
vec2 mirror(vec2 uv, vec2 hi) { uv = min(abs(uv), hi * 2.0 - abs(uv)); return min(hi, uv); }
void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  ivec2 tile = t / 8;
  vec2 nr = texelFetch(t_near, tile, 0).xy, fr = texelFetch(t_far, tile, 0).xy;
  float least = fr.x == 0.0 ? -nr.y : min(fr.y, -nr.y);
  least = nr.x == 0.0 ? fr.y : least;
  least = nr.x == 0.0 && fr.x == 0.0 ? 16384.0 : least;
  if (u_rings.y < least) { o = vec4(0.0); return; }
  vec2 base = (vec2(t) + 0.5) * u_uvScale.zw;
  uint n = uint(roundEven(min(max(fr.x, -nr.x), u_rings.y)));
  vec2 hi = (u_srcView.xy - 0.5) * u_src.zw;
  float reach = float(n) + 0.5;
  vec3 sum = vec3(0.0); float s1 = 0.0, s2 = 0.0, cnt = 0.0;
  for (uint r = 1u; r <= 4u; r++) {
    if (r > n) break;
    float fr_ = float(r);
    for (uint j = 0u; j < 8u; j++) {
      if (j >= 2u * r) break;
      vec2 a = j < r ? vec2(fr_, float(j)) : vec2(2.0 * fr_ - float(j), fr_);
      for (int k = 0; k < 2; k++) {
        vec2 off = k == 1 ? vec2(-a.y, a.x) : a;
        if (reach < length(off)) continue;
        float d = length(vec2(off.x * u_k.z, off.y));
        vec4 A = textureLod(t_src, mirror(off * u_src.zw + base, hi), 0.0);
        vec4 B = textureLod(t_src, mirror(-off * u_src.zw + base, hi), 0.0);
        float iaA = 1.0 / (A.w * A.w * 3.14159274); iaA = isnan(iaA) ? 5.09295797 : min(iaA, 5.09295797);
        float iaB = 1.0 / (B.w * B.w * 3.14159274); iaB = isnan(iaB) ? 5.09295797 : min(iaB, 5.09295797);
        float kA = clamp(u_k.y - abs(A.w), 0.0, 1.0), kB = clamp(u_k.y - abs(B.w), 0.0, 1.0);
        bool aLess = A.w < B.w;
        float cov = aLess ? clamp((abs(A.w) - d) * 4.0 + 0.5, 0.0, 1.0) : clamp((abs(B.w) - d) * 4.0 + 0.5, 0.0, 1.0);
        float w = cov * (aLess ? iaA : iaB);
        sum = A.rgb * (kA * w) + sum;
        sum = B.rgb * (kB * w) + sum;
        s1 = w * kA + s1;
        s1 = w * kB + s1;
        s2 = cov * clamp(u_k.y - A.w, 0.0, 1.0) + s2;
        s2 = cov * clamp(u_k.y - B.w, 0.0, 1.0) + s2;
        cnt = cov * 2.0 + cnt;
      }
    }
  }
  vec4 C = textureLod(t_src, min(hi, min(hi * 2.0 - abs(base), abs(base))), 0.0);
  float iaC = 1.0 / (C.w * C.w * 3.14159274); iaC = isnan(iaC) ? 5.09295797 : min(iaC, 5.09295797);
  float kC = clamp(u_k.y - abs(C.w), 0.0, 1.0);
  float wC = iaC * kC;
  s1 = iaC * kC + s1;
  vec3 col = (C.rgb * wC + sum) * (0.0 < s1 ? 1.0 / s1 : 0.0);
  float alpha = (clamp(u_k.y - C.w, 0.0, 1.0) + s2) * (1.0 / (cnt + 1.0));
  o = h16(vec4(col, alpha));
}`;

/** 8a. Each 8 x 8 group of full-size pixels: its largest small blur (each pixel looks at itself and at four pixels 6
 *  away diagonally, keeping sizes under 3; the group takes the most). The game does this per group in shared memory. */
export const DOF_GROUP_MAX = COMMON + /* glsl */ `
uniform sampler2D t_full;
uniform vec4 u_vp, u_viewSize, u_viewMin, u_buf, u_uvClamp;
out vec4 o;
vec4 full(vec2 uv) { return pointUV(t_full, min(max(uv, u_uvClamp.xy), u_uvClamp.zw)); }
void main() {
  ivec2 g = ivec2(gl_FragCoord.xy) * 8;
  float gm = 0.0;
  for (int i = 0; i < 64; i++) {
    vec2 uv = min(max(((vec2(g + ivec2(i % 8, i / 8)) + 0.5) * u_vp.zw * u_viewSize.xy + u_viewMin.xy) * u_buf.zw, u_uvClamp.xy), u_uvClamp.zw);
    float c = abs(full(uv).w);
    float m = c < 3.0 ? c : 0.0;
    for (int k = 0; k < 4; k++) {
      vec2 off = vec2(k == 0 || k == 2 ? -1.0 : 1.0, k < 2 ? -1.0 : 1.0);
      float s = abs(full(off * u_buf.zw * 6.0 + uv).w);
      m = max(m, s < 3.0 ? s : m);
    }
    gm = max(gm, m);
  }
  o = vec4(gm, 0.0, 0.0, 0.0);
}`;

/** 8. Recombine (full size): where an 8 x 8 group has any blur over 0.125 pixels, a small disk of up to 12 pairs of
 *  samples (rotated by a hash per pixel and frame), each weighed by its blur's area and reach, held near the half-size
 *  gather's range; elsewhere the sharp pixel. The game's near, background and translucency layers mixed in after are
 *  empty for its settings and ours (see above), so they are left out. */
export const DOF_RECOMBINE = COMMON + /* glsl */ `
uniform sampler2D t_full, t_slight;
uniform vec4 u_vp;          // zw: 1 / view size (thread -> view uv)          (the game's cb0[4])
uniform vec4 u_viewSize, u_viewMin, u_buf, u_uvClamp;   // view size, first pixel, buffer size / 1 / size, uv clamp  (cb1[129], [128], [132], [133])
uniform vec4 u_half;        // xy: half-size offset; zw: half-size uv max      (cb0[5])
uniform vec4 u_halfInv;     // zw: 1 / half-size buffer                        (cb0[12])
uniform vec4 u_squash;      // x: x scale of the disk                          (cb0[2])
uniform sampler2D t_gmax;   // each 8 x 8 group's largest small blur (DOF_GROUP_MAX)
uniform float u_frame;
out vec4 o;
vec4 full(vec2 uv) { return pointUV(t_full, min(max(uv, u_uvClamp.xy), u_uvClamp.zw)); }
uint brev(uint x) {          // bit reverse (GLSL ES 3.0 has no bitfieldReverse)
  x = ((x >> 1u) & 0x55555555u) | ((x & 0x55555555u) << 1u);
  x = ((x >> 2u) & 0x33333333u) | ((x & 0x33333333u) << 2u);
  x = ((x >> 4u) & 0x0f0f0f0fu) | ((x & 0x0f0f0f0fu) << 4u);
  x = ((x >> 8u) & 0x00ff00ffu) | ((x & 0x00ff00ffu) << 8u);
  return (x >> 16u) | (x << 16u);
}
float smooth01(float x) { return x * x * (3.0 - 2.0 * x); }
void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  vec2 uv = min(max(((vec2(t) + 0.5) * u_vp.zw * u_viewSize.xy + u_viewMin.xy) * u_buf.zw, u_uvClamp.xy), u_uvClamp.zw);
  vec4 here = full(uv);
  float gmax = texelFetch(t_gmax, t / 8, 0).x;
  vec2 huv = min(((vec2(t) + 0.5) * 0.5 - u_half.xy * 0.5) * u_halfInv.zw, u_half.zw);
  vec3 col; float a;
  if (0.125 < gmax) {
    uvec3 v = uvec3(uvec2(t), uint(u_frame)) * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; v.x += v.y * v.z; v.y += v.z * v.x;
    float rnd = float(v.x >> 16u) * 1.52587891e-05;
    float rad = ceil(gmax * 2.0) + 0.5;
    uint count = min(uint((gmax * 2.0) * (gmax * 2.0) * 1.57079637), 12u);
    float c2 = here.w * here.w;
    float wC = min(1.0 / (c2 * 12.566371), 1.27323949);
    vec3 sum = here.rgb * wC;
    float s1 = wC, s2 = clamp(3.0 - here.w, 0.0, 1.0), cnt = 1.0;
    for (uint i = 0u; i < 12u; i++) {
      if (i >= count) break;
      vec2 sq = vec2(fract(float(i) * 0.0833333358 + rnd), float((brev(i) ^ v.y) >> 16u)) * vec2(1.41421354, 2.15791861e-05) - 0.707106769;
      vec2 sq2 = sq * sq;
      float R = sqrt(max(sq2.y, sq2.x) * 2.0 - min(sq2.y, sq2.x));
      vec2 sr = vec2(0.0 < sq.x ? R : -R, 0.0 < sq.y ? R : -R);
      vec2 p = (sq2.y < sq2.x ? vec2(sr.x, sq.y) : vec2(sq.x, sr.y)) * rad;
      p = sign(p) * floor(abs(p) + 0.5);
      float dist = length(p);
      vec2 o2 = p * u_buf.zw;
      o2.x *= u_squash.x;
      vec4 A = full(uv + o2), B = full(uv - o2);
      float cA = smooth01(clamp((max(abs(A.w), 0.25) - dist * 0.5) * 4.0 + 0.5, 0.0, 1.0));
      float cB = smooth01(clamp((max(abs(B.w), 0.25) - dist * 0.5) * 4.0 + 0.5, 0.0, 1.0));
      float iaA = min(1.0 / (A.w * A.w * 12.566371), 1.27323949), iaB = min(1.0 / (B.w * B.w * 12.566371), 1.27323949);
      if (A.w < B.w) { cB = cA; iaB = iaA; } else if (B.w < A.w) { cA = cB; iaA = iaB; }
      float wA = cA * iaA, wB = cB * iaB;
      float kA = clamp(3.0 - abs(A.w), 0.0, 1.0), kB = clamp(3.0 - abs(B.w), 0.0, 1.0);
      sum = A.rgb * (kA * wA) + sum;
      s1 = wA * kA + s1;
      s2 = cA * clamp(3.0 - A.w, 0.0, 1.0) + s2;
      cnt = cA + cnt;
      sum = B.rgb * (kB * wB) + sum;
      s1 = wB * kB + s1;
      s2 = cB * clamp(3.0 - B.w, 0.0, 1.0) + s2;
      cnt = cnt + cB;
    }
    // held near the half-size gather's range around this pixel
    vec4 q0 = textureLod(t_slight, min(huv + u_halfInv.zw * vec2(-0.5, -0.5), u_half.zw), 0.0), q1 = textureLod(t_slight, min(huv + u_halfInv.zw * vec2(0.5, -0.5), u_half.zw), 0.0);
    vec4 q2 = textureLod(t_slight, min(huv + u_halfInv.zw * vec2(-0.5, 0.5), u_half.zw), 0.0), q3 = textureLod(t_slight, min(huv + u_halfInv.zw * vec2(0.5, 0.5), u_half.zw), 0.0);
    vec4 lo = min(min(q1, q0), min(q2, q3)), hi = max(max(q1, q0), max(q2, q3));
    vec2 k2 = min(vec2(c2 * 0.015625, c2 * 4.0), 1.0);
    float k = (1.0 - k2.x) * 0.125;
    vec4 up = vec4(lo.a, lo.rgb) * k + vec4(hi.a, hi.rgb), dn = -vec4(lo.a, lo.rgb) * k + vec4(lo.a, lo.rgb);
    up.x = clamp(up.x, 0.0, 1.0); dn.x = clamp(dn.x, 0.0, 1.0);
    vec3 held = min(up.yzw * s1, max(dn.yzw * s1, sum));
    col = (held - sum) * k2.y + sum;
    a = clamp(min(cnt * up.x, max(cnt * dn.x, s2)), -3.0e38, 3.0e38);
    a = (a - s2) * k2.y + s2;
    a = 0.0 < s1 ? clamp(a * (0.0 < cnt ? 1.0 / cnt : 0.0), 0.0, 1.0) : 0.0;
    col = col * (0.0 < s1 ? 1.0 / s1 : 0.0);
  } else {
    col = here.rgb;
    a = clamp(abs(here.w) * -4.0 + 2.0, 0.0, 1.0);
  }
  o = h16(vec4(col, 0.0));
}`;

const FULL_VS = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

/** What the depth of field needs for one frame. Sizes: the input view (inW x inH) in its buffer (bufW x bufH), and
 *  the upscaler's output (outW x outH): the temporal step works at half of it, as the game's. */
export interface DOFInputs {
  scene: WebGLTexture; depth: WebGLTexture; vel: WebGLTexture; stencil: WebGLTexture;
  inW: number; inH: number; bufW: number; bufH: number; outW: number; outH: number;
  depthMap: [number, number, number, number];
  zToCm: [number, number, number, number];
  /** Focus distance (cm), blur at infinity (share of the width), the largest blur (share of the width). The game: 67.92, 0.00086085, 0.025. */
  focus: number; cocInf: number; cocMax: number;
  /** This frame's jitter (full-size input pixels), clip -> last frame's clip (rows), camera cut, frame counter, exposure (eye / pre-exposure). */
  jitter: [number, number]; c2p: number[][]; cut: boolean; frame: number; exposure: number;
  /** For checks: the temporal step's history in place of ours. */
  histIn?: WebGLTexture;
}

interface DTarget { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number; tex2?: WebGLTexture }

/** Runs the depth of field's steps on raw WebGL2; `run` returns the result (the input's buffer size, half floats). */
export class ComplexDOF {
  private progs = new Map<string, { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> }>();
  private t: Record<string, DTarget> = {};
  private vao: WebGLVertexArrayObject;
  private flip = false;
  private key = '';

  constructor(private gl: WebGL2RenderingContext) { this.vao = gl.createVertexArray()!; }

  get targets(): Record<string, DTarget> { return this.t; }

  private prog(name: string, fs: string) {
    let p = this.progs.get(name);
    if (p) return p;
    const gl = this.gl, sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`depth of field ${name}: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const pr = gl.createProgram()!;
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, FULL_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(`depth of field ${name}: ${gl.getProgramInfoLog(pr)}`);
    p = { p: pr, u: new Map() };
    this.progs.set(name, p);
    return p;
  }

  /** A picture (two for `fmt2`: drawn together), remade when its size changes. */
  target(name: string, w: number, h: number, fmt: number, linear = false, fmt2 = 0): DTarget {
    const old = this.t[name];
    if (old && old.w === w && old.h === h) return old;
    const gl = this.gl;
    if (old) { gl.deleteTexture(old.tex); if (old.tex2) gl.deleteTexture(old.tex2); gl.deleteFramebuffer(old.fb); }
    const mk = (f: number) => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, f, w, h);
      const m = linear ? gl.LINEAR : gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, m); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, m);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    };
    const tex = mk(fmt), tex2 = fmt2 ? mk(fmt2) : undefined;
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (tex2) { gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, tex2, 0); gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return (this.t[name] = { tex, fb, w, h, tex2 });
  }

  private draw(name: string, fs: string, out: DTarget, tex: Record<string, WebGLTexture>, uni: Record<string, number[]>, area?: [number, number]): void {
    const gl = this.gl, P = this.prog(name, fs);
    gl.useProgram(P.p);
    const loc = (k: string) => { if (!P.u.has(k)) P.u.set(k, gl.getUniformLocation(P.p, k)); return P.u.get(k)!; };
    let unit = 0;
    for (const [k, t] of Object.entries(tex)) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc(k), unit++); }
    for (const [k, v] of Object.entries(uni)) {
      const l = loc(k);
      if (!l) continue;
      [gl.uniform1f, gl.uniform2f, gl.uniform3f, gl.uniform4f][v.length - 1].call(gl, l, ...(v as [number, number, number, number]));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fb);
    gl.viewport(0, 0, area?.[0] ?? out.w, area?.[1] ?? out.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    for (let i = 0; i < unit; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, null); }
  }

  run(m: DOFInputs): WebGLTexture {
    const gl = this.gl, { inW, inH, bufW, bufH } = m;
    for (const cap of [gl.BLEND, gl.DEPTH_TEST, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST]) gl.disable(cap);
    gl.colorMask(true, true, true, true);
    gl.bindVertexArray(this.vao);
    const F = gl.RGBA16F;
    const hbW = Math.floor(bufW / 2), hbH = Math.floor(bufH / 2), hvW = Math.floor(inW / 2), hvH = Math.floor(inH / 2);
    const tW = Math.floor(m.outW / 2), tH = Math.floor(m.outH / 2);
    const tlW = Math.ceil(hvW / 8), tlH = Math.ceil(hvH / 8), rW = Math.ceil(tW / 8) * 8, rH = Math.ceil(tH / 8) * 8;
    const sp = hvW / tW;     // the game: 504 / 720 = 0.7
    const uvClamp = [0.5 / bufW, 0.5 / bufH, (inW - 0.5) / bufW, (inH - 0.5) / bufH];
    const c2p = { u_c2p0: m.c2p[0], u_c2p1: m.c2p[1], u_c2p2: m.c2p[2], u_c2p3: m.c2p[3] };
    // 1. setup
    const setupU = { u_buf: [bufW, bufH, 1 / bufW, 1 / bufH], u_uvClamp: uvClamp, u_zToCm: m.zToCm, u_depthMap: m.depthMap,
      u_coc: [m.cocInf, -m.cocMax, m.cocMax, 1], u_blur: [1, 0, 1e-5, 0], u_focus: [m.focus], u_scale: [inW / 2, tW] };
    const full = this.target('full', bufW, bufH, F);
    this.draw('setupFull', DOF_SETUP_FULL, full, { t_scene: m.scene, t_depth: m.depth }, setupU, [inW, inH]);
    const half = this.target('half', hbW, hbH, F);
    this.draw('setupHalf', DOF_SETUP_HALF, half, { t_scene: m.scene, t_depth: m.depth }, setupU, [hvW, hvH]);
    // 2. its own temporal step, at half the output size (history kept between frames)
    const key = `${inW}x${inH}>${tW}x${tH}`, fresh = key !== this.key;
    this.key = key;
    const read = this.target(this.flip ? 'taaB' : 'taaA', tW, tH, F, true), write = this.target(this.flip ? 'taaA' : 'taaB', tW, tH, F, true);
    this.flip = !this.flip;
    this.draw('taa', DOF_TAA, write, { t_scene: half.tex, t_depth: m.depth, t_vel: m.vel, t_stencil: m.stencil, t_hist: m.histIn ?? read.tex }, {
      u_uvMax: [1 - 1 / tW, 1 - 1 / tH, 1 / tW, 1 / tH], u_out: [tW, tH, 1 / tW, 1 / tH], u_in: [hvW, hvH, 1 / hvW, 1 / hvH],
      u_inMin: [0, 0, m.jitter[0] / 2, m.jitter[1] / 2], u_buf: [hbW, hbH, 1 / hbW, 1 / hbH], u_bufUV: [inW / bufW, inH / bufH, 0, 0],
      u_inClamp: [0, 0, hvW - 1, hvH - 1], u_hist: [tW, tH, 1 / tW, 1 / tH], u_histClamp: [0.5 / tW, 0.5 / tH, 1 - 0.5 / tW, 1 - 0.5 / tH],
      u_toHist: [0.5, -0.5, 0.5, 0.5], u_resp: [0, 0, 1, 0.04], u_dither: [1 / 1024, 1 / 1024, 1 / 1024, 0],
      u_misc: [m.cut || fresh ? 1 : 0, sp, 1 / sp, m.frame % 8], u_depthMap: m.depthMap, u_exposure: [m.exposure], ...c2p,
    });
    // 3, 4. blur-size tiles, spread
    const tiles = this.target('tiles', tlW, tlH, gl.RG16F, false, F);
    this.draw('flatten', DOF_FLATTEN, tiles, { t_src: write.tex }, { u_uv: [1 / hvW, 1 / hvH, 1 - 1 / tW, 1 - 1 / tH] });
    const dil = this.target('dilated', tlW, tlH, gl.RG16F, false, F);
    const kz = 0.855555534 * (sp / 0.7);
    this.draw('dilate', DOF_DILATE, dil, { t_near: tiles.tex, t_far: tiles.tex2! }, { u_tiles: [0, 0, tlW, tlH], u_k: [1, 1, kz, 1 / kz] });
    // 6. the gathers' input (level 0)
    const red = this.target('reduce', rW, rH, F, true);
    this.draw('reduce', DOF_REDUCE, red, { t_src: write.tex }, { u_uv: [1 - 0.5 / tW, 1 - 0.5 / tH, 0, 0], u_inv: [tW, tH, 1 / tW, 1 / tH] });
    // 7. the slightly-out-of-focus gather (half size)
    const slight = this.target('slight', hbW, hbH, F, true);
    const yScale = hvH * (rH / tH);
    this.draw('slight', DOF_GATHER_SLIGHT, slight, { t_src: red.tex, t_near: dil.tex, t_far: dil.tex2! }, {
      u_view: [0, 0, hvW, hvH], u_uvScale: [m.jitter[0], m.jitter[1], 1 / hvW, 1 / yScale], u_back: [0, 0, hvW, yScale],
      u_k: [0, 3 / sp, 1, 1], u_rings: [2.3 / sp, 3 / sp, 0, 0], u_src: [rW, rH, 1 / rW, 1 / rH], u_srcView: [tW, tH, 0, 0],
    }, [hvW, hvH]);
    // 8. recombine (full size)
    const view = { u_vp: [inW, inH, 1 / inW, 1 / inH], u_viewSize: [inW, inH, 1 / inW, 1 / inH], u_viewMin: [0, 0, 0, 0], u_buf: [bufW, bufH, 1 / bufW, 1 / bufH], u_uvClamp: uvClamp };
    const gmax = this.target('groupMax', Math.ceil(inW / 8), Math.ceil(inH / 8), gl.R32F);
    this.draw('groupMax', DOF_GROUP_MAX, gmax, { t_full: full.tex }, view);
    const out = this.target('out', bufW, bufH, F);
    this.draw('recombine', DOF_RECOMBINE, out, { t_full: full.tex, t_slight: slight.tex, t_gmax: gmax.tex }, {
      ...view, u_half: [m.jitter[0], m.jitter[1], (hvW - 0.5) / hbW, (hvH - 0.5) / hbH], u_halfInv: [hbW, hbH, 1 / hbW, 1 / hbH],
      u_squash: [1, 0, 0, 0], u_frame: [m.frame % 8],
    }, [inW, inH]);
    gl.bindVertexArray(null);
    return out.tex;
  }
}
