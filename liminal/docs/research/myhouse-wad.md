# MyHouse.wad: the grammar of escalation

**Overview.** MyHouse.wad (Steve "Veddge" Nelson, released 3 March 2023; extra scripting by Kaelan Evans) is a single GZDoom map for Doom II that begins as a plain suburban house recreated from "a dead friend's" unfinished map, and slowly reveals itself to be a non-linear, self-modifying structure with six endings, around sixteen collectible "memory" artifacts, and a Google Drive folder of journal pages, photos and sketches. Its power comes less from any one trick than from a disciplined sequence: establish a boring, fully learned space; change it in ways the player can deny; make the player's own knowledge the progression currency; then widen into other unrelated places that are all rooted in the house's floorplan. Evidence labels: **[V]** = stated by sources I fetched or searched this session (Wikipedia, Doom Wiki snippets, a Doomworld thread summary, a progression write-up at taw.duke4.net, TechSpot/PC Gamer coverage as relayed by search results). **[M]** = my own memory or reading, not verified now. Several primary pages (Doom Wiki, Doomworld Cacowards, the House of Leaves wiki) returned 403, so details of the later areas are thinner than I would like.

## 1. The ordinary house (the baseline)

- Opens in a fenced front yard, ordinary Doom monsters, coloured keys leading you room to room. Doors open into ceilings; teleports separate floors. [V]
- The front gate leads out to "Underhalls" (an early-exit ending) and is where the key breadcrumb trail ends: "from here on knowledge replaces keys." [V]
- Design purpose [my reading]: the player is given a complete, small, mapped mental model. Every later effect is measured against it. The baseline is long enough to be learned and ordinary enough to be boring.

## 2. Escalation stages

Order below follows the write-ups; exact sequencing is non-linear. [V unless noted]

1. **Silent changes on re-entry.** On a later run the same house differs: a soulsphere visible outside a window, a flat roofline now sloped, doors that swing inward with new sounds. Pickup of the key items (turned into custom artifacts with descriptions) triggers "subtle environment changes". Early changes are subtle enough that inexperienced players miss them.
2. **Verticality that Doom shouldn't allow.** UDMF slopes and overlapping floors; windows show rooms above and below at once (TechSpot: two-floor areas not normally achievable). Portals make two regions behave as one continuous space so you see across them.
3. **Commitment.** Going deep enough in the altered state makes the exterior doors vanish; you must follow the route. Leaving at a particular moment makes the house disappear and a "SOLD"/"Navidson Realty" sign replaces it (Ending 1, leaving with fewer than 14 artifacts).
4. **Mirrors and water as dimension triggers.** Fill a sink and the bathtub reflection's water level changes; fill and enter the tub for a waterlogged variant linking to the Poolrooms. Remove a blanket from an attic mirror to reveal an unobtainable item; bathroom mirrors then give access. Picture frames count collected memories (8 in the main house, 16 including mirror frames).
5. **Rooms that reuse the house's plan.** Brutalist House (the house layout in concrete, harsh colours; a domesticated dog and a hellhound that die together), Nursery (cartoon enemy appears after a wall drawing vanishes), Poolrooms/Bathhouse (fog, reflections, an edge that drops into an endless staircase), Daycare (boss under a Shrek mural), Airport (cryptic bathroom, plane ride), mirrored house (hidden hints; leads to a flipped Doom II MAP02 "sllahrednU" and a mirrored gas station), Hospital (circular, reachable once per playthrough after dying and leaving the game idle), forest road and Shell gas station (a car looping a song), Labyrinth (vast, featureless, House of Leaves' hallway). The upper floor, basement and bedroom layouts recur through these areas as architectural echoes.
6. **Looping staircase.** Connects several locations with one-way doors, acting as a hub that cannot be walked back through.
7. **Points of no return.** Throwing the breaker box starts a fire upstairs and a red sky; the Burnt House locks you out of several areas and two endings. Some items are not obtainable without leaving, clearing Underhalls and re-entering with the weapon; a missed item may require reloading.
8. **Fourth-wall exit.** Noclip out of bounds drops you into a Backrooms adaptation. Late game: gas station, combat areas where enemies act as walls to demolish, an invulnerable Archvile variant chasing, and a beach with no end screen so you choose when to stop.

## 3. Which engine feature produces which trick

| Trick | Mechanism | Status |
|---|---|---|
| Two floors in the same XY footprint, seeing across | GZDoom line portals / sector portals (plus 3D floors for simple cases) | [V] general; [M] which rooms use which |
| Dead-end that is secretly a stair | Silent teleport at a fake door/dead end; a "blue line" in front of a dead end is a portal line | [V] (forum reports) |
| Floors separated by teleport | Silent teleports hide the join between levels | [V] |
| Sloped roofs, odd windows | UDMF slopes, overlapping sectors | [V] |
| Changes after pickup, mirrors, sinks | ACS-style scripting driven by item state and level flags | [V] scripting; [M] ACS specifics |
| Texture, sound, music swaps | Per-area swaps tied to those scripts | [M] |
| Persistence of "has been here" | Items/inventory counters (artifacts, memories) gate state | [V] artifact counts; [M] implementation |
| Noclip penalty | Out-of-bounds detection teleports to Backrooms area | [V] |

The shared principle: the geometry the player sees is never altered while they watch. Changes are applied when the player is inside a portal/teleport transition, behind a door that has just closed, or between runs/entries. [my synthesis of V reports]

## 4. Grammar of escalation (my reading; numbers are approximate unless stated)

- **Repetition before change.** The player sees the normal house for the better part of a first playthrough before any wrongness is shown; the strongest wrongness comes on the second and later entries. The ratio is roughly "learn once fully, then alter on each return". No source gives an exact count.
- **Concealment.** Changes are hidden by (a) door transitions, (b) teleports in dead ends, (c) differences too small to notice on first pass (a roofline, a window view), (d) the player's attention being on enemies/keys. The worst hiding method, watching a wall move, is avoided.
- **Loops and returns.** Almost everything returns to the house: the same floor plan reinterpreted (brutalist, mirrored, burnt), the same stair, bath, bedroom. Return makes the new place readable and the difference meaningful. One-way doors and the looping staircase make returns asymmetric: you can arrive, not retrace.
- **Knowledge gating.** After the keys end, progression depends on remembered facts (mirror, blanket, tub). That makes each reveal feel earned and makes the player's mental map part of the mechanism.
- **Irreversibility.** Few hard locks (fire, doors vanishing, leaving) but each is signposted by a loud world change (red sky), not by a prompt.
- **Scale jump.** Tight rooms to vast empty space (Labyrinth, Poolrooms, airport) late; never early.
- **Tone mixing.** Domestic, institutional (daycare, hospital, airport), brutalist, water: each a different liminal genre, but joined by the house's layout.

## 5. Journal, Drive folder, House of Leaves

[V] The download is a folder with a stripped-down .wad plus the full .pk3, screenshots, photos of the "real" house, sketches and a journal (about eight months of entries) about insomnia, paranoia and the map seeming to build itself; the author claims to have posted the wrong build. The word "house" is shown in blue as in House of Leaves. The Navidson Realty sign, the featureless Labyrinth and the concrete maze with a monstrous dog all reference the novel. The journal frame makes the file feel like found material (the Johnny Truant / Zampano layering). [V]

Lessons [my reading]: the paratext does lore work the map doesn't have to; it also gives a plausible reason for the game's wrongness (the map is sentient) without a villain.

## What this means for our game

**Rules for the generator**

1. Give every world a "baseline district": 2 to 4 regular, fully readable spaces near the spawn, using the plainest kit pieces, so wrongness has something to differ from.
2. Generate a district's layout once, then re-derive later districts from its floor-plan graph (mirror, scale, rotate, burn, flood, concrete-ify) rather than from fresh random layouts; the player should half-recognise them.
3. Always make the first chaos events subtle (a girder slightly off-axis, one pipe crossing a stair at a wrong height) and escalate with a monotonic "wrongness" budget that rises with distance travelled or loops completed.
4. Apply any change only while the player cannot see the affected volume: behind a closed door, after a portal/transition, on re-entry to a district, or outside the view frustum plus a margin.
5. Use one-way connections (drop, ladder pulled up, door that locks behind) to build loops that can be entered but not retraced.
6. Give each district exactly one "wrong property" (stairs lead to the same floor, repeated cell, flooded, inverted gravity of props, missing floor) so no two spaces feel alike, regardless of kit.
7. Pace scale: tight and closed rooms, then a vast open hall, then tight again; never two open halls in a row.
8. Keep at least a few mandatory state gates that need knowledge, not keys (a symbol seen earlier, a valve order seen on a wall).
9. Tie each secret to a landmark that is visible from elsewhere in a district so that players can decide to go back.
10. Do not hide an exit behind pure luck; the answer must be seen earlier.

**Things to avoid**: visible pop-in of the swap, difficulty/death resets, text popups explaining changes, a monster or chase every time, and endless repetition of one trick.

## Ideas to build

- "Echo district": generate the baseline region's room graph, then rebuild it in the same rooms in rust/flooded/concrete variant farther away.
- A dead-end catwalk that is actually a seamless teleport to a stairwell on another level, as a loop-closing device.
- Window views that show the player's own previous route from above or below (portal/camera trick) before they walk there.
- Return-and-alter: on second entry to a hall, a conspicuous prop has moved or a pipe run is cut.
- Elevator that returns to the spawn hall with one detail changed (lighting colour, tube count).
- A breaker/valve that triggers a persistent red-sky, locking certain districts permanently.
- A one-room "blank" annex reachable only via an out-of-bounds fall: a quiet Backrooms-style leak.
- Journal pages and maintenance logs as found paratext documenting the breakdown, with a few documents contradicting each other.
- A staircase set whose doors open only one way, linking four distant platforms.
- Collectible "memory" items counted to gate a late exit to another world.

## Sources

- https://en.wikipedia.org/wiki/MyHouse.wad (fetched)
- https://taw.duke4.net/?p=4714 (fetched; progression write-up)
- https://www.doomworld.com/forum/topic/134292-myhousewad/ (search summary only)
- https://doomwiki.org/wiki/MyHouse.pk3 (search summary only; fetch 403)
- https://houseofleaves.miraheze.org/wiki/MyHouse.wad (search summary only; fetch 403)
- https://www.techspot.com/news/99342-myhouse-doom-mod-masterpiece-creepy-map-editing.html (search summary only)
- https://www.pcgamer.com/games/horror/in-2023-an-anonymous-modder-released-one-of-the-best-horror-games-of-the-decade-and-they-still-havent-broken-character/ (search summary only)
- https://unwinnable.com/2025/02/05/the-fable-of-myhouse-wad-or-why-we-should-all-be-scared-of-chatgpt/ (search summary only)
