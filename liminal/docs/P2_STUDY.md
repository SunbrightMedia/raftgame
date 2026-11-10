# How Portal 2 builds its spaces (measured)

Notes for the industrial world (`src/world/`). Everything here is measured
from Valve's own files with the tools in `tools/source/` (never from
screenshots or memory). Where a rule is still a guess it says so.

Tools:
- `import_bsp.py`: a Portal 2 map (.bsp) → our map format, with brushes,
  texture axes, props, lights, glows, beams and the map's starting fog.
- `npm run valve:lightmap -- maps/p2ref/<map>.json <map>.bsp`: Valve's own
  baked light onto the import. In the studio:
  `load p2ref/<map> '{"light":{"sourceBaker":"valve"}}'`.
- `study.py`: counts and patterns (models, joining rules, lamp set-ups, materials).
- `plan.py`: plan and section drawings.
- `tools/world/kit_sheet.py`: look at chosen models side by side.

Maps studied so far: `sp_a3_speed_ramp` only (Old Aperture; its kit is
`props_underground`, which the industrial world does NOT use: the user wants
the modern, clean Aperture kit, `props_bts`). The catwalk-heavy maps
(`sp_a2_bts1`–`6`, `sp_a4_finale1`–`4`, `sp_a1_intro1`, `sp_a2_core`...) are
waiting on the user's upload (branch `p2-maps`, `reference/portal2/export_maps.ps1`).

## Fog (env_fog_controller)

Every Portal 2 map carries the same set of fog controllers (the `global_ents`
instance) and switches between them by trigger. The map's first one is chosen
by a `logic_auto` (`import_bsp.py` follows that chain).

Formula (stdshaders/common_ps_fxc.h): `f = min(maxdensity, (d − start) / (end − start))`,
colour blended by **f²**; distance is radial. `fogblend 1` mixes two colours
by where the camera looks.

| controller | colour | start | end | max density |
|---|---|---|---|---|
| `@environment_bts_fog` | 56 95 141 (colour2 41 91 152) | 1 | 5000 | 1 |
| `@environment_testchamber_fog` | 40 53 64 | 128 | 5000 | 1 |
| `@environment_destroyed_fog` | 50 70 80 | 128 | 2500 | 0.9 |
| `@environment_destroyed_b_fog` | 50 70 80 | 128 | 5000 | 0.9 |
| `@environment_act4_fog_01/02/03` | 50 70 80 | 128/128/64 | 2500/3500/6000 | 0.9 |
| `@environment_underground_fog` | 37 35 33 | 0 | 4500 | 0.95 |
| `@environment_mines_fog` | 70 85 100 | 0 | 6000 | 0.9 |
| `@environment_lake_fog` | 70 85 100 | 0 | 10000 | 0.9 |
| `@environment_lake_b_fog` | 70 85 100 | 0 | 4500 | 0.9 |
| `@environment_bottomless_pit_fog` | 70 85 100 | 0 | 6000 | 0.7 |
| `@environment_bottomless_pit_falling_fog` | 3 6 8 → 40 45 50 (blend, straight up/down) | 0 | 3000 | 0.9 |
| `@environment_fan_fog` | 16 19 22 | 128 | 3600 | 0.9 |
| `@environment_darkness_fog` | 14 20 22 | 1 | 2500 | 0.9 |
| `@environment_glados_intro_fog` | 39 54 63 | 0 | 3500 | 1 |
| `@environment_jailbreak_fog` | 100 140 160 | 128 | 4000 | 0.8 |
| `@environment_tuberide_fog` | 120 155 170 (colour2 90 130 150, blend) | 128 | 5500 | 0.8 |

Each environment also turns on a colour correction and a post-process
controller (`global_ents-environment_<name>_colourcorrection`): not imported
yet (the lookup tables come with the map upload).

## Lamps (sp_a3_speed_ramp)

- Colours Valve types: warm `250 230 170` / `247 228 170`, white
  `255 245 215`, cool `245 250 255`, grey-blue `183 204 218`, a red accent
  `181 67 34`.
- A lamp fixture = a model + a **spot** that lights the room + a **tiny point
  light** (brightness 2) that lights the fixture itself + a **glow sprite**.
  Measured on `props_lights/under_neonlamp` (26 of them): two
  `light_spot "250 230 170 250"`, inner cone 30, outer 80, at (8, ±24, 16–24)
  in the lamp's frame, and two `light "250 230 170 2"` at (0, ±24, 16).
- Big spaces are lit by a few very strong spots: `255 245 215` at 3000,
  6000, 8000, 12000, cones 30/45.
- Glow: `env_sprite`, `sprites/glow04` (64 px), scale 0.9 (= 57.6 units
  wide), additive (render mode 5), colour of the lamp.
- Shafts: `beam_spotlight` width 64, length 128, HDR scale 0.5;
  `point_spotlight` width 100, length 60, HDR scale 0.15.
- Cables: `move_rope`/`keyframe_rope`, material `cable/cable`, width 2–3, slack 25.

## Steel as brushes

Valve builds girder frames from **brushes**, not models: 8-unit-thick panels
textured `anim_wp/framework/squarebeams_rusty_01` (the modern, clean one is
`anim_wp/framework/squarebeams` — to confirm in a BTS map), in sizes 128×128,
64×128, 128×256... (687 faces in speed_ramp), plus the
`anim_wp/framework/squarebeam_off*` models.

## The modern kit (props_bts), measured from the models

Walkways sit on a 128 grid; a piece's origin is the centre of its deck top;
pieces run along their own +y; the deck is 80 wide, railings 54 high.
(`src/world/kit/aperture.ts` holds the joining rules; `tools/world/gen.ts testbed`
shows them all.)

| piece | joins |
|---|---|
| `hanging_walkway_16a/32a/64a/128a/256a/512a` | straight, both ends (512a runs from −64 to +448) |
| `hanging_walkway_128d`, `64e`, `32c` | deck only, no railings |
| `hanging_walkway_l` | −y and +x |
| `hanging_walkway_corner`, `end_b` | −y and +x, with a wider landing |
| `hanging_walkway_t` | −y, +y and +x |
| `hanging_walkway_x` | all four |
| `hanging_walkway_end_a` | 32 long, open at −y, railing across +y |
| `hanging_stair_128` | 128 up over 256 (bottom at −y); `_64`: 64 over 160; `_32`: 32 over 112; `_256`: 256 over 448 |
| `hanging_stair_landing_a/b` | 176 wide landing joining two flights side by side |
| `hanging_walkway_hanger_a`, `support_a/128/256/bracket` | under-deck bars and wall brackets (how Valve spaces them: to measure in a BTS map) |
| `truss_512/1024` | 58 wide, 51 deep truss along y |
| `gantry_truss_a` | 2048 × 1006 × 216 gantry frame |

Backdrop pieces Valve uses for huge views: `a4_destruction/bts_chambercluster_01–03`
(stacks of test chambers on rails, up to 3500 × 3200 × 6200),
`props_bts/silhouette_*` (black shapes meant to stand against fog),
`a4_destruction/fin3_*_elements`, `container_ride/lorezcontainerscombined_*`,
`a4_destruction/arm_ext_*` (rows of panel arms: the outside of a test chamber wall).

## Still to measure (needs the BTS maps)

1. What hangs the walkways (rods? cables?), and at what spacing.
2. Lamps along walkways and in corridors: which models, spacing, values.
3. Corridors and rooms: sizes, wall/floor/ceiling materials, props.
4. What surrounds a walkway: distance to walls, what the walls are.
5. Vactube runs: routes, supports, how they pass walkways.
6. How big views are composed: backdrop props, fog, sky box.
7. Colour correction and exposure settings per environment.
