# How Source (Portal 2) lights a scene

Read from Valve's official, public Source SDK 2013
(github.com/ValveSoftware/source-sdk-2013): `src/utils/vrad` (the light
compiler), `src/materialsystem/stdshaders` (world shaders, bloom),
`src/game/client/viewpostprocess.cpp` (exposure, bloom, colour correction).
Portal 2 runs a later branch of the same pipeline; per-map values (lights,
exposure, bloom, grading LUTs) live in each map's entities.

## 1. Lights (vrad/lightmap.cpp)
- Colour is typed in sRGB 0-255 and converted to linear (`(c/255)^2.2*255`),
  scaled by the 4th number (brightness/255). HDR maps use `_lightHDR` and
  `_lightscaleHDR`.
- Falloff is `1 / (c + l·d + q·d²)`. The brightness is normalised so it is
  the value **at 100 units**. Designers usually set `_fifty_percent_distance`
  and `_zero_percent_distance` instead: VRAD solves the quadratic, and
  `_hardfalloff` fades the light to exactly 0 at the zero distance. So
  Source lights are **pools that end**, not physical lamps lighting
  everything a little.
- `light_spot`: inside the inner cone the light still falls off with the
  cosine to the beam axis; between inner and outer cone a linear fringe
  (optionally raised to `_exponent`). Cones max 90°.
- Textured lights (`lights.rad`: texture name → light value): every
  luxel-sized patch of a glowing texture is an area emitter, `cos·cos/d²`.
  Fluorescent fixtures light the ceiling around them this way.
- `light_environment`: sun (with angular extent for soft shadows) plus a
  sky-ambient hemisphere.

## 2. Bounce (vrad/vrad.cpp)
- **100 bounces** by default: radiosity runs to convergence. Each bounce is
  tinted by the texture's average linear colour (`reflectivity`, capped
  0.99). Rooms are evenly filled and carry their materials' colour.
- Patches are chopped to at most 4 luxels; lightmaps default to 16 units per
  luxel.

## 3. Bump-mapped lightmaps (common_ps_fxc.h)
- Bumped surfaces store **three lightmaps** in a fixed tangent-space basis
  (the "Half-Life 2 basis", ±1/√6, 1/√2, 1/√3). The pixel shader blends them
  by the normal map: `Σ saturate(dot(n, basis_i)) · lightmap_i`. Every bump
  picks up direct *and* bounced light from the right direction.

## 4. Shading
- Diffuse = albedo × lightmap × lightmap scale. Shine comes from
  `$envmap` cubemaps baked at `env_cubemap` points (tile floors, metal).
  There is no other specular for world brushes.

## 5. Exposure (viewpostprocess.cpp, "new algorithm")
- A luminance histogram of the centre 90%×85% of the screen.
- Exposure is set so the **brightest 2% of pixels land at 60%** output
  (`mat_tonemap_percent_bright_pixels 2`, `mat_tonemap_percent_target 60`),
  and so the median is at least 3% (`mat_tonemap_min_avglum 3`).
- Clamped per map by `env_tonemap_controller` (defaults 0.5–2.0), eased in
  over time. Result: bright rooms **never blow out**, dark ones get lifted.
- After exposure the image is a plain linear scale and clamp: no filmic
  shoulder.

## 6. Bloom (Bloom_ps2x.fxc, Downsample_ps2x.fxc)
- A 4× downsampled, Gaussian-blurred copy of the **whole frame**, with no
  threshold, added back × `mat_bloomscale` (per map). Everything bright
  glows softly; it's what makes Source interiors feel hazy.

## 7. Colour correction
- `color_correction` entities point at 32³ LUTs (`materials/correction/*.raw`),
  blended by distance and weight. Portal 2 grades whole areas this way.

## 8. Fog
- `env_fog_controller`: colour, linear start/end, max density.

## Where our engine differs
| Source | Ours |
|---|---|
| 100 bounces | 2 bounces + a geometric estimate |
| Lights fade to zero at a set distance | Physical inverse-square, no end |
| Exposure: brightest 2% at 60% | Centre-weighted average; lamps blow out by design (digicam) |
| Linear clamp | Digicam shoulder, fringe, grain, chroma bleed |
| Whole-frame bloom | Threshold glare, bloom default 0 |
| Per-area LUT grading | White balance + tint |
| Baked cubemap reflections | Irradiance-only sheen |
| 3-direction bumped lightmaps | 1 dominant direction + directionality |
