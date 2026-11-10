import * as THREE from 'three';

/**
 * Distance fog, one set of uniforms for every material.
 *
 * Two models:
 *  - ours: linear from near to far, or haze (exponential, 95% at far);
 *  - Source's (env_fog_controller; stdshaders/common_ps_fxc.h CalcRangeFog and
 *    BlendPixelFog): f = min(max density, (d − start) / (end − start)), and
 *    the colour is blended by f². Radial distance, as Portal 2 does.
 * The fog's radiance is worked out on the CPU (Game.updateFog), so shaders
 * only blend: mix(L, fogRadiance, fogFactor(depth)).
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
};

/** Fragment-shader declarations: the uniforms and fogFactor(depth along the view ray). */
export const FOG_PARS = /* glsl */ `
  uniform vec3 fogRadiance;
  uniform float fogNear;
  uniform float fogFar;
  uniform float fogOn;
  uniform float fogHaze;
  uniform float fogMaxDensity;
  uniform float fogSquare;
  float fogFactor(float depth) {
    float fd = max(0.0, depth - fogNear) / max(1.0, fogFar - fogNear);
    float f = min(fogMaxDensity, fogHaze > 0.5 ? 1.0 - exp(-3.0 * fd) : clamp(fd, 0.0, 1.0));
    if (fogSquare > 0.5) f *= f;
    return fogOn * f;
  }`;

/** The fog factor on the CPU (same maths as fogFactor): how much of something at `depth` the fog hides. */
export function fogAt(depth: number): number {
  const u = fogUniforms;
  const fd = Math.max(0, depth - u.fogNear.value) / Math.max(1, u.fogFar.value - u.fogNear.value);
  let f = Math.min(u.fogMaxDensity.value, u.fogHaze.value > 0.5 ? 1 - Math.exp(-3 * fd) : Math.min(1, Math.max(0, fd)));
  if (u.fogSquare.value > 0.5) f *= f;
  return u.fogOn.value * f;
}

/** The distance past which the fog hides at least `amount` (0..1) of anything; Infinity if it never does. */
export function fogReach(amount = 0.995): number {
  const u = fogUniforms;
  if (u.fogOn.value < 0.5) return Infinity;
  let f = u.fogSquare.value > 0.5 ? Math.sqrt(amount) : amount;
  if (f > u.fogMaxDensity.value) return Infinity;
  const span = Math.max(1, u.fogFar.value - u.fogNear.value);
  if (u.fogHaze.value > 0.5) { f = Math.min(f, 0.999999); return u.fogNear.value + span * (-Math.log(1 - f) / 3); }
  return u.fogNear.value + span * f;
}
