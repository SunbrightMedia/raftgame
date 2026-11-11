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
- **The old maps are in `junk/`** (kept, not used). Work follows
  `docs/PIPELINE.md`; the game boots into `maps/blank.json` meanwhile.
