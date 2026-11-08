import * as THREE from 'three';
import { type BrushDef, type FaceKey, FACE_KEYS, faceTex } from '../../data/map';
import type { TextureRegistry } from './textures';
import { makeWorldMaterial } from './worldMaterial';

type Axis = [number, number, number];

/**
 * Per face: outward normal, the "right" and "up" directions as seen by someone
 * looking at the face from outside (right × up = normal), and the fake
 * directional shade. UVs are world-aligned projections onto right/up, so
 * textures line up across neighbouring brushes, as in Hammer.
 */
export const FACE_FRAMES: Record<FaceKey, { n: Axis; r: Axis; u: Axis; shade: number }> = {
  px: { n: [1, 0, 0], r: [0, 1, 0], u: [0, 0, 1], shade: 0.82 },
  nx: { n: [-1, 0, 0], r: [0, -1, 0], u: [0, 0, 1], shade: 0.74 },
  py: { n: [0, 1, 0], r: [-1, 0, 0], u: [0, 0, 1], shade: 0.9 },
  ny: { n: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1], shade: 0.66 },
  pz: { n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0], shade: 1.0 },
  nz: { n: [0, 0, -1], r: [1, 0, 0], u: [0, -1, 0], shade: 0.58 },
};

const dot3 = (a: Axis, b: Axis) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

interface Batch { pos: number[]; uv: number[]; shade: number[]; idx: number[] }

/** Build render meshes for all brushes, batched into one mesh per texture. */
export function buildBrushMeshes(brushes: BrushDef[], textures: TextureRegistry): THREE.Group {
  const batches = new Map<string, Batch>();
  for (const b of brushes) {
    for (const key of FACE_KEYS) addFace(b, key, batches, textures);
  }
  const group = new THREE.Group();
  group.name = 'world';
  for (const [tex, bt] of batches) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(bt.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(bt.uv, 2));
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

function addFace(b: BrushDef, key: FaceKey, batches: Map<string, Batch>, textures: TextureRegistry): void {
  const f = FACE_FRAMES[key];
  const ft = faceTex(b, key);
  const { min, max } = b;
  // Face plane position along its normal axis.
  const ax = f.n.findIndex((c) => c !== 0);
  const plane = f.n[ax] > 0 ? max[ax] : min[ax];
  const ra = f.r.findIndex((c) => c !== 0);
  const ua = f.u.findIndex((c) => c !== 0);
  if (max[ra] - min[ra] <= 0 || max[ua] - min[ua] <= 0) return;

  // Corners counter-clockwise seen from outside: (r0,u0) (r1,u0) (r1,u1) (r0,u1).
  const rLo = f.r[ra] > 0 ? min[ra] : max[ra];
  const rHi = f.r[ra] > 0 ? max[ra] : min[ra];
  const uLo = f.u[ua] > 0 ? min[ua] : max[ua];
  const uHi = f.u[ua] > 0 ? max[ua] : min[ua];
  const corners: Axis[] = [[rLo, uLo, 0], [rHi, uLo, 0], [rHi, uHi, 0], [rLo, uHi, 0]].map(([r, u]) => {
    const p: Axis = [0, 0, 0];
    p[ax] = plane; p[ra] = r; p[ua] = u;
    return p;
  });

  const tex = textures.get(ft.tex);
  let bt = batches.get(ft.tex);
  if (!bt) { bt = { pos: [], uv: [], shade: [], idx: [] }; batches.set(ft.tex, bt); }
  const base = bt.pos.length / 3;
  const rot = (ft.rot * Math.PI) / 180;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const sx = ft.scale[0] || 1, sy = ft.scale[1] || 1;
  for (const p of corners) {
    bt.pos.push(p[0], p[1], p[2]);
    const wu = dot3(p, f.r), wv = dot3(p, f.u);
    const ru = wu * cr - wv * sr, rv = wu * sr + wv * cr;
    bt.uv.push((ru / sx + ft.offset[0]) / tex.width, (rv / sy + ft.offset[1]) / tex.height);
    bt.shade.push(f.shade);
  }
  bt.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
