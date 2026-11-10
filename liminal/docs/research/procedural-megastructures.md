# Generating very large or endless worlds: hierarchy, chunks, determinism

**Overview.** Every large-world generator that works reduces to one trick: the world is a pure function of (seed, coordinates), evaluated lazily at several scales, and anything that must be coherent across a large distance is decided at a coarse scale where it is cheap to compute without neighbours' state. Tags below: **[V]** = verified from a page I fetched or searched this session; **[M]** = my memory or reading, not re-verified.

## 1. Position-hashed randomness (the determinism layer)

- **[V]** Rune Skovbo Johansen's "A primer on repeatable random numbers" splits randomness into sequence RNGs (cannot jump to the Nth value) and position hashes `hash(seed, x, y, ...)` (order-independent, ideal for on-demand chunks). His recommended pattern: hash the cell coordinate plus world seed into a per-cell seed, then feed an ordinary RNG with it to build that cell's contents in order. His own example is a world where every grid cell is a maze, regenerated identically on every visit.
- **[V]** Pitfalls he documents: seeding many RNGs with adjacent integers gives correlated output (points fall on lines); rolling your own hash is risky; Perlin/Simplex are not random-value sources; xorshift dies on state 0; floats lose precision far from the origin. He recommends xxHash (fixed-arity overloads for 1-3 ints are 4-5x faster than looping over arrays).
- **[M]** Use a different salt per decision type (as Minecraft does) so "door count" and "decay level" for the same cell are uncorrelated. Use integer coordinates only; never derive randomness from floats or from generation order.

## 2. Minecraft: placement without neighbour state

- **[V]** (minecraft.wiki, Structure set) `random_spread` places at most one attempt per `spacing x spacing` chunk region (villages: spacing 34, separation 8, salt 10387312); the attempt is offset within the region by a random 0..(spacing-separation-1), so neighbours are never closer than `separation` and never farther than `2*spacing - separation` (60 chunks for villages). `frequency` thins attempts; `exclusion_zone` keeps sets apart. The offset comes from the hash of region coords + salt, so any chunk can answer "is there a structure start near me?" by checking a few regions, with no shared state.
- **[M]** Because structures can be larger than a chunk, each chunk checks nearby regions for starts and builds only the slice of the structure that lies inside itself. This "start + reference" pattern is the standard solution to features spanning chunk borders.
- **Takeaway:** rare set pieces = jittered-grid placement at a coarse scale, with a minimum-distance guarantee and a frequency knob. It gives "rare but never absent, never clumped" for free.

## 3. Marian Kleineberg: infinite WFC cities

- **[V]** First version (marian42.de/article/wfc): chunk-by-chunk WFC failed, because collapsing one slot restricts slots several cells away, and constraints did not propagate to not-yet-generated neighbours, so later chunks sometimes had no solution. He switched to a dictionary of slots created on demand, constraint propagation across chunk boundaries, and backtracking when a slot reaches zero options. Costs: late failure can undo many steps, and in rare cases regenerates the slot under the player. Also: modules that force infinite tunnels must be excluded, and vertical limits need boundary rules (a wrapped 1xnx1 boundary map). About 100 block modules, 6 connectors each.
- **[V]** Second version (marian42.de/article/infinite-wfc): 8x8x8 chunks. Offline, generate one tiling base map, then a set of replacement patches that all share the base map's boundary profile. At runtime a chunk is rebuilt by WFC at a 4-block offset, starting from the four patches that overlap it; patch choice is seeded so neighbours agree, so chunks are independent and parallelisable. If runtime WFC fails, the chunk keeps its patch blocks (graceful fallback). Terrain height uses an integer heightmap with neighbours differing by exactly +-1 from 8 octaves of Perlin, with starting patches per 2x2 height shape.
- **Takeaway:** the robust trick is not "make the solver global" but "pre-agree on the seams": a finite library of boundary profiles that always mate, plus a guaranteed fallback when local solving fails.
- **[M]** Oskar Stalberg used WFC with hand-made tilesets in Bad North and a different implementation in Townscaper; I found no primary transcript on his chunking, so I claim nothing about it beyond that.

## 4. No Man's Sky

- **[V, weakly]** GDC 2017, Innes McKendrick, "Continuous World Generation in No Man's Sky" (GDC Vault 1024265): generation is a staged pipeline (voxel field, polygonisation, texturing, population, simulation) run continuously around the player. Secondary sources say planets derive from a seed and are identical for all players. I could not verify hash details or the 64-bit seed claim from a primary source.
- **[M]** The useful architectural point: the heavy output (meshes) is derived data, regenerable at any time from a tiny description; only the description needs to be deterministic and globally consistent.

## 5. Global connectivity while generating locally

I found no write-up of a "backbone graph" approach for endless mazes (searched; nothing relevant). What follows is **[M]**, my own synthesis from standard techniques.

1. **Coarse grid of super-cells (districts).** Each super-cell (say 8x8 chunks) has a hashed type, a hashed "portal set" per edge, and an internal route plan.
2. **Edge portals are decided by the pair, not by either side.** Hash the *edge identity* (sorted pair of cell coords, side) to get the portal position/type. Both neighbours compute the same value, so seams always mate with no communication. This is the same idea as Kleineberg's shared boundary profiles, at maze scale.
3. **Guaranteed spanning connectivity:** pick a deterministic spanning structure over the super-cell lattice, e.g. for every cell hash one "parent" direction (random-direction Aldous-Broder-like or a hashed Kruskal weight per edge: an edge is in the tree if its hashed weight is the minimum among the edges at one endpoint, i.e. Boruvka-like local rule). Each edge's weight is hash(edge id), so every cell can decide locally which of its four edges are mandatory "open" connections. A forest is not guaranteed by the local rule alone; the safe version is a randomised DFS/Wilson maze inside a bounded region (a "mega-cell" of e.g. 16x16 cells) whose boundary exits are hashed per edge, which gives connected regions joined by always-open hashed gateways.
4. **Loops on top:** after the tree, open extra edges by hashed probability (10-25%) so the maze has loops, shortcuts and dead ends rather than a perfect-maze feel.
5. **Rooms hold the guarantee, not the corridors:** inside a cell, the generator must connect all of its open portals to each other (flood-fill check, carve if not). Local solving can never break global connectivity because every cell guarantees "all open portals mutually reachable".
6. **Fallback:** if a cell fails any validity check, replace it with a known-safe "plain hall" template for that portal set (Kleineberg-style fallback to a patch).

## 6. Hierarchy, streaming, LOD

- **[M]** Typical stack: world seed, then region (theme, "breakage" level, lore zone), district (macro layout: halls vs tight bays, vertical structure), cell/room (shell, portals, floor plan), detail (props, cables, decay). Each level hashes its own coords + level salt, and each level only reads *coarser* levels, never finer or sibling ones. That is the rule that preserves determinism.
- Streaming: generate cells in a radius around the player on a worker; build collision and baked-lighting-friendly geometry per cell; keep a small LRU of generated cells. Distant cells render as a cheap proxy (silhouette box from the district plan), which is also what makes a megastructure read as huge from afar. Because lighting is baked, light data must be a function of the cell's description as well.
- Float precision: use integer cell coordinates plus local float offsets, and re-centre the render origin around the player **[V: primer lists far-from-origin float precision loss]**.

## What this means for our game

**Architecture rules**
1. World = pure function `f(seed, integer coords, salt)`; no generation-order dependence, ever.
2. Four layers: region (theme, breakage stage, set-piece sites), district (macro layout, vertical profile), cell (shell + portals + route), detail (props, cables, glitches). A layer reads only coarser layers.
3. Decide globally (cheaply, from hashes): district types, region lore stage, set-piece sites, edge portals. Decide per chunk: floor plan, geometry, props, decay noise.
4. Portals are keyed to the edge between two cells, so both sides agree with no neighbour state. Offer a small fixed library of portal profiles (door, wide mouth, catwalk end at level N, tube mouth, stairwell) that all cells can mate with.
5. Connectivity: guarantee it per cell ("all open portals mutually reachable") on top of hashed mandatory gateways between mega-cells; add hashed extra loops. Provide a plain-hall fallback template for any failed cell.
6. Rare set pieces: jittered-grid placement (spacing/separation/salt/frequency like Minecraft) per set-piece class, each with its own salt and minimum distance, plus an exclusion zone against other set pieces. Multi-cell pieces use start + reference so each cell builds only its slice.
7. Make layout vary with a "shape grammar" per district, not just with prop scatter: district type decides *topology* (a hub-and-spoke hall, a long single corridor, a grid of identical bays, a vertical shaft with ledges, a tight crawl network). That is how same-kit spaces still feel different.

**Pacing and spatial tricks**
- Alternate pressure and release in hashed rhythm: after two tight cells, bias toward a big open cell; never allow three identical district types in a row along the main route.
- Give every district one landmark visible from outside it (a huge tube, a lit tower) so the player can orient, then deliberately make some districts hide theirs.
- Vertical shafts and catwalks that overlook other districts produce "I was just there" glimpses and impossible-looking adjacency.
- Loops should return the player to a familiar spot from an unfamiliar direction.

**Signs of wrongness (tie to the breakage lore)**
- A hashed per-region `breakage` value (0..1) that rises with distance from a "start" and with proximity to a hidden "fault" point: low values give clean, ordered cells; high values add tilted catwalks, repeated modules (same bay N times with an identical flicker), mismatched seams, stairs to nowhere, missing floor tiles, scrap shelters.
- Glitch repetition = deliberately violate variety: one cell tiles a single module 7 to 40 times with no variation.
- Rarely, violate the portal contract on purpose (a door that leads to a cell whose back door does not return), as an authored error, never as an accident.

**Avoid**
- A global solver that needs neighbours' state (Kleineberg's first version) or unbounded backtracking at runtime.
- Perlin noise as a random-value source; float coordinates for hashing; seeding RNGs with raw adjacent integers.
- Uniform density: every cell with the same prop count reads as wallpaper.
- Making dead ends inaccessible by accident: fallback template over failure.

## Sources
- Marian Kleineberg, "Infinite procedurally generated city with the Wave Function Collapse algorithm", https://marian42.de/article/wfc/ (fetched)
- Marian Kleineberg, "Generating an infinite world with the Wave Function Collapse algorithm", https://marian42.de/article/infinite-wfc/ (fetched)
- Rune Skovbo Johansen, "A primer on repeatable random numbers", https://blog.runevision.com/2015/01/primer-on-repeatable-random-numbers.html (fetched)
- Minecraft Wiki, "Structure set", https://minecraft.wiki/w/Structure_set (fetched)
- Innes McKendrick, "Continuous World Generation in No Man's Sky", GDC 2017, https://www.gdcvault.com/play/1024265/Continuous-World-Generation-in-No (listing only, video not viewed)
- Oskar Stalberg, Townscaper / Bad North write-ups: https://www.gamedeveloper.com/game-platforms/how-townscaper-works-a-story-four-games-in-the-making (search result only, not read)
- Shaker, Togelius, Nelson, Procedural Content Generation in Games, ch. 3 (dungeons), https://www.pcgbook.com/chapter03.pdf (search result only)
