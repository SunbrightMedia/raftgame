# Liminal walking games: layout patterns that make walking itself interesting

Method note: web search was shallow for most of these titles (storefront pages, Wikipedia, a few reviews). Items marked **[V]** were verified from a fetched or searched source this session. Items marked **[M]** are from my own memory or reading of the games and should be treated as unverified. Treat all numbers marked [M] as approximate.

## Overview

Liminal walking games with no enemies hold attention with four tools: (1) a map shape that gives the player a reason to move (hub, loop, or linear chain with branches); (2) strong contrast between consecutive spaces (scale, light, material mix, geometry), usually inside a deliberately tiny asset budget; (3) a small, legible "wrongness" or reward that rewards attention rather than skill; and (4) short sessions or clear sections, so the mood is never stretched past its supply of new ideas. The Exit 8 reduces the whole genre to one loop and one question ("is anything different?"). Yume Nikki and LSD stretch it into a hub of unrelated dream rooms. Anemoiapolis and The Complex use maze-like generated or semi-generated spaces with hand-placed set pieces. For our generator the lesson is that variety should come from layout parameters and pacing, not from more assets.

## Findings by game

**The Exit 8 (Kotake Create, 2023).** [V] One-person UE5 project, about nine months (roughly six of planning and prototyping, three of production). Core rule: walk a single underground-passage loop; at each pass decide "no anomaly, proceed" or "anomaly, turn back". Eight correct calls in a row reach Exit 8; one wrong call resets to Exit 0. The developer named three pillars: anomaly spotting, underground passageways, looping space. Anomalies are kept at "unsettling", borderline horror, and the player is mostly not killed (a few anomalies, such as red flood water or a camouflaged man, reset you if you do not turn back fast). Wishlists grew from 5,600 to just under 40,000 after the trailer. Criticism: very short (one reviewer ~15-30 minutes), low replay. [M] The loop is one corridor of fixed length with a few fixtures (posters, doors, ceiling lights, a signage board); anomalies are small deltas of those fixtures (a poster changed, a door open, a light flickering, the NPC walking wrong). The reward is certainty: the sign with the exit number is the progress meter. The design works because the baseline is memorised in seconds, so any delta is readable.

**Platform 8 (sequel/spin-off).** [V] exists as a related title; details not verified. [M] Same rules transplanted to a train platform and train interior, showing the pattern transfers to a new baseline.

**Anemoiapolis (Chapter 1).** [V] Puzzle-gated start behind a pool, then a central hub that looks like an abandoned mall food court; elevators cost tickets that are scattered widely, so exploring is the currency. Listing data: about 2 hours main story, ~4 hours completionist. Reviewers praise atmosphere and sound, call the gameplay thin, and report lighting bugs. The Steam description calls it a game about procedural labyrinths. [M] Zones branch from the hub and each is a different "place type" (pool, offices, mall, service tunnels) with its own palette and light; the sense of descent is carried by elevators rather than corridors.

**The Complex: Found Footage / Expedition.** [V] Free walking sim shown through a VHS camera; atmosphere over jump scares, with hints of a stalking creature; the sequel is more cinematic and narrative. [M] The camera filter (grain, low resolution, timestamps) lets one material set feel like many places because everything is degraded the same way; sections are linked by threshold moments (doors, stairs, ladders) rather than continuous space.

**Kairo (Skyline/Richard Perrin, 2000).** [V] A sealed hub opens after four puzzles and leads to a much larger structure; a new hub connects three further puzzles in the "engine" section, then a second level with another puzzle hub. [M] No text, no characters; scale and architecture do the storytelling. Spaces are huge and empty, then suddenly cramped machine rooms; the player learns a place by walking it repeatedly.

**Yume Nikki / Yume 2kki.** [V] Hub ("Nexus", a room of doors) from which the numerous dream areas are explored; Lisa copies this hub structure. [M] Each area is a short, mostly linear or looping map with one signature idea and an "effect" or collectible; there is no goal beyond collecting, so every area has to justify itself in a couple of minutes. Areas deliberately do not share rules.

**LSD: Dream Emulator.** [V] PS1 game about exploring procedurally generated low-poly dreams. [M] The dream "graph" jumps between scenes by touching specific objects or walls, or by timeout (~10 minutes per day); a hidden score of what you looked at steers the next dream. Walking into walls is a transition. Scene-to-scene contrast is extreme (scale, texture, lighting).

**Bernband, Interior Worlds, POOLS, Dreamcore, Superliminal.** Not verified. [M] POOLS: continuous pool-room architecture where the same tiled-water vocabulary is rearranged into tight, flooded, and vast volumes, with "wrong" spatial connections (door leads somewhere impossible); tension comes from tightness and audio. Bernband: monochrome, sparse, fixed-camera-feeling vignettes of empty rooms on a long walk. Interior Worlds: collages of photographic interiors, dreamcore palette. Superliminal: forced perspective, where size is a function of viewing distance, so the same prop is a different object; "dream logic" as a rule you learn, then break.

## Cross-cutting patterns

1. **Map shapes.** Hub-and-spokes (Anemoiapolis, Yume Nikki, Kairo) gives free choice and a reset point; loop (Exit 8) gives repetition-as-mechanic; linear-with-branches gives pace. Hub + short loops inside spokes is the most common mix.
2. **Sharing materials but not feel.** Differences come from scale (ceiling height versus width), light (one source versus many), sound, route shape (straight, jagged, spiral), and what is visible beyond the room. [M] Rooms feel the same when the player's three questions (where can I go, how far can I see, what is lit) have the same answers.
3. **Compression and release.** Tight, closed parts followed by a very large open one are the single strongest tool; the release only works if the squeeze came first.
4. **Rewards without enemies.** Tickets (Anemoiapolis), puzzle unlocks (Kairo), collectible effects (Yume Nikki), progress numbers (Exit 8), vistas, and lore objects.
5. **Short sessions.** Exit 8 ~30 minutes, Anemoiapolis 2-4 hours; both stop before the formula wears out.

## What this means for our game

**Generator rules**
- Generate a region graph first (hub, 3-5 spokes, 1-2 loops, 1 dead-end), then fill each region from a *layout archetype*, not from random props.
- Archetypes with distinct answers to "route, sight line, light": canyon street (long straight, narrow, high), cistern hall (huge open, one light), crawl maze (tight, branchy, low), ring (loop around a core you glimpse but cannot enter), stair shaft (vertical, spiral), stacked platforms (open, many routes), dead-end vault.
- Forbid the same archetype twice in a row and require every adjacent pair to differ in at least two of: width, ceiling height, light level, openness, route shape.
- Budget the compression/release rhythm per path: after every tight stretch of roughly 20-40 m, grant an open space at least 4x the volume.
- Put a single readable "signature" in every region (one oversized machine, an impossible stair, a repeated object) so the region can be named in two words.
- Seed an "anomaly dial" per region (0-1) that decides how many deltas from the region's own baseline appear (see ideas).

**Pacing**
- Give the player a loop early (return to a known spot after 3-5 minutes) so later changes are readable; Exit 8 only works because the baseline is memorised.
- Design for 30-90 minute sessions; keep new ideas arriving every 2-3 minutes of walking.
- Deliver lore sparsely: one found object or sign per region, never a text dump.

**Spatial tricks**
- Show a goal early across a gap (a lit exit, a huge gantry) and make the path to it indirect.
- Use thresholds (door, hatch, stair, ladder) as scene changes with a different light colour on the other side.
- Occasional impossible geometry: a door onto a drop, a stair that arrives at the ceiling of the room below, a corridor longer than the building.

**Signs of wrongness**
- Deltas against a baseline the player has seen: a repeated element that has one extra copy, a sign with a digit changed, a light off in an otherwise lit row, a door where there was a wall, a pipe run that ends in a wall.
- Keep them small and unexplained; escalate frequency with distance from the hub, not intensity.

**What to avoid**
- Random prop scatter as the source of variety (reads as noise, not place).
- Equal-sized rooms and uniform corridor width.
- Anomalies that need pixel-hunting or that punish the player; no enemies, a soft reset at most.
- Long sections with no change of scale; backtracking on a single identical path.
- Treating a clean build or a plausible look as proof the space feels good: that has to be judged by walking it.

## Sources
- https://en.wikipedia.org/wiki/The_Exit_8 (gameplay rules, development time, reception)
- https://automaton-media.com/en/news/20240214-27192/ (developer interview; only the headline could be retrieved)
- https://store.steampowered.com/app/2653790/The_Exit_8/
- https://gamebrain.co/game/anemoiapolis-chapter-1 ; https://finalweapon.net/2023/03/17/anemoiapolis-chapter-1-review ; https://gameindustry.com/reviews/game-review/anemoiapolis-makes-a-big-splash-in-liminal-horror
- https://store.steampowered.com/app/1942120/The_Complex_Found_Footage/ ; https://vaporlens.app/app/2172260/the_complex_expedition
- https://www.electrondance.com/the-secret-of-kairo/ ; https://tvtropes.org/pmwiki/pmwiki.php/VideoGame/Kairo
- https://en.wikipedia.org/wiki/Yume_Nikki ; https://yume.wiki/2kki/Nexus ; https://pcgamer.com/the-horrifying-legacy-of-yume-nikki-the-homebrew-game-that-became-a-phenomenon
- Own memory (unverified): POOLS, Bernband, Interior Worlds, Dreamcore, Superliminal, LSD link mechanics.
