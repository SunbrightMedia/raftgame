/**
 * Which asset files a build includes. Each build mode has its own copy of this
 * module (vite.config.ts aliases "@globs" to globs.<mode>.ts): Vite emits every
 * file an import.meta.glob matches, even in code a mode never runs, so the lists
 * can't share one file behind if/else.
 *
 * Dev (and tests): everything, including Valve's reference assets (textures/p2,
 * textures/p2lib, models/p2, models/p2lib), which only the dev server serves.
 */
export const textureUrls = import.meta.glob('../../textures/**/*.{png,jpg,jpeg}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const textureManifests = import.meta.glob(['../../textures/index.json', '../../textures/p2/index.json', '../../textures/p2lib/index.json'], { eager: true, import: 'default' }) as Record<string, unknown>;
export const modelHeads = import.meta.glob('../../models/**/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
export const modelBins = import.meta.glob('../../models/**/*.bin', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
/** Maps fetched when opened (big reference maps), by path under maps/. */
export const mapUrls: Record<string, string> = {};
/** Catalogue build only: packed textures and models (tools/source/pack_catalogue.py). */
export const catalogue: { textures?: unknown; sheets: Record<string, string>; models?: unknown; packs: Record<string, string> } = { sheets: {}, packs: {} };
