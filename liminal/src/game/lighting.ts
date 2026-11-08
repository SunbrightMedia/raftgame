import * as THREE from 'three';
import BakeWorker from '../engine/light/bake.worker?worker&inline';
import type { BakeInput, BakeLight, BakeOutput, RGB } from '../engine/light/bake';
import { layoutLightmap, solidPlanes, type LightmapLayout } from '../engine/light/faces';
import type { TextureRegistry } from '../engine/render/textures';
import type { Settings } from '../data/settings';
import type { Level } from './level';

export const hexToRgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/**
 * Keeps the level's lightmap in step with the map and the light settings.
 * Bakes run in a worker; a new request cancels a bake still in progress, so
 * dragging a slider only ever bakes the latest values.
 */
export class Lighting {
  private worker: Worker | null = null;
  private seq = 0;
  private timer: number | undefined;
  private lastKey = '';
  status = 'not baked';
  onBaked: ((layout: LightmapLayout, tex: THREE.DataTexture) => void) | null = null;

  /** Ask for a bake if anything that affects lighting changed. */
  request(level: Level, s: Settings, textures: TextureRegistry, force = false): void {
    if (!s.light.enabled) return;
    // Exposure and filtering are applied without re-baking.
    const { exposure: _e, filter: _f, ...bakeSettings } = s.light;
    void _e; void _f;
    const key = JSON.stringify([bakeSettings, s.textures, level.map.name, level.faces.length]);
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.start(level, s, textures), 200);
  }

  private start(level: Level, s: Settings, textures: TextureRegistry): void {
    // Cancel whatever is running: only the newest settings matter.
    this.worker?.terminate();
    this.worker = new BakeWorker();
    const id = ++this.seq;
    const L = s.light;
    const layout = layoutLightmap(level.faces, Math.max(2, L.luxelSize));

    const emissive: BakeInput['emissive'] = {};
    const albedo: BakeInput['albedo'] = {};
    for (const f of level.faces) {
      const t = textures.get(f.tex);
      albedo[f.tex] = t.albedo;
      if (t.emissive) {
        const c = hexToRgb(L.surfaceColor);
        emissive[f.tex] = { color: [c[0] * t.emissive.color[0], c[1] * t.emissive.color[1], c[2] * t.emissive.color[2]], intensity: t.emissive.intensity * L.surfaceIntensity };
      }
    }

    const lights: BakeLight[] = level.map.entities.filter((e) => e.class === 'light').map((e) => {
      const p = e.props ?? {};
      const c = hexToRgb(typeof p.color === 'string' ? p.color : '#ffffff');
      const intensity = typeof p.intensity === 'number' ? p.intensity : 1;
      const fifty = typeof p.fifty === 'number' ? p.fifty : 128;
      // "emit": "down" makes a Lambertian downlight (work lights, recessed cans) instead of a bare bulb.
      // "emit": "up" for cove lights hidden on a soffit, washing the ceiling.
      const dir = p.emit === 'down' ? ([0, 0, -1] as [number, number, number]) : p.emit === 'up' ? ([0, 0, 1] as [number, number, number]) : undefined;
      return { pos: e.origin, color: [c[0] * intensity, c[1] * intensity, c[2] * intensity], fifty, range: typeof p.range === 'number' ? p.range : fifty * 6, dir };
    });

    const input: BakeInput = {
      faces: level.faces,
      width: layout.width,
      height: layout.height,
      rects: [...layout.rects],
      boxes: level.map.brushes.filter((b) => b.solid !== false).map(solidPlanes),
      lights,
      emissive,
      albedo,
      params: {
        ambient: hexToRgb(L.ambient),
        lightScale: L.lightScale,
        bounces: L.bounces,
        bounceScale: L.bounceScale,
        bounceSamples: L.bounceSamples,
        surfaceSpacing: 32,
        surfaceFifty: L.surfaceFifty,
        surfaceGlow: L.surfaceGlow,
        aoStrength: L.aoStrength,
        aoRadius: L.aoRadius,
      },
    };
    this.status = 'baking…';
    this.worker.onmessage = (e: MessageEvent<{ id: number; out: BakeOutput }>) => {
      if (e.data.id !== this.seq) return;
      const out = e.data.out;
      const tex = new THREE.DataTexture(out.pixels, out.width, out.height, THREE.RGBAFormat);
      tex.colorSpace = THREE.NoColorSpace;
      tex.magFilter = tex.minFilter = L.filter === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      this.status = `baked ${out.luxels.toLocaleString()} luxels, ${out.lights} lights in ${out.ms} ms`;
      this.worker?.terminate();
      this.worker = null;
      this.onBaked?.(layout, tex);
    };
    this.worker.onerror = (e) => { this.status = `bake failed: ${e.message}`; };
    this.worker.postMessage({ id, input });
  }
}
