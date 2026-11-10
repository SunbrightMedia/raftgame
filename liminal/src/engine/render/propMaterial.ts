import * as THREE from 'three';
import type { TexEntry } from './textures';
import { worldUniforms } from './worldMaterial';
import { fogUniforms, FOG_PARS } from './fog';
import { applySourceBlend, sourceUniforms } from './sourceMaterial';

/**
 * Model surfaces (props): Source's VertexLitGeneric with baked per-vertex
 * light (vradProps.ts) — albedo × vertex light. Before a bake has lit them:
 * an even light with the same per-direction shade the world uses.
 * Self-illumination follows Source's VertexLitGeneric: the lit colour moves
 * to albedo × tint by the base alpha (the mask), at Source's "1.0" of light.
 */
/** Per-vertex baked light of all props (propMeshes.setPropLight). */
export const propLightUniforms = {
  propLight: { value: null as THREE.Texture | null },
  propLightOn: { value: 0 },
};

export function makePropMaterial(tex: TexEntry): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      faceShade: worldUniforms.faceShade,
      brightness: worldUniforms.brightness,
      ...fogUniforms,
      sourceUnit: worldUniforms.sourceUnit,
      gamma22: worldUniforms.gamma22,
      lightmapOn: worldUniforms.lightmapOn,
      ...propLightUniforms,
      map: { value: tex.texture },
      ...sourceUniforms(tex.source),
    },
    vertexShader: /* glsl */ `
      attribute float lightOffset;
      uniform float gamma22;
      uniform sampler2D propLight;
      uniform float propLightOn;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying float vDepth;
      varying vec3 vLight;
      void main() {
        vLight = vec3(-1.0);
        if (propLightOn > 0.5) {
          int i = int(lightOffset) + gl_VertexID;
          vLight = texelFetch(propLight, ivec2(i % 2048, i / 2048), 0).rgb;
          if (gamma22 > 0.5) {
            // Non-HDR: Source's vertex colours are bytes of 0.5·light^(1/2.2) (hue kept when clipped),
            // blended across the triangle as they are and doubled in the shader.
            vec3 v = 0.5 * pow(max(vLight, 0.0), vec3(1.0 / 2.2));
            float m = max(v.r, max(v.g, v.b));
            if (m > 1.0) v /= m;
            vLight = floor(v * 255.0 + 0.5) / 255.0 * 2.0;
          }
        }
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = modelMatrix * instanceMatrix;
        #endif
        vUv = uv;
        vNormal = normalize(mat3(m) * normal);
        vec4 mv = viewMatrix * m * vec4(position, 1.0);
        vDepth = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      #define PI 3.14159265
      uniform sampler2D map;
      uniform float faceShade;
      uniform float brightness;
      ${FOG_PARS}
      uniform float sourceUnit;
      uniform int alphaMode;
      uniform float alphaRef;
      uniform float alphaMul;
      uniform float selfIllum;
      uniform vec3 selfIllumTint;
      uniform float lightmapOn;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying float vDepth;
      varying vec3 vLight;
      uniform float gamma22;
      vec3 toLinear(vec3 c) { return gamma22 > 0.5 ? pow(c, vec3(2.2)) : mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
      void main() {
        vec4 tx = texture2D(map, vUv);
        if (alphaMode == 1 && tx.a < alphaRef) discard;
        vec3 rho = toLinear(tx.rgb);
        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        vec3 n2 = n * n;
        float shade = n2.x * (n.x > 0.0 ? 0.82 : 0.74) + n2.y * (n.y > 0.0 ? 0.9 : 0.66) + n2.z * (n.z > 0.0 ? 1.0 : 0.58);
        // Baked per-vertex light (Source linear) once the bake has it; until then an even light with direction shading.
        vec3 L;
        if (gamma22 > 0.5 && lightmapOn > 0.5 && vLight.r >= 0.0) {
          // Non-HDR: gamma-space albedo × vertex light (see the vertex shader), clamped like the frame buffer.
          vec3 g = tx.rgb * vLight;
          if (selfIllum > 0.5) g = mix(g, tx.rgb * selfIllumTint, tx.a);
          L = pow(clamp(g, 0.0, 1.0), vec3(2.2)) * sourceUnit;
        } else {
          L = lightmapOn > 0.5 && vLight.r >= 0.0 ? rho * vLight * sourceUnit * brightness : rho * sourceUnit * mix(1.0, shade, faceShade) * brightness;
          if (selfIllum > 0.5) L = mix(L, rho * selfIllumTint * sourceUnit, tx.a);
        }
        float f = fogFactor(vDepth);
        float a = alphaMode == 2 ? tx.a * alphaMul : alphaMode == 3 ? alphaMul : 0.0;
        gl_FragColor = vec4(mix(L, fogRadiance, f), a);
      }`,
  });
  applySourceBlend(mat, tex.source);
  return mat;
}
