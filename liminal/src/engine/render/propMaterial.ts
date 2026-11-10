import * as THREE from 'three';
import type { TexEntry } from './textures';
import { worldUniforms } from './worldMaterial';
import { applySourceBlend, sourceUniforms } from './sourceMaterial';

/**
 * Model surfaces (props). Placeholder lighting until props get Source's
 * vertex lighting (docs/PIPELINE.md, phase 1): the same even light and
 * per-direction shade the world uses before its lightmap arrives.
 * Self-illumination follows Source's VertexLitGeneric: the lit colour moves
 * to albedo × tint by the base alpha (the mask), at Source's "1.0" of light.
 */
export function makePropMaterial(tex: TexEntry): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
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
      ...sourceUniforms(tex.source),
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying float vDepth;
      void main() {
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
      varying vec3 vNormal;
      varying float vDepth;
      vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
      void main() {
        vec4 tx = texture2D(map, vUv);
        if (alphaMode == 1 && tx.a < alphaRef) discard;
        vec3 rho = toLinear(tx.rgb);
        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        vec3 n2 = n * n;
        float shade = n2.x * (n.x > 0.0 ? 0.82 : 0.74) + n2.y * (n.y > 0.0 ? 0.9 : 0.66) + n2.z * (n.z > 0.0 ? 1.0 : 0.58);
        vec3 L = rho * 300.0 / PI * mix(1.0, shade, faceShade) * brightness;
        if (selfIllum > 0.5) L = mix(L, rho * selfIllumTint * sourceUnit, tx.a);
        float fd = max(0.0, vDepth - fogNear) / max(1.0, fogFar - fogNear);
        float f = fogOn * (fogHaze > 0.5 ? 1.0 - exp(-3.0 * fd) : clamp(fd, 0.0, 1.0));
        float a = alphaMode == 2 ? tx.a * alphaMul : alphaMode == 3 ? alphaMul : 0.0;
        gl_FragColor = vec4(mix(L, toLinear(fogColor) * fogLuminance, f), a);
      }`,
  });
  applySourceBlend(mat, tex.source);
  return mat;
}
