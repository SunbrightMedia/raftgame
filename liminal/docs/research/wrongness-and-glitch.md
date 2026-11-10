# Making a place feel wrong: glitch architecture, decay, environmental storytelling

## Overview

Verification note: web search/fetch in this session confirmed only a few facts (marked **[V]**). Slide PDFs and several pages would not parse. Everything else is my own knowledge or reading (marked **[M]**) and should be treated as unverified. The core finding is consistent across the sources: unease comes from the *familiar made strange* (Freud's unheimlich, via Vidler), not from the monstrous. A place feels wrong when it keeps most of its rules and breaks one, the player can half-explain the break, and the break is rationed. The strongest devices are subtle, repeated just enough to establish a pattern, and then withheld.

## Theory

- **Vidler, *The Architectural Uncanny* (MIT Press, 1992)** **[V]**: applies Freud's unheimlich to buildings, framing the uncanny as "a disturbance of the familiar" and tying it to estrangement, alienation and the "unhomely". Not a fear of things, but of homes and rooms that stop behaving like homes and rooms.
- **Freud's unheimlich** **[M]**: the uncanny is the familiar returned as strange; repetition, doubles, and the confusion of living and inanimate are its classic triggers. For us: repetition and almost-correct copies are the cheapest uncanny tools.
- **Kenopsia (John Koenig, Dictionary of Obscure Sorrows)** **[M]**: the eerie emptiness of a place that should be busy. It tells us the industrial world should read as a workplace that was abandoned *mid-shift*, not a ruin.
- **Liminal space aesthetics** **[M]**: transitional places (corridors, stairwells, loading areas) with an implied, absent population, flat artificial light, no signs of the present. Strength comes from purpose without people.

## Environmental storytelling

- **Smith and Worch, "What Happened Here? Environmental Storytelling", GDC 2010** **[V: talk exists, definition]**: environmental storytelling is staging player-space with properties that can be interpreted as a meaningful whole; the talk also covers *systemic* storytelling, where game systems react to convey narrative. From memory **[M]**: the key tools are implied sequences (a scene frozen mid-event), ambiguity that players resolve themselves, and a mix of clear and unclear evidence. A reported Smith line **[V, via a pingback headline]**: every anonymous storytelling moment wastes the chance to say something about the game. So every prop should point at our one lore: *something is breaking*.
- **Fullbright (Gone Home)** **[M]**: the story is assembled from objects; the absence of a body is the point.
- **Survivor architecture** **[M]**: shelters, tally marks, arrows, caches, and rerouted utilities show a person adapting to the space. A single trace of a person is worth more than ten of damage, since it asks a question (where did they go?).

## Glitch and error aesthetics in games

All from memory **[M]** unless marked.

- **The Exit 8 (Kotake Create)** **[V for rules]**: a looping subway passage; if there is no anomaly keep walking, if there is one turn back; eight correct calls in a row reach Exit 8, a wrong call resets to Exit 0. Anomalies range from subtle (changed sign text, repeated posters, a commuter with off proportions) to blatant (power outage, red flood, a figure disguised as wall tile). Kotake chose realistic assets and kept it "borderline horror"/unsettling, no killing **[V]**. Lesson: a *baseline* that the player knows well makes tiny deviations legible. This works through contrast and does not need volume.
- **The Stanley Parable**: deliberately breaks the space (out-of-bounds views, impossible rooms, a broom closet that is bigger than it should be). The player's spatial model is the thing being attacked.
- **Anatomy (Kitty Horrorshow)**: a house addressed as a body; domestic objects are described in a way that makes the house itself seem to be watching.
- **Paratopic, Petscop, No Players Online, Pony Island, Doki Doki**: low-fidelity or corrupted presentation as dread; unexplained rules, UI that lies, spaces that are "not finished" on purpose. Petscop in particular: wrong-feeling level geometry plus a documented-by-an-outsider framing.
- **Analog horror spatial tropes**: long empty corridors, doors in impossible places, a room that is slightly too large, an exit that returns you to the start.
- **Engine artifacts used deliberately**: missing textures (magenta checker), z-fighting, a flipped normal showing the void through a wall, a repeated prop. Read as "the world's renderer is failing", which fits our lore directly.
- **House of Leaves / SCP-3001 / MyHouse.wad / Backrooms** **[M]**: the interior is larger than the exterior (a measured, small discrepancy, inch-scale in House of Leaves); a fixed identical unit repeated; a real dwelling that mutates the more you revisit it; dread from scale and from rules that appear and are then broken.

## Taxonomy of wrongness, by strength

| Level | Device | Generator example |
|---|---|---|
| 1 Barely noticeable | Wrong scale (5 to 10 percent) | One catwalk rail 10% too tall; one door slightly narrow |
| 1 | Wrong repetition (a near-copy) | A pipe bracket repeated at a spacing that is off by one |
| 1 | Wrong material | One panel in a wall of another texture |
| 2 Noticed on second look | Wrong angle | A girder 3 to 7 degrees off true; a floor with a tilt |
| 2 | Texture/label error | A sign with a mirrored or repeating word; number sequence skipping |
| 2 | Traces of someone | A cleared patch, a scratch tally, a chair set facing a wall |
| 3 Clearly wrong | Impossible connection | A stair that ends in a ceiling; a door opening onto a wall |
| 3 | Things that work when they should not | A lamp, conveyor, or tube still running in a dead block |
| 3 | Glitch repetition | The same machine or catwalk module tiled 8 to 30 times |
| 4 Blatant | Diagonal/rotated sections | A catwalk running diagonally through an orthogonal grid |
| 4 | Missing-geometry views | A hole in a wall where the void or far geometry is visible |
| 4 | Impossible space | Interior larger than exterior; a corridor longer than its building |
| 5 Set piece | Failure event | A section visibly in the middle of coming apart |

## Dosage rules (from the sources plus my reading)

1. Establish a rule-bound baseline first; the Exit 8 shows deviations only read against a known norm.
2. Most spaces should contain nothing wrong, so that a wrong thing is information.
3. Escalate gradually, and rarely reach level 4 to 5; each blatant event costs the next one's power.
4. Never explain. Show evidence and let the player infer; ambiguity is the product.
5. Repeat a mild anomaly just often enough to become a pattern, then break the pattern.
6. Pair wrongness with calm: quiet and clean light make errors look more intentional.
7. Keep wrongness *consistent with the lore* so it feels like one process, not random scares.

## What this means for our game

**Lore hook**: the structure is failing in a specific, readable way. Suggested rule: the world's *measurement* is failing (modules repeat, angles drift, numbering skips), so wrongness is a family of errors, not horror props.

**Generator rules**
- Give each chunk a **wrongness budget** (an integer), drawn from a seeded distribution weighted heavily to 0 and 1. Roughly 50% of cells at 0, 30% at level 1 to 2, 15% at level 3, and at most one level 4 to 5 set piece per large region. Make the budget a function of distance from the start so it rises slowly.
- Apply anomalies as **post-pass mutators** over a clean layout (scale, rotate, swap material, duplicate, delete a wall segment), so the clean version always exists and the seed stays reproducible.
- Make **glitch repetition** a first-class operation: pick one module (catwalk bay, tube, machine), tile it N times with an exact step, then possibly insert one off-by-one. Log N so the same machine is not reused as the same N elsewhere.
- Keep **survivor traces** as their own system: a small prop kit (tarp, crates, cables strung as a ceiling, tally marks, an arrow, a cache), placed in dead-end or sheltered cells and *oriented to a vantage* (toward a sight line or exit), with a faint trail of arrows leading to or away.
- Use **systemic working-when-wrong** items: a single live lamp, a running fan, a powered tube in an otherwise dead region. Sparse and sourceless.
- Add **impossible connections** only where the player cannot immediately verify geometry (behind a stair turn, in a tube). Use rules like "interior longer than exterior by a fixed ratio" so it is learnable.
- Add **non-return**: occasionally a path back differs slightly from the path forward (a different sign number), the Exit 8 trick, but never trap the player.

**Layout and pacing**
- Pair each large open area with a tight, closed space before or after; wrongness reads better in a tight space with one clear sight line.
- Put a single readable "tell" (a wrong sign, a tilted girder) at a sight-line terminus.
- Let the player see a wrong thing from far away, then approach; the walk toward it is the experience.
- Make sure no two adjacent spaces use the same anomaly type or the same layout archetype.

**Avoid**
- Jump scares, enemies, or sound stingers; the mode here is dread without threat.
- Anomalies that read as bugs of *our* engine (actual stuttering, real z-fight flicker the player cannot tell from a true bug). Wrongness must look authored.
- Uniform density; randomness without a budget produces noise rather than unease.
- Explaining the breakdown in text. Lore should be physical.

## Sources

- Vidler, Anthony. *The Architectural Uncanny: Essays in the Modern Unhomely*. MIT Press, 1992 (descriptions seen via library catalogue entries, e.g. https://stroom.nl/en/stroom/library/online-catalogue/2759 and https://muse.jhu.edu/article/23003)
- Smith, Harvey and Worch, Matthias. "What Happened Here? Environmental Storytelling", GDC 2010. https://gdcvault.com/play/1012647/What-Happened-Here-Environmental ; slides https://www.worch.com/files/gdc/What_Happened_Here_Web_Notes.pdf (could not be read in this session) ; https://www.witchboy.net/articles/what-happened-here/
- The Exit 8: https://en.wikipedia.org/wiki/The_Exit_8 ; Automaton interviews with Kotake Create, https://automaton-media.com/en/news/20240214-27192 (only the title loaded)
- From memory, not re-checked: Freud, "Das Unheimliche" (1919); Koenig, *Dictionary of Obscure Sorrows*; Danielewski, *House of Leaves*; The Stanley Parable; Anatomy; Paratopic; Petscop; No Players Online; Pony Island; Doki Doki Literature Club; Fullbright, Gone Home.
