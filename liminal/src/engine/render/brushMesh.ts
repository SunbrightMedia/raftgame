import * as THREE from 'three';
import type { Face, LightmapLayout } from '../light/faces';
import type { TextureRegistry } from './textures';
import { makeWorldMaterial } from './worldMaterial';
import { applySourceBlend } from './sourceMaterial';
import { makeSourceWorldMaterial } from './sourceWorldMaterial';
import { emitterColor } from '../light/units';
import { surfaceFor } from './surfaces';
import { OCCLUDER_LAYER } from './renderer';
import { faceBatches, type FaceBatch } from './faceBatches';

/**
 * Build render meshes for all faces, batched into one mesh per texture.
 * With a lightmap layout, each vertex also gets a lightmap UV pointing at the
 * centre of its face's corner luxel.
 */
export function buildFaceMeshes(faces: Face[], textures: TextureRegistry, layout: LightmapLayout | null, offsetOf?: (brushId: number) => [number, number, number] | undefined): THREE.Group {
  return meshesFromBatches(faceBatches(faces, (tex) => textures.get(tex), layout, offsetOf), textures, layout);
}

/** Batches of vertices (faceBatches.ts; plain or typed arrays) as meshes, one per texture. `shared`: materials kept from call to call (a world loaded piece by piece: every piece draws a texture with the one material). */
export function meshesFromBatches(batches: Map<string, { [K in keyof FaceBatch]: ArrayLike<number> }>, textures: TextureRegistry, layout: LightmapLayout | null, shared?: Map<string, THREE.Material>): THREE.Group {
  const group = new THREE.Group();
  group.name = 'world';
  // One material per texture. Overlapping coplanar faces (common with hand-drawn brushes) would z-fight and
  // flicker: a small, distinct depth bias per texture makes one surface win consistently instead.
  const materialFor = (tex: string, order: number): THREE.Material => {
    const entry = textures.get(tex);
    const surf = surfaceFor(tex, entry.material);
    const height = !entry.emissive && surf.bump > 0 ? textures.heightOf(tex, surf.relief, !!surf.reliefInvert) : undefined;
    let mat: THREE.Material;
    // Source sky faces: the skybox shows there (this map's is plain black).
    if (layout?.source && /(^|\/)skybox\//.test(tex)) mat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    else if (layout?.source) {
      const raw = (file?: string) => (file ? textures.rawTexture(file.replace(/\.\w+$/, '')) : null);
      mat = makeSourceWorldMaterial(entry, raw(entry.source?.normal), raw(entry.source?.detail?.file));
    }
    else {
      mat = makeWorldMaterial(entry.texture, surf, entry.emissive ? { luminance: entry.emissive.luminance, color: emitterColor(entry.emissive), anim: entry.emissive.anim } : undefined, height, entry.source);
      applySourceBlend(mat, entry.source);
    }
    // Overlapping coplanar faces (common with hand-drawn brushes) would
    // z-fight and flicker. A small, distinct depth bias per texture batch
    // makes one surface win consistently instead.
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = 0;
    mat.polygonOffsetUnits = -order;
    return mat;
  };
  let batchIndex = 0;
  for (const [tex, bt] of batches) {
    const geo = new THREE.BufferGeometry();
    const attr = (a: ArrayLike<number>, n: number) => (a instanceof Float32Array ? new THREE.BufferAttribute(a, n) : new THREE.Float32BufferAttribute(a as number[], n));
    geo.setAttribute('position', attr(bt.pos, 3));
    geo.setAttribute('normal', attr(bt.nrm, 3));
    geo.setAttribute('uv', attr(bt.uv, 2));
    geo.setAttribute('lmuv', attr(bt.lm, 2));
    geo.setAttribute('lmoff', attr(bt.lmoff, 1));
    geo.setAttribute('shade', attr(bt.shade, 1));
    geo.setAttribute('gu', attr(bt.gu, 3));
    geo.setAttribute('gv', attr(bt.gv, 3));
    geo.setIndex(bt.idx instanceof Uint32Array ? new THREE.BufferAttribute(bt.idx, 1) : (bt.idx as number[]));
    geo.computeBoundingSphere();
    let mat = shared?.get(tex);
    if (!mat) {
      mat = materialFor(tex, shared ? shared.size : batchIndex);
      shared?.set(tex, mat);
    }
    batchIndex++;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `tex:${tex}`;
    // An opaque surface with no holes hides what is behind it: drawn first, depth only (renderer.ts).
    const alphaMode = (mat as THREE.ShaderMaterial).uniforms?.alphaMode?.value as number | undefined;
    if (!mat.transparent && (alphaMode === undefined || alphaMode === 0)) mesh.layers.enable(OCCLUDER_LAYER);
    group.add(mesh);
  }
  return group;
}

/** Frees a group's geometry and its materials (not the materials when they are shared with other groups: `keepMaterials`). */
export function disposeGroup(g: THREE.Object3D, keepMaterials = false): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material && !keepMaterials) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
  });
}
