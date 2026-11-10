import * as THREE from 'three';
import type { EntityDef } from '../../data/map';
import type { ModelRegistry } from './models';
import { sourceAnglesMatrix } from './models';
import type { TextureRegistry } from './textures';
import { makePropMaterial } from './propMaterial';
import { propModel } from '../collision/props';


/** Every material a set of prop entities can draw with (for TextureRegistry.prepare). */
export function propMaterials(entities: EntityDef[], models: ModelRegistry): string[] {
  const out = new Set<string>();
  for (const e of entities) {
    const name = propModel(e);
    if (name) models.header(name)?.materials.forEach((m) => out.add(m));
  }
  return [...out];
}

/**
 * Props drawn instanced: one InstancedMesh per (model, skin), its materials
 * picked per mesh slot by the skin table.
 */
export function buildPropMeshes(entities: EntityDef[], models: ModelRegistry, textures: TextureRegistry): THREE.Group {
  const group = new THREE.Group();
  group.name = 'props';
  const batches = new Map<string, { model: string; skin: number; mats: THREE.Matrix4[] }>();
  for (const e of entities) {
    const name = propModel(e);
    if (!name || !models.get(name)) continue;
    const skin = typeof e.props?.skin === 'number' ? e.props.skin : 0;
    const key = `${name.toLowerCase()}#${skin}`;
    let b = batches.get(key);
    if (!b) { b = { model: name, skin, mats: [] }; batches.set(key, b); }
    const scale = typeof e.props?.scale === 'number' ? e.props.scale : 1;
    b.mats.push(sourceAnglesMatrix(e.angles, e.origin, scale));
  }
  const materials = new Map<string, THREE.Material>();
  const material = (tex: string) => {
    let m = materials.get(tex);
    if (!m) { m = makePropMaterial(textures.get(tex)); materials.set(tex, m); }
    return m;
  };
  for (const [key, b] of batches) {
    const model = models.get(b.model)!;
    const h = model.header;
    const table = h.skins[b.skin] ?? h.skins[0] ?? h.materials.map((_, i) => i);
    const slots = Math.max(table.length, ...h.meshes.map((m) => m.slot + 1));
    const mats = Array.from({ length: slots }, (_, slot) => material(h.materials[table[slot] ?? slot] ?? 'missing'));
    const mesh = new THREE.InstancedMesh(model.geometry, mats, b.mats.length);
    b.mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = `prop:${key}`;
    group.add(mesh);
  }
  return group;
}

/** Dispose prop materials (geometry belongs to the ModelRegistry and is shared). */
export function disposeProps(g: THREE.Group): void {
  const seen = new Set<THREE.Material>();
  g.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if (!m.isInstancedMesh) return;
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => { if (!seen.has(x)) { seen.add(x); x.dispose(); } });
    m.dispose();
  });
}
