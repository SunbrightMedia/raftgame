import { readFileSync } from 'node:fs';
import { parseMap } from '../../src/data/map';
import { buildFaces, layoutLightmap, solidPlanes } from '../../src/engine/light/faces';
import { bake } from '../../src/engine/light/bake';
const map = parseMap(JSON.parse(readFileSync(new URL('../../maps/test_room.json', import.meta.url), 'utf8')));
const faces = buildFaces(map.brushes);
for (const lux of [16, 32]) for (const bounces of [0, 1]) {
  const lay = layoutLightmap(faces, lux);
  const out = bake({
    faces, width: lay.width, height: lay.height, rects: [...lay.rects],
    boxes: map.brushes.filter((b) => b.solid !== false).map(solidPlanes),
    lights: [], emissive: { 'office/lightpanel': { color: [1, 0.97, 0.9], intensity: 0.35 } }, albedo: {},
    params: { ambient: [0.1, 0.1, 0.1], lightScale: 1, bounces, bounceScale: 1, bounceSamples: 16, surfaceSpacing: 32, surfaceFifty: 128, surfaceGlow: 1.2 },
  });
  console.log(`luxel ${lux} bounces ${bounces}: ${faces.length} faces, atlas ${lay.width}x${lay.height}, ${out.luxels} luxels, ${out.lights} lights, ${out.ms} ms`);
}
