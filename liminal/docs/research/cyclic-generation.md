# Cyclic dungeon generation, graph grammars and mission/space generation

## Overview

Joris Dormans' line of work separates a level into a **mission** (an abstract graph of what the player does and in what order) and a **space** (the physical layout that realises it). Graph grammars rewrite the mission; a second step embeds it in space. His cyclic dungeon generation, used in *Unexplored* (2017), builds levels out of **cycles**: two routes that leave and rejoin the same two points, each route carrying a different kind of experience. Cycles can be nested and extended by rewrite rules. Mark Brown's *Boss Keys* series analyses Zelda dungeons as lock-and-key graphs, and Metroidvania design is the same idea at world scale. Almost every cycle is a *gate* plus a *detour*, and a gate does not need keys or enemies. In our game the gates are geometry, sightlines and one-way transitions, and the pacing comes from how long and how strange each side of a loop is.

Verification note: items marked [V] were read from a fetched source this session. Items marked [M] are my own memory or reading and were not confirmed here. Several primary sources blocked me (the Dormans 2010 PDF was unreadable, and the Sersa Victory PDF with all 12 cycles returned 403), so the full 12-cycle list is incomplete.

## Findings

### Mission and space (Dormans)
- [V] Dormans' framework first generates a mission with a graph grammar, then a space with a shape grammar. The mission graph is the high-level design; the space is the physical map. Source: "Adventures in level design" (2010), and the later CRC chapter in *Procedural Content Generation in Games*.
- [V] Rewrite rules either **add nodes** (extend a cycle, add a shortcut, add a trapped room) or **embellish** existing nodes (room style, treasure). His tool Ludoscope encodes the grammars. Its output is abstract, so each game has to interpret the result.
- [M] Mission nodes are typically start, goal, key, lock, obstacle, reward and filler, with arcs that mean "must precede" rather than physical distance. [V] "Arcs represent gameplay between two points, not necessarily physical distance."

### Unexplored pipeline (Boris the Brave's breakdown, [V])
- Roughly 50 grammar modules and about 5,000 find-and-replace rules per floorplan.
- Start from a ~5x5 grid of nodes, never moved or deleted, which keeps the graph planar. Random walk, then trace a loop around it. The entrance and the goal split the loop into **two arcs**.
- Pick one of **24 major cycle types**, each defining what each arc is. Examples named: two alternative routes with different obstacles; a hub where the loop is open but the exit is locked; a lake where the loop becomes a shore.
- **Minor cycles** are short detours off the main cycle, usually carrying a key or obstacle. Further rules lengthen cycles and add dead ends until a target size is reached. The average map has only a couple of embedded cycles.
- Obstacles stay abstract ("Obstacle" non-terminal) until late, then resolve to a concrete enemy, puzzle or trap by theme and difficulty. Locks and keys are explicit paired edges, so moving nodes cannot break the pair. Keys can be an item, a switch or **knowledge**. Hard locks require the key; soft locks only help.
- Graph-to-space: double the grid and insert corridor nodes, then scale 5x. Rooms become rectangles, caves use cellular automata, set pieces are placed by pattern matching (against walls, never blocking doors).
- A validator can trace what blocks progress, because the dependencies are stored as edges.

### The cycle catalogue
Named by Dormans or by write-ups [V]: **lock and key; risk/reward (dangerous short route vs long safe route); shortcut; foreshadowing loop; hidden shortcut; nested cycles; lock variants** (conditional or non-conditional; permanent or temporary; relockable; **unidirectional**, e.g. a collapsing bridge; "unsafe" locks that may be unsolvable and are kept off the main path). Variations named for lock and key: path B starts on a ledge not reachable from the start; traps on path A that activate once the key is taken; the entrance of B closes behind the player so they must finish the loop via A. The dice-based adaptation lists 12 cycles but I could not read all of them.

Patterns I would add from the same family [M]: **gambit** (take a risk to skip ahead), **reverse/mirror** (you see the lock after the key), **hub-and-spoke** (several loops from one hub), **secret** (the loop is invisible until found), **time-limited** (a temporary lock), and **metroidvania gate** (a loop that only closes after an ability is gained elsewhere).

### Zelda graph analysis (Mark Brown, Boss Keys)
- [V, secondary summaries] Over 130 dungeons across 16 games were drawn as graphs with locks and keys; a key always sits earlier in the graph than its lock, and when the player faces several locked doors, there are at least as many keys obtainable elsewhere.
- [V, secondary, one Chinese-language summary] A dungeon is either "pathfinding" (many branches to remember) or "follow-the-route" (few branches).
- [M] Brown's recurring points: dungeons that loop back on themselves are the satisfying ones; the player should see a place before reaching it; the dungeon's final item or key should reshape the dungeon so the earlier map is read again; one-way drops that deposit the player at a known place make a loop closing feel earned.
- [M] The classic "Jaquays" rules from Jennell Jaquays' tabletop work are the same idea: multiple entrances, loops, shortcuts, vertical connections, dead ends that teach.

### Metroidvania gating [M]
The world is a graph where edges are locked by abilities. The player first *sees* the place (window, ledge, visible item), then returns later. Gate types: ability, one-way, knowledge, and visibility. Backtracking becomes fast through shortcuts that unlock on the return trip.

## What this means for our game

With no keys and no enemies, each cycle is made from four gate types, and the graph validator treats them as edges:

1. **One-way drop (unidirectional lock):** a fall, collapsed stair or sliding hatch. The player lands in a pocket whose only exit is long, then a door opens only from the far side.
2. **Sight-before-reach (foreshadowing):** a window, grating, glass wall or gap shows a location (a lit chamber, a landmark tube junction) 2-3 loop steps before the route reaches it.
3. **Long safe vs short risky route:** "risk" is spatial, not combat: a narrow beam, a ladder with a gap, a dark crawlspace, a catwalk with a missing section, a section where the lights fail. The reward is time saved or a better view.
4. **Door that opens from the other side:** a bolted hatch, a shutter, or a lift call button. The player reaches the other side by the long way round and releases the shortcut, so the loop closes behind them.

### Generator rules
- Build the mission graph first, **then** the layout. Store gates as explicit paired edges (as Unexplored does) so layout changes cannot break them, and so a validator can prove every area is reachable from the start and that no one-way drop leaves the player stuck forever.
- Start with a single cycle between an entrance and a goal, then apply 3-6 rewrite rules: lengthen an arc, add a minor detour with a dead end, nest a sub-cycle, convert one arc into a gate type. Keep the average to about 2-4 cycles per district, per the Unexplored result.
- Give every arc a **role** (long hall, climb, crawl, open void, machine interior, shelter). Forbid two adjacent arcs with the same role, which is how two spaces avoid feeling alike purely from layout.
- Make arc length unequal on purpose: ratios from 1:2 to 1:5 between the short and the long side. Equal loops feel like a grid.
- Let a loop be **recognisable only on the return**: the player should realise they have walked a circle when a known landmark appears from a new angle.
- Reserve a few "unsafe" gates (possible dead ends, no guarantee of a quick escape) strictly off the main path, as Dormans does.
- Add **chaos rewrites** as grammar rules that fire rarely: a diagonal catwalk replaces one arc; a node is duplicated N times as a glitch corridor; a shelter node is built from collected parts; a loop that closes slightly wrong (the door leads back one room off).

### Pacing and spatial tricks
- Alternate tight arcs (crawl, stair shaft) with open ones (hall, void view). A loop's two arcs should differ in openness, not just length.
- Hubs are large open halls with 3-5 exits; place them at cycle entrances and use them for orientation and as places to see distant parts of other loops.
- Put the reward for a risky short route in the *view* rather than an item.
- Vertical stacking gives loops without extra footprint: a loop can run over itself on two levels.

### Signs of wrongness
- An arc that is clearly longer than it should be, or whose end meets the start at a floor height that doesn't add up (a staircase that returns to the same level).
- A repeated element, a valve, a tube mouth or a door, in a row that does not stop where it should.
- A hatch that opens from the far side only, with a worn path leading to it.

### Avoid
- Making every cycle the same size or the same gate; a catalogue only works if you vary which arc is the gate and which is the lure.
- Locks that can strand the player with no way out. Run a reachability check from every one-way landing.
- Putting the "answer" for a gate far from where the player first sees it, with nothing connecting the two.

## Sources
- Unexplored's Secret: "Cyclic Dungeon Generation" (Joris Dormans), https://www.gamedeveloper.com/design/unexplored-s-secret-cyclic-dungeon-generation- [read]
- Boris the Brave, "Dungeon Generation in Unexplored", https://www.boristhebrave.com/2021/04/10/dungeon-generation-in-unexplored/ [read]
- Dice Goblin, "Making Meaningful Dungeons with Cyclic Dungeon Generation", https://dicegoblin.blog/making-meaningful-dungeons-with-cyclic-dungeon-generation/ [read]
- Sersa Victory, "Cyclic Dungeon Generation", https://sersavictory.itch.io/cyclic-dungeon-generation [read; PDF blocked]
- Dormans, "Adventures in level design: Generating missions and spaces for action adventure games" (2010), https://pcgworkshop.com/archive/dormans2010adventures.pdf [not readable]
- Dormans and Bakkes, "Generating Missions and Spaces for Adaptable Play Experiences", https://sander.landofsand.com/publications/Dormans_Bakkes_-_Generating_Missions_and_Spaces_for_Adaptable_Play_Experiences.pdf [not read]
- Dormans, chapter on cyclic generation in *Procedural Content Generation in Games* (CRC Press, 2017) [cited via search only]
- Mark Brown, *Boss Keys* (Game Maker's Toolkit), via secondary summaries: Game Informer, Nintendo Life, Zelda Dungeon, and https://darkade.quest/2021/02/13/zelda-dungeon.html [not read directly]
