import blenderFiles from '../../data/blender/files.json';
/** The published page (npm run build:page): our own assets only; the Freedoom set only as far as maps use it. See globs.dev.ts. */
export const textureUrls = {
  // (two globs: a negative pattern would also drop the files listed after it)
  ...import.meta.glob(['../../textures/**/*.{png,jpg,jpeg}', '!../../textures/freedoom/**', '!../../textures/p2/**', '!../../textures/p2lib/**'], { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob(['../../textures/freedoom/walls/{BROWN1,COMPSTA1}.png', '../../textures/freedoom/flats/CEIL5_1.png'], { eager: true, query: '?url', import: 'default' }),
} as Record<string, string>;
export const textureManifests = import.meta.glob('../../textures/index.json', { eager: true, import: 'default' }) as Record<string, unknown>;
// models/src: downloaded sources (Poly Haven glTF) waiting to be converted; not part of the page
export const modelHeads = import.meta.glob(['../../models/**/*.json', '!../../models/p2/**', '!../../models/p2lib/**', '!../../models/src/**'], { eager: true, import: 'default' }) as Record<string, unknown>;
export const modelBins = import.meta.glob(['../../models/**/*.bin', '!../../models/p2/**', '!../../models/p2lib/**', '!../../models/src/**'], { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const mapUrls: Record<string, string> = {};
export const catalogue: { textures?: unknown; sheets: Record<string, string>; models?: unknown; packs: Record<string, string> } = { sheets: {}, packs: {} };
/** Worlds made in the page from a seed: none in this build. */
export const worlds: Record<string, (seed: number) => unknown> = {};
/** Worlds with no edge, loaded as lots round the player: none in this build (see globs.dev.ts). */
export const lots: Record<string, { settings: unknown; start: (seed: number, i: number, j: number) => [number, number, number] }> = {};
/** Blender post-processing data: published next to the page as data/blender/* (artifact files, too big to inline;
 * the float tables as base64 text, since artifacts serve no raw binary), fetched the first time the 'blender'
 * camera model is picked. tools/make-page.mjs stages them. */
export const blenderData: Record<string, () => Promise<string>> = Object.fromEntries(
  (blenderFiles as string[]).map((f) => [`data/blender/${f}`, () => Promise.resolve(f.endsWith('.json') ? `data/blender/${f}` : `data/blender/${f}.b64.txt`)]),
);
