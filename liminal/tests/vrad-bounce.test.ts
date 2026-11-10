import { describe, it, expect } from 'vitest';
import { parseMap } from '../src/data/map';
import { buildFaces, solidPlanes } from '../src/engine/light/faces';
import { bakeSource, parseSourceLight, type SourceBakeFace } from '../src/engine/light/vrad';

/**
 * Radiosity sanity check: inside a closed room whose every wall reflects ρ,
 * light bounces until absorbed, so the average light on the walls is the
 * average direct light ÷ (1 − ρ) (each bounce adds ρ times the last).
 */
describe('Source baker bounce', () => {
  it('a closed room with reflectivity 0.5 gathers twice its direct light', () => {
    const S = 256, T = 16;
    const box = (id: number, min: number[], max: number[]) => ({ id, type: 'box', min, max, tex: 'dev/gray' });
    const map = parseMap({
      format: 'liminal-map', version: 1, name: 't',
      brushes: [
        box(1, [-S - T, -S - T, -S - T], [S + T, S + T, -S]), box(2, [-S - T, -S - T, S], [S + T, S + T, S + T]),
        box(3, [-S - T, -S - T, -S], [-S, S + T, S]), box(4, [S, -S - T, -S], [S + T, S + T, S]),
        box(5, [-S, -S - T, -S], [S, -S, S]), box(6, [-S, S, -S], [S, S + T, S]),
      ],
      entities: [{ id: 1, class: 'player_start', origin: [0, 0, 0] }],
    });
    const faces = buildFaces(map.brushes);
    const info: SourceBakeFace[] = faces.map((f) => ({ id: f.id, lightmapscale: 32, bump: false, reflectivity: [0.5, 0.5, 0.5] }));
    const light = parseSourceLight({ classname: 'light', _light: '255 255 255 200' }, [0, 0, 0])!;
    const run = (bounces: number) => {
      const out = bakeSource({ faces, info, occluders: map.brushes.map(solidPlanes), lights: [light], params: { bounces, patchRays: 256, chop: 4, supersample: false, maxWidth: 2048 } });
      let sum = 0, n = 0;
      for (const [, r] of out.rects) for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) { sum += out.pixels[((r.y + j) * out.width + r.x + i) * 4]; n++; }
      return sum / n;
    };
    const direct = run(0), total = run(100);
    expect(total / direct).toBeGreaterThan(1.85);
    expect(total / direct).toBeLessThan(2.15);
  }, 60000);
});
