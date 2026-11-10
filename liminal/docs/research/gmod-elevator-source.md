# Elevator: Source (Garry's Mod gamemode, Pixeltail Games, 2012)

**Overview.** Elevator: Source is a single or co-op Garry's Mod gamemode in which the players do almost nothing except ride an elevator. The car stops on randomly chosen "floors". The doors open on a short self-contained vignette, then close and the ride resumes to the next one. Pixeltail describe it as "different each time you play", with up to 28 randomized floors on the way to a final floor. The whole game is pacing: ride, stop, surprise, ride, repeat. The vignettes are tiny, and they are strung together by one constant place. That structure maps well onto a procedural liminal world with portals to other worlds.

**Source caveat.** Several wiki and TV Tropes pages returned 402/403 to my fetcher, so I could not read a complete primary floor list. Items marked [V] were verified from a page I read or a search snippet. Items marked [M] are my memory or reading and may be wrong in detail. Nothing here has durations I could verify beyond those marked [V].

## Verified structure [V]
- Source: pixeltailgames.com/elevator, the ModDB page, and the official SDK page (pixeltailgames.com/elevator/sdk.php), which I read.
- The SDK template map contains exactly four required parts. These are the **lobby** (entity `elevator_lobby`), the **intermission elevator** (`elevator_main`, the waiting car), the **end floor** (`elevator_end`) and example floors (a dungeon and a space floor). The gamemode is a framework: the elevator is the fixed hub, and floors are plug-in modules.
- Floors are discovered by naming convention. An `info_elevator_floor` named `elevator_custom_<NAME>` is picked up automatically. Each floor needs `_start` and `_end` relays and a `_doors` entity. A floor is a closed contract: "start" trigger in, "end" trigger out, doors in between. Floors know nothing about each other.
- The prefab end floor ends after a 10-second relay delay, which the SDK tells authors to change per floor. So each floor owns its own duration.
- Community floors ship as separate content, compiled into the map via the SDK. The gamemode is open source on GitHub (pixeltailgames/elevator-source), so I could not read its floor-selection code through the tools I had. I do not know whether it shuffles without repeats.
- From a Steam guide and search snippets [V]: there is only one floor where you can truly walk out and linger (pool, slot machines, a juice blender, a TV that plays YouTube). Floors with a solid black background are "pit" floors. They may contain pits, a vacuum, or the "breaking elevator" event. A fan wiki mentions a trunk floor with a ghost of a woman peeking out, a floor of staring red eyes where a hand grabs a random passenger, a floor where the watch behaves oddly, and one where the elevator disassembles and reassembles. A commentary snippet says the draw is finding "a beach two floors up from a detective's office".

## Floors as I remember them [M]
Treat names and details as approximate.
- **Party/disco floor:** a crowd of NPC revellers, loud music; the doors open on noise and light.
- **Forest floor:** dark trees, fog, an unsettling Slender-like figure at a distance; you are not meant to leave.
- **Kitchen floor:** a fridge, appliances and a mess; mundane, wrong in small ways.
- **Void floor:** the doors open on nothing, a black or white emptiness.
- **Meat room:** flesh and meat, a horror beat, short.
- **Beach floor:** sun, sand, calm; the relief floor.
- **Detective office:** noir interior, a stylised joke.
- **Space, dungeon, hotel, snow, mountain, and a mock "pit" floor.**
- **Hell or red floor:** an escalation beat late in the ride.
- Duration pattern [M]: most stops last roughly 10 to 30 seconds with the doors open before the car moves. The ride between stops is a few more seconds of silence or muzak. The end floor is longer and acts as a finale, then the round resets to the lobby.
- Total run: a full ride takes on the order of 10 to 20 minutes depending on how many floors the server rolls [M].

## Pacing rules extracted
1. **Boredom is the setup.** The default state is a quiet metal box, a ding, and light music. Because 50 to 70 percent of the time is nothing, a stop reads as an event. A strange stop only works against a long stretch of calm.
2. **Interrupt calm, don't stack strangeness.** Alternate mundane and bizarre floors (an office, then a void, then a beach). Two horror stops in a row dull the effect.
3. **The player's control is nearly zero at the stop.** You choose only whether to step out. Because stepping out is risky and optional, the tension comes from a choice that carries no prompt.
4. **Duration is the dial.** Most vignettes are short and fixed-length. The short length means authors can pack in one idea only: a single gag, a single image. Short scenes do not need plot.
5. **Scene independence enables randomness.** Since floors do not reference one another, any order is valid. Random order produces accidental juxtaposition, which supplies the meaning (beach next to detective office).
6. **The hub is the constant.** The same elevator interior, same ding, same buttons, same faces of other riders. All variation lives outside the doors. The familiar car makes each weird view feel safe to look at, and also makes it feel like you are being taken somewhere by something.
7. **Wrongness inside the hub.** The best moments are the car itself failing: breaking, lights flickering, the watch glitch, disassembling. The one safe place stops being safe.
8. **The end is a finale, not a reward.** The last floor is longer and different in scale, then it resets.

## The elevator as a hub between unrelated worlds
- The hub is **nonspatial**: the interior is a few metres, but it connects to places that could never share a map. In Source this is done by compiling every floor into one map at distant coordinates and teleporting or sliding door views. In our game the equivalent is a loading boundary: the door closes, the next world loads, the door opens.
- **Hub rules that suit entrances and exits:** a single recognisable transitional space (car, lobby, cabin), a short sealed interval where loading happens in the player's blind spot, and a visible but unreadable indicator (floor number, lamp) that implies order without explaining it.
- **Extensibility:** the naming-convention plug-in model means new worlds can be added without touching existing ones. A world needs only a start trigger, an end trigger, and a door.

## What this means for our game

**Generator rules**
1. Give every world and every sub-region a **contract**: an entrance, an exit, a duration or size budget, and nothing else. Generate content only against the contract, so modules can be shuffled in any order.
2. Roll **region order with a seeded shuffle** and forbid adjacent regions with the same "mood tag" (calm, loud, tight, vast, glitch). Let the seed also decide whether the calm-to-strange ratio is roughly 2:1.
3. Add a **boredom budget**: a minimum run of plain corridor, catwalk or tube before any vignette can trigger, and a cooldown after one. Vignettes should be rare enough that players expect nothing.
4. Make **vignettes small, closed kits** (one room, one idea, under 30 seconds of looking). Give them a set of 10 to 30 templates, each placed at most once per seed or with a decay on repeats.
5. Mark one vignette type as the **safe lingering place** (a lit break room) so players learn that a place can be lived in, then take that learned safety away occasionally.
6. Let the hub **break**: tie a world-level "breaking" counter to the lore so that late in a run the connector space itself shows faults (flickering, wrong floor numbers, repeated doors).
7. Keep **doors as loading seams**. Any exit to another world is a door, a lift or a tube hatch, always preceded by a short enclosed approach.

**Layout and spatial tricks**
- Insert a **closed small room between two huge spaces** (a service lift, a tube capsule). The compression-release contrast makes each space feel different even with the same kit.
- Use **one window onto a different place**: a hatch or viewport that shows another world's lighting before you can enter it.
- Place a **dead-end vignette** with no exit but the way you came, to teach that places can be skipped.
- Make some stops **look wrong from the doorway** (wrong scale, missing floor, lights off) so the player decides from a distance whether to enter.

**Signs of wrongness**
- Repeated identical floor numbers or signs, a lift whose indicator skips or counts backward, a car that visits a floor it already showed, a stuck muzak loop, other riders missing.

**Avoid**
- Telling the player why anything happens. Avoid timers on screen, explanatory text, and rewards for exploring. Avoid back-to-back strangeness and avoid vignettes that need more than one look to understand. Do not make the hub fully safe or fully unsafe.

## Sources
- https://www.pixeltailgames.com/elevator/ (official page, via search snippet)
- https://www.pixeltailgames.com/elevator/sdk.php (read)
- https://github.com/pixeltailgames/elevator-source (read; README only)
- https://www.moddb.com/mods/elevator-source (search snippet; fetch blocked)
- https://tvtropes.org/pmwiki/pmwiki.php/VideoGame/ElevatorSource (search snippet; fetch blocked)
- https://tropedia.fandom.com/wiki/Elevator_Source/YMMV (search snippet; fetch blocked)
- https://steamcommunity.com/sharedfiles/filedetails/?id=560183751 (Steam guide "How to Get Outside of the Elevator in Elevator: Source", snippet only)
- https://forums.pixeltailgames.com/t/elevator-unite/47427 (snippet only; refers to Tower Unite build)
