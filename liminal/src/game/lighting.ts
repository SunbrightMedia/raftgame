import * as THREE from 'three';
import BakeWorker from '../engine/light/bake.worker?worker&inline';
import type { BakeInput, BakeLight, BakeOutput } from '../engine/light/bake';
import { BR30_65W, cosNPeak, kelvinToLinear, emitterColor } from '../engine/light/units';
import { layoutLightmap, solidPlanes, type LightmapLayout } from '../engine/light/faces';
import type { TextureRegistry } from '../engine/render/textures';
import type { Settings } from '../data/settings';
import type { Level } from './level';
import type { Storage } from '../data/storage';


/** Bump when the baker's output changes meaning, so old caches are ignored. */
const BAKE_VERSION = 4;

/**
 * Cached lightmap: RGBE (Ward's shared-exponent format, as in Radiance .hdr)
 * at 4 bytes per texel, deflated, base64. Lighting is smooth, so this is
 * ~10–20× smaller than raw half floats.
 */
interface LightmapCache { format: 'liminal-lightmap'; version: number; encoding: 'rgbe-deflate'; key: string; width: number; height: number; luxel: number; data: string }

/** FNV-1a, enough to tell whether a map or its lighting settings changed. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

const toBase64 = (bytes: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromBase64 = (b64: string) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

/** RGBA floats → 5 bytes per texel: RGBE irradiance + the 0..1 shadow fraction. */
function encodeRGBE(px: Float32Array): Uint8Array {
  const n = px.length / 4;
  // 5 bytes per texel: RGBE for the irradiance, 1 byte for the shadow fraction.
  const out = new Uint8Array(n * 5);
  for (let i = 0; i < n; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    const m = Math.max(r, g, b);
    if (m > 1e-6) {
      const e = Math.ceil(Math.log2(m) + 1e-9);
      const sc = 255 / Math.pow(2, e);
      out[i * 5] = Math.min(255, Math.round(r * sc)); out[i * 5 + 1] = Math.min(255, Math.round(g * sc)); out[i * 5 + 2] = Math.min(255, Math.round(b * sc));
      out[i * 5 + 3] = e + 128;
    }
    out[i * 5 + 4] = Math.round(Math.max(0, Math.min(1, px[i * 4 + 3])) * 255);
  }
  return out;
}
// Each RGBE channel is one of 256 mantissas × 256 exponents, so the half-float
// for every (exponent, mantissa) pair is computed once and looked up after.
let halfLUT: Uint16Array | null = null;
function decodeRGBEToHalf(bytes: Uint8Array): Uint16Array {
  if (!halfLUT) {
    halfLUT = new Uint16Array(65536);
    for (let e = 1; e < 256; e++) {
      const sc = Math.pow(2, e - 128) / 255;
      for (let m = 0; m < 256; m++) halfLUT[(e << 8) | m] = THREE.DataUtils.toHalfFloat(Math.min(65000, m * sc));
    }
  }
  const lut = halfLUT;
  const alpha = new Uint16Array(256);
  for (let a = 0; a < 256; a++) alpha[a] = THREE.DataUtils.toHalfFloat(a / 255);
  const n = bytes.length / 5;
  const half = new Uint16Array(n * 4);
  for (let i = 0, j = 0, k = 0; i < n; i++, j += 5, k += 4) {
    const e = bytes[j + 3] << 8; // e = 0 maps to the zeroed first row: black
    half[k] = lut[e | bytes[j]];
    half[k + 1] = lut[e | bytes[j + 1]];
    half[k + 2] = lut[e | bytes[j + 2]];
    half[k + 3] = alpha[bytes[j + 4]];
  }
  return half;
}
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/**
 * Keeps the level's lightmap in step with the map and the light settings.
 *
 * Like Source, lightmaps are computed once and shipped with the map: a bake
 * is cached in maps/<name>.lightmap.json, keyed by a hash of the map and every
 * setting that affects lighting. Loading a map with a matching cache is
 * instant. When something changed: a quick low-detail bake shows within a
 * fraction of a second, then the full bake replaces it (and, on the dev
 * server, is written back to the cache). Bakes run in a worker; a new request
 * cancels one in progress.
 */
export class Lighting {
  private worker: Worker | null = null;
  private seq = 0;
  /** performance.now() when this map's lighting was first applied; 0 while it has none. */
  shownAt = 0;
  private timer: number | undefined;
  private lastKey = '';
  status = 'not baked';
  onBaked: ((layout: LightmapLayout, tex: THREE.DataTexture) => void) | null = null;

  constructor(private storage: Storage) {}

  private keyFor(level: Level, s: Settings): string {
    const { filter: _f, ...bakeSettings } = s.light; // filtering doesn't need a re-bake
    void _f;
    return hash(JSON.stringify([BAKE_VERSION, bakeSettings, s.textures, level.map.brushes, level.map.entities]));
  }

  /** Ask for lighting if anything that affects it changed. */
  request(level: Level, s: Settings, textures: TextureRegistry, force = false): void {
    if (!s.light.enabled) return;
    const key = this.keyFor(level, s);
    if (!force && key === this.lastKey) return;
    const firstForMap = force;
    if (force) this.shownAt = 0;
    this.lastKey = key;
    clearTimeout(this.timer);
    // Map load: no debounce. Slider drags: wait for a pause.
    this.timer = window.setTimeout(() => void this.start(level, s, textures, key, firstForMap), firstForMap ? 0 : 200);
  }

  private cachePath(level: Level): string { return `maps/${level.map.name}.lightmap.json`; }

  private async start(level: Level, s: Settings, textures: TextureRegistry, key: string, tryCache: boolean): Promise<void> {
    const gen = ++this.seq;
    const L = s.light;
    const layout = layoutLightmap(level.faces, Math.max(2, L.luxelSize));
    if (tryCache) {
      try {
        const text = await this.storage.read(this.cachePath(level));
        const c = text ? (JSON.parse(text) as LightmapCache) : null;
        if (gen !== this.seq) return;
        if (c && c.key === key && c.encoding === 'rgbe-deflate' && c.width === layout.width && c.height === layout.height) {
          const t0 = performance.now();
          const half = decodeRGBEToHalf(await pipe(fromBase64(c.data), new DecompressionStream('deflate-raw')));
          if (gen !== this.seq) return;
          this.apply(layout, half, L.filter);
          this.status = `lighting loaded from cache (${Math.round(performance.now() - t0)} ms)`;
          this.shownAt = performance.now();
          return;
        }
      } catch { /* no cache: bake */ }
    }

    this.worker?.terminate();
    this.worker = new BakeWorker();
    // 1) Quick preview: coarse luxels, few rays. 2) The full bake.
    const quickLuxel = Math.max(L.luxelSize, 32);
    const quickLayout = layoutLightmap(level.faces, quickLuxel);
    const quick = this.buildInput(level, s, textures, quickLayout, { bounces: Math.min(1, L.bounces), bounceSamples: 8 });
    const full = this.buildInput(level, s, textures, layout, {});
    this.status = 'baking…';
    let fullDone = false;
    this.worker.onmessage = (e: MessageEvent<{ id: number; out: BakeOutput }>) => {
      if (gen !== this.seq) return;
      const out = e.data.out;
      const half = new Uint16Array(out.pixels.length);
      for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(65000, out.pixels[i]));
      if (e.data.id === 0) {
        if (fullDone) return;
        this.apply(quickLayout, half, L.filter);
        this.status = `preview lighting (${out.ms} ms), full bake running…`;
        this.shownAt ||= performance.now();
        return;
      }
      fullDone = true;
      this.apply(layout, half, L.filter);
      this.status = `baked ${out.luxels.toLocaleString()} luxels, ${out.lights} lights in ${out.ms} ms`;
      this.shownAt ||= performance.now();
      this.worker?.terminate();
      this.worker = null;
      // Save wherever this build saves files (map folder on the dev server, the
      // artifact's db, localStorage), so the same map + settings never bakes twice.
      void pipe(encodeRGBE(out.pixels), new CompressionStream('deflate-raw')).then((z) => {
        const cache: LightmapCache = { format: 'liminal-lightmap', version: BAKE_VERSION, encoding: 'rgbe-deflate', key, width: out.width, height: out.height, luxel: L.luxelSize, data: toBase64(z) };
        return this.storage.write(this.cachePath(level), JSON.stringify(cache));
      }).then(() => { if (gen === this.seq) this.status += ' · cached'; }, (e) => console.warn('lightmap cache not saved', e));
    };
    this.worker.onerror = (e) => { this.status = `bake failed: ${e.message}`; };
    this.worker.postMessage({ id: 0, input: quick });
    this.worker.postMessage({ id: 1, input: full });
  }

  private apply(layout: LightmapLayout, half: Uint16Array, filter: string): void {
    // Irradiance in lux, linear: half-float keeps the range and filters on every WebGL2 GPU.
    const tex = new THREE.DataTexture(half, layout.width, layout.height, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.colorSpace = THREE.NoColorSpace;
    tex.magFilter = tex.minFilter = filter === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.onBaked?.(layout, tex);
  }

  private buildInput(level: Level, s: Settings, textures: TextureRegistry, layout: LightmapLayout, over: Partial<{ bounces: number; bounceSamples: number }>): BakeInput {
    const L = s.light;
    const emissive: BakeInput['emissive'] = {};
    const albedo: BakeInput['albedo'] = {};
    for (const f of level.faces) {
      const t = textures.get(f.tex);
      albedo[f.tex] = t.albedo;
      if (t.emissive && t.emissive.castsLight) emissive[f.tex] = { color: emitterColor(t.emissive), luminance: t.emissive.luminance };
    }
    return {
      faces: level.faces,
      width: layout.width,
      height: layout.height,
      rects: [...layout.rects],
      boxes: level.map.brushes.filter((b) => b.solid !== false).map(solidPlanes),
      lights: mapLights(level),
      emissive,
      albedo,
      params: {
        ambient: [L.ambientLux, L.ambientLux, L.ambientLux],
        lightScale: L.lightScale,
        bounces: over.bounces ?? L.bounces,
        bounceScale: L.bounceScale,
        bounceSamples: over.bounceSamples ?? L.bounceSamples,
        surfaceSpacing: 16,
        aoStrength: L.aoStrength,
        aoRadius: L.aoRadius,
        aoDirect: L.aoDirect,
        aoCurve: L.aoCurve,
        extraBounces: L.extraBounces,
      },
    };
  }
}

type Props = Record<string, unknown>;

/**
 * A map "light" entity → a physical light.
 *   lumens: total luminous flux (a 60 W incandescent A19 ≈ 800 lm)
 *   kelvin: colour temperature (incandescent 2700, warm-white fluorescent 3000–3500, cool-white 4100)
 *   type:   "can"  — BR30 flood in a 6" recessed can: cos^1.4 beam, 50° cutoff, 85% efficiency
 *           "bulb" — bare bulb, equal in every direction: I = lm / 4π
 *           "down" / "up" — flat Lambertian emitter facing down/up: I0 = lm / π
 *           "dome" — flush-mount frosted dome on the ceiling: wide downward
 *                    cos^0.6 lobe, nothing upward, so the ceiling above it
 *                    doesn't get the hot spot a bare bulb throws
 * Units and sources: see engine/light/units.ts.
 */
export function lightFromEntity(origin: [number, number, number], p: Props): BakeLight {
  const num = (k: string, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : d);
  const color = kelvinToLinear(num('kelvin', 2700));
  const type = typeof p.type === 'string' ? p.type : 'bulb';
  if (type === 'can') {
    const lm = num('lumens', BR30_65W.lumens);
    return { pos: origin, color, I0: cosNPeak(lm, BR30_65W.n) * BR30_65W.efficiency, dir: [0, 0, -1], n: BR30_65W.n, cutoffDeg: num('cutoff', BR30_65W.cutoffDeg), softDeg: BR30_65W.softDeg, spill: BR30_65W.spill };
  }
  if (type === 'dome') {
    const n = 0.6, lm = num('lumens', 800) * 0.8; // ~80% gets out through the glass
    return { pos: origin, color, I0: cosNPeak(lm, n), dir: [0, 0, -1], n, cutoffDeg: 88, softDeg: 2, spill: 0 };
  }
  if (type === 'down' || type === 'up') {
    return { pos: origin, color, I0: num('lumens', 400) / Math.PI, dir: [0, 0, type === 'down' ? -1 : 1], n: 1 };
  }
  return { pos: origin, color, I0: num('lumens', 800) / (4 * Math.PI) };
}

/** Most per-pixel lights the world shader takes (cans and bulbs beyond this are baked). */
export const MAX_DYNAMIC = 32;

/**
 * All of a map's lights. Cans and bare bulbs (the first MAX_DYNAMIC) are
 * marked dynamic: the shader draws their direct light per pixel so beam edges
 * (the scallops) stay crisp; the bake handles their shadows and bounce.
 */
export function mapLights(level: Level): BakeLight[] {
  let dyn = 0;
  return level.map.entities.filter((e) => e.class === 'light').map((e) => {
    const l = lightFromEntity(e.origin, e.props ?? {});
    const t = (e.props ?? {}).type ?? 'bulb';
    if ((t === 'can' || t === 'bulb' || t === 'dome') && dyn < MAX_DYNAMIC) { l.dynamic = true; dyn++; }
    return l;
  });
}
