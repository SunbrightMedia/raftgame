# Raft Game — Unity basics

Open-world first-person raft prototype for Unity **2022.3 LTS** (built-in render pipeline).

## Getting started

1. Open this folder as a project in Unity Hub (2022.3.x).
2. Menu: **Raft → Build Ocean Scene**. This generates `Assets/Scenes/Ocean.unity`
   with the water, raft, player, sun and skybox, and sets it as the build scene.
3. Press **Play**.

The scene is generated from code (`Assets/Editor/RaftSceneBuilder.cs`) so there is
no large hand-edited `.unity` file in git — rerun the menu item any time to reset it.

## Controls

| Input | Action |
| --- | --- |
| `WASD` | Move (relative to look direction) |
| Mouse | Look |
| `Shift` | Sprint |
| `Space` | Jump / swim up |
| `Esc` | Release cursor (click to recapture) |

## What's here

- **`Water.shader`** — displaces the ocean surface on the GPU from four summed
  directional sine waves, with normals derived analytically from the wave
  derivative rather than by resampling.
- **`WaterSurface.cs`** — builds the flat grid mesh once and never touches it
  again; per frame it only pushes the wave parameters and a shared clock into
  the material. `SampleWaves` mirrors the shader exactly, so
  `WaterSurface.GetHeight(worldPos)` gives physics the surface you can see.
  The grid follows the player, snapped to whole cells so the world-space wave
  pattern stays put while the mesh moves.
- **`RaftPlatform.cs`** — the raft as an anchored kinematic platform. It rides
  the swell but never drifts, spins or wanders. Exposes its deck velocity so
  riders get carried by the bobbing.
- **`Buoyancy.cs`** — free-floating alternative: probe-based flotation on a
  dynamic rigidbody, force per probe scaling with submerged depth, giving pitch
  and roll for free. Swap it in on the raft (and clear `isKinematic`) if you
  want it adrift, or use it for barrels and debris.
- **`FirstPersonController.cs`** — rigidbody FPS movement. Ground checks with a
  sphere cast and adds the platform's velocity at the contact point, so the
  player rides the drifting raft instead of sliding off. Switches to swimming
  when the water line passes chest height.
- **`MouseLook.cs`** — yaw on the body, clamped pitch on the camera. Yaw is
  written to `Rigidbody.rotation` in `FixedUpdate`; writing `transform.rotation`
  from `Update` on an interpolated rigidbody gets undone by the interpolator
  each physics step, which feels like the view is on a spring.
- **`RaftSceneBuilder.cs`** — builds the scene, procedural skybox, directional
  sun with soft shadows, distance fog, and the flat cube raft.

## Tuning

Most feel is exposed in the inspector: wave amplitude/wavelength/speed on
**Water**, `bobAmount` / `tiltWithWaves` on **Raft**, and movement speeds on
**Player**. Set `bobAmount` to 0 for a completely still deck. Water
`resolution` only costs GPU vertex work — the mesh is static and the waves run
in the vertex shader, so it is far cheaper than it looks.

If the editor feels slow, check that the Game view isn't running with the
Stats/Profiler overlays open, and that **Edit → Project Settings → Quality**
has VSync at "Every V Blank" rather than something exotic. Editor framerate is
always well below a built player.

## Next steps

Not included yet: raft building/expansion, item pickups from the sea, hunger and
thirst, a shark, and saving. The water plane is finite (`size = 400`) but
recenters on the player, so the world reads as open and endless.
