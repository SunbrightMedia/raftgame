# World design rules

What every world in this game should follow, drawn from the 23 research
reports in `docs/research/` (inspirations: House of Leaves, SCP-3001,
MyHouse.wad, Elevator: Source, The Stanley Parable, the Backrooms,
megastructure media, liminal walking games, impossible-space games;
techniques: maze algorithms and metrics, 3D mazes, roguelike generators, WFC,
cyclic generation, wayfinding, exploration level design, endless worlds,
avoiding repetition, wrongness, real industrial plants, Portal 2's back of
house, pipe and cable routing). Each rule names the reports it comes from.
The reports say which of their facts were checked against a source and which
are the researcher's reading; read them before leaning hard on a detail.

The user's brief: maze-like liminal worlds to explore; no two spaces feel the
same **purely because of how they are laid out**, even with one kit; a chaos
factor; something is breaking inside the world; later, ways in and out to
other worlds; worlds made by a seeded generator, at random in the end.

---

## 1. Plan the graph first, build geometry last

- A world is a **graph of typed spaces** (hall, canyon, shaft, warren,
  bridge, dead end...) before it is any geometry. Each space type has its own
  proportions, enclosure, way of moving through it and prop family.
  (megastructure, exploration, liminal-games, 3D mazes, roguelike, cyclic)
- Generate in **layers, each with its own seed stream**: skeleton graph →
  growth → loop pass → chaos pass → dressing. Dressing is the last and least
  noticeable layer. (roguelike, avoiding-repetition, WFC)
- The **chaos pass mutates a clean layout**: the unbroken version always
  exists, and the same seed gives the same breakage. (wrongness, WFC, SCP-3001)
- **Validate, don't hope**: flood-fill reachability from the start (with
  one-way links as directed edges; no landing may be a trap), headroom and
  clearance sweeps; on failure retry with seed + 1. (roguelike, 3D mazes, cyclic)
- **Measure each seed**: dead-end ratio, loop density, run-length spread,
  decision gaps, how the visible area changes along routes; reject seeds
  outside the target bands or with neighbouring regions too alike.
  (maze-metrics, wayfinding)

## 2. Difference comes from layout

- **Neighbours must contrast.** Two adjacent spaces differ on at least three
  of: width, height, enclosure, density, sight-line length, symmetry, rhythm,
  dominant direction, how you enter, what you see but cannot reach. Never the
  same space type twice running; at most two of the same enclosure in a row.
  (avoiding-repetition, wayfinding, Backrooms, megastructure, liminal-games)
- **One rule per region.** Each region has exactly one dominant idea (a
  spatial mode, a tilt, a repeated element, a door scale) and its neighbours
  do not share it. Randomise which rule goes where, not where props land.
  (Backrooms, megastructure, MyHouse)
- **Districts have a character vector**: one seeded set of numbers
  (enclosure, density, rhythm, skew, scale, openness, decay) that every
  placement reads, so features change together. Each district type also has
  its own **topology** (hub hall, single spine, bay grid, shaft with ledges,
  duct warren, ring), its own maze recipe (growing-tree blend, braid %,
  edge bias) and its own plumbing character. (avoiding-repetition,
  maze-algorithms, endless-worlds, WFC, pipe-routing)
- **Each space has one dominant flow direction and one prop family**, and the
  flow axis turns between neighbours. Vary width, height and sight-line
  length independently: wide-low, narrow-tall, long-thin. (real-industrial)
- **Emptiness is content.** Density goes down to near zero in places.
  (avoiding-repetition, SCP-3001, House of Leaves)
- Skew a district a few degrees off the grid now and then; mirror and rotate
  authored pieces. (wayfinding, avoiding-repetition)

## 3. Squeeze and release

- Follow every tight stretch with a space at least 4–6 times larger, and the
  reverse; never two open halls in a row. Change mode every 1–2 minutes of
  walking. (all the level-design reports agree on this one)
- A tight closed room between two huge spaces makes one kit feel like three
  places. Hollow tubes, ducts and crawls are the squeeze; they always end in
  a release. (Elevator, wayfinding, megastructure)
- Mix the distance between choices: about 40% short, 40% medium, 20% very
  long unbroken runs. One run over 100 m per world, ending in a junction with
  three or more ways on. (maze-metrics)

## 4. Mazes for wandering, not for solving

- Grow the maze on the space graph with **growing tree**; the
  newest/random/oldest blend is a per-district knob (long rivers ↔ branchy
  stubs). Avoid uniform algorithms (Wilson, Aldous-Broder) everywhere.
  (maze-algorithms, maze-metrics)
- **Loops**: 20–30% of connections, loop density 0.15–0.35 overall (0 in a
  labyrinth wing, up to 0.8 in a braided plaza). A loop only counts if the
  detour it saves is long. Make a loop's two arms unequal (1:2 to 1:5) and
  different in openness. Prefer loops that close **across levels**.
  (maze-metrics, cyclic, exploration)
- **Gates without keys**: a drop you cannot climb back, a view of a place
  before the route to it, a risky short way against a long safe one, a door
  that opens only from the far side (a long route silently becomes short).
  Keep risky gates off the main path. (cyclic, exploration, MyHouse)
- **Every dead end pays out**, and neighbours pay out differently: a view, a
  shelter, a sealed hatch, a drop, one found object, and rarely an honest
  nothing. (maze-metrics, wayfinding, exploration)
- Halls are hubs with 3–8 ways out; tight parts are chains of 6–20 cells.
  (maze-algorithms)
- Valve's own tests of open exploration left players lost: keep a readable
  spine, and let chaos break readability only locally. (portal2-bts)

## 5. Landmarks and far views

- 3–6 **large landmarks** per world, seen from afar along some lines only,
  never on the straight route to them; plus false ones whose route dead-ends.
  A different **one-off thing at every junction**. (wayfinding, megastructure,
  exploration, maze-algorithms)
- **Show a place before you can reach it**, and arrive from another side. At
  least one seen-but-unreachable view per district: through bars, grating,
  glass, across a gap. (cyclic, Backrooms, exploration, avoiding-repetition)
- No clean sight line to the end of anything: layer near, middle and a
  silhouette in haze. A human-sized thing (rail, ladder, lamp, door) in every
  huge space, so its size reads. (megastructure)
- The walkable route is a small part of what is visible: a spine inside 5–20
  times its volume of machinery you cannot reach. (portal2-bts)

## 6. Something is breaking

- **A baseline first.** Open each world with plain, readable space. About
  half of all cells stay completely clean, so each wrong thing carries
  information. (wrongness, MyHouse, House of Leaves, impossible-space)
- **One cause.** All wrongness belongs to one process of the world's lore, so
  it reads as one breakdown and not as random scares. Errors look like a
  system fault with a repeated cause (an instruction never cancelled), not
  like noise. (wrongness, megastructure)
- **A wound.** Wrongness rises towards a place (decay, tilt, repetition,
  darkness, missing pieces). Raise how *often* it happens with distance, more
  than how strong. A budget per region, weighted to 0 and 1; at most one
  blatant set piece per region, none within sight of another; rare events on
  tiers with cooldowns, never on fixed spacing. (megastructure, wrongness,
  liminal-games, avoiding-repetition, endless-worlds)
- **Stages.** Each new anomaly makes the last explanation fail, rather than
  being merely bigger: a deniable discrepancy, then a place that should not
  fit, then a space that answers back. (House of Leaves)
- **Subtract.** Missing rail, missing tread, a control room with no
  controls, stairs to nowhere, a pipe that ends at nothing. Small measurable
  violations beat big impossibilities. (SCP-3001, Stanley, Backrooms,
  real-industrial)
- **Repeat, then break the pattern.** A motif 3–8 times, each copy a little
  more wrong; or one module 8–40 times at an exact step with one deviation.
  (Stanley, wrongness, megastructure)
- Degrade in a **fixed order** (clutter, surface detail, trim, structure,
  collision) so players learn to read how far a place has gone. Decay never
  heals. (SCP-3001)
- **Something that works when it should not**: one live lamp, one running
  fan in a dead region. And traces of someone: a shelter of collected parts
  turned to a view, marks, a cache. (wrongness)
- **Never explain. No monsters, chases, jump scares, timers, text prompts.**
  Evidence only: counters, numbering that skips, marks that disagree with the
  room. Wrongness must look authored, never like an engine bug. Pair it with
  calm even light and quiet. (all the inspiration reports)
- **Change things only while unseen**: behind a closed door, round a bend,
  out of view, on return. Give both sides of a swap the same threshold. (This
  needs engine work: later.) (Stanley, MyHouse, impossible-space, House of Leaves)
- Keep space honest locally; let only the connections lie, and spend a real
  impossible-space trick about once per world. Cheapest first: identical
  corridor teleport, door swap, look-away swap, overlapping rooms, one
  portal window. (impossible-space, Backrooms)

## 7. Ways between worlds

- An exit sits in a **seam**: where the world is thinnest, marked by
  something at the wrong scale or cleaner than its surroundings (a door too
  tall, too small, the wrong colour). (megastructure, Backrooms, SCP-3001)
- Every way out is a door, hatch or lift after a **short closed approach**
  (which also hides loading). Mix the kinds: a door, a smooth threshold, a
  fall, a ride. A change of light colour on the far side signals the change
  of scene. (Elevator, Backrooms, liminal-games)
- A **connector that stays the same** (a lift with a floor indicator) can
  join unrelated worlds, and shows faults as things get worse. One safe place
  to linger makes its later corruption land. (Elevator)
- Each world and region is a **contract**: entrance, exit, size budget, mood
  tag; shuffle order by seed, never two with the same mood in a row.
  (Elevator, endless-worlds)
- Reserve exit nodes in the plan now, capped until they are linked.
  (roguelike, WFC)

## 8. Made at random, endlessly (later)

- The world is a **pure function of (seed, cell coordinates, salt)**: no
  dependence on the order of generation or on neighbours' state. Layers read
  only coarser layers. A different salt per kind of decision.
- **Hash the border** between two cells to decide its opening, so both sides
  agree; guarantee each cell's openings reach each other; add hashed extra
  openings for loops; a plain fallback cell so nothing can break the route.
- Rare set pieces on a jittered grid with spacing and exclusion zones.
- Never Perlin/float coordinates as the source of decisions.
  (endless-worlds, WFC)

## 9. The industrial world: what this changes

Now (`src/world/industrial/`): the plan is shared between nine districts,
each of one kind, no two neighbours alike. A kind sets the grain of the
layout itself (`GRAIN` in layout.ts) and how it is dressed (`DRESS` in
world.ts):

| kind | blocks | streets | halls | tunnels | reads as |
|---|---|---|---|---|---|
| canyons | big | middling | few | some | deep streets between chamber stacks |
| alleys | small | one tile | none | few | a tight maze of catwalks in the open |
| yards | big | wide | half the blocks | some | open air, bridges over the halls |
| works | huge | narrow | hardly any | every mass, up to six | you walk inside the masses |
| racks | middling | middling | some | few | a forest of open steel |

Catwalks run on five levels through the streets; tunnels cut through the
masses (straight, bent, dog-leg, dead end), each with its own section (from
a low wide passage to a tall slot), with rooms at their junctions (some
tall, some with a look-out slit), stair halls, and doorways with porches;
bridges cross the halls on trestles; some junctions inside a mass hang in a
shaft (a hollow from far below to above every level, crossed by catwalks
one over the other, hung from beams that span it). Nothing floats. No
chaos, no damage (the user's call, for now).

It is lit by lamps with no bake (STYLE.md, "Light without a bake"), in
layered fog.

The world is made from a seed, in the page too (map path
`world:industrial:<seed>`; N and B change the seed in the private build).

Checks:
- `npm run world:walk -- <seed>`: the player's own movement code walks every
  catwalk, stair, corridor and stair hall both ways over the real collision
  and lists anything that blocks, drops or stops short. Must pass.
- `npm run world:plan -- <seed> out.ppm`: the plan as a picture, and counts.
- `npx vite-node tools/world/spots.ts -- <seed> <n>`: camera poses (feet
  position) at doors, corridors, stair halls and rooms, for studio views.
- `npx vite-node tools/world/tour.ts -- <seed> <n> <pick>`: random poses
  along the walks, for a visual check of a whole world.
- `tests/carve.test.ts`, `tests/world-layout.test.ts`.

Next, in this order:

1. **Checks**: a walk test over the real collision, a look check, and the
   maze's numbers per seed (all done: `npm run world:walk`,
   `npm run world:look`, `npm run world:plan`). The look check stands at
   eye points along every walk, casts a fan of sight lines, and finds what
   an eye would catch at once: a surface that is not drawn (a hole), no
   drawn floor under the feet, lamp light through a wall, lamp light
   missing in plain sight of the lamp, a wall too thin to stop light, a
   lamp inside a mass but in no box of air. Each fault comes with a pose
   to look at it from. A seed is good when both checks pass. Now:
   dead ends 10-13% of nodes, loops 13-16% of walks, runs between choices
   about 35% short / 50% middling / 13% long, a third of the walks inside
   the masses. Seeds are not yet rejected by these numbers.
2. **District types with their own topology** (begun: the five kinds above
   differ in grain, and shafts open inside the masses; still to do: the nave,
   the tank yard, the ring):
   canyon streets (as now), a **shaft** (ledges round a core machine, grated
   floors, a landmark at the bottom), a **nave** (one huge machine, a spine
   across, a pit), a **warren** (closed corridors, ducts and rooms inside a
   mass: the tight part of the maze), **aisles** (tall racks, 1–2 tile
   aisles), a **tank yard**, a **ring** round a sealed core. No two of a kind
   adjacent; squeeze before and after every release.
3. **Pay-outs and gates**: rotating dead-end rewards (begun: a shelter, a
   look-out landing with a lamp, a balcony off a doorway, a look-out room
   with a slit, a plain end); still to do: one-way drops with a way back;
   far-side hatches; loops across levels by design.
4. **Landmarks**: one tall thing per district placed off the straight route.
5. **Order before chaos**: tubes and pipes routed between ports with
   supports and capped ends, in layers with right-angle bends (pipe-routing,
   real-industrial); then the chaos pass breaks that order near the fault,
   with a budget and one cause.
6. **The cause** (proposal, to agree with the user): the plant is still
   *building itself* from an instruction that was never cancelled and is now
   corrupt. So: catwalks extended over nothing, one bay stamped forty times,
   parts delivered to an empty bay, new clean steel grafted onto old, a
   count that no longer adds up. The fault is where the instruction is
   being issued. Exits to other worlds are where it has built through.

## 10. Lots: the endless world (design, agreed direction; not built yet)

**Where we are.** The industrial world is *not* made of lots today. One
generator plans a whole 160 × 160 tile world at once (districts, then blocks
and streets, then one maze over all of it) and then builds it. It is seeded
and repeatable, but it has an edge, and nothing can be added to it far away.

**What the user asked for.** No edge, ever. New ground made far enough away
not to be seen, with no stutter, for a very long way. Only what is near is
loaded; the rest is remembered (it is a function of the seed). Sections and
features easy to add once there is an editor. Every seed works with no check
by hand. A fix to the generator fixes every world.

### The lot

- The world is an endless grid of **lots**, 32 tiles square (4096 units,
  about 100 m), full height. A lot is a pure function of
  (world seed, lot x, lot y): the same lot every time, whatever was made
  before it.
- Each lot **owns the avenue along its south side and its west side** and
  the crossing at its south-west corner. So every lot is ringed by avenues,
  each built by exactly one lot. An avenue's lane keeps one line for the
  whole of its length, so lanes meet squarely at every crossing.
- **Borders are agreed before either side is built.** For each border there
  is a small pure function of (seed, border): where the neighbour's streets
  come out onto the avenue, how wide, on which levels a catwalk crosses.
  Both lots read the same function, so the streets, catwalks and doors line
  up without either lot looking at the other's inside. Every border has at
  least one crossing.
- **Inside**, a lot is planned as the whole world is now: blocks and streets
  by cutting, a maze over junctions and levels. Two rules make it safe:
  streets may reach the north and east sides only at the agreed crossings;
  and the lot's maze must join every crossing to every other (if the random
  maze leaves one out, the shortest way to it is added). Then the whole
  world is one maze, because each lot is, and each border has a crossing.
- A lot's **kind** (canyons, alleys, yards, works, racks) comes from its
  place: kind = table[(x + 2y) mod 5], shuffled by the seed. No lot has a
  neighbour of its own kind.
- An avenue is not always an open street. By the border's hash it may be a
  narrow alley, a wide street, a hall with bridges, or a **wall**: a long
  mass with the lane as a corridor inside it and a doorway at each crossing.
  That breaks the long straight views and makes district edges felt.

### Building a lot in three steps (so no lot waits on another)

1. **Plan** (pure, a few milliseconds): the layout, each mass's box, the
   hollows and doorways inside the masses. Needs only the border functions.
2. **Build** (the geometry): needs the plans of the eight lots round it (to
   tie tubes, frames and catwalks to the masses across an avenue).
3. **Light**: the lamp grid for the lot's own cells, from its lamps and the
   neighbours' lamps near the border.

So to show a lot, its neighbours are planned and built in memory too, but
only out to a known distance, and each step's result is kept.

### Loading (no edge, no stutter)

- Lots are made in a **worker** (the generator has no three.js in it), and
  come back as plain arrays: vertices by texture, prop places by model,
  collision brushes, lamps. The page uploads them a little each frame.
- **Rings** round the player: planned out to 4 lots, built out to 3, drawn
  within the fog's reach (about 6000 units, so 2 lots). A lot is always
  built before the fog can show it. Lots further than 4 are dropped; they
  are remade from the seed when needed.
- **Collision** is per lot; a move asks the lots it touches.
- **Far distances**: positions are kept as (lot, place in the lot). What is
  drawn is placed relative to the lot the player is in, so numbers on the
  graphics card stay small however far the player has walked.
- **Culling**: by lot (outside the view, or past the fog); then by the
  masses themselves, which are boxes and hide whole streets behind them
  (a small depth picture of the nearest masses, on the CPU, each frame).

### Adding things (for the editor, later)

Two sizes of module:

- **A hand-made lot**: a map of one lot with its crossings declared. A hash
  of the lot's place says "this lot is the special one" (rarely); its
  borders then take the hand-made lot's crossings, and the neighbours, which
  read the same border functions, fit themselves to it.
- **A set piece**: something smaller that goes inside a lot where the plan
  has a place for it: a room at a junction, a dead end's reward, a machine
  in a hall, a landmark. Each declares what it needs (its size, its
  doorways) and how often it may appear. The generator's own rooms, shafts,
  shelters and landings become the first entries of that list.

### Ways between worlds

Two ways were weighed.

1. **Lots of different worlds side by side**, with a rule for every pair of
   worlds on how their edges meet. The number of rules grows with the square
   of the number of worlds, each world's fog, light, scale and sound must be
   blended at the seam, and one world's long views would show the other.
2. **Portals**: rare openings, seen through, that lead to another world.
   One rule per world (what a portal's frame looks like there). Each world
   keeps its own fog and light with no blending. It fits the fiction (the
   doors of House of Leaves and MyHouse.wad, section 7's "seams"). The cost:
   a portal in view means two worlds drawn at once, and the loader must keep
   lots round both ends.

**Recommended: portals**, as the rule; and a few hand-made lots that belong
to two worlds at once (a tunnel that is industrial at one end and something
else at the other) where the user wants a slow change. The lot system above
is needed either way.

### Order of work

A. Borders and lots in the planner; a world of N × N lots loaded at once
   (proves the seams). B. The loader: worker, slices, per-lot drawing,
   collision and lamps; dropping far lots. C. Positions relative to the
   player's lot; culling by masses. D. Portals. E. Hand-made lots and set
   pieces, with the editor.

