# Study: ShuttleworthL "Backrooms_found_footage" (Blender)

Source: github.com/ShuttleworthL/Backrooms_found_footage (MIT). A short Kane-Pixels-style found-footage
film made in Blender: one packed `backrooms.blend` (saved in Blender 5.2) and six rendered clips.
Read with scripts disabled (`tools/blender/blend_dump.py`, scratchpad copies only). Nothing from the
project's files is in this repository: its wallpaper, carpet, chair and decal textures have unknown or
non-CC0 licences. Its ceiling texture is ambientCG's OfficeCeiling002 (CC0), which we can fetch ourselves.

Measured on the author's clips (two frames a second): average brightness 0.10 (0 black, 1 white); the
brightest clip 0.23, two near 0.04 (lights mostly off). The "Infinite house" frames are 0.32-0.41.

## Scene

- **Level** ("complex"): made entirely by a Geometry Nodes generator, nothing modelled by hand.
  - A 500 m x 500 m grid with lines every 7 m. Walls 0.7 m thick and 3.6 m high stand on a random
    subset of the grid edges (3D noise, scale 0.2, > 0.51, and a wave texture > 0.005).
  - Doorways are cut out by randomly scattered 3.1 m cubes (boolean difference), 0.6 m below centre,
    so openings run from the floor to 0.95 m below the ceiling.
  - Floor and ceiling are the inside faces of one 500 x 500 x 3.6 m box.
  - Skirting: 0.12 m high, 0.07 m proud. Smooth by angle 30°.
  - Generator inputs: width/depth 500, seed 0, wall thickness 0.7, height 3.6, length 7, skirting
    0.12 / 0.07 / z -1.74, lights bias 0.6, lights brightness 8.
- **Props:** a floor lamp, three wooden chairs, a "black mold" decal (a Vecteezy image) and a rigged
  creature ("lifeform").

## Materials (Principled BSDF)

| Surface | Textures and mapping | Linear albedo (mean) | Roughness |
|---|---|---|---|
| Walls | wallpaper colour/rough/normal, box projection, 2 m tiles | 0.31 / 0.29 / 0.08 (yellow) | from map |
| Carpet | carpet colour + normal (strength 10), box, 1 m tiles | 0.26 / 0.20 / 0.045 | 0.02-1.0 from 3D noise (scale 113): shiny spots |
| Ceiling | OfficeCeiling002 colour/rough/metal/normal/AO/displacement, 5 m tiles | ~0.87 (near white) | from map |
| Skirting | plain (0.52, 0.47, 0.20), scratch normals | - | 0.5 |

## Lighting

- **All the light comes from the ceiling panels.** With the floor lamp and the world switched off the
  render is unchanged (both 0.131 average).
- Each 5 m ceiling tile has four 0.72 m square panels, 2.5 m apart.
- Panel emission: strength 8 x the emission map. The map's panel colour is cyan-white: sRGB
  (0.73, 0.85, 0.85), linear (0.49, 0.70, 0.70).
- Panels switch on per block. A brick texture over the level's bounding box makes cells 12.5 m x
  6.25 m, and a cell is lit when its random value plus the bias 0.6 passes 1: about 60% of the cells.
  This depends on Blender 5's brick texture not clamping that sum. An older Blender would light no panels.
- Floor lamp: a point light, 15 W, radius 4 cm, warm (1, 0.725, 0.37). Its bulb mesh glows (strength
  10) only to the camera. World: grey 0.05. The level is closed, so the world adds nothing.

## Camera and render

- 20 mm lens on a 36 mm sensor: 84° horizontal. Depth of field at f/2.8, focused at 5 m.
- Shake from the CameraShakify add-on (Python drivers on the camera's constraints). No camera
  keyframes are saved in this file; the clips' walks were animated elsewhere.
- Cycles: 32 samples, adaptive threshold 0.2, OpenImageDenoise (albedo + normal), bounces 12 (4 diffuse,
  4 glossy), indirect clamp 10, Blackman-Harris filter 1.5 px, light tree, caustics on.
- 854 x 480, 24 fps, frames 0-830, written to video (H.264).

## Colour and post-processing

Colour view: **AgX**, Look None, exposure 0, gamma 1, display sRGB, dither 1, and **white balance on:
9000 K, tint +20**. Balancing to a 9000 K white warms everything; with the cyan panel light this gives
the green-yellow cast.

AgX in Blender 5.3 (its OCIO config): scene linear to FilmLight E-Gamut, log2 over -12.47..+12.53 stops,
a 57³ 3D LUT, then the display encoding.

Compositor, in scene linear, in this order:

1. **Tune Image** (contrast 0.05, colour boost 1, clarity/detail/sharpen 0, preserve colours on).
   - Contrast acts on HSV value only, and is tiny (x1.0025, -0.0006).
   - Colour boost 1 means HSV saturation x2, done in Blender's Filmic Log space.
   - The Filmic Log round trip is not neutral: going into Filmic Log applies Filmic's highlight
     desaturation cube, and the way back does not undo it. The group makes two round trips.
2. **RGB Curves**: the green curve passes through (0.539, 0.494). Green in the midtones drops slightly.
3. **Glare, Streaks**: threshold 1, smoothness 0.1, strength 0.02, 2 streaks, 3 iterations, fade 0.9,
   colour modulation 0.25, size 0.5, medium quality.
4. **Glare, Bloom**: threshold 1, smoothness 0.1, maximum 10, strength 0.125, size 0.5, medium quality.
5. **Sensor Noise** (luminance 0.05, chroma 0.16, animated). Per pixel, new every frame:
   - the hue moves by up to ±0.08;
   - white noise is overlaid on the HSV value at 5%.
6. **Film Grain** (factor 0.12, preset Super 35 mm, gauge 16 mm, style Studio Broadcast, ISO 400).
   About 190 nodes stay active. The grain comes from shifting the image by Gaussian noise vectors at
   two scales (0.9x and 0.5x of the image), plus blurs and curves.
7. **Chromatic Aberration**, scale type: green x1.005 and blue x1.01 about the centre.

Flattened and constant-folded with `tools/blender/compgraph.py`: about 700 nodes in the groups, 218 of
them active with these settings.

## Copy in our engine

Planned and tracked in the task list: the post chain and the colour view as a camera model, checked
pass by pass against Blender's own compositor; the level, rebuilt with CC0 textures matched to the
albedos above; and its lighting, checked against Cycles renders from the same camera.
