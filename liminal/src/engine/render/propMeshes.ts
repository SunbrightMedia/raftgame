import * as THREE from 'three';
import type { EntityDef } from '../../data/map';
import type { ModelRegistry } from './models';
import { sourceAnglesMatrix } from './models';
import type { TextureRegistry } from './textures';
import { makePropMaterial, propLightUniforms } from './propMaterial';
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

/** Props are batched per region of this size, so the renderer can skip whole regions (out of view, or lost in fog). */
export const PROP_REGION = 4096;

/**
 * Props drawn instanced: one InstancedMesh per (model, skin, region of the
 * map), its materials picked per mesh slot by the skin table.
 */
export function buildPropMeshes(entities: EntityDef[], models: ModelRegistry, textures: TextureRegistry, offsetOf?: (e: EntityDef) => [number, number, number] | undefined): THREE.Group {
  const group = new THREE.Group();
  group.name = 'props';
  const batches = new Map<string, { model: string; skin: number; mats: THREE.Matrix4[]; light: number[] }>();
  let bakeIndex = 0;
  for (const e of entities) {
    const name = propModel(e);
    if (!name || !models.get(name)) continue;
    const bi = bakeIndex++;
    const skin = typeof e.props?.skin === 'number' ? e.props.skin : 0;
    const R = PROP_REGION;
    const key = `${name.toLowerCase()}#${skin}#${Math.floor(e.origin[0] / R)},${Math.floor(e.origin[1] / R)},${Math.floor(e.origin[2] / R)}`;
    let b = batches.get(key);
    if (!b) { b = { model: name, skin, mats: [], light: [] }; batches.set(key, b); }
    b.light.push(bi);
    const scale = typeof e.props?.scale === 'number' ? e.props.scale : 1;
    const off = offsetOf?.(e);
    b.mats.push(sourceAnglesMatrix(e.angles, off ? [e.origin[0] + off[0], e.origin[1] + off[1], e.origin[2] + off[2]] : e.origin, scale));
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
    // Own geometry object (sharing the model's buffers) so each mesh carries its instances' light offsets.
    const geo = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(model.geometry.attributes)) geo.setAttribute(k, a);
    geo.setIndex(model.geometry.index);
    for (const gr of model.geometry.groups) geo.addGroup(gr.start, gr.count, gr.materialIndex);
    geo.boundingSphere = model.geometry.boundingSphere;
    geo.setAttribute('lightOffset', new THREE.InstancedBufferAttribute(new Float32Array(b.mats.length), 1));
    const mesh = new THREE.InstancedMesh(geo, mats, b.mats.length);
    b.mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    // Which baked prop each instance is (propBakeData order), for its per-vertex light (setPropLight).
    mesh.userData.bakeIndex = b.light;
    mesh.computeBoundingSphere();
    // For cullProps: how big one of these is (the model's own radius × the largest scale among the instances).
    const sx = new THREE.Vector3();
    mesh.userData.size = (model.geometry.boundingSphere?.radius ?? 64) * Math.max(...b.mats.map((m) => sx.setFromMatrixScale(m).x));
    mesh.name = `prop:${key}`;
    group.add(mesh);
  }
  return group;
}

/**
 * Hide the prop batches nobody could see from `eye`: regions wholly past
 * `reach` (where the fog has swallowed everything), and things too small to
 * matter at their distance (`detail` = how many times its own size away a
 * thing is still drawn; 0 = always). Out-of-view batches are skipped by the
 * renderer itself.
 */
export function cullProps(g: THREE.Group, eye: THREE.Vector3, reach: number, detail: number): void {
  for (const o of g.children) {
    const m = o as THREE.InstancedMesh;
    const bs = m.boundingSphere;
    if (!m.isInstancedMesh || !bs) continue;
    const d = Math.max(0, bs.center.distanceTo(eye) - bs.radius);
    m.visible = d <= reach && (detail <= 0 || d <= (m.userData.size as number) * detail);
  }
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

/**
 * Per-vertex baked light for every prop (vradProps.ts): one RGBA half-float
 * texture holding all instances' vertices in a row; each instance reads from
 * its own offset by vertex index.
 */
export function setPropLight(g: THREE.Group, colors: Float32Array, offsets: Int32Array): void {
  const W = 2048, n = colors.length / 3, H = Math.max(1, Math.ceil(n / W));
  const half = new Uint16Array(W * H * 4);
  for (let i = 0; i < n; i++) {
    half[i * 4] = THREE.DataUtils.toHalfFloat(Math.min(65000, colors[i * 3]));
    half[i * 4 + 1] = THREE.DataUtils.toHalfFloat(Math.min(65000, colors[i * 3 + 1]));
    half[i * 4 + 2] = THREE.DataUtils.toHalfFloat(Math.min(65000, colors[i * 3 + 2]));
  }
  const tex = new THREE.DataTexture(half, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  propLightUniforms.propLight.value?.dispose();
  propLightUniforms.propLight.value = tex;
  propLightUniforms.propLightOn.value = 1;
  g.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if (!m.isInstancedMesh || !m.userData.bakeIndex) return;
    const idx = m.userData.bakeIndex as number[];
    const attr = m.geometry.getAttribute('lightOffset') as THREE.InstancedBufferAttribute;
    idx.forEach((bi, i) => { attr.array[i] = offsets[bi]; });
    attr.needsUpdate = true;
  });
}
