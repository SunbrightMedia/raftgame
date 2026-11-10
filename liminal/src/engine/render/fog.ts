import * as THREE from 'three';

/**
 * Fog, one set of uniforms for every material.
 *
 * By distance, one of:
 *  - plain: linear from near to far, or haze (exponential, 95% at far);
 *  - Source's (env_fog_controller; stdshaders/common_ps_fxc.h CalcRangeFog and
 *    BlendPixelFog): f = min(max density, (d − start) / (end − start)), and
 *    the colour is blended by f². Radial distance, as Portal 2 does;
 *  - layers: how much the fog hides, and its colour, set at three distances
 *    past its start. Near air can be thin and dark, far air thick and pale.
 *    Between and past them the fog's thickness (optical depth) grows in
 *    straight lines, so each layer has its own density and the fog never
 *    shows an edge.
 *
 * By height, over any of those: below one height (and above another) the fog
 * thickens and takes another colour. The depths under a walkway go dark; the
 * heights go pale. Thickening is worked out from the middle of the line of
 * sight, colour from its far end; both stop changing past the fog's end, so
 * the backdrop (what is seen where there is nothing) is that same fog at its
 * end, in every direction, with no seam.
 *
 * Colours here are linear radiance worked out on the CPU (Game.updateFog);
 * shaders only blend: L · f.a + f.rgb with f = fogOver(depth, world z).
 */
export const fogUniforms = {
  /** Linear radiance of the fog (colour × brightness), in the frame's units. */
  fogRadiance: { value: new THREE.Vector3(0, 0, 0) },
  fogNear: { value: 400 },
  fogFar: { value: 5000 },
  fogOn: { value: 1 },
  fogHaze: { value: 0 },
  fogMaxDensity: { value: 1 },
  /** 1 = Source's blend (the factor squared). */
  fogSquare: { value: 0 },
  /** 1 = layers: fogStopD holds the start and the three layer distances, fogStopA the fog's thickness (optical depth) at each (0 at the start), fogStopC the three colours. */
  fogLayers: { value: 0 },
  fogStopD: { value: new THREE.Vector4(400, 1500, 4000, 9000) },
  fogStopA: { value: new THREE.Vector4(0, 0.15, 0.6, 1) },
  fogStopC: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
  /** Low fog: the height it begins under, how far below that it is full, how much thicker it makes the fog, how much of its colour it gives. */
  fogLow: { value: new THREE.Vector4(0, 1000, 0, 0) },
  fogLowC: { value: new THREE.Vector3() },
  /** High fog: the same, above a height. */
  fogHigh: { value: new THREE.Vector4(0, 1000, 0, 0) },
  fogHighC: { value: new THREE.Vector3() },
};

/**
 * Fragment-shader declarations: the uniforms, fogFactor(depth), and
 * fogOver(depth along the view ray, world z of the point): rgb = the light the
 * fog adds, a = how much of what lies behind still shows.
 */
export const FOG_PARS = /* glsl */ `
  uniform vec3 fogRadiance;
  uniform float fogNear;
  uniform float fogFar;
  uniform float fogOn;
  uniform float fogHaze;
  uniform float fogMaxDensity;
  uniform float fogSquare;
  uniform float fogLayers;
  uniform vec4 fogStopD;
  uniform vec4 fogStopA;
  uniform vec3 fogStopC[3];
  uniform vec4 fogLow;
  uniform vec3 fogLowC;
  uniform vec4 fogHigh;
  uniform vec3 fogHighC;
  float fogFactor(float depth) {
    float fd = max(0.0, depth - fogNear) / max(1.0, fogFar - fogNear);
    float f = min(fogMaxDensity, fogHaze > 0.5 ? 1.0 - exp(-3.0 * fd) : clamp(fd, 0.0, 1.0));
    if (fogSquare > 0.5) f *= f;
    return fogOn * f;
  }
  vec4 fogOver(float depth, float z) {
    if (fogOn < 0.5) return vec4(0.0, 0.0, 0.0, 1.0);
    float dEnd = fogLayers > 0.5 ? fogStopD.w : fogFar;
    float zc = cameraPosition.z;
    float zf = zc + (z - zc) * min(1.0, dEnd / max(depth, 1.0));
    float zm = 0.5 * (zc + zf);
    float d = depth * (1.0 + fogLow.z * clamp((fogLow.x - zm) / fogLow.y, 0.0, 1.0) + fogHigh.z * clamp((zm - fogHigh.x) / fogHigh.y, 0.0, 1.0));
    float f;
    vec3 c;
    if (fogLayers > 0.5) {
      // Thickness of fog passed through (optical depth): it grows in straight lines from layer to layer, and goes on
      // growing past the last at that layer's rate, so the fog closes in smoothly, with no edge where it becomes full.
      float tau;
      if (d <= fogStopD.y) {
        tau = fogStopA.y * clamp((d - fogStopD.x) / max(1.0, fogStopD.y - fogStopD.x), 0.0, 1.0);
        c = fogStopC[0];
      } else if (d <= fogStopD.z) {
        float t = (d - fogStopD.y) / max(1.0, fogStopD.z - fogStopD.y);
        tau = mix(fogStopA.y, fogStopA.z, t);
        c = mix(fogStopC[0], fogStopC[1], t);
      } else {
        float t = (d - fogStopD.z) / max(1.0, fogStopD.w - fogStopD.z);
        tau = fogStopA.z + (fogStopA.w - fogStopA.z) * t;
        c = mix(fogStopC[1], fogStopC[2], min(t, 1.0));
      }
      f = 1.0 - exp(-tau);
    } else {
      f = fogFactor(d);
      c = fogRadiance;
    }
    float tl = fogLow.w * clamp((fogLow.x - zf) / fogLow.y, 0.0, 1.0);
    float th = fogHigh.w * clamp((zf - fogHigh.x) / fogHigh.y, 0.0, 1.0);
    c = mix(mix(c, fogLowC, tl), fogHighC, th);
    return vec4(c * f, 1.0 - f);
  }
  vec3 applyFog(vec3 L, float depth, float z) {
    vec4 f = fogOver(depth, z);
    return L * f.a + f.rgb;
  }`;

/** The thickness of fog (optical depth) that hides this much: 0..1 → 0..∞, with "all" taken as 99.5%. */
export const fogThickness = (hides: number) => -Math.log(1 - Math.min(0.995, Math.max(0, hides)));

/** The layers' distances and thicknesses as plain numbers (start, then three layers). */
function stops(): { ds: number[]; ts: number[] } {
  const D = fogUniforms.fogStopD.value, A = fogUniforms.fogStopA.value;
  return { ds: [D.x, D.y, D.z, D.w], ts: [0, A.y, A.z, A.w] };
}

/** How much the fog hides at `depth` by distance alone (the same maths as the shaders', without the height terms). */
export function fogAt(depth: number): number {
  const u = fogUniforms;
  if (u.fogOn.value < 0.5) return 0;
  if (u.fogLayers.value > 0.5) {
    const { ds, ts } = stops();
    if (depth <= ds[0]) return 0;
    const i = depth <= ds[1] ? 1 : depth <= ds[2] ? 2 : 3;
    return 1 - Math.exp(-(ts[i - 1] + ((ts[i] - ts[i - 1]) * (depth - ds[i - 1])) / Math.max(1, ds[i] - ds[i - 1])));
  }
  const fd = Math.max(0, depth - u.fogNear.value) / Math.max(1, u.fogFar.value - u.fogNear.value);
  let f = Math.min(u.fogMaxDensity.value, u.fogHaze.value > 0.5 ? 1 - Math.exp(-3 * fd) : Math.min(1, Math.max(0, fd)));
  if (u.fogSquare.value > 0.5) f *= f;
  return f;
}

/**
 * The distance past which the fog hides at least `amount` (0..1) of anything;
 * Infinity if it never does. (The height terms only ever thicken the fog, so
 * this is never too short.)
 */
export function fogReach(amount = 0.995): number {
  const u = fogUniforms;
  if (u.fogOn.value < 0.5) return Infinity;
  if (u.fogLayers.value > 0.5) {
    const { ds, ts } = stops();
    const want = -Math.log(1 - Math.min(amount, 0.999999));
    for (let i = 1; i < 4; i++) if (ts[i] >= want && ts[i] > ts[i - 1]) return ds[i - 1] + ((ds[i] - ds[i - 1]) * (want - ts[i - 1])) / (ts[i] - ts[i - 1]);
    // Past the last layer the fog goes on thickening at that layer's rate.
    const rate = (ts[3] - ts[2]) / Math.max(1, ds[3] - ds[2]);
    return rate > 0 ? ds[3] + (want - ts[3]) / rate : Infinity;
  }
  let f = u.fogSquare.value > 0.5 ? Math.sqrt(amount) : amount;
  if (f > u.fogMaxDensity.value) return Infinity;
  const span = Math.max(1, u.fogFar.value - u.fogNear.value);
  if (u.fogHaze.value > 0.5) { f = Math.min(f, 0.999999); return u.fogNear.value + span * (-Math.log(1 - f) / 3); }
  return u.fogNear.value + span * f;
}

/**
 * What is seen where nothing is drawn: the fog at its end in each direction
 * (so the depths and the heights keep their own colour out to the horizon),
 * over the void's own colour where the fog never gets fully dense. A shell
 * round the camera, drawn first.
 */
export class FogBackdrop {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...fogUniforms, voidRadiance: { value: new THREE.Vector3() } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${FOG_PARS}
        uniform vec3 voidRadiance;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec4 f = fogOver(1.0e7, cameraPosition.z + d.z * 1.0e7);
          gl_FragColor = vec4(voidRadiance * f.a + f.rgb, 0.0);   // alpha 0: not a light source for the camera pass
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 16), this.mat);
    this.mesh.renderOrder = -900;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }
  /** Shown while the fog is on; `voidRadiance` is what lies behind the fog (the clear colour, as radiance). */
  set(on: boolean, voidRadiance: THREE.Vector3): void {
    this.mesh.visible = on;
    (this.mat.uniforms.voidRadiance.value as THREE.Vector3).copy(voidRadiance);
  }
  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }
}
