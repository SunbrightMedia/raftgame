import * as THREE from 'three';
import type { MapFile } from '../data/map';
import { CollisionWorld } from '../engine/collision/trace';
import { convexBrush } from '../engine/collision/brush';
import { buildFaceMeshes, disposeGroup } from '../engine/render/brushMesh';
import type { TextureRegistry } from '../engine/render/textures';
import type { ModelRegistry } from '../engine/render/models';
import { buildPropMeshes, disposeProps } from '../engine/render/propMeshes';
import { propSolids } from '../engine/collision/props';
import { buildFaces, solidPlanes, type Face, type LightmapLayout } from '../engine/light/faces';
import { type Vec3, v3 } from '../engine/vec3';
import { isSourceLit, sourceBakeInfo } from './sourceLighting';
import { sourceLayout, SOURCE_LM_WIDTH } from '../engine/light/vrad';

/** A map turned into things the engine uses: collision, faces, render meshes, spawn. */
export class Level {
  readonly collision: CollisionWorld;
  readonly faces: Face[];
  readonly root = new THREE.Group();
  readonly spawn: { origin: Vec3; yaw: number; pitch: number };
  private meshes: THREE.Group | null = null;
  private props: THREE.Group | null = null;
  layout: LightmapLayout | null = null;
  /** For Source-lit maps (lights imported from a VMF): what the Source baker needs. */
  source: ReturnType<typeof sourceBakeInfo> | null = null;
  lightmap: THREE.DataTexture | null = null;

  constructor(readonly map: MapFile, private textures: TextureRegistry, private models: ModelRegistry, readonly path?: string) {
    this.collision = new CollisionWorld([
      ...map.brushes
        .filter((b) => b.solid !== false)
        .map((b) => {
          const sp = solidPlanes(b);
          return convexBrush(b.id, sp.planes.map((p) => ({ n: v3(...p.n), d: p.d })), v3(...b.min), v3(...b.max), b.material ?? 'default');
        }),
      ...propSolids(map.entities, (m) => models.header(m)?.hull),
    ]);
    this.faces = buildFaces(map.brushes);
    if (isSourceLit(map)) {
      // Source lighting: the lightmap layout is fixed by the map (luxel grid on the texture axes), so it's known before any bake.
      this.source = sourceBakeInfo(map, this.faces, (tex) => { const e = textures.get(tex); return { size: [e.worldW, e.worldH], source: e.source }; });
      const L = sourceLayout(this.faces, this.source.info, SOURCE_LM_WIDTH);
      this.layout = {
        width: L.width, height: L.height, luxel: 16, source: true,
        rects: new Map([...L.rects].map(([id, r]) => [id, { x: r.x, y: r.y, w: r.w, h: r.h, src: { lmS: r.grid.lmS, lmT: r.grid.lmT, minS: r.grid.minS, minT: r.grid.minT, slots: r.slots } }])),
      };
    }
    const start = map.entities.find((e) => e.class === 'player_start');
    this.spawn = start
      ? { origin: v3(...start.origin), pitch: start.angles?.[0] ?? 0, yaw: start.angles?.[1] ?? 0 }
      : { origin: v3(0, 0, 64), pitch: 0, yaw: 0 };
    this.rebuild();
  }

  /** Rebuild render meshes (after a re-crush or a new lightmap layout). */
  rebuild(): void {
    if (this.meshes) { this.root.remove(this.meshes); disposeGroup(this.meshes); }
    this.meshes = buildFaceMeshes(this.faces, this.textures, this.layout);
    this.root.add(this.meshes);
    if (this.props) { this.root.remove(this.props); disposeProps(this.props); }
    this.props = buildPropMeshes(this.map.entities, this.models, this.textures);
    this.root.add(this.props);
  }

  setLightmap(layout: LightmapLayout, tex: THREE.DataTexture): void {
    this.lightmap?.dispose();
    this.lightmap = tex;
    const relayout = !this.layout || this.layout.width !== layout.width || this.layout.height !== layout.height || this.layout.luxel !== layout.luxel;
    this.layout = layout;
    if (relayout) this.rebuild();
  }

  dispose(): void {
    if (this.meshes) disposeGroup(this.meshes);
    if (this.props) disposeProps(this.props);
    this.lightmap?.dispose();
  }
}
