import * as THREE from 'three';
import BakeWorker from '../engine/light/bake.worker?worker&inline';
import type { BakeInput, BakeLight, BakeOutput } from '../engine/light/bake';
import { BR30_65W, cosNPeak, kelvinToLinear } from '../engine/light/units';
import { layoutLightmap, solidPlanes, type LightmapLayout } from '../engine/light/faces';
import type { TextureRegistry } from '../engine/render/textures';
import type { Settings } from '../data/settings';
import type { Level } from './level';


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
    const { filter: _f, ...bakeSettings } = s.light;
    void _f;
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
      if (t.emissive && t.emissive.castsLight) emissive[f.tex] = { color: kelvinToLinear(t.emissive.kelvin), luminance: t.emissive.luminance };
    }

    const lights = mapLights(level);

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
        ambient: [L.ambientLux, L.ambientLux, L.ambientLux],
        lightScale: L.lightScale,
        bounces: L.bounces,
        bounceScale: L.bounceScale,
        bounceSamples: L.bounceSamples,
        surfaceSpacing: 16,
        aoStrength: L.aoStrength,
        aoRadius: L.aoRadius,
      },
    };
    this.status = 'baking…';
    this.worker.onmessage = (e: MessageEvent<{ id: number; out: BakeOutput }>) => {
      if (e.data.id !== this.seq) return;
      const out = e.data.out;
      // Irradiance in lux, linear: half-float keeps the range and filters on every WebGL2 GPU.
      const half = new Uint16Array(out.pixels.length);
      for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(65000, out.pixels[i]));
      const tex = new THREE.DataTexture(half, out.width, out.height, THREE.RGBAFormat, THREE.HalfFloatType);
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

type Props = Record<string, unknown>;

/**
 * A map "light" entity → a physical light.
 *   lumens: total luminous flux (a 60 W incandescent A19 ≈ 800 lm)
 *   kelvin: colour temperature (incandescent 2700, warm-white fluorescent 3000–3500, cool-white 4100)
 *   type:   "can"  — BR30 flood in a 6" recessed can: cos^1.4 beam, 50° cutoff, 85% efficiency
 *           "bulb" — bare bulb, equal in every direction: I = lm / 4π
 *           "down" / "up" — flat Lambertian emitter facing down/up: I0 = lm / π
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
    if ((t === 'can' || t === 'bulb') && dyn < MAX_DYNAMIC) { l.dynamic = true; dyn++; }
    return l;
  });
}
