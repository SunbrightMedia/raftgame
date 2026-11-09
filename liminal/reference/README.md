# reference

Reference material for comparisons only. Never loaded by the game (the game
reads `maps/` and `textures/` only) and never part of a published build.

- `portal2/`: files from the user's Portal 2 install (Valve's), for
  calibrating our Source-style lighting and comparing looks: the VPK index
  (`pak01_dir.vpk`, which also holds every material definition),
  `lights.rad`, and `shipyard_v13p.vmf` (a map source).
  Read them with `tools/source/vpk.py`.
