# Maze algorithms and the character of the mazes they make

**Overview.** Every perfect-maze algorithm is a way of choosing a spanning tree over a cell graph, and each one leaves a recognisable texture: how long the straight runs are, how many dead ends there are, whether one long "river" of passage dominates, and how often the player faces a choice. For a walking game the texture matters more than the algorithm name. Long winding corridors with rare junctions feel lonely and ominous. Many short choices feel busy and puzzle-like. Our world is not a grid. It is a street network of canyons, catwalk levels and halls. Every algorithm below works on any graph, so the choice of graph and of carving rule is where "no two spaces feel the same" is won. Provenance: items marked [V] I checked in a source this session (Jamis Buck's recap post, Walter Pullen's astrolog.org pages, search results on Growing Tree). Items marked [M] are from memory of *Mazes for Programmers* and general knowledge, and I did not re-verify them.

## Algorithm vs feel

| Algorithm | Family | Texture / bias | Feel when walking |
|---|---|---|---|
| Recursive backtracker (DFS) | carver | Fewest dead ends, "long and winding passages", high river, long solution [V]. Dead ends about 10% of cells [M]. | Long lonely walks, rare branches, big backtracks when you hit a dead end. Best "lost" feel. |
| Hunt-and-kill | carver | Similar to DFS, a little less river, tunable [V]. Random walk until stuck, then scan for a new start. | DFS feel with more restarts. Several long wanderings that join up. |
| Prim's (simplified / true / modified) | carver | Low to very low river, many short dead ends, spreads evenly from the start; the modified version gives a direct solution [V]. Dead ends about 30% [M]. | Fan-out, many short choices, radial. Reads as a "bush". |
| Kruskal's | carver | Low river, many short cul-de-sacs, same texture as true Prim [V]. | Uniform and busy with no large-scale direction. Good for dense clutter. |
| Growing tree | carver | Selection rule sets the texture: newest = backtracker, random = Prim-like, oldest = lowest river [V]. Rules can be mixed by percentage, e.g. newest 50 / random 50 [V, from Buck's gist]. | The best single knob. A blend gives long passages that fork often. |
| Aldous-Broder / Wilson's | carver | Uniform over all spanning trees, low river, about 29% dead ends [M]. Wilson's is the fast one [V]. | "Honest" randomness. Medium runs, no signature, a bit grey. |
| Eller's | row-by-row | Balances winding passages and cul-de-sacs, slight directional bias [V]. Needs one row of memory. | Can stream an endless maze row by row, so it suits "generate on the fly". |
| Recursive division | wall adder | Long straight walls, no directional bias, fractal rooms-in-rooms [V]. | Reads as architecture: big rooms with doorways, nested. Closest to buildings. |
| Binary tree | carver | Strong diagonal bias, two full-length edge corridors, memoryless [V]. | An obviously "wrong" grain. One edge is a highway. |
| Sidewinder | carver | Less biased than binary tree, one long corridor along one edge, elitist and misleading [V]. | Horizontal grain with vertical escapes. Feels like stacked decks. |
| Unicursal | carver | One snake, no junctions, no choices [V]. | A pure forced walk. Zero navigation, all atmosphere. |

## Pullen's classification (astrolog.org) [V]

Pullen describes a maze by seven independent attributes. Dimension covers 2D, 3D with stairs, and "weave" with over/under crossings. Hyperdimension is separate. Topology can wrap, for example a torus. Tessellation is the cell shape: orthogonal, delta (triangles), sigma (hexagons), theta (rings), upsilon (octagon + square), zeta (grid + diagonals), crack (random angles), fractal (maze inside a maze). Routing includes perfect (no loops), braid (no dead ends), unicursal, sparse (some cells never carved) and partial braid. Texture covers bias, run length, river, symmetry and "elitism" (solution length relative to size). Focus is wall adder, passage carver or template.

Take two ideas from this. Routing and Texture are separate dials from the algorithm choice, so after carving we can post-process. And weave, planair and fractal are the standard ways to make a maze that cannot be drawn flat, which fits the House of Leaves / MyHouse.wad family.

## Perfect vs braid, and why loops matter

A perfect maze has exactly one route between two points. That is good for being lost but bad for a walking game, because dead ends are pure backtracking. A braid maze has no dead ends and every route loops, so the player can wander forever without being "stuck". Removing a fraction of dead ends (opening a wall at some of them, to give a partial braid) is the standard fix [M, Buck's book covers braiding]. A 10 to 40% braid keeps the sense of lostness but adds shortcuts and the dread of arriving back at a place you thought you had left. Loops also let the same landmark be seen from two directions, which is the core trick of a believable big place.

## Masks and irregular graphs

Buck's book and Pullen both treat the cell graph as the real input. A mask removes cells, so the maze flows around holes, which can be rooms, shafts or forbidden zones. Sparse routing leaves cells uncarved on purpose [V]. Any algorithm above works on any graph with adjacency lists. DFS, Prim, Kruskal, Wilson and growing tree need only neighbours. Eller's, binary tree, sidewinder and recursive division need a grid or row structure, so they are awkward on a street network. Practical consequence: use the graph-agnostic family, with growing tree as the main tool, on our street graph. Each edge can carry a weight (street length), and the selection rule can prefer edges by weight, direction or level, which is how you impose a grain the generator itself never had.

Non-orthogonal tessellations (hexagons, triangles, crack) change corridor feel without changing the algorithm. Fewer 90 degree choices make junction memory harder, and three-way junctions at odd angles are more disorienting than four-way crossings.

## Mixing for long winding vs many short choices

- Long winding: DFS or growing tree at newest 80 to 100%, plus braid under 15%. Few junctions, long runs.
- Many short choices: Prim or Kruskal, or growing tree at random 70% or more. Dense junctions, short dead ends.
- Both in one world: assign each region its own selection rule (or its own random/newest blend) and stitch the regions. A region of DFS corridors next to a region of Kruskal clutter is perceived as a different place, even with identical models. Region seams are where the player notices the change.
- Ordered grain: binary tree or sidewinder on one district gives a visible long-axis bias that reads as a designed system (a conveyor street, a stack of decks), which makes the DFS parts feel more organic by contrast.
- Open areas: carve first, then "room punch" by clearing a connected cluster of cells (the mask inverse). Large halls become single graph nodes with many exits, so the algorithm sees them as hubs.

## What this means for our game

Rules for the generator:

1. Run growing tree on the street graph with a per-district blend, for example newest 90 / random 10 in a quiet region, random 80 in a clutter region, oldest 60 in a plaza region. Store the blend in the seed so it is reproducible.
2. Give each district a different algorithm family and a different braid percentage (0 to 40%). Layout character then differs for structural reasons, not just dressing.
3. Impose a bias on edge selection: prefer vertical stairs in one district, prefer long straight streets in another, prefer short turns in a third.
4. Carve a spanning tree first, then add loops deliberately at long dead ends (cut the longest dead ends only), so some dead ends remain as quiet destinations.
5. Treat halls as hub nodes with 3 to 8 exits. Treat tight closed parts as degree-2 chains of 6 to 20 cells with no side view.
6. Use a mask for sparse zones: leave some graph nodes unreachable but visible (across a gap, through a grating). Seeing a place you cannot reach is a stronger pull than any reachable one.
7. Make graph distance and Euclidean distance disagree: place two spots a short walk apart in space that are far apart in the maze, and the reverse.
8. Use true wrongness sparingly and keep it deterministic: weave crossings that do not meet in plan, a street that comes back to a place with a small mismatch, a stair that arrives at the wrong level.

Level layout and pacing:

- Alternate density: a tight chain of about 30 to 60 seconds, then a hall, then a junction cluster. Never more than two of the same kind in a row.
- Put one long unicursal stretch near the start so the player learns to walk before they must choose, and one near any lore beat so the walk itself delivers it.
- Plant 3 to 5 distinct landmarks per district, visible from several places. Mazes without landmarks are exhausting, and mazes with too many are trivial.
- Break the grain on purpose in one or two places per district (the diagonal catwalk, the repeated glitch segment): a loop of identical segments repeated 8 to 20 times reads as a broken generator, which fits the lore that something is breaking.

What to avoid: pure Aldous-Broder or Wilson across the whole world (grey, no signature); binary tree or sidewinder everywhere (obvious grain); perfect mazes with many long dead ends and no loops (tedious backtracking); uniform junction spacing; and any algorithm that needs a rectangular grid, since our graph is irregular.

## Sources

- Jamis Buck, "Maze Generation: Algorithm Recap", http://weblog.jamisbuck.org/2011/2/7/maze-generation-algorithm-recap (fetched)
- Walter Pullen, "Think Labyrinth: Maze Algorithms", https://www.astrolog.org/labyrnth/algrithm.htm (fetched)
- Jamis Buck, *Mazes for Programmers: Code Your Own Twisty Little Passages*, Pragmatic Bookshelf, 2015 (search listing only; percentages marked [M] are from memory)
- Jamis Buck, growing tree gist, https://gist.github.com/760749 (seen via search result; mixing rule as summarised there)
