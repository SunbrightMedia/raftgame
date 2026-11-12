/**
 * The ShuttleworthL Blender project's post-processing, run on the GPU: the passes that
 * tools/blender/comp2glsl.py compiles from the project's compositor graph (as tools/blender/compeval.py,
 * which matches Blender 5.3, evaluates it), then Blender's display step (white balance, AgX, dither).
 * Colour conversions follow OpenColorIO's own op list and float32 arithmetic (tools/blender/ocioport.py); the
 * 3D colour tables they need are our measured tables, passed in as `luts` (name -> RGB float32, red fastest).
 *
 * Raw WebGL2 (float textures, texelFetch everywhere: the shaders do their own bilinear and bicubic sampling
 * with Blender's edge modes, so no hardware filtering is involved). The few values that change per frame
 * (noise seeds from the frame number) are computed here in float32, as Blender computes them.
 */

/** A pass's output: size, and storage (r / rg for single values and pairs; texelFetch reads them as (v, 0, 0, 1) and (x, y, 0, 1)). */
export interface BPTexture { w: number; h: number; label: string; fmt?: 'r' | 'rg' | 'rgba' }
export interface BPPass { label: string; frag: string; out: string; inputs: Record<string, string>; uniforms: Record<string, BPDynRef> }
export interface BPDynRef { node: string; out: string; convs: string[]; want: string; type?: string }
export interface BPDynInput { id: string; name: string; type: string; const?: number[] | string; ctype?: string; node?: string; out?: string; convs?: string[]; vtype?: string }
export interface BPDynNode { id: string; type: string; picked?: string | null; props: Record<string, unknown>; inputs: BPDynInput[]; outputs: Record<string, string> }
export interface BPRotation { rx: number; ry: number; center: BPDynRef | { const: number[] }; angle: BPDynRef | { const: number[] }; invert: boolean }
export interface BPProgram {
  size: [number, number];
  textures: Record<string, BPTexture>;
  passes: BPPass[];
  output: string;
  curves: number[][];
  coords: number[][];
  rotations: BPRotation[];
  dynamic: BPDynNode[];
  /** 3D colour tables: name -> its files, in order (raw float32 RGB, red fastest; big tables come in parts). */
  data: Record<string, string[]>;
  fps?: number;
  /** Where the compositor graph comes from. */
  source?: string;
  /** The display step's output (bytes / 255, Blender's 8-bit render), when the program has one. */
  display?: string;
  /** Blender's dither intensity (render settings) for the display step. */
  dither?: number;
  view?: Record<string, unknown>;
}

/** Blender's dither noise for the float -> byte step (IMB: hash_iqint3, triangle-shaped, 0.0033 * dither), in
 * float32 as Blender computes it, per pixel (rows from the bottom). */
export function ditherNoise(W: number, H: number, dither: number): Float32Array {
  const out = new Float32Array(W * H), d = f(dither), k = f(0.0033), inv = f(1 / 4294967296);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const qx = Math.imul(1103515245, (x >>> 1) ^ y) >>> 0;
      const qy = Math.imul(1103515245, (y >>> 1) ^ x) >>> 0;
      const nn = Math.imul(1103515245, (qx ^ (qy >>> 3)) >>> 0) >>> 0;
      let v = f(f(nn) * inv);
      v = f(f(v * 2) - 1);
      const sg = v < 0 ? -1 : 1;
      v = f(sg * f(1 - f(Math.sqrt(f(1 - Math.abs(v))))));
      out[y * W + x] = f(f(v * k) * d);
    }
  }
  return out;
}

// ---------------------------------------------------------------- float32 helpers (Blender's CPU math)
const f = Math.fround;
const fbuf = new Float32Array(1), ubuf = new Uint32Array(fbuf.buffer);
const bits = (x: number): number => { fbuf[0] = x; return ubuf[0]; };
const rot = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;
function hfinal(a: number, b: number, c: number): number {
  c = (c ^ b) >>> 0; c = (c - rot(b, 14)) >>> 0; a = (a ^ c) >>> 0; a = (a - rot(c, 11)) >>> 0; b = (b ^ a) >>> 0; b = (b - rot(a, 25)) >>> 0;
  c = (c ^ b) >>> 0; c = (c - rot(b, 16)) >>> 0; a = (a ^ c) >>> 0; a = (a - rot(c, 4)) >>> 0; b = (b ^ a) >>> 0; b = (b - rot(a, 14)) >>> 0;
  c = (c ^ b) >>> 0; c = (c - rot(b, 24)) >>> 0;
  return c;
}
function hashu(...k: number[]): number {
  const init = (0xdeadbeef + (k.length << 2) + 13) >>> 0;
  let a = init, b = init, c = init;
  if (k.length === 1) a = (a + k[0]) >>> 0;
  else if (k.length === 2) { b = (b + k[1]) >>> 0; a = (a + k[0]) >>> 0; }
  else { c = (c + k[2]) >>> 0; b = (b + k[1]) >>> 0; a = (a + k[0]) >>> 0; }
  return hfinal(a, b, c);
}
const u01 = (h: number): number => f(f(h) / f(4294967295));
const hashf = (...x: number[]): number => u01(hashu(...x.map(bits)));

type Val = number[];
function convert(v: Val, from: string, to: string): Val {
  if (from === to) return v;
  const lum = (c: Val) => f(f(f(c[0] * f(0.2126)) + f(c[1] * f(0.7152))) + f(c[2] * f(0.0722)));
  if (from === 'float' || from === 'int' || from === 'bool') {
    const x = f(v[0]);
    return to === 'float2' ? [x, x] : to === 'float3' ? [x, x, x] : to === 'color' ? [x, x, x, 1] : to === 'float4' ? [x, x, x, x] : [x];
  }
  if (from === 'float2') return to === 'float' ? [f(f(v[0] + v[1]) / 2)] : to === 'float3' ? [v[0], v[1], 0] : [v[0], v[1], 0, 1];
  if (from === 'float3') return to === 'float' ? [f(f(f(v[0] + v[1]) + v[2]) / 3)] : to === 'float2' ? [v[0], v[1]] : [v[0], v[1], v[2], 1];
  if (from === 'color' || from === 'float4') return to === 'float' ? [lum(v)] : to === 'float3' ? v.slice(0, 3) : to === 'float2' ? v.slice(0, 2) : v;
  throw new Error(`convert ${from} -> ${to}`);
}

/** The frame-dependent single values (noise seeds), node by node, in float32. */
function evalDynamic(prog: BPProgram, frame: number, fps: number): Map<string, Record<string, Val>> {
  const vals = new Map<string, Record<string, Val>>();
  const inVal = (inp: BPDynInput, want: string): Val => {
    let v: Val, ty: string;
    if (inp.const !== undefined) { v = (inp.const as number[]).map(f); ty = inp.ctype ?? want; }
    else {
      v = vals.get(inp.node!)![inp.out!]; ty = inp.vtype!;
      for (const c of inp.convs ?? []) { v = convert(v, ty, c); ty = c; }
    }
    return convert(v, ty, want);
  };
  for (const n of prog.dynamic) {
    const by = (name: string) => n.inputs.find((i) => i.name === name || i.id === name)!;
    let out: Record<string, Val> = {};
    switch (n.type) {
      case 'CompositorNodeSceneTime': out = { Frame: [f(frame)], Seconds: [f(f(frame) / f(fps))] }; break;
      case 'ShaderNodeTexWhiteNoise': {
        if (n.props.noise_dimensions !== '1D') throw new Error('dynamic white noise ' + n.props.noise_dimensions);
        const w = inVal(by('W'), 'float')[0];
        const val = hashf(w);
        out = { Value: [val], Color: [val, hashf(w, 1), hashf(w, 2), 1] };
        break;
      }
      case 'ShaderNodeSeparateXYZ': { const v = inVal(by('Vector'), 'float3'); out = { X: [v[0]], Y: [v[1]], Z: [v[2]] }; break; }
      case 'ShaderNodeCombineXYZ': out = { Vector: [inVal(by('X'), 'float')[0], inVal(by('Y'), 'float')[0], inVal(by('Z'), 'float')[0]] }; break;
      case 'ShaderNodeMapRange': {
        const [v, a, b, c, d] = ['Value', 'From Min', 'From Max', 'To Min', 'To Max'].map((k) => inVal(by(k), 'float')[0]);
        const den = f(b - a), fac = den !== 0 ? f(f(v - a) / den) : 0;
        let r: number;
        if (n.props.interpolation_type === 'SMOOTHSTEP') {
          const g = Math.min(Math.max(fac, 0), 1), s = f(f(3 - f(2 * g)) * f(g * g));
          r = f(c + f(s * f(d - c)));
        } else {
          r = f(c + f(fac * f(d - c)));
          if (n.props.clamp !== false) r = c > d ? Math.min(Math.max(r, d), c) : Math.min(Math.max(r, c), d);
        }
        out = { Result: [r] };
        break;
      }
      case 'GeometryNodeSwitch': case 'GeometryNodeMenuSwitch': case 'GeometryNodeIndexSwitch': {
        const inp = n.inputs.find((i) => i.id === n.picked)!;
        const [oid, oty] = Object.entries(n.outputs)[0];
        out = { [oid]: inVal(inp, oty) };
        break;
      }
      default: throw new Error('dynamic node ' + n.type);
    }
    vals.set(n.id, out);
  }
  return vals;
}

// ---------------------------------------------------------------- the GPU side
const VERT = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

interface Compiling { i: number; pr: WebGLProgram; fs: WebGLShader }
interface GPass { prog: WebGLProgram; out: string; w: number; h: number; samplers: [WebGLUniformLocation, string][]; uniforms: [WebGLUniformLocation, BPDynRef][] }

export class BlenderPost {
  private tex = new Map<string, WebGLTexture>();
  private fbo = new Map<string, WebGLFramebuffer>();
  private passes: GPass[] = [];
  private rotData: Float32Array;
  private rotW: number;
  readonly outputSize: [number, number];
  /** Tests: each overridden pass's own result, from before the override. */
  readonly captured = new Map<string, Float32Array>();

  /**
   * `pool` (default on): passes share float textures once every reader of a value has run, which keeps the GPU
   * memory to a few textures instead of one per pass (77 x 6.5 MB at 854 x 480). Tests that read any pass's
   * result after the run turn it off.
   */
  constructor(private gl: WebGL2RenderingContext, private prog: BPProgram, luts: Record<string, Float32Array>, opts: { pool?: boolean } = {}) {
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('needs EXT_color_buffer_float');
    this.cleanState();
    this.vao = gl.createVertexArray()!;
    if (opts.pool === false) for (const [id, t] of Object.entries(prog.textures)) this.makeTarget(id, t.w, t.h, t.fmt);
    else this.allocate();
    this.outputSize = [prog.textures[prog.output].w, prog.textures[prog.output].h];
    // tables: curves (257 x rows), coordinates (max x rows), rotations (per frame), 3D colour tables
    this.makeData('curves', 257, Math.max(1, prog.curves.length), prog.curves.flat());
    const cw = Math.max(1, ...prog.coords.map((r) => r.length));
    this.makeData('coords', cw, Math.max(1, prog.coords.length), prog.coords.flatMap((r) => [...r, ...new Array(cw - r.length).fill(0)]));
    this.rotW = cw;
    this.rotData = new Float32Array(cw * Math.max(1, 4 * prog.rotations.length));
    this.makeData('rot', cw, Math.max(1, 4 * prog.rotations.length), this.rotData);
    if (prog.display) this.makeData('dither', prog.size[0], prog.size[1], ditherNoise(prog.size[0], prog.size[1], prog.dither ?? 0));
    for (const [name, files] of Object.entries(prog.data)) {
      const lut = luts[name];
      if (!lut) throw new Error('missing table ' + name + ' (' + files.join(', ') + ')');
      const n = Math.round(Math.cbrt(lut.length / 3));
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_3D, t);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB32F, n, n, n, 0, gl.RGB, gl.FLOAT, lut);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.NEAREST);
      this.tex.set(name, t);
    }
    this.vs = this.shader(gl.VERTEX_SHADER, VERT);
    // The pass programs are compiled by prepare(), a few per frame (see there); run() compiles what is left.
    this.par = gl.getExtension('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number } | null;
    this.todo = prog.passes.map((_, i) => i);
  }

  private vs: WebGLShader;
  private vao: WebGLVertexArrayObject;
  private par: { COMPLETION_STATUS_KHR: number } | null;
  /** Passes not started yet, and started ones the driver is still compiling. */
  private todo: number[] = [];
  private compiling: Compiling[] = [];
  private done = 0;

  /** All pass programs compiled and linked. */
  get ready(): boolean { return this.todo.length === 0 && this.compiling.length === 0; }
  /** [compiled, all] pass programs. */
  get progress(): [number, number] { return [this.done, this.prog.passes.length]; }

  /**
   * One frame's share of the compile: starts up to `start` more programs and collects the ones that are done.
   * True once all are ready. A browser shares one GPU process between all its tabs, so a long compile in one
   * go stalls every tab: with KHR_parallel_shader_compile the driver compiles in the background and this never
   * waits; without it, this waits for one program per call. Throws on a compile error.
   */
  prepare(start = this.par ? 4 : 1): boolean {
    const gl = this.gl;
    for (let k = 0; k < start && this.todo.length; k++) {
      const i = this.todo.shift()!, fs = gl.createShader(gl.FRAGMENT_SHADER)!, pr = gl.createProgram()!;
      gl.shaderSource(fs, this.prog.passes[i].frag); gl.compileShader(fs);
      gl.attachShader(pr, this.vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
      this.compiling.push({ i, pr, fs });
    }
    const still: Compiling[] = [];
    for (const c of this.compiling) {
      if (this.par && !gl.getProgramParameter(c.pr, this.par.COMPLETION_STATUS_KHR)) still.push(c);
      else this.finish(c);
    }
    this.compiling = still;
    return this.ready;
  }

  /** Compile everything left, waiting for it (tools and tests call run() straight away). */
  finishSync(): void {
    this.prepare(this.todo.length);
    for (const c of this.compiling) this.finish(c);
    this.compiling = [];
  }

  private finish(c: Compiling): void {
    const gl = this.gl, p = this.prog.passes[c.i], pr = c.pr;
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
      throw new Error(p.label + ': ' + (gl.getShaderParameter(c.fs, gl.COMPILE_STATUS) ? gl.getProgramInfoLog(pr) : gl.getShaderInfoLog(c.fs)));
    }
    gl.detachShader(pr, c.fs); gl.deleteShader(c.fs);
    const samplers: [WebGLUniformLocation, string][] = [];
    for (const [u, tid] of Object.entries(p.inputs)) { const loc = gl.getUniformLocation(pr, u); if (loc) samplers.push([loc, tid]); }
    const uniforms: [WebGLUniformLocation, BPDynRef][] = [];
    for (const [u, ref] of Object.entries(p.uniforms)) { const loc = gl.getUniformLocation(pr, u); if (loc) uniforms.push([loc, ref]); }
    const t = this.prog.textures[p.out];
    this.passes[c.i] = { prog: pr, out: p.out, w: t.w, h: t.h, samplers, uniforms };
    this.done++;
  }

  /**
   * GL state that a shared context (three.js) may leave behind and that would change results: pixel unpacking
   * (three.js leaves FLIP_Y on: data rows would come in upside down and 3D uploads fail), blending, tests,
   * masks, dithering.
   */
  private cleanState(): void {
    const gl = this.gl;
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0); gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 4); gl.pixelStorei(gl.PACK_ROW_LENGTH, 0); gl.pixelStorei(gl.PACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.PACK_SKIP_ROWS, 0);
    for (const cap of [gl.BLEND, gl.DEPTH_TEST, gl.CULL_FACE, gl.SCISSOR_TEST, gl.STENCIL_TEST, gl.POLYGON_OFFSET_FILL, gl.SAMPLE_ALPHA_TO_COVERAGE, gl.SAMPLE_COVERAGE, gl.DITHER, gl.RASTERIZER_DISCARD]) gl.disable(cap);
    gl.colorMask(true, true, true, true);
  }
  private inputProg: { prog: WebGLProgram; src: WebGLUniformLocation | null; scale: WebGLUniformLocation | null } | null = null;
  private presentProg: { prog: WebGLProgram; src: WebGLUniformLocation | null; rect: WebGLUniformLocation | null; size: WebGLUniformLocation | null; linear: WebGLUniformLocation | null } | null = null;

  private link(frag: string, label: string): WebGLProgram {
    const gl = this.gl, pr = gl.createProgram()!;
    gl.attachShader(pr, this.vs); gl.attachShader(pr, this.shader(gl.FRAGMENT_SHADER, frag, label)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(label + ': ' + gl.getProgramInfoLog(pr));
    return pr;
  }

  /** The game's render as the compositor's input: x exposure (one float multiply), alpha 1 (Blender's opaque film). */
  private stageInput(input: WebGLTexture, scale: number): void {
    const gl = this.gl, [W, H] = this.prog.size;
    if (!this.inputProg) {
      const pr = this.link(`#version 300 es
precision highp float; uniform highp sampler2D t_src; uniform float u_scale; out vec4 o;
void main() { vec4 c = texelFetch(t_src, ivec2(gl_FragCoord.xy), 0); o = vec4(c.rgb * u_scale, 1.0); }`, 'input stage');
      this.inputProg = { prog: pr, src: gl.getUniformLocation(pr, 't_src'), scale: gl.getUniformLocation(pr, 'u_scale') };
      this.makeTarget('input0', W, H);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo.get('input0')!);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.inputProg.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, input); gl.uniform1i(this.inputProg.src, 0);
    gl.uniform1f(this.inputProg.scale, f(scale));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Draw the display output on the screen (the default framebuffer, w x h), as large as fits with the program's
   * aspect, black bars round it. At 1:1 every pixel is Blender's byte. `linear` = bilinear when scaled.
   */
  present(w: number, h: number, linear: boolean): void {
    const gl = this.gl, src = this.tex.get(this.prog.display ?? this.prog.output)!, [W, H] = this.prog.size;
    if (!this.presentProg) {
      const pr = this.link(`#version 300 es
precision highp float; uniform highp sampler2D t_src; uniform vec4 u_rect; uniform vec2 u_size; uniform int u_linear; out vec4 o;
vec4 at(ivec2 p) { return texelFetch(t_src, clamp(p, ivec2(0), ivec2(u_size) - 1), 0); }
void main() {
  vec2 uv = (gl_FragCoord.xy - u_rect.xy) / u_rect.zw * u_size;
  if (u_linear == 0) { o = vec4(at(ivec2(floor(uv))).rgb, 1.0); return; }
  vec2 q = uv - 0.5, b = floor(q), t = q - b; ivec2 i = ivec2(b);
  o = vec4(mix(mix(at(i), at(i + ivec2(1, 0)), t.x), mix(at(i + ivec2(0, 1)), at(i + ivec2(1, 1)), t.x), t.y).rgb, 1.0);
}`, 'present');
      this.presentProg = { prog: pr, src: gl.getUniformLocation(pr, 't_src'), rect: gl.getUniformLocation(pr, 'u_rect'), size: gl.getUniformLocation(pr, 'u_size'), linear: gl.getUniformLocation(pr, 'u_linear') };
    }
    const k = Math.min(w / W, h / H), rw = Math.round(W * k), rh = Math.round(H * k), rx = Math.floor((w - rw) / 2), ry = Math.floor((h - rh) / 2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.cleanState();
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(rx, ry, rw, rh);
    gl.useProgram(this.presentProg.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(this.presentProg.src, 0);
    gl.uniform4f(this.presentProg.rect, rx, ry, rw, rh);
    gl.uniform2f(this.presentProg.size, W, H);
    gl.uniform1i(this.presentProg.linear, linear && (rw !== W || rh !== H) ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Free every GL object this made. */
  dispose(): void {
    const gl = this.gl;
    for (const t of new Set([...this.tex].filter(([id]) => id !== 'input').map(([, t]) => t))) gl.deleteTexture(t);   // 'input' may be the caller's
    for (const fb of new Set(this.fbo.values())) gl.deleteFramebuffer(fb);
    for (const p of this.passes) if (p) gl.deleteProgram(p.prog);
    for (const c of this.compiling) { gl.deleteProgram(c.pr); gl.deleteShader(c.fs); }
    this.compiling = []; this.todo = [];
    if (this.inputProg) gl.deleteProgram(this.inputProg.prog);
    if (this.presentProg) gl.deleteProgram(this.presentProg.prog);
    gl.deleteShader(this.vs);
    gl.deleteVertexArray(this.vao);
    this.tex.clear(); this.fbo.clear(); this.passes = [];
  }

  private shader(type: number, src: string, label = ''): WebGLShader {
    const gl = this.gl, s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${label}: ${gl.getShaderInfoLog(s)}`);
    return s;
  }

  /** Pass outputs onto shared targets: a target is free again after the last pass that reads its value. */
  private allocate(): void {
    const prog = this.prog, last = new Map<string, number>();
    prog.passes.forEach((p, i) => { for (const tid of Object.values(p.inputs)) if (tid in prog.textures) last.set(tid, i); });
    const free = new Map<string, string[]>(), keep = new Set([prog.output, prog.display ?? prog.output]);
    let n = 0;
    prog.passes.forEach((p, i) => {
      const t = prog.textures[p.out], key = t.w + 'x' + t.h + (t.fmt ?? 'rgba');
      const phys = free.get(key)?.pop() ?? `pool${n++}`;
      if (!this.tex.has(phys)) this.makeTarget(phys, t.w, t.h, t.fmt);
      this.tex.set(p.out, this.tex.get(phys)!); this.fbo.set(p.out, this.fbo.get(phys)!); this.physOf.set(p.out, phys);
      for (const tid of new Set(Object.values(p.inputs))) {
        if (last.get(tid) === i && this.physOf.has(tid) && !keep.has(tid)) {
          const tt = prog.textures[tid], k = tt.w + 'x' + tt.h + (tt.fmt ?? 'rgba');
          free.set(k, [...(free.get(k) ?? []), this.physOf.get(tid)!]);
        }
      }
      if (!last.has(p.out) && !keep.has(p.out)) free.set(key, [...(free.get(key) ?? []), phys]);
    });
    this.poolSize = n;
    const seen = new Set<string>();
    this.targetBytes = 0;
    for (const p of prog.passes) {
      const ph = this.physOf.get(p.out)!;
      if (!seen.has(ph)) { seen.add(ph); const t = prog.textures[p.out]; this.targetBytes += t.w * t.h * 4 * (t.fmt === 'r' ? 1 : t.fmt === 'rg' ? 2 : 4); }
    }
  }

  /** Bytes in float targets (with the pool on). */
  targetBytes = 0;

  private physOf = new Map<string, string>();
  /** Float targets in use (with the pool on). */
  poolSize = 0;

  private makeTarget(id: string, w: number, h: number, fmt: BPTexture['fmt'] = 'rgba'): void {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt === 'r' ? gl.R32F : fmt === 'rg' ? gl.RG32F : gl.RGBA32F, w, h);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    this.tex.set(id, t); this.fbo.set(id, fb);
  }

  private makeData(id: string, w: number, h: number, data: number[] | Float32Array): void {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, data instanceof Float32Array ? data : new Float32Array(data));
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    this.tex.set(id, t);
  }

  /** The render (scene linear, RGBA float texture of the program's size); `frame` drives the noise seeds.
   * Returns the display output (Blender's 8-bit picture, as bytes / 255) when the program has one, else the
   * compositor's scene-linear output. */
  run(input: WebGLTexture, frame: number, overrides?: Record<string, Float32Array>, stage?: { scale: number }): WebGLTexture {
    const gl = this.gl, prog = this.prog;
    if (!this.ready) this.finishSync();
    this.cleanState();
    gl.bindVertexArray(this.vao);
    const dyn = evalDynamic(prog, frame, prog.fps ?? 24);
    const value = (r: BPDynRef | { const: number[] }): Val => {
      if ('const' in r) return r.const.map(f);
      let v = dyn.get(r.node)![r.out];
      const n = prog.dynamic.find((d) => d.id === r.node)!;
      let ty = n.outputs[r.out];
      for (const c of r.convs) { v = convert(v, ty, c); ty = c; }
      return convert(v, ty, r.want);
    };
    // the exact rotated-coordinate tables (see comp2glsl's separable rotate)
    prog.rotations.forEach((rt, k) => {
      const c3 = value(rt.center); let a = value(rt.angle)[0];
      if (rt.invert) a = -a;
      const s = f(Math.sin(a)), c = f(Math.cos(a)), ns = f(-s);
      const ux = prog.coords[rt.rx], uy = prog.coords[rt.ry], W = this.rotW;
      for (let x = 0; x < ux.length; x++) { const tx = f(ux[x] - c3[0]); this.rotData[(4 * k) * W + x] = f(c * tx); this.rotData[(4 * k + 1) * W + x] = f(s * tx); }
      for (let y = 0; y < uy.length; y++) { const ty = f(uy[y] - c3[1]); this.rotData[(4 * k + 2) * W + y] = f(ns * ty); this.rotData[(4 * k + 3) * W + y] = f(c * ty); }
    });
    if (prog.rotations.length) {
      gl.bindTexture(gl.TEXTURE_2D, this.tex.get('rot')!);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.rotW, 4 * prog.rotations.length, gl.RED, gl.FLOAT, this.rotData);
    }
    if (stage) { this.stageInput(input, stage.scale); this.tex.set('input', this.tex.get('input0')!); }
    else this.tex.set('input', input);
    for (const p of this.passes) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo.get(p.out)!);
      gl.viewport(0, 0, p.w, p.h);
      gl.useProgram(p.prog);
      p.samplers.forEach(([loc, tid], unit) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        const is3d = tid in prog.data;
        gl.bindTexture(is3d ? gl.TEXTURE_3D : gl.TEXTURE_2D, this.tex.get(tid)!);
        gl.uniform1i(loc, unit);
      });
      for (const [loc, ref] of p.uniforms) {
        const v = value(ref);
        if (v.length === 1) gl.uniform1f(loc, v[0]); else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
        else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]); else gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const ov = overrides?.[p.out];
      if (ov) {   // tests: keep the pass's own result, then replace it with reference values (bottom row first, RGBA)
        this.captured.set(p.out, this.read(p.out));
        gl.bindTexture(gl.TEXTURE_2D, this.tex.get(p.out)!);
        const fmt = prog.textures[p.out].fmt ?? 'rgba', k = fmt === 'r' ? 1 : fmt === 'rg' ? 2 : 4;
        const data = k === 4 ? ov : ov.filter((_, i) => i % 4 < k);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, p.w, p.h, k === 1 ? gl.RED : k === 2 ? gl.RG : gl.RGBA, gl.FLOAT, data);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.tex.get(prog.display ?? prog.output)!;
  }

  /** For tests: a texture's float data (bottom row first). */
  read(id: string): Float32Array {
    const gl = this.gl, t = this.prog.textures[id] ?? { w: this.outputSize[0], h: this.outputSize[1] };
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo.get(id)!);
    const out = new Float32Array(t.w * t.h * 4);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  textureIds(): string[] { return Object.keys(this.prog.textures); }
}
