/** Surface reflection properties per material (textures/surfaces.json). */
export interface Surface {
  /** GGX roughness, Disney remap (alpha = roughness²). */
  roughness: number;
  /** Reflectance at normal incidence. */
  f0: number;
  /** 1 = metal: reflection tinted by the albedo, no diffuse. */
  metal: number;
  /** Relief depth in inches: bump shading and parallax both use it. */
  bump: number;
  /** Size of the detail read as relief, in inches (pile ~0.25, grout ~1). */
  relief: number;
  /** How much specular reflection this material shows (×, on top of the global slider). */
  gloss: number;
  /** Fibre sheen at grazing angles (carpet, fabric): soft brightening, not a mirror. */
  sheen: number;
  /** Darkening of the deepest crevices (grout, between pile tufts), 0..1. */
  cavity: number;
  /** Lightmap luxel size for faces of this texture (inches), finer than the map's: small relief that casts its own
   * shadows (a door's panel steps). Per texture only. */
  luxel?: number;
}

interface SurfaceFile { materials: Record<string, Surface>; textures?: Record<string, Partial<Surface>> }

const files = import.meta.glob('../../../textures/surfaces.json', { eager: true, import: 'default' }) as Record<string, SurfaceFile>;
const data: SurfaceFile = Object.values(files)[0] ?? { materials: {} };
const FALLBACK: Surface = { roughness: 0.7, f0: 0.04, metal: 0, bump: 0.04, relief: 0.4, gloss: 0, sheen: 0, cavity: 0.3 };

export function surfaceFor(texName: string, material: string): Surface {
  const base = data.materials[material] ?? data.materials.default ?? FALLBACK;
  return { ...FALLBACK, ...base, ...(data.textures?.[texName] ?? {}) };
}

/** The finer lightmap luxel a texture asks for (textures/surfaces.json "luxel"), if any. */
export function luxelFor(texName: string): number | undefined {
  const l = data.textures?.[texName]?.luxel;
  return typeof l === 'number' && l > 0 ? l : undefined;
}
