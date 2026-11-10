# Braid mazes, loops, dead ends, and measuring how a maze feels

**Overview.** Maze research is overwhelmingly about *solving* difficulty: a start, a goal, and a score for how hard the path is to find. Our game has no goal cell. The player wanders, and the question is whether the space feels like a place you can get lost in without being punished for it. The useful part of the literature is therefore the vocabulary and the cheap graph metrics (dead-end share, run length, river, braid fraction, cyclomatic number). These let us measure a generator's output and tune it, rather than judge by eye. Verification note: items marked [V] were read from a source this session; items marked [M] are my own memory or reasoning and should be checked before being treated as fact.

## Perfect, braid, and partial-braid mazes

- A perfect maze is a spanning tree of the cell grid. It has exactly one path between any two cells and no loops. Cyclomatic number (independent loops) E - V + 1 = 0 [M, standard graph theory].
- A braid maze has no dead ends, only loops. Walter Pullen defines "slightly" and "heavily" braided by loop count, and "partial braid" as a mix of loops and dead ends. He notes a well-designed braid maze can be much harder than a perfect maze of the same size [V, astrolog.org/labyrnth/algrithm.htm].
- Jamis Buck's *Mazes for Programmers* treats this as a post-process on a perfect maze: first cull (sparsify) dead ends, then braid by linking surviving dead ends to a neighbour. A parameter p gives the proportion of dead ends removed, and p = 1.0 removes all [secondary summary of the book, not verified against the text]. Counting dead ends is simply counting cells with one link.
- Recipe for loops that I would use [M]: build a spanning tree, find every dead end, and with probability p knock out a wall from the dead end into a neighbour that is *not* its tree parent. Prefer the neighbour that is far away in tree distance. A loop is only interesting if the detour it replaces is long; a loop that shortcuts 4 cells is invisible. Then the cyclomatic number is roughly p times the original dead-end count.
- Unicursal labyrinth (one path, no choices) is the other extreme: 0% dead ends, solution through 100% of cells [V, Pullen's table]. Useful as a design pole, not as a layout: a pure unicursal path is a corridor, which we want in small doses (a tight, forced section).

## Measured numbers from generator families [V, Pullen's table, 100x100 orthogonal perfect mazes]

| Algorithm | Dead ends | Solution as % of cells |
|---|---|---|
| Recursive backtracker | about 10% | 19% |
| Hunt and Kill | about 11% | 9.5% |
| Recursive division | 23% | 7.2% |
| Binary tree / Sidewinder | 25 / 27% | 2.0 / 2.6% |
| Eller / Wilson / Aldous-Broder | 28 / 29 / 29% | about 4.5% |
| Kruskal / Prim (true) | 30% | 4.1% |
| Growing Tree | 10% to 49% by cell-selection rule | 11% |

Theoretical dead-end maximum for a perfect orthogonal maze is about 66% (a corridor with a one-cell stub on each side) [V]. Growing Tree keeps a list of live cells and picks one each step: always-newest gives the backtracker, random gives Prim-like behaviour, and mixed ratios (the demo offers 75/25, 50/50, 25/75) interpolate [V, Buck's blog]. The effect of the mix on dead ends is my inference [M]: more "newest" means longer winding passages and fewer dead ends; more "random" means more branching and more short stubs. This makes Growing Tree the best single generator to tune, because one knob sweeps the whole range.

## Pullen's qualitative metrics (all [V])

- **River**: how much a generator extends the current passage rather than branching. High river gives fewer, longer dead ends and long winding routes.
- **Run**: how far straightaways go before a forced turn. High run looks like a circuit board; low run looks random.
- **Elitism**: solution length versus maze size. Elitist mazes have short direct solutions, and can still be harder than non-elitist ones.
- **Bias**: whether straight passages favour a direction. Strong bias makes the maze easy to read "with the grain" and hard against it.

Wilson's and Aldous-Broder are the only unbiased uniform generators in his list [V]. For us, uniform is not a virtue: it feels the same everywhere, which is the exact failure the owner named. We want *deliberately non-uniform* bias, run, and river per region.

## Difficulty research and its limits

- McClendon's 2001 Bridges paper "The Complexity and Difficulty of a Maze" defines complexity from how quickly hallways change direction, and difficulty as a measure built on it. Example values quoted are 3.3, 12.5, and 14.7 for three mazes [V from search summary; I could not open the PDF, so the formula itself is unverified].
- A later literature review argues complexity is nearly equivalent to solution length and is not a satisfactory measure of the pleasure of solving [V from search summary of the Earlham maze literature review]. Researchers also note computer-solver difficulty need not match human difficulty [V].
- The clinical Porteus maze scores difficulty by typical number of failed attempts [V]. That is the only human-facing measure I found: count wrong entries, not path length.
- Space syntax gives better wandering metrics [V for definitions]: *mean depth* (average steps from a space to all others) as integration, and *intelligibility*, the correlation between local connectivity and global integration, i.e. how well what you can see from a spot predicts the rest of the system. Studies find mean depth of the entry affects how a building is explored, and that multi-level buildings are notably hard to navigate (Passini, 1992).
- Not found: any study tying McClendon's score to how often humans get lost. Treat all difficulty numbers as proxies.

## A usable metric set for a wanderer's maze [M, my synthesis]

Measure on the room/junction graph the generator emits, not on raw cells:
1. **Dead-end ratio** = junction nodes of degree 1 / all nodes.
2. **Cyclomatic number** mu = E - V + C (C = components); report mu / V as "loop density".
3. **Mean corridor run** = average edges between decision nodes (degree >= 3), and its variance. Low variance equals monotony.
4. **Branching factor** = mean degree of decision nodes.
5. **Mean depth / diameter** from the spawn, and the ratio of diameter to sqrt(V) (a crude "river" measure).
6. **Decision gap**: path length the player walks between consecutive choices. Plot its histogram per region.
7. **Region distinctness**: compare metric vectors (1-6) between regions; fail the build if two neighbouring regions are within a small distance.

## What this means for our game

**Targets (starting points to tune, not research results):**
- Whole-world loop density mu/V around 0.15 to 0.35, so the world is mostly tree-like with enough loops that retracing is rare and re-encountering a landmark from a new direction is common. Vary by region from 0 (pure tree, a labyrinth wing) to about 0.8 (a braided plaza of interchangeable bays).
- Dead-end ratio 10% to 25% overall, but concentrated: a region of 5% (braid) next to a region of 40% (stub-heavy, backtracker-hostile). Never uniform.
- Decision gap: a deliberate mixture. About 40% of runs short (under 15 m), 40% medium (15 to 60 m), 20% long (over 100 m, an uninterrupted catwalk or tube). Long runs are where the world gets to show its scale, and the wrong thing to randomise away.
- Per-region generator parameters, not global: Growing Tree newest/random ratio from 90/10 (long twisting river) to 20/80 (branchy), plus a run bias that forces straight spans in one region and bends in another. This alone makes layout, not texture, the differentiator.

**Dead ends must pay out.** A dead end with nothing in it teaches the player that choices are random. Rotate end types: (a) a vista over a void or a stack of chambers, (b) a small shelter or scrap nest, (c) a sealed door or hatch that matters later (future world exits), (d) a loop-back secret: a one-way drop or ladder to a lower level, so it was not a dead end, (e) a lore object, (f) honest nothing, rarely, with a wrongness cue. Target 1 in 6 dead ends as honest nothing.

**Loops with a twist.** Close loops across *levels* rather than in plan: a stair or ladder that returns to a catwalk you already saw from below. Vertical loops are cheap to build, hard to map mentally (multi-level buildings are hard to navigate per Passini), and fit the five-level catwalk structure. Make the loop longer than 40 m so it reads as a discovery.

**Pacing.** Alternate tight (unicursal, enclosed, low sightlines) and open (many visible exits, long sightlines) every 60 to 120 s of walking. After an open hall, give a forced corridor of at least 30 m with no choices; after a long corridor, give a junction with three or more options.

**Measure, then tune.** Write the generator to emit the node graph and a JSON metrics report per seed; run 200 seeds in CI; reject seeds whose distributions fall outside bands. Same seed, same report. Do not tune by looking at a single map.

**Wrongness.** Use rare deliberate violations of the metrics as chaos: a loop that returns to a *slightly different* copy of the junction you left (near-duplicate cells with one changed prop), a corridor whose run length is exactly the same three times in a row, a dead end whose far wall is a seam of the same texture as the entrance. Keep these below roughly 3% of nodes or they become noise.

**Avoid.** Uniform generators (Wilson, Aldous-Broder) used globally; a single global dead-end percentage; loops that save under 5 steps; dead ends that are all identical; navigation aids that make everything legible (intelligibility should vary: some regions readable from their middle, some not).

## Sources

- Walter Pullen, "Maze Algorithms / Maze Metrics": http://www.astrolog.org/labyrnth/algrithm.htm (fetched; dead-end table, river, run, elitism, bias, braid definitions)
- Jamis Buck, "Maze Generation: Growing Tree algorithm": https://weblog.jamisbuck.org/2011/1/27/maze-generation-growing-tree-algorithm (fetched)
- Jamis Buck, *Mazes for Programmers* (Pragmatic Bookshelf, 2015), sample: https://media.pragprog.com/titles/jbmaze/first.pdf (search result only; braid/cull described via secondary summaries)
- Michael Scott McClendon, "The Complexity and Difficulty of a Maze", Bridges 2001: http://t.archive.bridgesmathart.org/2001/bridges2001-213.pdf (fetch failed with 503; description from search summary)
- Earlham College, "A Literature Review of Maze Generation Guided by Difficulty Scoring": https://portfolios.cs.earlham.edu/wp-content/uploads/2022/01/MazeLitReview.pdf (search summary only)
- Space syntax intelligibility and mean depth: arXiv 0709.4356 "City Space Syntax as a Complex Network"; Georgia Tech paper re-reading Lynch's elements via space syntax, 4th Space Syntax Symposium (search summaries only)
- Passini (1992), wayfinding in multi-level buildings (cited second-hand via a search result)
