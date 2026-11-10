# Wave Function Collapse and model synthesis for 3D structures

Marking: **[V]** = checked this session against the cited page; **[M]** = my memory or reading, not re-verified.

## Overview

WFC and Merrell's model synthesis both fill a grid with tiles so that every pair of neighbours is allowed by an adjacency table. Both only guarantee local consistency. They produce convincing texture and detail, and they do not produce plan, hierarchy or landmarks by themselves. Every successful production use (Bad North, Townscaper, Kleineberg's city, Caves of Qud) puts a coarse, non-WFC decision above the solver and lets WFC do the fine detail. For a catwalk-and-pipe megastructure on a 128-unit grid, WFC is a good detail and connection-resolution layer. It is a poor primary layout generator.

## The algorithms

- **Model synthesis (Merrell, 2007 paper, later PhD work).** Collapses cells in scanline order, and works in blocks/chunks rather than the whole volume at once. Merrell reports a lower failure rate with no quality loss, especially in 3D. Critics note directional artifacts from the scan order. [V, via Wikipedia "Model synthesis"; Merrell's own 2021 comparison PDF not retrieved]
- **WFC (Gumin, 2016).** Always collapses the lowest-entropy cell, propagates constraints, and restarts (or backtracks, in later implementations) on contradiction. Adds the overlapping-pattern mode that lets one bitmap act as input. Fails more often on big grids because the lowest-entropy frontier is scattered and contradictions appear late. [V, same page]
- **Practical reading [M]:** for large 3D volumes, chunked solving with a fixed order is more reliable than a global lowest-entropy solve. Lowest-entropy order gives more organic results. Either way, solve in bounded regions.

## Tileset design (Boris the Brave, "WFC tips and tricks") [V]

- Define tiles by their corners/edges, marching-cubes style, so any two neighbours that share a corner label match. Rare tiles can be omitted safely, since the solver plans around absent tiles.
- Make every tile at least as wide at its base as at its top, so nothing floats. (Our equivalent: every catwalk or pipe tile must have a support option below it or beside it.)
- Simple tilesets give predictable output. A four-tile set (one empty) yields square rooms, and weights tune room size.
- Straight roads plus forks without corners approximate recursive-subdivision mazes.
- Big multi-cell tiles hide the grid and give set pieces and smooth curves.
- Variant tiles that share the original's connections can be swapped in during generation or as a post-pass. This adds variety cheaply, but a large random map still looks "samey".

## Kleineberg's infinite city [V, marian42.de/article/infinite-wfc]

- Modules are hand-authored blocks on a 3D grid. Per-face compatibility (face profile plus symmetry) defines neighbours, and spawn probabilities are authored by hand.
- Whole-world solving was unreliable (non-determinism, long walks, single thread). The fix was chunks: an offline-generated 8x8x8 tiling map with matching opposite boundaries, deterministic random patch choice per chunk, and a runtime regeneration offset by 4 blocks to dissolve seams. If runtime generation fails, the chunk keeps the pre-generated patch. So failure is handled by fallback content, not by deep backtracking.
- Height comes from a separate system: integer heightmap, neighbours differing by exactly 1, built from 8 octaves of Perlin noise clamped with a quadtree. Each 2x2 cell has one of six shape classes with its own starting patches. This is the template for "plan first, WFC second".
- Biomes change module probabilities per region, with a transition row of chunks where both can spawn.

## Driven WFC and Townscaper (Boris, "Editable WFC") [V]

User input never edits tiles. It edits hidden layers (solidity, colour) that become constraints for a fresh WFC run, and the output is always recomputed from that data. Edits are on tile corners, so one click constrains 8 cells. Tile choice is deterministic (a priority list, first fit wins) so a rerun stays stable. For us this means the "plan" (a 3D occupancy and a few labels per cell) is the source of truth and WFC is a pure function of plan plus seed.

## Global constraints

- **Path constraint [V]:** Boris's contribution, in DeBroglie. Annotated tiles are forced into one connected component, which stops WFC generating disconnected rooms and inserts doors on its own. For roads and rivers, fix the endpoints and give T-junction tiles very low weight to avoid needless branching.
- **Fixed tiles [V]:** pin entrances and exits, pre-author set pieces, or paint a floorplan boundary and let WFC fill inside.
- **Regional subdivision and biomes [V]:** pick a tileset or weights per region (Bad North per-level biome; Caves of Qud ruins vs cities).
- **Count constraints [M, partly seen secondhand]:** DeBroglie offers count limits so a feature (a landmark, a stair) appears at most or exactly N times. Merrell's papers also discuss this kind of constraint.
- **Infinite generation [V, search snippet of Boris]:** generate a lookahead margin beyond the saved area and discard it, to avoid border artifacts.
- **Known weaknesses (all sources agree):** no large-scale structure, repetition, contradictions on large grids, no guarantee of reachability without an explicit constraint, and repeated edge regeneration when chunk borders conflict.

## Fit for a catwalk-and-pipe megastructure on a 128-unit grid [my analysis]

Good fit for: choosing which girder/rail/pipe/cable-tray variant occupies each cell, resolving junctions (catwalk meets stair meets ladder), making pipe runs turn and branch plausibly, placing supports, and generating dense machinery clutter that obeys "touching faces must match". Cell size of 128 units suits one catwalk module or one pipe bundle per cell, with 3D adjacency (up/down faces for stairs, shafts, hanging cables).

Poor fit for: deciding where the streets, halls, dead ends and landmarks go, the overall maze topology, and pacing. Pure WFC will give uniform "statistical" variety everywhere, which is exactly the "every space feels the same" failure the owner worries about. Also hollow transport tubes need long straight runs with consistent endpoints, which local rules produce badly (they love short stubs). Treat tubes as pre-routed paths (A* or random walk in the 3D grid) that are then stamped as pinned tiles.

## What this means for our game

1. **Three layers, in order.** (a) Macro graph/plan: districts, hubs, corridors, loops, dead ends, landmarks, tight sections and open halls, from a seeded non-WFC generator. (b) Cell labels from the plan: for each 128 cell, a type (void, open hall, street, tight duct, shaft, mass) plus a district id and a "chaos" value. (c) WFC resolves tile choice inside each cell's allowed set.
2. **Layout, not tile mix, creates difference.** Give each district its own topology rule (grid of streets, one long axis, radial, nested boxes, vertical shaft stack, stepped terraces) and its own tile weights. Only the weights and the plan differ, the kit is shared.
3. **Pin before solving.** Pin the guaranteed path (spawn to exit and every district's door), landmarks, portals to other worlds, and big set pieces. Solve everything else around them.
4. **Connectivity is a constraint, not a hope.** Run the path constraint (or verify by flood fill on the walkable graph, and re-seed the district up to N times). Keep intentional dead ends and one-way drops out of the verified path, so the maze is solvable but not trivially.
5. **Solve in chunks.** Use bounded blocks (e.g. 8x8x8 cells, 1024 units) with fixed boundary profiles and a fallback pre-authored fill on failure. Never restart the whole world. Seed per chunk from world seed plus chunk coordinates, so generation is deterministic and streamable.
6. **Make "wrongness" a plan-level input.** The chaos value per cell biases weights toward glitch tiles: a diagonal catwalk, a tile repeated along a line (a stamp the solver is not allowed to vary, forcing the same cell pattern n times), a catwalk that ends in air, a stair that reaches a ceiling, a shelter assembled from pipes and crates. These need special tiles or post-pass stamps, because a strict adjacency table will never emit them.
7. **Break the grid on purpose.** Add multi-cell tiles and a post-pass that nudges or rotates decorations off-grid, so the 128 lattice is felt as structure and not as a pattern.
8. **Low-entropy zones for calm, high-entropy for noise.** Tight, closed sections use few tile types with strong weights (readable, claustrophobic). Open halls use sparse tiles and long sightlines. Drive that from the plan.
9. **Support rule.** Wide-base rule from Boris: every walkable or heavy tile needs a support neighbour, except tiles tagged "broken", which are the only ones allowed to float, and they are flagged in the plan.
10. **Decay as a post-process.** Because output is a function of plan plus seed, apply the "something is breaking" lore as separate passes: remove tiles near a fault line, replace panels with missing variants, repeat tiles near a glitch epicentre. The fault line grows across districts, so a late district looks more broken than an early one.

### Ideas to build

- A per-cell `plan` grid (type, district, chaos, pinned tile) as the generator's single source of truth, with WFC as a pure function of it.
- A tile table keyed by six face labels (catwalk-edge, pipe-8, pipe-16, tube, cable-tray, girder, open) plus rotation symmetry, authored from the existing kit.
- A DeBroglie-style path constraint implemented as post-check flood fill with re-seed, plus pinned entrance and exit cells.
- Tube router: random-walk or A* paths through free cells, then stamped as pinned tube tiles with proper end-caps, so hollow tubes run in many directions with sealed ends.
- A "glitch stamp" generator that picks a tile or cluster and repeats it n times along an axis, ignoring adjacency, with the plan marking the area.
- A "scavenger shelter" set piece: a small room of 3-5 mismatched pipes, plates and crates, with a lamp, placed in dead ends by count constraint (one per few districts).
- Diagonal catwalk tiles as multi-cell tiles with their own face labels, so junctions resolve around them.
- District recipes (street grid, axial hall, shaft stack, tight duct warren, terraced void) each with distinct weights and macro topology.
- Chunked, seeded generation with 4-cell offset re-solve and pre-authored fallback chunks for streaming.
- A fault-line decay pass that increases chaos and missing-tile rate with distance from a growing crack.

## Sources

- Boris the Brave, "Wave Function Collapse tips and tricks": https://www.boristhebrave.com/2020/02/08/wave-function-collapse-tips-and-tricks/
- Boris the Brave, "Editable WFC": https://www.boristhebrave.com/2022/04/25/editable-wfc/
- DeBroglie (C# WFC library with path and count constraints): https://github.com/BorisTheBrave/DeBroglie
- Marian Kleineberg, "Generating an infinite world with the Wave Function Collapse algorithm": https://marian42.de/article/infinite-wfc/
- Wikipedia, "Model synthesis": https://en.wikipedia.org/wiki/Model_synthesis
- Maxim Gumin, WaveFunctionCollapse (GitHub), and Paul Merrell's papers and EPC 2024 talk "Beyond Wave Function Collapse" (known by title, not read in full).
- Search result for Boris's infinite-generation lookahead note: https://twitter.com/boris_brave/status/1667263063920201749 (snippet only).
- Not retrieved: Oskar Stålberg's talks (Bad North, Townscaper); details attributed to Bad North/Townscaper come from Boris's articles above.
