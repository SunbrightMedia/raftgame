import * as THREE from 'three';

/**
 * Source's camera, after game/client/viewpostprocess.cpp and the stdshaders
 * it drives (SDK 2013, the "new" tonemap algorithm Portal 2 uses):
 *
 * 1. Tonemap scale: the frame is Source-linear light × a scale, clamped to 1
 *    and written gamma-encoded (8-bit frame buffer, integer HDR).
 * 2. Auto exposure: a 16-bin luminance histogram (bins at (i/16)^1.5) of the
 *    centre 90%×85% of that frame. The scale is chosen so the brightest 2% of
 *    pixels sit at 60%, raised if needed so the median is at least 3%, then
 *    clamped to the map's range (env_tonemap_controller; 0.5–2 by default).
 * 3. Bloom, on the whole frame, no threshold: each pixel weighted by its own
 *    luminance (pow(c, 2.2) · lum, Downsample_nohdr), quarter resolution,
 *    a 13-tap Gaussian across and down (BlurFilter) × the bloom scale, added
 *    to the gamma-space frame (Engine_Post).
 * Input: this renderer's linear radiance; ÷ sourceUnit gives Source's light.
 */
export interface SourcePostParams {
  autoExposure: boolean;
  /** Tonemap scale when auto exposure is off. */
  scale: number;
  min: number;
  max: number;
  bloomScale: number;
  /** How fast the scale follows its goal (per second). ≥ 100 snaps (screenshots). */
  rate: number;
  /** Non-HDR path: encode with plain 2.2 gamma (no sRGB curve). */
  gamma22: boolean;
  percentBright: number;
  percentTarget: number;
  minAvgLum: number;
}

const QUAD = new THREE.PlaneGeometry(2, 2);
const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(QUAD, mat));
  return { scene, mat };
}

const SRGB = /* glsl */ `
  vec3 toGamma(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }`;

const METER_W = 96, METER_H = 72;
const BINS = 16;

export class SourcePost {
  /** Current tonemap scale. */
  scale = 1;
  private goal = 1;
  private frames = 0;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private ldr: THREE.WebGLRenderTarget | null = null;
  private small0: THREE.WebGLRenderTarget | null = null;
  private small1: THREE.WebGLRenderTarget | null = null;
  private meter = new THREE.WebGLRenderTarget(METER_W, METER_H, { depthBuffer: false, type: THREE.UnsignedByteType, colorSpace: THREE.NoColorSpace });
  private meterBuf = new Uint8Array(METER_W * METER_H * 4);
  private tonemap = pass(/* glsl */ `
    uniform sampler2D src; uniform float k; uniform float g22; varying vec2 vUv;
    ${SRGB}
    void main() {
      vec4 c = texture2D(src, vUv);
      vec3 v = clamp(c.rgb * k, 0.0, 1.0);
      gl_FragColor = vec4(g22 > 0.5 ? pow(v, vec3(1.0 / 2.2)) : toGamma(v), c.a);
    }`,
  { src: { value: null }, k: { value: 1 }, g22: { value: 0 } });
  // Histogram input: the centre region's luminance (gamma space, as the lumcompare test sees the frame buffer).
  private meterPass = pass(/* glsl */ `
    uniform sampler2D src; varying vec2 vUv;
    void main() {
      vec2 uv = vec2(0.05, 0.075) + vUv * vec2(0.9, 0.85);
      float l = dot(texture2D(src, uv).rgb, vec3(0.3, 0.59, 0.11));
      gl_FragColor = vec4(l, l, l, 1.0);
    }`, { src: { value: null } });
  // Downsample_nohdr: four bilinear taps (each a 2×2 average) over the 4×4 block, each shaped by its luminance.
  private down = pass(/* glsl */ `
    uniform sampler2D src; uniform vec2 texel; varying vec2 vUv;
    vec3 shape(vec2 uv) { vec3 p = texture2D(src, uv).rgb; float lum = dot(p, vec3(0.3, 0.59, 0.11)); return pow(p, vec3(2.2)) * lum; }
    void main() {
      vec2 o = vUv - 1.0 * texel;
      vec3 c = shape(o) + shape(o + vec2(2.0, 0.0) * texel) + shape(o + vec2(0.0, 2.0) * texel) + shape(o + vec2(2.0, 2.0) * texel);
      gl_FragColor = vec4(c * 0.25, 1.0);
    }`, { src: { value: null }, texel: { value: new THREE.Vector2() } });
  // BlurFilterX/Y: 13 taps.
  private blur = pass(/* glsl */ `
    uniform sampler2D src; uniform vec2 dir; uniform float amount; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(src, vUv).rgb * 0.2013;
      c += (texture2D(src, vUv + dir * 1.3366).rgb + texture2D(src, vUv - dir * 1.3366).rgb) * 0.2185;
      c += (texture2D(src, vUv + dir * 3.4295).rgb + texture2D(src, vUv - dir * 3.4295).rgb) * 0.0821;
      c += (texture2D(src, vUv + dir * 5.4264).rgb + texture2D(src, vUv - dir * 5.4264).rgb) * 0.0461;
      c += (texture2D(src, vUv + dir * 7.4359).rgb + texture2D(src, vUv - dir * 7.4359).rgb) * 0.0262;
      c += (texture2D(src, vUv + dir * 9.4436).rgb + texture2D(src, vUv - dir * 9.4436).rgb) * 0.0162;
      c += (texture2D(src, vUv + dir * 11.4401).rgb + texture2D(src, vUv - dir * 11.4401).rgb) * 0.0102;
      gl_FragColor = vec4(c * amount, 1.0);
    }`, { src: { value: null }, dir: { value: new THREE.Vector2() }, amount: { value: 1 } });
  // Engine_Post: frame + bloom, in gamma space.
  // `linear` = 1: the picture goes on to another camera (the old one, laid over this), so it is given as linear light
  // again (1 = white; a lamp with its bloom may pass 1), with the frame's own alpha (which marks the light sources).
  private composite = pass(/* glsl */ `
    uniform sampler2D frame; uniform sampler2D bloom; uniform float bloomOn; uniform float linear; uniform float g22; varying vec2 vUv;
    vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
    void main() {
      vec4 f = texture2D(frame, vUv);
      vec3 c = max(f.rgb + bloomOn * texture2D(bloom, vUv).rgb, 0.0);
      gl_FragColor = linear > 0.5 ? vec4(g22 > 0.5 ? pow(c, vec3(2.2)) : toLinear(c), f.a) : vec4(c, 1.0);
    }`,
  { frame: { value: null }, bloom: { value: null }, bloomOn: { value: 1 }, linear: { value: 0 }, g22: { value: 0 } });

  private ensure(w: number, h: number): void {
    if (this.ldr && this.ldr.width === w && this.ldr.height === h) return;
    this.ldr?.dispose(); this.small0?.dispose(); this.small1?.dispose();
    const opts = { depthBuffer: false, colorSpace: THREE.NoColorSpace, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false } as const;
    this.ldr = new THREE.WebGLRenderTarget(w, h, { ...opts, type: THREE.UnsignedByteType });
    const sw = Math.max(1, Math.floor(w / 4)), sh = Math.max(1, Math.floor(h / 4));
    this.small0 = new THREE.WebGLRenderTarget(sw, sh, { ...opts, type: THREE.HalfFloatType });
    this.small1 = new THREE.WebGLRenderTarget(sw, sh, { ...opts, type: THREE.HalfFloatType });
  }

  private draw(gl: THREE.WebGLRenderer, p: { scene: THREE.Scene }, target: THREE.WebGLRenderTarget | null): void {
    gl.setRenderTarget(target);
    gl.render(p.scene, this.cam);
  }

  /** CLuminanceHistogramSystem::FindLocationOfPercentBrightPixels (new algorithm). */
  static findLocation(hist: number[], edges: number[], percentBright: number, snapTarget = -1): number {
    const total = hist.reduce((a, b) => a + b, 0);
    if (!total) return -1;
    let rangeTested = 0, pixelsTested = 0;
    for (let i = BINS - 1; i >= 0; i--) {
      const needed = percentBright / 100 - pixelsTested;
      const share = hist[i] / total;
      const range = edges[i + 1] - edges[i];
      if (share >= needed) {
        if (snapTarget >= 0 && edges[i] <= snapTarget / 100 && edges[i + 1] >= snapTarget / 100) return snapTarget / 100;
        const border = 1 - (rangeTested + range * (needed / share));
        return Math.max(edges[i], Math.min(edges[i + 1], border));
      }
      pixelsTested += share;
      rangeTested += range;
    }
    return -1;
  }

  /** The goal tonemap scale from the frame just drawn (GetTargetTonemapScalar). */
  private meterGoal(gl: THREE.WebGLRenderer, p: SourcePostParams): number {
    this.meterPass.mat.uniforms.src.value = this.ldr!.texture;
    this.draw(gl, this.meterPass, this.meter);
    gl.readRenderTargetPixels(this.meter, 0, 0, METER_W, METER_H, this.meterBuf);
    const edges = Array.from({ length: BINS + 1 }, (_, i) => Math.pow(i / BINS, 1.5));
    const hist = new Array<number>(BINS).fill(0);
    for (let i = 0; i < METER_W * METER_H; i++) {
      const l = this.meterBuf[i * 4] / 255;
      let b = 0;
      while (b < BINS - 1 && l >= edges[b + 1]) b++;
      hist[b]++;
    }
    let loc = SourcePost.findLocation(hist, edges, p.percentBright, p.percentTarget);
    if (loc < 0) loc = p.percentTarget / 100;
    loc = Math.max(0.0001, loc);
    let target = (p.percentTarget / 100) / loc;
    const avg = SourcePost.findLocation(hist, edges, 50);
    if (avg > 0) target = Math.max(target, (p.minAvgLum / 100) / avg);
    return Math.max(0.001, target * this.scale);
  }

  /** `linearOut`: write linear light (for a camera pass that follows) and not the finished gamma picture. */
  render(gl: THREE.WebGLRenderer, src: THREE.WebGLRenderTarget, out: THREE.WebGLRenderTarget | null, sourceUnit: number, p: SourcePostParams, dt: number, linearOut = false): void {
    this.ensure(src.width, src.height);
    const tm = this.tonemap.mat.uniforms;
    tm.src.value = src.texture;
    tm.g22.value = p.gamma22 ? 1 : 0;
    const draw = () => { tm.k.value = this.scale / sourceUnit; this.draw(gl, this.tonemap, this.ldr); };
    if (!p.autoExposure) { this.scale = this.goal = p.scale; draw(); }
    else if (p.rate >= 100) {
      // Screenshots: settle on the exposure Source converges to for this view.
      for (let it = 0; it < 8; it++) {
        draw();
        this.goal = Math.min(p.max, Math.max(p.min, this.meterGoal(gl, p)));
        if (Math.abs(this.goal - this.scale) < 1e-3 * this.scale) break;
        this.scale = this.goal;
      }
      draw();
    } else {
      // Play: meter the frame, ease towards the goal (seen from the next frame on). The meter is read back from the
      // graphics card, which makes the program wait for it: so only every fourth frame (exposure moves slowly anyway).
      draw();
      if (this.frames++ % 4 === 0) this.goal = Math.min(p.max, Math.max(p.min, this.meterGoal(gl, p)));
      this.scale += (this.goal - this.scale) * Math.min(1, p.rate * dt);
    }
    const s0 = this.small0!, s1 = this.small1!;
    const bloomOn = p.bloomScale > 0;
    if (bloomOn) {
      this.down.mat.uniforms.src.value = this.ldr!.texture;
      this.down.mat.uniforms.texel.value.set(1 / src.width, 1 / src.height);
      this.draw(gl, this.down, s0);
      const b = this.blur.mat.uniforms;
      b.src.value = s0.texture; b.dir.value.set(1 / s0.width, 0); b.amount.value = 1;
      this.draw(gl, this.blur, s1);
      b.src.value = s1.texture; b.dir.value.set(0, 1 / s1.height); b.amount.value = p.bloomScale;
      this.draw(gl, this.blur, s0);
    }
    const c = this.composite.mat.uniforms;
    c.frame.value = this.ldr!.texture; c.bloom.value = s0.texture; c.bloomOn.value = bloomOn ? 1 : 0;
    c.linear.value = linearOut ? 1 : 0; c.g22.value = p.gamma22 ? 1 : 0;
    this.draw(gl, this.composite, out);
  }
}
