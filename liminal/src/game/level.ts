import * as THREE from 'three';
import type { MapFile } from '../data/map';
import { CollisionWorld, type TraceWorld } from '../engine/collision/trace';
import { convexBrush } from '../engine/collision/brush';
import { buildFaceMeshes, disposeGroup } from '../engine/render/brushMesh';
import type { TextureRegistry } from '../engine/render/textures';
import type { ModelRegistry } from '../engine/render/models';
import { buildPropMeshes, cullProps, disposeProps, setPropLight } from '../engine/render/propMeshes';
import { buildLabels } from '../engine/render/labels';
import { buildGlows, disposeGlows } from '../engine/render/glows';
import { buildRopes } from '../engine/render/ropes';
import { propSolids } from '../engine/collision/props';
import { buildFaces, solidPlanes, type Face, type LightmapLayout } from '../engine/light/faces';
import { type Vec3, v3 } from '../engine/vec3';
import type { PropInstance } from '../engine/light/vradProps';
import { isSourceLit, propBakeData, propShadowTris, sourceBakeInfo } from './sourceLighting';
import { propLightUniforms } from '../engine/render/propMaterial';
import { sourceLayout, SOURCE_LM_WIDTH } from '../engine/light/vrad';

/** A map turned into things the engine uses: collision, faces, render meshes, spawn. */
export class Level {
  /** What the player moves against. (A world loaded lot by lot puts its own here: game/lotWorld.ts.) */
  collision: TraceWorld;
  /** Brush entities moved from where the map places them (by entity name), e.g. an elevator between floors. */
  private movers = new Map<string, [number, number, number]>();
  readonly faces: Face[];
  readonly root = new THREE.Group();
  /** Where the player starts (and R respawns). */
  spawn: { origin: Vec3; yaw: number; pitch: number };
  private meshes: THREE.Group | null = null;
  private glows: THREE.Group | null = null;
  private ropes: THREE.Mesh | null = null;
  private props: THREE.Group | null = null;
  layout: LightmapLayout | null = null;
  /** For Source-lit maps (lights imported from a VMF): what the Source baker needs. */
  source: (ReturnType<typeof sourceBakeInfo> & { props: ReturnType<typeof propBakeData>; propShadows: Float32Array }) | null = null;
  lightmap: THREE.DataTexture | null = null;

  constructor(readonly map: MapFile, private textures: TextureRegistry, private models: ModelRegistry, readonly path?: string) {
    this.collision = this.buildCollision();
    this.faces = buildFaces(map.brushes);
    propLightUniforms.propLightOn.value = 0;
    if (isSourceLit(map)) {
      // Source lighting: the lightmap layout is fixed by the map (luxel grid on the texture axes), so it's known before any bake.
      this.source = {
        ...sourceBakeInfo(map, this.faces, (tex) => { const e = textures.get(tex); return { size: [e.worldW, e.worldH], source: e.source }; }),
        propShadows: propShadowTris(map, (name) => models.header(name)?.shadow),
        props: propBakeData(map, (name) => {
          const g = models.get(name)?.geometry;
          return g ? { positions: g.getAttribute('position').array as Float32Array, normals: g.getAttribute('normal').array as Float32Array } : undefined;
        }),
      };
      const L = sourceLayout(this.faces, this.source.info, SOURCE_LM_WIDTH);
      this.layout = {
        width: L.width, height: L.height, luxel: 16, source: true,
        rects: new Map([...L.rects].map(([id, r]) => [id, { x: r.x, y: r.y, w: r.w, h: r.h, src: { lmS: r.grid.lmS, lmT: r.grid.lmT, minS: r.grid.minS, minT: r.grid.minT, slots: r.slots } }])),
      };
    }
    const labels = buildLabels(map.entities);
    if (labels) this.root.add(labels);
    this.glows = buildGlows(map.entities, textures);
    if (this.glows) this.root.add(this.glows);
    this.ropes = buildRopes(map.entities);
    if (this.ropes) this.root.add(this.ropes);
    const start = map.entities.find((e) => e.class === 'player_start');
    this.spawn = start
      ? { origin: v3(...start.origin), pitch: start.angles?.[0] ?? 0, yaw: start.angles?.[1] ?? 0 }
      : { origin: v3(0, 0, 64), pitch: 0, yaw: 0 };
    this.rebuild();
  }

  private brushOffset(b: MapFile['brushes'][number]): [number, number, number] | undefined {
    return 'entity' in b && b.entity ? this.movers.get(b.entity) : undefined;
  }

  private propOffset(e: MapFile['entities'][number]): [number, number, number] | undefined {
    const parent = e.props?.parent;
    return typeof parent === 'string' ? this.movers.get(parent) : undefined;
  }

  private buildCollision(): CollisionWorld {
    const map = this.map;
    return new CollisionWorld([
      ...map.brushes
        .filter((b) => b.solid !== false)
        .map((b) => {
          const sp = solidPlanes(b);
          const o = this.brushOffset(b) ?? [0, 0, 0];
          const shift = (v: number[]) => v3(v[0] + o[0], v[1] + o[1], v[2] + o[2]);
          return convexBrush(b.id, sp.planes.map((p) => ({ n: v3(...p.n), d: p.d + p.n[0] * o[0] + p.n[1] * o[1] + p.n[2] * o[2] })), shift(b.min), shift(b.max), b.material ?? 'default');
        }),
      ...propSolids(map.entities.map((e) => { const o = this.propOffset(e); return o ? { ...e, origin: [e.origin[0] + o[0], e.origin[1] + o[1], e.origin[2] + o[2]] as [number, number, number] } : e; }), (m) => this.models.header(m)),
    ]);
  }

  /**
   * Move a brush entity (and props parented to it) by `offset` from where the
   * map places it, e.g. an elevator to the floor it stopped at. Its baked
   * light comes along unchanged, as Source's does.
   */
  setMover(name: string, offset: [number, number, number]): void {
    this.movers.set(name.toLowerCase(), offset);
    this.collision = this.buildCollision();
    this.rebuild();
  }

  /** Rebuild render meshes (after a re-crush or a new lightmap layout). */
  rebuild(): void {
    if (this.meshes) { this.root.remove(this.meshes); disposeGroup(this.meshes); }
    const byId = new Map(this.map.brushes.map((b) => [b.id, b]));
    this.meshes = buildFaceMeshes(this.faces, this.textures, this.layout, this.movers.size ? (id) => { const b = byId.get(id); return b && this.brushOffset(b); } : undefined);
    this.root.add(this.meshes);
    if (this.props) { this.root.remove(this.props); disposeProps(this.props); }
    this.props = buildPropMeshes(this.map.entities, this.models, this.textures, this.movers.size ? (e) => this.propOffset(e) : undefined);
    this.root.add(this.props);
    if (this.propLight) setPropLight(this.props, this.propLight.colors, this.propLight.offsets);
  }

  /** Skip drawing props lost in the fog or too small to see from `eye` (see cullProps). */
  cull(eye: THREE.Vector3, reach: number, detail: number): void {
    if (this.props) cullProps(this.props, eye, reach, detail);
  }

  /** The props' bake instances where they are now (movers applied). */
  propInstancesNow(): PropInstance[] {
    const src = this.source!;
    return src.props.instances.map((inst, i) => {
      const p = src.props.meta[i].parent, o = p ? this.movers.get(p) : undefined;
      if (!o) return inst;
      const m = inst.matrix.slice(); m[12] += o[0]; m[13] += o[1]; m[14] += o[2];
      return { model: inst.model, matrix: m };
    });
  }

  /** Baked per-vertex light for the props (Source-lit maps). */
  setPropLight(colors: Float32Array, offsets: Int32Array): void {
    this.propLight = { colors, offsets };
    if (this.props) setPropLight(this.props, colors, offsets);
  }
  private propLight: { colors: Float32Array; offsets: Int32Array } | null = null;

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
    if (this.glows) disposeGlows(this.glows);
    if (this.ropes) { this.ropes.geometry.dispose(); (this.ropes.material as THREE.Material).dispose(); }
    this.lightmap?.dispose();
  }
}
