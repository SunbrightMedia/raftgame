import type { MapFile } from '../data/map';
import type { Face, SolidPlanes } from '../engine/light/faces';
import { solidPlanes } from '../engine/light/faces';
import { lightForString, parseSourceLight, type SourceBakeFace, type SourceLight } from '../engine/light/vrad';
import type { SourceMaterial } from '../engine/render/textures';
import type { PropInstance, PropModelData } from '../engine/light/vradProps';
import { propModel } from '../engine/collision/props';
import { sourceAxes } from '../engine/collision/props';

/** What the Source baker needs to know about a texture. */
export interface SourceMatInfo { size: [number, number]; source?: SourceMaterial }

/** Does this map use Source's lighting model (lights imported from a VMF)? */
export function isSourceLit(map: MapFile): boolean {
  return map.entities.some((e) => e.class === 'light' && e.props?.type === 'source');
}

const seeThrough = (m?: SourceMaterial) => !!(m?.translucent || m?.additive);

/**
 * A map's faces, shadow casters and lights in the Source baker's terms
 * (engine/light/vrad.ts), with VRAD's rules:
 *  - only world brushes and func_detail cast shadows (brush entities such as
 *    func_brush, doors and func_lod don't; nor do glass or tool brushes);
 *  - overlays receive light but don't bounce it (Source draws them with the
 *    lightmap of the face underneath);
 *  - sky faces have no lightmap and swallow light.
 */
export function sourceBakeInfo(map: MapFile, faces: Face[], materialOf: (tex: string) => SourceMatInfo | undefined): { info: SourceBakeFace[]; occluders: SolidPlanes[]; reflectors: SolidPlanes[]; lights: SourceLight[] } {
  const brushes = new Map(map.brushes.map((b) => [b.id, b]));
  const info: SourceBakeFace[] = faces.map((f) => {
    const b = brushes.get(f.brushId);
    const def = b && 'faces' in b && b.faces ? (b.faces as Record<string, { lightmapscale?: number; scale?: [number, number] } | undefined>)[f.key] : undefined;
    const m = materialOf(f.tex);
    const src = m?.source;
    const refl = src?.reflectivity ?? [0.5, 0.5, 0.5];
    const fi: SourceBakeFace = {
      id: f.id,
      lightmapscale: def?.lightmapscale ?? 16,
      bump: !!src?.normal,
      reflectivity: [refl[0], refl[1], refl[2]],
      receiveOnly: b?.group === 'overlay',
      sky: /(^|\/)skybox\/|toolsskybox/.test(f.tex),
    };
    if (src?.rad && m) {
      const tl = lightForString(src.rad.join(' '));
      if (tl) {
        fi.texlight = tl;
        const su = f.scale[0] || 0.25, sv = f.scale[1] || 0.25;
        const ul = f.ua ? Math.hypot(f.ua[0], f.ua[1], f.ua[2]) : 1, vl = f.va ? Math.hypot(f.va[0], f.va[1], f.va[2]) : 1;
        fi.texScale = [ul / su, vl / sv];
        fi.texSize = m.size;
      }
    }
    return fi;
  });
  const occluders = map.brushes
    .filter((b) => b.solid !== false && (b.group === undefined || b.group === 'func_detail'))
    .filter((b) => !Object.values(('faces' in b && b.faces) || {}).some((ft) => ft && seeThrough(materialOf((ft as { tex?: string }).tex ?? '')?.source)))
    .map(solidPlanes);
  // Brush entities with visible, opaque faces: no shadows, but they reflect bounce (VRAD makes patches of their faces).
  const visible = (b: (typeof map.brushes)[number]) => Object.values(('faces' in b && b.faces) || {}).some((ft) => {
    const t = (ft as { tex?: string } | undefined)?.tex ?? '';
    return t && !t.startsWith('tools/') && !seeThrough(materialOf(t)?.source);
  });
  const reflectors = map.brushes
    .filter((b) => b.group !== undefined && b.group !== 'func_detail' && b.group !== 'clip' && b.group !== 'overlay' && visible(b))
    .map(solidPlanes);
  const lights: SourceLight[] = [];
  for (const e of map.entities) {
    if (e.class !== 'light' || e.props?.type !== 'source') continue;
    const keys = (e.props.source ?? {}) as Record<string, string>;
    const l = parseSourceLight(keys, e.origin);
    if (l) lights.push(l);
  }
  return { info, occluders, reflectors, lights };
}

/**
 * The props VRAD lights per vertex, in the order the renderer numbers them
 * (map order, props whose model is available): each model's vertices once,
 * each prop's world matrix (column-major, Source angles).
 */
export function propBakeData(map: MapFile, modelOf: (name: string) => PropModelData | undefined): { models: PropModelData[]; instances: PropInstance[] } {
  const models: PropModelData[] = [];
  const index = new Map<string, number>();
  const instances: PropInstance[] = [];
  for (const e of map.entities) {
    const name = propModel(e);
    if (!name) continue;
    const key = name.toLowerCase();
    let mi = index.get(key);
    if (mi === undefined) {
      const m = modelOf(name);
      if (!m) continue;
      mi = models.length;
      models.push(m);
      index.set(key, mi);
    }
    const s = typeof e.props?.scale === 'number' ? e.props.scale : 1;
    const [f, l, u] = sourceAxes(e.angles as [number, number, number] | undefined);
    instances.push({ model: mi, matrix: [f[0] * s, f[1] * s, f[2] * s, 0, l[0] * s, l[1] * s, l[2] * s, 0, u[0] * s, u[1] * s, u[2] * s, 0, e.origin[0], e.origin[1], e.origin[2], 1] });
  }
  return { models, instances };
}
