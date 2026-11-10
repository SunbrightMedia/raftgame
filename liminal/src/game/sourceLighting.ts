import type { MapFile } from '../data/map';
import type { Face, SolidPlanes } from '../engine/light/faces';
import { solidPlanes } from '../engine/light/faces';
import { lightForString, parseSourceLight, type SourceBakeFace, type SourceLight } from '../engine/light/vrad';
import type { SourceMaterial } from '../engine/render/textures';

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
export function sourceBakeInfo(map: MapFile, faces: Face[], materialOf: (tex: string) => SourceMatInfo | undefined): { info: SourceBakeFace[]; occluders: SolidPlanes[]; lights: SourceLight[] } {
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
  const lights: SourceLight[] = [];
  for (const e of map.entities) {
    if (e.class !== 'light' || e.props?.type !== 'source') continue;
    const keys = (e.props.source ?? {}) as Record<string, string>;
    const l = parseSourceLight(keys, e.origin);
    if (l) lights.push(l);
  }
  return { info, occluders, lights };
}
