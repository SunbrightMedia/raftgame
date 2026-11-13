/**
 * The Complex's motion blur: Unreal 5's, as that game runs it (its steps cs_9520 velocity flatten, vs_9521 / ps_9522
 * tile scatter, cs_9523 tile classify, cs_9525 / cs_9526 / cs_9528 filters), written again as our own fragment
 * shaders with the same maths and the same numbers (read from the shaders' bytes in the deep export); the game's code
 * is not copied. Checked step by step on the game's own pictures: tools/complex/check_mb.py.
 *
 * Rows: row 0 = the top (as the rest of the chain). Motion is in output pixels, times the shutter scale.
 *
 * Steps:
 *  1. flatten (input pixels): each pixel's motion from its depth and the camera (or a moving thing's own vector),
 *     taken at the nearest of its four diagonal neighbours, x the shutter, clamped: stored as (length, angle, depth).
 *  2. tiles (16 x 16 input pixels): the shortest and the longest motion in each.
 *  3. scatter: each tile drawn as a quad stretched along its longest motion, so a fast tile reaches its neighbours;
 *     two draws keep, per tile, the shortest motion that reaches it and the longest.
 *  4. kind (16 x 16 output pixels), from the 3 x 3 tiles around: still (copy), even (all motion alike: a plain
 *     blur along it) or uneven (a blur that weighs each sample by depth and by its own motion). The game's fourth
 *     kind ("very fast") is off in its settings.
 *  5. filter (output pixels): 4 to 16 samples along the tile's longest motion, each pixel jittered by
 *     interleaved gradient noise. The game reads the picture by nearest pixel (its sampler: found by the check, with
 *     it the game's own step matches the card in 99.97 % of values), so a short blur moves whole pixels.
 */

/** What the motion blur needs for one frame. */
export interface MotionBlurInputs {
  /** The picture to blur (the upscaler's output, output size), filtered linearly. */
  scene: WebGLTexture;
  /** The input picture's depth, and moving things' motion vectors (a 1 x 1 zero if none). */
  depth: WebGLTexture; vel: WebGLTexture;
  /** Input view (inW x inH) inside its buffer (bufW x bufH; ours: the same), output size. */
  inW: number; inH: number; bufW: number; bufH: number; outW: number; outH: number;
  /** This frame's clip -> last frame's clip, rows (row vector x matrix), as the upscaler's. */
  c2p: number[][];
  /** depth (stored) -> the game's (1 near, 0 far) = d x + y; z = 1: rows from the bottom. */
  depthMap: [number, number, number, number];
  /** The game's depth -> distance in cm: d x + y + 1 / (d z - w) (Unreal's InvDeviceZToWorldZTransform). */
  zToCm: [number, number, number, number];
  /** Output pixels of blur per output pixel of motion this frame (Unreal: amount / (target fps x frame time) / 2... as
   * the game's constant: velocity scale = 0.5 x output size x this). */
  shutter: number;
  /** The longest blur, output pixels (the game: 576 of 1440). */
  maxBlur: number;
  /** Most samples per pixel (the game: 16). */
  maxSamples: number;
  /** For checks: the game's own pictures in place of a step's (its motion per pixel, its tiles, its scattered tiles). */
  flatIn?: WebGLTexture; tilesIn?: WebGLTexture; dilatedIn?: WebGLTexture;
}

const COMMON = /* glsl */ `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
// The card stores R11G11B10 floats by cutting toward zero, as it does its half floats (the game's stored values have no
// rounding up). Done here, so the value written is one already and any card stores it unchanged.
vec3 r11Down(vec3 v) {
  v = min(max(v, 0.0), vec3(65024.0, 65024.0, 64512.0));
  vec3 n = uintBitsToFloat(floatBitsToUint(v) & uvec3(0xfffe0000u, 0xfffe0000u, 0xfffc0000u));
  vec3 s = floor(v * vec3(1048576.0, 1048576.0, 524288.0)) / vec3(1048576.0, 1048576.0, 524288.0);
  return mix(s, n, greaterThanEqual(v, vec3(6.10351562e-05)));
}
`;

/** Shared by the flatten and tile steps: a pixel's motion (length in output pixels x shutter, clamped; angle; depth cm). */
const FLAT_FN = /* glsl */ `
uniform sampler2D t_depth, t_vel;
uniform vec4 u_view;      // input view: first pixel xy, end zw            (the game's cb0[3])
uniform vec4 u_size;      // input view size, 1 / size                      (cb0[4])
uniform vec4 u_scale;     // xy: screen motion -> output pixels x shutter; z: the longest  (cb0[8])
uniform vec4 u_c2p0, u_c2p1, u_c2p2, u_c2p3;
uniform vec4 u_zToCm;     // (cb1[71])
uniform vec4 u_depthMap;
bool inside(ivec2 p, ivec2 s) { return all(greaterThanEqual(p, ivec2(0))) && all(lessThan(p, s)); }
float dep(ivec2 p) {      // a load outside the picture reads 0 (far)
  ivec2 s = textureSize(t_depth, 0);
  if (!inside(p, s)) return 0.0;
  if (u_depthMap.z > 0.5) p.y = s.y - 1 - p.y;
  return texelFetch(t_depth, p, 0).r * u_depthMap.x + u_depthMap.y;
}
vec2 vel(ivec2 p) { ivec2 s = textureSize(t_vel, 0); return inside(p, s) ? texelFetch(t_vel, p, 0).xy : vec2(0.0); }
// tid: the thread (pixel) number; the pixel read is clamped into the view, the screen position is not (as the game)
vec3 flat3(ivec2 tid, out float depthCm) {
  ivec2 p = min(tid + ivec2(u_view.xy), ivec2(u_view.zw) - 1);
  float tl = dep(p + ivec2(-1, -1)), tr = dep(p + ivec2(1, -1)), bl = dep(p + ivec2(-1, 1)), br = dep(p + ivec2(1, 1));
  float xT = tr < tl ? -1.0 : 1.0, xB = br < bl ? -1.0 : 1.0;
  ivec2 q = p + ivec2(max(br, bl) < max(tr, tl) ? vec2(xT, -1.0) : vec2(xB, 1.0));
  vec2 mv = vel(q);
  float d = dep(q);
  vec2 uv = (vec2(tid) + 0.5) / u_size.xy;
  vec2 screen = vec2(uv.x, 1.0 - uv.y) * 2.0 - 1.0;
  vec3 pc = u_c2p1.xyw * screen.y;
  pc = u_c2p0.xyw * screen.x + pc;
  pc = u_c2p2.xyw * d + pc;
  pc = pc + u_c2p3.xyw;
  vec2 v = screen - pc.xy / pc.z;
  if (0.0 < mv.x) { vec2 e = mv * 4.00801611 - 2.00397754; v = abs(e) * e * 0.5; }
  vec2 m = v * u_scale.xy;
  float len = sqrt(dot(m, m));
  // atan2 by the game's polynomial
  float t = min(abs(m.y), abs(m.x)) / max(abs(m.y), abs(m.x)), t2 = t * t;
  float pol = (t2 * 0.0872929022 - 0.301894993) * t2 + 1.0;
  float a = abs(m.x) < abs(m.y) ? -pol * t + 1.57079637 : t * pol;
  if (m.x < 0.0) a = 3.14159274 - a;
  if (m.y < 0.0) a = -a;
  if (!(0.0 < len)) a = 0.0;
  if (isnan(len) || isnan(a)) { len = 0.0; a = 0.0; }
  depthCm = 1.0 / (d * u_zToCm.z - u_zToCm.w) + (d * u_zToCm.x + u_zToCm.y);
  return vec3(min(len, u_scale.z), a, 0.0);
}
`;

/** 1. Each input pixel's motion, as the game stores it (R11G11B10): length, angle / 2 pi + 0.5, depth (cm). */
export const MB_FLATTEN = COMMON + FLAT_FN + /* glsl */ `
out vec4 o;
void main() {
  float dcm;
  vec3 f = flat3(ivec2(gl_FragCoord.xy), dcm);
  o = vec4(r11Down(vec3(f.x, f.y * 0.159154937 + 0.5, dcm)), 1.0);
}`;

/** For checks: each pixel's motion unrounded (length, angle), over the whole padded tile grid. */
export const MB_FLATTEN_EXACT = COMMON + FLAT_FN + /* glsl */ `
out vec4 o;
void main() { float dcm; vec3 f = flat3(ivec2(gl_FragCoord.xy), dcm); o = vec4(f.xy, dcm, 0.0); }`;

/** 2. Each 16 x 16 tile: (shortest motion xy, longest xy), reduced in the game's order (ties go its way too). */
export const MB_TILES = COMMON + FLAT_FN + /* glsl */ `
out vec4 o;
void main() {
  ivec2 g = ivec2(gl_FragCoord.xy) * 16;
  vec4 a[256];
  float dcm;
  for (int i = 0; i < 256; i++) { vec3 f = flat3(g + ivec2(i % 16, i / 16), dcm); a[i] = f.xyxy; }
  for (int s = 128; s >= 1; s /= 2)
    for (int i = 0; i < 256; i++) {
      if (i >= s) break;
      vec4 b = a[i + s], c = a[i];
      a[i] = vec4(b.x < c.x ? c.xy : b.xy, b.z < c.z ? b.zw : c.zw);
    }
  vec4 r = a[0];
  o = vec4(r.z * cos(r.w), r.z * sin(r.w), r.x * cos(r.y), r.x * sin(r.y));
}`;

/** 3. The scatter's vertex shader: one quad per tile (8 tiles an instance), stretched along its longest motion. */
export const MB_SCATTER_VS = COMMON + /* glsl */ `
uniform sampler2D t_tiles;
uniform vec4 u_vp;        // tile position -> clip: (p - zw) / xy           (the game's cb0[2])
uniform vec4 u_count;     // zw: tiles across, down                        (cb0[3])
uniform float u_toTiles;  // output pixels -> tiles                        (cb0[9].x)
uniform float u_pass;     // 0: the depth is the shortest motion; 1: the longest  (cb0[0].x)
flat out vec4 v_col;
void main() {
  uint idx = uint(gl_InstanceID) * 8u + (uint(gl_VertexID) >> 2u);
  uint across = uint(u_count.z), ty = idx / across, tx = idx - ty * across;
  if (ty >= uint(u_count.w)) { gl_Position = vec4(0.0, 0.0, 0.0, 1.0); v_col = vec4(0.0); return; }
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  vec2 centre = vec2(float(tx), float(ty)) + 0.5;
  vec4 tile = texelFetch(t_tiles, ivec2(tx, ty), 0);
  vec4 v = tile * u_toTiles;
  float m2 = dot(v.zw, v.zw);
  v_col = tile;
  vec3 pos;
  if (0.0009765625 >= m2) pos = vec3((corner * 0.5 + centre - u_vp.zw) / u_vp.xy, 0.000199999995);
  else {
    float rs = uintBitsToFloat(0x5f3759dfu - (floatBitsToUint(m2) >> 1u));   // the game's rough 1 / sqrt
    float len = rs * m2;
    vec2 d = v.zw * rs;
    vec2 c = corner * ((abs(d.y) + abs(d.x)) * 0.99000001 + vec2(len, 0.0));
    vec2 p = vec2(c.y * -d.y + c.x * d.x, c.y * d.x + c.x * d.y) + centre;
    float z = (u_pass == 1.0 ? len : sqrt(dot(v.xy, v.xy))) / u_vp.x * 0.5;
    pos = vec3((p - u_vp.zw) / u_vp.xy, min(max(z, 0.000199999995), 0.999000013));
  }
  gl_Position = vec4(pos.x, -pos.y, pos.z * 2.0 - 1.0, 1.0);   // the game's rows run down; its depth is 0..1
}`;
export const MB_SCATTER_FS = COMMON + /* glsl */ `
flat in vec4 v_col; out vec4 o;
void main() { o = v_col; }`;

/** Shared by the kind and filter steps: the jittered tile a pixel reads, and interleaved gradient noise. */
const FILTER_FN = /* glsl */ `
uniform sampler2D t_dil;  // the scattered tiles
uniform vec4 u_out;       // output size, 1 / size                          (the game's cb0[0])
uniform vec4 u_buf;       // the motion picture's buffer size, 1 / size     (cb0[7])
uniform vec4 u_inMin;     // xy: the input view's first pixel               (cb0[9])
uniform vec4 u_bufClamp;  // its uv clamp                                   (cb0[13])
uniform vec4 u_tile;      // tiles size, 1 / size                           (cb0[14])
uniform vec4 u_tileClamp; // tiles uv clamp                                 (cb0[20])
uniform vec4 u_toBuf;     // output uv -> buffer uv                         (cb0[21])
uniform vec4 u_misc;      // x: most samples (cb0[22].x)
float ign(vec2 p) { return fract(52.9829178 * fract(dot(p, vec2(0.0671105608, 0.00583714992)))); }
vec4 pointTex(sampler2D t, vec2 uv) { ivec2 s = textureSize(t, 0); return texelFetch(t, clamp(ivec2(floor(uv * vec2(s))), ivec2(0), s - 1), 0); }
// the tile this pixel reads: its own, moved by up to a quarter tile of noise; also its buffer uv
vec4 tileOf(vec2 pix, out vec2 buv) {
  vec2 j = (vec2(ign(pix), ign(pix + vec2(32.6650009, 11.8149996))) - 0.5) * 0.5;
  vec2 uv = (pix + 0.5) * u_out.zw;
  buv = min(max(uv * u_toBuf.xy + u_toBuf.zw, u_bufClamp.xy), u_bufClamp.zw);
  vec2 k = floor(buv * u_buf.xy) + 0.5 - u_inMin.xy;
  return pointTex(t_dil, min((k * 0.0625 + j) * u_tile.zw, u_tileClamp.zw));
}
float steps(float len) { return min(float(u_misc.x), max(ceil(len * 0.25) * 4.0, 4.0)); }
`;

/** 4. Each 16 x 16 output tile: its kind (0 still, 1 even, 3 uneven), the most samples its pixels take, and
 *  whether all its pixels read an even tile (the uneven filter then blurs plainly). */
export const MB_CLASS = COMMON + FILTER_FN + /* glsl */ `
uniform vec4 u_cls0;      // output tile -> velocity tile: scale xy, offset zw  (classify cb0[0])
uniform vec4 u_cls1;      // xy: the last velocity tile                         (cb0[1])
uniform vec4 u_cls2;      // x: the "very fast" kind on (the game: 0); z: its threshold  (cb0[2])
out vec4 o;
uint kind(vec4 t) {
  float mn = dot(t.xy, t.xy), mx = dot(t.zw, t.zw);
  bool fast = u_cls2.z < mx && u_cls2.x != 0.0;
  if (mx < 0.25) return 0u;
  return mx * 0.400000006 < mn ? (fast ? 0u : 1u) : (fast ? 2u : 3u);
}
void main() {
  ivec2 ft = ivec2(gl_FragCoord.xy);
  ivec2 vt = ivec2(vec2(ft) * u_cls0.xy + u_cls0.zw);
  uint c = 0u;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++)
    c = max(c, kind(texelFetch(t_dil, clamp(vt + ivec2(x, y), ivec2(0), ivec2(u_cls1.xy)), 0)));
  float most = 0.0, even = 0.0;
  vec2 buv;
  for (int i = 0; i < 256; i++) {
    vec2 pix = vec2(ft * 16 + ivec2(i % 16, i / 16));
    vec4 t = tileOf(pix, buv);
    float mx = dot(t.zw, t.zw);
    most = max(most, steps(sqrt(mx)));
    if (mx * 0.400000006 < dot(t.xy, t.xy)) even += 1.0;
  }
  o = vec4(float(c), most, even, 0.0);
}`;

/** 5. Each output pixel: blurred by its tile's kind. */
export const MB_FILTER = COMMON + FILTER_FN + /* glsl */ `
uniform sampler2D t_scene, t_flat, t_class;
uniform vec4 u_sceneClamp; // scene uv clamp                                  (cb0[6])
out vec4 o;
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec2 pix = vec2(ip), pc = pix + 0.5;
  vec3 here = texelFetch(t_scene, ip, 0).rgb;
  vec4 cls = texelFetch(t_class, ip / 16, 0);
  if (cls.x < 0.5) { o = vec4(r11Down(here), 1.0); return; }
  vec2 buv;
  vec4 tile = tileOf(pix, buv);
  float jit = ign(pix);
  float len = sqrt(dot(tile.zw, tile.zw));
  if (len < 0.5) { o = vec4(r11Down(here), 1.0); return; }
  float n = cls.y, invN = 1.0 / n;
  vec4 vuv = tile.zwzw * u_out.zwzw;
  vec3 sum = vec3(0.0);
  float keep = 0.0;
  if (cls.x < 1.5 || cls.z > 255.5) {
    // even motion: a plain blur, samples in pairs either side
    vec4 r5 = vec4(jit, jit, 1.0 - jit, 1.0 - jit);
    float s2 = invN + invN;
    for (int i = 0; i < 16; i += 4) {
      if (float(i) >= n) break;
      float j = float(i >> 1), j1 = float((i >> 1) + 1);
      vec4 a = (r5.yyww + j) * s2 * vuv;
      vec2 ua = min(max(pc * u_out.zw + a.xy, u_sceneClamp.xy), u_sceneClamp.zw);
      vec2 ub = min(max(pc * u_out.zw - a.zw, u_sceneClamp.xy), u_sceneClamp.zw);
      vec3 s = sum + pointTex(t_scene, ua).rgb;
      s = pointTex(t_scene, ub).rgb + s;
      vec4 b = (r5 + j1) * s2 * vuv;
      vec2 uc = min(max(pc * u_out.zw + b.xy, u_sceneClamp.xy), u_sceneClamp.zw);
      vec2 ud = min(max(pc * u_out.zw - b.zw, u_sceneClamp.xy), u_sceneClamp.zw);
      s = s + pointTex(t_scene, uc).rgb;
      sum = s + pointTex(t_scene, ud).rgb;
    }
    sum *= invN;
  } else {
    // uneven motion: each sample weighed by whether it is in front of or behind this pixel, and by whose motion reaches whom
    vec4 c0 = pointTex(t_flat, buv);
    float lenC = c0.x, depC = c0.z;
    float half_ = float(uint(n) >> 1u);
    float toSteps = inversesqrt(dot(tile.zw, tile.zw)) * half_;
    float inv = 1.0 / half_;
    vec4 r6 = jit * vec4(1.0, 1.0, -1.0, -1.0) + vec4(-0.5, -0.5, 0.5, 0.5);
    float wsum = 0.0;
    for (int i = 0; i < 8; i++) {
      if (float(i) >= half_) break;
      float fi = float(i);
      vec4 off = (r6 + (fi + 0.5)) * inv * vuv;
      vec2 ua = min(max(pc * u_out.zw + off.xy, u_sceneClamp.xy), u_sceneClamp.zw);
      vec2 ub = min(max(pc * u_out.zw - off.zw, u_sceneClamp.xy), u_sceneClamp.zw);
      vec4 fa = pointTex(t_flat, ua * u_toBuf.xy + u_toBuf.zw);
      vec3 ca = pointTex(t_scene, ua).rgb;
      float dd = fa.z - depC;
      float bgA = clamp(dd + 0.5, 0.0, 1.0), fgA = clamp(-dd + 0.5, 0.0, 1.0);
      float stepD = max(fi - 0.5, 0.0);
      float reachC = clamp(toSteps * lenC - stepD, 0.0, 1.0);
      float wA = fgA * clamp(toSteps * fa.x - stepD, 0.0, 1.0);
      wA = bgA * reachC + wA;
      vec4 fb = pointTex(t_flat, ub * u_toBuf.xy + u_toBuf.zw);
      vec3 cb = pointTex(t_scene, ub).rgb;
      float de = fb.z - depC;
      float bgB = clamp(de + 0.5, 0.0, 1.0), fgB = clamp(-de + 0.5, 0.0, 1.0);
      float wB = clamp(toSteps * fb.x - stepD, 0.0, 1.0) * fgB;
      wB = bgB * reachC + wB;
      bool closer = fb.z < fa.z, longer = fa.x < fb.x;
      float wA2 = closer && longer ? wB : wA, wB2 = closer || longer ? wB : wA;
      sum = (cb * wB2 + ca * wA2) + sum;
      wsum = (wB2 + wA2) + wsum;
    }
    float k = 0.5 / half_;
    sum *= k;
    keep = -wsum * k + 1.0;
  }
  o = vec4(r11Down(here * keep + sum), 1.0);
}`;

const FULL_VS = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

interface MBTarget { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number; depth?: WebGLRenderbuffer }

/**
 * Runs the five steps on raw WebGL2 (three.js's context or a test page's). Keeps its pictures between frames (they
 * are remade when a size changes). `run` returns the blurred picture (R11G11B10, as the game stores it).
 */
export class ComplexMotionBlur {
  private progs = new Map<string, { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> }>();
  private t: Record<string, MBTarget> = {};
  private vao: WebGLVertexArrayObject;
  private quads: WebGLBuffer;
  /** The scatter's depth tests (Unreal's): the first draw keeps, per tile, the tile whose shortest motion is least, the
   *  second the longest motion that reaches it. Settable for checks. */
  scatterDepth: [number, number];
  /** For checks: also keep each pixel's unrounded motion ('flatExact'). */
  debugExact = false;

  constructor(private gl: WebGL2RenderingContext) {
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const idx = new Uint16Array(48);
    for (let q = 0; q < 8; q++) idx.set([4 * q, 4 * q + 1, 4 * q + 2, 4 * q + 2, 4 * q + 1, 4 * q + 3], 6 * q);
    this.quads = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quads);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.scatterDepth = [gl.LESS, gl.GREATER];
  }

  private prog(name: string, vs: string, fs: string) {
    let p = this.progs.get(name);
    if (p) return p;
    const gl = this.gl, sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`motion blur ${name}: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const pr = gl.createProgram()!;
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(`motion blur ${name}: ${gl.getProgramInfoLog(pr)}`);
    p = { p: pr, u: new Map() };
    this.progs.set(name, p);
    return p;
  }

  /** A picture of the step (nearest filtering unless `linear`), remade when its size changes. */
  target(name: string, w: number, h: number, fmt: number, linear = false, depth = false): MBTarget {
    const old = this.t[name];
    if (old && old.w === w && old.h === h) return old;
    const gl = this.gl;
    if (old) { gl.deleteTexture(old.tex); gl.deleteFramebuffer(old.fb); if (old.depth) gl.deleteRenderbuffer(old.depth); }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
    const f = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let rb: WebGLRenderbuffer | undefined;
    if (depth) {
      rb = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);   // the game's: 16-bit
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return (this.t[name] = { tex, fb, w, h, depth: rb });
  }

  /** The step pictures, for checks: flat, tiles, dilated, class, out. */
  get targets(): Record<string, MBTarget> { return this.t; }

  private draw(name: string, fs: string, out: MBTarget, tex: Record<string, WebGLTexture>, uni: Record<string, number[]>, vs = FULL_VS, instances = 0, area?: [number, number]): void {
    const gl = this.gl, P = this.prog(name, vs, fs);
    gl.useProgram(P.p);
    const loc = (k: string) => { if (!P.u.has(k)) P.u.set(k, gl.getUniformLocation(P.p, k)); return P.u.get(k)!; };
    let unit = 0;
    for (const [k, t] of Object.entries(tex)) {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc(k), unit++);
    }
    for (const [k, v] of Object.entries(uni)) {
      const l = loc(k);
      if (!l) continue;
      [gl.uniform1f, gl.uniform2f, gl.uniform3f, gl.uniform4f][v.length - 1].call(gl, l, ...(v as [number, number, number, number]));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fb);
    gl.viewport(0, 0, area?.[0] ?? out.w, area?.[1] ?? out.h);
    gl.bindVertexArray(this.vao);
    if (instances) gl.drawElementsInstanced(gl.TRIANGLES, 48, gl.UNSIGNED_SHORT, 0, instances);
    else gl.drawArrays(gl.TRIANGLES, 0, 3);
    for (let i = 0; i < unit; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, null); }
  }

  run(m: MotionBlurInputs): WebGLTexture {
    const gl = this.gl, { inW, inH, outW, outH } = m;
    const tw = Math.ceil(inW / 16), th = Math.ceil(inH / 16), fw = Math.ceil(outW / 16), fh = Math.ceil(outH / 16);
    for (const cap of [gl.BLEND, gl.DEPTH_TEST, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST]) gl.disable(cap);
    gl.colorMask(true, true, true, true);
    const c2p = { u_c2p0: m.c2p[0], u_c2p1: m.c2p[1], u_c2p2: m.c2p[2], u_c2p3: m.c2p[3] };
    const flatU = {
      u_view: [0, 0, inW, inH], u_size: [inW, inH, 1 / inW, 1 / inH],
      u_scale: [0.5 * outW * m.shutter, -0.5 * outH * m.shutter, m.maxBlur, 0], u_zToCm: m.zToCm, u_depthMap: m.depthMap, ...c2p,
    };
    // 1, 2: each pixel's motion; each tile's shortest and longest
    const flat = this.target('flat', m.bufW, m.bufH, gl.R11F_G11F_B10F);    // the buffer's size; the view is drawn
    this.draw('flatten', MB_FLATTEN, flat, { t_depth: m.depth, t_vel: m.vel }, flatU, FULL_VS, 0, [inW, inH]);
    if (this.debugExact) this.draw('flatExact', MB_FLATTEN_EXACT, this.target('flatExact', tw * 16, th * 16, gl.RGBA32F), { t_depth: m.depth, t_vel: m.vel }, flatU);
    const tiles = this.target('tiles', tw, th, gl.RGBA16F);
    this.draw('tiles', MB_TILES, tiles, { t_depth: m.depth, t_vel: m.vel }, flatU);
    const tilesTex = m.tilesIn ?? tiles.tex, flatTex = m.flatIn ?? flat.tex;
    // 3: the scatter, two draws into one picture and one depth buffer
    const dil = this.target('dilated', tw, th, gl.RGBA16F, false, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dil.fb);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const su = { u_vp: [tw / 2, -th / 2, tw / 2, th / 2], u_count: [0, 0, tw, th], u_toTiles: [(inW / outW) / 16] };
    for (const pass of [0, 1]) {
      gl.depthFunc(this.scatterDepth[pass]);
      gl.colorMask(pass === 0, pass === 0, true, true);   // the first draw writes the whole tile, the second its longest motion
      this.draw('scatter', MB_SCATTER_FS, dil, { t_tiles: tilesTex }, { ...su, u_pass: [pass] }, MB_SCATTER_VS, Math.ceil((tw * th) / 8));
    }
    gl.disable(gl.DEPTH_TEST); gl.colorMask(true, true, true, true);
    const dilTex = m.dilatedIn ?? dil.tex;
    // 4, 5: each output tile's kind; the filter
    const fu = {
      u_out: [outW, outH, 1 / outW, 1 / outH], u_buf: [m.bufW, m.bufH, 1 / m.bufW, 1 / m.bufH], u_inMin: [0, 0, inW, inH],
      u_bufClamp: [0.5 / m.bufW, 0.5 / m.bufH, inW / m.bufW - 0.5 / m.bufW, inH / m.bufH - 0.5 / m.bufH],
      u_tile: [tw, th, 1 / tw, 1 / th], u_tileClamp: [0.5 / tw, 0.5 / th, 1 - 0.5 / tw, 1 - 0.5 / th],
      u_toBuf: [inW / m.bufW, inH / m.bufH, 0, 0], u_misc: [m.maxSamples, 0, 0, 0],
    };
    const s = inW / outW;
    const cls = this.target('class', fw, fh, gl.RGBA32F);
    this.draw('class', MB_CLASS, cls, { t_dil: dilTex }, { ...fu, u_cls0: [s, s, s / 2, s / 2], u_cls1: [tw - 1, th - 1, fw, fh], u_cls2: [0, 0, 256, 0] });
    const out = this.target('out', outW, outH, gl.R11F_G11F_B10F, true);
    this.draw('filter', MB_FILTER, out, { t_scene: m.scene, t_flat: flatTex, t_class: cls.tex, t_dil: dilTex },
      { ...fu, u_sceneClamp: [0.5 / outW, 0.5 / outH, 1 - 0.5 / outW, 1 - 0.5 / outH] });
    gl.bindVertexArray(null);
    return out.tex;
  }
}
