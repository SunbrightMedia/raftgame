# Level design for exploration: landmarks, vistas, interconnected worlds

## Overview

An explorer with no loot and no enemies is driven by three things: a destination seen early and reached late (the weenie), a route that keeps changing the player's spatial feeling (compression and release), and the slow build of a mental map that is eventually rewarded by a shortcut that folds the world onto itself. This report extracts mechanisms from Disney's weenie practice, Sucker Punch's landmark taxonomy, FromSoftware's interconnected maps, Valve's iterative process, Nintendo's four-beat structure, Metroidvania map knowledge and walking-simulator pacing. Provenance: items marked [V] were read in a source during this session; items marked [M] are my own memory or reading and should be treated as unverified. Web search was thin on primary sources (Valve talks, Nintendo interviews), so much of the Valve and Nintendo material is [M].

## Weenies, flags, breadcrumbs

- Origin: Walt Disney's "weenie" is a tall landmark (Sleeping Beauty Castle) that pulls guests toward an area; Disneyland also uses "hub and spoke" planning so the castle is visible from every land. [V that the term and use exist; the hub-and-spoke detail is M]
- Sucker Punch (Ghost of Tsushima, GDC 2021, Parker Hamilton) splits landmarks into **weenies/flags** (tall, visible against the skyline from far away, range set by priority), **short flags** (tall but only visible nearby; they confirm "yes, investigate this"), and **breadcrumbs** (ground-level markers such as torii gates spaced as a soft countdown to hidden content). [V]
- Their density metric: something should call to the player **every 30 seconds or less** of travel. It is about seeing a lure, not reaching content. They tuned by adding or removing landmarks where the gap was too long or too short, and cleared trees that blocked sightlines. They also used motion and particles (smoke, birds, fireflies) to make landmarks readable at distance, and let landmarks change state after the content was done. [V]
- Valve (Half-Life 2, Portal) uses light, colour and movement as guidance: brighter or warmer area at the end of a corridor, a moving object (a gunship, a rising crane) as a beacon, and the "visible but not yet reachable" window before a section. Commentary tracks and playtesting-by-observation (watching silent players, noting where they stop and look) drove placement. [M]

## Showing early, reaching late

- Dark Souls: Blighttown is visible below the cliff by Firelink Shrine long before it can be reached; parts of Izalith are visible from the Tomb of the Giants; the hub stays in view as a reference while you descend. [V]
- The pattern is: show -> deny (no direct path) -> let the player build a mental route -> arrive from an unexpected direction. Arriving from the side or above feels like discovery rather than payoff of a straight line. [M reading]
- Previously visited places become distant landmarks, which turns the whole world into a skyline of memories. [V]

## Interconnection and shortcuts

- Dark Souls routes: Firelink -> Undead Burg -> Firelink and Firelink -> Lower Undead Burg -> Blighttown -> Firelink are described as macro loops. A reopened aqueduct after the Taurus Demon connects straight back to the hub; an elevator from Undead Parish returns to Firelink; circling Darkroot Garden skips an area. A commentator's phrase: "you don't find shortcuts, you find how one area is connected to the other." [V]
- Limit: the connectivity weakens late in the game, after Anor Londo, where the spread-out end goals no longer fold back. [V] Lesson: fold-back density must be maintained to the end, or the world feels like a list.
- Bloodborne's Central Yharnam (loops built around lanterns and ladders that open from one side only) [M]. One-way gates are the key tool: a door, ladder or elevator that opens only from the far side is a cheap way to make a long route a short one without the player being told.
- Rule of thumb from these maps [M reading]: each region should have a long way in and a short way back, and the short way should reveal that two places you thought were far apart are neighbours.

## Compression and release

- Alternate tight, low, dim, linear spaces with open, high, bright, many-exit spaces. The contrast does the emotional work; a release only feels big after a compression. [M, general level design lore]
- Half-Life 2's canal and Ravenholm, and Portal's test chambers vs. the behind-the-scenes passages, repeat this: sealed sections punctuated by a view out to the real scale of the facility. [M]
- Nintendo's four-beat kishōtenketsu (introduce, develop, twist, reconcile) applied to space rather than mechanics: enter a room type, walk it twice differently, subvert it, then close it. In a no-combat game the "twist" is a spatial one: the floor is where the ceiling was, the same corridor is rotated, the room is empty. [M; my adaptation, not a Nintendo claim]

## Map knowledge and curiosity rewards

- Metroid/Hollow Knight: the player's own map is the reward currency. Locked-looking places become known, then become reachable. Hollow Knight sells maps via a cartographer and shows unmapped rooms as blanks, so incomplete knowledge itself drives wandering. [M]
- With no loot, rewards for curiosity are: **a view** (a vista that reframes scale), **a fact** (a note, label, terminal log, maintenance sign that adds to the lore), **a shortcut** (the world gets smaller), **a place to be** (a small shelter or nook, a rest point), and **a change** (the world is different when you return). All are cheap to generate. [M reading]
- Item-free worlds should hide the reward just off the main flow: one detour of 10 to 40 seconds, never more than one wrong turn from the path.

## Walking-simulator pacing

- Edith Finch: each family member's room is its own mini-level with distinct aesthetics and mechanics, and the narrative pacing is tightly curated; Gone Home lets the player find information in nearly any order. [V from reviews]
- Gone Home's house is a lock-and-key structure: the house is small, but secret passages and locked rooms parcel out reveals. [M]
- Dear Esther is linear, paced by sound, light and monologue triggers placed along the path (about one beat per few minutes). [M]
- For a 20 to 60 minute wander, plan 4 to 8 "beats" (a vista, a reversal, a lore reveal, a shortcut, a rest), not a continuous stream, with quiet stretches (60 to 120 seconds with nothing new) between. Numbers are my estimates. [M]

## What this means for our game

**Generator structure**

1. Build a graph first, not a grid. Use a "bubble diagram": nodes are space types (hall, canyon, tube junction, shelter, shaft, bridge, dead end), edges are connections with a type (open, door, stair, one-way, hidden). Then lay out geometry from the graph.
2. Generate a spanning tree with a long main route, add **loops** so about 20 to 30 percent of edges close cycles, and mark at least 3 to 5 edges as **fold-back shortcuts** (one-way from the far side: a ladder dropping, a hatch, a lift gated until the player arrives from the other end). Keep shortcuts coming throughout, not only early.
3. Give every node a **space-type tag** with distinct metrics: width, height, light level, repetition rhythm, sightline length, number of exits. Forbid two adjacent nodes of the same tag, and forbid the same tag more than N times in a 5-node window, so layout alone makes each space feel different.
4. Choose a compression/release sequence per route: after each large release (open hall), force a compression (low tube, tight service duct) within 1 to 3 nodes, and vice versa.

**Landmarks and vistas**

5. Plant 5 to 8 **weenies** per world (tall structure, a lit machine, a column of steam, a giant slow-moving mechanism). Each must be visible from at least 3 distant spots and reachable from none of them directly. Place them so one is always visible within roughly 30 seconds of walking, except in deliberately blind compression sections.
6. Give landmarks **motion or light** (rotating, blinking, steam, a failing light) so they register at distance; add an audio signature for the nearest ones.
7. Place **short flags** and **breadcrumbs** (a repeated marker, such as a painted number or colour band, getting denser toward a goal) so a goal reads as "getting warmer" before it is seen.
8. Put a **vista** at the end of each long compression: a window, gap or catwalk edge looking across the world at something the player cannot yet reach, ideally a place they will reach later from another side.

**Pacing**

9. Schedule beats on a timer-like budget: one reward or reveal about every 3 to 6 minutes, a lore fact about every 2 to 4, a vista after every compression, and a **quiet zone** between. Reuse the same lore line twice, in different places, so repetition itself reads as significance.
10. Open the world in four beats: introduce a rule (e.g. numbered doors), develop it, break it (a wrong number, a missing door), reconcile (the numbers were a countdown).

**Signs of wrongness**

11. Places where the layout disagrees with itself: a corridor longer inside than outside, a door onto a wall, a stair that returns to the same landing, repeated rooms differing by one detail, a weenie that is closer from the far side than the near side.
12. Make wrongness **escalate** along the main route and let the player see a calm version first.

**Avoid**

- Dead ends without a payoff (a view, a fact, or a one-way route back).
- Uniform density; long stretches of identical corridor without a landmark.
- Shortcuts that merely open early (the Dark Souls lesson: connectivity faded late).
- Indicators that tell the player where to go; prefer in-world guidance only.

## Sources

- Game Developer, "A taxonomy of Weenies: the landmarks that define Ghost of Tsushima" (Parker Hamilton, GDC 2021 recap): https://www.gamedeveloper.com/design/a-taxonomy-of-weenies-the-landmarks-that-define-i-ghost-of-tsushima-i-
- TheGamer, "Dark Souls 1: FromSoftware's Magnum Opus Of Interconnected Level Design": https://www.thegamer.com/dark-souls-1-fromsoftwares-magnum-opus-of-interconnected-level-design/
- Medium, "The Ultimate Methodology of creating Souls-like Level": https://medium.com/@bramasolejm030206/preface-ec08bc1459d0
- Game Developer, "What Mario Learned from Mickey Mouse, Part 3: Decision Making and Weenies": https://www.gamedeveloper.com/design/what-mario-learned-from-mickey-mouse---part-3-decision-making-and-weenies
- Mechanics of Magic, "Critical Play: Walking Simulators" (Edith Finch / Gone Home comparison): https://mechanicsofmagic.com/2026/07/15/59595/
- Half-Life 2: Lost Coast (Wikipedia, commentary mode): https://en.wikipedia.org/wiki/Half-Life_2:_Lost_Coast
- Jenova Chen, "Design Flow in Games": https://jenovachen.info/design-flow
- Not located: Valve GDC talks and developer commentary transcripts, Nintendo kishotenketsu interviews, and Hollow Knight map-design talks. Items attributed to them are from memory.
