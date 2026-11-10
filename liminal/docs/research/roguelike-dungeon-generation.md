# Roguelike and action-game level generators

## Overview

Almost every generator that ships with hand-made content falls into one of four architectures. (1) Grow a layout geometrically (rooms and corridors, BSP, Brogue's accretion). (2) Fill a fixed grid of hand-drawn templates around a guaranteed path (Spelunky). (3) Plan an abstract graph first, then realise each node with a hand-made chunk (Dead Cells, Enter the Gungeon, Warframe). (4) Stitch pieces through typed connectors drawn from weighted pools (Minecraft jigsaw, Warframe portals). Connectivity is guaranteed either by construction (tree growth, a path laid first) or by the graph (the graph is connected, so any realisation is). Loops are almost always a separate, deliberate pass, because tree-based growth yields none. For a world made of large modular pieces with connectors, the best fit is a hybrid: a graph or "skeleton" decides the pacing and the guaranteed route, connector-typed jigsaw growth fills in the bulk, and a late loop-and-chaos pass adds shortcuts, anomalies and wrongness.

Provenance: statements marked [V] were read in a source this session (the source is named). Statements marked [M] are my own memory or reading and were not re-verified.

## Rooms-and-corridors, BSP, cellular automata

[M] Classics: scatter rooms and dig corridors; split a rectangle by BSP with a room per leaf, joining siblings (connected by construction); cellular automata for caves. Corridors give uniform, same-feeling space, the opposite of what we want.

[V, anderoonies Brogue write-up] Cellular automata for a blob room: a dead cell becomes alive with 5 or more living neighbours, a live cell dies with fewer than 2, run 5 generations, then flood-fill and keep only the largest connected fragment. Pruning to the largest component is the generic way to make CA output connected.

## Brogue: accretion, loops, machines

[V, anderoonies] Accretion starts with one room, then repeatedly generates a candidate room and attaches it at a random place where it fits. A candidate fits if none of its tiles overlap the existing dungeon and one of its doorways faces the dungeon. The result is "inherently traversable" because it is a tree rooted at the first room. Placement is done on a separate layer: the candidate moves around until it fits, then it is merged. Room shapes are templates: overlapping rectangles, a cellular automata blob, or a circle. Each room gets door sites on its faces; there is a 15 percent chance a room carries a hallway, and doors then snap to the hallway's end.

[V, Brogue wiki / search summaries, secondhand] After accretion, a loop pass looks for pairs of cells that are adjacent across a wall but far apart by walking distance (one write-up gives more than 20 steps), and cuts a door there. Loops are only added where they save a long walk. Then the generator maps all loops and chokepoints, which it uses to place "machines". Treasure machines appear on a fixed depth schedule (depths 3, 7, 11, 15, 19, 23 per one summary). I did not read the blueprint catalogue itself.

[M] Machines are blueprints: a feature plus placement rules (dead end, behind a chokepoint, inside a loop) and depth range. Set-pieces are rules about topology, not fixed positions.

## Spelunky: a grid with a guaranteed path

[V, procedural-content-generation wiki and blogs, citing Derek Yu's book; some path details from a single blog] The level is a 4x4 grid of fixed-size rooms (about 10x8 tiles). A start room is chosen on the top row. A random walk then steps left, right or down; hitting a side wall forces a drop, and the room it drops from becomes a type that has a bottom exit. Room types: 0 is off the path with no guaranteed exits, 1 has left and right exits, 2 adds a bottom exit, 3 adds a top exit. The walk ends by dropping off the bottom row, which places the exit. Every other cell is filled with a type 0 room. Each cell then picks a hand-made template from the set for its type; templates themselves contain randomised chunks. Off-path rooms may be unreachable without digging, which Yu treats as a feature (secrets).

Takeaways: the guarantee is trivial because only the path cells need to be consistent; everything else is decoration and optional. Hand-made rooms are small enough to be well tuned. Room types are defined by their openings, so selection is a lookup by connector signature.

## Dead Cells: concept graph plus tiles

[V, Bénard, "The level design of Dead Cells: a hybrid approach"] The island map, level connections and key locations are hand-fixed. Within a biome, a hand-authored concept graph places the entrance and exit first, then special rooms, then combat and exploration filler. The graph sets level length, number of special tiles, how labyrinthine the biome is, and the minimum number of tiles between entrance and exit. Tiles are hand-built, tagged by purpose and biome, and carry entrances and exits. For each node the generator draws a random tile from the biome pool and checks it against the node's constraints (type, entrance count, location), retrying on failure. A reply says the final algorithm moved to tile matching similar to wave function collapse. Enemy counts are derived from combat length (example: 1 monster per 5 combat tiles; dangerous ones count as 10 tiles). The post does not describe an explicit loop step. Ramparts are linear and sewers labyrinthine purely because their graphs differ, which is the key point for us: one kit, different graphs, different feel.

## Enter the Gungeon: flow files

[V, Boris the Brave breakdown and Dodge Roll interviews] A floor starts from a randomly chosen flow file: a directed graph (a tree from a root) of room types with no positions. Before placement it is mutated: some nodes become runs of random length, some sections choose one of several alternatives, and special rooms (shop, jail, elevator, fireplace) are injected. Rooms are then placed one by one by pairing exits, avoiding repeats, with corridor rooms added as needed, so the final map does not match the flow exactly. About 80 hand-made rooms existed in the demo, tailored per floor. Dodge Roll chose hand-made rooms because they could be playtested and tuned individually.

## Warframe and Deep Rock Galactic

[V, Brewer, Game AI Pro "Managing Pacing in Procedural Levels in Warframe"; summary only, not the full chapter] Designers build blocks by hand with portals as sockets; only portals of the same size connect. A per-mission template lists available blocks, their types, the length and composition of segments, and maximum branching depth. A generator emits a sequence of block types, then realises it. Pacing is controlled at the segment level. [V, forum observation only] Layouts are tree-like with few loops, and repetition shows in older tilesets, which is the known weakness of fixed small pools.

[V, Ghost Ship blog via summary] Deep Rock Galactic derives each cave from a seed string chosen at mission select; the internals are unconfirmed ([M]: tube-like carved volumes plus authored objective chambers).

## Minecraft jigsaw

[V, Minecraft wiki, Bedrock wiki, Creator docs] A template pool is a weighted list of structure templates. A jigsaw block in a piece holds a target pool (what to place next), a target name (the name the connecting jigsaw must carry), and an attachment type that filters compatible connectors. A start pool provides the first piece; generation expands outward breadth-first to a depth limit. A connecting jigsaw only matches a jigsaw with the right name. If a required name is missing in the chosen piece, that structure fails. After generation each jigsaw block is replaced by its "turns into" block. [M] Pools have a fallback, usually a cap piece, so open connectors can always be closed (a dead end, a wall plug). Collision with already placed pieces is checked, and the generator retries other pieces from the pool.

## What this means for our game

Rules for the generator:

1. Generate in layers: a skeleton graph (entrance, exit, landmarks, anomalies, locked areas), then jigsaw growth for bulk, then a loop pass, then a chaos pass. Each layer is separately seeded from the world seed so layers can change without reshuffling the rest.
2. Use typed connectors on every kit piece: size class (street width, catwalk, tube, door), level height, and an attachment tag such as "pipe", "catwalk", "tube". Only matching connectors join. Pools are weighted and per-zone.
3. Always provide cap pieces per connector type (blank wall, locked hatch, collapsed catwalk, a vent grille) so growth can finish anywhere and no connector is left open.
4. Lay the critical path first, Spelunky-style (a walk across a coarse grid, forced to wander), then grow side branches off it. The exit is always reachable by construction; side pieces are optional.
5. After growth, add loops Brogue-style: find pairs of spaces close in 3D but far by walking distance (for example over 25 steps) and join them with a catwalk, a shaft, a tube or a door. Prefer loops that connect different levels or zones, and add one-way shortcuts (drop down, unlock from the far side).
6. Make feel a function of the graph, not the kit: give each zone its own graph template (linear gauntlet, braided grid, hub with spokes, long single descent, ring) as Dead Cells does with biomes. Vary at least four parameters per zone: branching, loop density, openness (ratio of large halls to tight spaces), and vertical range.
7. Run a "machine" layer: authored set-pieces with placement rules (dead end, behind chokepoint, inside a loop, at the top of the tallest shaft) so they appear in topologically meaningful places and never the same place twice.
8. Treat flow files as mutable: replace nodes with runs of random length, pick alternate sections, inject specials (Gungeon). This provides the repetition-as-glitch effect for free, since a run of identical rooms can be an intended anomaly.
9. Validate: flood-fill reachability from spawn to exit, reject and retry with a bounded seed offset.

Layout and pacing:

- Alternate tension and release, as Dead Cells does with peaks and breaks: tight, closed runs (pipe crawlspaces, service ducts) lead into a vast hall, then a quiet transition.
- Spatial tricks: open the vertical axis (a hall seen from above before you reach it), make sightlines pull toward landmarks, and place a loop so that the player later sees a familiar landmark from a new angle.
- Signs of wrongness: the same room repeated with small changes, a connector that mismatches in size, a corridor that returns to an earlier place at a different height, a cap piece where a door should be, a door that was cut by the loop pass but has no frame.
- Avoid: a pure tree, uniform corridor width, tiny piece pools that repeat visibly (the Warframe criticism), rooms that differ only in decoration.

## Sources

- Boris the Brave, "Dungeon Generation in Enter The Gungeon": https://www.boristhebrave.com/2019/07/28/dungeon-generation-in-enter-the-gungeon/
- Gamasutra/Game Developer, "Q&A: The guns and dungeons of Enter the Gungeon": https://www.gamedeveloper.com/design/q-a-the-guns-and-dungeons-of-i-enter-the-gungeon-i-
- Sébastien Bénard, "The level design of Dead Cells: a hybrid approach": https://deepnight.net/tutorial/the-level-design-of-dead-cells-a-hybrid-approach/
- anderoonies, "Broguelike Dungeon Creation, Part 1": http://anderoonies.github.io/2020/03/17/brogue-generation.html
- Brogue wiki, "Level Generation": https://brogue.fandom.com/wiki/Level_Generation
- Procedural Content Generation wiki, "Spelunky": https://procedural-content-generation.fandom.com/wiki/Spelunky
- Derek Yu, "Spelunky" (Boss Fight Books), as cited by the above
- Daniel Brewer, "Managing Pacing in Procedural Levels in Warframe", Game AI Pro Online Edition 2021: https://www.gameaipro.com/GameAIProOnlineEdition2021/GameAIProOnlineEdition2021_Chapter07_Managing_Pacing_in_Procedural_Levels_in_Warframe.pdf
- Minecraft Wiki, "Jigsaw Block": https://minecraft.wiki/w/Jigsaw_block
- Bedrock Wiki, "Jigsaw Structures": https://wiki.bedrock.dev/world-generation/jigsaw-structures
