# Style rulebook

The look we are after: late-1980s to 1990s North American interiors
(finished basements, model homes, renovated offices, small malls) as
photographed on film, with the feeling of those photos. Main reference:
[Postmodern Palace](https://www.postmodernpalace.com/home/art). We
replicate the *style*; we never copy their photographs or artwork.

Every room, palette and procedural rule should be checkable against this
file. Notes marked **(user)** are the user's observations and are
authoritative. Notes marked **(claude, unconfirmed)** are Claude's,
waiting for the user to confirm or reject.

---

## Standing preferences (apply to EVERY room)

These come from the user's feedback on built rooms. They are not
suggestions: every room, prop and generator rule must follow them without
the user having to say them again.

- **Curves are curves.** Never approximate a curved surface with stacked
  boxes or stair-steps, and never ship a curve with so few segments that its
  outline reads as a polygon (≥ 24 segments per quarter circle on anything
  large). Use prisms along whatever axis the curve runs (`axis: "x" | "y"`).
  Check curves up close before showing anything.
- **No visible texture grids.** Repeating textures must not line up into a
  grid at any viewing distance: scale textures with the structure, prefer
  low-contrast materials on big surfaces, use Texture repeat breakup on large
  floors.
- **Study the reference before building, and compare against it.** Measure
  the reference photo (colours, gradients, framing, camera position) first,
  build to the measurements, then show a side-by-side with the reference from
  the same viewpoint. Don't judge from my own screenshots alone.
- **Measure geometry with a calibrated camera, not a depth model's guess.**
  Get the lens and tilt from the photo's vanishing points (straight lines),
  room axes from the same lines, plan positions from where floor-contact
  pixels' rays meet the floor, scale from known sizes (doors, counters,
  handles, railings). A depth model alone got the lens wrong by 50% and
  skewed every wall. Then read the photo for what's there and what isn't:
  a dark wedge can be a missing wall, not a shadow; a floor may not exist.
- **Suggest first when asked to suggest.** If the user asks for a suggestion
  before fixes, reply with the suggestion and wait; change nothing.
- **Real models and real materials before hand-built ones.** For a prop in a
  reference, first look for the closest CC0 model (Poly Haven first), then
  change its geometry and texture until it matches (`tools/models/`: drop
  parts, add soft-edged pads, recolour). Materials (brick, plaster, carpet,
  fabric, wood) come from Poly Haven's CC0 photos (`tools/fetch_polyhaven.py`),
  recoloured to the reference's measured colour. Build a prop from brushes
  only when nothing close exists.
- **Found footage is the camera as much as the room.** A clean render reads
  as CG however good the room is. Match the reference's signal, measured
  on its frames: colour far softer than brightness, colour noise as
  blotches (not fine RGB grain), faint detail smoothed away as a codec does,
  no sharpening halos unless the reference has them, shutter blur on camera
  moves, a handheld sway, lamps as soft blobs. Research and numbers:
  `docs/FOUND_FOOTAGE.md`.

**Overall target**
- **Source-engine liminal, not Minecraft retro.** Textures smooth and fairly
  high resolution (HL2/GMod-era), no colour-palette crushing by default, no
  chunky pixels. "Retro" means the era of the *places*, not low-fi graphics.

**Lighting mood is per room**
- **Residential rooms: moody and warm.** Dim overall, warm (2700K-ish) pot
  lights making soft pools, darker corners, nothing blown out. The feel the
  user calls "Gen X soft club": soft, glowy, a bit dreamy, late night.
- **Sterile lighting is for specific places only** (offices, clinics,
  institutional halls): flat, bright, cool fluorescent. Never default to it.
- Light colour stays near neutral-warm; a room's tint comes from its
  materials (core principle 2).

**Proportions**
- **Openings must match their reference.** A cased opening into a side room
  is about door-and-a-half wide (~48–56"), not a wall-wide gap; only the
  main "open-concept" opening is wide. When unsure, err narrower.
- Check every layout against the reference photo's *walls*, not just its
  contents: which wall each opening is on, and where every door leads.
  Baseboards meeting walls are the clue for how spaces connect.

**Hardware and small details are real objects, not flat stickers**
- **Doors:** the knob sits on the stile (the solid edge), about 2.4" from
  the edge at 36" high, never on a panel. Hinges on the other side.
- **Light switches:** a plate *and* a toggle/rocker tab that sticks out.
- Anything you'd touch in real life (knobs, switches, outlets, handles) has
  depth.

**Furniture must not be blocky**
- Soft, rounded forms: rounded corners in plan, separate cushions with
  small gaps, crowned (slightly domed) cushion tops, arms lower and softer
  than the back. Box-stacks are not acceptable for upholstered furniture.
- Prefer real 3D models (CC0) for organic or complex things (plants,
  sofas, chairs) once model loading exists.

**Get it right before the camera** (user: very important)
- Everything *before* post-processing (geometry, materials, lighting,
  occlusion) must already be as close to the reference photos as possible.
  The digicam pass only adds the medium on top; it must never be used to
  hide a wrong material, wrong light or wrong shape. Judge rooms with the
  camera pass off first.

**Materials that are approved**
- The plush carpet (soft haze with gentle mottling, recoloured per room)
  is good. Reuse it for any wall-to-wall carpet.

---

## Core principles

1. **Layouts are slightly illogical.** (user) Spaces should not quite make
   sense: a door that is unnecessary because the room beside it is wide
   open, an opening that leads nowhere useful, two routes into the same
   room. Not surreal or broken; just *off*, like a renovation nobody
   planned. This matters more than any single material.
2. **Colour comes from materials, not lights.** (user) Light sources are
   plain white or warm white. A room reads green because it is full of green
   furniture and plants, and pink and warm because of orange wood, never
   because the bulb is tinted. In engine terms: keep light colours near
   neutral and let **bounce lighting** carry the room's material colours
   onto its walls and ceiling.
3. **Rooms have distinct palettes, and they bleed into each other.** (user)
   Adjacent rooms contrast (blue carpet next to pink carpet), and one room's
   floor can spill across the opening into the next.
4. **A very specific time.** (user) Every material, fixture and piece of
   furniture should plausibly come from roughly 1985–1999. Nothing modern,
   nothing antique unless it's the kind of antique a 90s house had.

## Floors

- **Wall-to-wall carpet in saturated, slightly dusty colours.** (user)
  Royal/navy blue and salmon pink in the reference. Low pile and plush, with
  visible nap and subtle darker wear patches. Carpet is the main colour field
  of a room.
- **Curved floor boundaries.** (user) A floor material can end in a large
  sweeping curve (the pink carpet's arc into the blue room) instead of
  stopping at the wall line. *Engine: needs curved floor regions or
  decals, since box brushes can't do this yet.*
- **No threshold strips at transitions.** (claude, confirmed) Carpet meets
  carpet directly.

## Walls and trim

- **Flat, dull paint colours.** (user) The blue room's walls are a dull,
  greyed **mint**. Expect muted pastels: mint, blush, putty, dusty peach, pale
  grey-blue. Never pure white, never saturated.
- **Baseboards on every wall.** (user) Simple painted (white/off-white)
  baseboard everywhere.
- **Casing on every open-concept opening.** (user) Wide doorless openings
  still get door-style trim (casing) around them.
- **No crown molding.** (user) The wall meets the ceiling bare.
- **Six-panel white doors** (colonial style, brass/gold knob) set in plain
  casing. (claude, confirmed)
- **Small details sell it:** beige/almond rocker light switches at about
  48", cased openings wider than a normal door. (claude, confirmed)

## Ceilings and lighting

- **Pot lights (recessed cans) are the default light source.** (user)
  Small, round, evenly spaced, warm white. Not fluorescent panels: those
  are for offices only.
- **Dropped soffits / bulkheads with cove lighting.** (claude, confirmed)
  The pink room has a lowered ceiling band with a hidden light strip
  washing the ceiling above it: a glowing tray ceiling. Very 90s.
- **Flat white or off-white ceilings,** smooth drywall in houses (acoustic
  tile only in offices and commercial spaces). (claude, unconfirmed)
- **Light is soft and slightly underexposed** in the corners, with no harsh
  shadows. (claude, unconfirmed)

## Wood, cabinets and counters

- **Orange wood.** (user) Very orange, honey or cherry-stained wood (oak or
  maple veneer), flat-slab cabinet doors.
- **Glass-front cabinets with thin gold accents.** (user) Frosted or clear
  glass panels with thin brass/gold trim lines.
- **Fake laminate marble counters.** (user) Laminate printed to look like
  marble, white/grey with soft veining, with rounded bullnose edges. Very
  ubiquitous.
- **Curved and L-shaped built-ins:** bars, counters and partitions with
  rounded ends. (user: L-shaped bar; claude, unconfirmed: curves are a recurring motif)

## Furniture and props

- **Big potted plants:** a tall fern or palm in a plain pot, often in a
  corner. (user)
- **Upholstery in the room's colour family:** the green room has green
  sofas and a round green ottoman. (user) Furniture is part of a room's
  palette, not decoration on top of it.
- **Chrome bar stools with burgundy vinyl seats.** (claude, confirmed)
- **Rooms are under-furnished:** few objects, lots of floor. Emptiness is
  part of the feel. (claude, confirmed: "amazing")

## The medium: early-2000s consumer digital cameras

From the user's reference set (Postmodern Palace posts). The feel is
inseparable from how these photos were taken (2001–2006 point-and-shoots):

- **Low dynamic range.** Lamps, skylights, fluorescent panels and windows
  clip to flat cream-white, and the clipped area bleeds a soft glow.
- **Purple/blue fringing** where blown highlights meet dark edges
  (skylight mullions, window frames).
- **Wrong auto white balance.** Tungsten rooms go amber-orange; fluorescent
  rooms take a yellow-green cast over everything.
- **Noise reduction + JPEG:** fine texture (carpet) smears into blotches,
  smooth walls band into steps.
- **In-camera oversharpening** gives thin halos on edges, on an image that's
  otherwise soft.
- **Shadows:** chroma noise, lifted milky blacks; mild corner vignetting.
- Built as the **Camera (digicam look)** settings: everything tunable,
  never a VHS filter.
- **Light sources: hard-edged blowout with a purple fringe.** (user: "great
  for the style") Lamps, cans and panels clip to a flat white shape with a
  crisp edge, a soft glow, and a thin purple/blue fringe around them.
- **No filter clichés.** (user) No global chromatic aberration, scan lines,
  tracking noise or "analog" overlays. Effects appear only where the real
  camera would produce them (fringing only at blown highlight edges).

Also seen in the set: atria with sloped skylights, long armless modular
sofas in teal velour, trophy cases, vertical blinds over night city views,
ceramic table lamps glowing on half-walls, wood paneling with ceiling
coves, banquet-room patterned carpet.

## The photograph itself

(claude, confirmed) The references are film photos, and the camera is
part of the style. The post-processing pass should emulate it: warm colour
cast, slightly lifted blacks, soft highlights, mild grain, gentle vignette,
slight softness. The scan look should be tunable in the panel like
everything else.

**Never a generic "VHS filter".** (user) No scan lines, tracking
noise, chromatic-aberration smears or fake timestamps: those look terrible
and carry no nostalgia. The target is a *film photo scan*, subtle enough
that you notice the mood before the effect.

## Commercial interiors (reference 2: the interior window)

All confirmed by the user.

- **Windows between interior rooms.** A large window from one windowless
  room into another, with no use and no way through: look, but you can't get in.
- **Curtains where no window can be.** Floor-length pinch-pleat drapes on
  an interior wall, hung from a soffit or curtain pocket.
- **Purposeless half walls:** a knee wall with a flat cap at sill height.
- **You stand in the dark and look into the light.** The viewer's room is
  dim with no visible source; the room beyond glows warm from a hidden
  source. (user) This can be illogical too: there may be no light in that
  space at all.
- **Hidden sources** in soffits and curtain pockets.
- **Vinyl wallcovering** in roughly 4' panels with visible vertical seams:
  mottled grey-mauve, the commercial counterpart of house paint.
- **Rubber cove base, not wood baseboard, in commercial spaces.** (user:
  "VERY important") A dark plum/burgundy vinyl strip that curves into the
  carpet. Trim follows the building type: white wood in houses, dark rubber
  cove base in offices, clinics, hotels and churches.
- **Plum/purple low-pile commercial carpet**: late-80s mauve.
- **Thick rounded window frames painted mauve-pink,** with deep sills, no
  hardware and near-invisible glass.
- **Completely empty rooms** whose purpose you can't name.
- **Cool mauve/purple-grey on this side, warm amber beyond.**
- **Colour coordination with one outlier.** (user) The window lining
  matches the carpet; the curtains are the outlier. Rooms are colour-matched
  sets with one thing that doesn't belong, and the outlier is part of the feel.

## Reference 3: the lit window (PMP, "Dad's girlfriend Morgan")

Measured with Depth Pro and checked by overlay at the photo's camera. Map: `pmp_nook`.
(The first build guessed "a chest-height niche" and was badly wrong: always measure.)

- **A half-wall window onto a stairwell:** sill 17", top 69", ~150" wide,
  in a 6" wall. Behind it the stairwell, ~130" deep with a 77" ceiling;
  **no floor in view** (it's a storey down). Its left wall sits ~19" left of
  the jamb.
- **One light, in the low room:** a 4"-deep dome ~48" behind the wall, its
  bottom just showing under the header, blown to white. The low room glows
  cream (216, 209, 174); the front room sits in warm brown (wall 134, 111,
  63 near the window), lit dimly from behind the camera.
- **The dark wedge low on the left is where the wall isn't:** the left wall
  stops just above floor level (16" near, 5" far) and the unlit space under
  it runs off to the left. Not a shadow.
- **Warm tan "orange-peel" texture paint** everywhere.
- **Flat white sill** projecting ~1.5" with a small apron moulding under it,
  white baseboard, tan-brown plush carpet (93, 60, 30).
- Camera: eye 56", 109" from the wall, 83" right of the left jamb, turned
  ~26° left of square, ~10° down.

## Reference 4: the trophy room with the arcade window

Measured. Map: `rec_room`.

- **Institutional green-beige paint** (170, 171, 111 lit; 130, 131, 73 in
  shade): school / rec-centre walls.
- **Pale vinyl tile floor** (179, 181, 134 near) with a dull sheen; drop
  ceiling (99, 98, 54 in shadow) with a few dim 2×4 troffers and one dark tile.
- **High display case:** a long glass cabinet built into the top of the
  wall, dark inside, with mullions. Below it a **freestanding trophy case**
  (glass, dark base and cap, gold trophies), a flush door painted the wall
  colour, and a plain **oak cabinet**.
- **The window into the arcade:** a long horizontal opening at chest height
  in the right wall, filled with white turned balusters. Through it: a dark
  arcade (37, 26, 23) lit only by **purple neon and screens** (92, 75, 93).
  Again: you stand in the plain room and look into the coloured one.
- Light: dim cool-white troffers; the arcade glow is the only colour.

## Reference 5: La Quinta Inn, 2004 ("it's supposed to be fun, but everyone is yelling")

Measured with a vanishing-point camera (lens ~29° across, 5.3° down, eye
175" above the lobby: the photographer leaned over the far upper railing).
Map: `laquinta`. Plan in `tools/gen-laquinta.ts`'s header.

- **Two hallways on each floor** under/behind the balcony: one going left
  (door on its far wall), one going straight back between the balcony and
  the breakfast alcove (white door on its left wall).
- **The counter sits in an alcove, against the bar wall**, end to end, under
  an 86" soffit; the TV is mounted on the soffit face.

- **A two-storey atrium breakfast area**: a balcony corridor wraps the
  upper floor behind a **black wrought-iron railing with wavy balusters**;
  **round white columns** run the full two storeys.
- **Breakfast bar** against the back wall: light-wood cabinets (89, 63, 40),
  dark counter, microwave, toaster, cereal. A **CRT TV on a wall bracket**
  above it, screen glowing pale cyan (183, 251, 251).
- **Two spotlights scallop the wall behind the bar** (blown, 254): hard
  cones on beige paint. The rest of the lower floor is dim (62, 59, 67).
- **A faux-painted mural** on the upper wall: a potted tree, muddy olive
  and brown (38, 27, 27 in the dark), lit by nothing.
- **Dark patterned hotel carpet** (46, 29, 28: burgundy with flecks), a
  **ceramic tile band** under the balcony (near white with teal diamond insets),
  round café tables with four wooden chairs each, white panel doors.
- Upper corridor lit by a single **blown wall sconce**. Ceiling dim (91, 82, 75).
- Camera: from the upper balcony, looking down and across, ~25' up the scene.

## Reference 6: "Infinite house" (Cassette, YouTube qs5LrOkvVKM) — THE target

- **(user)** "This level of realism is incredible. Realistically, this is
  where I'd want to get our game. It is more aligned with our goal than any
  piece of media I've shown you."
- Claude could not play the video (YouTube asked to sign in); what follows
  is from four still frames only. **(claude, unconfirmed)**
- What it shows: a finished basement / suburban house that goes on and on.
  Cream drywall, beige carpet, white six-panel doors with brass knobs,
  baseboards, crown moulding, a red-brick fireplace, white kitchen cabinets
  with a dark counter, an empty dark-wood bookshelf, white plastic chairs,
  a grey armchair. Long walls with too many doors.
- Why it reads as real: the shapes are simple (boxes and panels). The
  realism is in three things. (1) **Bounced light**: the walls light each
  other, corners are soft, there are no hard shadows, and light fades to
  near-black down a hall with no lamp. (2) **Plain, true-sized things**:
  8' ceilings, standard doors, trim; nothing designed for a game.
  (3) **The camera**: 4:3 with black bars, low resolution, soft focus,
  a warm cast (white balance set for daylight under bulbs), ceiling lamps
  blown to white with a glow, compression, a handheld tilt.
- **(user)** "This type of realism for every world, but we should model it
  off of the video." Stay with the indoor house style until the realism is
  right.
- The artist: YouTube "Cassette" (@kassettte), "3D blender artist!! 2D
  artist!!"; 20 videos, mostly Backrooms and empty-house found footage
  ("Someone used to live here" is the same realism). Nothing published on
  how they work, no files, no other accounts found (research, Nov 2026).
  Guess: Blender, Cycles (full bounced light), a camcorder finish on top.
- Measured on the three frames (sRGB 0..1, inside the 4:3 picture):
  darkest 1% at 0.14-0.21 (lifted, never black; one frame 0.02); 95% at
  0.48-0.64; almost nothing clips but the lamps (0-0.2%); median 0.32-0.42;
  mid-tones warm, red : green : blue = 1.11-1.14 : 1 : 0.76-0.79; soft
  (very little edge detail).
- **Sharper frames (Nov 2026).** YouTube keeps three frames it picks itself
  (about 25 / 50 / 75 % into a video) as public 1280×720 pictures:
  `https://i.ytimg.com/vi/<video id>/maxres1.jpg` (also `maxres2`,
  `maxres3`). "Infinite house": a kitchenette with white cabinets and a grey
  counter, a six-panel door, a white plastic chair and a wooden plaque on a
  pale wall, a wall sconce glowing down a hall (1); a living room with a
  red-brick fireplace, an empty dark bookshelf, a grey armchair, a dark
  basement window well, two round flush ceiling lamps blown to white (2); a
  hall of white six-panel and louvred doors, brass knobs, baseboards, crown
  moulding (3). The same three frames of 16 more of the channel's videos
  show the same method: "Someone used to live here" (wood floors, a stair,
  half walls, sun through windows), "Pillar", "The noises", "Record your
  dreams", "empty yellow office", "Hospitality", "Birthdays", "Backrooms -
  Hunted". Search again found nothing on how the artist works.
- Measured on the 1280×720 frames: median 0.30-0.39; lamps peak at
  0.95-0.98 and never clip flat; mean colour 0.36-0.47 / 0.32-0.41 /
  0.24-0.29 (blue about 0.6-0.65 of red); low saturation (mean chroma
  0.13-0.18). **Very soft**: the strongest edges are 0.012-0.039 across x
  and 0.035-0.043 across y (The Complex 0.043 / 0.031, our camcorder
  0.055 / 0.078 before softening): a soft lens plus motion blur from a
  turning, hand-held camera. **Wide glow**: a lamp's halo falls to half at
  about 6 % of the picture's height and fades out by about 12 % (The
  Complex's glow is about ten times tighter). Grain could not be measured:
  YouTube's compression removed it.
- **Rebuilt (map `house_iv`, Nov 2026; `tools/house/gen-house-iv.ts`).**
  The camera was solved from the frames (straight edges → vanishing points,
  one lens for all three): 64.4° wide (4:3), almost no barrel bend, tilted
  3-5° down. With 80" doors (36" counter) for scale: eye 66 / 53 / 59",
  **ceilings 101 / 115 / 115"** — taller than a normal basement (not 8' as
  guessed above); much of the empty, tall feel. The "louvred" doors of frame
  3 are six-panel doors: the slots are panel shadows. **(claude)**
- What made it match, each general (the same for all three frames): the
  camera balances white to its lamps (2900 K for 2700 K lamps leaves the
  measured warmth); auto exposure; a flatter scene contrast (0.75, as
  Blender's Filmic view); a fill light in the lamps' colour (4 lx at
  2700 K: far walls and ceilings are lit more evenly than bounce alone gives;
  a white fill turns blue once white is balanced); trim and doors the **same
  cream as the walls** (they read as bright as the walls in every frame);
  raised panels with real bevels; a glow just round the lamps (threshold),
  half at ~45 px of 720. Mean error 0.052 / 0.074 / 0.060; most surfaces
  within ±15 %. Still off: the far end of frame 3's hall is darker than the
  video (0.66×), and one near wall in frame 2 (0.8×). Blender renders keep
  one exposure, so the video's frame 1 room likely has more lamps out of
  sight; our auto exposure hides that.

## Reference 7: The Complex: Expedition (Steam, pgWave, 2025)

- **(user)** "It gets the type of realism I'm looking for perfect."
- Every screenshot is 4:3 (pillarboxed). Soft, fine grain, vignette, wide
  lens, lamps blown out with bloom, one main colour per room (cream,
  yellow, teal, peach). Light pools under each ceiling light and fades to
  dark rooms; soft dark corners. Real details everywhere: skirting boards,
  ceiling-tile grid, trim, vents, plain true-sized furniture.
- Runs on a GTX 760 (minimum), GTX 1060 (recommended): this realism does
  not need a strong graphics card. Engine not stated by the developer
  (one player says Unreal Engine 5). No devlogs on the look, no tools.

---

## World: industrial v2 (modern Aperture back-of-house; `src/world/industrial/`)

Standing rules from the user's feedback on the generated world. They hold
for every pass of this world, and the first two for every world.

- **Nothing floats. Everything must be possible in real life.** (user, very
  firm) Every catwalk, stair, tube, pipe, beam and mass is held by something
  you can see: columns that run down out of sight, beams that end on
  columns or walls, rods, brackets. A long run with too little support is
  the only excuse, and a rare one. Before adding any element, decide what
  carries it.
- **A cable is attached at both ends** to a real thing (a beam, a wall, a
  lamp, a machine). Never an end in the air. Few cables, tidy, small sag.
- **Short kit list only**: walkways, stairs, railings, beams and trusses,
  wall panels, transport tubes, pipes, ducts, lamps, cables. The user will
  model these later and does not want to model big unique pieces. Anything
  large (what fills a hall, a machine) is built from the list. No white or
  bright models (fans, tanks, pods, beds).
- **Steel is grey; a little yellow is fine.** No blue or orange beams.
- **A clean, working, empty plant for now.** No glitches, no damage, no
  "errors": the user found them weird and out of place. "Something is
  breaking" comes later, once the base geometry is right. Diagonal catwalks:
  maybe later.
- **Shelters stay, very subtle**: a few, small, made from kit parts, easy to
  miss.
- **A maze with large open areas, and closed parts** (corridors, rooms,
  tunnels inside the masses): not everything is open catwalk.
- **No two spaces alike purely by layout** (see `docs/WORLD_DESIGN.md`).
- Wandering tubes are good **if they end up somewhere**. Big boxes of
  machinery across streets are fine.
- Player: Source size (32 × 72, eyes at 64): the kit is made for it.
- Keep passes short and send the link each time. (Geometry was judged in
  flat light first; to see it flat again, set Lamps brightness × to 0 and
  raise "light from everywhere" to 300 in the tweak panel under Lighting.)
- **Closed parts** (pass 3b): what is cut into a mass is finished in that
  mass's own material (concrete in a pier, dark plate in a machine). A
  doorway is never bigger than a door (128 × 168), whatever the corridor
  behind it. The catwalk from a doorway to the street's lane rests on two
  beams out of the wall and hangs by a rod from the wall above. No white
  pipes in rooms (they read as bright models).
- Every change to the generator must still pass `npm run world:walk` and
  `npm run world:look` (the user: faults like see-through stairs and light
  with hard edges must be caught fast and by a tool, not by a search of the
  whole map; and every seed must just work, with no checking by hand).
- **Stairs are for the eye, a ramp for the feet.** The unseen ramp over a
  flight of steps is a clip brush (`group: 'clip'`): a brush with no drawn
  face hides nothing, so the steps inside it still show. (A plain NODRAW
  solid there once hid every step.)
- **The game is for laptops and desktops, as its own program** (the user;
  Steam perhaps). A browser's limits are not the design's limits; but it
  must be fast. The picture holds 50 frames a second by itself: fewer
  lines, then no antialiasing, when the machine is slow
  (`render.targetFps`). The HUD's first lines show the frame rate, the
  picture's size and the graphics card.
- **P** lays the old camera's look (softness, colour bleed, fringes, grain)
  over the Source camera's picture, at a fixed exposure and with no colour
  cast of its own (`camera.over`).
- **Light without a bake.** The world is made in the page, so nothing can be
  baked. Lamps are worked out per pixel (`engine/render/lightGrid.ts`,
  `lightGridCore.ts`), with shadows and no shadow maps: the generator says
  where the air is inside each mass (the boxes it cut: corridors, rooms,
  shafts, and the air in front of each doorway and slit), and a lamp inside
  lights a point only if the straight line between them stays in that air.
  So light goes through a doorway in a wedge, stops at a corner, never
  comes through a wall or a floor, and spills out of a door onto its porch.
  **A wall or a floor between two hollows must be at least 12 thick**, or
  light shows through (the look check counts these). Lamps in the open (the
  streets) have no shadows yet, and do not reach the insides of masses. A
  little cool light falls on everything; unlit steel reads as a dark shape
  against the fog, each lamp makes a warm pool. Fixtures: bell lamps under
  the catwalk beams, in rooms and shafts; caged tube lights on corridor
  ceilings, stair hall walls and over every doorway (doors show from far
  off); small amber marker lamps **only up the corners of the big masses**
  (the user: they look good only there; not on bridges or landings); a
  bridge has the streets' own frame over it with a bell lamp, a look-out
  landing a post with an arm and a bell lamp; tube lights in the gaps of
  some chamber stacks. About one tunnel in eight has very few lamps; a
  look-out room is always dark; every plain corner and crossing inside a
  mass has a lamp of its own (a place where the way divides must be
  readable). With no bounced light, a lamp inside also gives a faint even
  fill to all it can see.
- **Fog** (the user asked for layers, more intense further back, and blur):
  three layers by distance, each with its own density and colour. **The
  fog is dark: this is an endless plant under the ground, and nothing far
  off may look like daylight** (the user). The air near by holds a little
  of the plant's own light; with distance, with height and with depth it
  goes to black, so far lamps are points in the dark. Far things are a
  little soft (distance blur).
  Inside a mass the air is thin and dark (a fog volume). All of it is in
  the tweak panel under Fog; the world's own values are in
  `GEOMETRY_SETTINGS` and `INSIDE_FOG` (`src/world/industrial/world.ts`).

## World: industrial v1 (old; reference: a tower under construction, looking straight up)

Map: `industrial` (`tools/gen-industrial.ts`, seeded). An endless steel
maze in grey fog, inspired by the reference photo and by the feel of an
endless abandoned facility (no assets or layouts copied).

- **No lamps.** The only light is a flat overcast sky; near steel reads as
  dark silhouettes against bright grey fog, as in the photo. Near-monochrome
  (camera saturation 0.25).
- **Fog sells the endlessness:** structure fades out within ~300 ft in every
  direction, including up and down. Falling into the void respawns you.
- **Kit:** columns on 24' bays, I-beam girders every storey, X-bracing,
  Warren trusses across rows, curved truss arcs around a central void,
  pipe runs, scaffold-clad concrete shells, a rack-rail truss climbing
  through the void, and a walkable maze of grated catwalks with railings on
  three levels joined by open steel stairs.

---

## Palettes (draft)

A **palette** is a named set applied to a room: floor, walls, trim,
ceiling, wood, counter, light colour and props. Drafted from the reference:

| palette | floor | walls | trim | lights | props |
|---|---|---|---|---|---|
| `mint_lounge` | royal-blue carpet | dull mint paint | white baseboard + casing | warm-white pot lights | (none: transition room) |
| `fern_den` | royal-blue carpet | dull mint paint | white | warm-white pot lights | large fern, green sofa, round green ottoman |
| `pink_bar` | salmon-pink carpet (curved edge) | warm off-white | white | pot lights + cove-lit soffit | orange wood + gold-trim glass cabinets, laminate-marble L-bar, chrome/burgundy stools |

## Procedural generation rules (draft)

Collected from the principles above. These become the generator's
constraints:

- Every room gets one palette; adjacent rooms should contrast.
- Openings are wide and cased; at least one redundant door or passage per
  cluster of rooms (principle 1).
- Floors may spill through an opening as a curve into the neighbouring room.
- Lighting: pot-light grid sized to the room, neutral/warm white only.
- Props come from the palette, placed sparsely, with corners favoured for plants.

## Engine work this implies

- Curved floor regions or decals (the carpet arc).
- Trim generation: baseboards and opening casings added automatically.
- Pot-light fixture (small emissive disc) and cove/soffit light.
- Stronger, more saturated bounce, so material colour tints the room.
- Props/models (fern, sofa, ottoman, stools, cabinets) and a way to place them.
- Film-photo post-processing pass.
