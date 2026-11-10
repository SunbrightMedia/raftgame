import * as THREE from 'three';
import type { TexEntry } from './textures';
import { worldUniforms } from './worldMaterial';
import { applySourceBlend, sourceUniforms } from './sourceMaterial';

/**
 * World surfaces lit the way Source's LightmappedGeneric shader lights them
 * (materialsystem/stdshaders/lightmappedgeneric_ps2_3_x.h):
 *   diffuse = albedo × lightmap
 * and on bump-mapped surfaces, from the three lightmaps baked in Valve's HL2
 * basis, weighted by the normal map:
 *   dp_i = saturate(n · basis_i)²,  lightmap = Σ dp_i · lightmap_i / Σ dp_i
 * Lightmap values are Source's linear light (1 = full); `sourceUnit` turns
 * that into this renderer's radiance, and the camera pass exposes it.
 */
export function makeSourceWorldMaterial(tex: TexEntry, normal: THREE.Texture | null): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      lightmap: worldUniforms.lightmap,
      lightmapOn: worldUniforms.lightmapOn,
      faceShade: worldUniforms.faceShade,
      brightness: worldUniforms.brightness,
      fogColor: worldUniforms.fogColor,
      fogLuminance: worldUniforms.fogLuminance,
      fogNear: worldUniforms.fogNear,
      fogFar: worldUniforms.fogFar,
      fogOn: worldUniforms.fogOn,
      fogHaze: worldUniforms.fogHaze,
      sourceUnit: worldUniforms.sourceUnit,
      map: { value: tex.texture },
      normalMap: { value: normal ?? tex.texture },
      hasNormal: { value: normal ? 1 : 0 },
      ...sourceUniforms(tex.source),
    },
    vertexShader: /* glsl */ `
      attribute vec2 lmuv;
      attribute float lmoff;
      attribute float shade;
      varying vec2 vUv;
      varying vec2 vLm;
      varying float vLmOff;
      varying float vShade;
      varying float vDepth;
      void main() {
        vUv = uv;
        vLm = lmuv;
        vLmOff = lmoff;
        vShade = shade;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform sampler2D normalMap;
      uniform float hasNormal;
      uniform sampler2D lightmap;
      uniform float lightmapOn;
      uniform float faceShade;
      uniform float brightness;
      uniform vec3 fogColor;
      uniform float fogLuminance;
      uniform float fogNear;
      uniform float fogFar;
      uniform float fogOn;
      uniform float fogHaze;
      uniform float sourceUnit;
      uniform int alphaMode;
      uniform float alphaRef;
      uniform float alphaMul;
      uniform float selfIllum;
      uniform vec3 selfIllumTint;
      varying vec2 vUv;
      varying vec2 vLm;
      varying float vLmOff;
      varying float vShade;
      varying float vDepth;
      vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
      const vec3 B0 = vec3(0.81649661, 0.0, 0.57735026);
      const vec3 B1 = vec3(-0.40824822, 0.70710677, 0.57735026);
      const vec3 B2 = vec3(-0.40824822, -0.70710677, 0.57735026);
      void main() {
        vec4 tx = texture2D(map, vUv);
        if (alphaMode == 1 && tx.a < alphaRef) discard;
        vec3 albedo = toLinear(tx.rgb);
        vec3 light;
        if (lightmapOn < 0.5) {
          light = vec3(mix(1.0, vShade, faceShade));
        } else if (vLmOff > 0.0) {
          vec3 n = hasNormal > 0.5 ? normalize(texture2D(normalMap, vUv).xyz * 2.0 - 1.0) : vec3(0.0, 0.0, 1.0);
          vec3 dp = vec3(clamp(dot(n, B0), 0.0, 1.0), clamp(dot(n, B1), 0.0, 1.0), clamp(dot(n, B2), 0.0, 1.0));
          dp *= dp;
          vec3 l1 = texture2D(lightmap, vLm + vec2(vLmOff, 0.0)).rgb;
          vec3 l2 = texture2D(lightmap, vLm + vec2(2.0 * vLmOff, 0.0)).rgb;
          vec3 l3 = texture2D(lightmap, vLm + vec2(3.0 * vLmOff, 0.0)).rgb;
          light = (dp.x * l1 + dp.y * l2 + dp.z * l3) / max(dp.x + dp.y + dp.z, 1e-4);
        } else {
          light = texture2D(lightmap, vLm).rgb;
        }
        vec3 L = albedo * light * sourceUnit * brightness;
        if (selfIllum > 0.5) L = mix(L, albedo * selfIllumTint * sourceUnit, tx.a);
        float fd = max(0.0, vDepth - fogNear) / max(1.0, fogFar - fogNear);
        float f = fogOn * (fogHaze > 0.5 ? 1.0 - exp(-3.0 * fd) : clamp(fd, 0.0, 1.0));
        float a = alphaMode == 2 ? tx.a * alphaMul : alphaMode == 3 ? alphaMul : 0.0;
        gl_FragColor = vec4(mix(L, toLinear(fogColor) * fogLuminance, f), a);
      }`,
  });
  applySourceBlend(mat, tex.source);
  return mat;
}
