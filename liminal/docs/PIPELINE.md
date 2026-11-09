# Pipeline plan: an efficient tool for atmospheric, liminal maps

Goal: a real mapmaking tool for liminal spaces, usable by a person (in the
editor) and by Claude (from code), where quality comes from good assets and
Source-faithful lighting, and iteration takes seconds, not minutes.

Status: plan, not started. Phases are in order; each has an exit test.
Layouts and finished maps come after the tool, not before.

---

## What's wrong with the current loop

| Today | Cost |
|---|---|
| Every check = dev server + full bake + page rebuild + software-rendered browser | minutes per look |
| Walkability, headroom, scale, light levels judged from screenshots | slow, unreliable |
| Maps are thousands of hand-computed boxes in generator scripts | bugs (gaps, overlaps), slow to write |
| No asset library: every room starts from nothing, every edge razor-sharp | low ceiling on quality |
| Our own lighting model, tuned by eye | never quite Source |

## Principles

1. **Measure, don't eyeball.** Anything that can be computed (reachability,
   clearance, proportions, light at a point, render vs reference) is a check
   in code. Images are only for judging look and mood.
2. **Describe, don't coordinate.** Maps are spaces, openings and placed kit
   pieces; a compiler turns them into geometry. Brushes remain for one-offs.
3. **Assets carry quality.** A library of good materials and modelled kit
   pieces, built once, reused everywhere. Nothing has perfectly cut edges.
4. **Lighting matches Source.** Same light model, bounce, exposure, bloom and
   grading as Source (docs/SOURCE_LIGHTING.md), validated against real baked
   Source lightmaps, not by eye.
5. **Incremental everything.** Change one light or one room → only that part
   recompiles and rebakes.
6. **Rules and a mistakes log.** STYLE.md holds the rules; MISTAKES.md
   records every mistake so it isn't repeated. Before making anything: why
   does it exist, what does the reference say, no guessing.

---

## Phase 0: the studio (fast loop for Claude and for tests)

- **Studio daemon:** one persistent dev server and headless browser driven
  by a small CLI (`npm run studio -- <cmd>`): load map, hot-swap map data or
  settings without a page rebuild, set cameras, capture several views into
  one contact sheet, read back numbers (exposure, light at a point,
  histogram).
- **Headless checks in Node** (no browser), run as tests:
  - reachability: flood-fill the player hull over the map, report
    unreachable areas, stuck spots, falls, missing headroom;
  - geometry: gaps, overlaps, z-fighting, leaks to the void;
  - scale: door, ceiling, corridor and stair dimensions against rules.
- **Comparison tool (look):** reference vs render, run on demand:
  - global levels: luminance percentiles, colour cast (Lab), saturation, contrast;
  - regions: text-prompted masks ("ceiling", "floor", "light fixture") per
    image, then per-region brightness and colour. CLIPSeg + SAM 2.1 now,
    SAM 3 when access is granted;
  - similarity: DINOv2 global score plus a heatmap of where the images
    differ (DINOv3 when granted);
  - a one-page report (JSON + image).
- Per-map **moodboard** folder: references the checks compare against.

**Exit test:** any map → views + metrics + checks in under 30 s, without
rebuilding the page.

## Phase 1: Source-faithful lighting

- **Lights with Source parameters:** colour + brightness typed like Source
  (gamma 0-255, converted to linear), quadratic falloff normalised at 100
  units, `50%`/`0%` distances with hard falloff, spot cones (cosine × linear
  fringe, exponent), sky (sun with angular extent + ambient hemisphere).
- **Textured lights:** materials declare emission (Source's `lights.rad`):
  fixtures light their surroundings as area emitters.
- **Radiosity to convergence:** cast the gather rays once and cache which
  luxel each ray sees; then each bounce is a cheap sparse multiply, so 100
  bounces cost about as much as 2 do now. Bounce colour = material
  reflectivity (average linear colour, capped 0.99).
- **Bumped lightmaps, 3-direction basis** (the Half-Life 2 basis), replacing
  our single-direction approximation.
- **Props vertex-lit** with ambient cubes, as Source does.
- **Reflection probes:** cubemaps baked at placed points for glossy materials.
- **Post:** histogram auto-exposure (brightest 2% → 60%, median ≥ 3%,
  per-map min/max and rate), linear clamp, whole-frame bloom with per-map
  scale, colour-correction LUT volumes (32³), fog controller. The digicam
  look becomes an optional layer on top, off for Source-style maps.
- **Validation against Source:** import a Portal 2 map's geometry and lights
  (from the user's files), bake it with our lighting, compare face by face
  with the lightmaps Valve baked into the same file.

**Exit test:** our bake of a real Portal 2 map within a small per-face error
of Valve's, and side-by-side renders that read the same.

## Phase 2: material and texture library

- **Material files** (like Source's VMTs): albedo, normal, roughness, height,
  emission, reflectivity, surface type (for footsteps later), tags (era,
  place, colour).
- **Sources:** CC0 PBR sets (ambientCG, Poly Haven) with real normal and
  height maps instead of guessing relief from colour; the carpet tool for
  supplied photos; procedural originals.
- **Reference shelf:** Portal 2 textures from the user's install in
  `reference/` (never loaded by the game), for side-by-side comparisons.
- **Catalogue:** contact sheet and search by tag, for Claude and the editor.

**Exit test:** a library covering the eras and places in STYLE.md, every
material previewed under Source lighting.

## Phase 3: modelled kit (Blender, headless)

- Parametric kit pieces written as Blender Python: trims, casings, doors,
  drop-ceiling grid and tiles, fluorescent troffers, railings, stairs,
  columns, desks, chairs. Bevelled and slightly imperfect, never perfectly
  cut.
- Exported as glTF with collision proxies and snap points; previewed
  (rendered in Blender) before entering the library.
- Engine: glTF loading, instancing, vertex-lit props.

**Exit test:** a kit of ~40 pieces that look right up close next to
references.

## Phase 4: maps as descriptions

- **Map layers:** spaces (rooms, corridors, atria: footprint, floor/ceiling
  heights, finishes), openings (doors, cased openings, windows), kit
  placements, free brushes, lighting entities and environment (exposure,
  bloom, grading, fog).
- **Compiler:** layers → render meshes, collision, lightmap layout;
  incremental per space; runs the Phase 0 checks automatically.
- Existing maps stay as regression tests.

**Exit test:** a corridor + room + atrium described in under a page of data,
compiling and passing checks in seconds.

## Phase 5: the editor (for people)

- Edits the same layers: draw a space, drop an opening, place kit with
  snapping, place lights with Source parameters and a fast preview bake,
  pick materials from the catalogue, compile.

## Phase 6: sound (later)

- Ambience loops (fluorescent hum, HVAC), footsteps by surface type,
  reverb from room size and materials.

---

## Decisions needed

1. Digicam look: keep as an optional layer, default off for Source-style maps?
2. Props vertex-lit like Source (recommended) rather than lightmapped?
3. Hugging Face access to SAM 3 / DINOv3 (gated by Meta), or stay on
   SAM 2.1 / DINOv2?
4. Existing maps: keep as regression tests (recommended) or archive?
