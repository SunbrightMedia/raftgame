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
- `check_camera.py <frame dir> [pass ...]`: our camera passes (`src/engine/render/complexCamera.ts`, run
  in headless Chromium by `run_camera.cjs` + `camera_page.ts`) vs the game's own steps, same inputs (ours,
  made from seeds; rounded to their storage). Stored 10-bit values equal (frame 18325's constants):
  tonemapper 99.994 % without its dither (the dither is random by design: same statistics, other pixels),
  sharpen 99.85 %, posterize 99.99996 %, grain 99.97 % (clock 0; at the capture's clock, 75.6 s, the moving
  noise sits near UV 680 where float32 cannot place a sample exactly: 89 %, up to 6 steps, on any GPU),
  tape 97.4 %, lens 99.91 %. Every other difference is one 10-bit step: float rounding and texture filtering
  of the software GPU (SwiftShader) vs the emulator.
  The lens's per-frame numbers (k = sin(atan(diag / f))) are computed once on the CPU in float32
  (`lensConstants`): SwiftShader's sin/cos are only accurate to ~1e-4, which moved corner samples by 0.2
  texel.
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
