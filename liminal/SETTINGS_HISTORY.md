# Settings history

Every change to a default value in `src/data/settings.ts`, newest first, with
the reason. Old values are kept here so any of them can be restored (set them
in the tweak panel, or change the default back in code).

| date | setting | old → new | why |
|---|---|---|---|
| 2026-11-09 | Lighting › Corner darkening strength / falloff | 0.9 / 2.5 (power on the result: creases fell to ~0.3% light, black headers/trim/baseboards) → 0.6 / 2 (power on the occlusion; floor = 1 − strength = 40%) | User: strange dark areas above the door and beside the opening |
| 2026-11-08 | Camera › Bloom / Bloom threshold (new) | 0 / 0.8 × clip | User asked for a bloom slider (bright areas spilling past edges) |
| 2026-11-08 | Camera › Film grain / Grain size / Grain motion | 0 (flatgrass map 0.35) / 1.6 / 12 Hz → 0.2 / 1 / 60 Hz, for every map | User's values |
| 2026-11-08 | Camera › Grain motion | 0 → 12 Hz | User: frozen grain was more distracting than per-frame grain |
| 2026-11-08 | Camera › Grain motion (new) | 0 (holds still; before: new pattern every frame) | User: grain moved around too much |
| 2026-11-08 | Fog › Haze (new), Fog end max 40000 → 200000; Render › Texture repeat breakup (new, 0); Camera › Film grain / size (new, 0 / 1.6) | — | flatgrass vibe: haze, grain, no tiling grid (map sets haze, breakup 0.35, grain 0.35) |
| 2026-11-08 | Lighting › Sky colours / Horizon haze height (new) | #2f66c9 / #bcd4ea (brightness-normalised) → #3a5cb2 / #e4e8ec (relative brightness), 2.5° | Match the flatgrass reference photo's white-to-blue sky |
| 2026-11-08 | Lighting › Sky brightness / colours (new); Luxel size max 64 → 256 | 0 (indoors) / #2f66c9 / #bcd4ea | Outdoor maps (flatgrass) |
| 2026-11-08 | Camera › Lamp glow (new) / Overexposed surfaces keep colour | 8 / 0.85 → 0.6 | Panels had lost their glow; neon carpet may whiten a little |
| 2026-11-08 | Camera › White balance tint; Overexposed surfaces keep colour | (new) 0; (new) 0.85 | Per-map colour cast; neon carpet went white under light |
| 2026-11-08 | Lighting › Remaining bounces | (new) 1 | Rooms take on the colour of their own surfaces (user) |
| 2026-11-08 | pmp_basement map › White balance / tint | 4300 K / 0 → 3300 K / +1.0 | Match the reference photo's pink cast (wall ratio 1 : 0.87 : 0.78 vs photo 1 : 0.89 : 0.80) |
| 2026-11-08 | Camera › Colour bleed / Extra horizontal softness | 0 / 0 → 2 / 0.4 | User's values |
| 2026-11-08 | Movement › Ground friction; Camera › Brightness / Contrast | 4 (Source) / 0 / 1.25 → 6 / -0.18 / 0.95 | User's values |
| 2026-11-08 | Camera › Brightness / Contrast / Black crush | (new) 0 / 1.25 / 0.03 (before: no contrast curve, i.e. 1 / 0) | User: proper digicam contrast and a brightness that auto exposure can't undo |
| 2026-11-08 | Camera › Purple fringe / Lamp edge darkness | 0.6 / (new) → 0.45 / 0.7 | User: sharp dark edge around lamps, visible up close |
| 2026-11-08 | Lighting › Corner darkening falloff | (new) 2.5 | Deepen wall-base/corner darkness; effect limited by lightmap resolution (not yet published) |
| 2026-11-08 | Camera › fringe, sharpening, highlight curve | → restored to the pre-green-fix look: fringe code as before (0.6), sharpening on the HDR image again (now hue-safe), highlight knee 0.72 / roll-off 1 (the original shoulder) | User: fringe used to look sharp and purple |
| 2026-11-08 | Camera › Purple fringe | 1.0 + outer ring → 0.8, scaled by blown-area size (threshold 2.5) | User: distant lamps became purple blobs |
| 2026-11-08 | Surfaces › Reflections × | 1 → 0 | User: global sheen turned dark carpets grey; looks better off |
| 2026-11-08 | Camera › Glare / Blown keep colour / Horizontal softness / Colour bleed / Warm boost / Shadow tint | 0.008 / 0.12 / 0.5 / 1.5 / 0.25 / 0.5 → 0.018 / 0 / 0 / 0 / 0 / 0 | User: revert to the pre-Mall-Run look, keep only the approved fixes (sliders remain) |
| 2026-11-08 | Lighting › AO strength / radius / on direct light | 0.4 / 24 / 0.35 (fixed) → 0.9 / 48 / 1.0 | Dark band along wall bases and into corners (user: main takeaway of the Mall Run footage) |
| 2026-11-08 | Camera › Highlight knee / roll-off / black stretch | hard shoulder at 0.72 → 0.55 / 2.5 EV / 0.25 | Neighbouring rooms looked far too bright or too dark |
| 2026-11-08 | Camera › Purple fringe | Mall Run profile rebuild → back to the earlier hard-edge fringe at 1.0, with a fainter outer ring | User: the rebuild looked horrid |
| 2026-11-08 | View › bob / sway / roll | 0.8 / 0.6 / 0.4° (distance-based, ~6 steps/s) → 0.3 / 0.25 / 0.15°, 1.8 steps/s | User: bob comically fast |
| 2026-11-08 | Camera › Purple fringe | 0.5 → 1.0, rebuilt (blue rim + lavender halo + dark line, profile measured from Mall Run frames); new Fringe width 2 % | User: strengthen the fringe / hard edge |
| 2026-11-08 | Camera › Glare amount | 0.018 → 0.008 | Warm glare was washing out the fringe structure |
| 2026-11-08 | Camera › Sharpening halo limit's blown-edge variant | (removed) | The dark line is now part of the fringe profile |
| 2026-11-08 | Camera › Blown highlights keep colour / Extra horizontal softness / Colour bleed / Warm colour boost / Shadow tint / Fisheye / Camera light beam | (new) 0.12 / 0.5 px / 1.5 px / 0.25 / 0.5 / 0 / 90° | Mall Run study (D1–D3, C3, C5, B5) |
| 2026-11-08 | Lighting › Bounces | 1 → 2 | Ceiling coloured by bounce light (B2) |
| 2026-11-08 | View › View bob / sway / roll | 0 / – / – → 0.8 / 0.6 / 0.4° | Handheld camera bob while moving (user) |
| 2026-11-08 | Surfaces & reflections | (new) ×1, roughness +0, relief ×1 | Reflections + bump (B3); per-material values in textures/surfaces.json |
| 2026-11-08 | Camera › Sharpening halo limit | (new) 0.08 | Glow was yellow-green: per-channel sharpening of HDR light stripped red beside amber bulbs. Sharpening now acts on luma after the tone curve, capped by this |
| 2026-11-08 | Render › Wait for lighting | (new) 4000 ms | Don't show the flat unlit world while the lightmap loads |
| 2026-11-08 | Camera › Glow (bloom, threshold, radius) | 0.5 / 1.5 / 1.0 → replaced by Glare amount 0.018 and Glare spread 0.5 (first try 0.035 / 0.65 hid the hard edge and fringe) | Glow looked unpolished, especially at distance: rebuilt as an energy-based lens glare (Spencer 1995; Jimenez 2014) |
| 2026-11-08 | Camera › In-camera sharpening | 0.5 → 1.0 | User's choice |
| 2026-11-08 | Camera › Glow threshold | 2.5 → 1.5 | Glow from energy past the threshold only |
| 2026-11-08 | Camera › Glow / Glow radius | 0.55 / 1.6 → 0.5 / 1.0 | Tighter halo with a hard edge (user preference) |
| 2026-11-08 | Camera › Purple fringe | 0.3 → 0.5 | User liked the earlier fringe on light sources |
| 2026-11-08 | Camera › Chromatic aberration | 0.6 → 0 | Global aberration is a filter cliché |
| 2026-11-08 | Camera (whole category) | digicam filter on a fixed exposure → physical camera: auto exposure (EV comp 0), white balance 4300 K, clip 1.0 | Lighting core rework (linear light, physical units) |
| 2026-11-08 | Lighting (whole category) | arbitrary intensities, ambient #1e2024, bounce ×1.6, fluorescent 0.6 / falloff 144 → physical lights (lumens, kelvin), ambient 0 lx, bounce ×1, AO 0.4 | Lighting core rework |
| 2026-11-08 | Render › Internal resolution | 720 → 540 | Digicam-like softness |
| 2026-11-08 | Render › Internal resolution, Texture filter | 480 / nearest → 720 / linear | Source-like look instead of Minecraft-retro (user feedback) |
| 2026-11-08 | Textures › density / colours / contrast / saturation / sharpen | 2 / 64 / 1.1 / 0.85 / 0.35 → 4 / 0 / 1.05 / 0.95 / 0.2 | Source-like look (old values kept as the "Late-90s crunchy" preset) |
| 2026-11-08 | Player hull | 32×72, eye 64, crouch 36/28 → 24×54, eye 48, crouch 27/21 | Player 25% smaller (user) |
| 2026-11-08 | Render › Antialiasing (MSAA) | (new) 4 | User asked for antialiasing |
