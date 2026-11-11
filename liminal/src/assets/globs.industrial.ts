import { industrialWorld, GEOMETRY_SETTINGS } from '../world/industrial/world';
/** The private industrial-world page (npm run build:industrial): the world is made in the page from a seed; only the Portal 2 pieces the generator uses are packed. See globs.dev.ts. */
export const textureUrls: Record<string, string> = {};
export const textureManifests = import.meta.glob('../../textures/p2lib/index.json', { eager: true, import: 'default' }) as Record<string, unknown>;
export const modelHeads: Record<string, unknown> = {};
export const modelBins: Record<string, string> = {};
export const mapUrls: Record<string, string> = {};
export const catalogue = {
  textures: Object.values(import.meta.glob('../../catalogue-iw/textures.json', { eager: true, import: 'default' }))[0] as unknown,
  sheets: import.meta.glob('../../catalogue-iw/sheets/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>,
  models: Object.values(import.meta.glob('../../catalogue-iw/models.json', { eager: true, import: 'default' }))[0] as unknown,
  packs: import.meta.glob('../../catalogue-iw/packs/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>,
};
/** Worlds made in the page from a seed (a map path "world:<name>:<seed>"), in place of a map file. */
export const worlds: Record<string, (seed: number) => unknown> = {
  industrial: (seed) => industrialWorld(seed).map.toMap('industrial', GEOMETRY_SETTINGS),
};
