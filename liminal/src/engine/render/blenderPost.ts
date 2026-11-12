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

export interface BPTexture { w: number; h: number; label: string }
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
  data: Record<string, string>;
  fps?: number;
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

interface GPass { prog: WebGLProgram; out: string; w: number; h: number; samplers: [WebGLUniformLocation, string][]; uniforms: [WebGLUniformLocation, BPDynRef][] }

export class BlenderPost {
  private tex = new Map<string, WebGLTexture>();
  private fbo = new Map<string, WebGLFramebuffer>();
  private passes: GPass[] = [];
  private rotData: Float32Array;
  private rotW: number;
  readonly outputSize: [number, number];

  constructor(private gl: WebGL2RenderingContext, private prog: BPProgram, luts: Record<string, Float32Array>) {
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('needs EXT_color_buffer_float');
    for (const [id, t] of Object.entries(prog.textures)) this.makeTarget(id, t.w, t.h);
    this.outputSize = [prog.textures[prog.output].w, prog.textures[prog.output].h];
    // tables: curves (257 x rows), coordinates (max x rows), rotations (per frame), 3D colour tables
    this.makeData('curves', 257, Math.max(1, prog.curves.length), prog.curves.flat());
    const cw = Math.max(1, ...prog.coords.map((r) => r.length));
    this.makeData('coords', cw, Math.max(1, prog.coords.length), prog.coords.flatMap((r) => [...r, ...new Array(cw - r.length).fill(0)]));
    this.rotW = cw;
    this.rotData = new Float32Array(cw * Math.max(1, 4 * prog.rotations.length));
    this.makeData('rot', cw, Math.max(1, 4 * prog.rotations.length), this.rotData);
    if (prog.display) this.makeData('dither', prog.size[0], prog.size[1], ditherNoise(prog.size[0], prog.size[1], prog.dither ?? 0));
    for (const [name, file] of Object.entries(prog.data)) {
      const lut = luts[name];
      if (!lut) throw new Error('missing table ' + name + ' (' + file + ')');
      const n = Math.round(Math.cbrt(lut.length / 3));
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_3D, t);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB32F, n, n, n, 0, gl.RGB, gl.FLOAT, lut);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.NEAREST);
      this.tex.set(name, t);
    }
    const vs = this.shader(gl.VERTEX_SHADER, VERT);
    for (const p of prog.passes) {
      const fs = this.shader(gl.FRAGMENT_SHADER, p.frag, p.label);
      const pr = gl.createProgram()!;
      gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(p.label + ': ' + gl.getProgramInfoLog(pr));
      const samplers: [WebGLUniformLocation, string][] = [];
      for (const [u, tid] of Object.entries(p.inputs)) { const loc = gl.getUniformLocation(pr, u); if (loc) samplers.push([loc, tid]); }
      const uniforms: [WebGLUniformLocation, BPDynRef][] = [];
      for (const [u, ref] of Object.entries(p.uniforms)) { const loc = gl.getUniformLocation(pr, u); if (loc) uniforms.push([loc, ref]); }
      const t = prog.textures[p.out];
      this.passes.push({ prog: pr, out: p.out, w: t.w, h: t.h, samplers, uniforms });
    }
  }

  private shader(type: number, src: string, label = ''): WebGLShader {
    const gl = this.gl, s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${label}: ${gl.getShaderInfoLog(s)}`);
    return s;
  }

  private makeTarget(id: string, w: number, h: number): void {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
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
  run(input: WebGLTexture, frame: number): WebGLTexture {
    const gl = this.gl, prog = this.prog;
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
    this.tex.set('input', input);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
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
