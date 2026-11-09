/**
 * maps/blank.json: an empty placeholder room the game boots into while the
 * new pipeline is built (docs/PIPELINE.md). The old maps live in junk/.
 * Run: npm run gen:blank
 */
import { MapBuilder } from './lib/build';

const m = new MapBuilder();
const W = 384, D = 384, H = 120, T = 8;
m.box([-T, -T, -16], [W + T, D + T, 0], 'office/carpet_blue');
m.box([-T, -T, H], [W + T, D + T, H + 16], 'office/plaster');
m.box([-T, -T, 0], [W + T, 0, H], 'office/plaster');
m.box([-T, D, 0], [W + T, D + T, H], 'office/plaster');
m.box([-T, 0, 0], [0, D, H], 'office/plaster');
m.box([W, 0, 0], [W + T, D, H], 'office/plaster');
m.light([W / 2, D / 2, H - 4], { type: 'bulb', lumens: 1600, kelvin: 3500 });
m.start([W / 2, 48, 0], 0, 90);
m.write('blank', [{ name: 'room', min: [0, 0, 0], max: [W, D, H], paint: 'office/plaster' }], {});
