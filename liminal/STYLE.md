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
