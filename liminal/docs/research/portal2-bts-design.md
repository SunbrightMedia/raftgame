# Portal 2 back-of-house design: what Valve built and how

## Overview

Portal 2's "behind the scenes" (BTS) spaces are the game's way of showing that the clean test chambers are a thin skin over a vast, working, then failing, machine. Valve's mapping vocabulary splits Aperture into themes (Clean, Behind the Scenes, Old Aperture, Destroyed). BTS is the industrial one: catwalks, cables, vents, crushers, conveyors, vacuum tubes, panel machinery seen from behind. Its job is mostly narrative and spatial (scale, "this is how it is made"), not puzzle space. The main lessons for us are about how Valve used scale, vertical views, one repeated kit, scripted motion and staged breakage, and about how they kept players oriented. Verification note: the Valve Developer Community (VDC) pages returned 403 on direct fetch, so VDC material below comes from search-result snippets or from mapper-guide summaries. Commentary quotes were fetched from theportalwiki.com via a summariser, so exact wording should be rechecked before quoting publicly. I could not reach "The Final Hours of Portal 2" text or a GDC talk on the art. Statements marked (memory) are my own recollection, not verified here.

## What the back-of-house is made of

- **Kit (verified via mapper guides):** Hammer guides list breakers, crushers, conveyor belts and the Pneumatic Diversity Vent as the BTS prop set. The recommended models are the stock cable, vent and catwalk props plus BTS overlays. One guide says the aesthetic is used for the manufacturing section and between test chambers, and that its vistas show vents, walkways and other chambers.
- **Catwalks (verified from a mapper guide):** catwalk destruction sequences are called out as a key feature, "brilliant for action scenes". The catwalk is both a route and a set piece that can break under the player.
- **Vacuum transport (verified, Jeremy Bennett, Turret Manufacturing chapter):** the tubes were shown "to show that this was the main way that Aperture transported all of its supplies about the facility", "after all, they have thousands of the things", with objects "constantly ricocheting against the sides of the pipes". The tube is infrastructure that implies a vast unseen network. Mapping side (VDC snippet, Steam guide): built from static prop pieces plus a point_push and catapult/trigger entities and an ambient sound and particle effect. The in-game vent was reduced to scripted use because playtesters had trouble with it (Combine OverWiki, via search).
- **Factory line (verified, Aaron Nicholls):** "We designed an entire life cycle for the poor doomed turrets, from creation, product testing, error detection"; finished turrets are boxed and sent straight to an un-boxer, so "the turrets never make it to shipping", leaving "a steadily growing mountain of unrecycled packing materials". This is a loop with a waste product, a broken process that is visible as a pile. Nicholls also says players wanted more chances "to look behind the scenes of Aperture".
- **Rails and moving chambers (memory plus the Old Aperture guide):** test chambers hang and slide on rails and arms; panel arrays are seen from behind with their actuators. The Old Aperture guidance says to avoid any moving surface except rail paths and simple single-axis rotation, and to show visible supports and framework, cables for power, and suspended elements. Structures should look "functional rather than designed for show".

## Composition, scale, lighting

- **Vertical views (verified, Chris Chin, Beyond the Seal):** "your eye is drawn upwards by the elevator tower, sparking cables, falling debris" and "this looking upwards gives the player sense of the vastness of Aperture". The camera is pulled to a landmark that is far away and high up.
- **Scale as a happy accident (verified, Scott Dalton):** the transition seal lock's model came out "about five times bigger than everyone expected" and the team kept it. Scale is decided by playing with it rather than fixed on paper.
- **Seamless cheats (verified, Eric Tams, World Portals):** "an elevator, a huge expansive vista, a room that was bigger on the inside" can be inserted seamlessly. Space can lie to the player.
- **Blockout (verified, Adam Foster interview):** he sketches with "huge blocks of featureless geometry to figure out sight-lines, perspectives, angles, form, lighting" before detail, and says he often builds "vast, overall structures only truly visible from the outside". Reference was real industry: rocket test hardware, CERN, cooling towers, neutrino observatories, salt mines. Commentary adds "derelict Soviet space shuttles, overgrown temples" (Adam Foster, The Pit).
- **Lighting (verified from mapper guides, not Valve):** Old Aperture should have "plenty of variance between dark and light"; interior light should feel isolated against a "warmer, ominous glow" outside; destroyed chambers use the skybox as the main light, with foliage, rubble and rusty panels, inactive cameras "to add to that sense of solitude". Fog density and colour numbers: not found in any source I could read.
- **Light as signposting (verified, Foster):** the game scatters "a ridiculous number of clues", and the lighting shifts from cool blue at the start to warm yellow at the end.

## Wayfinding and the maze problem

Foster says the team tried "much less linear, more natural exploration" in some underground areas, "and everyone got instantly, irretrievably lost." That is the most important design fact for us: Valve found open exploration of this sort fails for a first-time player, so the tour is a ribbon through a huge space, and the space is dressed with far more than the player can use. Playtesters also fixate on salient objects and miss things behind or beside them (verified: "players were focused on what Wheatley was doing and would often get hit by a crusher they weren't looking at"). Wheatley's dialogue was rewritten to be insistent when players missed a move, i.e. the voice was used as a hint channel.

## Destruction and "the facility is falling apart"

- **Scripted, authored physics (verified, Gray Horsfield, Container Ride):** the opening rig has "over 1200 rigid bodies, 900 constraints, and 1000 joints"; "as the container bumps and crashes along, the constraints start breaking, and the room progressively starts to come apart"; the simulation was iterated "in parallel with the gameplay design" and the simulation run time was reported as 92.4875 days. The set piece is baked or rigged, then tuned like animation.
- **Rest beats (verified, Marcus Egan, Elevator Fatigue):** "a long funnel ride with some destruction to give players a short break while reminding them of the facility's state of disrepair." Breakage is paced as relief between puzzles.
- **Escalation of materials (verified, Laura Dubuk, Cave Johnson):** older Aperture has "rich, warm colors and materials like carpeting and marble" earlier and cheaper materials with "plastic and linoleum" later. Time is told by materials.
- **Wheatley's takeover (verified, Frankenturrets, WheatDOS):** the damage is character-driven. Wheatley builds Frankenturrets and rides GLaDOS's rig; "there had to be some sense that he was dangerous now."
- **Ruins as a goal (verified, Kelly Thornton):** "Starting out in the ruins of the test chambers from the first Portal was our goal pretty much from Day One", to show things had changed. The lake map "marks a total reset to the aesthetics and scale" (Chris Chin).

## What this means for our game

Rules for the generator and the layout:

1. **Ribbon in a cathedral.** Plan a readable main route (a spine of catwalks) and surround it with 5 to 20 times more unreachable machinery than reachable space. Players should see far more than they can use.
2. **Every region gets one landmark visible from its entrance.** A tower, tube cluster or lit machine, high and far, placed on the line of travel. Foster's blockout lesson: place sight-lines first, details second.
3. **Pure maze fails.** Valve's testers got "irretrievably lost" in open exploration. Give loops, a few dead ends that pay off, and a repeated landmark system, then let chaos break local readability only.
4. **Hang everything from something.** Every walkway, chamber and machine needs a visible support (girder, rail, cable, arm). Unsupported shapes read as errors, so use them only deliberately as wrongness.
5. **One loop of production per area.** Each machine zone should imply a process (make, test, reject, discard) with a visible waste pile, like the turret un-boxer loop.
6. **Time is told by materials.** Sectors age in steps: clean paint, then rust and bare steel, then overgrowth or cheap replacement parts. Place sectors in a gradient so neighbours differ.
7. **Light is wayfinding.** Use cool-to-warm drift, isolated pools of interior light against a dim exterior glow, and one distant glow per region.
8. **Pace destruction.** Alternate calm traverse, a breakage beat (a catwalk sags, a tube spills), then calm. One authored break every few minutes, not constant.
9. **Scale surprise.** Occasionally make one element absurdly oversized (Valve's seal lock) and let the corridor bend around it.
10. **Reference real industry,** not other games: cooling towers, gantries, test stands, salt mines.

Signs of wrongness (our chaos layer): a catwalk at a diagonal with its supports still orthogonal; a transport tube that ends in a wall or loops back through itself; one machine repeated 30 times with one missing or one reversed; a conveyor feeding a pile that never ships; panel arrays seen from behind with a different count than seen from the front; a "bigger on the inside" cell behind a small door; cameras and lights that are on in a dead area.

What to avoid: truly free exploration without landmarks; anachronistic motion (keep movers to rails and single-axis rotation); unlit or featureless fog everywhere (variance between dark and light is what makes it read); constant destruction that numbs the effect.

## Sources

- https://theportalwiki.com/wiki/Portal_2_developer_commentary (commentary quotes: Bennett, Nicholls, Dalton, Chin, Horsfield, Egan, Dubuk, Thornton, Tams, Charlesworth, Marcus, Srinivasan)
- https://thinking.withportals.com/forum/topic/on-the-aesthetic-themes-in-portal-2-v0-9-1-t4257/?part=2 (aesthetic themes guide: BTS, Destroyed, Old Aperture)
- https://www.blog.radiator.debacle.us/p/level-with-me-adam-foster-part-2.html (Level With Me, Adam Foster, part 2)
- https://steamcommunity.com/sharedfiles/filedetails/?id=668125032 and https://steamcommunity.com/sharedfiles/filedetails/?id=941664573 (Steam Hammer guides; seen as search snippets)
- https://developer.valvesoftware.com/wiki/Diversity_Vent and https://developer.valvesoftware.com/wiki/Behind_the_Scenes_(Portal_2) (VDC; 403 on fetch, snippets only)
- https://combineoverwiki.net/wiki/Aperture_Science_Pneumatic_Diversity_Vent (search snippet)
- Not reached: "The Final Hours of Portal 2" (Geoff Keighley); any Valve GDC talk on Portal 2 art.
