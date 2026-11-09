import type { Room } from './roomPaint';
export { PMP_ROOMS } from './pmpRooms';

/** Reference 3: the lit niche. */
export const NOOK_ROOMS: Room[] = [
  { name: 'nook room', min: [0, 0, 0], max: [168, 180, 96], paint: 'nook/paint_tan' },
  { name: 'niche', min: [36, 180, 30], max: [120, 228, 90], paint: 'nook/paint_tan' },
];

/** Reference 4: the trophy room and the arcade behind the window. */
export const REC_ROOMS: Room[] = [
  { name: 'trophy room', min: [0, 0, 0], max: [240, 300, 108], paint: 'rec/paint_green' },
  { name: 'arcade', min: [248, 0, 0], max: [560, 300, 108], paint: 'arcade/paint_dark' },
];

/** Reference 5: La Quinta atrium (one paint throughout). */
export const LQ_ROOMS: Room[] = [
  { name: 'atrium', min: [0, 0, 0], max: [420, 290, 240], paint: 'lq/paint_beige' },
  { name: 'ground corridor', min: [0, 290, 0], max: [260, 360, 112], paint: 'lq/paint_beige' },
  { name: 'upper corridor', min: [0, 250, 120], max: [260, 360, 240], paint: 'lq/paint_beige' },
];
