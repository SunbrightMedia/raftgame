# liminal — project context

Browser game + in-game editor, TypeScript/three.js/Vite. Separate from the
Unity raft project at the repo root. See README.md for controls and the plan.

## Verify after every change

```bash
npm run typecheck && npm test && npm run build
```

Tests cover movement/collision only. A green run says nothing about whether
it *feels* right; that's the user's call.

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
