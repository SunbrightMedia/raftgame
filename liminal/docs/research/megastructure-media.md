# Megastructures and endless industrial worlds in games and comics

**Overview.** The strongest megastructure fiction (BLAME!, NaissanceE, Lorn's Lure, INFRA, Half-Life 2's Citadel, Portal 2's back-of-house, Control's Oldest House) rarely gets scale from raw size. It gets it from comparison (a human-sized element beside a giant one), from repetition that is subtly varied, from distant tiny lights, from layered sight lines that are never fully cleared, and from silence: a system that keeps running, with no explanation and no one in it. They also differ in guidance. Some steer by light and silhouette (Portal 2, Half-Life 2), some deliberately withhold the route (NaissanceE, BLAME!). Provenance note: only a few points below were confirmed by search in this session (marked **[verified]**); the rest is my memory of the works and standard analysis, marked **[memory]** or **[reading]**. Search returned secondary sources, not developer talks, so treat specifics as unverified until checked against the work.

## BLAME! (Tsutomu Nihei)
- Nihei trained in architecture, and the City is drawn as architecture, not backdrop. Reviews and a Laurentian University thesis (Kody Ferron) describe a city without orientation, time, scale or human agency, where the city itself carries the story. **[verified, secondary]**
- Scale technique: a tiny protagonist (Killy) against a structure that fills the panel, with the figure often a few pixels of ink. Wide panels hold one huge form; small panels hold ordinary-sized detail, so the reader's eye is forced to swap scale constantly. **[memory/reading]**
- Heavy black fills and negative space stand in for depth, light and explosions; Nihei has said the black looks stylish but limits how much detail a panel can show. **[verified, secondary]** The practical effect: much of the structure is implied, not drawn.
- The Builders (the City's automatic construction systems) keep extending it by their original, uncancelled orders, with no regard for humans or purpose. Result: floors that stop at nothing, pipes that join nothing, gigantic hollow spaces, doors sized for no one, stacked strata of different "eras" of construction fused together, and regions where the material changes (organic, concrete, steel, glass) without transition. **[memory]**
- Wordless storytelling: long runs of panels with no dialogue; the reader reads wear, sealing, and which areas are lit. **[verified, secondary]**
- Kill Screen's piece notes BLAME!'s influence on games that replace narrative with space, scale and disorientation. **[verified, secondary]**

## NaissanceE (Limasse Five)
- Core idea from the developer's history: use light and shadow interacting with abstract architecture as a mechanic, not just a look. **[verified, secondary]**
- Brutalist, abstract spaces, no text, no hand-holding; experimentation is rewarded. Where Valve uses visual cues to suggest an intuitive path, NaissanceE deliberately obscures it for most of the game. **[verified, secondary]**
- Spatial devices I recall: huge voids with a tiny bright thing far away; enormous staircases and shafts that dwarf the player; pitch black corridors where you use a small light or find the only lit edge; sudden change of rule between levels (a level of platforming on shifting blocks, a level of light panels). **[memory]**
- Lesson: each level is a different "question" asked of the same architectural vocabulary, so levels feel unrelated even though the material is concrete and light throughout.

## Other examples [memory unless noted]
- **Lorn's Lure** (Lorn, free indie game): a wanderer crosses a vast machine-like structure with few landmarks and long dim vistas of repeated forms. Details are from memory and unverified.
- **INFRA** (Loiste Interactive): an industrial infrastructure (dam, sewers, power plant) that is plausibly engineered. Scale is shown by real-world details: signage, maintenance gantries, safety rails. It proves that believable function (a valve that matters, a pump room) produces a different feeling than abstraction.
- **Half-Life 2 Citadel:** a huge tower seen first from far away, then entered. The Citadel's interior alternates tight pods with giant open machine halls, and you ride transport rails through it, so the route is a controlled reveal.
- **Portal 2 back-of-house:** panels, rails, test chambers seen as boxes in a giant cavity. Guidance via lit pieces, moving panel arrays and a few very long vistas; decay reads in vegetation, rust and collapsed catwalks.
- **Control, Oldest House maintenance sector:** brutalist office-industrial hybrid; spaces that reconfigure themselves ("the Oldest House is larger inside"), bureaucratic signage that does not match reality.
- **Echo** (Ultra Ultra) and **Fugue in Void / Babbdi:** dream-logic or minimal sparse spaces; repetition (Echo's mirrored palace) as a gameplay element. Not verified here.

## Mechanisms for scale
1. **Human-sized anchors:** a railing, door, ladder or lamp at known size next to a giant pipe or column.
2. **Repetition with variation:** the same bay or girder repeated, then broken once (a missing piece, a different colour, a tilt).
3. **Tiny lights at distance:** a few points of light across a void imply depth and distance more than detail does.
4. **Layered sight lines:** foreground structure, mid structure, distant silhouette in fog; never a clean line to the end.
5. **Black/fog as an editing tool:** hide most of the structure, as Nihei does with black fills.

## Guidance vs. deliberate non-guidance
- Guide with: light (a warm lit pocket in a cold dark), silhouette, movement (a slow rotating thing), sound, and a continuous surface (a catwalk that keeps going).
- Fail to guide with: symmetric junctions, identical lit rooms, routes that look correct but loop, and exits only visible from the "wrong" side. NaissanceE and BLAME! leave the player guessing; Portal 2 and HL2 do not.
- Best of both: a visible far goal plus a non-obvious route to it.

## What a "Builder gone wrong" or "a system still running" looks like
- Structures that continue past usefulness: a catwalk extended over open void, stairs to nothing, a rail ending mid-air, a pipe branching into a wall.
- Output without a consumer: conveyor delivering parts to an empty bay; lights timing on and off for an empty room; a turnstile counting nobody.
- Same fix applied everywhere: the same brace, patch or sign repeated down a whole corridor, like a loop gone wrong.
- Layers of eras: newer, cleaner modules grafted onto older, rustier ones at a hard seam.
- Scale errors: a door too big or too small for the hall it serves; a giant duplicate of a human-scale object.

## What this means for our game

**Generator rules**
1. Build space as a graph of *rooms of different "kinds"*, not a grid of streets: each kind has a distinct proportion, enclosure, light and traversal rule (see below). Pick adjacent kinds so neighbours contrast (tight then vast, dark then lit).
2. Kinds to implement: crawl duct; tight service corridor; shaft (vertical, long drop); vast hall with a few distant lights; catwalk-over-void; machine pocket (a small lit enclosure); stacked chamber wall (seen from outside); dead-end cache.
3. Every region gets exactly one *dominant gimmick* (one rule changed: floor tilt, repeated element, scale of doors, light colour). No two neighbouring regions share one.
4. Variation by *composition*, not new assets: change spacing, rhythm, height, enclosure, and sightline length from a seeded per-region parameter set.
5. Pace tight/open as a sawtooth: after 30 to 60 seconds of compression always release into a big space with a view, and only then compress again.
6. Always give a far visible landmark (a lit tower, a huge machine) plus one or two false landmarks that lead nowhere.
7. Place human-scale anchors in every large space (rail, ladder, lamp, door) so size reads.
8. Add an error layer on top of the plan: a per-region "chaos" value picks from glitch modifiers (diagonal catwalk, repeated element x20-60, mirrored section, stair to nothing, rail ending in air, sealed door with live light behind).
9. Make breaking spatial: decay grows toward a "wound" (the lore centre); modules nearer to it are more tilted, repeated, patched and unlit.
10. Reserve seams for exits to other worlds: a door or tube that is the wrong scale, or cleaner than anything around it.

**Avoid:** uniform street grids; identical lit rooms; clean straight sightlines to the end; long stretches with no scale reference; unmotivated randomness (errors should look like a system fault, with a repeated cause).

## Sources
- Brutalist Architecture in Games: https://www.gamedeveloper.com/art/brutalist-architecture-in-games
- Cane and Rinse, "What never lived cannot die: Alienation, architecture, and NaissanceE": https://caneandrinse.com/alienation-architecture-and-naissancee/
- Digital Love Child, "NaissanceE, Alien Architecture, and Terror": https://digitallovechild.com/2015/02/09/naissancee-alien-architecture-and-terror/
- Keeping Minty, Q&A on NaissanceE: https://keepingminty.wordpress.com/2015/08/30/video-game-qa-naissancee-limasse-five-2014/
- NaissanceE site news: https://www.naissancee.com/page_id-608/
- Kill Screen, "The influence of Blame! on videogame architecture is rising": https://www.killscreen.com/influence-blame-videogame-architecture-rising/
- Kody Ferron, "Theoretical Architecture in Nihei Tsutomu's Blame!" (Laurentian University): https://laurentian.scholaris.ca/items/cbde7d51-2460-4da0-bfdb-99e5b762b8f1
- Anime Collective BLAME! review: https://animecollective.com/blame-manga-review/
- Own memory of: Lorn's Lure, INFRA, Half-Life 2, Portal 2, Control, Echo (not re-verified).
