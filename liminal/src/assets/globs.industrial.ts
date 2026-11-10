/** The private industrial-world page (npm run build:industrial): the one map and only the Portal 2 pieces it uses, packed. See globs.dev.ts. */
export const textureUrls: Record<string, string> = {};
export const textureManifests = import.meta.glob('../../textures/p2lib/index.json', { eager: true, import: 'default' }) as Record<string, unknown>;
export const modelHeads: Record<string, unknown> = {};
export const modelBins: Record<string, string> = {};
export const mapUrls = import.meta.glob('../../maps/iw/industrial.json', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const catalogue = {
  textures: Object.values(import.meta.glob('../../catalogue-iw/textures.json', { eager: true, import: 'default' }))[0] as unknown,
  sheets: import.meta.glob('../../catalogue-iw/sheets/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>,
  models: Object.values(import.meta.glob('../../catalogue-iw/models.json', { eager: true, import: 'default' }))[0] as unknown,
  packs: import.meta.glob('../../catalogue-iw/packs/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>,
};
