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
- Our baker (engine/light/vrad.ts) follows VRAD's own steps, not a stand-in:
  - faces cut at 32 luxels (VBSP SubdivideFace), each piece a patch tree;
  - transfers from every leaf to each face in front of it, down the tree while
    a node is near (d²/16 < area); one ray between centres (each 1 unit off its
    face) for visibility; point or polygon form factor; total scaled to 1/π;
  - parents emit the area average of their children (CollectLight);
  - samples are cells [s, s+1); a luxel (cell corner) blends the cells around
    it, its neighbour faces' too (BuildLuxelRadial); bounce reaches luxels
    from nearby leaf patches the same way (BuildPatchRadial, weight 2 − d²);
  - edge supersampling as BuildSupersampleFaceLights (4×4, gradient ≥ 1/16).
- Checked on the Portal 2 shipyard atrium against VRAD's own BSP:
  `npm run bench:vrad -- MAP --out X.json`, then compare per luxel. In the
  screenshot view, ours vs VRAD's lightmaps differ by 3.6/255 on average.
  The atrium is a cut-out of the full map, so light that bounces in from the
  rest of the map is missing from ours (it reads a few % dark).

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

## In our engine (Source-lit maps)
Maps imported from a VMF (tools/source/import_vmf.py) are lit and shown
with Source's model; our own physical model stays for our maps.

| Source | Ours | Status |
|---|---|---|
| VRAD lights (LightForString, SetLightFalloffParams, spot cones, hard falloff) | `engine/light/vrad.ts`, line for line | same formulas |
| Luxels on texture axes ÷ lightmapscale, sample at the luxel's clipped centre + 1 unit, supersampled edges | same grid; edges get a 4×4 supersample when a neighbour differs | supersample rule simplified |
| Patch radiosity, exact form factors between visible patches, ≤100 bounces, stop when a bounce adds < 1 | same patches (chopped < 4 luxels), same stop rule; form factors estimated with 256 cosine rays per patch, cached across bounces | estimated, converges to the same |
| Patch → luxel radial blend | tent weights over the face's patches | close |
| Three HL2-basis bump lightmaps, LightmappedGeneric blend | same basis, same `saturate(n·b)²` blend | same |
| World + func_detail cast shadows; brush entities, glass don't | same | same |
| Static props cast lightmap shadows (collision hulls) | not yet | **missing** |
| Static props: per-vertex light (.vhv): direct + 40 Halton rays into the lightmaps × reflectivity × 1/(1+(d/128)²) | `engine/light/vradProps.ts`, same | same |
| Dynamic props: leaf ambient cube + local lights at runtime | lit like static props | **approximation** |
| light_environment (sun, sky ambient) | not yet (the atrium has none) | missing |
| lights.rad texture lights | implemented, untested (none in the atrium) | to validate |
| Exposure: brightest 2% at 60%, median ≥ 3%, 0.5–2 | `engine/render/sourcePost.ts`, same histogram | same |
| Bloom: luminance-weighted ¼ downsample, 13-tap Gaussian, added in gamma | same | same |
| Colour correction LUTs, fog | not yet (the atrium has none) | missing |
| Moving brush entities (elevators) keep their baked light | drawn where the map places them | missing |

Validation still to do: our lightmaps against `sp_a3_speed_ramp.bsp`'s own
(LIGHTING_HDR lump) once that map's geometry is imported from the BSP.
