import { MAP_FORMAT, type BrushDef, type EntityDef, type MapFile } from '../data/map';
import { sidePolygon } from '../data/convex';

/**
 * Collects what a generator makes (brushes, props, lights, glows) and turns it
 * into a map file. Brushes are Source-style convex solids with Hammer's
 * texture axes, so the Source light compiler (engine/light/vrad.ts) lights
 * them exactly as it lights an imported Portal 2 map.
 *
 * Units: inches, Z up. Angles: Source's [pitch, yaw, roll] (pitch down is
 * positive).
 */
export type V3 = [number, number, number];
export type Side = 'x-' | 'x+' | 'y-' | 'y+' | 'z-' | 'z+';
const SIDES: Side[] = ['x-', 'x+', 'y-', 'y+', 'z-', 'z+'];
export const NODRAW = 'tools/toolsnodraw';

export interface FaceOpts {
  /** Texture repeat: world units per texel (Hammer's texture scale). 0.25 = a 512 px texture covers 128 units. */
  scale?: number | [number, number];
  /** Units per lightmap pixel (Source default 16). Bigger = coarser light, far cheaper to bake. */
  lightmapscale?: number;
  /** Texture shift in texels. */
  shift?: [number, number];
}

export interface BoxOpts extends FaceOpts {
  /** One texture for every side, or per side (sides left out are not drawn). */
  tex: string | Partial<Record<Side, string>>;
  /** Source brush class: undefined = world (casts shadows, seals), 'func_detail' = detail (casts shadows), 'func_brush'... */
  group?: string;
  solid?: boolean;
  /** Per-side overrides of scale / lightmap scale. */
  sides?: Partial<Record<Side, FaceOpts>>;
}

/** Hammer's world-aligned texture axes for a face with this normal: [u axis, v axis]. */
function worldAxes(n: V3): [V3, V3] {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  if (az >= ax && az >= ay) return [[1, 0, 0], [0, -1, 0]];
  if (ax >= ay) return [[0, 1, 0], [0, 0, -1]];
  return [[1, 0, 0], [0, 0, -1]];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

export class MapOut {
  readonly brushes: BrushDef[] = [];
  readonly entities: EntityDef[] = [];
  private nextId = 1;
  /** Prefix put before every model and texture name (which converted asset set the map draws from). */
  constructor(readonly modelPrefix = 'p2lib/', readonly texPrefix = 'p2lib/') {}

  private tex(name: string): string {
    return name.startsWith('tools/') ? name : this.texPrefix + name;
  }

  private face(n: V3, tex: string, o: FaceOpts): Record<string, unknown> {
    const [u, v] = worldAxes(n);
    const sc = o.scale ?? 0.25, s: [number, number] = Array.isArray(sc) ? sc : [sc, sc];
    const f: Record<string, unknown> = { tex: this.tex(tex), uaxis: [...u, o.shift?.[0] ?? 0], vaxis: [...v, o.shift?.[1] ?? 0], scale: s };
    if (o.lightmapscale && o.lightmapscale !== 16) f.lightmapscale = o.lightmapscale;
    return f;
  }

  /**
   * With a filter set, only what belongs is written: a brush by the middle of
   * its bounds, anything else by its origin (the rest returns −1). A world
   * made lot by lot is built as a square of lots at a time, and each thing is
   * written once, by the lot its middle is in.
   */
  keep: ((p: V3) => boolean) | null = null;

  /** An axis-aligned box. */
  box(min: V3, max: V3, o: BoxOpts): number {
    if (this.keep && !this.keep([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2])) return -1;
    const planes: number[][] = [[-1, 0, 0, -min[0]], [1, 0, 0, max[0]], [0, -1, 0, -min[1]], [0, 1, 0, max[1]], [0, 0, -1, -min[2]], [0, 0, 1, max[2]]];
    const faces: Record<string, unknown> = {};
    SIDES.forEach((side, i) => {
      const t = typeof o.tex === 'string' ? o.tex : o.tex[side] ?? NODRAW;
      faces[String(i)] = this.face(planes[i].slice(0, 3) as V3, t, { scale: o.scale, lightmapscale: o.lightmapscale, shift: o.shift, ...o.sides?.[side] });
    });
    return this.push(planes, faces, o);
  }

  /**
   * Any convex solid: its bounding planes [nx, ny, nz, d] (inside: n·p ≤ d),
   * each with its texture (NODRAW to hide a side).
   */
  convex(planes: [number, number, number, number][], tex: string | string[], o: Omit<BoxOpts, 'tex' | 'sides'> = {}, middle?: V3): number {
    if (this.keep) {
      // Its middle: given, or the middle of its corners' bounds.
      let c = middle;
      if (!c) {
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        planes.forEach((_, k) => { for (const q of sidePolygon(planes, k)) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], q[a]); hi[a] = Math.max(hi[a], q[a]); } });
        c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
      }
      if (!this.keep(c)) return -1;
    }
    const faces: Record<string, unknown> = {};
    planes.forEach((p, i) => { faces[String(i)] = this.face([p[0], p[1], p[2]], typeof tex === 'string' ? tex : tex[i] ?? NODRAW, o); });
    return this.push(planes, faces, o);
  }

  /**
   * A straight bar of rectangular section from a to b, in any direction:
   * `wide` across (level), `deep` the other way. For braces and struts that
   * are not square to the grid.
   */
  bar(a: V3, b: V3, wide: number, deep: number, tex: string, o: Omit<BoxOpts, 'tex' | 'sides'> = {}): number {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const u: V3 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len, (b[2] - a[2]) / len];
    const flat = Math.hypot(u[0], u[1]);
    const s: V3 = flat < 1e-6 ? [1, 0, 0] : [u[1] / flat, -u[0] / flat, 0];                          // level, square to the bar
    const t: V3 = [s[1] * u[2] - s[2] * u[1], s[2] * u[0] - s[0] * u[2], s[0] * u[1] - s[1] * u[0]];   // square to both
    const dot = (p: V3, q: V3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    const pl = (n: V3, d: number): [number, number, number, number] => [n[0], n[1], n[2], d];
    const neg = (p: V3): V3 => [-p[0], -p[1], -p[2]];
    return this.convex([
      pl(s, dot(s, a) + wide / 2), pl(neg(s), -dot(s, a) + wide / 2),
      pl(t, dot(t, a) + deep / 2), pl(neg(t), -dot(t, a) + deep / 2),
      pl(u, dot(u, b)), pl(neg(u), -dot(u, a))], tex, o, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  }

  private push(planes: number[][], faces: Record<string, unknown>, o: { group?: string; solid?: boolean }): number {
    // Normals keep six places: at three, a slanted plane would drift by inches far from the origin.
    const b: Record<string, unknown> = { id: this.nextId++, type: 'convex', planes: planes.map((p) => [r6(p[0]), r6(p[1]), r6(p[2]), r3(p[3])]), faces };
    if (o.group) b.group = o.group;
    if (o.solid === false) b.solid = false;
    this.brushes.push(b as unknown as BrushDef);
    return b.id as number;
  }

  private ent(cls: string, origin: V3, angles: V3 | undefined, props: Record<string, unknown>): number {
    if (this.keep && !this.keep(origin)) return -1;
    const e: EntityDef = { id: 100000 + this.nextId++, class: cls, origin: origin.map(r3) as V3, props };
    if (angles) e.angles = angles.map(r3) as V3;
    this.entities.push(e);
    return e.id;
  }

  /** A model. `model` is the Source path without "models/" and ".mdl" (e.g. "props_bts/truss_512"). */
  prop(model: string, origin: V3, angles: V3 = [0, 0, 0], o: { skin?: number; scale?: number; solid?: boolean; noshadow?: boolean; dynamic?: boolean; /** Hollow, open-ended piece: draw the inside too. */ hollow?: boolean } = {}): number {
    const props: Record<string, unknown> = { model: `${this.modelPrefix}models/${model}.mdl`, skin: o.skin ?? 0, source_class: o.dynamic ? 'prop_dynamic' : 'prop_static' };
    if (o.scale && o.scale !== 1) props.scale = o.scale;
    if (o.solid === false) props.solid = false;
    if (o.noshadow) props.noshadow = true;
    if (o.hollow) props.twosided = true;
    return this.ent('prop', origin, angles, props);
  }

  /**
   * A Source point light. color 0..255, brightness as typed in Hammer.
   * fifty/zero: distances where it falls to half and to nothing (hard falloff:
   * it lights nothing past `zero`, which also keeps the bake fast).
   */
  light(origin: V3, color: V3, brightness: number, fifty: number, zero: number): number {
    return this.ent('light', origin, undefined, { type: 'source', source: {
      classname: 'light', _light: `${color[0]} ${color[1]} ${color[2]} ${brightness}`, _lighthdr: '-1 -1 -1 1', _lightscalehdr: '1',
      _fifty_percent_distance: String(fifty), _zero_percent_distance: String(zero), _hardfalloff: '1', style: '0' } });
  }

  /** A Source spotlight along [pitch, yaw, 0]: full inside `inner` degrees from its axis, nothing outside `cone`. */
  spot(origin: V3, angles: V3, color: V3, brightness: number, inner: number, cone: number, fifty: number, zero: number, exponent = 1): number {
    return this.ent('light', origin, undefined, { type: 'source', source: {
      classname: 'light_spot', _light: `${color[0]} ${color[1]} ${color[2]} ${brightness}`, _lighthdr: '-1 -1 -1 1', _lightscalehdr: '1',
      angles: `${angles[0]} ${angles[1]} ${angles[2]}`, pitch: String(angles[0]), _inner_cone: String(inner), _cone: String(cone), _exponent: String(exponent),
      _fifty_percent_distance: String(fifty), _zero_percent_distance: String(zero), _hardfalloff: '1', style: '0' } });
  }

  /** The glow seen on a lamp (env_sprite): see engine/render/glows.ts. size in units. */
  glow(origin: V3, color: V3, size: number, brightness = 1, tex = 'sprites/glow04'): number {
    return this.ent('glow', origin, undefined, { tex: this.tex(tex), size, color, brightness });
  }

  /** A spotlight's visible shaft and halo (point_spotlight): see engine/render/glows.ts. */
  beam(origin: V3, dir: V3, length: number, width: number, color: V3, brightness = 1): number {
    return this.ent('beam', origin, undefined, { dir, length, width, color, brightness, tex: this.tex('sprites/glow_test02'), halo: this.tex('sprites/light_glow03') });
  }

  /** A cable hanging from a to b; its middle sags `sag` units below the straight line (engine/render/ropes.ts). */
  rope(a: V3, b: V3, sag: number, width = 3): number {
    return this.ent('rope', a, undefined, { to: b.map(r3), sag: r3(sag), width });
  }

  /**
   * A lamp worked out per pixel with no bake (engine/render/lightGrid.ts).
   * color 0..255; brightness 1 = a surface right at it is fully lit; size:
   * the distance where that has halved; reach: it gives nothing past here.
   * dir/inner/cone: a spot (degrees from its axis). indoor: it hangs inside a
   * mass, and lights what it can see through the map's boxes of air (`air`).
   * open: it hangs in the open air (it does not light the inside of
   * lampShade boxes).
   */
  lamp(origin: V3, color: V3, brightness: number, size: number, reach: number, o: { dir?: V3; inner?: number; cone?: number; indoor?: boolean; open?: boolean } = {}): number {
    const props: Record<string, unknown> = { color, brightness, size, reach };
    if (o.dir) { props.dir = o.dir; props.cone = o.cone ?? 45; props.inner = o.inner ?? (o.cone ?? 45) / 2; }
    if (o.indoor) props.indoor = true;
    if (o.open) props.open = true;
    return this.ent('lamp', origin, undefined, props);
  }

  /**
   * Boxes of air cut out of a mass (its corridors, rooms and shafts): where
   * the light of the lamps inside can go. One entity for the lot.
   */
  air(boxes: { min: V3; max: V3 }[]): number {
    const lo = [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b.min[k]))), hi = [0, 1, 2].map((k) => Math.max(...boxes.map((b) => b.max[k])));
    return this.ent('lamp_air', [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] as V3, undefined, { boxes: boxes.flatMap((b) => [...b.min.map(r3), ...b.max.map(r3)]) });
  }

  /** A box whose inside lamps in the open do not light (a mass with rooms in it). */
  lampShade(min: V3, max: V3): number {
    return this.ent('lamp_shade', [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], undefined, { min: min.map(r3), max: max.map(r3) });
  }

  /** A box with fog of its own (any of the map's fog settings): the fog goes over to it while the camera is inside (game.ts). */
  fogVolume(min: V3, max: V3, fog: Record<string, unknown>): number {
    return this.ent('fog_volume', [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], undefined, { min: min.map(r3), max: max.map(r3), fog });
  }

  start(origin: V3, yaw = 0, pitch = 0): void {
    this.entities.unshift({ id: 1, class: 'player_start', origin, angles: [pitch, yaw, 0] });
  }

  /** Text in the world (engine/render/labels.ts), for debug views of a generated layout. */
  label(origin: V3, text: string, size: number, yaw = 0, plane: 'floor' | 'wall' = 'floor'): number {
    return this.ent('label', origin, [0, yaw, 0], { text, size, plane });
  }

  /**
   * Moves everything written so far by `d`. (A lot is built in the middle of
   * a square of lots, then moved so that places are measured from its own
   * corner. Textures are laid by world place and are not moved with it: a
   * move by whole lots leaves them where they were on every surface.)
   */
  shift(d: V3): void {
    const add = (v: number[], k = 0) => { v[k] = r3(v[k] + d[0]); v[k + 1] = r3(v[k + 1] + d[1]); v[k + 2] = r3(v[k + 2] + d[2]); };
    for (const b of this.brushes as unknown as { planes: number[][] }[]) for (const p of b.planes) p[3] = r3(p[3] + p[0] * d[0] + p[1] * d[1] + p[2] * d[2]);
    for (const e of this.entities) {
      add(e.origin);
      const q = (e.props ?? {}) as { to?: number[]; min?: number[]; max?: number[]; boxes?: number[] };
      if (q.to) add(q.to);
      if (q.min) add(q.min);
      if (q.max) add(q.max);
      if (q.boxes) for (let k = 0; k < q.boxes.length; k += 3) add(q.boxes, k);
    }
  }

  toMap(name: string, settings: Record<string, unknown>): MapFile {
    return { format: MAP_FORMAT, version: 1, name, settings, brushes: this.brushes, entities: this.entities };
  }
}
