/** Surface reflection properties per material (textures/surfaces.json). */
export interface Surface {
  /** GGX roughness, Disney remap (alpha = roughness²). */
  roughness: number;
  /** Reflectance at normal incidence. */
  f0: number;
  /** 1 = metal: reflection tinted by the albedo, no diffuse. */
  metal: number;
  /** Relief height in inches, from the texture's luminance. */
  bump: number;
}

interface SurfaceFile { materials: Record<string, Surface>; textures?: Record<string, Partial<Surface>> }

const files = import.meta.glob('../../../textures/surfaces.json', { eager: true, import: 'default' }) as Record<string, SurfaceFile>;
const data: SurfaceFile = Object.values(files)[0] ?? { materials: {} };
const FALLBACK: Surface = { roughness: 0.7, f0: 0.04, metal: 0, bump: 0.03 };

export function surfaceFor(texName: string, material: string): Surface {
  const base = data.materials[material] ?? data.materials.default ?? FALLBACK;
  return { ...base, ...(data.textures?.[texName] ?? {}) };
}
