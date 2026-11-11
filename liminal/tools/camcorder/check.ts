/**
 * Test bench for the camcorder (src/engine/render/camcorder.ts): runs it on
 * a captured HDR picture and shows one stage, for tools/camcorder/compare.py.
 * Query: ?white=<range of the picture>&stage=tone|sharp|finish|final&t=<seconds>
 * The picture is served at /camcheck/scene.png by the test runner.
 */
import * as THREE from 'three';
import { CamcorderPost, type CamcorderParams } from '../../src/engine/render/camcorder';
import { SETTINGS } from '../../src/data/settings';
import { defaultsOf } from '../../src/data/schema';

const q = new URLSearchParams(location.search);
const white = Number(q.get('white') ?? 4.625);
const stage = q.get('stage') ?? 'final';
const canvas = document.getElementById('c') as HTMLCanvasElement;
const gl = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true, antialias: false });
gl.setPixelRatio(1);
gl.setSize(1440, 1080, false);
const img = new Image();
img.src = '/camcheck/scene.png';
await img.decode();
const c2 = document.createElement('canvas');
c2.width = img.width; c2.height = img.height;
const g2 = c2.getContext('2d')!;
g2.drawImage(img, 0, 0);
const px = g2.getImageData(0, 0, img.width, img.height).data;
const f = new Float32Array(img.width * img.height * 4);
for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
  const s = ((img.height - 1 - y) * img.width + x) * 4, d = (y * img.width + x) * 4;
  f[d] = (px[s] / 255) * white; f[d + 1] = (px[s + 1] / 255) * white; f[d + 2] = (px[s + 2] / 255) * white; f[d + 3] = 1;
}
const tex = new THREE.DataTexture(f, img.width, img.height, THREE.RGBAFormat, THREE.FloatType);
tex.needsUpdate = true;
const rt = new THREE.WebGLRenderTarget(img.width, img.height, { type: THREE.HalfFloatType, depthBuffer: false, colorSpace: THREE.NoColorSpace, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
const blit = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { src: { value: tex } }, depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'uniform sampler2D src; varying vec2 vUv; void main(){ gl_FragColor = texture2D(src, vUv); }',
}));
const sc = new THREE.Scene(); sc.add(blit);
gl.setRenderTarget(rt);
gl.render(sc, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
const params = { ...(defaultsOf(SETTINGS).camcorder as unknown as CamcorderParams) };
for (const [k, v] of q) if (k in params && k !== 'bars') (params as unknown as Record<string, number>)[k] = Number(v);
const post = new CamcorderPost();
post.debugStage = stage === 'final' ? null : (stage as 'tone' | 'sharp' | 'finish');
post.debugTime = Number(q.get('t') ?? 75.61);
post.render(gl, rt, params, 1.71452, 1 / 60);
document.title = 'done';
