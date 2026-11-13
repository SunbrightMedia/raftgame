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

`complex_deep.ps1` (also run on the user's PC) reads the same recorded frames again, without starting the
game, and saves what the first export left out: the shader numbers of every draw (every lamp's position,
colour, brightness, range and cone; each object's material numbers; Lumen's and the camera passes'
settings), the packed lamp list, and exact copies (raw, zlib) of the depth, the G-buffer, the light at each
lighting step and each camera pass. For frames 18325, 20732 and 19893 it also keeps the whole camera chain losslessly:
every camera step's output (the 3D tone table too), the small data buffers those steps read (exposure, the
tonemapper's colour multiplier) and the pictures from the frame before that they read (the upscaler's history),
about 90 MB more per frame. Textures the game loaded from its files (lens dirt, noise images) and the glow's
kernel are never kept. It also reads a few header bytes of the game's data files to report
whether they are encrypted (`game_files.txt`; nothing is unpacked or decrypted). They go to the same
branch, folder `deep/`. `complex_deep.py` is the part
that runs inside RenderDoc; the `.ps1` carries a copy of it between `$DeepPy = @'` and `'@` (keep the two the
same). Its step numbers match the first export's.
