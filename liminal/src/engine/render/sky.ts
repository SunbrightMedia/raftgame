import * as THREE from 'three';

/**
 * Open sky for outdoor maps, in the same physical units as the world:
 * luminance (cd/m²) graded from the horizon colour to the zenith colour, and
 * the sun's disc. Drawn first, behind everything, following the camera.
 * Alpha 1 on the sun marks it as a light source for the camera pass (glow,
 * edge, fringe); the sky itself is not one.
 */
export class Sky {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        zenith: { value: new THREE.Vector3() },
        horizon: { value: new THREE.Vector3() },
        sunDir: { value: new THREE.Vector3(0, 0, 1) },
        sunOn: { value: 0 },
        sunColor: { value: new THREE.Vector3(1, 1, 1) },
        band: { value: 0.04 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 zenith, horizon, sunDir, sunColor;
        uniform float sunOn, band;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float t = 1.0 - exp(-max(d.z, 0.0) / band);
          vec3 L = mix(horizon, zenith, t);
          if (d.z < 0.0) L = horizon * mix(1.0, 0.55, smoothstep(0.0, 0.2, -d.z)); // below the horizon: haze
          float sun = sunOn * smoothstep(0.99996, 0.99999, dot(d, sunDir)); // ~0.5° disc
          L = mix(L, sunColor * 30000.0, sun);
          gl_FragColor = vec4(L, sun);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), this.mat);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** luminance in cd/m²; colours linear, luminance-normalised; sun = direction TO the sun (or null). */
  set(luminance: number, zenith: [number, number, number], horizon: [number, number, number], sun: { dir: [number, number, number]; color: [number, number, number] } | null, bandDeg = 2.5): void {
    this.mesh.visible = luminance > 0;
    const u = this.mat.uniforms;
    u.band.value = Math.sin((Math.max(0.1, bandDeg) * Math.PI) / 180);
    u.zenith.value.set(...zenith).multiplyScalar(luminance);
    u.horizon.value.set(...horizon).multiplyScalar(luminance);
    u.sunOn.value = sun ? 1 : 0;
    if (sun) { u.sunDir.value.set(...sun.dir).normalize(); u.sunColor.value.set(...sun.color); }
  }

  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }
}
