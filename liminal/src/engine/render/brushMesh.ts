import * as THREE from 'three';
import { type Face, type LightmapLayout, facePoint } from '../light/faces';
import type { TextureRegistry } from './textures';
import { makeWorldMaterial } from './worldMaterial';
import { emitterColor } from '../light/units';
import { surfaceFor } from './surfaces';

interface Batch { pos: number[]; nrm: number[]; uv: number[]; lm: number[]; shade: number[]; gu: number[]; gv: number[]; idx: number[] }

/**
 * Build render meshes for all faces, batched into one mesh per texture.
 * With a lightmap layout, each vertex also gets a lightmap UV pointing at the
 * centre of its face's corner luxel.
 */
export function buildFaceMeshes(faces: Face[], textures: TextureRegistry, layout: LightmapLayout | null): THREE.Group {
  const batches = new Map<string, Batch>();
  for (const f of faces) {
    let bt = batches.get(f.tex);
    if (!bt) { bt = { pos: [], nrm: [], uv: [], lm: [], shade: [], gu: [], gv: [], idx: [] }; batches.set(f.tex, bt); }
    const tex = textures.get(f.tex);
    const rect = layout?.rects.get(f.id);
    const base = bt.pos.length / 3;
    const rot = (f.rot * Math.PI) / 180;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const sx = f.scale[0] || 1, sy = f.scale[1] || 1;
    // How texture u and v change per inch moved across the face (for bump mapping).
    const ku = 1 / (sx * tex.worldW), kv = 1 / (sy * tex.worldH);
    const gu = [0, 1, 2].map((a) => (cr * f.r[a] - sr * f.u[a]) * ku);
    const gv = [0, 1, 2].map((a) => (sr * f.r[a] + cr * f.u[a]) * kv);
    // Outline counter-clockwise seen from outside: the polygon, or the rectangle.
    const outline: [number, number][] = f.poly ?? [[0, 0], [f.width, 0], [f.width, f.height], [0, f.height]];
    for (const [s, t] of outline) {
      const p = facePoint(f, s, t);
      bt.pos.push(p[0], p[1], p[2]);
      if (f.nS && !f.poly) {
        const nn = f.nS[s > f.width / 2 ? 1 : 0];
        bt.nrm.push(nn[0], nn[1], nn[2]);
      } else bt.nrm.push(f.n[0], f.n[1], f.n[2]);
      // World-aligned texture projection.
      const wu = p[0] * f.r[0] + p[1] * f.r[1] + p[2] * f.r[2];
      const wv = p[0] * f.u[0] + p[1] * f.u[1] + p[2] * f.u[2];
      const ru = wu * cr - wv * sr, rv = wu * sr + wv * cr;
      bt.uv.push((ru / sx + f.offset[0]) / tex.worldW, (rv / sy + f.offset[1]) / tex.worldH);
      if (rect && layout) {
        const fs = f.width > 0 ? s / f.width : 0, ft = f.height > 0 ? t / f.height : 0;
        bt.lm.push((rect.x + 0.5 + fs * (rect.w - 1)) / layout.width, (rect.y + 0.5 + ft * (rect.h - 1)) / layout.height);
      } else bt.lm.push(0, 0);
      bt.shade.push(f.shade);
      bt.gu.push(gu[0], gu[1], gu[2]);
      bt.gv.push(gv[0], gv[1], gv[2]);
    }
    // Convex: a triangle fan.
    for (let k = 1; k < outline.length - 1; k++) bt.idx.push(base, base + k, base + k + 1);
  }

  const group = new THREE.Group();
  group.name = 'world';
  let batchIndex = 0;
  for (const [tex, bt] of batches) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(bt.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(bt.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(bt.uv, 2));
    geo.setAttribute('lmuv', new THREE.Float32BufferAttribute(bt.lm, 2));
    geo.setAttribute('shade', new THREE.Float32BufferAttribute(bt.shade, 1));
    geo.setAttribute('gu', new THREE.Float32BufferAttribute(bt.gu, 3));
    geo.setAttribute('gv', new THREE.Float32BufferAttribute(bt.gv, 3));
    geo.setIndex(bt.idx);
    geo.computeBoundingSphere();
    const entry = textures.get(tex);
    const surf = surfaceFor(tex, entry.material);
    const height = !entry.emissive && surf.bump > 0 ? textures.heightOf(tex, surf.relief) : undefined;
    const mat = makeWorldMaterial(entry.texture, surf, entry.emissive ? { luminance: entry.emissive.luminance, color: emitterColor(entry.emissive), anim: entry.emissive.anim } : undefined, height);
    // Overlapping coplanar faces (common with hand-drawn brushes) would
    // z-fight and flicker. A small, distinct depth bias per texture batch
    // makes one surface win consistently instead.
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = 0;
    mat.polygonOffsetUnits = -batchIndex;
    batchIndex++;
    const mesh = new THREE.Mesh(geo, mat);
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
