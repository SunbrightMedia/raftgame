import type { Room } from '../lib/roomPaint';

/** The house realism test's rooms and their wall paint (tools/house/gen-house-test.ts). */
export const HOUSE_H = 96;
export const HOUSE_TEST_ROOMS: Room[] = [
  { name: 'A: the long room', min: [0, 0, 0], max: [384, 168, HOUSE_H], paint: 'house6/paint_cream' },
  { name: 'B: the green room', min: [389, 60, 0], max: [581, 232, HOUSE_H], paint: 'pmp/paint_mint' },
  { name: 'C: the dark hall', min: [58, -269, 0], max: [98, -5, HOUSE_H], paint: 'house6/paint_cream' },
];
