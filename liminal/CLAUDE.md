# liminal — project context

Browser game + in-game editor, TypeScript/three.js/Vite. Separate from the
Unity raft project at the repo root. See README.md for controls and the plan.

## Verify after every change

```bash
npm run typecheck && npm test && npm run build
```

Tests cover movement/collision only. A green run says nothing about whether
it *feels* right; that's the user's call.

## Talking to the user

- **"STE" = Simplified Technical English.** When the user says STE, the last
  reply had too many words or hard words. Say it again: short sentences,
  simple words, only what they need. Keep replies like that by default.

## Rules that matter

- **Z is up, 1 unit = 1 inch** everywhere: map files, physics, rendering
  (`Object3D.DEFAULT_UP` is set to +Z in `engine/render/renderer.ts`).
- **Feel is data.** Any constant that affects feel goes in the schema in
  `src/data/settings.ts` (which auto-generates the panel row and saves it), never as a literal.
- `engine/collision` and `engine/movement` must not import three.js; they run headless in tests.
- `engine/movement/pmove.ts` mirrors Source's `CGameMovement` ordering
  (gravity halves, jump before friction, step move, stay-on-ground). Keep that
  structure; bhop and stair feel depend on it.
- Grounded velocity.z must be exactly 0, and traces stop 0.125 off surfaces
  (`SURFACE_CLIP_EPSILON`). Together these are what stop snagging on brush seams.
- Maps are written with `serializeMap` (one brush per line) so diffs stay readable.
- `vite.config.ts` file API only reaches `config/`, `maps/`, `textures/`.
- Lighting is baked (`engine/light/bake.ts`, pure, runs in a worker). The
  renderer and the baker share one face list (`engine/light/faces.ts`); never
  build geometry another way or lightmap UVs will disagree.
- Textures: only CC0 or original. Never Valve/id/other games' assets, even if
  the user asks for "the real ones"; recreate the look with the crusher.
  Photo sources are listed in `tools/textures.sources.json` with credits.
- `npm run build:page` + republishing the artifact gives the user a playable
  link; do that after each milestone (same scratchpad path keeps the URL only
  within one session; otherwise publish with the artifact's `url`:
  https://claude.ai/artifact/8ZcuArU2M8xGFsXWTvYfWh).
- **Movement rework is planned: take heavily from GZDoom** (the user's call).
  Until then the Source-style pmove stays as is; don't tune it piecemeal.
- **Before building or changing any room, read STYLE.md, especially
  "Standing preferences".** They are the user's accumulated feedback and must
  hold for every room without being repeated. Add new feedback there.
- **Lightmap caches** (`maps/<name>.lightmap.json`) are what make lighting
  appear instantly. They're keyed on the map + light/texture settings, so after
  changing a map, its lights or those defaults, open each map on the dev
  server and wait for "baked … · cached" before `build:page`. A stale cache is
  ignored (the game bakes a quick preview, then the full bake, and saves it).
- **Shared walls get each room's paint.** A wall brush between two rooms has
  two sides; never give it one texture. Declare the map's rooms (extent +
  wall paint, like `junk/tools/lib/pmpRooms.ts`) and run `paintByRoom()`
  (`tools/lib/roomPaint.ts`) before writing the map; add the map to
  `tests/room-paint.test.ts`.
- **The industrial world is made by code** (`src/world/`, seeded; rules in
  STYLE.md "World: industrial v2", design in `docs/WORLD_DESIGN.md`). It uses
  Portal 2 pieces as placeholders: the user allows them in this private repo
  and in private artifacts, never in the published main page.
  - After any change to the generator: `npm run world:walk -- <seed>` and
    `npm run world:look -- <seed>` must pass on a few seeds. The first
    walks every catwalk, stair and corridor with the player's own movement.
    The second casts sight lines from every walk and finds holes (faces not
    drawn), missing floors, and lamp light that leaks or is cut; each fault
    comes with a studio pose. Look at the world with the studio and
    `tools/world/spots.ts` / `tour.ts` poses (pose z = the feet, not the eyes).
  - The private page makes the world from a seed (map path
    `world:industrial:<seed>`; N and B change it; P lays the old camera's
    look over the picture), lit by lamps with no bake
    (`engine/render/lightGrid.ts`). Build and stage it with
    `tools/world/publish-prep.sh x <dir>`, publish to
    https://claude.ai/artifact/39h7z8LBGcPg3DgeNXLd2c (send new files, null
    the old hashed ones), and tell the user to keep that link private.
- **Blender camera model** (`engine/render/blenderPost.ts`, data in `data/blender/`): the game plays
  `blenderPost.fast.json` (`comp2glsl.py --fast`); the exact build `blenderPost.json` is for checks only.
  Its shaders are 81 MB once inlined and froze every Chrome tab on the user's Windows PC. Programs compile a
  few per frame (`BlenderPost.prepare`); a localStorage guard stops a start that froze from repeating on
  reload. Keep any new GPU program small, and never compile many in one frame.
- **The Complex rebuild (`maps/cx_area_a.json`, made by `tools/recreate/cx-area-a.ts`; never edit the JSON by hand)**:
  its lamps are the game's own (`tools/recreate/cx-lamps.json`, read from the deep export) drawn per pixel with
  Unreal's formula (`render/ueLight.ts`, light type `ue`), its fog is Unreal's height fog (`fog.unreal`), its bounce
  is our bake set by measurement (`tools/complex/README.md`). The camera's five pictures are our own, matched to
  measured statistics (`complexPost.ts standInImages`); never the game's files. After changing it, run
  `node tools/complex/ingame.mjs <dir> 18325` (bakes, saves the cache) and `compare_light.py` on 18325 and 19893.
  The camera's upscaler (`render/complexTAA.ts`) and motion blur (`render/complexMotionBlur.ts`) are the game's,
  checked by `check_taa.py --ours` and `check_mb.py` on the deep export; after changing either, run those. Headless
  runs that change settings write `config/settings.json`: delete it (never commit it).
- **The old maps are in `junk/`** (kept, not used). Work follows
  `docs/PIPELINE.md`; the game boots into `maps/blank.json` meanwhile.
- **Backrooms Planner** (2D map tool, `src/planner/`, page `planner.html`;
  study and plan in `docs/BACKROOMS_MAPS.md`). Generator: plan tree →
  port-to-port placement in zone frames → routed loops → zone recipes; walls
  are the outline of all floors. `tests/planner.test.ts` must pass (every zone
  walkable on 16 maps). Debug views: `npm run planner:render -- <dir> <seeds>`,
  `tools/planner/zoom.ts`, `tools/planner/ascii.ts`. Publish:
  `npm run build:planner && node tools/planner/make-page.mjs <out.html>`, then
  the artifact https://claude.ai/artifact/RuMoZpbzboHkN6ztKqb3c4 with
  `capabilities: {downloads: {}, db: {}}` (saves go through the viewer; `prompt()`
  and plain downloads do not work in artifacts; db holds the user's room-type
  names in collection `typeNames`, doc id = feature id, `{name}`).
  - The layout comes from the seed and settings alone; hand edits are applied
    on top (`applyEdits` in generate.ts): a moved room pushes only the rooms it
    lands on, moves replay in the order of `edits.zones` keys (the page re-inserts
    a key on each move). Keep edits local like this.
  - Maps are made in a worker (`genWorker.ts`); the plan is drawn once into a
    cached picture that pan/zoom move. `npx vite-node tools/planner/check.ts --
    <seeds> [params]` prints faults (long runs, overlaps, crossings between
    floors); the test keeps them at zero.
  - Shift-click: low-poly 3D room view (`room3d.ts` builds it: tiles, Z up, plan
    (x, y) -> (x, -y); meant for the future isometric view and the engine too).
  - The user's room-type names: copy them from the artifact db into
    `src/planner/typeNames.json` when asked (the engine reads that file).

