# The Backrooms: spatial research for the industrial world

## Overview

The Backrooms exist in three layers. The 2019 4chan post gave one idea: a place you "noclip" into, a mono-yellow office maze with damp carpet, a fluorescent hum and no one around. The Wikidot and Fandom canon turned that into a numbered stack of hundreds of levels, each defined by one spatial rule, a short atmosphere paragraph and a list of entrances and exits. Kane Pixels' Async Foundation series (2022 onward) reframed it as an institution trying to survey and use a structure that almost makes sense. The lesson for us is that very little is needed to make a place feel unique. One rule about scale, light, sound or repetition per space is enough, and transitions between spaces matter as much as the spaces. Source status is marked inline: "(verified)" means I read it on the wiki pages named in Sources; "(memory)" or "(my reading)" means it is not verified in this session.

## Findings

### Level 0: the baseline
- (Verified, Wikidot Level 0) A maze of randomly segmented rooms, hallways and stairs "mile after mile", with a non-linear layout that can change when nobody is watching (the "Peripheral Shift"). Constant fluorescent buzz whose volume spikes unpredictably. Seamless damp Berber-style carpet and a mildew smell.
- (Verified) Named sub-structures give variety inside one texture set. Pillar rooms are miles-long grids of pillars that end up asymmetrically placed. Arch rooms sit at dead ends and transitions and are the most stable. Hole clusters form dense grids. Red Rooms are sealed loops. Blackout zones have recessed, ankle-deep wet floors.
- (Verified) The "Isolation Effect": people who enter together cannot find each other. Loneliness is a mechanic.
- (Memory) The original 4chan post stresses "30 days to wander" and the sense that you got here by a wrong step in reality. Level 0 has no landmarks, only repetition, which is why the few that do exist (an arch, a hole) work as anchors.

### Level 1 and 2: concrete and pipes
- (Verified, Level 1) Two spatial modes in one level. Halls are wide warehouse spaces with pillars and untrustworthy distances, where you navigate by landmarks. Corridors are tight, Euclidean, kilometre-long concrete passages with purposeless rooms (offices, infirmaries, rubber rooms). Damp air, puddles, clanging pipes, and a "Flickering" blackout that triggers danger. It has named sectors (Aquila, Gild, Gothic, Ouroboros, Garden, Fabled) and the Garden sector is overgrown, an enclave with a different material logic.
- (Verified, archived Level 2 "Pipe Dreams") Dark grey concrete maintenance tunnels, pipes along the walls, vents holding thick black liquid. Most doors are locked or dead ends; rooms behind doors hold shelves of miscellany and the odd computer. Heat reaches 43 C and is worst where machinery is loudest, usually at hallway ends, so heat and noise act as a gradient that tells you where the machine is. One door is "unlocked, comically proportioned, multicoloured" and leads to Level 283, a deliberately wrong-sized door as an exit.
- (Search result, not verified from the page) Level 477 is described as a maintenance-corridor network working like Level 2's tunnels, and Level 130 "Tainted Pools" as pool rooms with many pipes. I found no canonical level called "pipe rooms"; the community name is Pipe Dreams and "Abandoned Utility Halls" (alternate name on a fan wiki). The "pipe room" fiction is mostly Level 2 and its imitators.

### Level 3: Electrical Station
- (Verified, Wikidot Level 3) Brick-walled halls with dim fluorescents and wiring. Dimensions are wildly inconsistent: passages you must crawl or walk sideways through, next to spaces reportedly miles wide and hundreds of feet tall. Indestructible metal bars partition the level and make its true size unknowable; most have no gate.
- (Verified) Four recurring room types: Generator Rooms (crowded equipment), Assembly Lines (open conveyor spaces that make multiples of objects, a built-in "repeating glitch"), Boiler Rooms (simple, the source of black sludge), and Sanctums (cathedral rooms with Greco-Roman pillars and angel statues, the only safe havens). The mood comes from constant hum and crackle, and from tight dark sections where paranoia and false sounds occur.

### Level 37: the Poolrooms
- (Verified, Wikidot Level 37) White ceramic tile, lukewarm blue-green water with a faint constant ripple, too many pillars in the water, areas too big to be pools, open water with no ledges, staircases that descend straight into deep pits, irregular light angles and some fully dark areas. Altered sound: noises cut off abruptly. No entities; survival difficulty 0. The article presents it as "purposeless yet deliberately crafted". Entrances include submerging in water elsewhere (Level 58, 119) and an arcade on Level 25.
- My reading: it works because of one material, one sound and one transgression of normal use (stairs into a pit, pillars with no function). Safety makes it more uncanny, not less.

### Other named patterns
- (Memory) Level ! "Run for Your Life" is a fast-paced hazard level, an inversion of the slow wandering of others. It suggests pacing: a rare space where the player is not allowed to stroll. Our game has no enemies, so the analogue is a timed or rhythmic environment (a closing blast door, a flooding corridor, a lights-out cycle).
- (Memory) The Hub (Level 11 variants / "Hub" in some canons) is a large settlement-like nexus that offers many doors to other levels: a centre where paths converge. The End (Level "The End") is the final dull, quiet place. Both are structurally useful: a hub of many doors, and an ending that is anticlimactic and quiet.
- (Verified, Level 1) Entry types are formally categorised: doors, "smooth thresholds" (gradual environmental change), noclipping, interaction-triggered. Level 1 alone lists 11 doors, 3 smooth thresholds, 6 noclips and 7 interaction-triggered entrances, and exits to Level 2 are mostly smooth thresholds. This is a ready-made vocabulary of transitions.

### Kane Pixels and Async
- (Verified via search summaries, not the primary videos) The Complex is described as city-scale or larger, with rooms that do not follow human building conventions, but the series avoids alien geometry on purpose. Areas include low 19th-century corridors with floral wallpaper, flooded rooms, grey walls, a red-lit suburban street, airport hotels, pools, offices, maintenance tunnels. Async's staff methodically describe mundane objects ("Lighting and Tile Survey", "Everything Must Go"), and areas near the KV31 threshold are mapped and converted to functional use.
- My reading (memory): the horror comes from bureaucratic documentation of a place that resists documentation, and from structure that nearly follows logic (a building with correct fire doors that lead nowhere). Wrongness is rendered in plain, plausible geometry.

## What this means for our game

**Layout rules for the generator**
1. Give every region exactly one spatial rule (a "mode"), picked from a table: tight corridor, pillar grid, vast hall, flooded floor, stacked cages, assembly line, boiler. Two neighbours may not share a mode. Level 1 shows the benefit of just two modes (hall vs corridor).
2. Vary scale violently between neighbours. Follow Level 3: a crawl-height passage must open into a space several times wider than the catwalk spacing seen elsewhere. Use a size ratio of at least 6:1 between consecutive spaces at least once every few spaces.
3. Use partitions with no gates: bars, grates or glass that show space you cannot enter (Level 3's bars). Place them so that the player can see a destination for several minutes before reaching it by another route.
4. Give each region a named landmark that is not a signpost: a pillar out of line, an arch, a single lit hole. Level 0 shows that a few landmarks in repetition do the navigating.
5. Gradient cues over markers. Heat/noise/hum increases toward a machine (Level 2). Our version: hum pitch and light colour shift as the player approaches a region's centre, so players can navigate by ear.
6. Let regions be wrong in a small, consistent way: pillars that end up asymmetric, a door at the wrong size (Level 2's comically proportioned door), stairs that end at a pit (Level 37), a wall that almost closes a room.
7. Include some sealed, unreachable or looping spaces (Red Rooms, Isolation Effect). One in about ten rooms should be visible but unreachable, one in about twenty a dead end with a single object.
8. Keep Euclidean sense reliable most of the time. Kane Pixels deliberately avoided alien geometry; use non-Euclidean tricks (a corridor longer inside than outside) at most once per world, as a payoff.

**Pacing**
- Alternate: open hall (look), tight corridor (pressure), strange room (stop), quiet pocket (rest). Never more than about two minutes of the same mode.
- Place a rare "fast" section (a closing door, flood, power cycle) once per world; it is the Level ! idea without enemies.
- Reveal the lore by documents and traces (Async-style labels, survey stickers, "Everything Must Go" tags), not text dumps.

**Exits and transitions**
- Exits should be one of the verified types: door, smooth threshold, a noclip-style fall, or an interaction. Mix them; do not use doors only.
- Hide the exit in a place that matches the region's rule: the one door that is the wrong size, the stair that goes down, the flickering wall (Level 0's exit is a flickering wall).
- Include a hub chamber of many doors for the later multi-world design.

**Signs of wrongness (cheap to build)**
- Repetition beyond reason (pillars in water, an assembly line with duplicates).
- Wrong size or scale for the user (doors, rungs, stairs).
- Surfaces that should be damaged but are pristine (Level 37's tile).
- Sound that stops abruptly; a hum whose pitch changes.
- Spaces that fully work as buildings but have no purpose (offices inside pipe tunnels).

**Avoid**
- Random noise as variety: the Backrooms' regions are distinct because of rules, not scattering. Randomise the choice and arrangement of rules, not individual props.
- Too many fantasy elements (Sanctums are the exception, because they are rare).
- Explaining the cause. The unexplained works.

## Sources
- Backrooms Wiki (Wikidot), Level 0: https://backrooms-wiki.wikidot.com/level-0 (read)
- Level 1: https://backrooms-wiki.wikidot.com/level-1 (read, first 100k chars)
- Level 2 "Pipe Dreams" (archived): https://backrooms-wiki.wikidot.com/archived:level-2 (read)
- Level 3 "Electrical Station": https://backrooms-wiki.wikidot.com/level-3 (read, first 100k chars)
- Level 37 "Sublimity": https://backrooms-wiki.wikidot.com/level-37 (read)
- Kane Pixels' Backrooms wiki, "The Complex": https://kane-pixels-backrooms.fandom.com/wiki/The_Backrooms (page blocked; used search summary only)
- TV Tropes, Kane Pixels' The Backrooms: https://tvtropes.org/pmwiki/pmwiki.php/WebVideo/KanePixelsTheBackrooms (search summary only)
- Fandom Level 37: https://backrooms.fandom.com/wiki/Level_37 (search summary only)
- Team Byte wiki, Level 2: https://teambytethebackrooms.wiki.gg/wiki/Level_2 (search summary only)
- Not consulted directly: the original 4chan /x/ post and Kane Pixels' videos; Level !, The Hub and The End are from memory.
