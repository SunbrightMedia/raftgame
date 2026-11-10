# Impossible and non-Euclidean space in games: how it is built

**Overview.** Almost every "impossible" space in games is one of five tricks: (1) a teleport hidden by identical geometry on both sides, (2) a swap of level content while the player is not looking, (3) rooms that overlap in world coordinates and are never shown together, (4) a portal that draws one place inside the frame of another, or (5) a world that wraps or scales so it loops. Tricks 1, 2 and 3 need no special rendering at all. Trick 4 needs render-to-texture or stencil work. Genuinely curved geometry (hyperbolic, spherical) is a separate, expensive branch that we do not need. The impossibility is felt through memory and expectation, not through rendering: the player must have a mental map that the game then quietly breaks. A note on sourcing: web search in this session returned mostly secondary summaries; items marked (V) were confirmed from a fetched or searched source, (M) are from my memory of the games and talks and should be treated as less certain.

## Techniques

### 1. Seamless teleport between identical spaces (loop corridor)
- **How:** two spaces with identical geometry, lighting and props near the trigger. When the player crosses a plane, the game moves the player (and carried state) by the offset between the two spaces, preserving velocity and view. No visual change occurs, so there is no visible cut. P.T. is the canonical case: an L-shaped hallway that loops, and a counter advances each lap (M). Each lap the game changes small details (a radio line, a light, a door, a figure) so the loop is the same place and still not the same place.
- **Best for:** infinite or looping corridors, "you can never reach the end", escalating dread. Cheapest trick there is.
- **Limits:** the player can see the seam only if the two ends differ in something visible from the trigger, including lightmaps and shadows. For a baked-lighting game, the lightmap must match at both ends.

### 2. Swap while unobserved (change blindness, doors, turn-aways)
- **How:** replace geometry or props when the player cannot see the change: behind a closed door, round a corner, during a turn of 90 degrees or more, inside fog or darkness, or while a loading-corridor hides the space. Antichamber (M) and Stanley Parable-style games use it for rooms that are different when you walk back; many "pause on a look-away" tricks are the same idea. Research on impossible spaces in VR (Suma et al., "Exploiting Change Blindness to Expand Walkable Space in a Virtual Environment", 2010; "Impossible Spaces", IEEE TVCG 18(4), 2012) (V for citations) found that people tend not to notice that rooms overlap and that overlap mostly shows up as pointing and distance errors rather than as noticed contradictions. Later work (V, via search summary) found that distractor tasks make overlaps even harder to detect.
- **Best for:** places that change between visits, doors that lead somewhere new each time, "this wasn't here before" moments.
- **Rule of thumb:** trigger changes on a visibility check (not in the camera frustum, or behind an occluder), not on a timer.

### 3. Overlapping rooms (self-intersecting layouts)
- **How:** two rooms occupy the same world volume, and only one is ever visible or collidable at a time. Doors link them. Tea for God (V: developer says play spaces overlap so the player never leaves their physical room; generation adapts to the room size, minimum 1.8 x 1.2 m) generates layouts where connected rooms share volume. A corridor can be longer inside than outside, because the outside is never seen from a position that reveals it. The simplest form is a door that goes into a room larger than its footprint.
- **Best for:** buildings bigger on the inside, more rooms than the footprint should hold (House of Leaves, MyHouse.wad (M)).
- **Limit:** windows, skylights and open halls expose the cheat. Keep overlapping parts enclosed, or keep exterior views away from the overlapped part.

### 4. Portals (see one place through a window in another)
- **Render-to-texture portals:** for each portal, render the scene from a virtual camera placed at the destination (the main camera's position transformed by the portal-to-portal matrix) into a render target, then draw that texture on the portal surface using screen-space UVs. Cheap to understand, cost is one extra scene render per visible portal, and recursion multiplies it. Sebastian Lague's "Coding Adventure: Portals" (V, via a summary page) covers frustum culling of portals, teleporting the player, flicker fixes (draw the portal as a thin box with back faces visible), slicing objects that straddle the portal, **oblique near-plane clipping** (so geometry between the virtual camera and the destination portal does not show), and the cost of recursion. The oblique clip is from Eric Lengyel's "Oblique View Frustum Depth Projection and Clipping" (V).
- **Stencil portals:** draw the portal quad into the stencil buffer, then render the destination view only where the stencil is set, in the same pass and the same framebuffer. Needs no extra texture, handles recursion by incrementing the stencil value per depth, and avoids resolution mismatch. Thief and Prey (2006) handle space differently: Prey ran on a heavily modified Doom 3 engine with portals added (V); its first engine was reportedly meant to think in four dimensions and was scrapped (V, forum summaries). I could not verify how Thief's Dark Engine does cells/portals; from memory it is a cell-and-portal visibility system, which is different from the see-through portals used for non-Euclidean effects (M).
- **Portal 2 and Control (M):** Portal's gun-portals are a runtime version of the same thing, with the player and props physically passing through. Control's Oldest House shifts rooms and corridors by scripted changes while the player is not watching, not by live portals (my reading; I did not find a technical source).
- **Best for:** windows onto impossible places (a view that does not match where you are), rooms bigger on the inside with a visible interior, loops with a view, a corridor that connects to its own back. Zeno Rogue notes (V, from a search summary) that six square rooms joined as a cube's faces give holonomy effects, i.e. turning in a loop and finding the world has rotated.
- **Three.js specifics (my reading):** stencil is available (`stencilWrite`, `stencilRef`, `stencilFunc` on materials, render order controls). For one or two portals on screen at a time it is affordable. Keep recursion depth at 1 or 2. Use a clip plane (`material.clippingPlanes` or oblique projection matrix) for the destination so that nearer geometry is cut. A forum thread on stencil portals in three.js exists (V: discourse.threejs.org, "Issues in my portal game implementation (stencil buffer)"). With baked lighting, a portal is easy: the destination is just the same scene with its own lightmaps.

### 5. Wrapping, scale and non-Euclidean geometry
- **Manifold Garden:** the world is Euclidean but wrapped: the same chunk of world is rendered repeatedly at offsets, and the player is teleported by a period when they pass a boundary (V: Wikipedia describes world wrapping; Game Developer article titled "How I made Manifold Garden..." mentions an offset wrap, an infinite staircase reflected above you). Gravity is shifted by switching the player's "down" to one of three axes, and architecture is drawn so that all three axes read as valid.
- **Superliminal (M):** forced perspective. Picking up an object and placing it resizes it so its apparent size on screen stays constant; the engine scales the object and moves it along the view ray. Best for puzzles, and a nice way to make the player feel the scale of a world is negotiable.
- **Antichamber (M):** mixes teleport-swaps, rooms that are not connected as expected, and signs. The impossibility is the puzzle language.
- **Hyperbolica (V partly):** CodeParade devlogs cover non-Euclidean geometry and rendering; I could not retrieve the technical content of the rendering devlog from a text source (it is a video). From memory it renders hyperbolic space with custom shaders/projection rather than portals. Zeno Rogue's work (HyperRogue) shows tilings that can be navigated with portals. Costly, hard to model for, and hard to bake lighting for. Skip.

## Why some impossible spaces are eerie and others merely confusing
(My synthesis, not from a single source.)
- **Eeriness comes from a broken promise, not from complexity.** The player needs a stable reference (a landmark, a number, a repeated sign) before the game breaks it.
- **Small breaks beat large ones.** A door that is one metre off, a hallway one door longer, a room slightly too deep. P.T. and House of Leaves both work this way: the Navidson house's hallway grows by tiny, measured amounts.
- **Keep local space honest.** Physics, scale and movement stay consistent. Only topology (what connects to what) lies. If walking itself feels wrong, it reads as a bug.
- **Give evidence, not explanation.** The player finds a measurement, a tape mark, a sign counting down. The game never explains.
- **Do not break the rule twice in the same way back to back.** The second time it becomes a mechanic, and mechanics are not eerie.
- **Silence and slowness.** Break the space when nothing else is happening.
- **Confusion happens when the player cannot tell a wrong space from a big one.** Large open areas hide loops well, so you need landmarks for the break to register.

## What this means for our game

Toolbox, cheapest first:
1. **Identical-corridor loop** (teleport by offset). Needs matching geometry and lightmaps at both ends of the seam.
2. **Door swap.** When a door closes and the player is not looking, change what is behind it. Same door model, different room.
3. **Look-away swap.** Props, a catwalk section or a sign change when out of frustum.
4. **Overlapping rooms.** Generator places rooms so that enclosed rooms can share volume; keep them away from windows.
5. **Single stencil portal** for one deliberate window: for example a pane in a test-chamber stack showing a space that is not there.
6. **Wrap/loop** for the far horizon: the megastructure repeats at a fixed period so the player teleports by that period.

Generator rules:
- Treat topology as data: a graph of spaces with edges (doors, stairs, catwalks). Add "wrong" edges (one-way connections, loops back to a seen place, edges that connect two places that overlap) as a seeded, low-rate chaos option per region.
- Give each region a chaos budget from the seed. Quiet regions have zero impossible edges, which makes the others readable.
- For a loop, generate the shared segment once and instance it twice, with a per-lap variant list (a light out, a panel missing, a counter number, a crate moved).
- Place a landmark (a unique machine, a painted number) within sight of both ends of each loop, so the player can notice a repetition.
- Overlaps: check the footprint of each enclosed room against the others; allow overlap only if neither has openings facing outward.
- Door swaps: the swap is keyed to door closed and not visible, so the generator stores two variants per swap door.
- Pacing: first third of play stays consistent; first small wrongness (a hall one door too long) early; first loop around the middle; portal views late. Space them by distance walked, not by time.
- Signs of wrongness: doors that are slightly misaligned, a stair count that changes, signs with the wrong floor number, lights that point to a place that is not there, the same machine seen from two sides that should not both exist.
- Avoid: seams visible in lightmaps, visible pop-in on swaps, recursion deeper than 2, portals in every room, impossible space in open halls where horizon lines reveal the trick, and explaining the cause.

## Sources
- Suma et al., "Exploiting Change Blindness to Expand Walkable Space in a Virtual Environment" (2010), https://illusioneering.github.io/publication/suma-exploiting-2010/suma-exploiting-2010.pdf
- Suma, Lipps, Finkelstein, Krum, Bolas, "Impossible Spaces: Maximizing Natural Walking in Virtual Environments with Self-Overlapping Architecture", IEEE TVCG 18(4), 2012 (cited only; paper not retrieved)
- Sebastian Lague, "Coding Adventure: Portals" (summary): https://rosetta.to/u/sebastianlague/coding-adventure-portals
- Eric Lengyel, "Oblique View Frustum Depth Projection and Clipping" (cited via summaries)
- three.js stencil portal thread: https://discourse.threejs.org/t/issues-in-my-portal-game-implementation-stencil-buffer/67584
- Zeno Rogue, "Non-Euclidean geometry and games": https://zenorogue.medium.com/non-euclidean-geometry-and-games-fb46989320d4
- Hyperbolica press kit: http://codeparade.net/hyperbolica/ ; devlog 3 video https://www.youtube.com/watch?v=pXWRYpdYc7Q (not viewed)
- Manifold Garden: https://en.wikipedia.org/wiki/Manifold_Garden ; Game Developer, "How I made Manifold Garden fold reality back on itself"
- Tea for God coverage: https://vrscout.com/news/tea-for-god-impossible-vr-levels-quest ; https://uploadvr.com/tea-for-god-demo-oculus-quest-pc-vr/
- Prey (2006): https://en.wikipedia.org/wiki/Prey_(2006_video_game)
- Antichamber, Superliminal, P.T., Portal 2, Control, Thief: from memory, not sourced here.
