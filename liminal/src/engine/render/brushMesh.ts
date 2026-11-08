import * as THREE from 'three';
import { type Face, type LightmapLayout, facePoint } from '../light/faces';
import type { TextureRegistry } from './textures';
import { makeWorldMaterial } from './worldMaterial';

interface Batch { pos: number[]; uv: number[]; lm: number[]; shade: number[]; idx: number[] }

/**
 * Build render meshes for all faces, batched into one mesh per texture.
 * With a lightmap layout, each vertex also gets a lightmap UV pointing at the
 * centre of its face's corner luxel.
 */
export function buildFaceMeshes(faces: Face[], textures: TextureRegistry, layout: LightmapLayout | null): THREE.Group {
  const batches = new Map<string, Batch>();
  for (const f of faces) {
    let bt = batches.get(f.tex);
    if (!bt) { bt = { pos: [], uv: [], lm: [], shade: [], idx: [] }; batches.set(f.tex, bt); }
    const tex = textures.get(f.tex);
    const rect = layout?.rects.get(f.id);
    const base = bt.pos.length / 3;
    const rot = (f.rot * Math.PI) / 180;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const sx = f.scale[0] || 1, sy = f.scale[1] || 1;
    // Corners counter-clockwise seen from outside.
    for (const [s, t] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const p = facePoint(f, s * f.width, t * f.height);
      bt.pos.push(p[0], p[1], p[2]);
      // World-aligned texture projection.
      const wu = p[0] * f.r[0] + p[1] * f.r[1] + p[2] * f.r[2];
      const wv = p[0] * f.u[0] + p[1] * f.u[1] + p[2] * f.u[2];
      const ru = wu * cr - wv * sr, rv = wu * sr + wv * cr;
      bt.uv.push((ru / sx + f.offset[0]) / tex.worldW, (rv / sy + f.offset[1]) / tex.worldH);
      if (rect && layout) {
        bt.lm.push((rect.x + 0.5 + s * (rect.w - 1)) / layout.width, (rect.y + 0.5 + t * (rect.h - 1)) / layout.height);
      } else bt.lm.push(0, 0);
      bt.shade.push(f.shade);
    }
    bt.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const group = new THREE.Group();
  group.name = 'world';
  for (const [tex, bt] of batches) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(bt.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(bt.uv, 2));
    geo.setAttribute('lmuv', new THREE.Float32BufferAttribute(bt.lm, 2));
    geo.setAttribute('shade', new THREE.Float32BufferAttribute(bt.shade, 1));
    geo.setIndex(bt.idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, makeWorldMaterial(textures.get(tex).texture));
    mesh.name = `tex:${tex}`;
    group.add(mesh);
  }
  return group;
}

export function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
  });
}
