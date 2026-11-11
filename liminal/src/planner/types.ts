import type { BBox, Frame, V2 } from './geom';

/** Everything the generator draws. All points are in world tiles (1 tile = 2 ft). */
export type Prim =
  | { t: 'floor'; pts: V2[]; zone: number; corr?: boolean }
  /** A thin wall piece. `kind`: short = stops below the ceiling, bars = see-through, glass = window, over = overhead only (an arch or beam, drawn dashed, you walk under it). */
  | { t: 'wall'; a: V2; b: V2; w: number; zone: number; kind?: 'short' | 'bars' | 'glass' | 'fake' | 'over'; closed?: boolean }
  /** Something you cannot walk through: a pillar, a solid block, a closed mass. */
  | { t: 'solid'; pts: V2[]; zone: number; kind: 'pillar' | 'block' | 'mass' | 'furniture'; closed?: boolean }
  /** A floor overlay: water, pool, pit, lawn, road, grate, tile, carpet patch. */
  | { t: 'area'; pts: V2[]; zone: number; kind: AreaKind }
  /** Steps or a ramp. `dir` points downhill. */
  | { t: 'stairs'; pts: V2[]; dir: number; steps: number; zone: number; ramp?: boolean; impossible?: boolean }
  | { t: 'light'; p: V2; zone: number; kind?: 'off' | 'flicker' | 'emergency' }
  /** A small symbol: furniture, doors, signs, vents. `s` = size in tiles. */
  | { t: 'mark'; p: V2; a: number; s: number; zone: number; kind: MarkKind; label?: string }
  /** Layer 2 (above the ceiling): ducts and crawlspaces as centre lines. */
  | { t: 'duct'; pts: V2[]; kind: 'duct' | 'crawl'; w: number }
  | { t: 'label'; p: V2; text: string; zone: number; size?: number };

export type AreaKind = 'water' | 'pool' | 'pit' | 'lawn' | 'path' | 'road' | 'walk' | 'grate' | 'tile' | 'stage' | 'dark' | 'field' | 'crevice';

export type MarkKind =
  | 'seat' | 'pew' | 'sofa' | 'table' | 'desk' | 'bed' | 'shelf' | 'car' | 'boiler' | 'tank' | 'pipe' | 'fan'
  | 'door' | 'stuckdoor' | 'gate' | 'window' | 'fakewindow' | 'shopfront' | 'exit' | 'vent' | 'hatch' | 'wires'
  | 'lift' | 'sign' | 'counter' | 'tree' | 'bench' | 'fountain' | 'portal' | 'cupboard' | 'arrow' | 'note' | 'plant'
  | 'crate' | 'pooltable' | 'stage' | 'mannequin';

export type LinkKind = 'open' | 'corridor' | 'bent' | 'curved' | 'long' | 'narrow' | 'stair' | 'ramp' | 'wrap' | 'portal' | 'impossible';

export interface Port {
  /** Local position on the zone's edge and the outward normal angle (local). */
  p: V2;
  a: number;
  w: number;
  link: number;
}

export interface Zone {
  id: number;
  /** Stable key: same seed and settings give the same key to the same zone. */
  key: string;
  feature: string;
  frame: Frame;
  w: number;
  h: number;
  seed: number;
  theme: string;
  /** Floor step: 0 is the base floor; ± a few steps (one story). */
  level: number;
  tags: string[];
  ports: Port[];
  parent: number;
  depth: number;
  pinned?: boolean;
  /** Edge features on this zone's outer walls (stuck door, window wall, ...). */
  edges: string[];
}

export interface Link {
  id: number;
  a: number;
  b: number;
  kind: LinkKind;
  /** Centre line in world tiles; empty for 'open' (rooms that touch) and portals. */
  path: V2[];
  w: number;
  loop: boolean;
  /** Edge feature at this link (stuck door, gate, ...) */
  edge?: string;
}

export interface Params {
  seed: number;
  /** Map radius in tiles (a size of 300 = 600 ft across). */
  size: number;
  /** 0 = every wall on one grid (maps 2–5); 1 = groups turned like map 1. */
  turn: number;
  /** How full the map is (0–1). */
  density: number;
  /** Share of extra loop corridors (0–1). */
  loops: number;
  /** Branches that stop (0–1). */
  deadEnds: number;
  /** Rooms joined by corridors instead of touching (0–1). */
  corridors: number;
  /** Long runs to far groups (0–1). */
  longRuns: number;
  /** Landmark rooms (0–1). */
  landmarks: number;
  /** Themed districts (0–1). */
  themes: number;
  /** Floor height changes, stairs and ramps (0–1). */
  heights: number;
  /** Impossible links and wrongness (0–1). */
  anomalies: number;
  /** Feature weights by id (missing = default, 0 = off). */
  weights: Record<string, number>;
}

export interface ZoneEdit {
  feature?: string;
  x?: number; y?: number; a?: number;
  w?: number; h?: number;
  seed?: number;
  theme?: string;
  level?: number;
  tags?: string[];
  deleted?: boolean;
}

export interface AddedZone { key: string; feature: string; x: number; y: number; a: number; w?: number; h?: number }

export interface Note { x: number; y: number; text: string }

/** The user's hand edits on top of a generated map. */
export interface Edits {
  zones: Record<string, ZoneEdit>;
  added: AddedZone[];
  notes: Note[];
}

export interface Stats {
  zones: number;
  links: number;
  loops: number;
  deadEnds: number;
  reached: number;
  /** Zones that cannot be walked to from the hub. */
  cutOff: number[];
  floorShare: number;
  landmarks: number;
  dropped: number;
  ms: number;
  widthFt: number;
  heightFt: number;
}

export interface MapOut {
  params: Params;
  zones: Zone[];
  links: Link[];
  prims: Prim[];
  bounds: BBox;
  stats: Stats;
}
