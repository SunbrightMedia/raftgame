# tools/complex: exact checks against The Complex's own compiled steps

The user asked for The Complex's camera and lighting "100% accurate". The capture (branch
`complex-capture`, see `reference/complex/`) holds every step's compiled shader (DXBC, as RenderDoc
disassembles it) and its numbers. These tools run those steps as the reference, and compare our own
re-written code with them number for number. Study only: nothing of the game goes into the game; our
code is our own, written from what the steps compute.

- `dxbc.py`: runs DXBC on numpy arrays (all pixels or threads in lockstep, masks for flow, float32
  with fused multiply-add, our own texture sampling and storage formats). `test_dxbc.py` checks its
  semantics on small hand-written programs.
- `capture.py`: a captured frame's steps, shaders, constants and pictures as inputs for `dxbc.py`.
- `check_tone.py <frame dir>`: our tone table (`src/engine/render/complexTone.ts`, dumped by
  `dump_tone.ts`) vs the game's CombineLUTs step. Result (frame 18325): with exactly rounded
  exp2/log2 in the emulator, all 98,304 values equal to the last bit; with float32 exp2/log2 (as a GPU
  has), 7 of the stored 10-bit values differ by one step. That last-bit difference also differs between
  graphics cards.
- `trace_tone.ts`: our tone cell's intermediate values, for tracing a difference step by step against
  `dxbc.Machine.run(trace=...)`.

Limits, said plainly:
- The first export's disassembly prints float numbers with 6 decimals. `dxbc.py` snaps them to simple
  values (p/q with q <= 64, powers of two >= 0.001) when one prints the same; others stay as printed.
  Our code uses the same numbers, so the checks compare like with like. `complex_deep.ps1` now saves
  each shader's bytes; with them, both switch to the exact numbers.
- Four camera inputs are the game's own image files (glow kernel, lens dirt, two noise images). By the
  user's rule they are not copied; ours match their measured statistics only.
- Lumen (the bounce light) is not copied; its result is matched per surface.
