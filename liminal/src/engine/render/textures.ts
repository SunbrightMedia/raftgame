import * as THREE from 'three';
import { makeDevTexture } from './devTextures';

export interface TexEntry { name: string; texture: THREE.Texture; width: number; height: number }

/**
 * Name → GPU texture. Milestone 1 only has procedural dev textures; Milestone 2
 * adds PNGs found in textures/ (name = path without extension, e.g.
 * "office/carpet_blue"), which take priority over a dev texture of the same name.
 */
export class TextureRegistry {
  private entries = new Map<string, TexEntry>();
  private filter: THREE.MagnificationTextureFilter = THREE.NearestFilter;

  get(name: string): TexEntry {
    let e = this.entries.get(name);
    if (e) return e;
    const img = makeDevTexture(name) ?? makeDevTexture('missing')!;
    const t = new THREE.CanvasTexture(img.canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 4;
    this.applyFilter(t);
    e = { name, texture: t, width: img.width, height: img.height };
    this.entries.set(name, e);
    return e;
  }

  setFilter(mode: 'nearest' | 'linear'): void {
    const f = mode === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
    if (f === this.filter) return;
    this.filter = f;
    for (const e of this.entries.values()) { this.applyFilter(e.texture); e.texture.needsUpdate = true; }
  }

  private applyFilter(t: THREE.Texture): void {
    t.magFilter = this.filter;
    // Mipmaps stop distant floors shimmering. With nearest filtering we still
    // pick the nearest texel within the mip, which keeps the crisp retro look.
    t.minFilter = this.filter === THREE.NearestFilter ? THREE.NearestMipmapLinearFilter : THREE.LinearMipmapLinearFilter;
  }
}
