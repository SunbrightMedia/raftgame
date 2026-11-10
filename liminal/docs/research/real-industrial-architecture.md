# How real industrial plants are laid out (for believable variety)

## Overview

Real plants feel varied because each is organised around a different flow (fluid, steam, electricity, material, data), and the layout is the visible diagram of that flow. A refinery is process units strung along pipe racks. A power station is a long chain: boiler house, turbine hall, switchyard. A data centre is a regular grid of identical halls whose only variety is the services above and below the floor. Distinct spaces come from three things: a different dominant flow, a different scale (human, crane, vehicle, vessel), and a different enclosure (open frame, shed, tunnel, vault). Verification note: OSHA numbers below were checked against the CFR text (29 CFR 1910.25 and 1910.28 via Cornell LII). Pipe-rack spacing was only weakly sourced by search. Everything else is from my own memory of plant layouts and should be treated as plausible, not cited.

## Space types

Each entry gives typical dimensions, contents and what makes it recognisable (memory-based unless noted).

- **Pipe rack / pipe bridge.** A steel portal frame with 2-4 tiers, bays of about 6-8 m, rack width 4-10 m, first tier at 4-6 m so trucks pass beneath. Carries bundles of parallel lines, a cable tray tier, and periodic expansion loops (a U or L dog-leg that eats plot space beside the rack). Recognised by: long parallel lines to the horizon, repeating portals, a visible kink every 30-50 m.
- **Process unit.** An open steel structure 20-60 m tall with stacked grating floors, columns (tall cylinders), heaters, exchangers laid horizontal, pumps in a row on the ground under the rack. Recognised by: vertical cylinders linked by one big overhead line, stair towers on the outside, no walls.
- **Tank farm.** Large cylindrical tanks (10-80 m diameter) inside low containment bunds, with spiral or radial stairs up the shell, a ring of pipework at the base, and wide gaps for fire access. Recognised by: huge empty horizontal space, repetition of near-identical forms, wind and a low horizon.
- **Turbine hall.** A single enclosed nave 30-50 m wide and 100+ m long, a travelling overhead crane on rails, turbine-generator sets on a raised operating floor (a big table) with a basement full of condenser, pumps and pipework below. Recognised by: cathedral volume, the crane beam, long sightlines, floor opened to a deep void.
- **Boiler house.** A tower 50-100 m tall hung from the top, gantries at many levels, ducts and ash hoppers. Recognised by: vertical scale, heat-stained steel, ducts the size of rooms.
- **Cable spreading room / switchgear room.** Cable spreading rooms are low (about 2.5-3.5 m), wide, with several levels of cable trays densely stacked and sitting under switchgear rooms (confirmed in search results: cabling runs in trenches or a spreader room below the switchgear room). Switchgear rooms are rows of identical grey cabinets with back-of-cabinet aisles. Recognised by: a dense ceiling of trays, rows of identical doors, hum, tight corridors with right-angle turns.
- **Offshore platform.** Stacked decks with modules (wellhead, process, utilities, living quarters) packed tightly, open grated decks showing the sea below, lifeboat stations, a flare boom projecting off one corner, and a derrick. Recognised by: extreme density, lack of any horizontal margin, a single projecting silhouette element.
- **Steel mill.** Long bays with overhead cranes, ladle tracks, roller tables, sheds that glow. Recognised by: linear flow of one product along a roller line, big gantry cranes, scale-by-length.
- **Data centre.** Raised floor, cold-aisle and hot-aisle containment, overhead tray and ladder rack, identical racks in ranks of 10-30. Recognised by: perfect repetition, cold light, aisle numbering.
- **Particle accelerator.** A ring tunnel about 3-5 m in diameter (LHC about 3.8 m inner lining, 27 km), a single line of magnets running down it with cryogenic piping and a cable tray, punctuated by caverns and access shafts that are much bigger. Recognised by: an endless one-dimensional corridor that suddenly opens into a cavern.
- **Nuclear plant.** Thick-walled containment, spent-fuel pool halls, airlock-gated zones, colour-coded floors and radiation controls. Recognised by: concrete mass, zone-marking, airlocks, lack of windows.
- **Ship engine room.** Vertical, multi-deck, tight, with engine crank pit open to decks, narrow stairs, ladders at steep angles, a control room separated by glass. Recognised by: compression, steep ladders, heat and noise.
- **Automated warehouse / AS/RS.** Racks 20-40 m tall in aisles about 1.5 m wide with a crane travelling down each aisle, conveyors tying them to docks. Recognised by: slot-canyon aisles, rails, machines moving by themselves.
- **Pneumatic tube system.** Small-bore (about 100-150 mm) tubes with diverters and blowers, running in bundles from stations. Recognised by: tubes ending at a little station, junction boxes, labelled destinations.

## Walking-surface standards (verified)

From 29 CFR 1910.25 (Cornell LII): standard stairs 30-50 degrees; riser at most 9.5 in (24 cm); tread at least 9.5 in; width at least 22 in (56 cm) between barriers; headroom at least 6 ft 8 in (about 2.03 m); landings at least as wide as the stair and at least 30 in deep. Spiral stairs: at least 26 in clear width, riser at most 9.5 in, headroom at least 6 ft 6 in. Ship stairs: 50-70 degrees, open risers. Alternating tread stairs: 50-70 degrees. From 1910.28: an unprotected edge 4 ft (1.2 m) or more above a lower level needs a guardrail; fixed ladders over 24 ft need a cage, well or fall-arrest, caged sections offset with landing platforms at most 50 ft apart. From 1910.29 (not fetched; search plus memory): guardrail top 42 in plus or minus 3 in (about 1.07 m), midrail halfway, toeboard about 3.5 in. Practical figures from memory: catwalk grating 0.75-1.0 m wide for service, 1.2 m+ for main routes; vertical ladders with rungs about 30 cm apart (12 in).

Game consequence: 22 in is about 0.56 m, so the legal minimum is tight, and a main route at 1.2 m reads as generous. Use stair width as a signal of importance.

## Routing and support of pipes, trays, ducts

- **Pipe spans** are set by pipe size, weight and material; a rule of thumb from search results is about 10-20 ft (3-6 m) between supports, but that source was weak, so treat as approximate. Visually: small pipe is hung every 2-3 m, big pipe sits on a portal every 6-8 m.
- **Expansion** is absorbed by loops (U-bends), offsets, and bellows. Loops sit at regular intervals along long runs and are often placed at the end of a straight leg. They are recognisable and cheap to model.
- **Guides and anchors.** Most supports let the pipe slide; a few anchors fix it. Visible hardware: shoes, U-bolts, trapeze hangers, spring hangers on hot lines.
- **Elevation changes** follow the rule: lines turn at right angles, change elevation in pairs of 90-degree bends, and cross in layers (no random diagonals). Flat-on-top (FOT) or bottom (BOP) alignment is kept in a rack so bends stay tidy.
- **Cable trays** run in separate tiers from pipes (power above, control below, or on the opposite side), with ladder trays for power and perforated for signal; they drop vertically to equipment in vertical risers with a rubber/fire stop where they pass a floor.
- **Ducts** are large rectangles with flexible joints at fans and lots of turning vanes; they dominate boiler and ventilation spaces.
- **Hangers and access.** Anything that must be operated (valves, drains, instruments) has a platform or chain wheel within reach; valve handwheels at about 1.2 m, with chain operators for the high ones.

## Silhouettes

What differs between plants at a distance: tall thin columns and a flare stack (refinery); large cooling towers and chimneys (power); sheds with a spine of stacks (steel mill); low flat boxes and chillers on the roof (data centre); a dense stacked block with a derrick and flare boom (offshore); nothing visible but a few shafts (accelerator). Distinct silhouette per district matters more than detail.

## What this means for our game

**Space-type palette for the generator.** Define 12-15 space "grammars", each a short rule list with its own dimension range, enclosure (open frame, shed, tunnel, vault), flow axis and dominant prop family. Suggested: pipe canyon, rack bridge, process tower, tank yard, turbine nave with pit, cable spreader crawl, switchgear row, AS/RS aisles, accelerator ring tunnel with cavern, engine-room stack, tube sorting hall, sump/condenser basement, roof of a mass with chillers and flare.

**Rules**

1. Give each space exactly one dominant flow direction and one dominant prop family, and vary the flow axis between adjacent spaces (parallel, perpendicular, vertical).
2. Vary the three scale axes independently: width, height, and sightline length, so that a wide low room, a narrow tall one, and a long thin one all appear.
3. Alternate compression and release: a cable crawl (2.5 m high, aisles under 1 m) feeds a nave 40 m tall; never put two same-scale spaces adjacent more than once.
4. Use correct standard dimensions for walkable parts: stairs 30-50 degrees, risers about 0.2 m, rail 1.07 m, ladders every 0.3 m, landings every 3-4 m of height, so the world reads as human-designed while the player is a small, plausible-sized visitor.
5. Route pipes in layers with 90-degree bends and an expansion loop every 30-50 m; run cable trays on their own tier; hang supports every 3-6 m.
6. Put every machine on a service access: platform, stair, valve chain, otherwise the structure feels fake.
7. Give each district one signature silhouette element (flare boom, stack, crane rail, column row).
8. Make "wrongness" a deviation from a rule that the player can feel: a pipe that stops at nothing, a stair with a missing landing, a ladder cage with no top.

**Pacing and layout tricks**

- Sightline planning: long straight views down racks or aisle canyons, then a hard turn; reveals into caverns from tunnel mouths (accelerator model).
- Use looping routes: the pipe rack runs above the street you just walked, so the player recognises it from a new level.
- Scatter landmarks (flare, crane, tank) visible from far away, but never reachable by the obvious route.

**Avoid**: uniform grids of identical cells; random pipe diagonals; fully open spaces without cover or rhythm; spaces with no evidence of maintenance access; length without a reason (every long run needs a termination: a unit, a loop, a header).

## Sources

- 29 CFR 1910.25, Stairways: https://www.law.cornell.edu/cfr/text/29/1910.25 (fetched, verified)
- 29 CFR 1910.28, Duty to have fall protection: https://www.law.cornell.edu/cfr/text/29/1910.28 (fetched, verified)
- OSHA 1910.25 page: https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.25 (search result)
- Pipe rack design guide copies and EPC Land article (weak, search result only): https://epcland.com/?p=52811
- Substation/power design notes on cable spreader rooms (search results): EirGrid layout standards, https://cms.eirgrid.ie/sites/default/files/publications/XDN-LAY-STND-L-100-00_400_8-220_16-110_16.pdf; BHEL thermal plant tender drawing list, https://tenders.bhel.com/sites/default/files/AnnexuresToTechnicalSpec-2022-09-14-05%3A17%3A21.pdf
- Everything else (plant space types, dimensions, silhouettes, pipe routing conventions): my own memory, not source-checked.
