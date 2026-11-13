// Browser side of tools/complex/check_camera.py: runs one of our camera passes (complexCamera.ts) on given
// inputs and returns the float output. Bundled with esbuild into a page by run_camera.cjs.
import { COMPLEX_PASSES, COMPLEX_VERT } from '../../src/engine/render/complexCamera';
import { UE_LIGHT_GLSL } from '../../src/engine/render/ueLight';
import { TAAU } from '../../src/engine/render/complexTAA';

const PASSES = { ...COMPLEX_PASSES, taa: TAAU };

interface TexIn { w: number; h: number; d?: number; wrap?: 'clamp' | 'repeat'; data?: string /* base64 float32 RGBA, row 0 = top */; url?: string /* or the same bytes, fetched */ }
interface Job { pass: keyof typeof PASSES; frag?: string; w: number; h: number; textures: Record<string, TexIn>; uniforms: Record<string, number[]> }

function f32(b64: string): Float32Array {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Float32Array(u.buffer);
}
function b64(a: Float32Array): string {
  const u = new Uint8Array(a.buffer); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

(window as unknown as { runJob: (j: Job) => unknown }).runJob = async (job: Job) => {
  const bytes: Record<string, Float32Array> = {};
  for (const [name, t] of Object.entries(job.textures)) bytes[name] = t.url ? new Float32Array(await (await fetch(t.url)).arrayBuffer()) : f32(t.data!);
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2')!;
  if (!gl.getExtension('EXT_color_buffer_float') || !gl.getExtension('OES_texture_float_linear')) throw new Error('float targets / linear float textures not supported');
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'compile');
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, COMPLEX_VERT));
  // frag: debugging variants and other checks; %UE_LIGHT% = our Unreal lamp GLSL (ueLight.ts)
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, (job.frag ?? PASSES[job.pass]).replace('%UE_LIGHT%', UE_LIGHT_GLSL)));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
  gl.useProgram(prog);
  let unit = 0;
  for (const [name, t] of Object.entries(job.textures)) {
    const tex = gl.createTexture()!;
    const target = t.d ? gl.TEXTURE_3D : gl.TEXTURE_2D;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target, tex);
    const data = bytes[name];
    if (t.d) gl.texImage3D(target, 0, gl.RGBA32F, t.w, t.h, t.d, 0, gl.RGBA, gl.FLOAT, data);
    else gl.texImage2D(target, 0, gl.RGBA32F, t.w, t.h, 0, gl.RGBA, gl.FLOAT, data);
    const wrap = t.wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(target, gl.TEXTURE_WRAP_T, wrap);
    if (t.d) gl.texParameteri(target, gl.TEXTURE_WRAP_R, wrap);
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(prog, name), unit);
    unit++;
  }
  for (const [name, v] of Object.entries(job.uniforms)) {
    const loc = gl.getUniformLocation(prog, name);
    if (!loc) continue;
    [gl.uniform1f, gl.uniform2f, gl.uniform3f, gl.uniform4f][v.length - 1].call(gl, loc, ...(v as [number, number, number, number]));
  }
  const out = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0 + unit);          // a free unit: binding it over an input would replace that input
  gl.bindTexture(gl.TEXTURE_2D, out);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, job.w, job.h);
  gl.bindTexture(gl.TEXTURE_2D, null);
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
  gl.viewport(0, 0, job.w, job.h);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const err = gl.getError();
  if (err) throw new Error('GL error ' + err + ' drawing ' + job.pass);
  const px = new Float32Array(job.w * job.h * 4);
  gl.readPixels(0, 0, job.w, job.h, gl.RGBA, gl.FLOAT, px);
  return { data: b64(px), renderer: gl.getParameter(gl.RENDERER) };
};
