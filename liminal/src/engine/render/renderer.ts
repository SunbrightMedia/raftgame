import * as THREE from 'three';
import { Digicam, type CameraParams } from './digicam';
import { SourcePost, type SourcePostParams } from './sourcePost';
import { CamcorderPost, type CamcorderMotion, type CamcorderParams } from './camcorder';
import { BlenderPost } from './blenderPost';
import { ComplexPost, complexPictureSize, type ComplexParams, type ComplexTAAFrame } from './complexPost';
import { haltonJitter, jitterCount } from './complexTAA';
import { haveBlenderData, loadBlenderData } from './blenderData';

/** The Blender camera's start, remembered across page loads ('starting' until it has run smoothly; 'lost' after
 * a context loss), so that a start that froze or crashed the browser is not repeated by itself on the next load. */
const blenderGuard = {
  key: 'liminal:blender-guard',
  get(): string | null { try { return localStorage.getItem(this.key); } catch { return null; } },
  set(v: string | null): void { try { if (v === null) localStorage.removeItem(this.key); else localStorage.setItem(this.key, v); } catch { /* storage blocked */ } },
};

THREE.ColorManagement.enabled = false;
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

/** Meshes on this layer (as well as layer 0) are big opaque surfaces: they are drawn first, depth only (LowResRenderer.depthFirst). */
export const OCCLUDER_LAYER = 1;

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
  /** The capture-matched camcorder (camcorder.ts): fixed exposure, glow, film curve, tape, lens; a 4:3 picture. Wins over the others. */
  camcorder: CamcorderParams | null = null;
  private camcorderPost = new CamcorderPost();
  /**
   * Blender's post-processing (blenderPost.ts): the ShuttleworthL project's compositor and AgX view, on a
   * picture of the project's size (854 x 480), with the light program (blenderData.ts). Wins over the others.
   * The data loads and its shaders compile, a few per frame, the first time it is wanted; until then the plain
   * picture shows.
   */
  blender: { exposure: number; frameRate: number; startFrame: number } | null = null;
  private blenderPost: BlenderPost | null = null;
  /** The Complex's camera as that game runs it (complexPost.ts): its tonemapper and camera passes, checked against
   *  the game's own steps; a 4:3 picture with bars. Wins over the others. */
  complex: ComplexParams | null = null;
  private complexPost: ComplexPost | null = null;
  /** Why the complex camera could not start ('' = fine). */
  complexError = '';
  /** The complex camera's upscaler: last frame's camera (unjittered view-projection, place, direction), the input and
   *  picture sizes it was for, and a frame counter (the jitter cycles with it). */
  private taa = { frame: 0, have: false, key: '', prevVP: new THREE.Matrix4(), pos: new THREE.Vector3(), dir: new THREE.Vector3(),
    proj: new THREE.Matrix4(), projInv: new THREE.Matrix4(), vp: new THREE.Matrix4(), inv: new THREE.Matrix4(), c2p: new THREE.Matrix4() };
  /** Tools: hold the upscaler's jitter at this (input pixels, x right, y down) instead of cycling it. */
  taaJitter: [number, number] | null = null;
  private taaFrame: Omit<ComplexTAAFrame, 'depth'> | null = null;
  private blenderSize: [number, number] = [854, 480];
  private blenderTime = 0;
  /** Wall-clock times of the last few Blender frames (the slow-frame guard). */
  private blenderTimes: number[] = [];
  /** Three Blender frames in a row slower than this (ms) turn it off. (Headless checks on a software GPU raise it.) */
  blenderSlowMs = 1000;
  /** For the HUD and tests: loading / compiling / ready / failed, the error, the compositor frame last run. */
  readonly blenderStats = { state: 'idle' as 'idle' | 'loading' | 'compiling' | 'ready' | 'failed', error: '', frame: 0, compiled: [0, 0] as [number, number] };
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
  /**
   * Depth first: the big opaque surfaces (meshes on OCCLUDER_LAYER) are drawn
   * once with no colour, so that in the real pass a pixel is shaded only for
   * the surface in front. Lighting a wall costs many texture reads; without
   * this, every wall behind another wall pays it too.
   */
  depthFirst = true;
  private depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
  /**
   * Hold the frame rate by drawing fewer lines when frames run long, and more
   * again when there is time to spare (the picture is scaled up to the window
   * either way). 0 = off: always `internalHeight` lines.
   */
  targetFps = 0;
  /** With targetFps: never fewer lines than this. */
  minHeight = 360;
  /** The share of the full height being drawn now (1 = all of it). */
  private scale = 1;
  private frameMs = 16;       // a running mean of the time between frames
  private steady = 0;         // seconds since the size last changed
  private holdUp = 4;         // seconds to wait before trying a bigger picture (doubles each time a try fails)
  private triedUp = false;
  private lowAA = false;      // antialiasing given up to hold the frame rate
  /** Last frame: draw calls and triangles, the mean time between frames, the antialiasing in use, and the graphics card's name: for the HUD. */
  readonly stats = { calls: 0, triangles: 0, frameMs: 16, aa: 0, gpu: '' };
  /**
   * With the Source camera: its finished picture is then recorded by the old
   * camera (`camera_`) at a fixed exposure: that camera's softness, colour
   * bleed, fringes and grain, laid over the picture as it is.
   */
  cameraOver = false;
  private overTarget: THREE.WebGLRenderTarget | null = null;
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
        for (int i = 1; i <= 12; i++) {
          float fi = float(i);
          vec2 uv = vUv + vec2(cos(fi * 2.39996323), sin(fi * 2.39996323)) * (r * sqrt(fi / 12.0)) * texel;
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
    // A lost context (the driver reset, or Chrome restarted its GPU process) takes the Blender camera's GL
    // objects with it: drop it, and do not start it again by itself.
    canvas.addEventListener('webglcontextlost', () => {
      const st = this.blenderStats;
      if (!this.blenderPost && st.state !== 'loading') return;
      this.blenderPost = null;
      st.state = 'failed';
      st.error = 'the graphics driver was reset while it ran';
      blenderGuard.set('lost');
    });
    try {
      // The graphics card in use, for the HUD (a slow frame rate means one thing on a laptop's built-in chip and another on a software renderer).
      const c = this.gl.getContext(), ext = c.getExtension('WEBGL_debug_renderer_info');
      const name = String(ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER));
      this.stats.gpu = (/^ANGLE \([^,]*, (.+?)(?: Direct3D.*| \(0x.*|, .*)?\)?$/.exec(name)?.[1] ?? name).slice(0, 64);
    } catch { /* not told */ }
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

  private vpNow = new THREE.Matrix4();
  private vpPrev = new THREE.Matrix4();
  private vpInv = new THREE.Matrix4();
  private vpTest = new THREE.Matrix4();
  private prevPos = new THREE.Vector3();
  private prevDir = new THREE.Vector3();
  private hasPrev = false;

  /**
   * The camcorder's motion blur inputs for this frame: where the camera was a shutter time ago (from last
   * frame's camera, scaled to the shutter), or, with a test turn speed, the camera turned back by that much.
   * None after a jump (a teleport, a new view): more than 48" or 25° in one frame.
   */
  private shutterMotion(dt: number): CamcorderMotion | null {
    const c = this.camcorder, depth = this.target?.depthTexture;
    this.camera.updateMatrixWorld();
    this.vpNow.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const pos = this.camera.getWorldPosition(new THREE.Vector3()), dir = this.camera.getWorldDirection(new THREE.Vector3());
    const jumped = !this.hasPrev || pos.distanceTo(this.prevPos) > 48 || dir.angleTo(this.prevDir) > (25 * Math.PI) / 180;
    let out: CamcorderMotion | null = null;
    const shutter = (c?.motionBlur ?? 0) / 1000;
    if (c && depth && shutter > 0) {
      this.vpInv.copy(this.vpNow).invert();
      if (c.motionTestYaw) {
        // the camera as it was when the shutter opened: turned back about world up by speed × shutter
        const back = new THREE.Matrix4().makeRotationZ((-c.motionTestYaw * Math.PI / 180) * shutter);
        const cam = this.camera.matrixWorld.clone();
        const p = new THREE.Vector3().setFromMatrixPosition(cam);
        const rot = new THREE.Matrix4().extractRotation(cam).premultiply(back);
        rot.setPosition(p);
        this.vpTest.multiplyMatrices(this.camera.projectionMatrix, rot.invert());
        out = { depth, invViewProj: this.vpInv, prevViewProj: this.vpTest, scale: 1 };
      } else if (!jumped && dt > 0) {
        out = { depth, invViewProj: this.vpInv, prevViewProj: this.vpPrev, scale: Math.min(2, shutter / dt) };
      }
    }
    this.vpPrev.copy(this.vpNow);
    this.prevPos.copy(pos); this.prevDir.copy(dir); this.hasPrev = true;
    return out;
  }

  render(scene: THREE.Scene): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) this.gl.setSize(w, h, false);
    const aspect = this.camcorder?.bars || this.complex ? 4 / 3 : this.blender ? this.blenderSize[0] / this.blenderSize[1] : w / h;
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
    const now0 = performance.now(), gap = Math.min(250, now0 - this.lastFrame);
    this.frameMs += (gap - this.frameMs) * (1 - Math.exp(-gap / 200));   // the mean of about the last fifth of a second
    this.stats.frameMs = this.frameMs;
    const full = this.internalHeight > 0 ? Math.min(this.internalHeight, h) : h;
    const msaa = Math.max(0, Math.round(this.msaa));
    if (this.targetFps > 0) {
      // Too slow for a third of a second: a cheaper picture at once. Time to spare for a while: try a dearer one;
      // if that try turns out too slow, go back and wait twice as long before the next try.
      // The steps, from dear to cheap: all the lines; three quarters of them; then no antialiasing; then fewer lines still.
      const want = 1000 / this.targetFps, floor = Math.min(1, this.minHeight / full), mid = Math.max(0.75, floor);
      this.steady += gap / 1000;
      if (this.frameMs > want * 1.2 && this.steady > 0.35 && (this.scale > floor + 0.005 || (!this.lowAA && msaa > 0))) {
        if (this.triedUp) this.holdUp = Math.min(120, this.holdUp * 2);
        const f = Math.max(0.6, Math.min(0.92, want / this.frameMs));
        if (this.scale > mid + 0.005) this.scale = Math.max(mid, this.scale * f);
        else if (!this.lowAA && msaa > 0) this.lowAA = true;
        else this.scale = Math.max(floor, this.scale * f);
        this.steady = 0; this.triedUp = false;
      } else if (this.frameMs < want * 1.06 && this.steady > this.holdUp && (this.scale < 1 || this.lowAA)) {
        if (this.scale < mid - 0.005) this.scale = Math.min(mid, this.scale * 1.12);
        else if (this.lowAA) this.lowAA = false;
        else this.scale = Math.min(1, this.scale * 1.12);
        this.steady = 0; this.triedUp = true;
      } else if (this.triedUp && this.steady > 2) { this.triedUp = false; this.holdUp = 4; }
    } else { this.scale = 1; this.lowAA = false; }
    // In steps of 16 lines, so the buffers are not remade for every small change.
    let ih = Math.max(1, Math.min(full, Math.round((full * this.scale) / 16) * 16 || full));
    let iw = Math.max(1, Math.round(ih * aspect));
    // Blender's compositor works on its own picture size (its blurs and grain are in pixels of it)
    if (this.blender) [iw, ih] = this.blenderSize;
    // The complex camera's upscaler: the game draws at 70 % of its picture (screenPct) and makes the picture over frames
    const taa = !this.blender && !!this.complex?.taa && !this.complexError;
    let pic: [number, number] = [iw, ih];
    if (taa) {
      pic = complexPictureSize(w, h);
      const sp = Math.min(1, Math.max(0.1, this.complex!.screenPct)) * this.scale;
      iw = Math.max(1, Math.round(pic[0] * sp)); ih = Math.max(1, Math.round(pic[1] * sp));
    }
    this.renderSize.set(iw, ih);
    const filter = this.upscale === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
    const samples = this.lowAA || taa ? 0 : msaa;   // the upscaler is the antialiasing, as in the game
    this.stats.aa = samples;
    const wantDepth = this.distanceBlur !== null || (this.camcorder?.motionBlur ?? 0) > 0 || taa;
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
    this.taaFrame = taa ? this.taaJitterOn(iw, ih, pic) : null;
    this.gl.setRenderTarget(this.target);
    this.gl.info.autoReset = false;
    this.gl.info.reset();
    if (this.depthFirst) {
      this.gl.autoClear = false;
      this.gl.clear();
      this.camera.layers.set(OCCLUDER_LAYER);
      scene.overrideMaterial = this.depthOnly;
      this.gl.render(scene, this.camera);
      scene.overrideMaterial = null;
      this.camera.layers.set(0);
      this.gl.render(scene, this.camera);
      this.gl.autoClear = true;
    } else this.gl.render(scene, this.camera);
    if (this.taaFrame) {      // the jitter was for the scene only
      this.camera.projectionMatrix.copy(this.taa.proj);
      this.camera.projectionMatrixInverse.copy(this.taa.projInv);
    }
    this.stats.calls = this.gl.info.render.calls;
    this.stats.triangles = this.gl.info.render.triangles;
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
    if (this.complex && this.runComplex(frame, dt)) return;
    if (this.blender && this.runBlender(frame, dt)) return;
    if (!this.blender) this.blenderOff();
    if (this.camcorder) {
      const hfov = 2 * Math.atan(Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect);
      this.camcorderPost.render(this.gl, frame, this.camcorder, hfov, dt, this.shutterMotion(dt));
      return;
    }
    if (this.sourceCamera) {
      if (this.cameraOver && this.camera_) {
        if (!this.overTarget || this.overTarget.width !== iw || this.overTarget.height !== ih) {
          this.overTarget?.dispose();
          this.overTarget = new THREE.WebGLRenderTarget(iw, ih, { depthBuffer: false, colorSpace: THREE.NoColorSpace, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false, type: THREE.HalfFloatType });
        }
        this.sourcePost.render(this.gl, frame, this.overTarget, this.sourceUnit, this.sourceCamera, dt, true);
        // The picture's colours and brightness are already as they should be: this camera adds no cast of its own.
        this.digicam.render(this.gl, this.overTarget, null, { ...this.camera_, whiteBalanceK: 6600, tint: 0, brightness: 0 }, this.camera_.clip);
      } else this.sourcePost.render(this.gl, frame, null, this.sourceUnit, this.sourceCamera, dt);
      return;
    }
    if (this.camera_) {
      this.digicam.render(this.gl, frame, null, this.camera_);
      return;
    }
    this.gl.setRenderTarget(null);
    this.gl.render(this.blitScene, this.blitCam);
  }

  /** The 'blender' camera: false while its data loads and compiles (or if it cannot run), so the caller shows
   * the plain picture. */
  private runBlender(frame: THREE.WebGLRenderTarget, dt: number): boolean {
    const b = this.blender!, st = this.blenderStats;
    if (st.state === 'idle') {
      if (!haveBlenderData()) { st.state = 'failed'; st.error = 'its data is not in this build'; return false; }
      // the last start never got to run smoothly: the tab froze, crashed or was closed while it compiled
      const last = blenderGuard.get();
      if (last === 'starting' || last === 'lost') {
        blenderGuard.set(null);   // choosing it again (another model, then 'blender') tries again
        st.state = 'failed';
        st.error = last === 'lost' ? 'the graphics driver was reset while it ran last time' : 'it did not finish starting last time (the page froze or closed)';
        return false;
      }
      blenderGuard.set('starting');
      st.state = 'loading';
      loadBlenderData().then(({ prog, luts }) => {
        if (st.state !== 'loading') return;
        this.blenderPost = new BlenderPost(this.gl.getContext() as WebGL2RenderingContext, prog, luts);
        this.blenderSize = [prog.size[0], prog.size[1]];
        st.compiled = this.blenderPost.progress;
        st.state = 'compiling';
        this.gl.resetState();
      }).catch((e: unknown) => { st.state = 'failed'; st.error = String(e); blenderGuard.set(null); this.gl.resetState(); });
      return false;
    }
    if (st.state === 'compiling' && this.blenderPost) {
      try {
        const done = this.blenderPost.prepare();
        st.compiled = this.blenderPost.progress;
        if (done) { st.state = 'ready'; this.blenderTimes = []; }
      } catch (e: unknown) {
        st.state = 'failed'; st.error = String(e); blenderGuard.set(null);
        this.blenderPost.dispose(); this.blenderPost = null;
      }
      this.gl.resetState();
      return false;
    }
    if (st.state !== 'ready' || !this.blenderPost) return false;
    const tex = (this.gl.properties.get(frame.texture) as { __webglTexture?: WebGLTexture }).__webglTexture;
    if (!tex || frame.width !== this.blenderSize[0] || frame.height !== this.blenderSize[1]) return false;
    this.blenderTime += dt;
    const n = b.startFrame + (b.frameRate > 0 ? Math.floor(this.blenderTime * b.frameRate) : 0);
    this.blenderPost.run(tex, n, undefined, { scale: b.exposure });
    const c = this.gl.domElement;
    this.blenderPost.present(c.width, c.height, this.upscale === 'linear');
    this.gl.resetState();
    st.frame = n;
    // health: 30 frames in under a second each means it runs here (the guard is cleared); three frames in a row
    // of over a second each means this GPU cannot carry it, so it turns itself off before it stalls the browser
    const now = performance.now(), times = this.blenderTimes;
    times.push(now);
    if (times.length > 31) times.shift();
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    if (gaps.length >= 3 && gaps.slice(-3).every((g) => g > this.blenderSlowMs)) {
      st.state = 'failed';
      st.error = `too slow on this graphics card (${(gaps[gaps.length - 1] / 1000).toFixed(1)} s a frame)`;
      blenderGuard.set(null);
      this.blenderPost.dispose(); this.blenderPost = null;
    } else if (gaps.length >= 30 && blenderGuard.get() === 'starting') blenderGuard.set(null);
    return true;
  }

  /** The model is not 'blender' (any more): a failed start may be tried again, and a start the user left
   * before it finished is not a crash. The compiled program stays for a quick switch back. */
  private blenderOff(): void {
    const st = this.blenderStats;
    if (st.state !== 'failed' && st.state !== 'loading') return;
    if (st.state === 'loading') blenderGuard.set(null);
    st.state = 'idle'; st.error = '';
  }

  /**
   * The upscaler's jitter for this frame (Unreal's: Halton 2, 3 over 16 places for 70 %), put into the camera's
   * projection until the scene is drawn, and this frame's clip space -> last frame's (unjittered), with whether last
   * frame can be used: not after a jump (more than 48" or 25 degrees in one frame) or a new size.
   */
  private taaJitterOn(iw: number, ih: number, pic: [number, number]): Omit<ComplexTAAFrame, 'depth'> {
    const T = this.taa, cam = this.camera;
    cam.updateMatrixWorld();
    T.proj.copy(cam.projectionMatrix); T.projInv.copy(cam.projectionMatrixInverse);
    const [jx, jy] = this.taaJitter ?? haltonJitter(T.frame % jitterCount(iw / pic[0]));
    const e = cam.projectionMatrix.elements;
    e[8] -= (2 * jx) / iw;      // three.js: ndc.x = -(x / z) e0 - e8, so the scene moves right by jx pixels
    e[9] += (2 * jy) / ih;      // and down by jy (rows run down, as the game's)
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    T.vp.multiplyMatrices(T.proj, cam.matrixWorldInverse);
    const pos = cam.getWorldPosition(new THREE.Vector3()), dir = cam.getWorldDirection(new THREE.Vector3());
    const key = `${iw}x${ih}>${pic[0]}x${pic[1]}`;
    const cut = !T.have || key !== T.key || pos.distanceTo(T.pos) > 48 || dir.angleTo(T.dir) > (25 * Math.PI) / 180;
    // (x, y, 1 - depth, 1) -> ndc (x, y, 2 depth - 1, 1) -> world -> last frame's clip
    const toNdc = new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -2, 1, 0, 0, 0, 1);
    T.inv.copy(T.vp).invert();
    T.c2p.copy(cut ? T.vp : T.prevVP).multiply(T.inv).multiply(toNdc);
    T.prevVP.copy(T.vp); T.pos.copy(pos); T.dir.copy(dir); T.key = key; T.have = true;
    const frame = T.frame++;
    return { inW: iw, inH: ih, jitter: [jx, jy], clipToPrev: T.c2p.elements, cut, frame };
  }

  /** The 'complex' camera; false (the plain picture) if it cannot run here. */
  private runComplex(frame: THREE.WebGLRenderTarget, dt: number): boolean {
    if (this.complexError) return false;
    const tex = (this.gl.properties.get(frame.texture) as { __webglTexture?: WebGLTexture }).__webglTexture;
    if (!tex) return false;
    try {
      this.complexPost ??= new ComplexPost(this.gl.getContext() as WebGL2RenderingContext);
      const hfov = 2 * Math.atan(Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect);
      const c = this.gl.domElement;
      const dtex = this.taaFrame && this.target?.depthTexture
        ? (this.gl.properties.get(this.target.depthTexture) as { __webglTexture?: WebGLTexture }).__webglTexture : undefined;
      const taa = this.taaFrame && dtex ? { ...this.taaFrame, depth: dtex } : undefined;
      this.complexPost.render(tex, c.width, c.height, { ...this.complex!, hfov }, dt, taa);
    } catch (e) {
      this.complexError = String(e);
      console.error(e);
      return false;
    } finally {
      this.gl.resetState();
    }
    return true;
  }

  /** One line for the HUD while the Blender camera is chosen but not showing ('' otherwise). */
  blenderNote(): string {
    if (!this.blender) return '';
    const st = this.blenderStats;
    if (st.state === 'loading') return 'Blender camera: loading its data…';
    if (st.state === 'compiling') return `Blender camera: compiling shaders ${st.compiled[0]} / ${st.compiled[1]}`;
    if (st.state === 'failed') return `Blender camera is off: ${st.error}. Choose another camera model, then 'blender' again, to retry.`;
    return '';
  }
}
