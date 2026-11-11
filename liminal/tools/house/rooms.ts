import type { Room } from '../lib/roomPaint';

/** The house realism test's rooms and their wall paint (tools/house/gen-house-test.ts). */
export const HOUSE_H = 96;
export const HOUSE_TEST_ROOMS: Room[] = [
  { name: 'A: the long room', min: [0, 0, 0], max: [384, 168, HOUSE_H], paint: 'house6/paint_cream' },
  { name: 'B: the green room', min: [389, 60, 0], max: [581, 232, HOUSE_H], paint: 'pmp/paint_mint' },
  { name: 'C: the dark hall', min: [58, -269, 0], max: [98, -5, HOUSE_H], paint: 'house6/paint_cream' },
];

/** The "Infinite house" frames' rooms (tools/house/gen-house-iv.ts); one paint, so only the extents matter. */
export const HOUSE_IV_ROOMS: Room[] = [
  { name: 'K: kitchenette room', min: [-200, -150, 0], max: [380, 189, 101], paint: 'house6/paint_ivory' },
  { name: 'F: fireplace room', min: [882, 120, 0], max: [1070, 239, 115.5], paint: 'house6/paint_ivory' },
  { name: 'F: passage', min: [934, -100, 0], max: [1051, 120, 115.5], paint: 'house6/paint_ivory' },
  { name: 'D: hall, near part', min: [1888, -80, 0], max: [2040, 142, 115], paint: 'house6/paint_ivory' },
  { name: 'D: hall, far part', min: [1910, 142, 0], max: [2040, 312, 115], paint: 'house6/paint_ivory' },
];
