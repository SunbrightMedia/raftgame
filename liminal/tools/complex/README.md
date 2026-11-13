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

The lighting (deep export; `COMPLEX_DEEP` set):
- `check_lamps.py`: the game's own deferred-light step (ps_7913) for all 71 lamps of a frame, on its own G-buffer
  and depth, summed, against what the card added: median 0.06 % per pixel (base colour is read through an sRGB
  view: GBufferC). `ue_lamps.py`: our own Python of Unreal's point/spot light (inverse square + 1 cm^2, reach
  window, squared-ramp cone, Lambert + GGX / Smith-joint / Schlick): median 0.07 %, the same as the step.
  `check_uelight.py`: our GLSL (`src/engine/render/ueLight.ts`, used by the world shader) against that Python on
  the same G-buffer: median 5.5e-8. The 30 lamps whose reach touches cx_area_a (all ten frames' light constants)
  are `tools/recreate/cx-lamps.json`; no shadows, as in the game (their light reaches through walls).
- Fog (ExponentialHeightFog): black, density 2e-5 / cm at 10 cm, falloff 2e-4 / cm; our `fog.unreal` mode;
  checked against the game's own before / after pictures to half-float rounding.
- Bounce (Lumen) by measurement: `ingame.mjs` renders our map from a frame's camera (the complex camera's
  scene light, with and without the lamps' direct light), `compare_light.py` compares per surface. Direct light:
  1.00-1.04. Bounce: the hall wants more than a physical bake gives, the corridor less (Lumen most likely leaks
  bounce through the hall's walls from the lit rooms round it, not built here): 3 bounces x 1.06 splits it,
  hall 0.89, corridor 1.10 (whole view, with fog).

Our own camera pictures (the game's five image files are not copied; ours match their measured statistics):
- Glow shape: three blurs (1.7 / 6.3 / 32 px of a 1020-wide glow, weights 0.057 / 0.56 / 0.383) fitted to the
  game's kernel as its own lossless glow deconvolved by its own downsampled scene gives it (rms 0.0065 of the
  light within each radius); glow share 0.2, scene 0.8 (the game's buffers).
- Lens dirt: our own soft eight-sided bokeh discs; the game's dirt estimated losslessly (its tonemapper with flat
  dirt, three frames agree): mean 0.0105, spread 0.0133; ours 0.0109 / 0.0126.
- Grain: our own soft specks; the game's grain addition losslessly (grain step without its image, subtracted):
  mean 0.0021 / 0.0022 / 0.0092, spread 0.0085 / 0.0071 / 0.023, specks ~2 x 1.3 px; ours within ~10 %.
- Tape streaks: the screen after the lens traced back to the tape step's pixels (`ps_19327` run on a picture of
  coordinates; the lens reads by nearest pixel): grey, long along rows; ours: mean 0.00312 (game 0.00312),
  spread 0.0024 (0.0025), along-row correlation 0.86 (0.89), row spread 0.0021 (0.0021).
- The upscaler (TAAU, `cs_19050`): `check_taa.py` runs it on the exact inputs (frame, depth / stencil, motion,
  previous output, exposure) against the card's own output: mean equal to 0.04 %, median 0.04 % per pixel.
  `check_taa.py --ours` runs our own port (`src/engine/render/complexTAA.ts`) on the same inputs: vs the
  emulator 99.3 % of pixels bit-identical (18325); vs the real card, frames 18325 / 20732 / 19893: means equal to
  5 digits, 78 / 64 / 78 % of pixels bit-identical, 90 / 84 / 90 % of values identical, 4-7 % one half-float step
  either way, under 1 % further (a few dark pixels near (315, 1000) of 18325 by up to 10 %). The card stores half
  floats by cutting toward zero, not rounding (with rounding only 13.5 % were identical and the mean was 0.035 %
  high); the dither of up to one step is what makes that unbiased. Our shader cuts toward zero itself, so every
  card stores the same values.
- The upscaler in the game (renderer.ts + complexPost.ts): the scene is drawn at 70 % of the picture, moved each
  frame by Unreal's Halton 2, 3 jitter over 16 places (the deep frames' constants fit (frame + 2) mod 16), with
  no MSAA; the upscaler gets its depth and this frame's clip -> last frame's clip from our own camera. Checked
  headless (a still camera and a turn of 0.25 degrees a frame, against a 4x MSAA picture drawn at full size):
  the picture lines up within 0.02 px still and 0.04 px turning, and holds still (0.000 px between frames 32
  and 40). Not ported: the game's motion vectors of moving things and its "responsive" stencil (we draw none).
- The motion blur (Unreal 5's: velocity flatten `cs_9520`, tile scatter `vs_9521`/`ps_9522`, tile kinds `cs_9523`,
  filters `cs_9525` still / `cs_9526` even / `cs_9528` uneven; `cs_9527` is the "very fast" kind, off in the game's
  settings): ours is `src/engine/render/complexMotionBlur.ts`, checked by `check_mb.py` on the deep frames 18325 /
  19893 / 20732 against the card's own pictures: motion per pixel 99.8 / 99.7 / 99.8 % of values equal; the blurred
  picture 99.76 / 99.93 / 99.74 % (each step alone on the game's own input to it: 99.94 / 99.97 / 99.74 %); tile
  kinds equal the game's own dispatch counts (3328 + 2792, 4506 + 1614, 5812 + 308). The uneven filter does not run
  in those frames: `check_mb.py --uneven` runs the game's step in the emulator on made-up motion (near things 30x
  faster): ours equals it in 100 % of values (300 tiles, 62 % of their pixels changed). What the card does that the
  shader text does not say, found by these checks: it stores R11G11B10 by cutting toward zero (as its half floats);
  the blur reads the picture by nearest pixel (with a smooth read, 83 % equal; nearest, 99.97 %); and the tile
  step's reduction has no barriers in its last five steps, so the card's tiles miss some pixels (no fixed pattern:
  a race; ours takes the true shortest and longest, tile lengths within about 1 % of the card's). The blur's length
  follows the frame time (Unreal: amount / (target fps x frame time)); the deep frames' constants fit Unreal's
  defaults (0.5, 30) at 70-104 fps, which the game uses.
- The depth of field (Unreal 5's DiaphragmDOF, before the upscaler): the game's focus is 67.9 cm with blur at
  infinity 0.086 % of the width, the same in all ten frames, so everything past arm's length is a little soft.
  Ours is `src/engine/render/complexDOF.ts`: the steps that run with these settings (setup `cs_8836`, its own
  temporal step `cs_8837`, blur-size tiles `cs_19313` / `cs_19314`, reduce `cs_19315`, the slightly-out-of-focus
  gather `cs_8849`, recombine `cs_19317`). `check_dof.py` runs the game's own steps in the emulator on the deep
  export and ours on the same inputs: each step 95.6-100 % of values equal, 99.6-100 % within 0.1 %. The emulator
  needs the card's 8-bit filter weights (`Sampler(weight_bits=8)`): with exact float filtering the game's own chain
  matched the card in 57 % of values, with 8-bit weights 88 %. Against the card's output (19595), ours 86.8 % equal,
  96.2 % within 0.1 %, the same as the game's own emulated chain; the rest is the temporal step's history from
  earlier frames, which the export did not save. The picture changes by 0.93 % (ours) / 0.94 % (the card). In the
  game, our blur sizes in our room match the game's in the same view (median 0.368 px both). Left out: the
  near-field gathers (`cs_8844`, `cs_8848`), post filter, bokeh table and sprites: they need a near blur over 3.3
  half-size pixels (closer than about 11 cm to the lens), which our player cannot reach; in the frames they draw
  nothing.
- The glow: the game's is an FFT blur with zero padding (no light from outside the picture); ours now has that too
  (the band along the edges: 1.008 of the game's, against 1.072 before). Its shape is the game's own image (not
  copied). Fitted on the game's own input and output (frames 19893, 18325, 20732), no round kernel (3 or 9 blurs, a
  centre spike) or streaked one gets under 22-35 % per-pixel difference near bright lamps (7.6 % in 20732, which
  has none); the game's glow there has a star of 8 spikes, but a star of ours fitted to it lowers that only to 31 %
  of 32 %, so it is not added. Ours stays the round blur fitted to the measured spread.

Earlier, from the first export's JPEGs (superseded by the lossless numbers above):
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
