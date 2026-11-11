/**
 * The feature catalogue (docs/BACKROOMS_MAPS.md section 4). Every feature is
 * one "node": zones are built by a recipe in recipes.ts, links by the placer
 * in generate.ts, tags and edges are added to zones, layer-2 parts above the
 * ceiling. Sizes are in tiles (1 tile = 2 ft).
 */
export type Group = 'Passages' | 'Rooms' | 'Grid halls' | 'Wall fields' | 'Edges' | 'Floors and ceilings' | 'Landmarks' | 'Above the ceiling' | 'Impossible';

/**
 * zone: a recipe builds it. link: joins two zones. tag: changes a zone.
 * edge: sits on a zone's wall or a link. layer2: above the ceiling.
 */
export type Kind = 'zone' | 'link' | 'tag' | 'edge' | 'layer2';

/** Which zones a feature can be: the hub of the map, a plain part, the end of a branch. */
export type Role = 'hub' | 'part' | 'end' | 'landmark';

export interface Feature {
  id: string;
  n: number;
  name: string;
  group: Group;
  kind: Kind;
  role?: Role;
  /** Size range in tiles (zones). */
  w?: [number, number];
  h?: [number, number];
  /** Default weight (0 = off by default). */
  weight: number;
  /** Zones of one family should not sit next to each other. */
  family?: string;
  theme?: string;
  /** Which maps it was seen in. */
  src: string;
  desc: string;
}

const F = (n: number, id: string, name: string, group: Group, kind: Kind, weight: number, src: string, desc: string, more: Partial<Feature> = {}): Feature =>
  ({ n, id, name, group, kind, weight, src, desc, ...more });

export const FEATURES: Feature[] = [
  // Passages
  F(1, 'corridor', 'Corridor', 'Passages', 'link', 1, 'A–E', 'Straight, 2–3 tiles wide, lights down the middle.'),
  F(2, 'bent', 'Bent corridor', 'Passages', 'link', 0.3, 'A–E', 'Turns at right angles on the zone grid.'),
  F(3, 'curved', 'Curved corridor', 'Passages', 'link', 0.15, 'A, D, E', 'An arc between two zones.'),
  F(4, 'long', 'Long run', 'Passages', 'link', 0.25, 'A, E', 'A very long straight corridor to a far group.'),
  F(5, 'narrow', 'Narrow passage', 'Passages', 'link', 0.15, 'A', 'One tile wide or less.'),
  F(6, 'ring', 'Ring corridor', 'Passages', 'zone', 0.25, 'A, D', 'A loop around a solid core.', { role: 'part', w: [12, 20], h: [12, 20], family: 'passage' }),
  F(7, 'wrap', 'Wrap corridor', 'Passages', 'link', 0.15, 'B, D', 'Runs along the outside of a zone.'),
  F(8, 'deadend', 'Dead end', 'Passages', 'zone', 0.6, 'A, D, E', 'A branch that stops; something waits at the end.', { role: 'end', w: [3, 5], h: [3, 6], family: 'end' }),
  F(9, 'knot', 'Corridor knot', 'Passages', 'zone', 0.35, 'E', 'A small tangle of corridors with loops.', { role: 'part', w: [14, 22], h: [14, 22], family: 'passage' }),
  F(10, 'comb', 'Comb', 'Passages', 'zone', 0.35, 'B, C', 'Narrow rooms side by side off one corridor.', { role: 'part', w: [18, 30], h: [9, 13], family: 'cells' }),
  F(11, 'stair', 'Stair run', 'Passages', 'link', 0.3, 'A, B, D', 'Steps up or down inside the one story.'),
  F(12, 'ramp', 'Ramp', 'Passages', 'link', 0.2, 'A, D', 'A sloped passage.'),
  // Rooms
  F(13, 'room', 'Room', 'Rooms', 'zone', 1.4, 'A–E', 'A plain room with 1–4 openings.', { role: 'part', w: [5, 12], h: [5, 12], family: 'room' }),
  F(14, 'oddroom', 'Odd room', 'Rooms', 'zone', 0.8, 'A', 'Two to four boxes joined: "very irregularly shaped".', { role: 'part', w: [7, 15], h: [7, 15], family: 'room' }),
  F(15, 'group', 'Room group', 'Rooms', 'zone', 1.6, 'A', 'Rooms on one grid, cut into each other, turned as a whole.', { role: 'part', w: [16, 32], h: [14, 28], family: 'group' }),
  F(16, 'chain', 'Room chain', 'Rooms', 'zone', 0.6, 'A, B', 'Rooms in a row, each opening into the next.', { role: 'part', w: [22, 40], h: [7, 11], family: 'cells' }),
  F(17, 'cells', 'Cell block', 'Rooms', 'zone', 0.7, 'B, C, E, F', 'Small rooms on both sides of a corridor (offices, classrooms).', { role: 'part', w: [18, 32], h: [13, 19], family: 'cells' }),
  F(18, 'cubicles', 'Cubicle grid', 'Rooms', 'zone', 0.45, 'B', 'A grid of cubicles with low partitions.', { role: 'part', w: [14, 26], h: [12, 22], family: 'cells' }),
  F(19, 'tinyroom', 'Tiny-entrance room', 'Rooms', 'zone', 0.25, 'A', 'Reached only through very small openings.', { role: 'part', w: [6, 10], h: [6, 10], family: 'room' }),
  F(20, 'longroom', 'Long room', 'Rooms', 'zone', 0.3, 'A', 'An extremely long, narrow room.', { role: 'part', w: [30, 64], h: [4, 7], family: 'long' }),
  F(21, 'huge', 'Huge empty hall', 'Rooms', 'zone', 0.25, 'A', 'The largest space, with nothing in it.', { role: 'hub', w: [44, 90], h: [32, 64], family: 'hall' }),
  F(22, 'openplan', 'Open plan', 'Rooms', 'zone', 0.8, 'A', 'Big rooms joined by partial walls.', { role: 'hub', w: [24, 44], h: [20, 36], family: 'hall' }),
  F(23, 'oddhall', 'Big odd hall', 'Rooms', 'zone', 0.4, 'E', 'A large irregular hall with thin walls inside.', { role: 'hub', w: [26, 46], h: [20, 36], family: 'hall' }),
  // Grid halls
  F(24, 'pluspillars', 'Plus-pillar hall', 'Grid halls', 'zone', 0.6, 'B, D, E', 'Plus-shaped pillars on a 12 ft grid.', { role: 'hub', w: [30, 72], h: [24, 54], family: 'grid' }),
  F(25, 'squarepillars', 'Square-pillar hall', 'Grid halls', 'zone', 0.5, 'D, R', 'Small square pillars on a grid, a few out of line.', { role: 'hub', w: [20, 40], h: [16, 30], family: 'grid' }),
  F(26, 'bayhall', 'Bay hall', 'Grid halls', 'zone', 0.35, 'E', 'A pillar hall whose walls make a bay at every column.', { role: 'hub', w: [42, 80], h: [14, 24], family: 'grid' }),
  F(27, 'checker', 'Checker hall', 'Grid halls', 'zone', 0.3, 'B', 'Solid blocks on every other cell, like a chess board.', { role: 'hub', w: [20, 38], h: [20, 38], family: 'grid' }),
  F(28, 'arches', 'Arch room', 'Grid halls', 'zone', 0.3, 'R', 'Arches in a row; at dead ends and between zones.', { role: 'part', w: [14, 26], h: [6, 10], family: 'long' }),
  F(29, 'holes', 'Hole cluster', 'Grid halls', 'zone', 0.2, 'C, R', 'A dense grid of holes or grates in the floor.', { role: 'part', w: [12, 22], h: [12, 22], family: 'grid' }),
  // Wall fields
  F(30, 'wallfield', 'Wall-piece field', 'Wall fields', 'zone', 0.9, 'E, D', 'Free-standing T, L, I pieces on a coarse grid: the classic maze of walls.', { role: 'hub', w: [18, 32], h: [18, 32], family: 'field' }),
  F(31, 'islands', 'Wall islands', 'Wall fields', 'zone', 0.5, 'B, C', 'Solid blocks standing in an open area.', { role: 'hub', w: [18, 34], h: [16, 30], family: 'field' }),
  F(32, 'maze', 'Thin maze', 'Wall fields', 'zone', 0.35, 'C, E', 'A true maze of thin walls inside a box.', { role: 'part', w: [14, 26], h: [14, 26], family: 'field' }),
  F(33, 'shortwalls', 'Short walls', 'Wall fields', 'tag', 0.06, 'A', 'Walls stop short of the ceiling (drawn dashed).'),
  F(34, 'sawtooth', 'Sawtooth wall', 'Wall fields', 'zone', 0.3, 'D, A', 'A room with a stepped, zig-zag outline.', { role: 'part', w: [10, 20], h: [8, 16], family: 'room' }),
  F(35, 'wedge', 'Wedge walls', 'Wall fields', 'zone', 0.25, 'D, C', 'Angled walls: a hexagon room, bow-tie wedges.', { role: 'part', w: [12, 22], h: [8, 14], family: 'room' }),
  F(36, 'mass', 'Solid mass', 'Wall fields', 'zone', 0.3, 'A, B, D', 'A block you cannot enter; may hide an unreachable room.', { role: 'end', w: [6, 16], h: [6, 16], family: 'mass' }),
  // Edges
  F(37, 'carpetchange', 'Carpet change', 'Edges', 'edge', 0.5, 'A', 'A line where floor and wall finish change.'),
  F(38, 'stuckdoor', 'Stuck door', 'Edges', 'edge', 0.04, 'A', 'A rare real door that does not open.'),
  F(39, 'blocked', 'Blocked opening', 'Edges', 'edge', 0.03, 'A', 'An opening filled by a cupboard.'),
  F(40, 'gate', 'Bar gate', 'Edges', 'edge', 0.03, 'A, R', 'Bars across a passage; you can see through.'),
  F(41, 'windowwall', 'Window wall', 'Edges', 'edge', 0.03, 'A', 'A wall of windows to an outside you cannot reach.'),
  F(42, 'fakewindow', 'Fake window', 'Edges', 'edge', 0.05, 'A', 'Painted windows, or curtains over brick.'),
  F(43, 'shopfront', 'Shop front', 'Edges', 'edge', 0.03, 'A, D', 'A store front set into a wall.'),
  // Floors and ceilings
  F(44, 'sloped', 'Sloped floor', 'Floors and ceilings', 'tag', 0.03, 'A', 'The floor tilts; walls may lean.'),
  F(45, 'splitlevel', 'Split level', 'Floors and ceilings', 'tag', 0.05, 'A, F', 'A raised or sunken part, a balcony, a few steps.'),
  F(46, 'ceilingdrop', 'Ceiling drop', 'Floors and ceilings', 'tag', 0.02, 'A', 'The ceiling gets lower until it meets the floor.'),
  F(47, 'tall', 'Tall room', 'Floors and ceilings', 'tag', 0.05, 'A', 'A very high ceiling.'),
  F(48, 'low', 'Low room', 'Floors and ceilings', 'tag', 0.05, 'A', 'A low concrete ceiling (basement feel).'),
  F(49, 'noceiling', 'No ceiling', 'Floors and ceilings', 'tag', 0.02, 'A', 'Walls rise into darkness.'),
  F(50, 'pit', 'Pit', 'Floors and ceilings', 'tag', 0.03, 'A, C', 'A square hole or a deep crevice in the floor.'),
  F(51, 'flooded', 'Flooded rooms', 'Floors and ceilings', 'tag', 0.03, 'A, R', 'The floor slopes down into standing water.'),
  // Landmarks
  F(52, 'pool', 'Pool room', 'Landmarks', 'zone', 0.5, 'A, D, R', 'A tiled pool, maybe "bottomless".', { role: 'landmark', w: [16, 28], h: [12, 20], family: 'landmark', theme: 'tile' }),
  F(53, 'theatre', 'Theatre', 'Landmarks', 'zone', 0.4, 'A, C', 'Seats in rows or an arc facing one wall.', { role: 'landmark', w: [16, 24], h: [14, 20], family: 'landmark' }),
  F(54, 'church', 'Church hall', 'Landmarks', 'zone', 0.3, 'A', 'A long hall with pews in rows.', { role: 'landmark', w: [12, 16], h: [24, 36], family: 'landmark', theme: 'wood' }),
  F(55, 'machine', 'Machine room', 'Landmarks', 'zone', 0.4, 'A', 'Boiler room, cistern, a tall room with a huge pipe.', { role: 'landmark', w: [12, 20], h: [10, 16], family: 'landmark', theme: 'concrete' }),
  F(56, 'house', 'House inside', 'Landmarks', 'zone', 0.3, 'A, F', 'A whole normal house inside the maze.', { role: 'landmark', w: [16, 22], h: [12, 18], family: 'landmark', theme: 'house' }),
  F(57, 'park', 'Indoor park', 'Landmarks', 'zone', 0.25, 'C, F', 'Lawns, paths and a round plaza under the ceiling.', { role: 'landmark', w: [26, 40], h: [22, 34], family: 'landmark', theme: 'park' }),
  F(58, 'farm', 'Fake outdoors end', 'Landmarks', 'zone', 0.3, 'E, A', 'A corridor ends in a fake field.', { role: 'end', w: [14, 22], h: [10, 16], family: 'landmark', theme: 'field' }),
  F(59, 'street', 'Indoor street', 'Landmarks', 'zone', 0.2, 'E, F', 'A road with rooms or fronts on both sides.', { role: 'landmark', w: [40, 70], h: [16, 20], family: 'landmark', theme: 'street' }),
  F(60, 'backarea', 'Back area', 'Landmarks', 'zone', 0.45, 'A, E, F', 'Grey concrete rooms with pipes and vents.', { role: 'part', w: [16, 28], h: [12, 22], family: 'back', theme: 'concrete' }),
  // Above the ceiling
  F(61, 'plenum', 'Plenum', 'Above the ceiling', 'layer2', 1, 'video, A', 'The space above the ceiling tiles.'),
  F(62, 'duct', 'Duct', 'Above the ceiling', 'layer2', 1, 'A', 'A crawlable air duct along the corridors.'),
  F(63, 'vent', 'Vent grate', 'Above the ceiling', 'layer2', 1, 'A', 'A grate in a wall or ceiling into a duct.'),
  F(64, 'crawl', 'Crawlspace', 'Above the ceiling', 'layer2', 1, 'A', 'A belly-crawl link between two rooms.'),
  F(65, 'hatch', 'Ceiling hatch', 'Above the ceiling', 'layer2', 1, 'video', 'A missing tile or hatch to climb up.'),
  // Impossible
  F(66, 'portal', 'Portal', 'Impossible', 'link', 0.3, 'D, A', 'An opening that leads to a far place.'),
  F(67, 'circle', 'Circle route', 'Impossible', 'tag', 0.03, 'A', 'Exit signs that lead back to the start.'),
  F(68, 'repeat', 'Repeat rooms', 'Impossible', 'tag', 0.03, 'A', 'A room that is a copy of another one nearby.'),
  F(69, 'impossible', 'Impossible stairs', 'Impossible', 'link', 0.2, 'A', 'Stairs that go down and arrive on the same level.'),
  F(70, 'melted', 'Melted room', 'Impossible', 'tag', 0.015, 'A', 'Smeared walls and pattern. (Also: monochrome.)'),
  F(71, 'dark', 'Dark room', 'Floors and ceilings', 'tag', 0.05, 'A', 'No lights work here: "almost pitch black".'),
];

export const FEATURE: Record<string, Feature> = Object.fromEntries(FEATURES.map((f) => [f.id, f]));

export const GROUPS: Group[] = ['Passages', 'Rooms', 'Grid halls', 'Wall fields', 'Edges', 'Floors and ceilings', 'Landmarks', 'Above the ceiling', 'Impossible'];

/** Floor colours in the clean-plan look of map 1. */
export interface Theme { id: string; name: string; floor: string; line: string }

export const THEMES: Theme[] = [
  { id: 'base', name: 'Base beige', floor: '#e8d0a8', line: '#a8916a' },
  { id: 'yellow', name: 'Yellow beige', floor: '#e8cc8c', line: '#a88f55' },
  { id: 'light', name: 'Light beige', floor: '#ecdcba', line: '#ab9a77' },
  { id: 'tan', name: 'Tan', floor: '#d8ba8c', line: '#987c52' },
  { id: 'office', name: 'Office pink-grey', floor: '#d8c8c8', line: '#9a8686' },
  { id: 'concrete', name: 'Grey concrete', floor: '#c4c4c4', line: '#858585' },
  { id: 'hotel', name: 'Blue hotel carpet', floor: '#aab8cc', line: '#6f7d92' },
  { id: 'red', name: 'Red rooms', floor: '#d69696', line: '#975858' },
  { id: 'green', name: 'Leafy green', floor: '#b8cca0', line: '#7a8f62' },
  { id: 'wood', name: 'Wood floors', floor: '#a88a72', line: '#6b5240' },
  { id: 'mono', name: 'Monochrome', floor: '#f4f4f4', line: '#9a9a9a' },
  { id: 'house', name: 'House', floor: '#e6a082', line: '#a5654a' },
  { id: 'melted', name: 'Melted cream', floor: '#efe7c8', line: '#b0a67c' },
  { id: 'tile', name: 'White tile', floor: '#dfe6e8', line: '#8f9ea3' },
  { id: 'park', name: 'Park', floor: '#c9c2a6', line: '#857e62' },
  { id: 'field', name: 'Fake field', floor: '#c7d49b', line: '#7d8a55' },
  { id: 'street', name: 'Street', floor: '#b9b1a5', line: '#6f675c' },
];

export const THEME: Record<string, Theme> = Object.fromEntries(THEMES.map((t) => [t.id, t]));

/** Themes a district may take (the special ones belong to landmarks). */
export const DISTRICT_THEMES = ['yellow', 'light', 'tan', 'office', 'concrete', 'hotel', 'red', 'green', 'wood'];

export const ZONE_FEATURES = FEATURES.filter((f) => f.kind === 'zone');
export const TAG_FEATURES = FEATURES.filter((f) => f.kind === 'tag');
export const EDGE_FEATURES = FEATURES.filter((f) => f.kind === 'edge' && f.id !== 'carpetchange');
