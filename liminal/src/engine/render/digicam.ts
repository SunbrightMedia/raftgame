import * as THREE from 'three';
import { kelvinToLinear } from '../light/units';

/**
 * The camera: turns scene radiance (linear, cd/m²) into an sRGB image the
 * way a 2001–2006 consumer point-and-shoot did (STYLE.md, "The medium").
 *
 * 1. Exposure. Auto: meter the frame (centre-weighted log average) and expose
 *    so the average lands on mid-grey, adapting over time; or a manual EV100.
 *    This is why lamps blow out while the room stays readable.
 * 2. White balance in kelvin: light at the camera's white point comes out
 *    neutral; warmer light comes out amber.
 * 3. Sensor response: linear, then a short shoulder into flat clipped white
 *    (low dynamic range).
 * 4. sRGB encoding.
 * 5. Optional artifacts of the medium, applied only where the real camera
 *    produces them: glow and purple fringe around blown highlights, lens
 *    softness with sharpening halos, compression banding, shadow chroma noise,
 *    milky blacks, vignette. Never global "analog" filters.
 */
export interface CameraParams {
  autoExposure: boolean;
  evComp: number;
  manualEV: number;
  adaptSpeed: number;
  whiteBalanceK: number;
  clip: number;
  saturation: number;
  artifacts: boolean;
  bloom: number;
  bloomThreshold: number;
  bloomRadius: number;
  fringe: number;
  aberration: number;
  softness: number;
  sharpen: number;
  banding: number;
  noise: number;
  blackLift: number;
  vignette: number;
}

const QUAD = new THREE.PlaneGeometry(2, 2);
const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): { scene: THREE.Scene; mat: THREE.ShaderMaterial } {
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(QUAD, mat));
  return { scene, mat };
}

const METER_W = 24, METER_H = 16;

export class Digicam {
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private bright: THREE.WebGLRenderTarget | null = null;
  private blurA: THREE.WebGLRenderTarget | null = null;
  private blurB: THREE.WebGLRenderTarget | null = null;
  private meter = new THREE.WebGLRenderTarget(METER_W, METER_H, { depthBuffer: false, type: THREE.FloatType, colorSpace: THREE.NoColorSpace });
  private meterBuf = new Float32Array(METER_W * METER_H * 4);
  private meterPass;
  private brightPass;
  private blurPass;
  private finalPass;
  private frame = 0;
  private last = performance.now();
  /** Current exposure multiplier (radiance → 0..1 scene-referred). */
  exposure = 0.05;

  constructor() {
    this.meterPass = pass(/* glsl */ `
      uniform sampler2D src; uniform vec2 cell; varying vec2 vUv;
      void main() {
        // log-luminance of a 4×4 spread of samples in this cell
        float s = 0.0;
        for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) {
          vec2 o = (vec2(float(i), float(j)) + 0.5) / 4.0 - 0.5;
          vec3 c = texture2D(src, vUv + o * cell).rgb;
          s += log(max(1e-4, dot(c, vec3(0.2126, 0.7152, 0.0722))));
        }
        gl_FragColor = vec4(s / 16.0, 0.0, 0.0, 1.0);
      }`, { src: { value: null }, cell: { value: new THREE.Vector2(1 / METER_W, 1 / METER_H) } });
    this.brightPass = pass(/* glsl */ `
      uniform sampler2D src; uniform vec2 srcTexel; uniform float threshold; uniform float gain; uniform vec3 wb; varying vec2 vUv;
      vec3 bright(vec2 uv) {
        // Only the energy beyond the threshold glows: a lamp lens (far past white)
        // glows, a merely bright ceiling barely does.
        vec3 c = texture2D(src, uv).rgb * gain * wb;
        return min(max(c - threshold, 0.0), vec3(4.0));
      }
      void main() {
        // Average the whole 4×4 block this texel covers (four bilinear taps), so
        // small bright things like lamp lenses don't flicker in and out.
        vec2 o = srcTexel;
        gl_FragColor = vec4((bright(vUv + vec2(-o.x, -o.y)) + bright(vUv + vec2(o.x, -o.y)) + bright(vUv + vec2(-o.x, o.y)) + bright(vUv + vec2(o.x, o.y))) * 0.25, 1.0);
      }`, { src: { value: null }, srcTexel: { value: new THREE.Vector2() }, threshold: { value: 0.9 }, gain: { value: 1 }, wb: { value: new THREE.Vector3(1, 1, 1) } });
    this.blurPass = pass(/* glsl */ `
      uniform sampler2D src; uniform vec2 dir; varying vec2 vUv;
      void main() {
        vec3 s = texture2D(src, vUv).rgb * 0.227;
        s += (texture2D(src, vUv + dir * 1.385).rgb + texture2D(src, vUv - dir * 1.385).rgb) * 0.316;
        s += (texture2D(src, vUv + dir * 3.231).rgb + texture2D(src, vUv - dir * 3.231).rgb) * 0.070;
        gl_FragColor = vec4(s, 1.0);
      }`, { src: { value: null }, dir: { value: new THREE.Vector2() } });
    this.finalPass = pass(/* glsl */ `
      uniform sampler2D src; uniform sampler2D glow; uniform vec2 texel; uniform vec3 wb;
      uniform float gain, clip, saturation, artifacts, bloom, fringe, aberration, softness, sharpen, banding, noise, blackLift, vignette, seed;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453); }
      vec3 tap(vec2 uv) {
        vec2 d = (uv - 0.5) * aberration * 0.006;
        return vec3(texture2D(src, uv + d).r, texture2D(src, uv).g, texture2D(src, uv - d).b);
      }
      vec3 soft(vec2 uv, float r) {
        vec2 o = texel * r;
        return (tap(uv) * 4.0 + tap(uv + vec2(o.x, 0.0)) + tap(uv - vec2(o.x, 0.0)) + tap(uv + vec2(0.0, o.y)) + tap(uv - vec2(0.0, o.y))) / 8.0;
      }
      float lumAt(vec2 uv) { return dot(texture2D(src, uv).rgb * gain * wb, vec3(0.2126, 0.7152, 0.0722)); }
      vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      void main() {
        vec3 c;
        if (artifacts > 0.5) {
          // Lens softness, then the camera's unsharp mask on top: soft image, crisp halos.
          vec3 base = soft(vUv, softness), wide = soft(vUv, softness + 1.5);
          c = max(vec3(0.0), base + (base - wide) * sharpen);
        } else {
          c = texture2D(src, vUv).rgb;
        }
        // Exposure and white balance (linear, scene-referred). Vignetting is lens
        // light falloff, so it happens here, before the sensor clips: a blown lamp
        // in the corner stays white.
        c *= gain * wb;
        if (artifacts > 0.5) { vec2 v0 = vUv - 0.5; c *= 1.0 - vignette * dot(v0, v0) * 1.6; }
        if (artifacts > 0.5) {
          c += texture2D(glow, vUv).rgb * bloom;
          // Purple fringe: a thin line just outside blown highlights (sensor
          // blooming/lens fringing), checked at full resolution, not a haze.
          float self = smoothstep(clip * 0.7, clip, lumAt(vUv));
          float nb = 0.0;
          for (int i = 0; i < 8; i++) {
            float a = float(i) * 0.785398;
            nb = max(nb, smoothstep(clip, clip * 1.6, lumAt(vUv + vec2(cos(a), sin(a)) * texel * 1.6)));
          }
          c += vec3(0.55, 0.25, 1.0) * fringe * nb * (1.0 - self);
        }
        // Sensor response: linear to the knee, a short shoulder, flat clipped white.
        float knee = 0.72 * clip;
        vec3 over = max(c - knee, 0.0);
        c = min(c, vec3(knee)) + (clip - knee) * (1.0 - exp(-over / max(0.001, clip - knee)));
        c = min(c / clip, vec3(1.0));
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = max(vec3(0.0), mix(vec3(lum), c, saturation));
        c = toSRGB(c);
        if (artifacts > 0.5) {
          c = blackLift + c * (1.0 - blackLift);
          vec2 px = floor(vUv / texel);
          vec3 n = vec3(hash(px), hash(px + 17.0), hash(px + 41.0)) - 0.5;
          float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c += (n - dot(n, vec3(0.333))) * noise * (1.0 - y) * 0.25 + (hash(px + 7.0) - 0.5) * noise * 0.03;
          if (banding > 1.0) c = floor(c * banding + 0.5) / banding;
        }
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`, {
      src: { value: null }, glow: { value: null }, texel: { value: new THREE.Vector2() }, wb: { value: new THREE.Vector3(1, 1, 1) },
      gain: { value: 1 }, clip: { value: 1 }, saturation: { value: 1 }, artifacts: { value: 1 }, bloom: { value: 0 }, fringe: { value: 0 },
      aberration: { value: 0 }, softness: { value: 0 }, sharpen: { value: 0 }, banding: { value: 0 }, noise: { value: 0 },
      blackLift: { value: 0 }, vignette: { value: 0 }, seed: { value: 0 },
    });
  }

  private ensure(w: number, h: number): void {
    const bw = Math.max(1, Math.round(w / 4)), bh = Math.max(1, Math.round(h / 4));
    if (this.bright && this.bright.width === bw && this.bright.height === bh) return;
    for (const t of [this.bright, this.blurA, this.blurB]) t?.dispose();
    const mk = () => new THREE.WebGLRenderTarget(bw, bh, { depthBuffer: false, colorSpace: THREE.NoColorSpace, type: THREE.HalfFloatType });
    this.bright = mk(); this.blurA = mk(); this.blurB = mk();
  }

  /** Meter the frame (every few frames) and move exposure toward the target. */
  private autoExpose(gl: THREE.WebGLRenderer, src: THREE.WebGLRenderTarget, p: CameraParams): void {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (!p.autoExposure) {
      // Standard saturation-based exposure: H = 1 / (1.2 · 2^EV100).
      this.exposure = 1 / (1.2 * Math.pow(2, p.manualEV - p.evComp));
      return;
    }
    if (this.frame % 4 === 0) {
      this.meterPass.mat.uniforms.src.value = src.texture;
      gl.setRenderTarget(this.meter);
      gl.render(this.meterPass.scene, this.cam);
      gl.readRenderTargetPixels(this.meter, 0, 0, METER_W, METER_H, this.meterBuf);
      // Centre-weighted average, like a point-and-shoot's default metering.
      let sum = 0, wsum = 0;
      for (let y = 0; y < METER_H; y++) for (let x = 0; x < METER_W; x++) {
        const dx = (x + 0.5) / METER_W - 0.5, dy = (y + 0.5) / METER_H - 0.5;
        const w = Math.exp(-(dx * dx + dy * dy) * 6);
        sum += this.meterBuf[(y * METER_W + x) * 4] * w; wsum += w;
      }
      const avgL = Math.exp(sum / wsum);
      // Expose the average to mid-grey (0.18), within a consumer camera's range (EV100 1..14).
      const key = 0.18 * Math.pow(2, p.evComp);
      const lo = 1 / (1.2 * Math.pow(2, 14)), hi = 1 / (1.2 * Math.pow(2, 1));
      this.target = Math.min(hi, Math.max(lo, key / Math.max(1e-4, avgL)));
    }
    // Adapt in log space.
    const k = 1 - Math.exp(-dt * p.adaptSpeed);
    this.exposure = Math.exp(Math.log(this.exposure) + (Math.log(this.target) - Math.log(this.exposure)) * k);
  }
  private target = 0.05;

  render(gl: THREE.WebGLRenderer, src: THREE.WebGLRenderTarget, out: THREE.WebGLRenderTarget | null, p: CameraParams): void {
    this.autoExpose(gl, src, p);
    // White balance: light at the camera's white point comes out neutral.
    const w = kelvinToLinear(p.whiteBalanceK);
    const wb = new THREE.Vector3(1 / w[0], 1 / w[1], 1 / w[2]);
    const wl = 0.2126 * wb.x + 0.7152 * wb.y + 0.0722 * wb.z;
    wb.multiplyScalar(1 / wl);
    const gain = this.exposure;

    if (p.artifacts) {
      this.ensure(src.width, src.height);
      const bright = this.bright!, a = this.blurA!, b = this.blurB!;
      const bu = this.brightPass.mat.uniforms;
      bu.src.value = src.texture; bu.threshold.value = p.bloomThreshold * p.clip; bu.gain.value = gain; bu.wb.value.copy(wb);
      bu.srcTexel.value.set(1 / src.width, 1 / src.height);
      gl.setRenderTarget(bright); gl.render(this.brightPass.scene, this.cam);
      let input: THREE.WebGLRenderTarget = bright;
      const r = Math.max(0.25, p.bloomRadius);
      for (let i = 0; i < 2; i++) {
        const u = this.blurPass.mat.uniforms;
        u.src.value = input.texture; u.dir.value.set(r / bright.width, 0);
        gl.setRenderTarget(a); gl.render(this.blurPass.scene, this.cam);
        u.src.value = a.texture; u.dir.value.set(0, r / bright.height);
        gl.setRenderTarget(b); gl.render(this.blurPass.scene, this.cam);
        input = b;
      }
      this.finalPass.mat.uniforms.glow.value = b.texture;
    }
    const f = this.finalPass.mat.uniforms;
    f.src.value = src.texture;
    f.texel.value.set(1 / src.width, 1 / src.height);
    f.wb.value.copy(wb);
    f.gain.value = gain; f.clip.value = p.clip; f.saturation.value = p.saturation; f.artifacts.value = p.artifacts ? 1 : 0;
    f.bloom.value = p.bloom; f.fringe.value = p.fringe; f.aberration.value = p.aberration; f.softness.value = p.softness;
    f.sharpen.value = p.sharpen; f.banding.value = p.banding; f.noise.value = p.noise;
    f.blackLift.value = p.blackLift; f.vignette.value = p.vignette;
    f.seed.value = (this.frame++ % 997) * 0.731;
    gl.setRenderTarget(out);
    gl.render(this.finalPass.scene, this.cam);
  }
}
