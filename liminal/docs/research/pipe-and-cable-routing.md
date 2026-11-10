# Procedural routing of pipes, tubes and cables in 3D

**Overview.** Routing pipes convincingly is a solved problem in three separate fields, and each gives us one piece. Chip and plant routers (Lee/A*, negotiated congestion) give us collision-free paths through a cluttered volume. Plant-design rules (racks, parallel runs, 90 degree bends, supports) give us the visual grammar that makes a run look engineered. Rope and cable systems (Source's `move_rope`/`keyframe_rope`, catenary and parabola maths) give us cheap believable sag. Our generator should combine them: a coarse voxel grid over the world, a bend-penalised A* that routes between *purposeful endpoints*, a small rip-up pass, and a closed-form parabola for every hanging cable. Evidence status is marked per item: **[V]** verified from a source this session, **[M]** my own knowledge or reading, not re-verified.

## 1. Grid routers: Lee, A*, bend penalties

- **Lee / maze routing [M]**: breadth-first wave expansion on a grid from source to target, then backtrace. A* is the same with a heuristic (Manhattan distance in 3D, admissible if each step costs at least 1). On a coarse grid (say 2 to 4 world units per cell) a 3D search over a few hundred thousand cells is cheap, and in a seeded generator it runs once at build time.
- **Cost model [V partly]**: plant-routing literature models total cost as the sum of length, bends and supports per pipe (Monash "Optimization Model for 3D Pipe Routing with Flexibility Constraints"). A practical A* state is `(cell, incoming direction)`, with step cost = length + `bendPenalty` when direction changes (6 directions, so 5 possible turns). Typical values [M]: bend 3 to 8 cell-lengths for tubes that should be long and straight, 1 to 2 for messy pipes. Raise it per-run for variety: low penalty reads as a tangle, high as a rack.
- **Orthogonal only [V]**: a BlenderBIM proposal (IfcOpenShell issue 6521) describes exactly this: voxel grid, X/Y/Z-only turns, bend penalty, A*. Autodesk Plant 3D and Inventor's "3D Orthogonal Route" tool expose bend limits and orthogonal routing (help pages [V], algorithm undisclosed).
- **Rip-up and reroute / negotiated congestion [V that it exists; details M]**: PathFinder (McMurchie and Ebeling, FPGA 1995) routes all nets ignoring conflicts, then repeatedly rips up nets sharing a cell and reroutes with a cost that rises with present overuse and accumulated history. For us: route tubes in order, mark occupied cells (plus a clearance halo), and if a run fails, rip up the previous one or two and retry with a different order or seed. A cap of 3 to 5 attempts, then drop that run, is enough; a missing tube is never noticed.
- **Cost layers instead of hard walls [M]**: make occupied cells infinite, but make *adjacent-to-catwalk* and *middle-of-walking-space* cells expensive, so tubes hug ceilings, wall faces and girder lines rather than cutting through a street. Make cells next to an existing parallel pipe slightly *cheaper* (a negative bias) so runs bundle naturally.

## 2. Plant-design visual grammar

All of this is my reading of standard piping practice [M], consistent with the Autodesk and Monash material above:
- **Pipe racks**: runs travel along main corridors in shared horizontal tiers, with branches leaving at right angles. Many pipes run **parallel at fixed spacing** (centre-to-centre = largest diameter + flange allowance + gap).
- **Supports** every N units (smaller diameter = shorter spacing; roughly 3 to 6 diameters-worth scaled up for a game, so 4 to 8 m for thick tubes), as brackets to a wall, hanger rods from the ceiling, or stanchions to the floor. Supports are the strongest "someone designed this" cue.
- **Bends are 90 degrees (or 45) with a standard radius**, flanges at joins every segment length, valves and gauges at branches, and expansion loops (a U-jog) on long runs.
- **Clearances**: stay out of walking envelopes (about 2.2 m headroom, 1 m beside walkways) and keep service space around valves.
- **Endpoints are equipment**: a run begins at a nozzle on a machine and ends at another. Dangling stubs are the exception, and thus a "wrongness" signal.

## 3. Procedural pipes in games and demos

- **Windows 3D Pipes screensaver [V partly]**: pipes extend as segments in axis directions, never collide, and the screen fades and restarts after a while. Joint style is random per pipe: before NT 4.0 "mixed" was 50/50 ball or elbow; from NT 4.0 it is 1/3 ball and 2/3 elbow; a teapot occasionally appears, and in "flex" style when a pipe dead-ends (Raymond Chen, *The Old New Thing*, 24 Dec 2024). The exact direction-choice code was not found. Terminal remakes use "go straight with probability 1 in D" (pipes.sh, D=13) [V]. Take-away: **straight bias plus random turn gives a believable wander; a dead end is not a failure but an event** (cap, teapot, valve).
- **Houdini / No Man's Sky / Satisfactory [not verified]**: searches returned nothing usable. From memory: Satisfactory belts are splines with a minimum turn radius and snap to ports (orange input, green output per an unofficial guide [V weakly]), which is a good reminder that *ports with direction* make runs legible. Houdini pipe setups typically sweep a circle along a polyline and add collars at bends.

## 4. Hanging cables

- **Catenary vs parabola [V]** (leancrew.com): catenary `y = a(cosh(x/a) - 1)`, with `a` solved numerically from span w and sag h via `a(cosh(w/2a) - 1) = h`. Parabola through the ends and middle: `y = h(2x/w)^2`. Maximum error vs catenary: sag = span gives about 10% of the sag; sag = span/2 about 5%; sag = span/4 under 2%; sag = span/8 under 0.5%. An 80.lv write-up of a Maya cable tool confirms games ship a parabolic approximation [V].
- **Recipe**: for end points A and B with horizontal distance d, set sag `h = slack * d` (slack 0.03 to 0.15 for taut service cables, up to 0.4 for loose hanging loops), and place points `P(t) = lerp(A,B,t) - (0, 4h t(1-t), 0)`. This is the parabola, exact at ends and midpoint, no solving. For vertical-ish spans (B nearly above A) the formula degenerates, so use a droop that peels off the lower end instead, or a verlet pass.
- **Source engine [V partly]**: `move_rope` / `keyframe_rope` are chained path entities (same class, `CRopeKeyframe`). Per-rope keyvalues: **Slack** (integer extra length; default length = endpoint distance), **Subdivision** (max 8), **Width** (1 to 64), type/texture, plus an auto-resize flag; community notes warn that slack is not recomputed when ends move and that too much slack looks bad. The Valve wiki returned 403 to direct fetch, so the details come from search summaries. Lesson: *a rope is just two anchor points, a slack amount, a segment count and a width*, and 8 subdivisions is sufficient.
- **Verlet rope for static sag [M]**: only worth it to settle ropes around obstacles at build time (fix endpoints, run 30 to 60 iterations with gravity and length constraints, bake). Skip it for the default; the parabola is cheaper and visually equivalent.
- **Cost**: render cables as one merged `InstancedMesh`/merged `BufferGeometry` of low-poly tubes (4 to 6 radial sides, 6 to 10 segments), or even camera-facing ribbons beyond 20 m. Thousands are fine merged; draw calls, not triangles, are the risk (relevant to the stutter problem the owner reported).
- **Bundles and trays [M]**: a cable tray is a rectangular channel along a ceiling with N cables offset in a lateral grid inside it; tray runs on hangers every 3 to 5 m. Cables leave the tray with a drop loop (parabola with high slack) to a machine.

## What this means for our game

**Generator rules**
1. Voxelise the finished layout (masses, catwalks, stairs, streets) at 2 to 4 units per cell after everything else is placed; mark solids, catwalk volumes with a 1 m halo, and the walking envelope as high-cost, never as free air.
2. Pick endpoints first, not paths: choose pairs of **ports** (machine nozzles, wall penetrations, tank tops, junction boxes) with an outward direction vector, then A* between them, so every tube starts and ends on something.
3. Route with state `(cell, dir)` and a per-run bend penalty drawn from {1, 3, 6} so some runs are straight racks and some are tangles.
4. Allow the tube diameter to decide behaviour: thick hollow transport tubes (walkable-sized or large enough to read as vacuum tubes) get high bend penalty, 45 degree and 90 degree bends with fixed radius, and long straight spans; thin pipes get low penalty and cluster.
5. Make parallel bundling cheap: cells adjacent to existing pipes get a cost discount, then offset parallel runs at a fixed pitch.
6. Place supports every N units along each run (N by diameter), each as a bracket to the nearest solid face; if no solid face is within reach, add a stanchion or cap the run: it is allowed to end in free space only as a deliberate "wrongness" event.
7. Rip up and reroute at most 3 to 5 times, then drop the run. Never let routing failure leak into the world.
8. Hang cables as parabolas between pairs of nearby anchors on different structures (girder to machine, catwalk rail to ceiling); set sag as a fraction of span with a per-cable random slack; merge all into one mesh per chunk.
9. Seed everything (per-run seed derived from world seed plus run index) so a world reproduces.

**Layout and pacing**
- Use tubes as **wayfinding and disorientation**: a few arterial tubes that visibly lead somewhere (towards a landmark machine or the big hall) give the player a thread, while a dense field of dead-branching tubes in a tight section creates the feeling of being inside plumbing.
- Vary the *topology of pipe use* per space, which is what makes spaces differ purely by layout: a street with a single huge tube overhead, a street whose ceiling is a continuous pipe rack, a hall with cables crossing diagonally at all heights, a closet where tubes pass through the walls at odd angles.
- Tubes that pass *through* a space (entering one wall, leaving the opposite) imply a larger system beyond the player's reach.

**Signs of wrongness (chaos factor)**
- A tube run that repeats the same 3-segment zigzag many times (loop glitch), or a rack with one pipe 5 degrees off-axis.
- A bundle of cables that all end at a wall with nothing there, or tubes that clearly connect but are visibly severed, leaking fog or flickering light (the "something is breaking" lore).
- A cable pulled taut and snapping straight across a street (a "tripwire" sag of zero) amongst slack ones.
- Pipes that route *through* the shelter of scavenged parts, as if the shelter were built around a running line.
- Support spacing that suddenly doubles, then pipes sagging because supports are missing.

**Avoid**
- Pure random-walk pipes with no endpoints (reads as a screensaver, not a facility).
- Pipes clipping through catwalks or blocking stairs (breaks trust), and tubes with open ends: cap every end with a flange or collar mesh, which also fixes the owner's "see-through pipe ends" complaint.
- Per-cable draw calls and per-frame cable updates: bake once.
- Over-regular spacing in every space; vary the pitch and rack height per chunk.

## Sources
- Valve Developer Community: Keyframe rope, Move rope, Cables and Ropes (developer.valvesoftware.com/wiki/Keyframe_rope, /Move_rope, /Cables_and_Ropes); read only via search summaries, direct fetch returned 403.
- leancrew.com, "Catenaries, parabolas, and ropes" (https://leancrew.com/all-this/2022/03/catenaries-parabolas-and-ropes/), fetched.
- 80.lv, "Fully procedural catenary curves generator in Maya" (https://80.lv/articles/fully-procedural-catenary-curves-generator-in-maya), search summary.
- Raymond Chen, The Old New Thing, 24 Dec 2024 on 3D Pipes (https://devblogs.microsoft.com/oldnewthing/20241224-00/?p=110675), search summary.
- 1j01/pipes, Three.js remake of 3D Pipes (https://github.com/1j01/pipes), not read in full.
- IfcOpenShell issue 6521, "3D Orthogonal Pathfinder for MEP Routing in BlenderBIM" (https://github.com/IfcOpenShell/IfcOpenShell/issues/6521), search summary.
- Monash, "An Optimization Model for 3D Pipe Routing with Flexibility Constraints" (https://researchmgt.monash.edu/ws/portalfiles/portal/257708132/93759696_oa.pdf), search summary.
- Autodesk Plant 3D "About Piping Bends" and Inventor "About 3D Orthogonal Route Tool" help pages, search summaries.
- McMurchie and Ebeling, "PathFinder: A Negotiation-Based Performance-Driven Router for FPGAs" (1995), cited from memory and via a patent summary.
