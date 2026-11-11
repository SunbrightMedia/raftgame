import * as THREE from 'three';
import BakeWorker from '../engine/light/bake.worker?worker&inline';
import type { BakeInput, BakeLight, BakeOutput } from '../engine/light/bake';
import { SOURCE_LM_WIDTH, type SourceBakeInput, type SourceBakeOutput } from '../engine/light/vrad';
import { BR30_65W, cosNPeak, kelvinToLinear, emitterColor, INCH, srgbToLinear } from '../engine/light/units';
import { layoutLightmap, solidPlanes, type LightmapLayout } from '../engine/light/faces';
import type { TextureRegistry } from '../engine/render/textures';
import type { Settings } from '../data/settings';
import type { Level } from './level';
import type { Storage } from '../data/storage';
import { AmbientTree, lightModelsRuntime } from '../engine/light/modelLight';
import { SolidGrid } from '../engine/light/bake';


/** VRAD's defaults: 100 bounces (stops early once a bounce adds < 1), patches of 4 luxels, supersampled edges. */
const SOURCE_BAKE = { bounces: 100, patchRays: 256, chop: 4, supersample: true };

/** Bump when the baker's output changes meaning, so old caches are ignored. */
const BAKE_VERSION = 8;
/** The same for the Source baker (vrad.ts, vradProps.ts). */
const SOURCE_BAKE_VERSION = 5;

/**
 * Cached lightmap: RGBE (Ward's shared-exponent format, as in Radiance .hdr)
 * at 4 bytes per texel, deflated, base64. Lighting is smooth, so this is
 * ~10–20× smaller than raw half floats.
 */
interface LightmapCache { /** Valve lightmaps: BSP leaf ambient samples (modelLight.ts AmbientTree), float32 deflated. */ ambient?: string; /** Source-lit maps: the props' per-vertex light, RGBE deflated (instances in Level.source.props order). */ props?: string; format: 'liminal-lightmap'; version: number; encoding: 'rgbe-deflate'; key: string; width: number; height: number; luxel: number; data: string; /** Light direction per texel, RGBA8 deflated (see BakeOutput.dirPixels). */ dir?: string; /** Per-channel shadow mask of the per-pixel lights, RGBA8 deflated (BakeOutput.maskPixels). */ mask?: string }

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

/** Light direction (unit xyz, directionality w) → RGBA8: xyz·0.5+0.5, w. */
function encodeDir(px: Float32Array): Uint8Array {
  const out = new Uint8Array(px.length);
  for (let i = 0; i < px.length; i += 4) {
    for (let c = 0; c < 3; c++) out[i + c] = Math.round(Math.max(0, Math.min(1, px[i + c] * 0.5 + 0.5)) * 255);
    out[i + 3] = Math.round(Math.max(0, Math.min(1, px[i + 3])) * 255);
  }
  return out;
}

/** 0..1 floats → bytes. */
function encodeUnit(px: Float32Array): Uint8Array {
  const out = new Uint8Array(px.length);
  for (let i = 0; i < px.length; i++) out[i] = Math.round(Math.max(0, Math.min(1, px[i])) * 255);
  return out;
}

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
/** RGBE (5 bytes per texel, see encodeRGBE) → RGBA floats. */
function decodeRGBEToFloat(bytes: Uint8Array): Float32Array {
  const n = bytes.length / 5, out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const e = bytes[i * 5 + 3];
    const sc = e ? Math.pow(2, e - 128) / 255 : 0;
    out[i * 4] = bytes[i * 5] * sc; out[i * 4 + 1] = bytes[i * 5 + 1] * sc; out[i * 4 + 2] = bytes[i * 5 + 2] * sc; out[i * 4 + 3] = bytes[i * 5 + 4] / 255;
  }
  return out;
}

/** Vertex offset of each prop instance in the baked per-vertex light (as vradProps.lightProps numbers them). */
function propOffsets(p: { models: { positions: Float32Array }[]; instances: { model: number }[] }): Int32Array {
  const o = new Int32Array(p.instances.length + 1);
  p.instances.forEach((inst, i) => { o[i + 1] = o[i] + p.models[inst.model].positions.length / 3; });
  return o;
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
  onBaked: ((layout: LightmapLayout, tex: THREE.DataTexture, dir: THREE.DataTexture, mask: THREE.DataTexture) => void) | null = null;
  /** Per-vertex prop light from a Source bake (RGB per vertex; instance i from vertex offsets[i]). */
  onPropLight: ((colors: Float32Array, offsets: Int32Array) => void) | null = null;

  constructor(private storage: Storage) {}

  /** Valve lightmaps: the BSP's leaf ambient samples and the props' baked light, for lighting moving and physics props. */
  private runtime: { level: Level; tree: AmbientTree; baked: Float32Array; offsets: Int32Array; vis: SolidGrid } | null = null;

  /** Per run-time-lit prop instance: lighting origin, ambient cube, lights seen (for tools). */
  runtimeDebug = new Map<number, unknown>();

  /** Light the props Source lights at run time (moving, physics) where they are now; again after a mover moves. */
  relightProps(level: Level): void {
    const r = this.runtime;
    if (!r || r.level !== level || !level.source) return;
    const src = level.source;
    const colors = r.baked.slice();
    const which = src.props.meta.flatMap((m, i) => (m.runtime ? [i] : []));
    this.runtimeDebug.clear();
    lightModelsRuntime(src.props.models, level.propInstancesNow(), which, r.offsets, colors, src.lights, (p, out) => r.tree.cube(p, out), r.vis, this.runtimeDebug);
    this.onPropLight?.(colors, r.offsets);
  }

  private keyFor(level: Level, s: Settings, textures: TextureRegistry): string {
    const { filter: _f, ...bakeSettings } = s.light; // filtering doesn't need a re-bake
    void _f;
    // Nor do the lamps of worlds lit with no bake (engine/render/lightGrid.ts).
    for (const k of ['lampAmbient', 'lampAmbientColor', 'lampAmbientUp', 'lampScale']) delete (bakeSettings as Record<string, unknown>)[k];
    // Indoors (no sky), the sky's colours don't affect the bake.
    if (!(bakeSettings.skyLuminance > 0)) {
      const b = bakeSettings as Record<string, unknown>;
      delete b.skyZenith; delete b.skyHorizon; delete b.skyBand;
    }
    // Material colours matter too (bounce light): a recoloured texture must re-bake.
    // Keyed on each texture's definition, not its measured pixels, so the key is
    // the same in every browser (see TextureRegistry.identity).
    const mats: Record<string, unknown> = {};
    for (const f of level.faces) if (!(f.tex in mats)) mats[f.tex] = textures.identity(f.tex);
    if (level.source) return hash(JSON.stringify(['source', SOURCE_BAKE_VERSION, SOURCE_BAKE, level.map.brushes, level.map.entities, mats]));
    return hash(JSON.stringify([BAKE_VERSION, bakeSettings, s.textures, level.map.brushes, level.map.entities, mats]));
  }

  /** Ask for lighting if anything that affects it changed. */
  request(level: Level, s: Settings, textures: TextureRegistry, force = false): void {
    if (!s.light.enabled) return;
    const key = this.keyFor(level, s, textures);
    if (!force && key === this.lastKey) return;
    const firstForMap = force;
    if (force) this.shownAt = 0;
    this.lastKey = key;
    clearTimeout(this.timer);
    // Map load: no debounce. Slider drags: wait for a pause.
    this.timer = window.setTimeout(() => void this.start(level, s, textures, key, firstForMap), firstForMap ? 0 : 200);
  }

  /** Next to the map file (maps/p2/x.json → maps/p2/x.lightmap.json), so dev-only maps keep dev-only caches. */
  private cachePath(level: Level): string { return level.path?.endsWith('.json') ? level.path.replace(/\.json$/, '.lightmap.json') : `maps/${level.map.name}.lightmap.json`; }

  /**
   * Source-lit maps: Source's own light model (engine/light/vrad.ts). The
   * layout is the level's (fixed by the map); a quick bake (one bounce, few
   * rays, no supersampling) shows first, then VRAD's full settings.
   */
  private async startSource(level: Level, s: Settings, key: string, tryCache: boolean): Promise<void> {
    const gen = ++this.seq;
    this.runtime = null;
    const layout = level.layout!, src = level.source!;
    const none = new Uint8Array(layout.width * layout.height * 4).fill(255);
    // Valve's own lightmaps for this map (copied from its compiled BSP): for checking ours against.
    if (s.light.sourceBaker === 'valve' && level.path) {
      const text = await this.storage.read(level.path.replace(/\.json$/, '.valve.lightmap.json'));
      const c = text ? (JSON.parse(text) as LightmapCache) : null;
      if (gen !== this.seq) return;
      if (c && c.width === layout.width && c.height === layout.height) {
        this.apply(layout, decodeRGBEToHalf(await pipe(fromBase64(c.data), new DecompressionStream('deflate-raw'))), s.light.filter, none, none);
        // Props: Valve's per-vertex light from the BSP (tools/source/valve_proplight.py), else ours from our cache.
        const ours = c.props ? null : await this.storage.read(this.cachePath(level)).catch(() => null);
        const oc = c.props ? c : ours ? (JSON.parse(ours) as LightmapCache) : null;
        if (!oc?.props && c.ambient) {
          // No per-vertex prop light at all (a map imported from a BSP without its file pack):
          // every prop is lit the run-time way, from the leaf ambient cubes and the lights.
          const amb = await pipe(fromBase64(c.ambient), new DecompressionStream('deflate-raw'));
          if (gen !== this.seq) return;
          const offsets = propOffsets(src.props);
          src.props.meta.forEach((m) => { m.runtime = true; });
          this.runtime = { level, tree: new AmbientTree(new Float32Array(amb.slice().buffer)), baked: new Float32Array(offsets[offsets.length - 1] * 3), offsets, vis: new SolidGrid(src.occluders) };
          this.relightProps(level);
        }
        if (oc?.props) {
          const px = decodeRGBEToFloat(await pipe(fromBase64(oc.props), new DecompressionStream('deflate-raw')));
          const offsets = propOffsets(src.props);
          if (px.length / 4 === offsets[offsets.length - 1]) {
            const rgb = new Float32Array(px.length / 4 * 3);
            for (let i = 0; i < px.length / 4; i++) { rgb[i * 3] = px[i * 4]; rgb[i * 3 + 1] = px[i * 4 + 1]; rgb[i * 3 + 2] = px[i * 4 + 2]; }
            if (c.ambient) {
              const amb = await pipe(fromBase64(c.ambient), new DecompressionStream('deflate-raw'));
              if (gen !== this.seq) return;
              this.runtime = { level, tree: new AmbientTree(new Float32Array(amb.slice().buffer)), baked: rgb, offsets, vis: new SolidGrid(src.occluders) };
              this.relightProps(level);
            } else this.onPropLight?.(rgb, offsets);
          }
        }
        this.status = 'lighting: Valve\'s lightmaps (from the BSP)';
        this.shownAt = performance.now();
        return;
      }
      this.status = 'no Valve lightmap for this map (npm run valve:lightmap)';
    }
    if (tryCache) {
      try {
        const text = await this.storage.read(this.cachePath(level));
        const c = text ? (JSON.parse(text) as LightmapCache) : null;
        if (gen !== this.seq) return;
        if (c && c.key === key && c.encoding === 'rgbe-deflate' && c.width === layout.width && c.height === layout.height) {
          const t0 = performance.now();
          const half = decodeRGBEToHalf(await pipe(fromBase64(c.data), new DecompressionStream('deflate-raw')));
          if (gen !== this.seq) return;
          this.apply(layout, half, s.light.filter, none, none);
          if (c.props) {
            const px = decodeRGBEToFloat(await pipe(fromBase64(c.props), new DecompressionStream('deflate-raw')));
            const offsets = propOffsets(src.props);
            if (px.length / 4 === offsets[offsets.length - 1]) {
              const rgb = new Float32Array(px.length / 4 * 3);
              for (let i = 0; i < px.length / 4; i++) { rgb[i * 3] = px[i * 4]; rgb[i * 3 + 1] = px[i * 4 + 1]; rgb[i * 3 + 2] = px[i * 4 + 2]; }
              this.onPropLight?.(rgb, offsets);
            }
          }
          this.status = `lighting loaded from cache (${Math.round(performance.now() - t0)} ms)`;
          this.shownAt = performance.now();
          return;
        }
      } catch { /* no cache: bake */ }
    }
    this.worker?.terminate();
    this.worker = new BakeWorker();
    const input = (quick: boolean): SourceBakeInput => ({
      faces: level.faces, info: src.info, occluders: src.occluders, reflectors: src.reflectors, lights: src.lights, propShadows: quick ? undefined : src.propShadows,
      params: quick ? { bounces: 1, patchRays: 16, chop: 8, supersample: false, maxWidth: SOURCE_LM_WIDTH } : { ...SOURCE_BAKE, maxWidth: SOURCE_LM_WIDTH },
      props: quick ? undefined : src.props,
    });
    this.status = 'baking (Source)…';
    let fullDone = false;
    this.worker.onmessage = (e: MessageEvent<{ id: number; out?: SourceBakeOutput; progress?: string }>) => {
      if (gen !== this.seq) return;
      if (e.data.progress) { if (e.data.id === 1) this.status = `Source bake: ${e.data.progress}`; return; }
      const out = e.data.out!;
      const half = new Uint16Array(out.pixels.length);
      for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(65000, out.pixels[i]));
      if (e.data.id === 0) {
        if (fullDone) return;
        this.apply(layout, half, s.light.filter, none, none);
        this.status = `preview lighting (${out.ms} ms), full bake running…`;
        this.shownAt ||= performance.now();
        return;
      }
      fullDone = true;
      this.apply(layout, half, s.light.filter, none, none);
      if (out.propColors && out.propOffsets) this.onPropLight?.(out.propColors, out.propOffsets);
      this.status = `baked (Source) ${out.luxels.toLocaleString()} luxels, ${out.patches.toLocaleString()} patches, ${out.bounces} bounces in ${out.ms} ms`;
      this.shownAt ||= performance.now();
      this.worker?.terminate();
      this.worker = null;
      const pc = out.propColors;
      const propPx = pc ? Float32Array.from({ length: pc.length / 3 * 4 }, (_, i) => (i % 4 === 3 ? 1 : pc[Math.floor(i / 4) * 3 + (i % 4)])) : null;
      void Promise.all([pipe(encodeRGBE(out.pixels), new CompressionStream('deflate-raw')), propPx ? pipe(encodeRGBE(propPx), new CompressionStream('deflate-raw')) : Promise.resolve(null)]).then(([z, zp]) => {
        const cache: LightmapCache = { format: 'liminal-lightmap', version: BAKE_VERSION, encoding: 'rgbe-deflate', key, width: out.width, height: out.height, luxel: 16, data: toBase64(z), ...(zp ? { props: toBase64(zp) } : {}) };
        return this.storage.write(this.cachePath(level), JSON.stringify(cache));
      }).then(() => { if (gen === this.seq) this.status += ' · cached'; }, (err) => console.warn('lightmap cache not saved', err));
    };
    this.worker.onerror = (e) => { this.status = `bake failed: ${e.message}`; };
    this.worker.postMessage({ id: 0, source: input(true) });
    this.worker.postMessage({ id: 1, source: input(false) });
  }

  private async start(level: Level, s: Settings, textures: TextureRegistry, key: string, tryCache: boolean): Promise<void> {
    if (level.source) return this.startSource(level, s, key, tryCache);
    const gen = ++this.seq;
    const L = s.light;
    const layout = layoutLightmap(level.faces, Math.max(2, L.luxelSize), 2048, L.thinSamples);
    if (tryCache) {
      try {
        const text = await this.storage.read(this.cachePath(level));
        const c = text ? (JSON.parse(text) as LightmapCache) : null;
        if (gen !== this.seq) return;
        if (c && c.key === key && c.encoding === 'rgbe-deflate' && c.dir && c.mask && c.width === layout.width && c.height === layout.height) {
          const t0 = performance.now();
          const half = decodeRGBEToHalf(await pipe(fromBase64(c.data), new DecompressionStream('deflate-raw')));
          const dir = await pipe(fromBase64(c.dir), new DecompressionStream('deflate-raw'));
          const mask = await pipe(fromBase64(c.mask), new DecompressionStream('deflate-raw'));
          if (gen !== this.seq) return;
          this.apply(layout, half, L.filter, dir, mask);
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
    const quickLayout = layoutLightmap(level.faces, quickLuxel, 2048, L.thinSamples);
    // Light panels as a coarse grid of emitters (a 2x4 troffer = 1 light, not 18): the preview's cost is lights × luxels.
    const quick = this.buildInput(level, s, textures, quickLayout, { bounces: Math.min(1, L.bounces), bounceSamples: 8, surfaceSpacing: 48 });
    const full = this.buildInput(level, s, textures, layout, {});
    this.status = 'baking…';
    let fullDone = false;
    this.worker.onmessage = (e: MessageEvent<{ id: number; out: BakeOutput }>) => {
      if (gen !== this.seq) return;
      const out = e.data.out;
      const half = new Uint16Array(out.pixels.length);
      for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(65000, out.pixels[i]));
      const dir = encodeDir(out.dirPixels);
      const mask = encodeUnit(out.maskPixels);
      if (e.data.id === 0) {
        if (fullDone) return;
        this.apply(quickLayout, half, L.filter, dir, mask);
        this.status = `preview lighting (${out.ms} ms), full bake running…`;
        this.shownAt ||= performance.now();
        return;
      }
      fullDone = true;
      this.apply(layout, half, L.filter, dir, mask);
      this.status = `baked ${out.luxels.toLocaleString()} luxels, ${out.lights} lights in ${out.ms} ms`;
      this.shownAt ||= performance.now();
      this.worker?.terminate();
      this.worker = null;
      // Save wherever this build saves files (map folder on the dev server, the
      // artifact's db, localStorage), so the same map + settings never bakes twice.
      void Promise.all([pipe(encodeRGBE(out.pixels), new CompressionStream('deflate-raw')), pipe(dir, new CompressionStream('deflate-raw')), pipe(mask, new CompressionStream('deflate-raw'))]).then(([z, zd, zm]) => {
        const cache: LightmapCache = { format: 'liminal-lightmap', version: BAKE_VERSION, encoding: 'rgbe-deflate', key, width: out.width, height: out.height, luxel: L.luxelSize, data: toBase64(z), dir: toBase64(zd), mask: toBase64(zm) };
        return this.storage.write(this.cachePath(level), JSON.stringify(cache));
      }).then(() => { if (gen === this.seq) this.status += ' · cached'; }, (e) => console.warn('lightmap cache not saved', e));
    };
    this.worker.onerror = (e) => { this.status = `bake failed: ${e.message}`; };
    this.worker.postMessage({ id: 0, input: quick });
    this.worker.postMessage({ id: 1, input: full });
  }

  /** Source's non-HDR path: lightmaps as 8-bit 0.5·light^(1/2.2) per channel (mathlib LinearToLightmap), filtered as such. */
  ldrLightmaps = false;
  private last: { layout: LightmapLayout; half: Uint16Array; filter: string; dir: Uint8Array; mask: Uint8Array } | null = null;

  /** Re-upload the current lightmap after a change of encoding (non-HDR on/off). */
  reencode(ldr: boolean): void {
    if (ldr === this.ldrLightmaps) return;
    this.ldrLightmaps = ldr;
    if (this.last) this.apply(this.last.layout, this.last.half, this.last.filter, this.last.dir, this.last.mask);
  }

  private apply(layout: LightmapLayout, half: Uint16Array, filter: string, dir: Uint8Array, mask: Uint8Array): void {
    this.last = { layout, half, filter, dir, mask };
    // Irradiance in lux, linear: half-float keeps the range and filters on every WebGL2 GPU.
    let tex: THREE.DataTexture;
    if (this.ldrLightmaps && layout.source) {
      const bytes = new Uint8Array(half.length);
      const lut = new Uint8Array(4096);
      for (let i = 0; i < 4096; i++) lut[i] = Math.min(255, Math.max(0, Math.round(Math.pow(i / 1024, 1 / 2.2) * 255 * 0.5)));
      for (let i = 0; i < half.length; i++) {
        if ((i & 3) === 3) { bytes[i] = 255; continue; }
        const v = THREE.DataUtils.fromHalfFloat(half[i]);
        bytes[i] = lut[Math.min(4095, Math.max(0, Math.round(v * 1024)))];
      }
      tex = new THREE.DataTexture(bytes, layout.width, layout.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    } else tex = new THREE.DataTexture(half, layout.width, layout.height, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.colorSpace = THREE.NoColorSpace;
    tex.magFilter = tex.minFilter = filter === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    // Light direction: smooth, so 8 bits and linear filtering are plenty.
    const dtex = new THREE.DataTexture(dir, layout.width, layout.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    dtex.colorSpace = THREE.NoColorSpace;
    dtex.magFilter = dtex.minFilter = THREE.LinearFilter;
    dtex.generateMipmaps = false;
    dtex.needsUpdate = true;
    const mtex = new THREE.DataTexture(mask, layout.width, layout.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    mtex.colorSpace = THREE.NoColorSpace;
    mtex.magFilter = mtex.minFilter = filter === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
    mtex.generateMipmaps = false;
    mtex.needsUpdate = true;
    this.onBaked?.(layout, tex, dtex, mtex);
  }

  private buildInput(level: Level, s: Settings, textures: TextureRegistry, layout: LightmapLayout, over: Partial<{ bounces: number; bounceSamples: number; surfaceSpacing: number }>): BakeInput {
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
      // Clip brushes (invisible player blockers, as Source's) don't block light.
      boxes: level.map.brushes.filter((b) => b.solid !== false && b.group !== 'clip').map(solidPlanes),
      lights: mapLights(level),
      emissive,
      albedo,
      params: {
        ambient: [L.ambientLux, L.ambientLux, L.ambientLux],
        lightScale: L.lightScale,
        bounces: over.bounces ?? L.bounces,
        bounceScale: L.bounceScale,
        bounceSamples: over.bounceSamples ?? L.bounceSamples,
        surfaceSpacing: over.surfaceSpacing ?? 16,
        aoStrength: L.aoStrength,
        aoRadius: L.aoRadius,
        aoDirect: L.aoDirect,
        aoCurve: L.aoCurve,
        extraBounces: L.extraBounces,
        ...(L.skyLuminance > 0 ? { sky: { luminance: L.skyLuminance, zenith: skyColour(L.skyZenith), horizon: skyColour(L.skyHorizon), band: Math.sin((Math.max(0.1, L.skyBand) * Math.PI) / 180) } } : {}),
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
  if (type === 'sun') {
    // Directional: a very distant point whose intensity gives `lux` at the scene.
    // pitch/yaw as in Source's light_environment (pitch -60 = 60° above the horizon, shining down).
    const pr = (num('pitch', -60) * Math.PI) / 180, yr = (num('yaw', 0) * Math.PI) / 180;
    const dir: [number, number, number] = [Math.cos(pr) * Math.cos(yr), Math.cos(pr) * Math.sin(yr), Math.sin(pr)];
    const D = 4e6; // inches (~100 km)
    return { pos: [origin[0] - dir[0] * D, origin[1] - dir[1] * D, origin[2] - dir[2] * D], color, I0: num('lux', 90000) * (D * INCH) ** 2 };
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
  const lights = level.map.entities.filter((e) => e.class === 'light').map((e) => {
    const l = lightFromEntity(e.origin, e.props ?? {});
    const t = (e.props ?? {}).type ?? 'bulb';
    if ((t === 'can' || t === 'bulb' || t === 'dome') && dyn < MAX_DYNAMIC) { l.dynamic = true; dyn++; }
    return l;
  });
  // Shadow-mask channels: each light takes the channel whose nearest light is
  // farthest away, so lights that can reach the same spot rarely share one.
  const placed: BakeLight[] = [];
  for (const l of lights) {
    if (!l.dynamic) continue;
    let best = 0, bestD = -1;
    for (let c = 0; c < 4; c++) {
      let near = Infinity;
      for (const o of placed) if (o.channel === c) near = Math.min(near, Math.hypot(o.pos[0] - l.pos[0], o.pos[1] - l.pos[1], o.pos[2] - l.pos[2]));
      if (near > bestD) { bestD = near; best = c; }
    }
    l.channel = best;
    placed.push(l);
  }
  return lights;
}

/** sRGB hex → linear colour normalised to luminance 1. */
export function hexToLinearNorm(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255));
  const l = Math.max(1e-6, 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]);
  return [c[0] / l, c[1] / l, c[2] / l];
}

/**
 * Sky colour as relative radiance: linear, and NOT brightness-normalised, so
 * a pale horizon really is brighter than a deep-blue zenith (a clear sky is
 * several times brighter near the horizon). A colour of luminance 0.25 gives
 * exactly the Sky brightness setting.
 */
export function skyColour(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255) / 0.25) as [number, number, number];
}
