# The Stanley Parable: spatial research

**Provenance note.** Web search was weak for this topic (primary developer talks and the fandom wiki returned 402/403 or no detail). Items marked **[V]** were read on a fetched page (Wikipedia article; a Stories in Play analysis). Everything marked **[M]** is my memory of the games or my own reading, and should be treated as unverified. The Pugh talk "Designing The Stanley Parable" exists on YouTube but I could not read it.

## Overview

The Stanley Parable (Wreden's 2011 Half-Life 2 mod; 2013 remake with William Pugh; 2022 Ultra Deluxe in Unity) is a game whose space is the argument. The office is almost entirely mundane, yet the layout is a conversation between the player and an authority (the Narrator) that is allowed to rewrite the building when contradicted. For us the useful lesson is not the jokes but the grammar: a few plain spaces, a clear "intended path", and a library of ways the space can disobey its own rules while remaining readable.

## Findings

### 1. Mundane architecture made uncanny by omission
- **[V]** Pugh said the Narrator's bias shaped the office's look: he omits functional objects he considers unimportant. The office is a stage, not a workplace.
- **[M]** Result: no signage clutter, no personal effects, identical desks and monitors, long carpeted corridors with flat fluorescent light. Uncanny comes from absent purpose, not added monsters. Doors lead to rooms that exist only to be passed through (a broom closet, a meeting room with no one in it).
- Lesson: wrongness through *missing function* (stairs to nowhere, a control room with no controls) is cheaper and stranger than decoration.

### 2. The two-door choice and signposting
- **[V]** The first choice is two doors; following the Narrator goes one way, defying him makes him adjust the narration. Wreden reported the follow/defy split as roughly even.
- **[V]** Playtesting showed players ignored choices unless signalled, so Pugh added visual cues such as colour at divergence points. A flowchart of branches was cut because players disliked it. The demo was original content, not a cut section, because excerpts confused testers.
- **[M]** Branch points are architectural: a fork in a hall, an extra door, a ledge. Every deviation is physically small (one door, one stair) so the player feels they did it, not that a menu did.
- Lesson: choices must be visible in the geometry, legible in one glance, and cost the player almost nothing to try. Choice-density is paced: one fork per room or so, early.

### 3. Hiding the swap
**[M]** (the technique list is my reading of how Source/Unity maps work; not from a developer source):
- **Door closes behind you.** Once the player passes a threshold, a door shuts or a trigger fires and the space behind (or ahead) is replaced. The player is never looking at the change.
- **Turn of a corner / corridor length.** Swaps occur just out of sight round a bend, or in the long featureless stretch where the player's attention is on forward motion.
- **Lights out / loading doors / elevator.** A brief blackout or enclosed lift covers a teleport into a different map or rebuilt copy.
- **Shared threshold geometry.** The destination room begins with the same door/corridor profile as the origin, so the player's body-position is continuous across a cut.
- **Facing-away swaps.** Changes triggered only when the player is facing away or has just committed to a direction (turning back to see the door they came through is the classic test).
- Design implication: all swaps share a rule: *the player has just committed, and an occluder (door, corner, dark) separates before and after.*

### 4. Spaces that contradict the player
- **[V]** In Confusion the doors multiply to six then vanish; the office becomes a dead-end corridor; the Epilogue is a desert. Space is mutable and reflects the Narrator's control.
- **[M]** Confusion ending: the Narrator, losing control, restarts the map repeatedly (the count of eight is flagged in community sources, but I could not confirm how the loops differ). Each restart is the same office with a progressive error: more doors, wrong sequence, the player re-entering the start state with the Narrator unravelling. Repetition + degradation is the engine.
- **[M]** Adventure Line: a painted yellow stripe along the floor leading to a distinct route; the Narrator's "ignore the line" and then follow it. The line is a physical guide that also becomes a joke when the architecture around it stops making sense. It is a cheap, readable way to signpost a path without a UI.
- **[M]** Zending: a stairway that continues far past reason. Space as endurance and absurdity; also the "end" is a place you walk to.
- **[M]** Impossible loops: the same corridor reachable by different doors; rooms that are visibly bigger inside than outside; a path that returns to a previous room redesigned.
- **[V]** The Mind Control Facility (circular room, platforms, catwalks, elevator to a control room, falling "Black Hole" route) holds both intended paths and deliberate traps. The Cargo Bay moving platform ties outcome to the narrator's directions. Design glitches are presented as intended, blurring error and authorship.

### 5. Ultra Deluxe additions
- **[V]** Memory Zone, a bucket that alters endings, Firewatch/Rocket League-style levels replacing the Minecraft/Portal section, and a shortcut for returning players to reach new content.
- **[M]** The skip-button-room idea (a button that bypasses content) is the game acknowledging the player's boredom as a design input. I could not verify exact details.

### 6. Pacing
- **[V]** The game is kept short so players can see every ending cheaply.
- **[M]** Each branch is a few minutes of space; many endings end in an explicit restart, so the reset is the reward.

## What this means for our game

The industrial world is large and open; Stanley's tools are small and indoors. We should borrow the *rules*, not the corridors.

### Rules for the generator
1. **Give every region a "plain" state and a "wrong" state** of the same layout, and let the wrong state be a pure parameter change (extra doors, repeated module, a missing rail), so any seed can emit either.
2. **Swaps happen only after commitment behind an occluder**: a door that closes, a lift ride, a bend in a catwalk, a steam vent, a lights-out. Never swap in open view.
3. **Threshold continuity**: the first 3 m on both sides of any swap share one door/stair/rail profile.
4. **One fork per space, readable in a glance**, marked by colour or a floor stripe (our Adventure Line analogue: a painted guide-line that sometimes leads somewhere pointless).
5. **Repeat-with-degradation**: a motif (door, valve, stair run) repeats 3 to 8 times, each copy slightly more wrong (misaligned, missing, doubled). Cap at about 8; the count itself is a sign.
6. **Wrongness by missing purpose**: build things that obviously should do something and do nothing (a control room without controls, a lift with no shaft).
7. **Keep it short between payoffs**: no more than about 2 to 3 minutes of walking between a decision and a visible consequence.
8. **Return trips must differ**: when the player backtracks through a swapped region, the generator must either keep the previous state consistent or visibly change it, never silently reset.

### Spatial tricks to build
- A door that is present on entry, gone on exit; the corridor behind it is now a wall with a door-shaped stain.
- Corridors whose length does not match the exterior (a hall that takes 60 m to cross a 20 m gap).
- A loop where the same junction is reached via two doors but the signage differs.
- Staircases that continue 2 to 3 times further than the visible shaft allows.
- A room rebuilt between visits: same footprint, rotated furniture, one rail moved.

### Signs of wrongness
Floor stripes that end mid-air, door counts that increase (2, 3, 6), a numbered sign sequence that skips or repeats, lights with a perfect period, a room labelled "Test 04" three times.

### What to avoid
- Narrator-style commentary or jokes; our tone is silent.
- Fake choices with no spatial difference.
- Swaps the player can catch by turning around on frame 1 (cheap, breaks trust once; use sparingly as a deliberate scare, not a default).
- Dense decoration: it kills the omission effect.
- Flowchart-style signposting: playtesting showed explicit maps of choices performed worse than visual cues.

## Sources
- Wikipedia, "The Stanley Parable" (fetched; basis for all **[V]** development facts): https://en.wikipedia.org/wiki/The_Stanley_Parable
- Stories in Play, "The Stanley Parable and The Stanley Parable Ultra Deluxe": https://storiesinplay.com/2025/02/01/the-stanley-parable-and-the-stanley-parable-ultra-deluxe/ (fetched, secondary analysis)
- William Pugh, "Designing The Stanley Parable" (YouTube; found, not read): https://www.youtube.com/watch?v=DCJhvHYZYRY
- The Stanley Parable Wiki (Confusion Ending, Adventure Line, Endings), fandom: pages found, fetch blocked (402)
- Speedrun.com TSP "Confusion Ending Walkthrough and Pointers": found, fetch blocked (403)
- Official site: https://www.stanleyparable.com/
