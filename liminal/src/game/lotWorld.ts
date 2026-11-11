import * as THREE from 'three';
import type { EntityDef } from '../data/map';
import { CollisionWorld, type TraceResult, type TraceWorld } from '../engine/collision/trace';
import { convexBrush } from '../engine/collision/brush';
import { propModel } from '../engine/collision/props';
import { meshesFromBatches, disposeGroup } from '../engine/render/brushMesh';
import { buildPropMeshes, cullProps, disposeProps, propMaterials } from '../engine/render/propMeshes';
import { buildGlows, disposeGlows, glowTextures } from '../engine/render/glows';
import { buildRopes } from '../engine/render/ropes';
import { closeLightGrid, openLightWindow, writeLightLot } from '../engine/render/lightGrid';
import type { LightWindow } from '../engine/render/lightGridCore';
import type { TextureRegistry } from '../engine/render/textures';
import type { ModelRegistry } from '../engine/render/models';
import { v3, copy, type Vec3 } from '../engine/vec3';
import { buildLot, LOT_SIZE, type LotEnv, type LotPayload } from '../world/lotBuild';

/**
 * The endless world, held as lots round the player (docs/WORLD_DESIGN.md,
 * section 10). Lots are made by workers, far enough away that the fog hides
 * them; each arrives as plain arrays and is handed to the graphics card over
 * a few frames; lots left behind are dropped (they are made again from the
 * seed if the player comes back). Nothing here waits for a lot.
 *
 * A lot is wanted when it is within LOAD lots of the player's lot. The fog
 * hides everything past about a lot and a half, so a lot is always in place
 * before it could be seen.
 */
const LOAD = 3;
/** The lamp grid's window: as many lots a side as can be loaded at once. */
const WINDOW: LightWindow = { lots: 2 * LOAD + 1, lotCells: 32, nz: 20, z0: -2560, listCap: 32768, lampCap: 512, chainCap: 4096 };
/** How far a brush may reach outside the lot it belongs to (a beam across an avenue): a move this near a lot's edge asks the lot too. */
const OVERHANG = 1024;

interface Chunk {
  i: number; j: number;
  group: THREE.Group;
  brush: THREE.Group | null; props: THREE.Group | null; glows: THREE.Group | null; ropes: THREE.Mesh | null;
  solid: CollisionWorld | null;
  fog: { min: number[]; max: number[]; fog: Record<string, unknown> }[];
  /** Still being put together: not shown, not solid. */
  pending: { payload: LotPayload; step: number } | null;
}
const key = (i: number, j: number) => `${i},${j}`;

/** The lots' solids as one world for the player to move in. */
class LotCollision implements TraceWorld {
  readonly lots = new Map<string, { ox: number; oy: number; world: CollisionWorld }>();
  trace(start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3): TraceResult {
    const best: TraceResult = { fraction: 1, endpos: copy(end), normal: v3(), startsolid: false, allsolid: false, brush: null };
    const x0 = Math.min(start.x, end.x) + mins.x - OVERHANG, x1 = Math.max(start.x, end.x) + maxs.x + OVERHANG;
    const y0 = Math.min(start.y, end.y) + mins.y - OVERHANG, y1 = Math.max(start.y, end.y) + maxs.y + OVERHANG;
    for (let j = Math.floor(y0 / LOT_SIZE); j <= Math.floor(y1 / LOT_SIZE); j++) for (let i = Math.floor(x0 / LOT_SIZE); i <= Math.floor(x1 / LOT_SIZE); i++) {
      const c = this.lots.get(key(i, j));
      if (!c) continue;
      const tr = c.world.trace(v3(start.x - c.ox, start.y - c.oy, start.z), v3(end.x - c.ox, end.y - c.oy, end.z), mins, maxs);
      best.startsolid ||= tr.startsolid;
      best.allsolid ||= tr.allsolid;
      if (tr.fraction < best.fraction) { best.fraction = tr.fraction; best.normal = tr.normal; best.brush = tr.brush; }
    }
    best.endpos = best.allsolid ? copy(start) : v3(start.x + (end.x - start.x) * best.fraction, start.y + (end.y - start.y) * best.fraction, start.z + (end.z - start.z) * best.fraction);
    if (best.allsolid) best.fraction = 0;
    return best;
  }
  testPosition(pos: Vec3, mins: Vec3, maxs: Vec3): boolean {
    return this.trace(pos, pos, mins, maxs).startsolid;
  }
}

/** Makes lots: on workers where the page may have them, else on the page's own thread (which then stops for each). */
class LotMaker {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private waiting = new Map<number, { done: (p: LotPayload) => void; fail: (e: Error) => void; worker: Worker }>();
  private nextId = 1;
  constructor(private env: LotEnv, want: number) {
    for (let k = 0; k < want; k++) {
      try {
        const w = new Worker(new URL('../world/lotWorker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent) => {
          const m = e.data as { type: 'lot'; id: number; payload: LotPayload } | { type: 'error'; id: number; message: string };
          const q = this.waiting.get(m.id);
          if (!q) return;
          this.waiting.delete(m.id);
          this.idle.push(q.worker);
          if (m.type === 'lot') q.done(m.payload); else q.fail(new Error(m.message));
        };
        w.onerror = (e) => {
          // A worker that cannot start (the page forbids it): its lots are made on the page instead.
          console.warn('lot worker failed:', e.message);
          this.workers = this.workers.filter((x) => x !== w);
          this.idle = this.idle.filter((x) => x !== w);
          for (const [id, q] of this.waiting) if (q.worker === w) { this.waiting.delete(id); q.fail(new Error('worker lost')); }
        };
        w.postMessage({ type: 'env', env });
        this.workers.push(w);
        this.idle.push(w);
      } catch (err) { console.warn('no lot worker:', err); break; }
    }
  }
  /** How many workers there are (0 = lots are made on the page), and how many lots can be asked for now. */
  get count(): number { return this.workers.length; }
  get free(): number { return this.workers.length ? this.idle.length : this.waiting.size ? 0 : 1; }
  make(seed: number, i: number, j: number): Promise<LotPayload> {
    const id = this.nextId++;
    const w = this.idle.pop();
    if (!w) {
      // On the page itself, after this frame.
      return new Promise((done, fail) => {
        this.waiting.set(id, { done, fail, worker: null as unknown as Worker });
        setTimeout(() => { this.waiting.delete(id); try { done(buildLot(seed, i, j, this.env)); } catch (e) { fail(e as Error); } }, 0);
      });
    }
    return new Promise((done, fail) => { this.waiting.set(id, { done, fail, worker: w }); w.postMessage({ type: 'lot', id, seed, i, j }); });
  }
  dispose(): void { for (const w of this.workers) w.terminate(); this.workers = []; this.idle = []; this.waiting.clear(); }
}

export class LotWorld {
  readonly root = new THREE.Group();
  readonly collision = new LotCollision();
  private chunks = new Map<string, Chunk>();
  private asked = new Set<string>();
  private maker: LotMaker;
  private brushMats = new Map<string, THREE.Material>();
  private propMats = new Map<string, THREE.Material>();
  private at: [number, number] = [0, 0];
  private gone = false;
  /** For the HUD: lots shown, lots being made or put together, workers, the last lot's time in its worker and the longest any step took on the page (ms). */
  readonly stats = { lots: 0, coming: 0, workers: 0, makeMs: 0, stepMs: 0, dropped: 0 };

  constructor(readonly seed: number, private gl: THREE.WebGLRenderer, private textures: TextureRegistry, private models: ModelRegistry) {
    this.root.name = 'lots';
    openLightWindow(gl, WINDOW);
    const env: LotEnv = { texSize: textures.worldSizes(), shapes: models.shapes(), window: WINDOW };
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    this.maker = new LotMaker(env, typeof Worker === 'undefined' ? 0 : Math.max(1, Math.min(4, cores - 1)));
    this.stats.workers = this.maker.count;
  }

  /** Loads the lots round `pos` (two lots out: all that the fog lets be seen from there), and returns when they stand. */
  async start(pos: { x: number; y: number }): Promise<void> {
    this.at = [Math.floor(pos.x / LOT_SIZE), Math.floor(pos.y / LOT_SIZE)];
    const near = (c: [number, number]) => Math.max(Math.abs(c[0] - this.at[0]), Math.abs(c[1] - this.at[1])) <= 2;
    for (;;) {
      this.ask();
      for (const c of this.chunks.values()) while (c.pending) this.step(c);
      const missing = this.wanted().filter((c) => near(c) && !this.shown(c[0], c[1]));
      if (!missing.length || this.gone) return;
      await new Promise((r) => setTimeout(r, 15));
    }
  }

  private shown(i: number, j: number): boolean { const c = this.chunks.get(key(i, j)); return !!c && !c.pending; }
  /** The lots wanted now, nearest first. */
  private wanted(): [number, number][] {
    const out: [number, number][] = [];
    for (let dj = -LOAD; dj <= LOAD; dj++) for (let di = -LOAD; di <= LOAD; di++) out.push([this.at[0] + di, this.at[1] + dj]);
    const d = (c: [number, number]) => Math.hypot(c[0] - this.at[0], c[1] - this.at[1]);
    return out.sort((p, q) => d(p) - d(q));
  }

  /** Asks the workers for the nearest lots not yet here. */
  private ask(): void {
    if (!this.maker.free) return;
    for (const [i, j] of this.wanted()) {
      if (!this.maker.free) break;
      const k = key(i, j);
      if (this.chunks.has(k) || this.asked.has(k)) continue;
      this.asked.add(k);
      void this.maker.make(this.seed, i, j).then(async (p) => {
        this.asked.delete(k);
        if (this.gone || Math.max(Math.abs(i - this.at[0]), Math.abs(j - this.at[1])) > LOAD) return;   // the player has moved on
        // Its textures and models (the first lots only: after that all are in hand).
        const tex = [...p.batches.map((b) => b.tex), ...propMaterials(p.entities, this.models), ...glowTextures(p.entities)];
        await this.models.prepare(p.entities.map(propModel).filter((m): m is string => !!m));
        await this.textures.prepare([...tex, ...propMaterials(p.entities, this.models), ...this.textures.extrasOf(tex)]);
        if (this.gone) return;
        const group = new THREE.Group();
        group.name = `lot ${k}`;
        group.position.set(i * LOT_SIZE, j * LOT_SIZE, 0);
        group.visible = false;
        this.root.add(group);
        this.chunks.set(k, { i, j, group, brush: null, props: null, glows: null, ropes: null, solid: null, fog: [], pending: { payload: p, step: 0 } });
        this.stats.makeMs = p.stats.makeMs + p.stats.meshMs + p.stats.lightMs;
        this.stats.dropped += p.stats.dropped;
      }).catch((err) => { this.asked.delete(k); console.error(`lot ${k}:`, err); });
    }
  }

  /** One step of putting a lot together (each is a few milliseconds at most; one a frame). */
  private step(c: Chunk): void {
    const q = c.pending;
    if (!q) return;
    const t0 = performance.now(), p = q.payload;
    if (q.step === 0) {
      c.brush = meshesFromBatches(new Map(p.batches.map((b) => [b.tex, b])), this.textures, null, this.brushMats);
      c.group.add(c.brush);
    } else if (q.step === 1) {
      c.props = buildPropMeshes(p.entities, this.models, this.textures, undefined, this.propMats);
      c.group.add(c.props);
      c.glows = buildGlows(p.entities, this.textures);
      if (c.glows) c.group.add(c.glows);
      c.ropes = buildRopes(p.entities);
      if (c.ropes) c.group.add(c.ropes);
    } else if (q.step === 2) {
      c.solid = new CollisionWorld(p.solids.map((s) => {
        const planes = [];
        for (let k = 0; k < s.planes.length; k += 4) planes.push({ n: v3(s.planes[k], s.planes[k + 1], s.planes[k + 2]), d: s.planes[k + 3] });
        return convexBrush(s.id, planes, v3(...s.min), v3(...s.max), s.material);
      }));
      c.fog = p.entities.filter((e: EntityDef) => e.class === 'fog_volume').map((e) => ({ min: e.props?.min as number[], max: e.props?.max as number[], fog: (e.props?.fog ?? {}) as Record<string, unknown> }));
    } else {
      // Its lamps, and then it is there: seen and solid in the same frame.
      writeLightLot(this.gl, c.i, c.j, p.light);
      this.collision.lots.set(key(c.i, c.j), { ox: c.i * LOT_SIZE, oy: c.j * LOT_SIZE, world: c.solid! });
      c.group.visible = true;
      c.pending = null;
    }
    q.step++;
    this.stats.stepMs = Math.max(this.stats.stepMs * 0.995, performance.now() - t0);
  }

  private drop(c: Chunk): void {
    this.root.remove(c.group);
    if (c.brush) disposeGroup(c.brush, true);
    if (c.props) disposeProps(c.props, true);
    if (c.glows) disposeGlows(c.glows);
    if (c.ropes) { c.ropes.geometry.dispose(); (c.ropes.material as THREE.Material).dispose(); }
    this.collision.lots.delete(key(c.i, c.j));
    this.chunks.delete(key(c.i, c.j));
  }

  /** Every frame: where the player is. */
  update(pos: { x: number; y: number }): void {
    this.at = [Math.floor(pos.x / LOT_SIZE), Math.floor(pos.y / LOT_SIZE)];
    for (const c of [...this.chunks.values()]) if (Math.max(Math.abs(c.i - this.at[0]), Math.abs(c.j - this.at[1])) > LOAD) this.drop(c);
    this.ask();
    // One step of one lot a frame: the nearest first.
    let next: Chunk | null = null, best = Infinity;
    for (const c of this.chunks.values()) {
      if (!c.pending) continue;
      const d = Math.hypot(c.i - this.at[0], c.j - this.at[1]);
      if (d < best) { best = d; next = c; }
    }
    if (next) this.step(next);
    let shown = 0, coming = this.asked.size;
    for (const c of this.chunks.values()) if (c.pending) coming++; else shown++;
    this.stats.lots = shown; this.stats.coming = coming;
  }

  /** Skip what the fog hides: whole lots past `reach`, and in the others the props too far or too small to see (cullProps). */
  cull(eye: THREE.Vector3, reach: number, detail: number): void {
    const local = new THREE.Vector3();
    for (const c of this.chunks.values()) {
      if (c.pending) continue;
      const x0 = c.i * LOT_SIZE, y0 = c.j * LOT_SIZE;
      const dx = Math.max(x0 - eye.x, 0, eye.x - x0 - LOT_SIZE), dy = Math.max(y0 - eye.y, 0, eye.y - y0 - LOT_SIZE);
      c.group.visible = Math.hypot(dx, dy) <= reach + OVERHANG;
      if (c.group.visible && c.props) cullProps(c.props, local.set(eye.x - x0, eye.y - y0, eye.z), reach, detail);
    }
  }

  /** The fog of the mass the eye is inside, if it is inside one. */
  fogAt(eye: THREE.Vector3): Record<string, unknown> | null {
    const i = Math.floor(eye.x / LOT_SIZE), j = Math.floor(eye.y / LOT_SIZE);
    const c = this.chunks.get(key(i, j));
    if (!c) return null;
    const x = eye.x - i * LOT_SIZE, y = eye.y - j * LOT_SIZE;
    return c.fog.find((v) => x > v.min[0] && x < v.max[0] && y > v.min[1] && y < v.max[1] && eye.z > v.min[2] && eye.z < v.max[2])?.fog ?? null;
  }

  dispose(): void {
    this.gone = true;
    this.maker.dispose();
    for (const c of [...this.chunks.values()]) this.drop(c);
    for (const m of [...this.brushMats.values(), ...this.propMats.values()]) m.dispose();
    this.root.removeFromParent();
    closeLightGrid();
  }
}
