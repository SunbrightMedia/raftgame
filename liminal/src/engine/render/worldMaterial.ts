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
  lightmap: { value: null as THREE.Texture | null },
  lightmapOn: { value: 0 },
  exposure: { value: 1 },
};

/**
 * The world shader: texture × light × brightness, then linear fog.
 *
 * Light is the baked lightmap (stored at half value, ×2 here: overbright like
 * Source), or, in fullbright mode, the fake per-face shading Hammer uses.
 * Colours stay in display space end to end, like old engines, so the values
 * on screen are the values you picked.
 */
export function makeWorldMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...worldUniforms, map: { value: map } },
    vertexShader: /* glsl */ `
      attribute float shade;
      attribute vec2 lmuv;
      varying vec2 vUv;
      varying vec2 vLm;
      varying float vShade;
      varying float vDepth;
      void main() {
        vUv = uv;
        vLm = lmuv;
        vShade = shade;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform sampler2D lightmap;
      uniform float lightmapOn;
      uniform float exposure;
      uniform float faceShade;
      uniform float brightness;
      uniform vec3 fogColor;
      uniform float fogNear;
      uniform float fogFar;
      uniform float fogOn;
      varying vec2 vUv;
      varying vec2 vLm;
      varying float vShade;
      varying float vDepth;
      void main() {
        vec3 c = texture2D(map, vUv).rgb;
        vec3 light = lightmapOn > 0.5
          ? texture2D(lightmap, vLm).rgb * 2.0 * exposure
          : vec3(mix(1.0, vShade, faceShade));
        c *= light * brightness;
        float f = fogOn * clamp((vDepth - fogNear) / max(1.0, fogFar - fogNear), 0.0, 1.0);
        gl_FragColor = vec4(mix(c, fogColor, f), 1.0);
      }`,
  });
}
