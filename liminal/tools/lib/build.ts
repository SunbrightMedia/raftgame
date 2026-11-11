/**
 * Shared map building blocks for the generators: brushes, curves with enough
 * segments (STYLE.md: curves are curves), lights, rooms + paint, write-out.
 */
import { writeFileSync } from 'node:fs';
import { type BrushDef, type EntityDef, type FaceTex, type V3, MAP_FORMAT, MAP_VERSION, serializeMap } from '../../src/data/map';
import { paintByRoom, type Room } from './roomPaint';

type Faces = Record<string, Partial<FaceTex> & { tex?: string }>;
export type Opts = { faces?: Faces; solid?: boolean };
type P2 = [number, number];

/** Segments for a full circle of radius r: ≥ 24 per quarter on anything large, never fewer than 16 in all. */
export const segs = (r: number) => Math.max(16, Math.min(96, Math.round(r * 2.5 / 4) * 4));

export class MapBuilder {
  readonly brushes: BrushDef[] = [];
  readonly entities: EntityDef[] = [];
  private id = 1;
  private eid = 1;

  box(min: V3, max: V3, tex: string, o: Opts = {}): void {
    this.brushes.push({ id: this.id++, type: 'box', min, max, tex, ...(o.faces ? { faces: o.faces } : {}), ...(o.solid === false ? { solid: false } : {}) } as BrushDef);
  }

  /** Upright prism: plan outline (x, y), from z0 to z1. */
  prism(points: P2[], z0: number, z1: number, tex: string, o: Opts = {}): void {
    const r = (n: number) => Math.round(n * 1000) / 1000;
    const pts = points.map(([x, y]) => [r(x), r(y)] as P2);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    this.brushes.push({
      id: this.id++, type: 'prism', points: pts, z0, z1, tex,
      min: [Math.min(...xs), Math.min(...ys), z0], max: [Math.max(...xs), Math.max(...ys), z1],
      ...(o.faces ? { faces: o.faces } : {}), ...(o.solid === false ? { solid: false } : {}),
    } as BrushDef);
  }

  /** Sideways prism along x: profile in (y, z), from x0 to x1 (e.g. a rounded sill running along x). */
  prismX(profile: P2[], x0: number, x1: number, tex: string, o: Opts = {}): void {
    const r = (n: number) => Math.round(n * 1000) / 1000;
    const pts = profile.map(([y, z]) => [r(y), r(z)] as P2);
    const ys = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    this.brushes.push({
      id: this.id++, type: 'prism', axis: 'x', points: pts, z0: x0, z1: x1, tex,
      min: [x0, Math.min(...ys), Math.min(...zs)], max: [x1, Math.max(...ys), Math.max(...zs)],
      ...(o.faces ? { faces: o.faces } : {}), ...(o.solid === false ? { solid: false } : {}),
    } as BrushDef);
  }

  /** Sideways prism along y: profile in (x, z), from y0 to y1 (e.g. a baluster segment waving in x). */
  prismY(profile: P2[], y0: number, y1: number, tex: string, o: Opts = {}): void {
    const r = (n: number) => Math.round(n * 1000) / 1000;
    const pts = profile.map(([x, z]) => [r(z), r(x)] as P2); // axis "y" points are (z, x)
    const xs = profile.map((p) => p[0]), zs = profile.map((p) => p[1]);
    this.brushes.push({
      id: this.id++, type: 'prism', axis: 'y', points: pts, z0: y0, z1: y1, tex,
      min: [Math.min(...xs), y0, Math.min(...zs)], max: [Math.max(...xs), y1, Math.max(...zs)],
      ...(o.faces ? { faces: o.faces } : {}), ...(o.solid === false ? { solid: false } : {}),
    } as BrushDef);
  }

  /** A thin bar from (x0, z0) to (x1, z1) in the x-z plane, `t` thick, spanning y0..y1. */
  barXZ(x0: number, z0: number, x1: number, z1: number, t: number, y0: number, y1: number, tex: string, o: Opts = {}): void {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, nx = (-dz / l) * t / 2, nz = (dx / l) * t / 2;
    this.prismY([[x0 - nx, z0 - nz], [x1 - nx, z1 - nz], [x1 + nx, z1 + nz], [x0 + nx, z0 + nz]], y0, y1, tex, o);
  }

  /** Round column/disc: a cylinder with enough segments for its radius. */
  cylinder(cx: number, cy: number, radius: number, z0: number, z1: number, tex: string, o: Opts = {}): void {
    this.prism(circle(cx, cy, radius, segs(radius)), z0, z1, tex, o);
  }

  light(origin: V3, props: Record<string, unknown>): void {
    this.entities.push({ id: 1000 + this.eid++, class: 'light', origin, props });
  }

  /** A model prop (models/<model>.json): `yaw` turns it about z (its front faces -y at 0 for imported glTF models). */
  prop(origin: V3, model: string, yaw = 0, scale = 1): void {
    this.entities.push({ id: 1000 + this.eid++, class: 'prop', origin, angles: [0, yaw, 0], props: { model, ...(scale !== 1 ? { scale } : {}) } });
  }

  start(origin: V3, pitch: number, yaw: number): void {
    this.entities.unshift({ id: 1, class: 'player_start', origin, angles: [pitch, yaw, 0] });
  }

  /** Run room paint, then write maps/<name>.json. */
  write(name: string, rooms: Room[], settings: Record<string, unknown>): void {
    const repainted = paintByRoom(this.brushes, rooms);
    writeFileSync(new URL(`../../maps/${name}.json`, import.meta.url), serializeMap({
      format: MAP_FORMAT, version: MAP_VERSION, name, brushes: this.brushes, entities: this.entities, settings,
    }));
    console.log(`wrote maps/${name}.json: ${this.brushes.length} brushes, ${this.entities.length} entities, ${repainted} faces repainted per room`);
  }
}

export const circle = (cx: number, cy: number, r: number, n: number): P2[] =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * Math.PI * 2), cy + r * Math.sin((i / n) * Math.PI * 2)] as P2);
