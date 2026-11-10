import * as THREE from 'three';
import type { TexEntry } from './textures';
import { worldUniforms } from './worldMaterial';
import { fogUniforms, FOG_PARS } from './fog';
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
/** Dev views for calibration (shared by every world material): 0 shaded, 1 albedo, 2 light ÷ 2, 3 flat lightmap ÷ 2 (gamma, non-HDR path). */
export const sourceWorldDebug = { value: 0 };

export function makeSourceWorldMaterial(tex: TexEntry, normal: THREE.Texture | null, detail: THREE.Texture | null = null): THREE.ShaderMaterial {
  const d = tex.source?.detail;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      lightmap: worldUniforms.lightmap,
      lightmapOn: worldUniforms.lightmapOn,
      faceShade: worldUniforms.faceShade,
      brightness: worldUniforms.brightness,
      ...fogUniforms,
      sourceUnit: worldUniforms.sourceUnit,
      gamma22: worldUniforms.gamma22,
      debugView: sourceWorldDebug,
      map: { value: tex.texture },
      normalMap: { value: normal ?? tex.texture },
      hasNormal: { value: normal ? 1 : 0 },
      ssbump: { value: tex.source?.ssbump ? 1 : 0 },
      detailMap: { value: detail ?? tex.texture },
      detailOn: { value: detail && d ? 1 : 0 },
      detailScale: { value: d?.scale ?? 1 },
      detailFactor: { value: d?.factor ?? 1 },
      detailMode: { value: d?.mode ?? 0 },
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
      uniform float ssbump;
      uniform sampler2D detailMap;
      uniform float detailOn;
      uniform float detailScale;
      uniform float detailFactor;
      uniform int detailMode;
      uniform sampler2D lightmap;
      uniform float lightmapOn;
      uniform float faceShade;
      uniform float brightness;
      ${FOG_PARS}
      uniform float sourceUnit;
      uniform int debugView;
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
      uniform float gamma22;
      vec3 toLinear(vec3 c) { return gamma22 > 0.5 ? pow(c, vec3(2.2)) : mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
      const vec3 B0 = vec3(0.81649661, 0.0, 0.57735026);
      const vec3 B1 = vec3(-0.40824822, 0.70710677, 0.57735026);
      const vec3 B2 = vec3(-0.40824822, -0.70710677, 0.57735026);
      void main() {
        vec4 tx = texture2D(map, vUv);
        // Read here, outside any branch: inside a per-pixel branch texture reads lose their mip
        // selection and the bump map's fine grout aliases into speckles at a distance.
        vec3 bumpTexel = texture2D(normalMap, vUv).xyz;
        if (alphaMode == 1 && tx.a < alphaRef) discard;
        // Non-HDR path (gamma22): Source does all of this in gamma space on 8-bit values:
        // albedo as stored, lightmaps stored as 0.5·light^(1/2.2) and doubled.
        bool ldr = gamma22 > 0.5;
        vec3 albedo = ldr ? tx.rgb : toLinear(tx.rgb);
        // $detail (common_ps_fxc.h TextureCombine), on the linear base colour.
        vec4 dc = texture2D(detailMap, vUv * detailScale);
        if (detailOn > 0.5) {
          if (detailMode == 0) albedo *= mix(vec3(1.0), 2.0 * dc.rgb, detailFactor);
          else if (detailMode == 7) albedo *= mix(vec3(1.0), vec3(2.0 * mix(dc.r, dc.a, tx.a)), detailFactor);
          else if (detailMode == 1) albedo += detailFactor * dc.rgb;
          else if (detailMode == 2) albedo = mix(albedo, dc.rgb, detailFactor * dc.a);
          else if (detailMode == 3) albedo = mix(albedo, dc.rgb, detailFactor);
          else if (detailMode == 4) albedo = mix(albedo, dc.rgb, detailFactor * (1.0 - tx.a));
          else if (detailMode == 8) albedo = mix(albedo, albedo * dc.rgb, detailFactor);
        }
        vec3 light;
        float lmScale = ldr ? 2.0 : 1.0;
        if (lightmapOn < 0.5) {
          light = vec3(mix(1.0, vShade, faceShade));
        } else if (vLmOff > 0.0) {
          vec3 l1 = texture2D(lightmap, vLm + vec2(vLmOff, 0.0)).rgb * lmScale;
          vec3 l2 = texture2D(lightmap, vLm + vec2(2.0 * vLmOff, 0.0)).rgb * lmScale;
          vec3 l3 = texture2D(lightmap, vLm + vec2(3.0 * vLmOff, 0.0)).rgb * lmScale;
          if (ssbump > 0.5 && hasNormal > 0.5) {
            // Self-shadowing bump: the texture stores the three weights directly.
            vec3 w = bumpTexel;
            light = w.x * l1 + w.y * l2 + w.z * l3;
          } else {
            vec3 n = hasNormal > 0.5 ? normalize(bumpTexel * 2.0 - 1.0) : vec3(0.0, 0.0, 1.0);
            vec3 dp = vec3(clamp(dot(n, B0), 0.0, 1.0), clamp(dot(n, B1), 0.0, 1.0), clamp(dot(n, B2), 0.0, 1.0));
            dp *= dp;
            light = (dp.x * l1 + dp.y * l2 + dp.z * l3) / max(dp.x + dp.y + dp.z, 1e-4);
          }
        } else {
          light = texture2D(lightmap, vLm).rgb * lmScale;
        }
        vec3 L;
        if (ldr) {
          // Gamma-space result, clamped like the 8-bit frame buffer; handed on as linear for the camera pass to re-encode.
          vec3 g = albedo * light;
          if (selfIllum > 0.5) g = mix(g, albedo * selfIllumTint, tx.a);
          if (debugView == 1) g = albedo;
          else if (debugView == 2) g = light * 0.5;
          else if (debugView == 3) g = texture2D(lightmap, vLm).rgb * (lightmapOn > 0.5 ? 1.0 : 0.0);
          L = pow(clamp(g, 0.0, 1.0), vec3(2.2)) * sourceUnit;
        } else {
          L = albedo * light * sourceUnit * brightness;
          if (selfIllum > 0.5) L = mix(L, albedo * selfIllumTint * sourceUnit, tx.a);
        }
        float f = fogFactor(vDepth);
        float a = alphaMode == 2 ? tx.a * alphaMul : alphaMode == 3 ? alphaMul : 0.0;
        gl_FragColor = vec4(mix(L, fogRadiance, f), a);
      }`,
  });
  applySourceBlend(mat, tex.source);
  return mat;
}
