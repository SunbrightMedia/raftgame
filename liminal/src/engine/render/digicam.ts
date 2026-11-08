import * as THREE from 'three';
import { kelvinToLinear } from '../light/units';

/**
 * The camera: turns scene radiance (linear, cd/m²) into an sRGB image the
 * way a 2001–2006 consumer point-and-shoot did (STYLE.md, "The medium").
 *
 * 1. Exposure. Auto: meter the frame (centre-weighted log average) and expose
 *    so the average lands on mid-grey, adapting over time; or a manual EV100.
 * 2. Lens glare: every bright point is spread by the lens's point-spread
 *    function, a sharp core with a long faint tail, in proportion to its
 *    energy (Spencer et al., "Physically-Based Glare Effects for Digital
 *    Images", SIGGRAPH 1995). Computed with the progressive downsample /
 *    upsample chain from Jimenez, "Next Generation Post Processing in Call of
 *    Duty: Advanced Warfare" (SIGGRAPH 2014): 13-tap downsample with a
 *    luminance-weighted ("Karis") average on the first level so tiny bright
 *    pixels don't flicker, tent-filter upsample, energy-conserving mix.
 *    No threshold and no clamp: a distant lamp covering a few pixels makes a
 *    small faint halo, a close one a large strong one.
 * 3. White balance in kelvin.
 * 4. Sensor response: linear, then a short shoulder into clipped near-white.
 * 5. sRGB encoding.
 * 6. Recording (second pass): stored as luma + chroma like video and JPEG:
 *    softer horizontally, edge enhancement, chroma at lower bandwidth, warm
 *    colours pushed, magenta-lifted blacks, banding, noise.
 * Artifacts appear only where the real camera makes them (fringing only at
 * blown edges, etc.). Barrel distortion and fisheye are optional.
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
  glare: number;
  glareSpread: number;
  fringe: number;
  edgeDark: number;
  brightness: number;
  contrast: number;
  blackCrush: number;
  aberration: number;
  softness: number;
  softnessH: number;
  sharpen: number;
  chromaBlur: number;
  warmSaturation: number;
  shadowTint: number;
  blownTint: number;
  knee: number;
  rolloff: number;
  blackStretch: number;
  surfaceHue: number;
  grain: number;
  grainSize: number;
  lampGlow: number;
  tint: number;
  fisheye: number;
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
const GLARE_LEVELS = 6;

export class Digicam {
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private meter = new THREE.WebGLRenderTarget(METER_W, METER_H, { depthBuffer: false, type: THREE.FloatType, colorSpace: THREE.NoColorSpace });
  private meterBuf = new Float32Array(METER_W * METER_H * 4);
  private meterPass;
  private downPass;
  private upPass;
  private developPass;
  private encodePass;
  private developed: THREE.WebGLRenderTarget | null = null;
  private frame = 0;
  private last = performance.now();
  private target = 0.05;
  /** Current exposure multiplier (radiance → 0..1 scene-referred). */
  exposure = 0.05;

  constructor() {
    this.meterPass = pass(/* glsl */ `
      uniform sampler2D src; uniform vec2 cell; varying vec2 vUv;
      void main() {
        float s = 0.0;
        for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) {
          vec2 o = (vec2(float(i), float(j)) + 0.5) / 4.0 - 0.5;
          vec3 c = texture2D(src, vUv + o * cell).rgb;
          s += log(max(1e-4, dot(c, vec3(0.2126, 0.7152, 0.0722))));
        }
        gl_FragColor = vec4(s / 16.0, 0.0, 0.0, 1.0);
      }`, { src: { value: null }, cell: { value: new THREE.Vector2(1 / METER_W, 1 / METER_H) } });
    // Jimenez 2014 13-tap downsample: five overlapping 2×2 boxes, weighted.
    this.downPass = pass(/* glsl */ `
      uniform sampler2D src; uniform vec2 texel; uniform float karis, srcBoost; varying vec2 vUv;
      // First level: light sources (alpha 1) count srcBoost× more, so lamps and
      // panels glow without every bright wall glowing too.
      vec3 s(vec2 o) { vec4 t = texture2D(src, vUv + o * texel); return min(t.rgb * (1.0 + srcBoost * t.a * karis), vec3(60000.0)); }
      float w(vec3 c) { return karis > 0.5 ? 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722)) * 0.02) : 1.0; }
      vec3 box(vec3 a, vec3 b, vec3 c, vec3 d) {
        // Karis average on the first level: luminance-weighted so a single very
        // bright pixel can't flicker in and out as the camera moves.
        float wa = w(a), wb = w(b), wc = w(c), wd = w(d);
        return (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
      }
      void main() {
        vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
        vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0, 0.0)), f = s(vec2(2.0, 0.0));
        vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
        vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
        vec3 r = box(j, k, l, m) * 0.5
               + (box(a, b, d, e) + box(b, c, e, f) + box(d, e, g, h) + box(e, f, h, i)) * 0.125;
        gl_FragColor = vec4(r, 1.0);
      }`, { src: { value: null }, texel: { value: new THREE.Vector2() }, karis: { value: 0 }, srcBoost: { value: 0 } });
    // 3×3 tent upsample of the coarser level, added to this level: the sum of
    // all levels approximates the lens's sharp-core-long-tail spread.
    this.upPass = pass(/* glsl */ `
      uniform sampler2D coarse; uniform sampler2D fine; uniform vec2 texel; uniform float spread; varying vec2 vUv;
      void main() {
        vec3 t = texture2D(coarse, vUv).rgb * 4.0;
        t += (texture2D(coarse, vUv + vec2(texel.x, 0.0)).rgb + texture2D(coarse, vUv - vec2(texel.x, 0.0)).rgb
            + texture2D(coarse, vUv + vec2(0.0, texel.y)).rgb + texture2D(coarse, vUv - vec2(0.0, texel.y)).rgb) * 2.0;
        t += texture2D(coarse, vUv + texel).rgb + texture2D(coarse, vUv - texel).rgb
           + texture2D(coarse, vUv + vec2(texel.x, -texel.y)).rgb + texture2D(coarse, vUv + vec2(-texel.x, texel.y)).rgb;
        gl_FragColor = vec4(texture2D(fine, vUv).rgb + t / 16.0 * spread, 1.0);
      }`, { coarse: { value: null }, fine: { value: null }, texel: { value: new THREE.Vector2() }, spread: { value: 0.65 } });
    // Sensor: lens geometry, exposure, glare, white balance, fringing, the
    // highlight response, sRGB.
    this.developPass = pass(/* glsl */ `
      uniform sampler2D src; uniform sampler2D glare; uniform vec2 texel; uniform vec3 wb; uniform float aspect;
      uniform float gain, clip, saturation, artifacts, glareAmt, glareNorm, fringe, fringeWidth, aberration, vignette, fisheye, blownTint, knee, rolloff, blackStretch, surfaceHue, softness, sharpen, edgeDark, brightnessOut, contrast, blackCrush;
      varying vec2 vUv;
      vec3 tap(vec2 uv) {
        vec2 d = (uv - 0.5) * aberration * 0.006;
        return vec3(texture2D(src, uv + d).r, texture2D(src, uv).g, texture2D(src, uv - d).b);
      }
      vec3 soft(vec2 uv, float r) {
        vec2 o = texel * r;
        return (tap(uv) * 4.0 + tap(uv + vec2(o.x, 0.0)) + tap(uv - vec2(o.x, 0.0)) + tap(uv + vec2(0.0, o.y)) + tap(uv - vec2(0.0, o.y))) / 8.0;
      }
      float lumAt(vec2 uv) { return dot(texture2D(src, uv).rgb * gain * wb, vec3(0.2126, 0.7152, 0.0722)); }
      float blown(vec2 uv) { return smoothstep(clip, clip * 1.6, lumAt(uv)); }
      // Brightness of light sources only (the world shader writes alpha = 1 on them).
      float srcLumAt(vec2 uv) { vec4 t = texture2D(src, uv); return dot(t.rgb * gain * wb, vec3(0.2126, 0.7152, 0.0722)) * t.a; }
      // Video "knee": above knee×clip, highlights are compressed logarithmically
      // so that \`rolloff\` more stops still fit below clip. A bright room seen
      // from a dim one stays readable instead of flashing white; only lamps,
      // far brighter, actually clip.
      float shoulder(float m) {
        float k = knee * clip;
        if (m <= k) return m;
        // rolloff 1 = the original short shoulder; higher keeps more stops of
        // highlight detail before white (brighter rooms next door stay readable).
        return k + (clip - k) * (1.0 - exp(-(m - k) / max(0.001, (clip - k) * rolloff)));
      }
      vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      // Barrel distortion (Brown's radial model, r' = r(1 + k r²)), normalised so
      // the frame's corners stay put: edges squeeze in, the centre swells.
      vec2 lens(vec2 uv) {
        if (fisheye <= 0.0) return uv;
        vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
        float rmax2 = 0.25 * (aspect * aspect + 1.0);
        p *= (1.0 + fisheye * dot(p, p) / rmax2) / (1.0 + fisheye);
        return p / vec2(aspect, 1.0) + 0.5;
      }
      void main() {
        vec2 uv = lens(vUv);
        vec3 c;
        if (artifacts > 0.5) {
          // Softness + sharpening on the raw (HDR) image, as before the green-glow
          // fix: beside a blown lamp the undershoot drops to a hard dark cutoff,
          // which is what makes the lamp edge (and its purple fringe) read sharp.
          // Done on luminance and applied as a gain, so hue can't shift (the
          // per-channel version turned amber halos green).
          vec3 base = soft(uv, softness), wide = soft(uv, softness + 1.5);
          float yb = dot(base, vec3(0.2126, 0.7152, 0.0722)), yw = dot(wide, vec3(0.2126, 0.7152, 0.0722));
          c = base * (max(0.0, yb + (yb - yw) * sharpen) / max(yb, 1e-6));
        } else {
          c = texture2D(src, uv).rgb;
        }
        // Lens glare: energy-conserving mix with the spread image (linear radiance).
        c = mix(c, texture2D(glare, uv).rgb * glareNorm, glareAmt);
        c *= gain * wb;
        if (artifacts > 0.5) {
          vec2 v0 = vUv - 0.5;
          c *= 1.0 - vignette * dot(v0, v0) * 1.6;
          // Lamp edge, as in the reference footage: blown core, a SHARP DARK line
          // hugging it (fixed ~1 px, so it shows near and far, and is applied
          // after the glare so the glow can't fill it in), then the purple fringe
          // just outside (the original fringe, which the user picked).
          float self = smoothstep(clip * 0.7, clip, lumAt(uv));
          float near = 0.0, nb = 0.0;
          for (int i = 0; i < 8; i++) {
            vec2 dir = vec2(cos(float(i) * 0.785398), sin(float(i) * 0.785398)) * texel;
            near = max(near, smoothstep(clip, clip * 1.6, srcLumAt(uv + dir * 1.1)));
            nb = max(nb, smoothstep(clip, clip * 1.6, srcLumAt(uv + dir * 2.4)));
          }
          float ring = edgeDark * near * (1.0 - self);
          c *= 1.0 - ring;
          c += vec3(0.55, 0.25, 1.0) * fringe * nb * (1.0 - self) * (1.0 - ring);
        }
        // Sensor response, hue-preserving: compress by the brightest channel so an
        // overexposed glow keeps its hue instead of sliding through yellow
        // (per-channel clipping). Far past clip it goes nearly white, keeping a
        // trace of its colour (blownTint): footage of warm troffers clips cream.
        float m = max(c.r, max(c.g, c.b));
        // Black stretch: video cameras lift the darkest tones so a dim room next
        // door isn't a black hole (hue-preserving gain, fading out by ~quarter clip).
        c *= 1.0 + blackStretch * (1.0 - smoothstep(0.0, 0.25 * clip, m));
        m = max(c.r, max(c.g, c.b));
        c *= shoulder(m) / max(m, 1e-6);
        // Only light sources (alpha 1) go fully white; an overexposed surface
        // (neon carpet, a lit tabletop) keeps most of its colour (surfaceHue).
        float isLamp = texture2D(src, uv).a;
        c = mix(c, vec3(clip), smoothstep(clip * 1.2, clip * 4.0, m) * (1.0 - mix(surfaceHue, blownTint, isLamp)));
        c = min(c / clip, vec3(1.0));
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = max(vec3(0.0), mix(vec3(lum), c, saturation));
        // The camera's picture style, on the encoded image (so auto exposure
        // can't undo it): brightness as a midtone gamma, contrast as an S-curve
        // per channel around mid-grey (as camera "contrast" settings do, which
        // also adds a little saturation), then the black point.
        vec3 o = toSRGB(c);
        o = pow(max(o, vec3(0.0)), vec3(exp2(-brightnessOut)));
        if (contrast != 1.0) {
          vec3 lo = 0.5 * pow(2.0 * o, vec3(contrast));
          vec3 hi = 1.0 - 0.5 * pow(2.0 * (1.0 - o), vec3(contrast));
          o = mix(lo, hi, step(0.5, o));
        }
        o = max(vec3(0.0), (o - blackCrush) / max(0.01, 1.0 - blackCrush));
        gl_FragColor = vec4(o, 1.0);
      }`, {
      src: { value: null }, glare: { value: null }, texel: { value: new THREE.Vector2() }, wb: { value: new THREE.Vector3(1, 1, 1) }, aspect: { value: 1 },
      gain: { value: 1 }, clip: { value: 1 }, saturation: { value: 1 }, artifacts: { value: 1 }, glareAmt: { value: 0 }, glareNorm: { value: 1 },
      fringe: { value: 0 }, fringeWidth: { value: 2 }, aberration: { value: 0 }, vignette: { value: 0 }, fisheye: { value: 0 }, blownTint: { value: 0 }, softness: { value: 0 }, sharpen: { value: 0 }, edgeDark: { value: 0 }, brightnessOut: { value: 0 }, contrast: { value: 1 }, blackCrush: { value: 0 }, knee: { value: 0.55 }, rolloff: { value: 2.5 }, blackStretch: { value: 0 }, surfaceHue: { value: 0 },
    });
    // Recording: the picture as a video/JPEG encoder stores it, as luma + chroma.
    // (ntsc-rs's signal model as reference, not its tape damage.) Luma gets lens
    // softness (more horizontally), then edge enhancement with capped halos. Chroma has a fraction of luma's horizontal
    // bandwidth, so colour bleeds sideways past edges.
    this.encodePass = pass(/* glsl */ `
      uniform sampler2D src; uniform vec2 texel;
      uniform float artifacts, softness, softH, sharpen, sharpenLimit, chroma, warmSat, shadowTint, banding, noise, grain, grainSize, blackLift, seed;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453); }
      float Y(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
      // Gaussian luma blur, sigma ≈ half the given radius (matching the old
      // 5-tap lens softness): 7 taps across, 3 down.
      float lumaBlur(vec2 uv, float sx, float sy) {
        float t = 0.0, w = 0.0;
        for (int i = -3; i <= 3; i++) for (int j = -1; j <= 1; j++) {
          vec2 o = vec2(float(i) * sx / 3.0, float(j) * sy * 0.5);
          float k = exp(-0.5 * (float(i * i) / 2.25 + float(j * j)));
          t += Y(texture2D(src, uv + o * texel).rgb) * k; w += k;
        }
        return t / w;
      }
      void main() {
        vec4 a = texture2D(src, vUv);
        vec3 c = a.rgb;
        if (artifacts > 0.5) {
          // Softness and sharpening happen in the develop pass; here only the
          // optional extra horizontal softness of video.
          float y = softH > 0.0 ? lumaBlur(vUv, softH, 0.0) : Y(c);
          float detail = 0.0;
          // Chroma: horizontal low-pass.
          vec2 cc = vec2(0.0); float w = 0.0;
          for (int i = -4; i <= 4; i++) {
            float k = exp(-0.5 * float(i * i) / 4.0);
            vec3 s = texture2D(src, vUv + vec2(float(i) * chroma * 0.5, 0.0) * texel).rgb;
            float sy = Y(s);
            cc += vec2(s.b - sy, s.r - sy) * k; w += k;
          }
          cc /= w;
          y += detail;
          c = vec3(y + cc.y, y - (0.299 * cc.y + 0.114 * cc.x) / 0.587, y + cc.x);
          // Colour response: reds, oranges and yellows pushed harder than the rest.
          float yy = Y(c);
          float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
          float warm = smoothstep(0.0, 0.25, mx - mn) * clamp((c.r - c.b) / max(mx - mn, 1e-4), 0.0, 1.0);
          c = max(vec3(0.0), mix(vec3(yy), c, 1.0 + warmSat * warm));
          // Lifted blacks, tinted magenta.
          vec3 lift = blackLift * mix(vec3(1.0), vec3(1.25, 0.55, 1.2), shadowTint);
          c = lift + c * (1.0 - lift);
          vec2 px = floor(vUv / texel);
          vec3 n = vec3(hash(px), hash(px + 17.0), hash(px + 41.0)) - 0.5;
          float yl = Y(c);
          c += (n - dot(n, vec3(0.333))) * noise * (1.0 - yl) * 0.25 + (hash(px + 7.0) - 0.5) * noise * 0.03;
          // Film grain: clumpy, a little colour, the same strength at every brightness.
          if (grain > 0.0) {
            vec2 gp = floor(vUv / texel / grainSize);
            vec3 gn = vec3(hash(gp + 3.1), hash(gp + 9.7), hash(gp + 23.3)) - 0.5;
            float gl = hash(gp + 51.9) - 0.5;
            c += (gl * 0.8 + (gn - dot(gn, vec3(0.333))) * 0.5) * grain * 0.35;
          }
          if (banding > 1.0) c = floor(c * banding + 0.5) / banding;
        }
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`, {
      src: { value: null }, texel: { value: new THREE.Vector2() },
      artifacts: { value: 1 }, softness: { value: 0 }, softH: { value: 0 }, sharpen: { value: 0 }, sharpenLimit: { value: 0 },
      chroma: { value: 0 }, warmSat: { value: 0 }, shadowTint: { value: 0 }, banding: { value: 0 }, noise: { value: 0 }, grain: { value: 0 }, grainSize: { value: 1.6 }, blackLift: { value: 0 }, seed: { value: 0 },
    });
  }

  private ensure(w: number, h: number): void {
    const w0 = Math.max(1, w >> 1), h0 = Math.max(1, h >> 1);
    if (this.down[0] && this.down[0].width === w0 && this.down[0].height === h0) return;
    for (const t of [...this.down, ...this.up]) t.dispose();
    this.down = []; this.up = [];
    for (let i = 0; i < GLARE_LEVELS; i++) {
      const mk = () => new THREE.WebGLRenderTarget(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1)),
        { depthBuffer: false, colorSpace: THREE.NoColorSpace, type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      this.down.push(mk()); this.up.push(mk());
    }
  }

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
      let sum = 0, wsum = 0;
      for (let y = 0; y < METER_H; y++) for (let x = 0; x < METER_W; x++) {
        const dx = (x + 0.5) / METER_W - 0.5, dy = (y + 0.5) / METER_H - 0.5;
        const w = Math.exp(-(dx * dx + dy * dy) * 6);
        sum += this.meterBuf[(y * METER_W + x) * 4] * w; wsum += w;
      }
      const avgL = Math.exp(sum / wsum);
      const key = 0.18 * Math.pow(2, p.evComp);
      const lo = 1 / (1.2 * Math.pow(2, 17)), hi = 1 / (1.2 * Math.pow(2, 1));
      this.target = Math.min(hi, Math.max(lo, key / Math.max(1e-4, avgL)));
    }
    const k = 1 - Math.exp(-dt * p.adaptSpeed);
    this.exposure = Math.exp(Math.log(this.exposure) + (Math.log(this.target) - Math.log(this.exposure)) * k);
  }

  render(gl: THREE.WebGLRenderer, src: THREE.WebGLRenderTarget, out: THREE.WebGLRenderTarget | null, p: CameraParams): void {
    this.autoExpose(gl, src, p);
    const w = kelvinToLinear(p.whiteBalanceK);
    const wb = new THREE.Vector3(1 / w[0], 1 / w[1], 1 / w[2]);
    // Tint: the green–magenta axis of white balance (+ = magenta, − = green).
    wb.y *= Math.pow(2, -p.tint * 0.5);
    wb.multiplyScalar(1 / (0.2126 * wb.x + 0.7152 * wb.y + 0.0722 * wb.z));

    const f = this.developPass.mat.uniforms;
    if (p.glare > 0) {
      this.ensure(src.width, src.height);
      // Downsample chain.
      let input: THREE.WebGLRenderTarget = src;
      for (let i = 0; i < GLARE_LEVELS; i++) {
        const u = this.downPass.mat.uniforms;
        u.src.value = input.texture; u.texel.value.set(1 / input.width, 1 / input.height); u.karis.value = i === 0 ? 1 : 0; u.srcBoost.value = p.lampGlow;
        gl.setRenderTarget(this.down[i]); gl.render(this.downPass.scene, this.cam);
        input = this.down[i];
      }
      // Upsample and accumulate, coarsest to finest.
      let coarse: THREE.WebGLRenderTarget = this.down[GLARE_LEVELS - 1];
      for (let i = GLARE_LEVELS - 2; i >= 0; i--) {
        const u = this.upPass.mat.uniforms;
        u.coarse.value = coarse.texture; u.fine.value = this.down[i].texture;
        u.texel.value.set(1 / coarse.width, 1 / coarse.height); u.spread.value = p.glareSpread;
        gl.setRenderTarget(this.up[i]); gl.render(this.upPass.scene, this.cam);
        coarse = this.up[i];
      }
      f.glare.value = this.up[0].texture;
      // Normalise the summed levels so the glare image carries the frame's energy.
      let norm = 0;
      for (let i = 0; i < GLARE_LEVELS; i++) norm += Math.pow(p.glareSpread, i);
      f.glareNorm.value = 1 / norm;
    }
    if (!this.developed || this.developed.width !== src.width || this.developed.height !== src.height) {
      this.developed?.dispose();
      this.developed = new THREE.WebGLRenderTarget(src.width, src.height, { depthBuffer: false, colorSpace: THREE.NoColorSpace, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    }
    f.src.value = src.texture;
    f.texel.value.set(1 / src.width, 1 / src.height);
    f.aspect.value = src.width / src.height;
    f.wb.value.copy(wb);
    f.gain.value = this.exposure; f.clip.value = p.clip; f.saturation.value = p.saturation; f.artifacts.value = p.artifacts ? 1 : 0;
    f.glareAmt.value = Math.max(0, p.glare); f.fringe.value = p.fringe; f.softness.value = p.softness; f.sharpen.value = p.sharpen; f.edgeDark.value = p.edgeDark; f.brightnessOut.value = p.brightness; f.contrast.value = p.contrast; f.blackCrush.value = p.blackCrush; f.aberration.value = p.aberration;
    f.vignette.value = p.vignette; f.fisheye.value = p.fisheye; f.blownTint.value = p.blownTint; f.knee.value = p.knee; f.rolloff.value = p.rolloff; f.blackStretch.value = p.blackStretch; f.surfaceHue.value = p.surfaceHue;
    gl.setRenderTarget(this.developed);
    gl.render(this.developPass.scene, this.cam);

    const e = this.encodePass.mat.uniforms;
    e.src.value = this.developed.texture;
    e.texel.value.set(1 / src.width, 1 / src.height);
    e.artifacts.value = p.artifacts ? 1 : 0;
    e.softness.value = p.softness; e.softH.value = p.softnessH;
    e.sharpen.value = 0; e.sharpenLimit.value = 0;
    e.chroma.value = p.chromaBlur; e.warmSat.value = p.warmSaturation; e.shadowTint.value = p.shadowTint;
    e.banding.value = p.banding; e.noise.value = p.noise; e.grain.value = p.grain; e.grainSize.value = p.grainSize; e.blackLift.value = p.blackLift;
    e.seed.value = (this.frame++ % 997) * 0.731;
    gl.setRenderTarget(out);
    gl.render(this.encodePass.scene, this.cam);
  }
}
