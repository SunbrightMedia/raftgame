/** The private catalogue page (npm run build:catalogue): only the packed Portal 2 library. See globs.dev.ts. */
export const textureUrls: Record<string, string> = {};
export const textureManifests = import.meta.glob('../../textures/p2lib/index.json', { eager: true, import: 'default' }) as Record<string, unknown>;
export const modelHeads: Record<string, unknown> = {};
export const modelBins: Record<string, string> = {};
export const mapUrls = import.meta.glob('../../maps/p2lib/*.json', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const catalogue = {
  textures: Object.values(import.meta.glob('../../catalogue/textures.json', { eager: true, import: 'default' }))[0] as unknown,
  sheets: import.meta.glob('../../catalogue/sheets/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>,
  models: Object.values(import.meta.glob('../../catalogue/models.json', { eager: true, import: 'default' }))[0] as unknown,
  packs: import.meta.glob('../../catalogue/packs/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>,
};
/** Worlds made in the page from a seed: none in this build. */
export const worlds: Record<string, (seed: number) => unknown> = {};
/** Worlds with no edge, loaded as lots round the player: none in this build (see globs.dev.ts). */
export const lots: Record<string, { settings: unknown; start: (seed: number, i: number, j: number) => [number, number, number] }> = {};
/** Blender post-processing data: not in this build (see globs.dev.ts); the 'blender' camera model falls back. */
export const blenderData: Record<string, () => Promise<string>> = {};
