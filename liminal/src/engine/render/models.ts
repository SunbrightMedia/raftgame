import * as THREE from 'three';
import * as assets from '@globs';

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
  /** Player collision: convex pieces of the Source collision model (planes [nx, ny, nz, d], corner points). */
  collision?: { planes: number[][]; points: number[][] }[];
}

/** Catalogue build: where a model's compacted data is (tools/source/pack_catalogue.py). */
interface PackRef { n: number; offset: number; length: number; pos: [number[], number[]]; uv: [number[], number[]]; wide: boolean }

export interface Model {
  header: ModelHeader;
  /** One geometry, one group per mesh (materialIndex = material slot). */
  geometry: THREE.BufferGeometry;
}

export class ModelRegistry {
  private headers = new Map<string, { header: ModelHeader; url: string; pack?: PackRef }>();
  private packs = new Map<number, Promise<Uint8Array>>();
  private packUrls: Record<string, string> = {};
  private models = new Map<string, Model>();

  constructor() {
    // Reference models (models/p2: Valve's, for calibration) are dev-only, never published.
    const heads = assets.modelHeads as Record<string, ModelHeader>;
    const bins = assets.modelBins;
    if (assets.catalogue.models) {
      this.packUrls = assets.catalogue.packs;
      for (const h of Object.values(assets.catalogue.models as Record<string, ModelHeader & { pack: PackRef }>)) this.headers.set(h.source.toLowerCase(), { header: h, url: '', pack: h.pack });
    }
    for (const [path, h] of Object.entries(heads)) {
      if (h?.format !== 'liminal-mesh') continue;
      const url = bins[path.replace(/[^/]*$/, h.bin)];
      if (url) this.headers.set(h.source.toLowerCase(), { header: h, url });
    }
  }

  private pack(n: number): Promise<Uint8Array> {
    let p = this.packs.get(n);
    if (!p) {
      const url = Object.entries(this.packUrls).find(([k]) => k.endsWith(`pack_${String(n).padStart(3, '0')}.png`))?.[1];
      p = url ? unpackPng(url) : Promise.reject(new Error(`no pack ${n}`));
      this.packs.set(n, p);
    }
    return p;
  }

  header(name: string): ModelHeader | undefined {
    return this.headers.get(name.toLowerCase())?.header;
  }

  /** Every model's collision (its hull box, its collision model's pieces), by name in lower case: what a worker needs to make a lot's solids. */
  shapes(): Record<string, { hull: ModelHeader['hull']; collision?: ModelHeader['collision'] }> {
    const out: Record<string, { hull: ModelHeader['hull']; collision?: ModelHeader['collision'] }> = {};
    for (const [name, h] of this.headers) out[name] = { hull: h.header.hull, collision: h.header.collision };
    return out;
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
        if (e.pack) {
          const bytes = await this.pack(e.pack.n);
          this.models.set(n, { header: e.header, geometry: buildPackedGeometry(e.header, e.pack, bytes) });
          return;
        }
        // Builds that inline model data (npm run build:atrium) hand a data: URL; decode it without fetch.
        const buf = e.url.startsWith('data:') ? dataUrlBytes(e.url) : await (await fetch(e.url)).arrayBuffer();
        this.models.set(n, { header: e.header, geometry: buildGeometry(e.header, buf) });
      } catch (err) {
        console.warn(`model ${n} failed to load`, err);
      }
    }));
  }
}

/** A pack's bytes: a grey PNG (rows of 4096 bytes, filter 0) holding raw data; inflated here, so nothing alters it. */
async function unpackPng(url: string): Promise<Uint8Array> {
  const b = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const dv = new DataView(b.buffer);
  let o = 8, width = 0, height = 0;
  const idat: Uint8Array[] = [];
  while (o < b.length) {
    const len = dv.getUint32(o), type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    if (type === 'IHDR') { width = dv.getUint32(o + 8); height = dv.getUint32(o + 12); }
    if (type === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const z = new Blob(idat as BlobPart[]).stream().pipeThrough(new DecompressionStream('deflate'));
  const raw = new Uint8Array(await new Response(z).arrayBuffer());
  const out = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) out.set(raw.subarray(r * (width + 1) + 1, (r + 1) * (width + 1)), r * width);
  return out;
}

function buildPackedGeometry(h: ModelHeader, p: PackRef, all: Uint8Array): THREE.BufferGeometry {
  const n = h.vertexCount, ni = h.indexCount;
  const b = all.slice(p.offset, p.offset + p.length).buffer;
  const al = (x: number) => (x + 3) & ~3;
  let o = 0;
  const qp = new Int16Array(b, o, n * 3); o += al(n * 6);
  const qu = new Int16Array(b, o, n * 2); o += al(n * 4);
  const qn = new Int8Array(b, o, n * 3); o += al(n * 3);
  const qi = p.wide ? new Uint32Array(b, o, ni) : new Uint16Array(b, o, ni);
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let i = 0; i < n * 3; i++) { const k = i % 3; pos[i] = p.pos[0][k] + ((qp[i] + 32768) / 65535) * p.pos[1][k]; nrm[i] = qn[i] / 127; }
  for (let i = 0; i < n * 2; i++) { const k = i % 2; uv[i] = p.uv[0][k] + ((qu[i] + 32768) / 65535) * p.uv[1][k]; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(qi), 1));
  for (const m of h.meshes) g.addGroup(m.indexOffset, m.indexCount, m.slot);
  g.computeBoundingSphere();
  return g;
}

function dataUrlBytes(url: string): ArrayBuffer {
  const b64 = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(b64.length);
  for (let i = 0; i < b64.length; i++) out[i] = b64.charCodeAt(i);
  return out.buffer;
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
