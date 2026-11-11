# Backrooms maps: study and generator plan

The user sent 5 maps and the FF3 wiki map and said: "this is how the
backrooms map will be made." Only one story, plus vents and the space above
the ceiling tiles. The next step is a 2D web tool that makes top-down plans
from a seed, with about 50 modular features that snap together.

**Decisions (user, 2026-11-11):** a knob for turned groups (square by
default, up to map 1's look); one finite map per seed; small floor-height
changes inside the one story are allowed; drawings in the clean-plan look of
map 1. Built as the Backrooms Planner (`src/planner/`, 71 features: the 70
below plus "dark room").

This file is the study. The images are not in the repo (they belong to other
people); everything needed is written down here, with numbers measured from
the pixels. Rules from it go into the generator; section 6 is the plan.

The Backrooms map is **not** the house world. The house world is rooms behind
doors. The Backrooms are openings with no doors (section 3, rule R2).

---

## 1. The sources

| Id | What | Size | Scale (my estimate) |
|----|------|------|---------------------|
| A | Fan map "The currently mapped areas of the Backrooms, 71 days after arrival". Flat colours, about 150 hand-written notes. | 2000×1947 px | corridor 8–10 px ≈ 4–5 ft, so 1 px ≈ 0.5 ft; the map is ≈ 1000 ft (300 m) across |
| B | "Backrooms Level 0, The Lobby map". Pixel art: olive floor, black walls and solids, yellow outside. | 669×448 px | pillar pitch 11 px ≈ 12 ft, so 1 px ≈ 1.1 ft; ≈ 730×490 ft |
| C | Tabletop battle map (Wendigo Workshop, Patreon preview). Square grid, thin walls with door gaps, furniture. | 447×447 px | grid 10 px; ≈ 45×45 squares of 5 ft ≈ 225 ft |
| D | Pen sketch on yellow legal paper, A24 "Backrooms" promo ("not for sale"). | photo | no scale |
| E | Pixel map of the Kane Pixels zones (FF1 main zone, 14A–14D, Red zone, maze, time crossing, 2nd hall, fake farm, presentation zone). Native 409×272, shown at 2×. | 409×272 native px | pillar pitch 12 px, light dots every 4 px, so 1 px ≈ 1 ft; ≈ 400×270 ft |
| F | FF3 map on the Kane Pixels Backrooms wiki (Map:FF3_map). The image download was blocked (403); only its data was read. | 3000×2000 px | — |

Web search found no other top-down maps worth adding. Two useful notes came
up: a fan map of an Apeirophobia Level 0 is "a jagged shape full of islands of
walls; some walls don't reach the ceiling"; and in the Kane Pixels "above the
ceiling" video a team takes down one ceiling tile and one light fixture to
look at the space above. `docs/research/backrooms.md` has the canon notes
(pillar rooms, arch rooms at dead ends, hole clusters, sealed red-room loops,
blackout zones with sunken wet floors).

### Measured numbers

| What | Value | Map |
|------|-------|-----|
| Floor share of the explored area | 0.66 (the rest is solid or void) | A |
| Pieces | 1: everything joins into one network | A |
| Local width (2 × distance to the nearest wall, on the ridge lines) | 10% < 4 px, median 20 px, 90% < 52 px | A |
| Width classes | 27% corridors (6–14 px ≈ 3–7 ft), 33% rooms (14–30 px), 24% big rooms (30–70 px), 4% halls (> 70 px) | A |
| Rooms (cut at doorways) | ≈ 430; side of the same-area square: median 27 px (≈ 13 ft), 90% < 54 px (≈ 27 ft), 99% < 186 px (≈ 90 ft) | A |
| Floor in big spaces | 63% of the floor is in rooms over ≈ 30 ft; 47% in rooms over ≈ 50 ft | A |
| Wall angles | only 19% of wall length lies within 5° of the page axes | A |
| Turned patches | 81% of 120 px patches are turned more than 7° off the page grid; median 16°, 90% < 37° | A |
| Grid coherence | in a patch, 37% of the wall length is within 6° of the patch's main angle (groups share a grid; groups next to each other do not) | A |
| Colour zones | base beige tones 77% of the floor; themed zones 23%: pink-grey 8.8%, grey concrete 5.3%, green 3.0%, blue-grey 2.3%, red 2.2%, water 0.5%, white 0.3%, brown wood and salmon < 0.2% | A |
| Pillar hall | 20×19 plus-shaped pillars, pitch 11 px ≈ 12 ft, hall ≈ 240×230 ft | B |
| Floor / solid | olive floor 37% of the image, black (walls + solid blocks) 16% | B |
| Pillar hall | 15×3 plus pillars, pitch 12 ft, plus ≈ 5 ft across, 184×52 ft; wall bays at every pillar column | E |
| Lights | white dots every 4 ft: rows halfway between pillar rows; one line down the middle of corridors | E |
| Wall-fragment zone (FF1 main zone) | 45×47 ft square; about 30 free-standing pieces (T, L, I, short bars, dots) on a rough 6 ft grid; 1 ft thin walls | E |

---

## 2. Each map, part by part

### Map A: "71 days after arrival"

**How it is built.** Rooms are filled shapes with a thin darker outline. Inside
a group, rooms touch, with thin wall lines and gaps for openings. Groups are
joined by thin corridors. Almost every group is turned to its own angle. The
middle is dense and loopy (many rooms with 2–4 ways out). The edge is thin and
tree-like: long corridors run out to small groups and end in a special room or
"Unexplored". Corridors are mostly straight lines at any angle; some bend once
or curve. Small brown marks are furniture; small arrows mark stairs (pointing
down) and where a note belongs. The map has no doors drawn as doors; notes
call out the few real ones ("Doors stuck", "Door jammed – frame warped").

**Colour zones** (each is a district with its own carpet or wall):
base beige (most), yellow-beige, tan, pink-grey offices ("Office area with
pink carpet", "Really huge room, blank paper all over floor"), grey concrete
("Concrete area", "Weird humming in this room", "Pipes/vents all over walls",
"Concrete walls, earth floor"), blue-grey ("Blue carpet – reminds me of a
hotel"), grey ("I thought this grey carpet was patterned, but the design never
repeats"), red ("Red rooms", "This place makes me feel sick"), green ("Green
rooms (leafy wallpaper)", "green carpet area"), brown wood ("Rooms with wooden
floors", pool table, bedroom), blue water ("Water here is undrinkable"), white
("Everything goes monochrome in these rooms – even me"), salmon (a normal
house), cream ("Melted rooms – even the wallpaper pattern is smeared").

**Notes that are about space** (these become features):
- Size and height: "Tall room – unreachable doors in wall near roof"; "Very
  tall ceiling in this room"; "very tall room"; "These rooms remind me of my
  grandma's basement – low ceiling, concrete walls"; "Ceiling too low to
  pass"; "Ceiling gets lower and lower until it reaches the floor"; "no
  ceiling – walls rise into darkness"; "These walls stop short of the
  ceiling"; "Tall concrete room, massive pipe in ceiling"; "Largest space
  I've seen yet – but nothing here"; "This orange area is completely empty";
  "Extremely long room"; "another really long hallway".
- Floors: "Steeply sloping floor"; "This room exhausted me, felt like
  climbing a steep slope"; "Floor angles downward strongly – walls are crooked
  and lights broken"; "floor slopes down to flooded area"; "Concave floors";
  "Square hole – dropped a tile but didn't hear it land"; "Deep crevice –
  can't see bottom"; "Extreme water damage in these rooms"; "Carpet soaked
  through here".
- Passages: "Tiny narrow corridor"; "Tiny narrow corridor connects these
  rooms"; "Impassably narrow"; "Tiny crawlspace: need to slide through on my
  belly"; "room with tiny entrances"; "Very dark corridors"; "Dark hallways";
  "Felt sicker and sicker the further I went down this passage"; a ring
  corridor around a solid circle (bottom middle).
- Height changes on one story: "Long stairway down"; "staircase down";
  "balcony"; "Multiple floors apart, but same carpet. Connected?"; "These
  halls shouldn't be able to meet in this room. There are several more
  staircases on the right entrance than the left. There should be several
  floors difference between them."
- Blocks and gates: "Doors stuck"; "Door jammed – frame warped"; "can't
  unblock"; "block entryway with cupboard"; "Iron gate blocking this hall";
  "Unreachable room through here".
- Openings to elsewhere: "This whole wall is windows. There's a whole city
  out there… Why is the sun red?"; "More fake windows. These ones are painted
  on"; "Fake windows – curtains over brick walls"; "Fake storefront"; "Tiny
  crack – I hear bird song and smell grass"; "Airvent – I couldn't get the
  grate off"; "Large fan in ceiling"; "Lift – buttons are numbered
  irregularly".
- Special rooms: a normal house; a church; a theatre; a boiler room; a
  cistern; a tiled "bottomless pool"; a bathroom with safe water; a kitchen
  with canned food; a hotel room; classrooms; an empty shop area; a room full
  of sofas; pool tables; "Huge interconnected rooms"; "room with weird
  pillars"; "Rooms all totally empty"; "Furnished rooms"; "Almost normal
  decor in these rooms".
- Wrongness: "Lots of exit signs in these halls, but they lead in circles";
  "Found sketched map here – nearby rooms are the same, but rooms further away
  look completely different"; "The further I go the less there is"; "Melted
  rooms"; "Everything goes monochrome"; "Painting on wall – shows a man
  falling through the floor into a yellow room"; "Framed painting on wall –
  but painting is printed right onto wall paper"; "Torn wall paper".
- Fixtures: "Flickering lights"; "Very loud lights"; "poor lighting here";
  "Room lit by orange emergency bulb"; "Room almost pitch black"; "100s of
  wires hanging from ceiling"; "Wires all over floor here"; "Water filled
  trough"; "Line of posters – closing down sale"; "Stop sign"; "Sign on the
  wall here: 'All must go.'"; "Sign on wall: 'The End'"; "Writing on wall";
  "wall painted with trees"; "sounds behind this wall"; "Intercom endlessly
  repeating 'mind the gap'".
- Objects and events (map notes, not architecture): mannequin, chair half
  stuck in the ground, black substance, mummified rat, vanilla smell, mahogany
  desk with chained gold pen, shoe, smoking ashtray, satchel, wedding ring,
  femur, tally marks (289), receipts in many currencies, books with blank or
  gibberish pages, pile of clothes, crashed car, cardboard caveman, worst bed,
  nest smell, old camp.

### Map B: "Level 0, The Lobby"

- One giant plus-pillar hall in the middle (20×19 pillars, ≈ 240 ft square),
  with no walls inside. It is the landmark: all other parts hang on its sides.
- A checker hall next to it: dark and light squares like a chess board (solid
  blocks on every other cell, or two floor finishes).
- Dense small-room districts (top left, bottom left, right): thin walls with
  many gaps, small rooms 1–3 cells, short dead-end stubs.
- Black solid blocks of many sizes inside the districts: rooms you cannot
  enter. They make the plan read as "rooms carved out of a solid".
- A comb: narrow rooms side by side off one corridor (top middle).
- A cell block: a grid of rooms each with a black box inside (bottom right).
- Long thin corridors along the outside of the districts; a long corridor
  runs down the left side and around.
- Stairs (hatched, top left). An exit marker "LVL 188" and an arrow marker.

### Map C: battle map

- Every wall is thin, with light gaps for doorways; corridors are 1–2
  squares (5–10 ft), rooms 2–8 squares.
- Grey concrete blocks sit at wall ends and corners (pilasters and solid
  stubs), so walls look thick in places and thin in others.
- An indoor park (≈ 16×20 squares, ≈ 80×100 ft): a trapezoid with lawns, a
  round plaza in the middle and diagonal paths. Fake outdoors inside.
- A U-shaped arc of seats (an amphitheatre or meeting circle).
- A grid of dark square holes (6×6), like pits or floor grates.
- A large bright room (≈ 50×85 ft) with light fixtures lying on the floor.
- An elongated hexagon room made by angled walls (bottom middle).
- Furniture groups (beds, sofas, tables, shelves) in small rooms; a water
  stain; short dead-end stubs everywhere; T and L wall pieces.

### Map D: A24 sketch

- A corridor wraps around the whole block (outside edge, top and left), with
  a spiral stair where it turns (top).
- Big rooms with free-standing L and T walls; small square pillars dotted in a
  big hall; a room of 2×4 plus pillars.
- "Pool?": a grid of dark squares in a corner room.
- Hatched black masses: solid or unknown. Dashed walls and "?": not sure.
- Stepped (sawtooth) outer walls on the left.
- A bow-tie shape of two black wedges at a door (top middle).
- "STEEP RAMP", short stair runs (hatched blocks with steps), a curved
  dashed corridor.
- "Store" with thick hatched side walls (shelves), "PORTAL" at its door.
- "Green Rm" drawn apart from the plan, reached by an arrow: a room that is
  not next to where you enter it.
- "Old Bottles" on a wall; "dead end?"; a scribbled pile in one room.

### Map E: Kane Pixels zones (pixel map)

- **FF1 main zone**: a 45 ft square room full of free-standing wall pieces —
  T, L, I, bars, dots — on a rough 6 ft grid, 1 ft thick. No rooms: just
  walls standing in a field. Two openings at the bottom, one at the top.
  This is the classic Level 0 "maze of walls".
- **14A**: the same idea, denser, with lights. **14B**: a small room whose
  bottom wall has a stepped T bump. **14C**: a pillar room (3×8 plus pillars).
  **14C′**: grey concrete rooms (the back area). **14D**: a corridor with a
  tiled grid floor.
- **Big pillar hall** (bottom): 15×3 plus pillars, pitch 12 ft. The outer
  wall has a bay at every pillar column: the wall follows the pillar grid. A
  thin partition runs from the wall to one pillar.
- **Red zone**: a 4-lane road with red rooms on both sides, a grey road
  surface leading off both ends: a street running through the building.
- **maze**: corridors with dotted lights and small rooms. **time crossing**:
  a small knot of corridors with loops. **2nd hall**: a big irregular hall with
  thin walls inside. **Static dead end**: a corridor that ends. **Fake farm**:
  a long corridor that ends in a green field. **Lifeform's house**: a long
  corridor, then a curved path. **Presentation zone**: a dense office floor
  with many thin walls and a coloured route line drawn through it.
- Lights are white dots every 4 ft: a single line in corridors, rows between
  pillar rows in halls.

### Map F: FF3 (data only)

Map key: "Height Level 1" to "Height Level 5" (#44ad71, #295f8a, #5f3f2b,
#cec49f, #a35c76) and "Red City" (#fa0000). So the FF3 map colours areas by
**floor height**: one story, five floor levels joined by steps and ramps.
Marked places: Red City (Crimson Corridor, Red Road), Classroom Area (the
office rooms), Still Life Area, the father's house (a whole house inside),
Playroom Area (an indoor yard), Speaker Room (dance room), Recording Studio
(radio room), Classic Backrooms, Creaky Residence (furniture showroom), Old
Attic (old living room), Maintenance Area (concrete back area), Conference
Office Area, Caveman Cutout, Common Backrooms (hallway with rubble).
**To do:** the user can send the FF3 image; then this section gets the same
part-by-part study.

---

## 3. Rules learned (all maps)

- **R1 Floor first.** Every map draws floor shapes; walls are their edges.
  Inside walls are thin lines with gaps. So the generator makes floors and
  derives walls from them. That is what lets parts join with no seams.
- **R2 Openings, not doors.** Ways through are gaps. A real door is rare and
  is a feature (stuck, jammed, a gate). This keeps the Backrooms apart from
  the house world.
- **R3 Two scales.** Thin corridors (3–6 ft) join rooms (10–30 ft). A few huge
  halls (50–250 ft) hold about half of all floor (A: 47% in rooms over 50 ft).
- **R4 Heavy tail.** Many small rooms, few giant ones: median ≈ 13 ft, 90% <
  27 ft, 99% < 90 ft.
- **R5 Zones.** One base look covers about three quarters of the floor;
  themed districts (carpet, wallpaper, furniture, one idea) cover the rest, in
  patches from a few rooms to a few dozen. About 12 themes per 1000 ft map.
- **R6 Local grids.** Each group of rooms has its own grid. In map A most
  groups are turned to odd angles (median 16°); in maps B–E all are square.
  Corridors bridge the gaps between grids.
- **R7 Core and fringe.** A dense, loopy core; a sparse fringe of long
  corridors to small groups that end in something special or in "unexplored".
  "The further I go the less there is."
- **R8 Long corridors** are straight at any angle, or bend once, or curve
  gently. A long corridor usually leads to something.
- **R9 Regular halls follow their grid.** Pillar halls are perfect grids
  (pitch ≈ 12 ft); the walls around them make a bay at every pillar column.
- **R10 Wall fields.** Some zones are only free-standing wall pieces (T, L, I,
  bars, dots) on a coarse grid (≈ 6 ft). No rooms, no corridors.
- **R11 Solids.** Black or hatched blocks are places you cannot enter. Rooms
  read as carved out of a solid; some blocks hide an "unreachable room".
- **R12 Lights on a grid.** Ceiling lights every ≈ 4 ft in rows in rooms and
  halls, one line down the middle of corridors. Dark rooms and dark
  corridors are features.
- **R13 Landmarks are rare** and easy to read (pool, theatre, church, boiler
  room, house, shop, a whole street). They sit at dead ends, at the end of a
  long corridor, or as the hub other parts hang on (map B's pillar hall).
- **R14 One story, many floor heights.** Steps, ramps, sloped rooms, sunken
  pools and pits, low and high ceilings, a ceiling that drops to the floor,
  walls that stop short of the ceiling (map F colours five floor levels).
- **R15 Impossible links.** Some links do not fit the plan: a portal at a
  door, a room drawn away from the plan, two halls that meet across "several
  floors", exit signs that lead in circles, nearby rooms that repeat.
- **R16 Unknowns are drawn.** Dashed walls, "?" and "unexplored" ends: the
  map shows what is known. The tool can draw the same (a "fog of mapping").

---

## 4. Feature catalogue (70 to start)

Each feature is a node, like a Blender geometry-nodes group: it has inputs
(size, count, seed, style) and gives floor shapes, inside walls, pillars,
openings, lights, marks and **ports** (snap points with a width and a
direction). Ports snap to ports; walls are made after everything is placed.

Sources: A–F as in section 1; R = `docs/research/backrooms.md`.

### Passages
1. **Corridor** — straight, 2–3 tiles (4–6 ft), any length; lights on the
   centre line. A–E.
2. **Bent corridor** — one or more right-angle turns on the zone grid. A–E.
3. **Curved corridor** — an arc between two ports. A, D, E.
4. **Long run** — a very long straight corridor (300+ ft) at any angle to a far
   group; usually ends in something. A, E.
5. **Narrow passage** — 1 tile (2 ft) or less; can be "impassably narrow".
   A.
6. **Ring corridor** — a loop around a solid core (round or square). A, D.
7. **Wrap corridor** — a corridor that follows the outside edge of a zone. B,
   D.
8. **Dead end** — a branch that stops; the end gets a payout (a landmark, 52–60,
   or a mark). A, D, E.
9. **Corridor knot** — a small tangle of corridors with loops ("time
   crossing"). E.
10. **Comb** — narrow rooms side by side off one corridor. B, C.
11. **Stair run** — steps up or down inside the one story. A, B, D.
12. **Ramp** — a sloped passage ("STEEP RAMP"). A, D.

### Rooms and room groups
13. **Room** — a rectangle with 1–4 openings.
14. **Odd room** — 2–4 rectangles joined; "very irregularly shaped". A.
15. **Turned group** — rooms sharing one grid, turned as a whole. A.
16. **Room chain** — rooms in a row, each opening into the next. A, B.
17. **Cell block** — small rooms on both sides of a corridor (offices,
    classrooms). B, C, E, F.
18. **Cubicle grid** — a grid of small cubicles with low thin partitions. B.
19. **Tiny-entrance room** — reached only through very small openings. A.
20. **Long room** — an extremely long, narrow room. A.
21. **Huge empty hall** — the "largest space", with nothing in it. A.
22. **Open plan** — big interconnected rooms with partial walls. A.
23. **Big odd hall** — a large irregular hall with thin walls inside ("2nd
    hall"). E.

### Halls with a grid
24. **Plus-pillar hall** — plus-shaped pillars on a 12 ft grid. B, D, E.
25. **Square-pillar hall** — small square pillars on a grid, some out of line.
    D, R.
26. **Bay hall** — a pillar hall whose walls make a bay at every pillar
    column. E.
27. **Checker hall** — solid blocks on every other cell, or two floor
    finishes like a chess board. B.
28. **Arch room** — arches in a row; at dead ends and between zones. R.
29. **Hole cluster** — a dense grid of holes or grates in the floor. C, R.

### Wall fields ("strange areas of just walls")
30. **Wall-piece field** — free-standing T, L, I pieces and dots on a coarse
    grid; the classic Level 0. E (FF1 main zone, 14A), D.
31. **Wall islands** — solid blocks standing in an open area. B, C.
32. **Thin maze** — a true maze of thin walls inside a box. C, E.
33. **Short walls** — walls that stop short of the ceiling (drawn dashed).
    A.
34. **Sawtooth wall** — a stepped, zig-zag wall line. D, A.
35. **Wedge walls** — angled walls: bow-tie wedges at a door, hexagon rooms.
    D, C.
36. **Solid mass** — a block you cannot enter; may hide an unreachable room.
    A, B, D.

### Edges and links between zones
37. **Carpet change** — a line where the floor and wall finish change. A.
38. **Stuck door** — a rare real door that does not open (or a jammed frame).
    A.
39. **Blocked opening** — an opening filled by furniture or a cupboard. A.
40. **Bar gate** — bars across a hall; you can see through. A, R.
41. **Window wall** — a wall of windows to an outside you cannot reach. A.
42. **Fake window** — painted windows, or curtains over brick. A.
43. **Shop front** — a store front set into a wall, sometimes fake. A, D.

### Floors and ceilings (one story)
44. **Sloped floor** — a room whose floor tilts; walls may lean. A.
45. **Split level** — a raised or sunken part, a balcony, a few steps. A, F.
46. **Ceiling drop** — the ceiling gets lower until it meets the floor. A.
47. **Tall room** — very high ceiling, maybe doors high in the wall. A.
48. **Low room** — low concrete ceiling (basement feel). A.
49. **No ceiling** — walls rise into darkness. A.
50. **Pit** — a square hole or a deep crevice in the floor. A, C.
51. **Flooded rooms** — floor slopes down into standing water. A, R.

### Landmark rooms
52. **Pool room** — a tiled pool, maybe "bottomless". A, D, R.
53. **Theatre** — seats in rows or an arc facing one wall. A, C.
54. **Church hall** — a long hall with pews in rows. A.
55. **Machine room** — boiler room, cistern, tall room with a huge pipe. A.
56. **House inside** — a whole normal house inside the maze. A, F.
57. **Indoor park** — lawns, paths and a round plaza under the ceiling. C, F.
58. **Fake outdoors end** — a corridor that ends in a fake field or farm. E,
    A.
59. **Indoor street** — a road with rooms or fronts on both sides. E, F.
60. **Back area** — grey concrete rooms with pipes and vents. A, E, F.

### Above the ceiling (layer 2)
61. **Plenum** — the space above the ceiling tiles, everywhere there are
    tiles; reached where a tile is out. Video, A.
62. **Duct** — a crawlable air duct that follows corridors. A.
63. **Vent grate** — a grate in a wall, floor or ceiling into a duct. A.
64. **Crawlspace** — a belly-crawl link between two rooms. A.
65. **Ceiling hatch** — a missing tile or hatch to climb up. Video.

### Impossible links
66. **Portal** — an opening that leads to a far place. D, A.
67. **Circle route** — exit signs and halls that lead back to the start. A.
68. **Repeat rooms** — nearby rooms are copies of each other. A.
69. **Impossible stairs** — stairs that go down and arrive on the same level,
    or two halls "floors apart" that meet. A.
70. **Melted room** — smeared walls and pattern. A.

### Marks (small, drawn as symbols)
Ceiling lights (grid, centre line, broken, flickering, emergency orange),
exit signs, hanging wires, pipes on walls, ceiling fan, furniture groups,
posters and signs, painted walls, notes. Objects and events from map A
(mannequin, smells, sounds…) go in as free text notes.

That is 70 numbered features. The first build does all of them as 2D
drawings; some (melted, monochrome, smell) can only be a colour, hatch or
symbol in 2D.

---

## 5. What the drawings must show

- Floor fill per zone colour; thick dark outer walls; thin inside walls.
- Pillars, solid masses (black or hatched), openings as gaps.
- Lights as dots; stairs and ramps hatched with an arrow pointing down.
- Floor height as a tint or number (map F); ceiling height as a mark.
- Layer 2 (ducts, crawlspaces, hatches) as dashed lines over the plan.
- Unknown parts dashed with "?" (map D), notes as text (map A).
- A scale bar in feet and a 2 ft grid on demand.
- Export PNG, SVG and JSON (JSON is for the 3D builder later).

---

## 6. Generator plan

Not lots, not point clouds. Five stages; each one uses something from the maze
research (`docs/WORLD_DESIGN.md` section 4, `docs/research/*`).

**Units.** 1 tile = 2 ft (the ceiling tile). Corridors 2–3 tiles, rooms 5–15,
halls 25–125, pillar pitch 6 tiles, light pitch 2 tiles. The 3D builder later
maps 1 tile to 24 inches.

1. **Plan graph (cyclic graph grammar).** Start from a loop, then rewrite:
   "edge → long run with a payout at the end", "node → hub with 3–8 spokes",
   "edge → two-arm loop with unequal arms (1:2 to 1:5)", "leaf → landmark".
   Nodes are zones with a feature type; edges are links (corridor, opening,
   stair, ramp, portal, duct). Knobs: loop share 20–30% in the core, dead-end
   share rising towards the fringe, landmark count, theme count.
2. **Placing (growth with frames).** Grow outward from the start zone. Each
   zone gets a footprint from its feature and a frame (origin + angle): keep
   the parent's angle, or turn (the "turn" knob: 0 = maps B–E, 1 = map A).
   Zones snap port to port. If a zone does not fit, try other ports, then
   other sizes, then backtrack. Density falls with distance (R7). Room sizes
   come from a heavy-tailed draw fitted to map A (R4).
3. **Linking.** Graph edges whose zones did not end up touching are routed as
   corridors: shortest path on a fine grid around the zones, then pulled
   straight (string pulling). This gives map A's long straight corridors at any
   angle; a "bend" knob keeps them on a grid instead.
4. **Filling.** Each zone runs its feature's own recipe: pillar grid and
   bays, wall-piece field (wave function collapse over T/L/I/dot/empty tiles
   with a check that the field stays connected), cell block, cubicle grid,
   thin maze (growing tree; newest/random blend and braid share per zone),
   rooms by subdivision, comb, and so on.
5. **Walls (wrap and snap).** Union all floor shapes, then offset the edge
   outwards to make walls, so parts that meet merge with no seams. Openings
   are cut where ports meet. Inside walls are clipped to the floor. Walls next
   to a pillar grid get bays. Then lights (zone ceiling grid), marks,
   impossible links, and layer 2: the plenum over all tiled ceilings, ducts as
   a tree along corridors joining the vent grates, crawlspaces as short cuts
   between rooms that are close but not joined.

**Checks after every run** (shown in the tool, like `world:walk`): all reached
(except features marked unreachable), dead-end share, loop share, corridor
width, overlaps, floor share (target ≈ 0.66), room size spread against R4.

**The tool.** Seed and size; knobs (turn, density, loops, dead ends,
corridor share, landmarks, themes); a palette of all features with on/off and
weight. Edit by hand: place a feature, drag, turn, snap ports, re-roll one
zone, lock zones, undo. Layers: floor, above ceiling, notes. Export PNG, SVG,
JSON. Same seed, same map.
