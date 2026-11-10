import { describe, it, expect } from 'vitest';
import { fogUniforms, fogAt, fogReach, fogThickness } from '../src/engine/render/fog';

function layers(near: number, stops: [number, number][]) {
  const u = fogUniforms;
  u.fogOn.value = 1; u.fogLayers.value = 1;
  u.fogStopD.value.set(near, stops[0][0], stops[1][0], stops[2][0]);
  u.fogStopA.value.set(0, fogThickness(stops[0][1]), fogThickness(stops[1][1]), fogThickness(stops[2][1]));
}

describe('fog in layers', () => {
  it('hides what each layer says at that layer\'s distance, and nothing before the start', () => {
    layers(300, [[1600, 0.18], [4200, 0.62], [8500, 0.9]]);
    expect(fogAt(0)).toBe(0);
    expect(fogAt(300)).toBe(0);
    expect(fogAt(1600)).toBeCloseTo(0.18, 6);
    expect(fogAt(4200)).toBeCloseTo(0.62, 6);
    expect(fogAt(8500)).toBeCloseTo(0.9, 6);
  });

  it('only ever grows with distance, and goes on growing past the last layer', () => {
    layers(300, [[1600, 0.18], [4200, 0.62], [8500, 0.9]]);
    let last = 0;
    for (let d = 0; d < 30000; d += 50) { const f = fogAt(d); expect(f).toBeGreaterThanOrEqual(last); last = f; }
    expect(fogAt(20000)).toBeGreaterThan(0.99);
  });

  it('reach is where the fog hides that much', () => {
    layers(300, [[1600, 0.18], [4200, 0.62], [8500, 1]]);
    for (const amount of [0.1, 0.5, 0.9, 0.995]) expect(fogAt(fogReach(amount))).toBeCloseTo(amount, 5);
    expect(fogReach(0.995)).toBeCloseTo(8500, 3);   // "all" at a layer means 99.5% there
    layers(300, [[1600, 0.18], [4200, 0.62], [8500, 0.9]]);
    expect(fogReach(0.995)).toBeGreaterThan(8500);  // reached past the last layer, at that layer's rate
    expect(fogAt(fogReach(0.995))).toBeCloseTo(0.995, 5);
  });

  it('plain fog still works as before', () => {
    const u = fogUniforms;
    u.fogLayers.value = 0; u.fogNear.value = 400; u.fogFar.value = 9000; u.fogHaze.value = 0; u.fogMaxDensity.value = 1; u.fogSquare.value = 1;
    expect(fogAt(400)).toBe(0);
    expect(fogAt(4700)).toBeCloseTo(0.25, 6);          // Source: the factor squared
    expect(fogAt(fogReach(0.9))).toBeCloseTo(0.9, 6);
    u.fogOn.value = 0;
    expect(fogAt(5000)).toBe(0);
    expect(fogReach()).toBe(Infinity);
    u.fogOn.value = 1; u.fogSquare.value = 0;
  });
});
