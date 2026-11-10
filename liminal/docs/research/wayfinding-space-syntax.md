# Wayfinding and spatial cognition: Lynch, space syntax, isovists

**Status of claims.** Marked [V] = confirmed this session in a search result (abstracts and bibliographic pages only; I did not read full texts). Marked [M] = from my memory of the literature or my own inference, treat as unverified. Numeric thresholds in the last section are my tuning guesses, not published values.

## Overview

Navigation research gives us a vocabulary and a set of measurable quantities. Lynch (1960) says a place is *legible* when people can build a mental image from five element types. Space syntax (Hillier, Hanson) shows that how people move is predicted by the topology of the space network, not by its geometry. Isovist and visibility-graph analysis (Benedikt, Turner) turn "what you can see from here" into numbers that can be computed on any generated map. Appleton (prospect-refuge) and the Kaplans (mystery) explain why some views feel good or inviting. For a game whose goal is to be memorable yet disorienting, these are two sides of one coin: the same measures that predict legibility tell us how to break it deliberately.

## Lynch: the five elements and legibility

[M] Lynch, *The Image of the City* (1960): **paths** (channels of movement), **edges** (linear barriers or seams that are not paths), **districts** (areas with a recognisable common character, entered "inside of"), **nodes** (junctions and concentrations, strategic foci one can enter), **landmarks** (point references seen from outside, often visible from afar). Legibility = how easily parts can be recognised and organised into a coherent pattern; "imageability" = the quality that evokes a strong image. Lynch also lists qualities that strengthen an element: singularity (figure/ground contrast), form simplicity, continuity, dominance, clarity of joint, directional differentiation, visual scope, motion awareness, names/meanings. Paths are the dominant organiser; people who are lost often lose the path structure first.

[V] Dalton and Bafna (2003, 4th Space Syntax Symposium, "The syntactical image of the city") restated all five Lynch elements using axial lines and isovists and proposed a link between *intelligibility* and *imageability*, tested on Boston c.1950. [V] A 2021 Eskisehir study (Megaron) combined Lynch-style image maps with axial analysis and found paths the most strongly perceived element, landmarks and nodes close behind, districts weakest. Takeaway: districts are the weakest memory carrier, so district identity must be built from layout and repetition, not just texture.

## Space syntax measures

[M] Axial map = fewest, longest straight sight-and-movement lines covering the space. Measures on it:
- **Depth / integration** (normalised mean topological depth from a line to all others, in turns not metres): integrated lines are few turns from everywhere; segregated lines are many turns away.
- **Connectivity** = number of lines crossing a line. **Choice** (betweenness) = how often a line lies on shortest routes.
- **Intelligibility** = correlation between local connectivity and global integration. High: what you see from where you stand (how many lines connect) predicts how central it is, so locals can infer the whole from the part. Low: local view misleads about global position. This is the key lever for "disorienting on purpose": generate a map with deliberately low intelligibility, i.e. well-connected dead zones and sparsely connected but central routes.
- [M] Empirically, movement flow correlates with integration (the "natural movement" result); people prefer long, straight, integrated lines when choosing, and reduce angular deviation at junctions (the angular/least-turn heuristic).

## Isovists and visibility graphs

[V] Benedikt (1979, "To take hold of space", *Environment and Planning B* 6) defined the isovist as the set of points visible from a vantage point and introduced isovist fields. [V] Turner, Doxa, O'Sullivan, Penn (2001, "From isovists to visibility graphs", *Env. & Planning B*) built the visibility graph (graph of mutual visibility between grid locations), implemented in UCL Depthmap.

[M] Per-point isovist measures: area, perimeter, **occlusivity** (length of occluding edges, i.e. boundary that is not wall, where unseen space begins), **jaggedness** (perimeter^2/area), **drift** (distance from vantage to isovist centroid), **min/max radial**, **openness** (share of rays that are free rather than blocked), **revelation / change**: how the isovist area and shape change between consecutive points along a path. Visibility-graph measures: **visual connectivity**, **clustering coefficient** (high = convex, cell-like space; low = "pivot" point seeing into several separate regions), **visual mean depth**, **visual integration**. These are computable from a plan grid with a few ray casts per cell; cost is fine for an offline generator pass.

## Why people get lost in buildings

[V] Carlson, Hölscher, Shipley, Dalton (2010, "Getting Lost in Buildings", *Curr. Dir. Psychol. Sci.* 19(5)) frame getting lost as an interaction of individual differences (spatial skill, strategy, experience) and building structure; the building shapes the cognitive map and mismatches produce errors; Seattle Central Library is their showcase of a hard-to-navigate building. [M] Findings from this literature (Hölscher, Weisman, O'Neill, Passini): floor-plan complexity (number of decision points, irregular angles), lack of visual access to distinct references, symmetric or repeated layouts, and **level changes** (vertical movement breaks the map into stacked 2D maps; people remember horizontal layout of one floor but poorly relate floors) are the main causes. Strong cues that help: a visible landmark, a long axis through the building, a distinctive node at decision points, and differentiated corridors. People lacking such cues fall back on "central point" and "direction" strategies (head toward the centre, keep going the same compass direction).

## Prospect, refuge, mystery

[V] Appleton's prospect-refuge theory (1975): comfort comes from seeing without being seen, i.e. views plus enclosure. [V] The Kaplans' information-processing framework adds **mystery** (the promise of more information if you move deeper, usually a partly hidden view); Hildebrand extended architectural use with enticement and complexity. [V] Quantitative tests (e.g. isovist studies of Frank Lloyd Wright houses) are mixed; mystery results are least conclusive. Treat these as design heuristics for mood, not laws. [M] Four Kaplan variables: coherence, complexity, legibility, mystery. Mystery requires legibility to be inviting; without legibility the same hidden view reads as threat.

## What this means for our game

**Measure it.** Run a post-generation analysis pass on the plan grid: (a) axial map and per-line integration; (b) intelligibility score; (c) isovist area sampled every ~1 m along the main routes; (d) decision-point count per route; (e) landmark visibility counts. Reject or re-roll seeds outside target bands, and expose the numbers in a debug overlay.

**Rhythm of tight and open (rules).**
1. Control *isovist area change* along a path, not just area. Alternate compression and release: after a stretch of low-area, low-occlusivity space (a tube, a narrow catwalk), land the player in a space whose isovist area is roughly 5-20x larger. Large jumps feel like revelation (prospect after refuge).
2. Never let two consecutive spaces have the same (area, occlusivity, height) triple; check this along every generated route.
3. Vary the *sectional* profile as well as the plan: a hall can be tall and narrow, wide and low, or split by a mezzanine. Same footprint, different isovist in 3D.
4. Keep occlusive edges (bends, offsets, pillars, half-walls) in open halls so they are never fully seen from one point; this supplies mystery. Fully convex halls are legible and dull; use them sparingly as rest nodes.
5. Decision points: aim for 1-2 per ~30 m in "legible" districts and 3-5 in "maze" districts; vary the branching degree (2-way bend, T, 4-way, 5+ star) and angle (non-orthogonal junctions feel different).

**Districts (make them by layout).** Give each district a distinct *spatial signature* from a small set of generator parameters: grid regularity (orthogonal vs skewed), mean axial line length (long sightlines vs chopped), tree vs loop topology, typical isovist area, ceiling height, and level count. Border districts with edges (a chasm, a bulkhead, a sealed vent wall) that are crossable at only a few points so district entry is felt.

**Landmarks.** Place 3-6 big visible landmarks (a stuck turbine, a dark tower, a lit shaft) as *global* references, but make them visible only along some axes, through gaps, so the player glimpses them and cannot walk straight to them. Landmarks should be seen from several districts at different angles (parallax gives bearing without distance), and the route to one should never be the straight one. Add many *local* landmarks (one-off props) at decision points, with different ones at each junction.

**Planned disorientation (use sparingly).**
- Lower intelligibility on purpose in the "maze" district: put high-connectivity junctions in peripheral dead pockets and chain few-line routes through the true core.
- Near-repeat: reuse a room layout 3-5 times with small changes (one prop moved, one door closed, lights out). Space syntax only sees the same graph, which is exactly why the player cannot tell them apart.
- Level shifts that break the 2D map: stairs that shift the plan 90 degrees, a ramp that returns above the start.
- Soft loops: a route that returns to a known node from an unexpected direction (the Lynch "node surprise").
- Slowly impossible space [M, from House of Leaves-style design, not this research]: interior measurably larger than the exterior; check via top-down minimap of bounding boxes.
- Never move landmarks silently while the player watches (unfair), but moving them when the player is in a tube or behind a closed door is a strong signature of the breaking world.

**Wrongness signals.** Sudden jump in isovist area with no visible cause; sightlines that end exactly at a corner with a light beyond; one axis that is 5-10 degrees off the grid; a route whose depth to the landmark seems short but takes many turns.

**Avoid.** Uniform grids everywhere (low differentiation, plain lost-and-bored); constant maximum disorientation (players give up; keep ~one clear anchor per 3-4 spaces, such as a lit sign or hum from a direction); level-wide symmetry; long featureless corridors without a visible end (frustration, not mystery); dead ends with nothing in them (reward every dead end with a small prop or vista); and relying on a minimap as the only wayfinding aid.

## Sources

- Lynch, Kevin. *The Image of the City*. MIT Press, 1960. (from memory)
- Dalton, R. and Bafna, S. "The syntactical image of the city: a reciprocal definition of spatial elements and spatial syntaxes." 4th Intl. Space Syntax Symposium, 2003. https://discovery.ucl.ac.uk/id/eprint/1104/
- Megaron 16(4): 644-658 (Eskisehir study of Lynch elements and axial analysis). https://gcris.ktun.edu.tr/bitstream/20.500.13091/1690/1/MEGARON_16_4_644_658.pdf
- Carlson, Hölscher, Shipley, Dalton. "Getting Lost in Buildings." Current Directions in Psychological Science 19(5), 2010, 284-289. https://eprints.lancs.ac.uk/id/eprint/138673
- Hölscher et al. / Carlson et al. "A spatial cognition framework for understanding wayfinding in buildings." EDRA 2011. https://eprints.lancs.ac.uk/id/eprint/138674
- Benedikt, M. "To take hold of space: isovists and isovist fields." Environment and Planning B 6(1), 1979, 47-65. https://ideas.repec.org/a/sae/envirb/v6y1979i1p47-65.html
- Turner, Doxa, O'Sullivan, Penn. "From isovists to visibility graphs." Environment and Planning B 28, 2001. https://discovery.ucl.ac.uk/id/eprint/160/
- Hillier, B. and Hanson, J. *The Social Logic of Space*, 1984; Hillier, *Space is the Machine*, 1996. (from memory)
- Appleton, J. *The Experience of Landscape*, 1975; Kaplan, R. and Kaplan, S. *The Experience of Nature*, 1989. (from memory, plus search summaries)
- Dawes and Ostwald, isovist studies of Frank Lloyd Wright houses; systematic review of prospect-refuge evidence (seen only as search summary).
