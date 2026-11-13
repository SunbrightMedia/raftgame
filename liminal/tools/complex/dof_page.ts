// Browser side of tools/complex/check_dof.py: runs our depth of field (complexDOF.ts) on the game's own inputs and
// returns every step's picture as float32 RGBA (rows as stored: row 0 = the top). Bundled by run_camera.cjs.
import { ComplexDOF, type DOFInputs } from '../../src/engine/render/complexDOF';

interface TexIn { w: number; h: number; url: string }
interface Job { textures: Record<string, TexIn>; params: Omit<DOFInputs, 'scene' | 'depth' | 'vel' | 'stencil' | 'histIn'> }

function b64(a: Float32Array): string {
  const u = new Uint8Array(a.buffer); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

(window as unknown as { runJob: (j: Job) => unknown }).runJob = async (job: Job) => {
  const gl = document.createElement('canvas').getContext('webgl2')!;
  if (!gl.getExtension('EXT_color_buffer_float') || !gl.getExtension('OES_texture_float_linear')) throw new Error('float targets / linear float textures not supported');
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const tex: Record<string, WebGLTexture> = {};
  for (const [name, t] of Object.entries(job.textures)) {
    const data = new Float32Array(await (await fetch(t.url)).arrayBuffer());
    const x = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, x);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, t.w, t.h, 0, gl.RGBA, gl.FLOAT, data);
    const f = name === 'histIn' ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    tex[name] = x;
  }
  const dof = new ComplexDOF(gl);
  dof.run({ ...job.params, scene: tex.scene, depth: tex.depth, vel: tex.vel, stencil: tex.stencil, histIn: tex.histIn });
  const err = gl.getError();
  if (err) throw new Error('GL error ' + err);
  const out: Record<string, { w: number; h: number; data: string }> = {};
  const read = (name: string, t: { fb: WebGLFramebuffer; w: number; h: number }, att = 0) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.readBuffer(gl.COLOR_ATTACHMENT0 + att);
    const px = new Float32Array(t.w * t.h * 4);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, px);
    out[name] = { w: t.w, h: t.h, data: b64(px) };
  };
  for (const [name, t] of Object.entries(dof.targets)) {
    read(name, t);
    if (t.tex2) read(name + '2', t, 1);
  }
  return { out, renderer: gl.getParameter(gl.RENDERER) };
};
