import * as THREE from 'three';
import * as assets from '@globs';
import { makeDevTexture, devTextureNames, type TexImage } from './devTextures';
import { type CrushParams, grade, sharpen, medianCut, applyPalette, averageLinear, type Palette } from './crusher';

export interface TexEntry {
  name: string;
  texture: THREE.Texture;
  /** World units one repeat covers. */
  worldW: number;
  worldH: number;
  material: string;
  emissive?: TexImage['emissive'];
  /** Imported Source material facts (blend mode, normal map, reflectivity), if any. */
  source?: SourceMaterial;
  /** Average LINEAR reflectance after crushing, 0..1: used for bounce light. */
  albedo: [number, number, number];
  /** Height field for relief and parallax (1 = top of the surface), built lazily. */
  height?: THREE.Texture;
}

/**
 * A height field from a texture's own fine detail: luminance minus its local
 * average (radius `radiusIn` inches), normalised by local contrast, so pile,
 * grout and plaster peel read as relief while a carpet's big printed pattern
 * (dark navy next to cream, at the same pile height) doesn't turn into holes.
 * Edges wrap, so the height field tiles like the texture.
 */
export function makeHeightCanvas(src: HTMLCanvasElement, worldW: number, radiusIn: number, invert = false): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const d = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  // Never finer than 2 texels: single-texel relief turns a magnified texture into blobs.
  const r = Math.max(2, Math.round((radiusIn * w) / Math.max(1, worldW)));
  const blur = (a: Float32Array, rad: number): Float32Array => {   // two passes of a wrapped box blur ≈ gaussian
    let cur = a;
    for (let pass = 0; pass < 2; pass++) {
      const t = new Float32Array(w * h), o = new Float32Array(w * h), n = 2 * rad + 1;
      for (let y = 0; y < h; y++) {
        let acc = 0;
        for (let k = -rad; k <= rad; k++) acc += cur[y * w + ((k % w) + w) % w];
        for (let x = 0; x < w; x++) {
          t[y * w + x] = acc / n;
          acc += cur[y * w + (x + rad + 1) % w] - cur[y * w + ((x - rad) % w + w) % w];
        }
      }
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let k = -rad; k <= rad; k++) acc += t[(((k % h) + h) % h) * w + x];
        for (let y = 0; y < h; y++) {
          o[y * w + x] = acc / n;
          acc += t[((y + rad + 1) % h) * w + x] - t[(((y - rad) % h + h) % h) * w + x];
        }
      }
      cur = o;
    }
    return cur;
  };
  const low = blur(L, r);
  const hp = new Float32Array(w * h), sq = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { hp[i] = L[i] - low[i]; sq[i] = hp[i] * hp[i]; }
  const varc = blur(sq, r * 2);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const g = out.getContext('2d')!;
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = 0.5 + (invert ? -0.5 : 0.5) * Math.max(-1, Math.min(1, hp[i] / (2.2 * (Math.sqrt(varc[i]) + 0.015))));
    const b = Math.round(v * 255);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return out;
}

interface Source {
  name: string;
  /** Decoded lazily (see prepare): a map only pays for the textures it uses. */
  image: CanvasImageSource | null;
  url?: string;
  imgW: number;
  imgH: number;
  worldW: number;
  worldH: number;
  material: string;
  emissive?: TexImage['emissive'];
  raw: boolean;
  /** Already low-colour pixel art (Freedoom): keep native pixels, only grade it. */
  pixelart: boolean;
  source?: SourceMaterial;
  credit?: string;
  /** Catalogue build: the texture is a rectangle of a packed sheet (tools/source/pack_catalogue.py). */
  sheet?: { url: string; x: number; y: number; w: number; h: number };
}

// Catalogue build: textures packed into sheets, loaded per room (each sheet once).
const sheetLoads = new Map<string, Promise<HTMLImageElement>>();
function loadSheet(url: string): Promise<HTMLImageElement> {
  let p = sheetLoads.get(url);
  if (!p) { p = (async () => { const img = new Image(); img.src = url; await img.decode(); return img; })(); sheetLoads.set(url, p); }
  return p;
}

/** `keepHue`: scale each channel (the texture's own colour differences stay: brick to brick, stain to stain)
 * instead of tinting its brightness with one colour. */
interface Variant { name: string; from: string; color: string; contrast?: number; keepHue?: boolean }

/**
 * Extra facts about a material imported from Source (tools/source/convert_materials.py):
 * how it blends, its normal map, the reflectivity VRAD bounces with, lights.rad emission.
 */
export interface SourceMaterial {
  shader: string;
  normal?: string;
  translucent?: boolean;
  alphatest?: boolean;
  additive?: boolean;
  selfillum?: boolean;
  nocull?: boolean;
  envmap?: boolean;
  reflectivity?: [number, number, number];
  rad?: [number, number, number, number];
  /** The bump texture is a self-shadowing bump (three basis weights), not a normal map. */
  ssbump?: boolean;
  /** $detail: a second texture combined with the base (TextureCombine modes), at `scale` repeats per base repeat. */
  detail?: { file: string; scale: number; factor: number; mode: number };
  selfillumtint?: number[] | number;
  alpha?: number;
  alphatestreference?: number;
}

interface ManifestEntry { name: string; file: string; size: [number, number]; material?: string; credit?: string; pixelart?: boolean; raw?: boolean; source?: SourceMaterial }

/**
 * Name → texture. Sources, highest priority first:
 *  1. Images in textures/ listed in textures/index.json (CC0 photos with their
 *     real-world size and credit, written by tools/fetch_textures.py).
 *  2. Any other PNG/JPG dropped anywhere in textures/: name = path without
 *     extension, 1 pixel = 1 unit.
 *  3. Procedural textures (devTextures.ts).
 * Every non-dev texture goes through the crusher, so they all share one look.
 */
export class TextureRegistry {
  private sources = new Map<string, Source>();
  private variants = new Map<string, Variant>();
  private entries = new Map<string, TexEntry>();
  private filter: 'nearest' | 'linear' = 'nearest';
  private params: CrushParams | null = null;
  private loaded = false;

  async init(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    // The published page (one HTML file, 16 MB cap) leaves out the Freedoom set except what maps use;
    // the dev server and the normal build have all of it.
    const urls = assets.textureUrls;
    const manifests = assets.textureManifests as Record<string, { textures: ManifestEntry[] }>;
    const manifest = Object.values(manifests).flatMap((m) => m.textures ?? []);
    const variantFiles = import.meta.glob('../../../textures/variants.json', { eager: true, import: 'default' }) as Record<string, { variants: Variant[] }>;
    for (const v of Object.values(variantFiles)[0]?.variants ?? []) this.variants.set(v.name, v);
    const byFile = new Map(manifest.map((m) => [m.file, m]));

    for (const n of devTextureNames()) {
      const t = makeDevTexture(n)!;
      this.sources.set(n, {
        name: n, image: t.canvas, imgW: t.canvas.width, imgH: t.canvas.height,
        worldW: t.worldW, worldH: t.worldH, material: t.material, emissive: t.emissive, raw: !!t.raw, pixelart: false,
      });
    }

    if (assets.catalogue.textures) {
      const packed = assets.catalogue.textures as { textures: Record<string, [number, number, number, number, number]> } | undefined;
      const sheets = assets.catalogue.sheets;
      const sheetUrl = (n: number) => Object.entries(sheets).find(([k]) => k.endsWith(`sheet_${String(n).padStart(3, '0')}.jpg`))?.[1];
      const byName = new Map(manifest.map((m) => [m.name, m]));
      for (const [name, [n, x, y, w, h]] of Object.entries(packed?.textures ?? {})) {
        const m = byName.get(name), url = sheetUrl(n);
        if (!url) continue;
        this.sources.set(name, {
          name, image: null, imgW: 0, imgH: 0, worldW: m?.size[0] ?? w, worldH: m?.size[1] ?? h,
          material: m?.material ?? 'default', raw: true, pixelart: false, source: m?.source, sheet: { url, x, y, w, h },
        });
      }
    }

    for (const [path, url] of Object.entries(urls)) {
      const rel = path.replace(/^.*?textures\//, '');
      const m = byFile.get(rel);
      const name = m?.name ?? rel.replace(/\.(png|jpe?g)$/i, '');
      this.sources.set(name, {
        name, image: null, url, imgW: 0, imgH: 0,
        worldW: m?.size[0] ?? 0, worldH: m?.size[1] ?? 0,
        material: m?.material ?? 'default', raw: !!m?.raw, pixelart: !!m?.pixelart, credit: m?.credit, source: m?.source,
      });
    }
  }

  /** Decode the images for these textures (call before building meshes that use them). */
  async prepare(names: Iterable<string>): Promise<void> {
    const all = new Set<string>();
    for (const n of names) { all.add(n); const v = this.variants.get(n); if (v) all.add(v.from); }
    await Promise.all([...all].map(async (n) => {
      const src = this.sources.get(n);
      if (src?.sheet && !src.image) {
        try {
          const sh = src.sheet, img = await loadSheet(sh.url);
          const c = document.createElement('canvas'); c.width = sh.w; c.height = sh.h;
          c.getContext('2d')!.drawImage(img, sh.x, sh.y, sh.w, sh.h, 0, 0, sh.w, sh.h);
          src.image = c; src.imgW = sh.w; src.imgH = sh.h;
          this.entries.get(n)?.texture.dispose();
          this.entries.delete(n);
        } catch (e) { console.warn(`texture ${n} failed to load`, e); }
        return;
      }
      if (!src || src.image || !src.url) return;
      try {
        const img = new Image();
        img.src = src.url;
        await img.decode();
        src.image = img;
        src.imgW = img.naturalWidth;
        src.imgH = img.naturalHeight;
        // Unlisted files: 1 pixel = 1 unit.
        if (!src.worldW) { src.worldW = img.naturalWidth; src.worldH = img.naturalHeight; }
        this.entries.get(n)?.texture.dispose();
        this.entries.get(n)?.height?.dispose();
        this.entries.delete(n);
      } catch (e) {
        console.warn(`texture ${n} failed to load`, e);
      }
    }));
  }

  names(): string[] {
    return [...this.sources.keys(), ...this.variants.keys()].filter((n) => n !== 'missing').sort();
  }

  /**
   * How big each texture is in the world (what one repeat covers at scale 1),
   * for all that is known without loading a picture. (A lot of the endless
   * world is meshed in a worker, which cannot ask this registry.)
   */
  worldSizes(): Record<string, [number, number]> {
    const out: Record<string, [number, number]> = {};
    for (const [name, s] of this.sources) if (s.worldW > 0 && s.worldH > 0) out[name] = [s.worldW, s.worldH];
    for (const [name, v] of this.variants) { const s = this.sources.get(v.from); if (s && s.worldW > 0) out[name] = [s.worldW, s.worldH]; }
    return out;
  }

  get(name: string): TexEntry {
    let e = this.entries.get(name);
    if (!e && this.variants.has(name)) {
      e = this.buildVariant(this.variants.get(name)!);
      this.entries.set(name, e);
    }
    if (!e) {
      const src = this.sources.get(name);
      e = this.build(src?.image ? src : this.sources.get('missing')!, name);
      this.entries.set(name, e);
    }
    return e;
  }

  /**
   * What a texture IS, as stable data (its definition, not its pixels), for
   * cache keys: the same on every browser. Measured pixel averages differ a
   * little between browsers' image decoders, which made every saved lightmap
   * look stale on the player's machine and re-bake.
   */
  identity(name: string): unknown {
    const v = this.variants.get(name);
    if (v) return { ...v, from: this.identity(v.from) };
    const s = this.sources.get(name);
    if (!s) return name;
    const id: unknown[] = [s.name, s.worldW, s.worldH, s.material, s.emissive ?? null, s.raw, s.pixelart];
    // Imported Source materials: what the Source baker reads (bounce colour, bumped lightmaps).
    if (s.source) id.push(s.source.reflectivity ?? null, !!s.source.normal);
    return id;
  }

  /** The height field for a texture (relief radius in inches from its material). */
  heightOf(name: string, radiusIn: number, invert = false): THREE.Texture {
    const e = this.get(name);
    if (!e.height) {
      const t = new THREE.CanvasTexture(makeHeightCanvas(e.texture.image as HTMLCanvasElement, e.worldW, radiusIn, invert));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.NoColorSpace;
      t.anisotropy = 16;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      e.height = t;
    }
    return e.height;
  }

  private raws = new Map<string, THREE.Texture>();

  /**
   * An image exactly as stored, never crushed or graded: normal maps. Linear
   * data, trilinear filtered. Null if it isn't loaded (see prepare).
   */
  rawTexture(name: string): THREE.Texture | null {
    let t = this.raws.get(name);
    if (t) return t;
    const src = this.sources.get(name);
    if (!src?.image) return null;
    t = new THREE.Texture(src.image as HTMLImageElement);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 16;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.needsUpdate = true;
    this.raws.set(name, t);
    return t;
  }

  /** Names of the extra images (normal maps) the given textures draw with. */
  extrasOf(names: Iterable<string>): string[] {
    const out: string[] = [];
    for (const n of names) {
      const src = this.sources.get(n)?.source;
      if (src?.normal) out.push(src.normal.replace(/\.\w+$/, ''));
      if (src?.detail) out.push(src.detail.file.replace(/\.\w+$/, ''));
    }
    return out;
  }

  /** Re-crush every texture with new parameters. Returns true if anything changed. */
  setCrush(p: CrushParams, filter: 'nearest' | 'linear'): boolean {
    const same = this.params && JSON.stringify(this.params) === JSON.stringify(p) && filter === this.filter;
    if (same) return false;
    this.params = { ...p };
    this.filter = filter;
    const names = [...this.entries.keys()];
    for (const e of this.entries.values()) { e.texture.dispose(); e.height?.dispose(); }
    this.entries.clear();
    this.sharedPalette = null;
    for (const n of names) this.get(n);
    return true;
  }

  private sharedPalette: Palette | null = null;

  /** Recolour a texture: keep its detail (luminance), move its average colour to `color`. */
  private buildVariant(v: Variant): TexEntry {
    const base = this.get(v.from);
    const src = base.texture.image as HTMLCanvasElement;
    const canvas = document.createElement('canvas');
    canvas.width = src.width; canvas.height = src.height;
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(src, 0, 0);
    const img = g.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    let mean = 0;
    for (let i = 0; i < d.length; i += 4) mean += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    mean = Math.max(1, mean / (d.length / 4));
    const n = parseInt(v.color.slice(1), 16);
    const tr = (n >> 16) & 255, tg = (n >> 8) & 255, tb = n & 255;
    const k = v.contrast ?? 1;
    if (v.keepHue) {
      // per channel: its mean moves to the target, each pixel's difference from the mean scaled by k
      const m = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) { m[0] += d[i]; m[1] += d[i + 1]; m[2] += d[i + 2]; }
      const n = d.length / 4, t = [tr, tg, tb];
      for (let c = 0; c < 3; c++) m[c] = Math.max(1, m[c] / n);
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = t[c] * (1 + (d[i + c] / m[c] - 1) * k);
    } else for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const f = 1 + (l / mean - 1) * k;
      d[i] = tr * f; d[i + 1] = tg * f; d[i + 2] = tb * f;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 16;
    t.magFilter = base.texture.magFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return { ...base, name: v.name, texture: t, albedo: averageLinear(d), height: undefined };
  }

  private build(src: Source, name: string): TexEntry {
    const p = this.params;
    let canvas: HTMLCanvasElement;
    if (src.raw || !p) {
      canvas = document.createElement('canvas');
      canvas.width = src.imgW; canvas.height = src.imgH;
      canvas.getContext('2d')!.drawImage(src.image!, 0, 0);
    } else if (src.pixelart) {
      // Native pixels, graded only: resampling or re-paletting would wreck hand-made Doom art.
      canvas = document.createElement('canvas');
      canvas.width = src.imgW; canvas.height = src.imgH;
      const g = canvas.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(src.image!, 0, 0);
      const img = g.getImageData(0, 0, canvas.width, canvas.height);
      grade(img.data, p);
      g.putImageData(img, 0, 0);
    } else {
      canvas = this.crush(src, p);
    }
    const px = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height).data;
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    // Anisotropic + trilinear minification: walls seen at a steep angle stay
    // smooth instead of breaking into shimmering dot grids. Magnification
    // (up close) still honours the nearest/linear choice, so texels stay crisp.
    t.anisotropy = 16;
    t.magFilter = this.filter === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return { name, texture: t, worldW: src.worldW, worldH: src.worldH, material: src.material, emissive: src.emissive, source: src.source, albedo: averageLinear(px) };
  }

  private crush(src: Source, p: CrushParams): HTMLCanvasElement {
    const w = Math.max(4, Math.min(p.maxSize, Math.round(src.worldW * p.density)));
    const h = Math.max(4, Math.min(p.maxSize, Math.round(src.worldH * p.density)));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src.image!, 0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    grade(img.data, p);
    sharpen(img.data, w, h, p.sharpen);
    // Light panels keep their colours: banding on a glowing surface looks broken, not retro.
    if (p.colors >= 2 && !src.emissive) {
      const pal = p.sharedPalette ? this.getSharedPalette(p) : medianCut(img.data, p.colors, Math.max(1, Math.floor((w * h) / 16384)));
      applyPalette(img.data, w, pal, p.dither);
    }
    g.putImageData(img, 0, 0);
    return canvas;
  }

  /** One palette built from a sample of every crushable texture (Doom's PLAYPAL idea). */
  private getSharedPalette(p: CrushParams): Palette {
    if (this.sharedPalette) return this.sharedPalette;
    const samples: number[] = [];
    for (const s of this.sources.values()) {
      if (s.raw || s.emissive || s.pixelart || !s.image) continue;
      const c = document.createElement('canvas');
      c.width = 48; c.height = 48;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(s.image, 0, 0, 48, 48);
      const d = g.getImageData(0, 0, 48, 48);
      grade(d.data, p);
      for (const v of d.data) samples.push(v);
    }
    this.sharedPalette = medianCut(new Uint8ClampedArray(samples), p.colors);
    return this.sharedPalette;
  }
}
