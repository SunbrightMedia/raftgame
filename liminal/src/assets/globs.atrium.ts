/** The private atrium page (npm run build:atrium): our assets plus the atrium's Portal 2 ones (not the catalogue's). See globs.dev.ts. */
export const textureUrls = import.meta.glob(['../../textures/**/*.{png,jpg,jpeg}', '!../../textures/p2lib/**'], { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const textureManifests = import.meta.glob(['../../textures/index.json', '../../textures/p2/index.json'], { eager: true, import: 'default' }) as Record<string, unknown>;
export const modelHeads = import.meta.glob(['../../models/**/*.json', '!../../models/p2lib/**'], { eager: true, import: 'default' }) as Record<string, unknown>;
export const modelBins = import.meta.glob(['../../models/**/*.bin', '!../../models/p2lib/**'], { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const mapUrls = import.meta.glob('../../maps/p2/*.json', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const catalogue: { textures?: unknown; sheets: Record<string, string>; models?: unknown; packs: Record<string, string> } = { sheets: {}, packs: {} };
/** Worlds made in the page from a seed: none in this build. */
export const worlds: Record<string, (seed: number) => unknown> = {};
/** Worlds with no edge, loaded as lots round the player: none in this build (see globs.dev.ts). */
export const lots: Record<string, { settings: unknown; start: (seed: number, i: number, j: number) => [number, number, number] }> = {};
/** Blender post-processing data: not in this build (see globs.dev.ts); the 'blender' camera model falls back. */
export const blenderData: Record<string, () => Promise<string>> = {};
