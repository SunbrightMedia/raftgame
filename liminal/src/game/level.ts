import * as THREE from 'three';
import type { MapFile } from '../data/map';
import { CollisionWorld } from '../engine/collision/trace';
import { boxBrush } from '../engine/collision/brush';
import { buildBrushMeshes, disposeGroup } from '../engine/render/brushMesh';
import type { TextureRegistry } from '../engine/render/textures';
import { type Vec3, v3 } from '../engine/vec3';

/** A map turned into things the engine uses: collision, render meshes, spawn. */
export class Level {
  readonly collision: CollisionWorld;
  readonly meshes: THREE.Group;
  readonly spawn: { origin: Vec3; yaw: number; pitch: number };

  constructor(readonly map: MapFile, textures: TextureRegistry) {
    this.collision = new CollisionWorld(
      map.brushes
        .filter((b) => b.solid !== false)
        .map((b) => boxBrush(b.id, v3(...b.min), v3(...b.max), b.material ?? materialFromTexture(b.tex))),
    );
    this.meshes = buildBrushMeshes(map.brushes, textures);
    const start = map.entities.find((e) => e.class === 'player_start');
    this.spawn = start
      ? { origin: v3(...start.origin), pitch: start.angles?.[0] ?? 0, yaw: start.angles?.[1] ?? 0 }
      : { origin: v3(0, 0, 64), pitch: 0, yaw: 0 };
  }

  dispose(): void {
    disposeGroup(this.meshes);
  }
}

/** "office/carpet" → "carpet". Footstep sets per material come in Milestone 3. */
function materialFromTexture(tex: string | undefined): string {
  if (!tex) return 'default';
  return tex.split('/').pop() ?? 'default';
}
