import * as THREE from 'three';
import { Digicam, type CameraParams } from './digicam';

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
  upscale: 'nearest' | 'linear' = 'linear';
  /** Size actually rendered last frame, for the HUD. */
  readonly renderSize = new THREE.Vector2();

  constructor(readonly canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.setPixelRatio(1);
    this.camera = new THREE.PerspectiveCamera(74, 16 / 9, 2, 32768);
    this.blitMat = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
    this.blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMat));
  }

  /** Source fov_desired is horizontal at 4:3; derive the vertical FOV from it (Hor+). */
  setSourceFov(fov43: number): void {
    const v = 2 * Math.atan(Math.tan((fov43 * Math.PI) / 360) * (3 / 4));
    this.camera.fov = (v * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  setClearColor(hex: string): void {
    this.gl.setClearColor(new THREE.Color(hex), 1);
  }

  render(scene: THREE.Scene): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) this.gl.setSize(w, h, false);
    const aspect = w / h;
    if (Math.abs(this.camera.aspect - aspect) > 1e-4) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }

    // Always render through the offscreen target, even at native size, so
    // MSAA applies everywhere.
    const ih = this.internalHeight > 0 ? Math.min(this.internalHeight, h) : h;
    const iw = Math.max(1, Math.round(ih * aspect));
    this.renderSize.set(iw, ih);
    const filter = this.upscale === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
    const samples = Math.max(0, Math.round(this.msaa));
    if (!this.target || this.target.width !== iw || this.target.height !== ih || this.target.texture.magFilter !== filter || this.target.samples !== samples) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(iw, ih, {
        // Half-float keeps values above white, so the camera pass can bloom and clip them.
        depthBuffer: true, colorSpace: THREE.NoColorSpace, magFilter: filter, minFilter: filter, generateMipmaps: false, samples, type: THREE.HalfFloatType,
      });
      this.blitMat.map = this.target.texture;
      this.blitMat.needsUpdate = true;
    }
    this.gl.setRenderTarget(this.target);
    this.gl.render(scene, this.camera);
    if (this.camera_) {
      this.digicam.render(this.gl, this.target, null, this.camera_);
      return;
    }
    this.gl.setRenderTarget(null);
    this.gl.render(this.blitScene, this.blitCam);
  }
}
