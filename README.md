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

- **`WaterSurface.cs`** — procedural ocean mesh animated by a sum of four
  directional sine waves. The grid follows the player and snaps to whole cells,
  so the world-space wave pattern stays put while the mesh moves. The same wave
  function is queried by gameplay code via `WaterSurface.GetHeight(worldPos)`,
  so physics matches the visible surface exactly.
- **`Buoyancy.cs`** — floats a rigidbody using probe points (defaults to the four
  bottom corners of the collider). Force per probe scales with submerged depth,
  which produces pitch and roll for free. Adds drag while submerged.
- **`FirstPersonController.cs`** — rigidbody FPS movement. Ground checks with a
  sphere cast and adds the platform's velocity at the contact point, so the
  player rides the drifting raft instead of sliding off. Switches to swimming
  when the water line passes chest height.
- **`MouseLook.cs`** — yaw on the body, clamped pitch on the camera.
- **`RaftSceneBuilder.cs`** — builds the scene, procedural skybox, directional
  sun with soft shadows, distance fog, and the flat cube raft.

## Tuning

Most feel is exposed in the inspector: wave amplitude/wavelength/speed on
**Water**, `buoyancyStrength` / `waterDrag` on **Raft**, and movement speeds on
**Player**. Water `resolution` trades smoothness for CPU — the mesh is rebuilt
on the CPU each frame, so drop it if you profile a bottleneck.

## Next steps

Not included yet: raft building/expansion, item pickups from the sea, hunger and
thirst, a shark, and saving. The water plane is finite (`size = 400`) but
recenters on the player, so the world reads as open and endless.
