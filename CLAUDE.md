# raftgame — project context

Unity **2022.3.40f1**, **URP**, Windows. First-person open-water raft
prototype, aiming at a stylised look (DREDGE-ish: hard-edged, faceted,
strong skies). Work happens on branch `claude/raft-game-unity-basics-q5ryg5`.

## Verifying changes

There is no test suite. The check is a headless compile — **Unity must be
closed**, it locks the project:

```powershell
.\compile.ps1      # C# + shader errors, exit 1 on failure
.\capture.ps1      # renders Ocean.unity to Logs/shots/*.png
.\typecheck.ps1
```

`compile.ps1` is the one to run after every change. `capture.ps1` deliberately
runs *without* `-nographics`, since `Camera.Render` needs a real GPU context —
it is the only way to see the result without opening the editor. Both take
`-UnityPath` if Unity lives somewhere else.

A clean compile says nothing about whether the game looks or feels right.
That judgement is the user's; don't assert it from a green build.

## Layout

- `Assets/Scripts/` — `WaterSurface`, `RaftPlatform`, `Buoyancy`,
  `FirstPersonController`, `MouseLook`, `GameBootstrap`, `PerfProbe`.
- `Assets/Scripts/World/` — clouds (`CloudField`, `CloudMeshBuilder`), debris,
  pickups, held light.
- `Assets/Scripts/Inventory/` — `InventorySystem`, `InventoryUI`, `Items`.
- `Assets/Scripts/UI/` — `GameUI`, `DevMenu`, `UnderwaterEffect`.
- `Assets/Shaders/` — `WaterURP`, `GradientSky`, `StylizedCloud`, `FacetedWood`.
- `Assets/Editor/` — `RaftSceneBuilder` (**Raft → Build Ocean Scene**),
  `RenderSetup` (**Raft → Setup Rendering**), `CompileCheck`, `SceneCapture`.

## Key design decisions

- **The scene is generated, not hand-authored.** `Assets/Scenes/Ocean.unity`
  is an output of `RaftSceneBuilder`. After changing the builder or scene
  components, re-run the menu item rather than editing the scene by hand.
- **`GameBootstrap` adds missing runtime systems on scene load.** An
  already-saved scene has no components for code added since it was built, and
  the symptom is a key that silently does nothing. Anything a scene should
  never be missing goes there, guarded by an "is it already present?" check.
- **The wave function exists twice, deliberately.** The vertex shader displaces
  the surface on the GPU; `WaterSurface.SampleWaves` mirrors it exactly in C#
  for physics. They share parameters (pushed via a MaterialPropertyBlock) and
  one clock, so collision matches what is drawn. **Change one, change the
  other**, or physics silently desyncs from the visuals.
- **The water mesh is static.** An earlier version deformed 25k vertices per
  frame on the CPU and tanked the framerate. Don't move wave work back to C#.
- **The raft is an anchored kinematic platform** (`RaftPlatform`), not a
  floating rigidbody — it rides the swell but never drifts or spins, because
  chasing a wandering raft felt bad. `Buoyancy` remains for free-floating props.
- **Player yaw is written to `Rigidbody.rotation` in `FixedUpdate`.** Writing
  `transform.rotation` from `Update` on an interpolated rigidbody gets undone by
  the interpolator each physics step and feels like the camera is on a spring.

## Conventions

- Commit and push to `claude/raft-game-unity-basics-q5ryg5`.
- `.meta` files belong in version control — they hold asset GUIDs.
- Tuning values are exposed in the inspector (or the dev menu) rather than
  hard-coded, so the user can feel out the numbers without a recompile.
