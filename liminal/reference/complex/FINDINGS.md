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

What the rebuild taught:
- **A warm multiplier before the tone curve**: the tonemapper multiplies the
  picture by a buffer we could not read. Fitting four frames gives
  0.84 / 0.83 / 0.64 (red / green / blue), the same in every frame. Part of
  the yellow is the camera after all.
- The glow picture was stored linearly (its true peak values prove it), so
  the glow is 0.19 as measured. The lens dirt adds about 40% on average:
  glow × (1 + 20 × dirt) with a dirt mean near 0.022. Our dirt is an even
  film with large soft variations; ours is not theirs.
- RenderDoc stored HDR pictures linearly when it stretched their range, and
  stored the window image with an extra sRGB curve.

## What this means for us

- Our "old camera" (digicam) and the Source post are the wrong models for
  this look. The new chain is short and exact: fixed exposure → whole-picture
  glow 0.19 with lens dirt → fringe 0.3 → vignette 0.4 → filmic curve with the
  defaults above → sharpen 7 → 25-step posterize → grain → tape → lens bend →
  4:3 with bars.
- The world must carry the colour: warm yellow paint, warm panel lights, dark
  ceiling tiles, real bounce light. No grading trick will make it.
- Camera: 98° wide (4:3) plus the bend, then motion blur when turning.
- We make our own noise and dirt textures (procedural or CC0); we do not
  take the game's.

## Not captured

Input textures (noise, dirt, materials) were not saved, by design. The
eye-adaptation result buffer was not saved either; the exposure was worked
out from the view's pre-exposure (34.13 = 0.18 × 2^15 / 172.8).
