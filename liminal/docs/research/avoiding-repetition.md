# Why procedural worlds feel repetitive, and the cures

**Overview.** Procedural generators fail perceptually, not mathematically. Kate Compton's "10,000 bowls of oatmeal" point: you can make 10,000 bowls with every oat in a different position and the player still sees "a bowl of oatmeal". The statistical variation is real but sits below the player's perception threshold. The cures found in shipped games and the literature all do the same thing: vary things the player *notices* (structure, scale, rhythm, mood, what is possible), tie those variations together so a place has a character, hold part of the world fixed and authored so the variation has something to contrast against, and ration the rare events so they stay rare. For us the lesson is sharper than for most games: our kit (textures, girders, pipes) is deliberately shared, so almost all felt difference has to come from layout.

Provenance key: **[V]** = verified this session from a fetched page or search result; **[M]** = my memory or reading, not re-checked here.

## 1. The diagnosis

- **Perceptual uniqueness is the real metric.** Compton's oatmeal example and the line that perceptual uniqueness is "darn tough" are attributed to her in multiple secondary sources (Vice/Motherboard review, Challies, Wikipedia). **[V, secondary]** I could not load her original essay ("So you want to build a generator"; galaxykate.com returned HTTP 500), so quotes are second-hand. She had seen the same effect with Spore planets and treated it as a warning for No Man's Sky. **[V, secondary]**
- **No Man's Sky (2016).** Critics said variety lived in surface detail while the framework stayed constant: one biome/climate per planet, a limited set of locale types, "spaces over experiences" (Game Developer, "Why I won't play No Man's Sky"). **[V]** The same piece cites Diablo: players eventually memorise a generator's limits and fatigue sets in. **[V]** It contrasts this with Master of Orion II, where planet type, gravity and mineral richness change strategy, so varying parameters means something. **[V]** Hello Games later conceded it hadn't made enough variety. **[V, secondary]** I did not find reliable detail on what Foundations/Atlas Rises changed; from memory they added bases, settlements, ship/creature variety and sentinels, i.e. added *activities and structures* rather than more noise. **[M]**
- **Emily Short** (Bowls of Oatmeal and Text Generation) makes the same point for text: differences must matter to the audience; generation not tied to anything mechanical is decorative and players look past it; persistent layered state (the robot's speech reflecting what you taught it) makes output feel responsive. She frames procgen as "a way of designing content", not a substitute, as labour-intensive as hand work and needing clear aesthetic goals. **[V]**
- **Short and Adams (eds.), Procedural Generation in Game Design (2017).** I confirmed only the table of contents (e.g. ch. 2 Kenny Backus, "Managing Output: Boredom versus Chaos"); I could not read chapters. The "boredom vs chaos" framing is the useful part: too little structure gives noise that reads as sameness, too much gives repeated templates that read as sameness a different way. **[V title only; the interpretation is mine]**

## 2. Mechanisms that work

**Spelunky (Derek Yu).** A 4x4 grid of rooms, each 10x8 tiles. A random solution path is carved first, from the top row down (left/right/down rolls), then remaining cells get filler rooms with no exit guarantees. Four room types, each with roughly 8 to 16 hand-drawn templates; rooms are randomly mirrored; templates contain probabilistic tiles (e.g. 25% pushblock, 33% spike, 50/50 block-or-empty) and 5x3 "obstacle blocks". **[V, from a modding walkthrough by Kazemi/tinysubversions, not Yu's own talk]** Lessons: (a) the guaranteed path is built first and everything else dresses it; (b) variation is layered, so structure, template, obstacle, and tile chance can each be re-rolled independently; (c) authored templates carry the "feel", randomness only reshuffles them; (d) mirroring is a cheap trick that is invisible in symmetric rooms and strong in asymmetric ones. Caveat: the specific probabilities are from a modded explanation and may not match the shipped game. Derek Yu is credited with "platformer rhythm" being encoded in the algorithm (A.V. Club). **[V, weak]**

**Dead Cells (Sébastien Benard, "hybrid approach").** A hand-fixed frame (island map, level connections, key locations identical for all seeds). Hand-built room tiles, each belonging to one biome (sewers' tight spaces are baked into their tiles). A per-biome *concept graph* is placed first (entrance/exit, then special rooms, then combat/exploration fill) and sets length, number of specials, how labyrinthine the layout is, and distance from entrance to exit; different biomes have different graphs (ramparts more linear than sewers). Tiles are drawn at random and rejected if they violate the node's constraints. Monster counts scale with combat-tile length (his illustration: 1 per 5 tiles) with per-monster weights and once-per-tile/level caps. **[V]** Lessons: the *graph* is the character-bearing layer, and rarity is controlled by explicit caps, not luck.

**Left 4 Dead's AI Director.** Plans some elements before play and adjusts spawns from a computed stress level. **[V, weak sources]** The transferable idea: pacing is a variable you manage, not an accident of noise.

**Dwarf Fortress (Adams).** From memory: layered simulation, with large-scale parameters (temperature, rainfall, drainage, elevation, evil/savagery) deciding biomes, so features co-vary and a region has a coherent identity rather than independent noise. **[M]**

## 3. The ideas under all of it

1. **Parameter correlation.** Independent random parameters average out to grey. Tie several together via one latent "district character" so a place is distinctively *a kind of place* (see 5). Cf. MoO2 above. **[V for MoO2; the general principle is my synthesis]**
2. **Authored anchors.** Fixed landmarks, fixed topology, hand-made set pieces give the player memory and a reference frame; without them nothing can feel "different from before". Dead Cells fixes the frame; Spelunky fixes templates.
3. **Structure before dressing.** Generate topology/path and pacing first, then fill. Decor is the last and least perceptible layer.
4. **Rarity curves.** Frequent things must be frequent enough to become a baseline; rare things must be capped, spaced and never adjacent. Caps and cooldowns beat pure probability.
5. **Negative space and absence.** Empty, silent, or blocked places read as different from dense ones, and cost nothing. Variation in *density* (including zero) outweighs variation in *content*.
6. **Meaning over entropy.** Differences must change what the player does, sees or fears (Short, Game Developer).

## 4. What this means for our game

Axes on which two places can differ through layout alone (use as a per-space checklist; any two adjacent spaces should differ on at least 3):

| Axis | Low end | High end |
|---|---|---|
| Enclosure | crawlspace, closed room | open hall, no ceiling visible |
| Height / vertical position | sunk, below grade | near the top, exposed |
| Density | empty (one object) | packed to the ceiling |
| Symmetry | mirrored, formal | lopsided, broken |
| Rhythm | irregular | strict repeat (columns every N m) |
| Orientation | orthogonal | skewed 15-45 degrees, tilted |
| Sight-line length | 3 m | 300 m |
| Entry | squeeze, drop, stair, hatch | long approach, seen from afar first |
| Seen but unreachable | nothing | a whole level of space across a gap |

**Generator rules**
- **District character vector.** Each district gets one seeded vector (enclosure, density, rhythm regularity, skew, scale, openness, decay). Every placement decision (street width, ceiling height, prop density, repeat count, catwalk angle) reads from that vector, so features co-vary. Neighbouring districts must differ strongly in at least two components.
- **Path first, then dress.** Carve the guaranteed route and the loops (Spelunky), then a per-district graph for pacing (Dead Cells): entrance, a tight stretch, a release into an open space, a landmark, a transition. Make the graph differ per district type.
- **Pacing rule: compress, then release.** Follow every tight/closed section with an open one, and vary length. Never more than ~2 consecutive spaces with the same enclosure value.
- **Hand-authored templates, procedural arrangement.** Write 8 to 16 distinct set-piece cells per district type, mirror/rotate them, and put 2 to 4 randomised slots in each. Authoring ~20 strong pieces beats tuning noise.
- **Chaos as a budgeted layer.** A global chaos value per district (0 to 1) scales the chance of anomalies: diagonal catwalk, a motif repeated 5 to 40 times, a scavenged shelter, a door to nowhere, a dead-end that is too neat. Cap per district (e.g. at most 1 major anomaly per ~10 spaces; no two within sight of each other); put the highest-chaos districts deep, not at the start.
- **Rarity tiers.** Common (baseline, 70%+ of cells), uncommon (visible variant), rare (set piece, 1 per district at most), unique (once per world; seeded but fixed place). Rare events use cooldowns, not independent dice, so they cannot clump or vanish.
- **Seen-not-reached.** Every district must offer at least one view the player cannot enter yet (across a chasm, behind glass, in a lit tube), seeding return trips and giving a sense of a world larger than the route.
- **Break the grid.** Reject placements that make two spaces within sight of each other share the same footprint, width and ceiling. Add a "too similar" check on (enclosure, height, symmetry) tuples of consecutive spaces.
- **Wrongness signs** (cheap, layout-based): small errors that persist (a stair that is one step short, a repeated corridor that does not quite line up, a catwalk that tilts, symmetry broken in one place only, a sign pointing at a wall), and unexplained absence (a power-off district in a lit world).
- **Avoid:** uniform density; same street width everywhere; evenly spaced landmarks; decor-only variants; high-frequency noise that is imperceptible; rare events at fixed intervals (predictable); showing the same set piece twice in view.

## Sources

- Kate Compton, "10,000 bowls of oatmeal" / "So you want to build a generator" (galaxykate.com; could not load, relied on secondary quotes)
- https://motherboard.vice.com/en_us/article/nz7d8q/no-mans-sky-review
- https://www.challies.com/articles/no-mans-sky-and-10000-bowls-of-plain-oatmeal/
- https://emshort.blog/2016/09/21/bowls-of-oatmeal-and-text-generation/
- https://www.gamedeveloper.com/design/why-i-won-t-play-no-man-s-sky
- https://www.tinysubversions.com/spelunkyGen2/index.html (Spelunky Generator Lessons, Kazemi)
- https://tinysubversions.com/spelunkyGen
- https://deepnight.net/tutorial/the-level-design-of-dead-cells-a-hybrid-approach/ (S. Benard)
- https://www.gamedeveloper.com/design/the-discomfort-zone-the-hidden-potential-of-valve-s-ai-director
- Short, T. and Adams, T. (eds.), Procedural Generation in Game Design, CRC Press, 2017 (table of contents only)
- https://www.avclub.com/spelunky-1798215629
