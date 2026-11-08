# liminal

A first-person liminal exploration game and its in-game level editor, built from scratch:
TypeScript + three.js + Vite, in the browser (desktop packaging later).

## Run it

Needs Node 20+.

```bash
cd liminal
npm install
npm run dev
```

Open http://localhost:5173 and click the view to capture the mouse. `Esc` releases it.

Other commands:

| command | what it does |
|---|---|
| `npm test` | headless movement/collision tests (stairs, seams, jump height, bhop, crouch) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | static build into `dist/` (config/map saving falls back to browser storage) |
| `npm run gen:testmap` | regenerate `maps/test_room.json` from `tools/gen-test-map.ts` |
| `npm run build:page` | one self-contained HTML file (`dist-page/`) for publishing as a playable link |
| `npm run fetch:textures` | (re)download the CC0 photo textures listed in `tools/textures.sources.json` |
| `npm run bench:bake` | time a lightmap bake of the test map |

Load another map with `?map=name` (reads `maps/name.json`), or drop a map `.json` onto the window.

## Controls

| key | action |
|---|---|
| WASD / arrows | move |
| Space, or **mouse wheel** | jump (the wheel jumps once per notch, for bhop timing) |
| C or Ctrl | crouch (Ctrl+W closes a browser tab, hence C) |
| Shift / Alt | sprint / slow walk |
| V | noclip (Space/C fly up/down) |
| R | respawn |
| `` ` `` (backtick) or F1 | **tweak panel** |
| Tab | (Milestone 2) edit ↔ play |

Key bindings are data (`src/data/bindings.ts`). Rebinding from the config file comes with the editor.

## The tweak panel

Press `` ` ``. Every setting that affects feel is listed, generated from one schema
(`src/data/settings.ts`). Changes apply on the next physics tick or frame.

- Changes **autosave** to `config/settings.json`, through the dev server, onto disk.
  Only values that differ from the defaults are written, so the file shows exactly what you changed.
- Changed values show in yellow with a ↺ to reset. Hover a label for its explanation and default.
- **Movement preset…**: Source (HL2-ish), CS:S, Bhop server, Liminal stroll. Pick one as a starting point.
- **Copy changes** copies your tuning as JSON (handy to paste back to me). Export/Import move whole files.
- The filter box searches labels and help text.

### Defaults I picked (tune these)

| setting | default | why |
|---|---|---|
| run / walk / sprint | 190 / 110 / 320 | HL2 numbers. Unhurried, but you can still move. |
| accelerate / air accelerate | 10 / 10 | HL2-ish: bhop is possible but needs real strafing. 100 = bhop server. |
| air wish-speed cap | 30 | Source's value; this is what makes air strafing work |
| friction / stop speed | 4 / 100 | Source |
| jump impulse | 302 | 57-unit standing jump (CS:S) |
| auto-hop | off | Holding jump re-jumps only when this is on |
| jump speed cap | 0 (off) | Set it to 1 to remove bhop gains entirely |
| crouch hull / eye | 36 / 28 | HL2, so 48-tall crawlspaces and vents work |
| air crouch lift | 0.5 | With a 36 crouch hull, full Source lift gives 93-unit crouch jumps. 0.5 gives ~75. |
| FOV | 90 | Source-style (horizontal at 4:3, Hor+ on widescreen) |
| tick rate | 66 Hz | Source server default |
| internal resolution | 480 lines, linear upscale | Soft and slightly blurry: the "comforting" side of retro. Try 240 + nearest for crunchy. |
| texture filter | nearest | Crisp texels |
| fluorescent intensity / falloff | 0.6 / 144 | Bright, flat office light, slightly warm (#f4f1e2) |
| bounce | 1 pass, strength 1.6 | Soft Source-style fill |
| ambient | #1e2024 | Corners never go pitch black |
| texel density / colours | 2 px per unit / 64 | Between Doom (1, 256 shared) and HL2 (4, unreduced) |
| fog | #121315, 600→6000 | A hint of haze in big rooms |

## Look: lighting and textures

### Lighting (Source-style baked lightmaps)
- Every surface gets a lightmap at **16 units per luxel** (Source's default). The bake runs in a
  background worker; changing a Lighting setting re-bakes in 1–2 s while you keep playing.
- **Light-emitting textures**: any face using `office/lightpanel` lights the room by itself, the way
  Source's `lights.rad` works. Put panels in the ceiling and the room is lit, with no light entities needed.
- **Point lights**: `{"class":"light","origin":[x,y,z],"props":{"color":"#ffcf8f","intensity":1.6,"fifty":120}}`.
  `fifty` is the distance at which the light is at half strength (Source's `_fifty_percent_distance`).
  Add `"emit":"down"` for a downlight instead of a bare bulb.
- **Bounce**: one pass of indirect light by default. It gives the soft fill and darker corners that
  make Source maps look like Source maps. Panel settings: bounces, strength, rays.
- Lighting → Baked lighting off = fullbright Hammer-style shading, for building.

### Textures (CC0 photos through a "crusher")
Old engine textures look the way they do because of how they were made: photographs shrunk hard,
contrast pushed, colours reduced (Doom used one 256-colour palette for everything), then sharpened.
The game does the same to clean CC0 photos, live, from the **Textures** panel:
texel density, colours per texture, shared palette, dither, contrast, saturation, sharpen.

**Look presets** (Preset… menu): *GMod / Source 2004*, *Late-90s* (default), *Doom / myhouse*, *PS1*.

Texture sets:
- `office/*`: carpets (blue, yellow, patterned, beige), drop-ceiling tiles, plaster, vinyl tile, light panel, trim
- `house/*`: checker and white tile, wood floors, paneling, striped and motif wallpaper
- `ind/*`: concrete (formwork, wall with tie-holes, floor), cinderblock, brick, institutional green paint, corrugated steel, diamond plate, rust
- `dev/*`: measurement grids

The photo textures come from [ambientCG](https://ambientcg.com) (CC0); see `CREDITS.md`. Wallpapers,
paneling, vinyl tile and the light panel are procedural originals (`src/engine/render/devTextures.ts`).
Textures are never copied from Source, Doom or any other game.

**Adding textures:** drop a PNG/JPG anywhere under `textures/` and it appears under its path name
(`textures/house/rug.png` → `house/rug`), at 1 pixel = 1 unit. To give it a real-world size, add it to
`tools/textures.sources.json` (for ambientCG assets) or to `textures/index.json`.

## The test map

`maps/test_room.json` (generated by `tools/gen-test-map.ts`):

- **Office floor** (spawn): blue carpet, drop ceiling lit by its own fluorescent panels, pillars,
  cubicle partitions you can jump onto. The 112 ceiling is a little too tall, on purpose.
- **The long corridor** (north door): yellow carpet and motif wallpaper, 2048 units long, ending in a
  **kitchen** (checker tile, striped wallpaper, one warm lamp). In Milestone 4 the corridor starts being longer than it should be.
- **Movement test hall** (east door, cinderblock and concrete under cold work lights; test blocks keep dev textures):
  - Step blocks along the south wall: 8 / 16 / 18 (green: walkable) / 20 / 24 (orange: too high).
  - Jump blocks along the north wall: 32 / 48 / 56 (standing jump) / 64 / 72 (crouch-jump).
  - Stairs: 8×16 steps up to a 64 mezzanine, steeper steps down the far side.
  - A 48-tall crawlspace (crouch through it, and you can't stand up inside).
  - 2000 units of open floor for strafe-jumping. Turn on HUD → Position/state to see the peak speed.

Things to try:

1. Walk the office at default settings. Then Render → internal resolution 240 and upscale nearest, then back to 480 linear.
2. Load **Bhop server**, hold jump, and strafe (A/D with the mouse turning the same way) down the test hall. Watch the speedometer climb.
3. Set **jump speed cap** to 1 and try again. The gain is gone.
4. Run up the stairs, step the 18 block, and fail the 20.
5. Tick rate 20 with interpolation off, then on. This shows what the interpolation hides.

## Making a map (for now)

The editor is Milestone 2. Until then a map is a JSON file in `maps/`. Z is up and 1 unit = 1 inch.

```json
{
  "format": "liminal-map",
  "version": 1,
  "name": "my_room",
  "brushes": [
    {"id":1,"type":"box","min":[0,0,-16],"max":[512,512,0],"tex":"office/carpet"},
    {"id":2,"type":"box","min":[0,0,0],"max":[512,16,128],"tex":"office/wall",
     "faces":{"py":{"tex":"dev/orange","scale":[2,2],"offset":[0,0],"rot":0}}}
  ],
  "entities": [
    {"id":100,"class":"player_start","origin":[256,256,0],"angles":[0,90,0]}
  ]
}
```

- A brush is an axis-aligned box. `tex` covers all faces, and `faces` overrides individual faces by
  outward direction: `px nx py ny pz nz` (+x, −x, …, top, bottom).
- UVs are world-aligned (textures line up across brushes, like Hammer). 1 texel = 1 unit at scale 1.
  `offset` is in texels and `rot` in degrees.
- `"solid": false` gives a visual-only brush, e.g. light fixtures. `"group": "name"` is reserved for show/hide and conditions.
- `player_start` angles are `[pitch, yaw, roll]` in degrees. Yaw 0 = +x, 90 = +y.
- Built-in textures: `dev/gray dev/floor dev/orange dev/blue dev/green dev/white office/carpet office/ceiling office/wall office/trim office/lightpanel`. All are procedural.

## Code layout

```
src/engine/   no game logic; collision + movement have no three.js dependency (unit-testable)
  vec3.ts               Z-up math, Source view angles
  collision/            convex brushes, swept-box traces (Quake 3 CM_TraceThroughBrush)
  movement/pmove.ts     Source CGameMovement port: FullWalkMove, TryPlayerMove, StepMove, StayOnGround
  light/                face building, lightmap layout, the baker (VRAD-style) and its worker
  render/               low-res renderer, world shader, brush meshing, texture crusher, procedural textures
src/data/     file formats and settings: no engine/game imports except shared types
  schema.ts, settings.ts   settings schema, defaults, presets, diffing
  map.ts                   map format, validation, serializer
  config.ts, storage.ts    autosave; dev-server / browser / (later) desktop file access
src/game/     play mode: input, player (tick + view smoothing), level loading, loop
src/ui/       debug panel, HUD
src/editor/   (Milestone 2)
config/  maps/  textures/   data on disk (the dev server's /api/file only reaches these three)
```

## Plan

1. **Walkable test room** ✅: Source movement, swept collision, JSON maps, live tweak panel.
2. **Editor core**: Tab toggles edit/play in place. Fly camera plus top-down view, drag-to-draw boxes,
   resize handles, face texturing from a browser panel (PNGs in `textures/` auto-appear), save/load, undo/redo.
3. **Look pass** ✅ (pulled forward): baked lightmaps with bounce, surface lights, CC0 photo textures + live crusher, look presets.
   Still to come in the feel pass: post (grading, grain, vignette, bloom), per-map look overrides,
   ambient loops, reverb zones, per-material footsteps.
4. **Impossible geometry**: seamless teleporters, render-to-texture portals, world state flags/counters, conditional groups.
5. Wedges/convex brushes, desktop build (Tauri).

## Assets and licensing

Use only original or freely licensed assets. Record each third-party file in `CREDITS.md`
with its source URL and licence.
