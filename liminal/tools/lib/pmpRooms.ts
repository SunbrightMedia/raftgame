import type { Room } from './roomPaint';

/** The PMP basement's rooms and their wall paint (STYLE.md reference 1). */
export const PMP_ROOMS: Room[] = [
  { name: 'blue room', min: [0, 0, 0], max: [240, 216, 96], paint: 'pmp/paint_mint' },
  { name: 'fern den', min: [-150, 100, 0], max: [-6, 236, 92], paint: 'pmp/paint_mint' },
  { name: 'pink bar room', min: [6, 222, 0], max: [300, 420, 112], paint: 'pmp/paint_warmwhite' },
];
