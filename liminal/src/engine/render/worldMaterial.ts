import * as THREE from 'three';

/**
 * Shared uniforms for every world surface, so a slider in the panel updates
 * all materials at once without rebuilding anything.
 */
export const worldUniforms = {
  faceShade: { value: 0.6 },
  brightness: { value: 1 },
  fogColor: { value: new THREE.Color('#16181c') },
  fogNear: { value: 400 },
  fogFar: { value: 5000 },
  fogOn: { value: 1 },
};

/**
 * The world shader. Deliberately simple for Milestone 1: texture × per-face
 * shade × brightness, then linear fog. Colours are kept in "display space"
 * end to end (no linear workflow), like old engines, so values on screen are
 * the values you picked.
 *
 * Milestone 3/5 extend this: point lights, then a lightmap UV channel
 * multiplied in here.
 */
export function makeWorldMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...worldUniforms, map: { value: map } },
    vertexShader: /* glsl */ `
      attribute float shade;
      varying vec2 vUv;
      varying float vShade;
      varying float vDepth;
      void main() {
        vUv = uv;
        vShade = shade;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float faceShade;
      uniform float brightness;
      uniform vec3 fogColor;
      uniform float fogNear;
      uniform float fogFar;
      uniform float fogOn;
      varying vec2 vUv;
      varying float vShade;
      varying float vDepth;
      void main() {
        vec3 c = texture2D(map, vUv).rgb;
        c *= mix(1.0, vShade, faceShade) * brightness;
        float f = fogOn * clamp((vDepth - fogNear) / max(1.0, fogFar - fogNear), 0.0, 1.0);
        gl_FragColor = vec4(mix(c, fogColor, f), 1.0);
      }`,
  });
}
