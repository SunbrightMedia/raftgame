import * as THREE from 'three';
import { makeDevTexture, devTextureNames, type TexImage } from './devTextures';
import { type CrushParams, grade, sharpen, medianCut, applyPalette, averageColor, type Palette } from './crusher';

export interface TexEntry {
  name: string;
  texture: THREE.Texture;
  /** World units one repeat covers. */
  worldW: number;
  worldH: number;
  material: string;
  emissive?: { color: [number, number, number]; intensity: number };
  /** Average colour after crushing, 0..1: used for bounce light. */
  albedo: [number, number, number];
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
  credit?: string;
}

interface ManifestEntry { name: string; file: string; size: [number, number]; material?: string; credit?: string; pixelart?: boolean }

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
  private entries = new Map<string, TexEntry>();
  private filter: 'nearest' | 'linear' = 'nearest';
  private params: CrushParams | null = null;
  private loaded = false;

  async init(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const urls = import.meta.glob('../../../textures/**/*.{png,jpg,jpeg}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
    const manifests = import.meta.glob('../../../textures/index.json', { eager: true, import: 'default' }) as Record<string, { textures: ManifestEntry[] }>;
    const manifest = Object.values(manifests)[0]?.textures ?? [];
    const byFile = new Map(manifest.map((m) => [m.file, m]));

    for (const n of devTextureNames()) {
      const t = makeDevTexture(n)!;
      this.sources.set(n, {
        name: n, image: t.canvas, imgW: t.canvas.width, imgH: t.canvas.height,
        worldW: t.worldW, worldH: t.worldH, material: t.material, emissive: t.emissive, raw: !!t.raw, pixelart: false,
      });
    }

    for (const [path, url] of Object.entries(urls)) {
      const rel = path.replace(/^.*?textures\//, '');
      const m = byFile.get(rel);
      const name = m?.name ?? rel.replace(/\.(png|jpe?g)$/i, '');
      this.sources.set(name, {
        name, image: null, url, imgW: 0, imgH: 0,
        worldW: m?.size[0] ?? 0, worldH: m?.size[1] ?? 0,
        material: m?.material ?? 'default', raw: false, pixelart: !!m?.pixelart, credit: m?.credit,
      });
    }
  }

  /** Decode the images for these textures (call before building meshes that use them). */
  async prepare(names: Iterable<string>): Promise<void> {
    await Promise.all([...new Set(names)].map(async (n) => {
      const src = this.sources.get(n);
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
        this.entries.delete(n);
      } catch (e) {
        console.warn(`texture ${n} failed to load`, e);
      }
    }));
  }

  names(): string[] {
    return [...this.sources.keys()].filter((n) => n !== 'missing').sort();
  }

  get(name: string): TexEntry {
    let e = this.entries.get(name);
    if (!e) {
      const src = this.sources.get(name);
      e = this.build(src?.image ? src : this.sources.get('missing')!, name);
      this.entries.set(name, e);
    }
    return e;
  }

  /** Re-crush every texture with new parameters. Returns true if anything changed. */
  setCrush(p: CrushParams, filter: 'nearest' | 'linear'): boolean {
    const same = this.params && JSON.stringify(this.params) === JSON.stringify(p) && filter === this.filter;
    if (same) return false;
    this.params = { ...p };
    this.filter = filter;
    const names = [...this.entries.keys()];
    for (const e of this.entries.values()) e.texture.dispose();
    this.entries.clear();
    this.sharedPalette = null;
    for (const n of names) this.get(n);
    return true;
  }

  private sharedPalette: Palette | null = null;

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
    t.anisotropy = 4;
    t.magFilter = this.filter === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
    // Mipmaps stop distant floors shimmering; nearest-within-mip keeps texels crisp up close.
    t.minFilter = this.filter === 'nearest' ? THREE.NearestMipmapLinearFilter : THREE.LinearMipmapLinearFilter;
    return { name, texture: t, worldW: src.worldW, worldH: src.worldH, material: src.material, emissive: src.emissive, albedo: averageColor(px) };
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
