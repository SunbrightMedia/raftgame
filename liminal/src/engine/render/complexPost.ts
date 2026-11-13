/**
 * Camera model "complex": The Complex's camera, run as that game runs it (complexCamera.ts has the passes and
 * how each is checked against the game's own compiled step). Raw WebGL2 on three.js's context, so every
 * picture is stored in the game's own format: the scene and its glow as R11G11B10 floats, the pictures between
 * passes as 10-bit RGB, the tone table as a 32^3 10-bit 3D texture. Image row 0 is the top inside the chain.
 *
 * Steps: scene (x exposure, flipped to row 0 = top, at 70 % of the picture) -> depth of field (the game's,
 * complexDOF.ts) -> upscaler (the game's TAAU,
 * complexTAA.ts: the scene is drawn with a new sub-pixel jitter each frame and the picture is made over frames) ->
 * motion blur -> glow -> tonemapper -> sharpen -> posterize -> grain -> tape -> lens -> the screen, 4:3 with bars.
 *
 * Then the game's motion blur (complexMotionBlur.ts). Not yet the game's own (said in the HUD help): the glow (a
 * three-width blur fitted to the capture's measured spread, split into the game's scene / glow weights). The lens
 * dirt and the grain and tape noises are ours (the game's are its own image files).
 */
import { COMPLEX_VERT, TONEMAP, SHARPEN, POSTERIZE, GRAIN, TAPE, LENS, lensConstants } from './complexCamera';
import { makeToneTable, COMPLEX_TONE } from './complexTone';
import { TAAU } from './complexTAA';
import { ComplexMotionBlur } from './complexMotionBlur';
import { ComplexDOF } from './complexDOF';
import { Rng } from '../../world/rng';

export interface ComplexParams {
  /** Scene light x this = the game's exposed scene light (the game: x 34.13; our maps' light is x 1000). */
  exposure: number;
  /** The scene multiplier that the game's glow step computes (its kernel's colour and scatter): r, g, b. */
  sceneR: number; sceneG: number; sceneB: number;
  /** The glow multiplier, the other share of the same: r, g, b. */
  glowR: number; glowG: number; glowB: number;
  /** Glow shape (stand-in): shares of three widths, sigma 0.6 %, 2.5 %, 8 % of the width. */
  glowNear: number; glowMid: number; glowFar: number;
  dirt: number;
  /** The game's upscaler (TAAU, complexTAA.ts): the scene drawn at `screenPct` of the picture, the picture made over frames. */
  taa: boolean;
  /** The share of the picture's width and height the scene is drawn at with the upscaler (the game: 0.7). */
  screenPct: number;
  /** With the upscaler off: the scene scaled up, then this blur (sigma in output pixels). */
  soften: number;
  /** The game's depth of field (complexDOF.ts), before the upscaler: focus distance (cm), blur at infinity and the
   *  largest blur (shares of the width). The game: 67.92 cm, 0.00086085, 0.025. */
  dof: boolean; dofFocus: number; dofInfinity: number; dofMax: number;
  /** The game's motion blur (complexMotionBlur.ts), after the upscaler. */
  motionBlur: boolean;
  /** Unreal's motion blur amount and target frame rate: the blur lasts amount / target fps seconds (0.5 / 30 = 1/60 s). */
  mbAmount: number; mbTargetFps: number;
  /** The longest blur, as a share of the picture's width (the game: 0.4). */
  mbMax: number;
  /** Horizontal field of view the lens bend uses (radians; the game's camera: 98.2 degrees). */
  hfov?: number;
}

interface Prog { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> }

/** What the upscaler needs from the renderer for one frame (renderer.ts). */
export interface ComplexTAAFrame {
  /** The scene's depth: three.js's depth texture (rows from the bottom, 0 near .. 1 far). */
  depth: WebGLTexture;
  /** The input picture's size (the scene and its depth). */
  inW: number; inH: number;
  /** This frame's jitter, input pixels (x right, y down): the scene was drawn moved by this. */
  jitter: [number, number];
  /** Column-major 4 x 4: (x, y, 1 - depth, 1) in this frame's clip space -> last frame's clip space, both unjittered. */
  clipToPrev: ArrayLike<number>;
  /** No usable history: the first frame, a jump, a new size. */
  cut: boolean;
  /** A frame counter (the dither uses it mod 8, as the game). */
  frame: number;
  /** The camera's near and far planes (inches): the motion blur's depth. */
  near: number; far: number;
}

/** The picture in a canvas: the biggest centred 4:3 box (width, height). */
export function complexPictureSize(cw: number, ch: number): [number, number] {
  let ow = cw, oh = Math.round(cw * 0.75);
  if (oh > ch) { oh = ch; ow = Math.round(ch * 4 / 3); }
  return [ow, oh];
}

/** The game's exposure / pre-exposure as its upscaler computes it (eye adaptation 34.13 x 1 / 34.13, in float32). */
const TAA_EXPOSURE = Math.fround(Math.fround(34.133327) * Math.fround(0.029296881));

/** One of our stand-ins for the game's own image files (RGBA8, row 0 = top). */
export interface StandIn { w: number; h: number; data: Uint8Array; wrap: 'clamp' | 'repeat'; mips: boolean }

/**
 * Our stand-ins for four of the game's own image files (the fifth, the glow kernel, is the glow pass's shape),
 * the sizes and mip settings of the game's (from the capture's binding list), the strengths measured:
 *  - dirt: lens dirt, our own bokeh discs matched to the game's measured dirt (see below; the game's photo is
 *    5184 x 3456, ours 864 x 576, both 3:2 stretched over the 4:3 screen; the tonemapper adds glow x (1 + 20 x dirt)).
 *  - grain: 1400 x 1050, no mips: our own soft specks matched to the game's grain measured losslessly (see below).
 *  - streak: the tape's streak noise n, 944 x 1260, no mips (the game's is BC1 there): grey rows, see below.
 *  - band: the tape's band image s, 512 x 512 with mips, read stretched 10x along x: soft rows.
 * Measured in the capture (the game's own tape step run with its streak images off, subtracted from its output;
 * frames 18325 and 20732): the streaks add +0.003 / +0.003 / +0.002, fine-grained; 0.3 x n x s (1 - s) with
 * these (mean s (1 - s) about 0.17) gives that.
 */
/** Our lens dirt is stored x this (its values are ~0.01: 8 bits alone would lose the faint ground). */
export const DIRT_STORE = 12;
/** Our lens dirt's discs: count, median radius (texels of 864) and its spread, median strength and its spread, edge
 * softness (share of the radius), mottling of the insides, and the faint ground under them (fitted: see standInImages). */
/** Our tape streak noise: each row's mean level, how skewed the levels are (exponent on an exponential draw), how
 * much a row drifts along its length, and its fine per-texel noise (fitted: see standInImages). */
export const STREAK_PARAMS = { level: 0.0685, shape: 0.6, drift: 0.3, fine: 0.6 };
export const DIRT_PARAMS = { n: 130, radius: 50, radiusSpread: 0.3, amp: 0.0025, ampSpread: 1.3, soft: 0.4, mottle: 0.25, base: 0.0008 };

export function standInImages(): { dirt: StandIn; grain: StandIn; streak: StandIn; band: StandIn } {
  // lens dirt: our own bokeh discs (own random layout), matched to the game's lens dirt as measured losslessly (deep
  // export: the game's tonemapper run with flat dirt, against what it drew; frames 18325 / 20732 / 19893 agree): soft
  // eight-sided discs, one orientation, 60-130 screen pixels across, mostly faint; mean 0.0105, spread 0.013, median
  // 0.0057, top 1 % 0.06. Stored x DIRT_STORE (8 bits would lose the faint ground); the tonemapper divides it back.
  const dirt = (() => {
    const W = 864, H = 576, r = new Rng(211), a = new Float32Array(W * H).fill(DIRT_PARAMS.base);
    const P = DIRT_PARAMS;
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, r.next()))) * Math.cos(2 * Math.PI * r.next());
    // smooth value noise for the discs' mottled insides (~12-texel features)
    const NG = 80, grid = Array.from({ length: NG * NG }, () => r.next());
    const noise = (x: number, y: number) => {
      const gx = x / 12, gy = y / 12, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), g = (i: number, j: number) => grid[(((j % NG) + NG) % NG) * NG + (((i % NG) + NG) % NG)];
      return (g(ix, iy) * (1 - sx) + g(ix + 1, iy) * sx) * (1 - sy) + (g(ix, iy + 1) * (1 - sx) + g(ix + 1, iy + 1) * sx) * sy;
    };
    const sides = 8, seg = (2 * Math.PI) / sides, rot = 0.2;
    for (let k = 0; k < P.n; k++) {
      const cx = r.range(-40, W + 40), cy = r.range(-40, H + 40);
      const rad = P.radius * Math.exp(P.radiusSpread * gauss()), amp = P.amp * Math.exp(P.ampSpread * gauss());
      const soft = Math.max(2.5, P.soft * rad);
      const x0 = Math.max(0, Math.floor(cx - rad - soft)), x1 = Math.min(W, Math.ceil(cx + rad + soft));
      const y0 = Math.max(0, Math.floor(cy - rad - soft)), y1 = Math.min(H, Math.ceil(cy + rad + soft));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const dx = x - cx, dy = y - cy, dist = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx) - rot, m = ((ang % seg) + seg) % seg;
        const rp = (rad * Math.cos(Math.PI / sides)) / Math.cos(m - seg / 2);        // the polygon's edge at this angle
        const t = Math.min(1, Math.max(0, (rp - dist) / soft + 0.5));
        if (t <= 0) continue;
        const edge = t * t * (3 - 2 * t);
        a[y * W + x] += amp * edge * (1 - P.mottle + 2 * P.mottle * noise(x + k * 37, y + k * 53));
      }
    }
    const d = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const v = Math.round(Math.min(1, a[i] * DIRT_STORE) * 255);
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
    return { w: W, h: H, data: d, wrap: 'clamp' as const, mips: false };
  })();
  // grain: our own soft specks (own random layout), matched to the game's grain as its step adds it, measured
  // losslessly (deep export, frames 18325 / 20732: the step run without its image, subtracted from what it drew):
  // mean 0.0021 / 0.0022 / 0.0092, spread 0.0085 / 0.0071 / 0.023, specks ~2 x 1.3 screen pixels, 37 % of pixels
  // touched, mostly bluish (R/B 0.17, G/B 0.24), some reddish and a few white. 10000 specks, exponential strengths.
  const grain = (() => {
    const W = 1400, H = 1050, r = new Rng(4421), acc = new Float32Array(W * H * 3);
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, r.next()))) * Math.cos(2 * Math.PI * r.next());
    const kinds: [number, [number, number, number], number][] = [[0.79, [0.05, 0.21, 1.0], 1.0], [0.17, [1.0, 0.12, 0.3], 0.75], [0.04, [1, 1, 1], 0.8]];
    for (let i = 0; i < 10000; i++) {
      const u = r.next();
      const k = u < kinds[0][0] ? kinds[0] : u < kinds[0][0] + kinds[1][0] ? kinds[1] : kinds[2];
      const cx = r.range(0, W), cy = r.range(0, H), amp = -0.32 * Math.log(Math.max(1e-12, r.next())), s = Math.exp(0.25 * gauss());
      const sx = 2.4 * s * k[2], sy = 1.5 * s * k[2], ix = Math.floor(cx), iy = Math.floor(cy);
      for (let oy = -8; oy <= 8; oy++) for (let ox = -8; ox <= 8; ox++) {
        const dx = (ix + ox - cx) / sx, dy = (iy + oy - cy) / sy;
        const g = amp * Math.exp(-0.5 * (dx * dx + dy * dy));
        if (g < 1e-5) continue;
        const o = ((((iy + oy) % H) + H) % H * W + ((((ix + ox) % W) + W) % W)) * 3;
        acc[o] += g * k[1][0]; acc[o + 1] += g * k[1][1]; acc[o + 2] += g * k[1][2];
      }
    }
    const d = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      for (let c = 0; c < 3; c++) d[i * 4 + c] = Math.round(Math.min(1, acc[i * 3 + c]) * 255);
      d[i * 4 + 3] = 255;
    }
    return { w: W, h: H, data: d, wrap: 'repeat' as const, mips: false };
  })();
  // tape streak noise n: our own (own random values), matched to the game's streaks as measured losslessly (deep
  // export: the screen after the lens traced back to the tape step's pixels, minus that step run without its images):
  // grey, long along each row (correlation 0.89 at 1 px, 0.80 at 32 px), different from row to row; mean addition
  // 0.0031, spread 0.0025. Each texel row: one random level, drifting slowly along the row.
  const streak = (() => {
    const W = 944, H = 1260, d = new Uint8Array(W * H * 4), r = new Rng(77), P = STREAK_PARAMS;
    for (let y = 0; y < H; y++) {
      const level = P.level * Math.pow(-Math.log(Math.max(1e-12, r.next())), P.shape);       // this row's level
      const k = 16, knots = Array.from({ length: k }, () => 1 + P.drift * (2 * r.next() - 1));
      for (let x = 0; x < W; x++) {
        const t = (x / W) * k, i = Math.floor(t), f = t - i, sm = f * f * (3 - 2 * f);
        const drift = knots[i] * (1 - sm) + knots[(i + 1) % k] * sm;           // wraps round: the image repeats
        const v = Math.min(1, level * drift * (1 + P.fine * (2 * r.next() - 1)));
        const o = (y * W + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = Math.round(v * 255); d[o + 3] = 255;
      }
    }
    return { w: W, h: H, data: d, wrap: 'repeat' as const, mips: false };
  })();
  // tape band s
  const band = (() => {
    const N = 512, d = new Uint8Array(N * N * 4), r = new Rng(5309);
    const rows = Array.from({ length: 64 }, () => r.next());
    for (let y = 0; y < N; y++) {
      const t = (y / N) * 64, i = Math.floor(t), f = t - i, sm = f * f * (3 - 2 * f);
      const base = rows[i % 64] * (1 - sm) + rows[(i + 1) % 64] * sm;
      for (let x = 0; x < N; x++) {
        const v = Math.min(1, Math.max(0, base + 0.15 * Math.sin((x / N) * Math.PI * 6 + y * 0.01)));
        const o = (y * N + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = Math.round(v * 255); d[o + 3] = 255;
      }
    }
    return { w: N, h: N, data: d, wrap: 'repeat' as const, mips: true };
  })();
  return { dirt, grain, streak, band };
}
interface Target { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number }

const PRE = 34.1333275;     // the game's pre-exposure: the scene is stored x this, the tonemapper undoes it

const SCENE_IN = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D t_src; uniform vec2 u_size; uniform float u_scale; out vec4 o;
void main() {
  vec2 uv = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y) / u_size;   // flip: three.js rows start at the bottom
  o = vec4(max(texture(t_src, uv).rgb * u_scale, 0.0), 1.0);
}`;
const BLUR = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D t_src; uniform vec2 u_dir, u_out; uniform float u_sigma; out vec4 o;
void main() {
  vec2 px = gl_FragCoord.xy / u_out;
  vec3 sum = vec3(0.0); float ws = 0.0; float step = max(1.0, u_sigma / 5.0);
  for (int i = -15; i <= 15; i++) {
    float x = float(i) * step, w = exp(-0.5 * x * x / (u_sigma * u_sigma));
    sum += texture(t_src, px + u_dir * x).rgb * w; ws += w;
  }
  o = vec4(sum / ws, 1.0);
}`;
const GLOW_MIX = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D t_a, t_b, t_c; uniform vec3 u_w, u_k; out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(t_a, 0));
  o = vec4((texture(t_a, uv).rgb * u_w.x + texture(t_b, uv).rgb * u_w.y + texture(t_c, uv).rgb * u_w.z) * u_k, 1.0);
}`;
const COPY = `#version 300 es
precision highp float; precision highp sampler2D; uniform sampler2D t_src; out vec4 o;
void main() { o = texelFetch(t_src, ivec2(gl_FragCoord.xy), 0); }`;
const PRESENT = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D t_src; uniform vec4 u_rect; out vec4 o;
void main() {
  vec2 uv = (gl_FragCoord.xy - u_rect.xy) / u_rect.zw;
  o = vec4(texture(t_src, vec2(uv.x, 1.0 - uv.y)).rgb, 1.0);   // flip back: the screen's rows start at the bottom
}`;

export class ComplexPost {
  private progs = new Map<string, Prog>();
  private vao: WebGLVertexArrayObject;
  private lut: WebGLTexture;
  private dirt: WebGLTexture;
  private grain: WebGLTexture;
  private streak: WebGLTexture;
  private band: WebGLTexture;
  private t: Record<string, Target> = {};
  private size: [number, number] = [0, 0];
  private time = 0;
  /** 1 x 1 zero: the upscaler's motion vectors and stencil (we draw none: nothing is "responsive", nothing moves by itself). */
  private zero: WebGLTexture;
  /** The upscaler's two pictures: last frame's output is read, this frame's written; which is which flips each frame. */
  private taaFlip = false;
  private taaKey = '';
  private mb: ComplexMotionBlur | null = null;
  private dof: ComplexDOF | null = null;

  constructor(private gl: WebGL2RenderingContext) {
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('complex camera: needs EXT_color_buffer_float');
    // three.js leaves FLIP_Y / premultiply on; WebGL refuses 3D uploads then, and 2D ones come in upside down
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0); gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
    this.vao = gl.createVertexArray()!;
    this.lut = this.makeLut();
    const im = standInImages();
    const up = (t: StandIn) => this.tex2d(t.w, t.h, t.data, t.wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE, t.mips);
    this.dirt = up(im.dirt);
    this.grain = up(im.grain);
    this.streak = up(im.streak);
    this.band = up(im.band);
    this.zero = this.tex2d(1, 1, new Uint8Array(4), gl.CLAMP_TO_EDGE, false);
  }

  // ---------------------------------------------------------------- textures (ours)
  private tex2d(w: number, h: number, data: Uint8Array, wrap: number, mips: boolean): WebGLTexture {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  }

  /** The tone table (complexTone.ts), stored as the game stores it: 10-bit RGB, a 32^3 3D texture. */
  private makeLut(): WebGLTexture {
    const gl = this.gl, n = COMPLEX_TONE.size, f = makeToneTable(COMPLEX_TONE), packed = new Uint32Array(n * n * n);
    const q = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1023);
    for (let i = 0; i < packed.length; i++) packed[i] = (q(f[i * 4]) | (q(f[i * 4 + 1]) << 10) | (q(f[i * 4 + 2]) << 20)) >>> 0;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB10_A2, n, n, n, 0, gl.RGBA, gl.UNSIGNED_INT_2_10_10_10_REV, packed);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    return t;
  }

  // ---------------------------------------------------------------- programs and targets
  private prog(name: string, frag: string): Prog {
    let p = this.progs.get(name);
    if (p) return p;
    const gl = this.gl, sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`complex camera ${name}: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const pr = gl.createProgram()!;
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, COMPLEX_VERT)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(`complex camera ${name}: ${gl.getProgramInfoLog(pr)}`);
    p = { p: pr, u: new Map() };
    this.progs.set(name, p);
    return p;
  }

  private target(name: string, w: number, h: number, fmt: number): Target {
    const old = this.t[name];
    if (old && old.w === w && old.h === h) return old;
    const gl = this.gl;
    if (old) { gl.deleteTexture(old.tex); gl.deleteFramebuffer(old.fb); }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return (this.t[name] = { tex, fb, w, h });
  }

  /** Draw `frag` into `out` (null = the screen rect) with textures and uniforms. */
  private run(name: string, frag: string, out: Target | null, tex: Record<string, [WebGLTexture, number?]>, uni: Record<string, number | number[]>, rect?: [number, number, number, number]): void {
    const gl = this.gl, P = this.prog(name, frag);
    gl.useProgram(P.p);
    const loc = (k: string) => { if (!P.u.has(k)) P.u.set(k, gl.getUniformLocation(P.p, k)); return P.u.get(k)!; };
    let unit = 0;
    for (const [k, [t, target]] of Object.entries(tex)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(target ?? gl.TEXTURE_2D, t);
      gl.uniform1i(loc(k), unit++);
    }
    for (const [k, v] of Object.entries(uni)) {
      const l = loc(k);
      if (!l) continue;
      const a = typeof v === 'number' ? [v] : v;
      if (a.length === 1) gl.uniform1f(l, a[0]); else if (a.length === 2) gl.uniform2f(l, a[0], a[1]);
      else if (a.length === 3) gl.uniform3f(l, a[0], a[1], a[2]); else gl.uniform4f(l, a[0], a[1], a[2], a[3]);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fb : null);
    if (out) gl.viewport(0, 0, out.w, out.h); else gl.viewport(rect![0], rect![1], rect![2], rect![3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    for (let i = 0; i < unit; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, null); gl.bindTexture(gl.TEXTURE_3D, null); }
  }

  private clean(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    for (const cap of [gl.BLEND, gl.DEPTH_TEST, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST]) gl.disable(cap);
    gl.colorMask(true, true, true, true);
  }

  /**
   * src: three.js's scene picture (linear light, rows from the bottom). Draws the finished picture into the canvas
   * (cw x ch), a centred 4:3 box with black bars. taa: this frame's upscaler inputs (with p.taa; src is then
   * taa.inW x taa.inH, drawn with the jitter), else src is scaled up.
   */
  render(src: WebGLTexture, cw: number, ch: number, p: ComplexParams, dt: number, taa?: ComplexTAAFrame): void {
    const gl = this.gl;
    this.time += dt;
    this.clean();
    const [ow, oh] = complexPictureSize(cw, ch);
    const R11 = gl.R11F_G11F_B10F, R10 = gl.RGB10_A2;
    // the game stores its scene pre-exposed by the same 34.13 its exposure is: the stored value IS the exposed light
    const scene = this.target('scene', ow, oh, R11);
    let sceneT = scene;
    if (p.taa && taa) {
      // 1. the scene as the game stores it before its upscaler (half float), at the size it was drawn
      const iw = taa.inW, ih = taa.inH;
      const sin = this.target('sceneIn', iw, ih, gl.RGBA16F);
      this.run('in', SCENE_IN, sin, { t_src: [src] }, { u_size: [iw, ih], u_scale: p.exposure });
      // 2. the upscaler: this frame and last frame's picture -> this frame's picture (half float, kept for next frame)
      const key = `${iw}x${ih}>${ow}x${oh}`, fresh = key !== this.taaKey;
      this.taaKey = key;
      const read = this.target(this.taaFlip ? 'taaB' : 'taaA', ow, oh, gl.RGBA16F), write = this.target(this.taaFlip ? 'taaA' : 'taaB', ow, oh, gl.RGBA16F);
      this.taaFlip = !this.taaFlip;
      const m = taa.clipToPrev, row = (i: number) => [m[4 * i], m[4 * i + 1], m[4 * i + 2], m[4 * i + 3]];
      const zc = (taa.far - taa.near) / (2.54 * taa.far * taa.near), wc = -1 / (2.54 * taa.far);   // our depth -> cm, as the game's
      // 2a. the game's depth of field, on the input picture
      let input = sin.tex;
      if (p.dof) {
        this.dof ??= new ComplexDOF(gl);
        input = this.dof.run({ scene: sin.tex, depth: taa.depth, vel: this.zero, stencil: this.zero, inW: iw, inH: ih, bufW: iw, bufH: ih, outW: ow, outH: oh,
          depthMap: [-1, 1, 1, 0], zToCm: [0, 0, zc, wc], focus: p.dofFocus, cocInf: p.dofInfinity, cocMax: p.dofMax,
          jitter: taa.jitter, c2p: [row(0), row(1), row(2), row(3)], cut: taa.cut || fresh, frame: taa.frame, exposure: TAA_EXPOSURE });
        this.clean();
      }
      this.run('taa', TAAU, write, { t_scene: [input], t_depth: [taa.depth], t_vel: [this.zero], t_stencil: [this.zero], t_hist: [read.tex] }, {
        u_out: [ow, oh, 1 / ow, 1 / oh], u_in: [iw, ih, 1 / iw, 1 / ih], u_inMin: [0, 0, taa.jitter[0], taa.jitter[1]],
        u_buf: [iw, ih, 1 / iw, 1 / ih], u_bufUV: [1, 1, 0, 0], u_inClamp: [0, 0, iw - 1, ih - 1],
        u_hist: [ow, oh, 1 / ow, 1 / oh], u_histClamp: [0.5 / ow, 0.5 / oh, 1 - 0.5 / ow, 1 - 0.5 / oh], u_toHist: [0.5, -0.5, 0.5, 0.5],
        u_resp: [0, 0, 1, 0.04], u_misc: [taa.cut || fresh ? 1 : 0, iw / ow, ow / iw, taa.frame % 8], u_dither: [1 / 1024, 1 / 1024, 1 / 1024, 0],
        u_c2p0: row(0), u_c2p1: row(1), u_c2p2: row(2), u_c2p3: row(3), u_depthMap: [-1, 1, 1, 0], u_exposure: TAA_EXPOSURE,
      });
      // 3. the game's motion blur, which stores the scene as R11G11B10 (a copy when it is off). Its length: the camera's
      // motion this frame x amount / (target fps x frame time), as Unreal's; none after a cut.
      let blurred = write.tex;
      if (p.motionBlur) {
        this.mb ??= new ComplexMotionBlur(gl);
        const k = dt > 0 && !taa.cut && !fresh ? p.mbAmount / (Math.max(1, p.mbTargetFps) * dt) : 0;
        blurred = this.mb.run({ scene: write.tex, depth: taa.depth, vel: this.zero, inW: iw, inH: ih, bufW: iw, bufH: ih, outW: ow, outH: oh,
          c2p: [row(0), row(1), row(2), row(3)], depthMap: [-1, 1, 1, 0], zToCm: [0, 0, zc, wc], shutter: k, maxBlur: p.mbMax * ow, maxSamples: 16 });
        this.clean();
      }
      this.run('copy', COPY, scene, { t_src: [blurred] }, {});
    } else {
      // 1. the scene, exposed as the game stores it (R11G11B10), at the picture's size
      this.run('in', SCENE_IN, scene, { t_src: [src] }, { u_size: [ow, oh], u_scale: p.exposure });
    }
    if (!(p.taa && taa) && p.soften > 0) {     // with the upscaler off: a blur stands in
      const a = this.target('softA', ow, oh, R11), b = this.target('softB', ow, oh, R11);
      this.run('blur', BLUR, a, { t_src: [scene.tex] }, { u_dir: [1 / ow, 0], u_out: [ow, oh], u_sigma: p.soften });
      this.run('blur', BLUR, b, { t_src: [a.tex] }, { u_dir: [0, 1 / oh], u_out: [ow, oh], u_sigma: p.soften });
      sceneT = b;
    }
    // 2. glow (stand-in shape), at about the game's glow size (1020 x 764 for a 1440 x 1080 picture)
    const bw = Math.max(1, Math.round(ow * (1020 / 1440))), bh = Math.max(1, Math.round(oh * (764 / 1080)));
    const g0 = this.target('g0', bw, bh, R11), gt = this.target('gt', bw, bh, R11);
    const ga = this.target('ga', bw, bh, R11), gb = this.target('gb', bw, bh, R11), gc = this.target('gc', bw, bh, R11);
    this.run('blur', BLUR, g0, { t_src: [sceneT.tex] }, { u_dir: [0, 0], u_out: [bw, bh], u_sigma: 1 });   // resample (dir 0: no blur)
    // three blurs (widths as a share of the glow picture's width), fitted to the game's glow shape measured on its own
    // lossless pictures (deep export: its glow deconvolved by its own downsampled scene, frames 18325 and 20732)
    for (const [t, sigma] of [[ga, 0.00165], [gb, 0.00621], [gc, 0.0317]] as const) {
      this.run('blur', BLUR, gt, { t_src: [g0.tex] }, { u_dir: [1 / bw, 0], u_out: [bw, bh], u_sigma: sigma * bw });
      this.run('blur', BLUR, t, { t_src: [gt.tex] }, { u_dir: [0, 1 / bh], u_out: [bw, bh], u_sigma: sigma * bw });
    }
    const bloom = this.target('bloom', bw, bh, R11);
    this.run('glowmix', GLOW_MIX, bloom, { t_a: [ga.tex], t_b: [gb.tex], t_c: [gc.tex] },
      { u_w: [p.glowNear, p.glowMid, p.glowFar], u_k: [p.glowR, p.glowG, p.glowB] });
    // 3. tonemapper (the game's step), into 10-bit
    const A = this.target('A', ow, oh, R10), B = this.target('B', ow, oh, R10);
    const vig = Math.SQRT2 / Math.sqrt(1 + (oh / ow) ** 2);
    this.run('tonemap', TONEMAP, A, { t_scene: [sceneT.tex], t_bloom: [bloom.tex], t_dirt: [this.dirt], t_lut: [this.lut, gl.TEXTURE_3D] }, {
      u_pos: [0, 0, 1, 1], u_ca: [0.003087, 0.001781, 0, 0], u_caMap: [0, 0, 1, 1], u_vp: [ow / 2, -oh / 2, ow / 2, oh / 2],
      u_size: [ow, oh, 1 / ow, 1 / oh], u_clamp: [0.5 / ow, 0.5 / oh, 1 - 0.5 / ow, 1 - 0.5 / oh],
      u_bloomUV: [1, 1, 0, 0], u_bloomClamp: [0.5 / bw, 0.5 / bh, 1 - 0.5 / bw, 1 - 0.5 / bh],
      u_tint: [1, 1, 1], u_dirtK: [p.dirt / DIRT_STORE, p.dirt / DIRT_STORE, p.dirt / DIRT_STORE], u_apply: [p.sceneR, p.sceneG, p.sceneB],
      u_lut: [31 / 32, 0.5 / 32], u_vigScale: [vig, (oh / ow) * vig], u_dither: [Math.random(), Math.random()],
      u_vig: 0.4, u_invPre: 1 / PRE, u_exposure: PRE,
    });
    // 4. the five camera passes (the game's settings), ping-pong in 10-bit
    const view = { u_view: [0, 0], u_inv: [1 / ow, 1 / oh], u_map: [1, 1, 0, 0], u_clampP: [0.5 / ow, 0.5 / oh, 1 - 0.5 / ow, 1 - 0.5 / oh] };
    this.run('sharpen', SHARPEN, B, { t_src: [A.tex] }, { ...view, u_amount: 7, u_blend: 0, u_blendColor: [0, 0, 0] });
    this.run('posterize', POSTERIZE, A, { t_src: [B.tex] }, { ...view, u_blend: 0, u_blendColor: [0, 0, 0] });
    this.run('grain', GRAIN, B, { t_noise: [this.grain], t_src: [A.tex] },
      { ...view, u_time: this.time, u_tile: 4.5, u_keep: 0.8, u_lift: 0, u_hi: 0.5, u_lo: 0.5, u_blend: 0, u_blendColor: [0, 0, 0] });
    const rows = Math.round(oh * 0.7);
    this.run('tape', TAPE, A, { t_noise: [this.streak], t_band: [this.band], t_src: [B.tex] }, {
      ...view, u_time: this.time, u_rows: rows, u_rate: 50, u_tile: 2, u_keep: 0.7, u_liftK: 0.018, u_lift2: 0, u_mix: 0.012, u_blend: 0,
      u_colA: [2, 0, 1], u_colB: [-1, 1, 0], u_blendColor: [0, 0, 0],
    });
    const L = lensConstants(p.hfov ?? 1.71451998, Math.round(ow * 0.7), rows);
    this.run('lens', LENS, B, { t_src: [A.tex] }, { ...view, u_a: L.a, u_k: L.k, u_diagW: L.diagW, u_hw: L.hw, u_blend: 0, u_blendColor: [0, 0, 0] });
    // 5. the screen: black, then the 4:3 picture in the middle
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const rx = Math.floor((cw - ow) / 2), ry = Math.floor((ch - oh) / 2);
    this.run('present', PRESENT, null, { t_src: [B.tex] }, { u_rect: [rx, ry, ow, oh] }, [rx, ry, ow, oh]);
    this.size = [ow, oh];
  }

  /** The picture's size last frame (for tests). */
  get pictureSize(): [number, number] { return this.size; }

  /** Tests: the mean RGB of a step's picture (scene, bloom, A = after tonemap/posterize/tape, B = after sharpen/
   *  grain/lens), copied to a float target and read back. */
  /** Tests: a target's pixels as float RGBA (rows as stored: row 0 = the picture's top), or null. */
  debugRead(name: string): { w: number; h: number; data: Float32Array } | null {
    const gl = this.gl, t = this.t[name];
    if (!t) return null;
    const f = this.target('dbg_' + name, t.w, t.h, gl.RGBA32F);
    this.clean();
    this.run('copy', COPY, f, { t_src: [t.tex] }, {});
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb);
    const px = new Float32Array(t.w * t.h * 4);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { w: t.w, h: t.h, data: px };
  }

  debugMean(name: string): number[] {
    const r = this.debugRead(name);
    if (!r) return [];
    const m = [0, 0, 0], px = r.data;
    for (let i = 0; i < px.length; i += 4) { m[0] += px[i]; m[1] += px[i + 1]; m[2] += px[i + 2]; }
    return m.map((v) => v / (r.w * r.h));
  }
}
