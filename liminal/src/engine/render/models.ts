import * as THREE from 'three';

/**
 * Meshes converted from other formats (tools/source/convert_models.py): a JSON
 * header plus a .bin of float32 positions, normals, uvs, then uint32 indices.
 * Each mesh draws with a material slot; a skin maps slots to materials.
 */
export interface ModelHeader {
  format: 'liminal-mesh';
  version: number;
  /** The name maps use for it, e.g. "models/props_office/tv_1970.mdl". */
  source: string;
  bin: string;
  vertexCount: number;
  indexCount: number;
  materials: string[];
  skins: number[][];
  bounds: [[number, number, number], [number, number, number]];
  /** Collision box in model space (Source: the MDL's hull). */
  hull: [[number, number, number], [number, number, number]];
  meshes: { slot: number; vertexOffset: number; vertexCount: number; indexOffset: number; indexCount: number }[];
  /** Lightmap shadow shape (model space, 9 floats per triangle): collision model or per-mesh hulls. */
  shadow?: number[];
}

export interface Model {
  header: ModelHeader;
  /** One geometry, one group per mesh (materialIndex = material slot). */
  geometry: THREE.BufferGeometry;
}

export class ModelRegistry {
  private headers = new Map<string, { header: ModelHeader; url: string }>();
  private models = new Map<string, Model>();

  constructor() {
    // Reference models (models/p2: Valve's, for calibration) are dev-only, never published.
    const heads = (import.meta.env.MODE === 'page'
      ? import.meta.glob(['../../../models/**/*.json', '!../../../models/p2/**'], { eager: true, import: 'default' })
      : import.meta.glob('../../../models/**/*.json', { eager: true, import: 'default' })) as Record<string, ModelHeader>;
    const bins = (import.meta.env.MODE === 'page'
      ? import.meta.glob(['../../../models/**/*.bin', '!../../../models/p2/**'], { eager: true, query: '?url', import: 'default' })
      : import.meta.glob('../../../models/**/*.bin', { eager: true, query: '?url', import: 'default' })) as Record<string, string>;
    for (const [path, h] of Object.entries(heads)) {
      if (h?.format !== 'liminal-mesh') continue;
      const url = bins[path.replace(/[^/]*$/, h.bin)];
      if (url) this.headers.set(h.source.toLowerCase(), { header: h, url });
    }
  }

  header(name: string): ModelHeader | undefined {
    return this.headers.get(name.toLowerCase())?.header;
  }

  get(name: string): Model | undefined {
    return this.models.get(name.toLowerCase());
  }

  /** Fetch and build these models' geometry (call before building a level that uses them). */
  async prepare(names: Iterable<string>): Promise<void> {
    await Promise.all([...new Set([...names].map((n) => n.toLowerCase()))].map(async (n) => {
      const e = this.headers.get(n);
      if (!e || this.models.has(n)) return;
      try {
        const buf = await (await fetch(e.url)).arrayBuffer();
        this.models.set(n, { header: e.header, geometry: buildGeometry(e.header, buf) });
      } catch (err) {
        console.warn(`model ${n} failed to load`, err);
      }
    }));
  }
}

function buildGeometry(h: ModelHeader, buf: ArrayBuffer): THREE.BufferGeometry {
  const n = h.vertexCount;
  const pos = new Float32Array(buf, 0, n * 3);
  const nrm = new Float32Array(buf, n * 12, n * 3);
  const uv = new Float32Array(buf, n * 24, n * 2);
  const idx = new Uint32Array(buf, n * 32, h.indexCount);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  for (const m of h.meshes) g.addGroup(m.indexOffset, m.indexCount, m.slot);
  g.computeBoundingSphere();
  return g;
}

/**
 * Source entity angles (pitch, yaw, roll in degrees) → rotation, as Source's
 * AngleMatrix: yaw about Z, then pitch about Y, then roll about X
 * (R = Rz(yaw)·Ry(pitch)·Rx(roll); positive pitch tips the nose down).
 */
export function sourceAnglesMatrix(angles: [number, number, number] | undefined, origin: [number, number, number], scale = 1): THREE.Matrix4 {
  const [p, y, r] = (angles ?? [0, 0, 0]).map((a) => (a * Math.PI) / 180);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r, p, y, 'ZYX'));
  return new THREE.Matrix4().compose(new THREE.Vector3(...origin), q, new THREE.Vector3(scale, scale, scale));
}
