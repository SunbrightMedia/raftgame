/**
 * Camera model "complex": The Complex's camera, run as that game runs it (complexCamera.ts has the passes and
 * how each is checked against the game's own compiled step). Raw WebGL2 on three.js's context, so every
 * picture is stored in the game's own format: the scene and its glow as R11G11B10 floats, the pictures between
 * passes as 10-bit RGB, the tone table as a 32^3 10-bit 3D texture. Image row 0 is the top inside the chain.
 *
 * Steps: scene (x exposure, flipped to row 0 = top) -> glow -> tonemapper -> sharpen -> posterize -> grain ->
 * tape -> lens -> the screen, 4:3 with bars.
 *
 * Not yet the game's own (said in the HUD help): the glow (a three-width blur fitted to the capture's measured
 * spread, split into the game's scene / glow weights), and the upscaler (the scene is scaled up bilinearly,
 * then softened). The lens dirt and the grain and tape noises are ours (the game's are its own image files).
 */
import { COMPLEX_VERT, TONEMAP, SHARPEN, POSTERIZE, GRAIN, TAPE, LENS, lensConstants } from './complexCamera';
import { makeToneTable, COMPLEX_TONE } from './complexTone';
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
  /** Upscaler stand-in: blur before the glow and tone, sigma in output pixels. */
  soften: number;
  /** Horizontal field of view the lens bend uses (radians; the game's camera: 98.2 degrees). */
  hfov?: number;
}

interface Prog { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> }
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

  constructor(private gl: WebGL2RenderingContext) {
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('complex camera: needs EXT_color_buffer_float');
    // three.js leaves FLIP_Y / premultiply on; WebGL refuses 3D uploads then, and 2D ones come in upside down
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0); gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
    this.vao = gl.createVertexArray()!;
    this.lut = this.makeLut();
    this.dirt = this.makeDirt();
    this.grain = this.makeGrain();
    this.streak = this.makeStreak();
    this.band = this.makeBand();
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

  /** Lens dirt (ours): an even film with soft variations and a few specks, mean about 0.022. */
  private makeDirt(): WebGLTexture {
    const W = 432, H = 288, d = new Uint8Array(W * H * 4), r = new Rng(9137);
    const a = new Float32Array(W * H).fill(0.0205);
    for (const [cells, amp] of [[3, 0.006], [7, 0.003], [15, 0.0015]] as const) {
      const gw = cells + 2, grid = Array.from({ length: gw * gw }, () => r.range(-1, 1));
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const gx = (x / W) * cells, gy = (y / W) * cells, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), g = (i: number, j: number) => grid[j * gw + i];
        a[y * W + x] += amp * ((g(ix, iy) * (1 - sx) + g(ix + 1, iy) * sx) * (1 - sy) + (g(ix, iy + 1) * (1 - sx) + g(ix + 1, iy + 1) * sx) * sy);
      }
    }
    for (let i = 0; i < 120; i++) {
      const cx = r.range(0, W), cy = r.range(0, H), rad = r.range(0.8, 2.2), amp = r.range(0.004, 0.02);
      for (let y = Math.max(0, Math.floor(cy - 5)); y < Math.min(H, cy + 5); y++) for (let x = Math.max(0, Math.floor(cx - 5)); x < Math.min(W, cx + 5); x++) {
        a[y * W + x] += amp * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (rad * rad));
      }
    }
    for (let i = 0; i < W * H; i++) { const v = Math.round(Math.max(0, a[i]) * 255); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    return this.tex2d(W, H, d, this.gl.CLAMP_TO_EDGE, false);
  }

  /** Grain noise (ours), the size of the game's (1400 x 1050, no mips): sparse specks, mean 0.01 / 0.01 / 0.04,
   *  so x 0.2 gives the measured +0.002 / +0.002 / +0.008. */
  private makeGrain(): WebGLTexture {
    const W = 1400, H = 1050, d = new Uint8Array(W * H * 4), r = new Rng(4421);
    for (let i = 0; i < W * H; i++) {
      const v = Math.pow(r.next(), 7) * 0.32;
      d[i * 4] = d[i * 4 + 1] = Math.min(255, Math.round(v * 0.25 * 255)); d[i * 4 + 2] = Math.min(255, Math.round(v * 255)); d[i * 4 + 3] = 255;
    }
    return this.tex2d(W, H, d, this.gl.REPEAT, false);
  }

  /**
   * Tape streak noise (ours), 512 x 512 with mips like the game's: fine per-texel noise, mean 0.064 / 0.069 / 0.040.
   * Measured in the capture (the game's own tape step run with its streak images set to zero, subtracted from
   * its output; frames 18325 and 20732): the streaks add +0.003 / +0.003 / +0.002 on average, fine-grained,
   * spread under 0.005. With our band's mean s(1 - s) of about 0.17, 0.3 x n x s(1 - s) gives that.
   */
  private makeStreak(): WebGLTexture {
    const N = 512, d = new Uint8Array(N * N * 4), r = new Rng(77), m = [0.064, 0.069, 0.04];
    for (let i = 0; i < N * N; i++) {
      const u = r.next();
      for (let c = 0; c < 3; c++) d[i * 4 + c] = Math.round(Math.min(1, u * 2 * m[c]) * 255);
      d[i * 4 + 3] = 255;
    }
    return this.tex2d(N, N, d, this.gl.REPEAT, true);
  }

  /** Tape band (ours): soft horizontal bands, 944 x 1260 like the game's, read as s (1 - s). */
  private makeBand(): WebGLTexture {
    const W = 944, H = 1260, d = new Uint8Array(W * H * 4), r = new Rng(5309);
    const rows = Array.from({ length: 64 }, () => r.next());
    for (let y = 0; y < H; y++) {
      const t = (y / H) * 64, i = Math.floor(t), f = t - i, s = f * f * (3 - 2 * f);
      const base = rows[i % 64] * (1 - s) + rows[(i + 1) % 64] * s;
      for (let x = 0; x < W; x++) {
        const v = Math.min(1, Math.max(0, base + 0.15 * Math.sin((x / W) * Math.PI * 6 + y * 0.01)));
        const o = (y * W + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = Math.round(v * 255); d[o + 3] = 255;
      }
    }
    return this.tex2d(W, H, d, this.gl.REPEAT, false);
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
   * src: three.js's scene picture (linear light, rows from the bottom), srcW x srcH. Draws the finished picture
   * into the canvas (cw x ch), a centred 4:3 box with black bars.
   */
  render(src: WebGLTexture, cw: number, ch: number, p: ComplexParams, dt: number): void {
    const gl = this.gl;
    this.time += dt;
    this.clean();
    let ow = cw, oh = Math.round(cw * 0.75);
    if (oh > ch) { oh = ch; ow = Math.round(ch * 4 / 3); }
    const R11 = gl.R11F_G11F_B10F, R10 = gl.RGB10_A2;
    // 1. the scene, exposed as the game stores it (R11G11B10), at the picture's size
    const scene = this.target('scene', ow, oh, R11);
    // the game stores its scene pre-exposed by the same 34.13 its exposure is: the stored value IS the exposed light
    this.run('in', SCENE_IN, scene, { t_src: [src] }, { u_size: [ow, oh], u_scale: p.exposure });
    let sceneT = scene;
    if (p.soften > 0) {     // upscaler stand-in
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
    for (const [t, sigma] of [[ga, 0.006], [gb, 0.025], [gc, 0.08]] as const) {
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
      u_tint: [1, 1, 1], u_dirtK: [p.dirt, p.dirt, p.dirt], u_apply: [p.sceneR, p.sceneG, p.sceneB],
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
  debugMean(name: string): number[] {
    const gl = this.gl, t = this.t[name];
    if (!t) return [];
    const COPY = `#version 300 es
precision highp float; precision highp sampler2D; uniform sampler2D t_src; out vec4 o;
void main() { o = texelFetch(t_src, ivec2(gl_FragCoord.xy), 0); }`;
    const f = this.target('dbg_' + name, t.w, t.h, gl.RGBA32F);
    this.clean();
    this.run('copy', COPY, f, { t_src: [t.tex] }, {});
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb);
    const px = new Float32Array(t.w * t.h * 4);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const m = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) { m[0] += px[i]; m[1] += px[i + 1]; m[2] += px[i + 2]; }
    return m.map((v) => v / (t.w * t.h));
  }
}
