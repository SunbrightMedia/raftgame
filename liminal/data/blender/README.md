# data/blender: the 'blender' camera model's program

Made by `tools/blender/comp2glsl.py`; the game loads it with `src/engine/render/blenderData.ts`. Do not edit by hand.

- `blenderPost.json`: the compiled post-processing, exact build. These are the WebGL2 passes of the ShuttleworthL
  project's compositor, then its display step (white balance 9000 K / tint 20, AgX, sRGB, Blender's dither to 8
  bits). Every float operation is done as Blender does it (correctly rounded maths, no fused or regrouped
  operations), which makes the shaders huge once a driver inlines them (81 MB of code in all): Chrome on Windows
  froze compiling them. For checks only; the game does not load it.
- `blenderPost.fast.json`: the same passes and tables on the GPU's own maths (`comp2glsl.py --fast`); only the
  passes that hash float bits keep exact float operations, so the noise patterns stay Blender's. 1.4 MB of code
  inlined. This is what the game plays. Headless check (SwiftShader, frame 0, the test render): 18 of 409,920
  pixels differ from Blender's own render, by 1 level each (exact build: 3).
- `ocio65_*.f32` and `ocio113_*.f32.N`: 3D colour tables (Filmic Log conversion, AgX view). We measured them
  ourselves with Blender's OpenColorIO, on a grid twice as fine as Blender's own tables. Raw float32 RGB, red
  fastest. Each big table is split into parts under 8 MB, because published artifact files must stay under
  15 MB; the program lists each table's parts in order.
- `files.json`: the list of files above. The published page build (globs.page.ts) fetches them from
  `data/blender/` next to the page, so they are published as artifact files at those paths.

Source of the compositor graph: [ShuttleworthL/Backrooms_found_footage](https://github.com/ShuttleworthL/Backrooms_found_footage),
MIT licence, Copyright (c) 2026 Lawrence (full text: `LICENSE-Backrooms_found_footage.txt`). The colour tables
come from Blender 5.3's colour configuration (Filmic by Troy Sobotka, AgX by Eary Chow) run through
OpenColorIO. Copyright and licence questions for a public release: see CREDITS.md.

Rebuild (from the scratchpad dump of the project, `tools/blender/blend_dump.py` and `bl_curve_tables.py`):

```bash
bpyenv/bin/python -I tools/blender/comp2glsl.py DUMP.json CURVES.json data/blender --source "..."
bpyenv/bin/python -I tools/blender/comp2glsl.py DUMP.json CURVES.json data/blender --source "..." --fast
```

`files.json` (the published page's list) names the fast program and the tables.
