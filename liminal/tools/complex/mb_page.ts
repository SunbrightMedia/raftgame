// Browser side of tools/complex/check_mb.py: runs our motion blur (complexMotionBlur.ts) on the game's own inputs and
// returns every step's picture as float32 RGBA (rows as stored: row 0 = the top). Bundled by run_camera.cjs.
import { ComplexMotionBlur, type MotionBlurInputs } from '../../src/engine/render/complexMotionBlur';

interface TexIn { w: number; h: number; url: string }
interface Job { textures: Record<string, TexIn>; params: Omit<MotionBlurInputs, 'scene' | 'depth' | 'vel'>; scatterDepth?: [string, string] }

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
    const f = name === 'scene' ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    tex[name] = x;
  }
  const mb = new ComplexMotionBlur(gl);
  mb.debugExact = true;
  if (job.scatterDepth) mb.scatterDepth = job.scatterDepth.map((n) => (gl as unknown as Record<string, number>)[n]) as [number, number];
  mb.run({ ...job.params, scene: tex.scene, depth: tex.depth, vel: tex.vel, flatIn: tex.flatIn, tilesIn: tex.tilesIn, dilatedIn: tex.dilatedIn });
  const err = gl.getError();
  if (err) throw new Error('GL error ' + err);
  const out: Record<string, { w: number; h: number; data: string }> = {};
  for (const [name, t] of Object.entries(mb.targets)) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    const px = new Float32Array(t.w * t.h * 4);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, px);
    out[name] = { w: t.w, h: t.h, data: b64(px) };
  }
  return { out, renderer: gl.getParameter(gl.RENDERER) };
};
