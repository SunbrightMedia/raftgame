import type { Room } from './roomPaint';
export { PMP_ROOMS } from './pmpRooms';

/** Reference 3 (measured): a half-wall window into a low room whose floor is the main floor. */
export const NOOK_ROOMS: Room[] = [
  { name: 'front room', min: [0, 0, 0], max: [240, 170, 96], paint: 'nook/paint_tan' },
  { name: 'stairwell', min: [-23, 176, -108], max: [230, 306, 77], paint: 'nook/paint_tan' },
];

/** Reference 4: the trophy room and the arcade behind the window. */
export const REC_ROOMS: Room[] = [
  { name: 'trophy room', min: [0, 0, 0], max: [240, 300, 108], paint: 'rec/paint_green' },
  { name: 'arcade', min: [248, 0, 0], max: [560, 300, 108], paint: 'arcade/paint_dark' },
];

/** Reference 5 (measured): La Quinta atrium. */
export const LQ_ROOMS: Room[] = [
  { name: 'atrium', min: [32, -60, 0], max: [760, 648, 220], paint: 'lq/paint_beige' },
];
