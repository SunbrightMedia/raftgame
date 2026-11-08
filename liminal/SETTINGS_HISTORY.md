# Settings history

Every change to a default value in `src/data/settings.ts`, newest first, with
the reason. Old values are kept here so any of them can be restored (set them
in the tweak panel, or change the default back in code).

| date | setting | old → new | why |
|---|---|---|---|
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
