import * as THREE from 'three';

/**
 * The "early digital camera" look (STYLE.md, "The medium"): the game is
 * meant to read like a photo from a 2001–2006 consumer compact.
 *
 *  - low dynamic range: highlights clip to flat cream and bleed a soft glow
 *  - purple/blue fringing where blown highlights meet darker edges
 *  - wrong auto white balance (tungsten amber, fluorescent green)
 *  - in-camera oversharpening halos on an otherwise soft image
 *  - noise-reduction/JPEG smear: banded gradients, softened fine detail
 *  - chroma noise and lifted milky blacks in the shadows, vignetting
 *
 * Runs on the low-res frame before it's upscaled. Every term is a setting.
 */
export interface DigicamParams {
  enabled: boolean;
  /** Pre-camera exposure gain. */
  gain: number;
  /** Where highlights start clipping (low = lower dynamic range). */
  clip: number;
  /** Glow around bright areas. */
  bloom: number;
  bloomThreshold: number;
  bloomRadius: number;
  /** Purple fringe around blown highlights. */
  fringe: number;
  /** Lateral chromatic aberration towards the frame edges. */
  aberration: number;
  /** White-balance cast multiplier (#rrggbb, neutral = #ffffff). */
  whiteBalance: string;
  saturation: number;
  /** Lens softness before sharpening (in pixels). */
  softness: number;
  /** In-camera sharpening amount (halos). */
  sharpen: number;
  /** Gradient banding from compression: levels per channel (0 = off). */
  banding: number;
  /** Chroma noise amount (mostly in shadows). */
  noise: number;
  /** Lifts the black point. */
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

export class Digicam {
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private bright: THREE.WebGLRenderTarget | null = null;
  private blurA: THREE.WebGLRenderTarget | null = null;
  private blurB: THREE.WebGLRenderTarget | null = null;
  private brightPass;
  private blurPass;
  private finalPass;
  private frame = 0;

  constructor() {
    this.brightPass = pass(/* glsl */ `
      uniform sampler2D src; uniform float threshold; uniform float gain; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(src, vUv).rgb * gain;
        float l = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c * smoothstep(threshold, threshold + 0.25, l), 1.0);
      }`, { src: { value: null }, threshold: { value: 0.8 }, gain: { value: 1 } });
    this.blurPass = pass(/* glsl */ `
      uniform sampler2D src; uniform vec2 dir; varying vec2 vUv;
      void main() {
        vec3 s = texture2D(src, vUv).rgb * 0.227;
        s += (texture2D(src, vUv + dir * 1.385).rgb + texture2D(src, vUv - dir * 1.385).rgb) * 0.316;
        s += (texture2D(src, vUv + dir * 3.231).rgb + texture2D(src, vUv - dir * 3.231).rgb) * 0.070;
        gl_FragColor = vec4(s, 1.0);
      }`, { src: { value: null }, dir: { value: new THREE.Vector2() } });
    this.finalPass = pass(/* glsl */ `
      uniform sampler2D src; uniform sampler2D glow; uniform vec2 texel;
      uniform float gain, clip, bloom, fringe, aberration, saturation, softness, sharpen, banding, noise, blackLift, vignette, seed;
      uniform vec3 wb;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453); }
      vec3 tap(vec2 uv) {
        // Lateral chromatic aberration: red and blue land slightly apart toward the edges.
        vec2 d = (uv - 0.5) * aberration * 0.006;
        return vec3(texture2D(src, uv + d).r, texture2D(src, uv).g, texture2D(src, uv - d).b);
      }
      vec3 soft(vec2 uv, float r) {
        vec2 o = texel * r;
        return (tap(uv) * 4.0 + tap(uv + vec2(o.x, 0.0)) + tap(uv - vec2(o.x, 0.0)) + tap(uv + vec2(0.0, o.y)) + tap(uv - vec2(0.0, o.y))) / 8.0;
      }
      void main() {
        // Lens softness, then the camera's unsharp mask on top of it: soft image, crisp halos.
        vec3 base = soft(vUv, softness);
        vec3 wide = soft(vUv, softness + 1.5);
        vec3 c = base + (base - wide) * sharpen;
        c *= gain * wb;
        // Glow from the blown areas, plus a purple fringe just outside them.
        vec3 g = texture2D(glow, vUv).rgb;
        float gl = max(g.r, max(g.g, g.b));
        float lum = dot(c, vec3(0.299, 0.587, 0.114));
        c += g * bloom;
        c += vec3(0.55, 0.25, 1.0) * fringe * max(0.0, gl - lum * 0.8) * (1.0 - smoothstep(0.6, 1.0, lum));
        // Low dynamic range: a short shoulder, then flat clipped highlights.
        // Linear up to the knee, then a short shoulder into flat clipped white.
        float knee = 0.72 * clip;
        vec3 over = max(c - knee, 0.0);
        c = min(c, vec3(knee)) + (clip - knee) * (1.0 - exp(-over / max(0.001, clip - knee)));
        c = min(c, vec3(1.0));
        lum = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(vec3(lum), c, saturation);
        // Milky blacks.
        c = blackLift + c * (1.0 - blackLift);
        // Chroma noise, strongest in the shadows.
        vec2 px = floor(vUv / texel);
        vec3 n = vec3(hash(px), hash(px + 17.0), hash(px + 41.0)) - 0.5;
        c += (n - dot(n, vec3(0.333))) * noise * (1.0 - lum) * 0.25 + (hash(px + 7.0) - 0.5) * noise * 0.04;
        // Compression banding in smooth gradients.
        if (banding > 1.0) c = floor(c * banding + 0.5) / banding;
        // Light falloff toward the corners.
        vec2 v = vUv - 0.5;
        c *= 1.0 - vignette * dot(v, v) * 1.6;
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`, {
      src: { value: null }, glow: { value: null }, texel: { value: new THREE.Vector2() }, wb: { value: new THREE.Vector3(1, 1, 1) },
      gain: { value: 1 }, clip: { value: 1 }, bloom: { value: 0 }, fringe: { value: 0 }, aberration: { value: 0 }, saturation: { value: 1 },
      softness: { value: 0 }, sharpen: { value: 0 }, banding: { value: 0 }, noise: { value: 0 }, blackLift: { value: 0 }, vignette: { value: 0 }, seed: { value: 0 },
    });
  }

  private ensure(w: number, h: number): void {
    const bw = Math.max(1, Math.round(w / 4)), bh = Math.max(1, Math.round(h / 4));
    if (this.bright && this.bright.width === bw && this.bright.height === bh) return;
    for (const t of [this.bright, this.blurA, this.blurB]) t?.dispose();
    const mk = () => new THREE.WebGLRenderTarget(bw, bh, { depthBuffer: false, colorSpace: THREE.NoColorSpace, type: THREE.HalfFloatType });
    this.bright = mk(); this.blurA = mk(); this.blurB = mk();
  }

  /**
   * Process `src` (the rendered frame) into `out` (null = screen; the caller
   * sets the viewport). Returns false if disabled.
   */
  render(gl: THREE.WebGLRenderer, src: THREE.WebGLRenderTarget, out: THREE.WebGLRenderTarget | null, p: DigicamParams): void {
    this.ensure(src.width, src.height);
    const bright = this.bright!, a = this.blurA!, b = this.blurB!;
    const bu = this.brightPass.mat.uniforms;
    bu.src.value = src.texture; bu.threshold.value = p.bloomThreshold; bu.gain.value = p.gain;
    gl.setRenderTarget(bright); gl.render(this.brightPass.scene, this.cam);
    // Two separable blur rounds; radius scales the tap spacing.
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
    const f = this.finalPass.mat.uniforms;
    const wb = new THREE.Color(p.whiteBalance);
    f.src.value = src.texture; f.glow.value = b.texture;
    f.texel.value.set(1 / src.width, 1 / src.height);
    f.wb.value.set(wb.r, wb.g, wb.b);
    f.gain.value = p.gain; f.clip.value = p.clip; f.bloom.value = p.bloom; f.fringe.value = p.fringe;
    f.aberration.value = p.aberration; f.saturation.value = p.saturation; f.softness.value = p.softness;
    f.sharpen.value = p.sharpen; f.banding.value = p.banding; f.noise.value = p.noise;
    f.blackLift.value = p.blackLift; f.vignette.value = p.vignette;
    f.seed.value = (this.frame++ % 997) * 0.731;
    gl.setRenderTarget(out);
    gl.render(this.finalPass.scene, this.cam);
  }
}
