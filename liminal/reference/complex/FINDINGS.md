# The Complex: Expedition — how its picture is made

Study only. Nothing from the game (files, textures, code) goes into our game;
we rebuild the look with our own code and our own textures.

Source: branch `complex-capture` (the user's PC: RTX 3070, 1920×1080 window),
10 frames saved with RenderDoc 1.47 and `complex_export.py`. The game is
**Unreal Engine 5** on **D3D11**, with **Lumen**. All 10 frames have the same
camera settings, so everything below is fixed by the game, not by the scene.

## Read this first: the saved finals are too bright

RenderDoc saved the window image (`final.jpg`, and every picture of the
swapchain) with one extra sRGB encode, so they look washed out. The real
picture is the sRGB decode of them. Checked: the decoded swapchain equals the
lens pass applied to pass 419's output, within JPEG noise (mean abs error
0.015). `true_final.py` makes the corrected pictures from the branch.

Levels of the 10 corrected frames (luminance, 0–1 display values):

| frame | p1 | p50 | p95 | p99 | mean R G B |
|---|---|---|---|---|---|
| 18325 | 0.21 | 0.44 | 0.75 | 0.94 | 0.53 0.48 0.11 |
| 18829 | 0.21 | 0.45 | 0.70 | 0.74 | 0.58 0.47 0.11 |
| 19259 | 0.15 | 0.47 | 0.75 | 0.94 | 0.54 0.48 0.12 |
| 19893 | 0.17 | 0.47 | 0.64 | 0.76 | 0.56 0.48 0.10 |
| 20169 | 0.12 | 0.43 | 0.64 | 0.67 | 0.48 0.45 0.07 |
| 20732 (dark hall) | 0.03 | 0.16 | 0.39 | 0.41 | 0.22 0.17 0.04 |
| 21167 | 0.17 | 0.47 | 0.68 | 0.76 | 0.57 0.47 0.11 |
| 21636 | 0.03 | 0.21 | 0.50 | 0.71 | 0.29 0.25 0.06 |
| 22347 | 0.08 | 0.39 | 0.65 | 0.77 | 0.47 0.40 0.07 |
| 22820 (dark) | 0.03 | 0.07 | 0.28 | 0.79 | 0.14 0.11 0.05 |

## The chain, in order

1. **Frame**: 4:3 picture (1440×1080) in the middle of the 16:9 window, black
   bars left and right.
2. **Camera**: 98.2° across, 81.8° up-down (projection 0.8657 / 1.1543). Very
   wide; the lens pass (step 12) then zooms the middle.
3. **Resolution**: drawn at 70% (1008×756) and brought up to 1440×1080 by TSR
   (temporal upscaling): soft, steady detail.
4. **Light**: Lumen bounce light (software tracing, surface cache), 71 ceiling
   panel lights drawn as deferred lights in a typical room, shadow maps.
   Materials are high-resolution photos: 4096² colour and normal maps, one
   4000×3000 photo texture.
5. **Exposure is fixed.** Auto exposure min = max (172.8), exposure bias
   2^15; the result is a constant scale of 34.13 (the engine's pre-exposure).
   The camera never adapts: dark halls stay dark (frames 20732, 22820).
6. **Motion blur**: the engine's camera motion blur is on (velocity tiles
   63×48, full-resolution filter).
7. **Bloom**: FFT convolution bloom on the **whole** picture (no threshold).
   Measured by dividing output by input in 5 frames: the glow adds back
   **0.19×** the picture's energy (0.189–0.198). 55% of the glow lies within
   ≈ 17 px of its source (at 1440 px across), 68% within ≈ 28 px, 84% within
   ≈ 70 px, a faint halo to ≈ 280 px. A weak vertical streak may be in the
   kernel (not certain). The glow is multiplied by **(1 + 20 × dirt)**, where
   dirt is a lens-dirt photo (5184×3456): smudges light up near bright areas.
8. **Tonemapper** (one pass, in this order):
   - Chromatic aberration (scene fringe 0.3): red sampled at
     `p·(1 − 0.003087)`, green at `p·(1 − 0.001781)`, blue at `p`, with `p`
     the centred screen position (−1…1); start offset 0. At the side edges
     that is 2.2 px (red) and 1.3 px (green) towards the middle.
   - `x = scene + glow × (1 + 20·dirt)`, times the exposure (fixed, see 5).
   - Vignette 0.4, cos⁴ law: `v = s·0.4`, `mask = 1/(1+|v|²)²`, where `s` is
     the centred position scaled so the corner is √2 long:
     `s = (px, py·0.75) · √2/√(1+0.75²)`. Corners get 0.57, side edges 0.69,
     top/bottom edges 0.80.
   - Tone curve via a 32³ table. **The grading is neutral**: saturation,
     contrast, gamma, gain, offset all 1/0 for shadows, mid, highlights; white
     balance 6500 K, tint 0; no extra LUT textures. The curve is the engine's
     default filmic curve: slope 0.88, toe 0.55, shoulder 0.26, black clip 0,
     white clip 0.04, blue correction 0.6, expand gamut 1, sRGB output, gamma
     2.2. **So the yellow is in the world (lights and paint), not in the
     grading.**
   - Table lookup with `log2(x + 0.002668)/14 + 0.6107`, result × 1.05, plus a
     dither of ±1/512.
9. **Custom pass A — sharpen.** Luma unsharp mask, **amount 7**, sampling ±1
   px (0.001 of the view) up, down, left, right:
   `d = c − (u+d+l+r)/4; c += dot(d·7, (0.30, 0.59, 0.11))`. Edges get thin
   bright and dark rims.
10. **Custom pass B — posterize.** `c = round(c·24)/24` per channel: 25
    steps, banding in smooth gradients.
11. **Custom pass C — grain.** Adds `0.2 × noise`, the noise a 1400×1050
    image tiled 4.5× over the view and jumped by `time·(9, 4)` each frame.
    Measured effect: +0.002 R, +0.002 G, +0.008 B on average, peaks +0.05;
    fine and slightly blue.
12. **Custom pass D — tape.** Four parts:
    - Hue wobble: rotate the colour around the grey axis by
      `0.1047·sin(0.5236t)·sin(0.1745t)·sin(0.1047t)` radians (at most ±6°,
      slow).
    - Lift: `c = c + (1 − c)·0.018` (black sits at 0.018).
    - Line chroma: each pixel row gets a random wave (re-rolled 50 times a
      second, random frequency along x) between magenta (2, 0, 1) and green
      (−1, 1, 0), mixed in at **1.2%**: about ±1.8% red, ∓0.6% green and blue
      per row.
    - Streaks: add `0.3 × n × s(1 − s)`, where `n` is a noise image (tiled 2×,
      moving `time·(9, 0.05)`) and `s` a second image stretched 10× along x
      and moving `time·3`.
13. **Lens** (output pixel → input). With `W, H` = view size, `a = 0.7 ×
    98.2°` (1.2002 rad), `f = W / tan a`, `diag = √(W²+H²)`,
    `k = sin(atan(diag/f))` (0.955):
    `p = ndc · (1, H/W) · W/diag` (corner = 1), `q = k·p`,
    `θ = asin(|q|)`, `in = (θ/a) · q/|q| / (1, H/W)`.
    The middle is magnified 1.57×, the side edge shows the input at 72%, the
    corner at 85% (barrel bend). Checked against the game's own output: best
    fit exactly at `a = 0.7·FOV` (error 0.015 vs 0.048 at 0.6 and 0.051 at
    0.8).

## Checked by rebuilding it (camera model "camcorder")

`src/engine/render/camcorder.ts` is our rebuild. The test bench
(`tools/camcorder/check.html`, `run.cjs`, `compare.py`) feeds the game's own
captured scene picture into it and compares every stage with the game's:

| frame | after tone curve | finished picture | mean colour, ours / game |
|---|---|---|---|
| 18325 (lit room) | 0.023 | 0.034 | 0.526 0.483 0.101 / 0.526 0.481 0.113 |
| 20732 (dark hall) | 0.008 | 0.016 | 0.216 0.173 0.040 / 0.218 0.174 0.043 |

(mean absolute error per pixel, 0–1; grain and tape noise are random, JPEG
adds the rest). Frame 19893's scene picture was saved over a 0–40 range, too
coarse for this test.

**Re-checked 2026-11-12** (today's code, default settings): the same numbers (18325: tone 0.024, finished
0.035; 20732: 0.009, 0.016; mean colour within 0.002). What this check can and cannot show:
- Its input is the capture's scene picture, which RenderDoc saved as a JPEG (quality 85) of an 8-bit
  stretch of the HDR picture. Our tone curve and the ×7 sharpen amplify its blocks and steps: in the lit
  room ours has 1.4× the game's fine detail already after the tone curve (where nothing adds detail) and
  1.7× after sharpening (`tools/camcorder/detail.py`). The bench's side-by-side looks harsher than the game
  for that reason. In the game the camera gets a clean float picture.
- The sharpen step alone, run on the game's own tone-stage picture (`tools/camcorder/sharptest.py`), raises
  fine detail ×5.01 (ours) vs ×5.31 (game) on 18325 and ×5.05 vs ×5.17 on 20732: the formula is right.
- So the chain is matched by measurement, on two frames, as closely as JPEG pictures can show. It is not
  proven exact: the warm multiplier, the glow's shape and the upscaler softness are fitted, and the lens
  dirt, grain and tape noise are ours.

What the rebuild taught:
- **A warm multiplier before the tone curve**: the tonemapper multiplies the
  picture by a buffer we could not read. Fitting four frames gave
  0.84 / 0.83 / 0.64 (red / green / blue), the same in every frame. Part of
  the yellow is the camera after all. Blue was later raised to **0.75**: with
  0.64 the mean blue came out ~10% low on 18325 and 20732 (0.101 vs 0.113,
  0.041 vs 0.043) and on the frame-19893 rebuild; with 0.75 all three match
  (0.111 / 0.113, 0.042 / 0.043) and the per-pixel error is unchanged.
- The glow picture was stored linearly (its true peak values prove it), so
  the glow is 0.19 as measured. The lens dirt adds about 40% on average:
  glow × (1 + 20 × dirt) with a dirt mean near 0.022. Our dirt is an even
  film with large soft variations; ours is not theirs.
- RenderDoc stored HDR pictures linearly when it stretched their range, and
  stored the window image with an extra sRGB curve.

## The camera, exact (camera model "complex", 2026-11-13)

The capture holds every camera step's compiled shader (DXBC) and numbers. `tools/complex/dxbc.py` runs
them; our own code for each step is compared with them on the same inputs (`tools/complex/`):

| step | ours vs the game's step (stored 10-bit values equal) |
|---|---|
| tone table (CombineLUTs, 32^3) | all 98,304 floats equal to the last bit (exactly rounded exp2/log2) |
| tonemapper | 99.994 % (without its random dither; dither statistics equal) |
| sharpen / posterize / grain / tape / lens | 99.85 / 99.99996 / 99.97 / 97.4 / 99.91 % |

The rest differ by one step (float rounding, texture filtering of the software GPU). Found on the way:
- The warm multiplier is the glow step's `FinalizeApplyConstants`: scene x (1 - 0.2 x the share the glow
  kernel spreads) x the kernel's own colour, from 16 numbers (`Bloom.FFT.KernelConstants`). Glow share =
  the rest of the same colour. The deep export saves those numbers.
- The tone curve is a 32^3 10-bit table in log space (x 1.05 after, dither +-1/512), not the analytic
  curve the camcorder model used; with it, blue matches at the first fit (0.64) instead of 0.75.
- Pictures between camera passes are 10-bit; the scene and glow are R11G11B10 floats.
- The game's streaks add only +0.003 / 0.003 / 0.002 (measured: its tape step run with the streak images
  off, subtracted from its output); grain +0.0022 / 0.0024 / 0.0081.
- Steps after the lens (423-426) are UI drawing (a blurred-background panel), not camera.

Still stand-ins in the "complex" model: the glow's shape (the three-width fit), the upscaler (TAAU, a
blur stands in), motion blur; and our own lens dirt and noise images (the game's are its own files).

## Rebuilding the capture's area (map `cx_area_a`)

The rebuild checks our light against the capture with nothing fitted per frame. Tools
(`tools/recreate/`): `measure.py` turns a frame's own depth and G-buffer into the room's planes,
panels and materials at true size; `cx-area-a.ts` builds the map; `cx.ts` holds everything shared
(materials, lamps, units, camera, light model); `frames.json` has each frame's camera pose and tape
clock; `compare.py` with `regions/<frame>.json` compares a render with the capture.

What the frames' own buffers showed:

- **True size from depth.** The motion-blur step keeps linear depth in cm (its "Velocity
  Flatten" picture, blue channel): the floor rows all give the same eye height, 161 cm (63.3"),
  in every frame. Rooms are 4.04 m (159") high. (The first rebuild of frame 19893 guessed the scale
  from 60 cm ceiling tiles and came out at 0.62×; tiles and panels are really about 92 cm.)
- **One area.** The view constants give each camera's world position (a row of the view
  constants and its negative, the pre-view translation), so all ten frames share one set of world
  coordinates. Frames 18325, 18829 and 19259 were taken in one hall (624" × 546", a 3 × 3 grid of
  panels), 19893 and 20169 in the corridor south of it (19893's "alcove" is the hall's south
  recess), the others further west and south. `measure.py --world` lines them up within an inch.
- **The lamps** sit 8 cm under the ceiling (235 cm above the eye in every frame). Two read lamps
  of the hall stand at its panels, with constants "10000": that is red 1 cd (the constants carry
  cd × 100² for centimetres), so luminance 0.8635 cd, colour (1, 0.871, 0.386). Other lamps differ:
  one at 8000 (18325), a dim red point light near the floor (21167). Every lamp in a frame is drawn
  unshadowed (14 to 73 per frame), so lamps in neighbouring rooms light through walls; the first
  export kept only one lamp per frame, hence `complex_deep.ps1`.
- **Units.** With lamps in those units and the game's own exposure (34.13; in our rebuilds both
  scaled by 1000 to stay clear of the baker's 0.02 lux cutoff), the hall comes out right without
  fitting anything: walls 0.84 to 0.93 of the capture, floors 0.91 to 1.09, panels and boxes 0.95
  to 1.02. The panels are dim emitters, about 2.9 in the tone curve's input units (88 cd/m² in
  ours).
- **Bounce.** In the hall the game's bounce light (pass "DiffuseIndirectComposite" / base colour)
  is floor 0.18, walls 0.30, ceiling 0.35. Our physical bounce (2 passes + the remaining-bounce
  term, the engine's default) gives 0.21 / 0.22 / 0.32; an "even" bounce (as if gathered by probes
  in the air, `light.bounceEven`) gives 0.19 / 0.19 / 0.17 and was wrong: it only seemed right in
  the first, mis-scaled rebuild of 19893. Kept as an option, not used.
- **Materials** (G-buffer B: metallic / specular / roughness): walls 0 / 0.5 / 1 (F0 0.04), carpet
  0 / 0.3 / 1 (F0 0.024), tiles 0.01 / 0.086 / 0.58, box cloth 0 / 0.5 / 0.87. Base colours: paint
  #f0ec81, carpet #a39644, tiles #a29d78, cloth #6a716e, floor tape #f0ce22, door #1b1d1c.
- **Fog** is on but black (dims far surfaces ~1%); **depth of field** blurs under one pixel.
- **The clock**: the tape pass reads the game time (frames.json); the same time makes the walls'
  red/green balance match.
- **Softness**: the game's upscaler leaves edges softer than ours; 0.7 px matches them across x
  (along y frames differ with the camera's motion).

Result, all from one map with the shared settings (region brightness ours / capture):

| frame | walls | floor | ceiling | panels | whole-picture error |
|---|---|---|---|---|---|
| 18829 (hall) | 0.84 – 0.93 | 1.07 – 1.09 | 0.84 | 0.98 – 1.00 | 0.049 |
| 18325 (hall) | 0.88 – 0.91 | 1.00 – 1.05 | 0.80 – 0.84 | 0.95 – 0.98 | 0.055 |
| 19259 (hall) | 0.87 – 0.92 | 0.91 – 1.06 | 0.79 | 0.98 – 1.00 | 0.057 |
| 19893 (corridor) | 1.20 – 1.37 | 1.46 | 1.77 | 1.01 | 0.114 |
| 20169 (corridor) | 0.37 – 0.38 | 0.23 – 0.29 | 0.65 | – | 0.213 |

Open:
- The corridor's lamps are not known (only two panels show, one ceiling panel is switched off,
  the west part is lit by lamps out of view): 19893 is too bright, 20169 far too dark. The deep
  export lists every lamp.
- In the hall, walls and ceilings are 10 – 20 % dark and floors up to 9 % bright, the same in all
  three frames: our direct light favours the floor and our bounce gives the walls less than the
  game's. The 8-bit captures are too coarse on the floor to split direct from bounce exactly; the
  deep export's lossless buffers can.
- Not modelled: the hazmat figures, the tripods, a rifle on a box.

## What this means for us

- Our "old camera" (digicam) and the Source post are the wrong models for
  this look. The new chain is short and exact: fixed exposure → whole-picture
  glow 0.19 with lens dirt → fringe 0.3 → vignette 0.4 → filmic curve with the
  defaults above → sharpen 7 → 25-step posterize → grain → tape → lens bend →
  4:3 with bars.
- The world must carry the colour: warm yellow paint, warm panel lights, dark
  ceiling tiles, real bounce light. No grading trick will make it.
- Its lighting is game lighting, not physics: dim panel surfaces, separate
  unshadowed spot lights of about 1 cd, a fixed exposure of 34.13; bounce close
  to physical.
- Camera: 98° wide (4:3) plus the bend, then motion blur when turning.
- We make our own noise and dirt textures (procedural or CC0); we do not
  take the game's.

## Not captured

Input textures (noise, dirt, materials) were not saved, by design. The
eye-adaptation result buffer was not saved either; the exposure was worked
out from the view's pre-exposure (34.13 = 0.18 × 2^15 / 172.8).
