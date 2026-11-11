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

## Rebuilding frame 19893 (map `cx_frame4`)

`tools/recreate/cx-frame4.ts` rebuilds the room of frame 19893 (measured from
its G-buffer) and `tools/recreate/compare.py` compares our render with the
capture. Going through the frame's own buffers taught more than the picture:

- **The panels are dim.** At the tone curve's input (pass 394, after the
  upscaler) a ceiling panel is 3.0 / 2.55 / 1.66, the lit right wall 0.42 /
  0.31: the panel is only ~7× the wall, colour (1, 0.85, 0.55). (The 115 and
  40 peaks of the scene pictures are a few hot pixels elsewhere.) A real LED
  panel would be ~40× and glow 5× too much around itself; this was the main
  error of the first rebuild. Same in every frame that shows a panel (8 of
  10): its brightest pixels end at about 0.96 / 0.95 / 0.93 in the final
  picture and never clip (at most 0.0025% of pixels reach 0.98).
- **The room's lights cast no shadows.** The frame draws its 14 lights as
  "BatchedLights" and has no shadow-map passes at all, so light passes through
  the soffit onto the wall under it and the alcove's face. Lumen shadows only
  its own bounce light (the 95 "Non raytraced shadows" dispatches of its
  surface cache). Our `spot` lights take `shadows: 0` for this. Same in all
  10 frames: 14 to 73 lights, all batched, no shadow passes.
- **Lumen's bounce is weak and even.** Pass 363 (bounce light only, before
  the direct light is added) divided by the base colour gives about 0.15–0.21
  on every surface: walls, floor and ceiling alike, about 0.75× the direct
  light on the right wall. Our physical bounce in a closed yellow room is
  stronger and uneven (the ceiling sees the lit floor), so the rebuild uses
  darker stand-ins for the ceiling tiles (#767357, half the G-buffer's
  #a29d78) and the carpet (#897f37 for #a39644). An even fill instead of our
  bounce made the walls even but the floor and ceiling wrong; not kept.
- **Materials** (G-buffer B: metallic / specular / roughness): walls 0 / 0.5
  / 1 (F0 0.04, fully rough), carpet 0 / 0.3 / 1 (F0 0.024), ceiling tiles
  0.01 / 0.086 / 0.58. Even fully rough, F0 0.04 gives a white sheen at
  grazing angles that adds blue to the yellow walls.
- **Fog** is on (exponential height fog) but its colour is black: it only
  dims far surfaces by ~1%. **Depth of field** is on, with circles of
  confusion under one pixel: no visible blur.
- **The clock.** The tape pass reads the game time: 93.907 s in this frame
  (hue turned −1.3°), 105.93 s in 20732. Rendering at the same time makes the
  red/green balance of the walls match.
- **Softness.** The capture's edges are softer than ours (strongest gradients
  0.043 across x, 0.031 across y; ours 0.055 / 0.078 without it): its
  upscaler (TSR, from 70%). A 0.7 px blur before the chain (`soften`) matches
  the edges across x. Across y the ten frames differ (strongest-gradient ratio
  y/x from 0.54 to 1.40), so the rest is the camera moving (head bob) in that
  frame, not the camera model. Also smoother than ours: the carpet and the
  ceiling tiles (no visible relief or grid at this distance).

Result (mean colour of each region, 0–1 display values):

| region | capture | first rebuild | now |
|---|---|---|---|
| right wall | 0.717 0.639 0.170 | 0.712 0.648 0.141 (0.98) | 0.727 0.648 0.168 (1.01) |
| back wall | 0.681 0.604 0.153 | 0.683 0.620 0.127 (0.99) | 0.690 0.613 0.142 (1.01) |
| floor | 0.545 0.441 0.080 | 0.531 0.435 0.043 (0.95) | 0.551 0.447 0.069 (1.00) |
| ceiling tiles | 0.240 0.183 0.041 | 0.232 0.188 0.058 (1.03) | 0.236 0.185 0.037 (0.99) |
| soffit side | 0.594 0.514 0.122 | 0.602 0.537 0.109 (1.02) | 0.614 0.531 0.118 (1.03) |
| alcove face | 0.607 0.518 0.070 | 0.530 0.453 0.037 (0.85) | 0.598 0.511 0.079 (0.99) |
| far left wall | 0.654 0.576 0.139 | 0.629 0.552 0.080 (0.92) | 0.709 0.622 0.144 (1.08) |
| light panel | 0.956 0.949 0.917 | 0.994 0.997 0.994 (1.06) | 0.956 0.951 0.922 (1.00) |
| mean abs error, whole picture | | 0.0400 | 0.0292 |
| mean abs error, 8 regions | | 0.0277 | 0.0110 |

(Brightness ratio to the capture in brackets.) What is left: the
game's lens-dirt smudges (round soft blobs on the right wall and the alcove
face; we do not copy their dirt), the far left wall 8% bright, its motion
blur, its finer noise, and a few edges (baseboards, the ceiling grid).

General or fitted to this frame?
- General (read from the game's own data, or checked on other frames): the
  unshadowed lights, the dim panels, the light colour, the materials' sheen,
  blue 0.75 (three frames, two of them through the bench with the game's own
  scene), fog and depth of field.
- Measured on this frame only: the softness (0.7 px); its cause (the
  upscaler) is general, its amount is one frame's.
- Fitted to this frame: the exposure (one number links our light units to
  the game's), the carpet and ceiling stand-in colours (they stand in for
  the game's weaker, even bounce; a different room shape would need other
  values, so the real fix is a bounce that behaves like the game's), the
  alcove's depth and slope and its lamp (the alcove is mostly hidden), and the
  smoother carpet and ceiling textures (chosen by eye). The clock only syncs
  the tape wobble for the comparison.
- The test: rebuild a second frame with nothing retuned.

## What this means for us

- Our "old camera" (digicam) and the Source post are the wrong models for
  this look. The new chain is short and exact: fixed exposure → whole-picture
  glow 0.19 with lens dirt → fringe 0.3 → vignette 0.4 → filmic curve with the
  defaults above → sharpen 7 → 25-step posterize → grain → tape → lens bend →
  4:3 with bars.
- The world must carry the colour: warm yellow paint, warm panel lights, dark
  ceiling tiles, real bounce light. No grading trick will make it.
- Its lighting is game lighting, not physics: dim panel surfaces, separate
  unshadowed spot lights, a weak even bounce.
- Camera: 98° wide (4:3) plus the bend, then motion blur when turning.
- We make our own noise and dirt textures (procedural or CC0); we do not
  take the game's.

## Not captured

Input textures (noise, dirt, materials) were not saved, by design. The
eye-adaptation result buffer was not saved either; the exposure was worked
out from the view's pre-exposure (34.13 = 0.18 × 2^15 / 172.8).
