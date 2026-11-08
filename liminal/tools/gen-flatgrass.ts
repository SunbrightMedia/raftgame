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
  { id: 1, class: 'player_start', origin: [-512, 576, 513], angles: [0, 0, 0] },
  // Clear midday sun, 60° up: ~90,000 lx on a surface facing it. 5600 K ≈ the map's 248 244 237.
  { id: 2, class: 'light', origin: [0, 0, 0], props: { type: 'sun', pitch: -60, yaw: 242, lux: 90000, kelvin: 5600 } },
];

writeFileSync(new URL('../maps/flatgrass.json', import.meta.url), serializeMap({
  format: MAP_FORMAT, version: MAP_VERSION, name: 'flatgrass', brushes, entities,
  settings: {
    // Huge faces: coarse luxels keep the bake quick; the platform's faces get finer ones automatically.
    light: { luxelSize: 128, skyLuminance: 7000, skyZenith: '#2f66c9', skyHorizon: '#bcd4ea' },
    fog: { enabled: true, color: '#bcd4ea', luminance: 7000, near: 3000, far: 90000 },
    camera: { flash: false, whiteBalanceK: 5600 },
  },
}));
console.log(`wrote maps/flatgrass.json: ${brushes.length} brushes`);
