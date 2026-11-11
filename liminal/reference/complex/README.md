# The Complex: Expedition: frame study

`complex_capture.ps1` (run on the user's Windows PC) starts the game through RenderDoc, records
the frames the user picks with F12, and exports each one: every drawing step in order, the
picture it made, its shader code (disassembly, and source if the game kept any) and the numbers
it used. The exports and some facts (versions, library names, the game's own logs and settings
files) go to the private repo, branch `complex-capture`. The raw `.rdc` frames stay on the PC.

`complex_export.py` is the part that runs inside RenderDoc (written for RenderDoc 1.47, checked
against its Python reference). `complex_capture.ps1` carries a copy of it between
`$ExportPy = @'` and `'@`: keep the two the same.

For study only: what we learn is rebuilt in our own code. Nothing of the game (its files, its
textures) goes into our game.
