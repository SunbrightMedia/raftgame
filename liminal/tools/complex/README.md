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
  `dump_tone.ts`) vs the game's CombineLUTs step. Result (frame 18325, exact numbers): with
  exactly rounded exp2/log2 in the emulator, all 98,304 values equal to the last bit; with numpy's float32
  exp2/log2, 0 of the stored 10-bit values differ. (The step's printed "0" and "1" entries are not exactly
  0 and 1: the blue-correction matrices hold 1e-10-sized entries and 0.9999996, the saturation clamps at
  1e-10, and its 1 / 1.05 is 0.952381, one step above.)
- `check_camera.py <frame dir> [pass ...]`: our camera passes (`src/engine/render/complexCamera.ts`, run
  in headless Chromium by `run_camera.cjs` + `camera_page.ts`) vs the game's own steps, same inputs (ours,
  made from seeds; rounded to their storage). Stored 10-bit values equal (frame 18325, exact numbers from
  the deep export): tonemapper 99.994 % without its dither (the dither is random by design: same statistics,
  other pixels), sharpen 99.999 %, posterize 100 %, grain 99.98 % (clock 0; at the capture's clock, 75.6 s,
  the moving noise sits near UV 680 where float32 cannot place a sample exactly: 90 %, up to 6 steps, on any
  GPU), tape 97.5 %, lens 99.997 %. The rest: float rounding of the software GPU (SwiftShader) vs the
  emulator; the tape's per-pixel sine takes arguments up to ~60000 radians, which SwiftShader computes
  loosely (on the user's PC the game and our WebGL use the same hardware sine). The lens's per-frame numbers
  (k = sin(atan(diag / f))) are computed once on the CPU in float32 (`lensConstants`).
- `check_real.py <frame dir>` (needs the deep export): against the REAL graphics card's pictures, not the
  emulator. Our tone table vs the 3D table the game drew: 97.2 % equal, the rest 1 step (that card's own
  exp2 / log2 rounding). Sharpen and posterize, fed the picture the game's step really read, vs what it
  really wrote: sharpen 95.8 %, posterize 99.3 % (ours and the emulated step give the same numbers). Most
  of the rest are 1-step store differences; a few areas (0.3 % of values) disagree more, also between the
  saved pictures themselves (not explained yet). Two facts this showed, now in our code: the game's
  post-process materials read their input picture by NEAREST pixel (sharpen 17 % -> 95.8 % equal; lens
  mean difference 11.4 -> 3.2 steps, the rest being the tape's missing streak images), and the card stores
  10-bit values with ties going down (0.5 -> 511).
- `trace_tone.ts`: our tone cell's intermediate values, for tracing a difference step by step against
  `dxbc.Machine.run(trace=...)`.
- `dxbc_bytes.py`: the exact numbers in a shader's bytes (DXBC token stream: immediates and the immediate
  constant buffer), lined up with the disassembly's instructions.
- `deep.py`: the deep export's lossless pictures (R10G10B10A2, R11G11B10, half and full floats; 3D tables)
  and data buffers as numpy arrays.
- `fit_apply.py <frame dir> [...]`: the scene multiplier the glow step hands the tonemapper (the first
  export could not read that buffer), fitted with the game's own tonemapper on the game's own scene and glow.
  Result: red 0.765 / 0.771, green 0.752 / 0.757 (frames 18325 / 20732). The deep export then gave the true
  value, 0.8 in every colour: the fit (JPEG inputs, flat lens dirt) came out 4 % low. The stored scene and
  glow are already exposed: an earlier version multiplied them by the exposure again (34x too bright).
- `dump_standins.ts OUT_DIR`: writes our stand-ins for the game's image files (`standInImages()` in
  `complexPost.ts`) as raw RGBA8, to compare them with what the game's images do in the capture.

Measured against the capture (frame 18325; the game's own step with an image, minus the same step without it):
- Glow: the game's glow holds 0.19 of the light (our three blurs held 0.16; the deep export gave the exact
  share, 0.2, now the default). The light
  spread by distance (Wiener deconvolution of the game's glow by its own downsampled scene) follows ours to
  64 glow pixels; the game has a little more far glow.
- Grain: the same average as ours, but it varies about 4x more and is coarser. The grain repeats every
  320 x 240 screen pixels (tiled 4.5x), so the part that repeats is free of the capture's JPEG noise: std
  0.0065 / 0.0064 / 0.0086 there, ours 0.0015 / 0.0015 / 0.0017 through the same JPEG. Our stand-in needs
  stronger, larger specks (statistics only: the game's image is not copied).
- Tape streaks: the same average as ours; the variation is harder to separate from JPEG noise.

With the deep export (branch `complex-capture`, folder `deep`; set `COMPLEX_DEEP` to the folder holding its
`complex_frame*` folders), `capture.Frame` takes every shader number from the shader's bytes
(`dxbc_bytes.py`: 13,249 numbers in 188 shaders; 1,173 had been printed inexactly, and snapping had fixed
only 81) and every constant from the blocks' own bytes (the first export rounded those to 6 significant
digits: 1 / 1440 read 0.000694, which moved samples by up to a pixel). `deep.py` reads its lossless
pictures and buffers. From the buffers: exposure 34.1333, scene share 0.8 and glow share 0.2 in every
colour (frames 18325, 20732, 19893), glow kernel totals equal in red, green and blue.

Limits, said plainly:
- Five camera inputs are the game's own image files: glow kernel (bound only as its FFT, 2048 x 1026 float),
  lens dirt (5184 x 3456), grain (1400 x 1050), tape streak noise (944 x 1260, BC1) and tape band (512 x 512,
  10 mips). By the user's rule they are not copied; ours match their measured statistics only, and making
  our own versions is for later (the user's call).
- Lumen (the bounce light) is not copied; its result is matched per surface.
