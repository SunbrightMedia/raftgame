/**
 * Generates maps/flatgrass.json: gm_flatgrass's exact solid geometry
 * (tools/flatgrass.geometry.json, measured from the map file: a 30,720-unit
 * square of grass, the 2048×2048×512 platform and the room inside it), with
 * our own CC0 textures, a sun and an open sky. Run: npm run gen:flatgrass
 *
 * Sun from the map's light_environment: pitch -60°, yaw 242°, colour
 * 248 244 237. Fog from its env_fog_controller: 100 125 130, out to 90000.
 * The 56 slices of the hidden room's vaulted ceiling are boxes here (our
 * brushes extrude along Z only), so that ceiling steps instead of curving.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { type BrushDef, type EntityDef, MAP_FORMAT, MAP_VERSION, serializeMap } from '../src/data/map';

type Src = { type: 'box'; min: number[]; max: number[]; tex: string; faces: Record<string, { tex: string }> }
  | { type: 'prism'; points: [number, number][]; z0: number; z1: number; tex: string; faces: Record<string, { tex: string }> };
const geo = JSON.parse(readFileSync(new URL('./flatgrass.geometry.json', import.meta.url), 'utf8')) as { brushes: Src[] };

const brushes: BrushDef[] = [];
let id = 1;
for (const b of geo.brushes) {
  const faces = Object.keys(b.faces).length ? { faces: b.faces } : {};
  if (b.type === 'box') brushes.push({ id: id++, type: 'box', min: b.min, max: b.max, tex: b.tex, ...faces } as BrushDef);
  else {
    const xs = b.points.map((p) => p[0]), ys = b.points.map((p) => p[1]);
    brushes.push({ id: id++, type: 'prism', points: b.points, z0: b.z0, z1: b.z1, tex: b.tex,
      min: [Math.min(...xs), Math.min(...ys), b.z0], max: [Math.max(...xs), Math.max(...ys), b.z1], ...faces } as BrushDef);
  }
}

const entities: EntityDef[] = [
  // The map's first spawn point (-512, 576, -12287) → z + 12800.
  // Where the reference photo was taken: out in the field facing the platform's
  // opening, ~11,600 units away (from the platform's apparent size in the photo:
  // 512 tall over ~123 px, 2048 wide over ~405 px → a ~21° lens; at FOV 90 it
  // looks smaller than in the photo).
  { id: 1, class: 'player_start', origin: [600, 11600, 0], angles: [0, -90, 0] },
  // Clear midday sun, 60° up: ~90,000 lx on a surface facing it. 5600 K ≈ the map's 248 244 237.
  { id: 2, class: 'light', origin: [0, 0, 0], props: { type: 'sun', pitch: -60, yaw: 242, lux: 90000, kelvin: 5600 } },
];

writeFileSync(new URL('../maps/flatgrass.json', import.meta.url), serializeMap({
  format: MAP_FORMAT, version: MAP_VERSION, name: 'flatgrass', brushes, entities,
  settings: {
    // Huge faces: coarse luxels keep the bake quick; the platform's faces get finer ones automatically.
    light: { luxelSize: 128, skyLuminance: 7000, skyZenith: '#3a5cb2', skyHorizon: '#e4e8ec' },
    // Fog = the horizon colour at the sky's brightness there (7000 / 0.25), so far grass melts into the sky.
    // Aerial haze: the photo's structure is low-contrast blue-grey, half dissolved
    // into the sky. The haze is dimmer than the horizon sky (a bright haze washed
    // the whole field white) and starts past arm's length.
    fog: { enabled: true, haze: true, color: '#c9d2dc', luminance: 9000, near: 1500, far: 120000 },
    render: { tileBreakup: 0.35 },
    // Grain over everything, sky included, as in the photo.
    camera: { flash: false, whiteBalanceK: 5600, grain: 0.35 },
  },
}));
console.log(`wrote maps/flatgrass.json: ${brushes.length} brushes`);
