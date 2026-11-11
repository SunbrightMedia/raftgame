# Found-footage realism: research and measurements

What makes CG liminal footage read as real camcorder video, and what we
measured on the "Infinite house" frames (YouTube, channel "Cassette";
STYLE.md reference 6). Four research passes (creators' methods, camcorder
signal path, real interior values, real-time games), then measurements
of the video's frames against our renders.

## What the sources say

- **The camera signal is the biggest tell, not the models.** Colour is
  band-limited far below brightness (VHS chroma ~300 kHz against luma
  ~2-3 MHz; DV 4:1:1 / 4:2:0), noise comes as low-frequency colour blotches
  rather than fine RGB grain, and the codec smooths away faint detail
  (an 80.lv UE5 VHS piece notes the upload's compression removed most grain).
  Open-source references: ntsc-rs (`crates/ntscrs/src/settings/standard.rs`:
  tape SP/LP/EP luma 2.4/1.9/1.4 MHz, chroma 320/300/280 kHz, chroma delay
  4-6 samples), NTSC-CRT (`crt_ntscvhs.h`).
- **Order:** blur, then sharpen, then compress (80.lv, a Blender liminal
  scene: slightly out of focus, sharpened after the blur, then heavy
  compression).
- **Camera behaviour:** a handheld, loose, imperfect operator. Kane Parsons
  keyframed the handheld moves in Blender (ShotDeck interview); game
  breakdowns (Unrecord threads) list image noise, motion blur and a loose
  camera. Motion blur from a 1/60-1/30 s shutter indoors.
- **Hide CG cleanliness:** uneven light, overexposed lamps, imperfections;
  the VHS look was used to hide the CG (TV Tropes, HollywoodCGFX on the
  Backrooms short; Blender + After Effects).
- **Real values** (paint makers' LRV tables, IES-style references; some
  second-hand): beige wall paint 0.55-0.70, white trim ~0.80, brown carpet
  0.10-0.20, red brick 0.25-0.30, dark wood 0.10-0.20; a 2 × 60 W dome is
  ~1600 lm at ~2700 K; trim sizes: casing ~2¼", baseboard 3½-5", crown ~3⅝".

## What the video's frames measure (960 × 720)

`scratchpad meas/metrics.py` (edges, texture, blotches), `meas/halo.py`
(lamp halos), `hiv/regions.py` (named boxes).

| | video | ours before | ours now |
|---|---|---|---|
| brightness edge, 10-90 % | 2.8-4.1 px, no halo | 4.4-5.4 px, halos to 18 % | 3.5-3.7 px, ~1 % |
| colour edge | 10-12 px | ~5 px | 7-11 px |
| fine texture in flat areas | 0.7-0.9 | 1.76 | 0.85-0.89 |
| colour blotches (mid-scale) | 2.5-2.9 | 0.8-1.1 | 2.5-2.8 |
| frame 1 vertical edges (camera turning) | 9.6 px | 3 px | blur with the shutter |
| lamp: clipped core, warm halo | b/r 0.75 at 50 px | white to 70 px | b/r ~0.6-0.7 |

The video's colour lags its brightness by only ~0.3-0.6 px, so the colour
delay is small.

## In the engine

- `camcorder.ts`: the video signal (sensor noise before a colour band limit,
  colour delay, codec smoothing), glow width shares, shutter motion blur
  (depth + the camera's previous view); `view.handheld` sway in `game.ts`.
  All off by default; `maps/house_iv.json` turns them on.
- `house_iv`: soft armchair from cushions (`tools/models/armchair_soft.json`),
  lamps as warm blobs (dim lens rim, glow in its middle width), trim and
  walls the same cream, white balance 2950 K, room 1 without baseboards and
  its east hall lit only by its sconce.

## Textures and models, matched at full size

Crops of the frames at 2-3× (user: "textures are still quite off: the door,
the carpet, everything"):

- **Carpet:** no weave at all; soft blotches a foot or two across (traffic,
  crushed pile), fainter ones of a few inches. Ours: `house/carpet_worn`
  (original, 8 ft tile), recoloured `house6/carpet_brown`.
- **Doors:** each panel's top edge is a thin dark line (the rail's step
  shadows a strip of the panel under overhead light), its bottom a thin
  light line. A ¼" shadow needs fine luxels sampled close to the surface:
  `surfaces.json` `"luxel"` per texture (`house6/door_white` 0.4"), with
  the bake's sample lift and edge margin scaled down for those faces.
  The video's doors are a little darker than its walls.
- **Brick:** smooth, slightly glossy face brick in running bond, read as
  long horizontal lines (raked bed joints, flush head joints). The Poly
  Haven bricks are all rough; ours: `house/brick_smooth` (original).
  Recolours can keep a texture's own hue differences (`keepHue`).
- **Armchair:** a neutral grey fabric reads as the video's warm grey under
  2700 K light (sampled a brown first: compare lit faces).
- **Resolution:** at 540 lines a mortar line or panel shadow is under a
  pixel and vanishes; the house renders at 1080 and gets its softness from
  the camera pass instead (edge widths unchanged).

## Not done yet

Interlacing, head-switching and tracking bands (tape only: the video shows
none), 8 × 8 block artifacts, dirt and wear on walls and doors, a spring lag
on turning.
