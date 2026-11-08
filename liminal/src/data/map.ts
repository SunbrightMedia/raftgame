/**
 * The map file format: readable, versioned JSON. Z is up, units are inches.
 *
 * {
 *   "format": "liminal-map", "version": 1, "name": "...",
 *   "brushes": [ { "id": 1, "type": "box", "min": [x,y,z], "max": [x,y,z],
 *                  "tex": "dev/wall", "faces": { "pz": { "tex": "dev/floor", "scale": [1,1] } } } ],
 *   "entities": [ { "id": 100, "class": "player_start", "origin": [x,y,z], "angles": [pitch, yaw, roll] } ]
 * }
 *
 * Faces are keyed by outward direction: px/nx (+x/-x), py/ny, pz (top), nz (bottom).
 * Any face without an entry uses the brush's `tex`.
 */
export const MAP_FORMAT = 'liminal-map';
export const MAP_VERSION = 1;

export type V3 = [number, number, number];
export type FaceKey = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
export const FACE_KEYS: readonly FaceKey[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

export interface FaceTex {
  tex?: string;
  /** World units per texture pixel multiplier; 1 = the texture's natural size. */
  scale?: [number, number];
  /** In texture pixels. */
  offset?: [number, number];
  /** Degrees. */
  rot?: number;
}

export interface BoxBrushDef {
  id: number;
  type: 'box';
  min: V3;
  max: V3;
  tex?: string;
  faces?: Partial<Record<FaceKey, FaceTex>>;
  /** Group name, for show/hide and (Milestone 4) conditional visibility. */
  group?: string;
  /** Surface material for footsteps (Milestone 3). Defaults from the texture. */
  material?: string;
  /** Rendered and walkable? Non-solid brushes are for visuals only. */
  solid?: boolean;
}
export type BrushDef = BoxBrushDef;

export interface EntityDef {
  id: number;
  class: string;
  origin: V3;
  angles?: V3;
  props?: Record<string, unknown>;
}

export interface MapFile {
  format: typeof MAP_FORMAT;
  version: number;
  name: string;
  /** Per-map settings overrides (look/fog/audio). Applied on top of the user config. Milestone 3. */
  settings?: Record<string, unknown>;
  brushes: BrushDef[];
  entities: EntityDef[];
}

export class MapError extends Error {}

const isV3 = (v: unknown): v is V3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Validate an untrusted JSON value into a MapFile, upgrading older versions. */
export function parseMap(json: unknown): MapFile {
  if (!json || typeof json !== 'object') throw new MapError('map is not an object');
  const m = json as Record<string, unknown>;
  if (m.format !== MAP_FORMAT) throw new MapError(`not a ${MAP_FORMAT} file (format=${String(m.format)})`);
  const version = typeof m.version === 'number' ? m.version : 0;
  if (version > MAP_VERSION) throw new MapError(`map version ${version} is newer than this build supports (${MAP_VERSION})`);
  // Future: `if (version < 2) m = upgrade1to2(m)` chain goes here.

  const brushes: BrushDef[] = [];
  for (const [i, b] of (Array.isArray(m.brushes) ? m.brushes : []).entries()) {
    const r = b as Record<string, unknown>;
    if (r.type !== 'box') throw new MapError(`brush #${i}: unknown type ${String(r.type)}`);
    if (!isV3(r.min) || !isV3(r.max)) throw new MapError(`brush #${i}: min/max must be [x,y,z]`);
    const min: V3 = [Math.min(r.min[0], r.max[0]), Math.min(r.min[1], r.max[1]), Math.min(r.min[2], r.max[2])];
    const max: V3 = [Math.max(r.min[0], r.max[0]), Math.max(r.min[1], r.max[1]), Math.max(r.min[2], r.max[2])];
    brushes.push({
      id: typeof r.id === 'number' ? r.id : i + 1,
      type: 'box',
      min, max,
      tex: typeof r.tex === 'string' ? r.tex : undefined,
      faces: (r.faces && typeof r.faces === 'object' ? r.faces : undefined) as BoxBrushDef['faces'],
      group: typeof r.group === 'string' ? r.group : undefined,
      material: typeof r.material === 'string' ? r.material : undefined,
      solid: r.solid === false ? false : undefined,
    });
  }

  const entities: EntityDef[] = [];
  for (const [i, e] of (Array.isArray(m.entities) ? m.entities : []).entries()) {
    const r = e as Record<string, unknown>;
    if (typeof r.class !== 'string') throw new MapError(`entity #${i}: missing class`);
    if (!isV3(r.origin)) throw new MapError(`entity #${i}: origin must be [x,y,z]`);
    entities.push({
      id: typeof r.id === 'number' ? r.id : 10000 + i,
      class: r.class,
      origin: r.origin,
      angles: isV3(r.angles) ? r.angles : undefined,
      props: (r.props && typeof r.props === 'object' ? r.props : undefined) as Record<string, unknown> | undefined,
    });
  }

  return {
    format: MAP_FORMAT,
    version: MAP_VERSION,
    name: typeof m.name === 'string' ? m.name : 'untitled',
    settings: (m.settings && typeof m.settings === 'object' ? m.settings : undefined) as Record<string, unknown> | undefined,
    brushes,
    entities,
  };
}

export function faceTex(b: BrushDef, face: FaceKey): Required<FaceTex> {
  const f = b.faces?.[face] ?? {};
  return {
    tex: f.tex ?? b.tex ?? 'dev/gray',
    scale: f.scale ?? [1, 1],
    offset: f.offset ?? [0, 0],
    rot: f.rot ?? 0,
  };
}

/**
 * Pretty-print a map with one brush/entity per line: readable, and diffs in
 * git show exactly which brushes changed.
 */
export function serializeMap(m: MapFile): string {
  const line = (o: unknown) => '    ' + JSON.stringify(o);
  const head: Record<string, unknown> = { format: m.format, version: m.version, name: m.name };
  const parts = [
    '{',
    Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n'),
  ];
  if (m.settings && Object.keys(m.settings).length) parts.push(`  "settings": ${JSON.stringify(m.settings)},`);
  parts.push('  "brushes": [', m.brushes.map(line).join(',\n'), '  ],');
  parts.push('  "entities": [', m.entities.map(line).join(',\n'), '  ]');
  parts.push('}');
  return parts.filter((p) => p !== '').join('\n') + '\n';
}
