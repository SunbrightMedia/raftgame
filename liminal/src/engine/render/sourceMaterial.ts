import * as THREE from 'three';
import type { SourceMaterial } from './textures';

/** How a Source material blends: 0 opaque, 1 alpha-tested, 2 translucent, 3 additive. */
export function alphaMode(s?: SourceMaterial): number {
  if (!s) return 0;
  if (s.additive) return 3;
  if (s.translucent) return 2;
  if (s.alphatest) return 1;
  return 0;
}

/**
 * Blend state for a Source material. The frame's alpha channel marks light
 * sources for the camera pass, so blending keeps the destination's alpha.
 */
export function applySourceBlend(mat: THREE.Material, s?: SourceMaterial): void {
  const mode = alphaMode(s);
  if (s?.nocull) mat.side = THREE.DoubleSide;
  if (mode < 2) return;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.SrcAlphaFactor;
  mat.blendDst = mode === 3 ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
}

/** The uniforms a Source material's blend and self-illumination need. */
export function sourceUniforms(s?: SourceMaterial): Record<string, THREE.IUniform> {
  const tint = Array.isArray(s?.selfillumtint) ? s!.selfillumtint : [1, 1, 1];
  return {
    alphaMode: { value: alphaMode(s) },
    alphaRef: { value: s?.alphatestreference ?? 0.5 },
    alphaMul: { value: s?.alpha ?? 1 },
    selfIllum: { value: s?.selfillum ? 1 : 0 },
    selfIllumTint: { value: new THREE.Vector3(tint[0], tint[1] ?? tint[0], tint[2] ?? tint[0]) },
  };
}
