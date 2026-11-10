/** The private atrium page (npm run build:atrium): our assets plus the atrium's Portal 2 ones (not the catalogue's). See globs.dev.ts. */
export const textureUrls = import.meta.glob(['../../textures/**/*.{png,jpg,jpeg}', '!../../textures/p2lib/**'], { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const textureManifests = import.meta.glob(['../../textures/index.json', '../../textures/p2/index.json'], { eager: true, import: 'default' }) as Record<string, unknown>;
export const modelHeads = import.meta.glob(['../../models/**/*.json', '!../../models/p2lib/**'], { eager: true, import: 'default' }) as Record<string, unknown>;
export const modelBins = import.meta.glob(['../../models/**/*.bin', '!../../models/p2lib/**'], { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const mapUrls = import.meta.glob('../../maps/p2/*.json', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const catalogue: { textures?: unknown; sheets: Record<string, string>; models?: unknown; packs: Record<string, string> } = { sheets: {}, packs: {} };
