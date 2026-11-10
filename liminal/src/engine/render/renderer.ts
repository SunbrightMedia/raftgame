import * as THREE from 'three';
import { Digicam, type CameraParams } from './digicam';
import { SourcePost, type SourcePostParams } from './sourcePost';

THREE.ColorManagement.enabled = false;
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

/**
 * Renders the scene at a low internal resolution into an offscreen target,
 * then upscales it to the window with nearest or linear filtering. That
 * resolution drop is a big part of the retro look, so it's a live setting.
 */
export class LowResRenderer {
  readonly gl: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  private target: THREE.WebGLRenderTarget | null = null;
  private blitScene = new THREE.Scene();
  private blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private blitMat: THREE.MeshBasicMaterial;
  internalHeight = 480;
  /** MSAA samples on the internal render (0 = off). Smooths geometry edges. */
  msaa = 4;
  /** The camera: exposure, white balance, response, sRGB, the medium's artifacts. */
  camera_: CameraParams | null = null;
  private digicam = new Digicam();
  /** Source's camera instead of the digicam (Source-lit maps): exposure histogram, bloom, clamp. */
  sourceCamera: SourcePostParams | null = null;
  private sourcePost = new SourcePost();
  /** Source light → radiance (see worldUniforms.sourceUnit). */
  sourceUnit = 300 / Math.PI;
  private lastFrame = performance.now();
  /** The Source camera's current tonemap scale (for the HUD/tests). */
  get sourceScale(): number { return this.sourcePost.scale; }
  upscale: 'nearest' | 'linear' = 'linear';
  /**
   * Far things drawn soft, as through thick air: the blur's radius at its
   * strongest (pixels of a 720-line picture) and the distances where it
   * begins and where it is full. Null = off.
   */
  distanceBlur: { radius: number; start: number; end: number } | null = null;
  private blurTarget: THREE.WebGLRenderTarget | null = null;
  private blurScene = new THREE.Scene();
  private blurMat = new THREE.ShaderMaterial({
    uniforms: { src: { value: null }, depthTex: { value: null }, texel: { value: new THREE.Vector2() }, near: { value: 2 }, far: { value: 65536 }, blur: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    // Each pixel gathers from a disc as wide as its own distance asks for. A neighbour counts by how blurred it
    // is itself, so a near, sharp thing does not spread into the soft air behind it.
    fragmentShader: /* glsl */ `
      uniform sampler2D src; uniform sampler2D depthTex; uniform vec2 texel; uniform float near; uniform float far; uniform vec3 blur;
      varying vec2 vUv;
      float amount(vec2 uv) {
        float z = texture2D(depthTex, uv).x * 2.0 - 1.0;
        float dist = 2.0 * near * far / (far + near - z * (far - near));
        return smoothstep(blur.y, blur.z, dist);
      }
      void main() {
        vec4 c0 = texture2D(src, vUv);
        float a0 = amount(vUv);
        if (a0 < 0.004) { gl_FragColor = c0; return; }
        float r = a0 * blur.x;
        vec3 sum = c0.rgb;
        float wsum = 1.0;
        for (int i = 1; i <= 20; i++) {
          float fi = float(i);
          vec2 uv = vUv + vec2(cos(fi * 2.39996323), sin(fi * 2.39996323)) * (r * sqrt(fi / 20.0)) * texel;
          float w = amount(uv);
          w = w * w + 0.002;
          sum += texture2D(src, uv).rgb * w;
          wsum += w;
        }
        gl_FragColor = vec4(sum / wsum, c0.a);
      }`,
    depthTest: false, depthWrite: false,
  });
  /** Size actually rendered last frame, for the HUD. */
  readonly renderSize = new THREE.Vector2();

  constructor(readonly canvas: HTMLCanvasElement) {
    // premultipliedAlpha off: the clear colour is used as given even with alpha 0 (three.js would
    // otherwise multiply it to black), so the void can be the fog's colour without counting as a light.
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', premultipliedAlpha: false });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.setPixelRatio(1);
    this.camera = new THREE.PerspectiveCamera(74, 16 / 9, 2, 65536);
    this.blitMat = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
    this.blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMat));
    this.blurScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMat));
  }

  /** Source fov_desired is horizontal at 4:3; derive the vertical FOV from it (Hor+). */
  setSourceFov(fov43: number): void {
    const v = 2 * Math.atan(Math.tan((fov43 * Math.PI) / 360) * (3 / 4));
    this.camera.fov = (v * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  setClearColor(hex: string): void {
    this.gl.setClearColor(new THREE.Color(hex), 0); // alpha 0: not a light source (see digicam)
  }

  /** The void behind everything as linear radiance (the fog at its densest). */
  setClearRadiance(r: number, g: number, b: number): void {
    this.gl.setClearColor(new THREE.Color(r, g, b), 0);
  }

  /**
   * Match another camera's picture exactly (tools comparing against a screenshot): vertical
   * field of view in degrees and the image centre's offset in output pixels. Null = normal.
   */
  viewMatch: { fovY: number; dx: number; dy: number } | null = null;

  render(scene: THREE.Scene): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) this.gl.setSize(w, h, false);
    const aspect = w / h;
    if (this.viewMatch) {
      // A window onto a larger image whose centre is the match's image centre.
      const m = this.viewMatch, fullW = w + 2 * Math.abs(m.dx), fullH = h + 2 * Math.abs(m.dy);
      const f = (h / 2) / Math.tan((m.fovY * Math.PI) / 360);
      this.camera.fov = (2 * Math.atan(fullH / 2 / f) * 180) / Math.PI;
      this.camera.aspect = fullW / fullH;
      this.camera.setViewOffset(fullW, fullH, Math.abs(m.dx) - m.dx, Math.abs(m.dy) - m.dy, w, h);
      this.camera.updateProjectionMatrix();
    } else {
      if (this.camera.view) { this.camera.clearViewOffset(); }
      if (Math.abs(this.camera.aspect - aspect) > 1e-4) {
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
      }
    }

    // Always render through the offscreen target, even at native size, so
    // MSAA applies everywhere.
    const ih = this.internalHeight > 0 ? Math.min(this.internalHeight, h) : h;
    const iw = Math.max(1, Math.round(ih * aspect));
    this.renderSize.set(iw, ih);
    const filter = this.upscale === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
    const samples = Math.max(0, Math.round(this.msaa));
    const wantDepth = this.distanceBlur !== null;
    if (!this.target || this.target.width !== iw || this.target.height !== ih || this.target.texture.magFilter !== filter || this.target.samples !== samples || (this.target.depthTexture !== null) !== wantDepth) {
      this.target?.depthTexture?.dispose();
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(iw, ih, {
        // Half-float keeps values above white, so the camera pass can bloom and clip them.
        depthBuffer: true, colorSpace: THREE.NoColorSpace, magFilter: filter, minFilter: filter, generateMipmaps: false, samples, type: THREE.HalfFloatType,
        // The distance blur reads how far each pixel is.
        ...(wantDepth ? { depthTexture: new THREE.DepthTexture(iw, ih, THREE.UnsignedIntType) } : {}),
      });
      this.blurTarget?.dispose();
      this.blurTarget = wantDepth ? new THREE.WebGLRenderTarget(iw, ih, { depthBuffer: false, colorSpace: THREE.NoColorSpace, magFilter: filter, minFilter: filter, generateMipmaps: false, type: THREE.HalfFloatType }) : null;
    }
    this.gl.setRenderTarget(this.target);
    this.gl.render(scene, this.camera);
    let frame = this.target;
    if (this.distanceBlur && this.blurTarget && this.target.depthTexture) {
      const u = this.blurMat.uniforms, b = this.distanceBlur;
      u.src.value = this.target.texture;
      u.depthTex.value = this.target.depthTexture;
      (u.texel.value as THREE.Vector2).set(1 / iw, 1 / ih);
      u.near.value = this.camera.near;
      u.far.value = this.camera.far;
      (u.blur.value as THREE.Vector3).set((b.radius * ih) / 720, b.start, b.end);
      this.gl.setRenderTarget(this.blurTarget);
      this.gl.render(this.blurScene, this.blitCam);
      frame = this.blurTarget;
    }
    if (this.blitMat.map !== frame.texture) { this.blitMat.map = frame.texture; this.blitMat.needsUpdate = true; }
    const now = performance.now(), dt = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.sourceCamera) {
      this.sourcePost.render(this.gl, frame, null, this.sourceUnit, this.sourceCamera, dt);
      return;
    }
    if (this.camera_) {
      this.digicam.render(this.gl, frame, null, this.camera_);
      return;
    }
    this.gl.setRenderTarget(null);
    this.gl.render(this.blitScene, this.blitCam);
  }
}
