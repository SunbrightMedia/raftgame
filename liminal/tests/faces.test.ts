import { describe, it, expect } from 'vitest';
import { buildFaces } from '../src/engine/light/faces';
import { parseMap } from '../src/data/map';

const box = (id: number, min: number[], max: number[], extra: Record<string, unknown> = {}) => ({ id, type: 'box', min, max, tex: 'dev/gray', ...extra });
const facesOf = (brushes: unknown[], id: number) => buildFaces(parseMap({ format: 'liminal-map', version: 1, name: 't', entities: [], brushes }).brushes).filter((f) => f.brushId === id).map((f) => f.key).sort();

describe('hidden faces', () => {
  it('keeps every face of a lone box', () => {
    expect(facesOf([box(1, [0, 0, 0], [64, 64, 64])], 1)).toEqual(['nx', 'ny', 'nz', 'px', 'py', 'pz']);
  });

  it('drops a face that one solid covers', () => {
    // A wall standing on a floor: the wall's underside is in the floor... no: it rests on it. A wall sunk 8 into a floor.
    expect(facesOf([box(1, [0, 0, -8], [64, 16, 128]), box(2, [-256, -256, -16], [256, 256, 0])], 1)).toEqual(['nx', 'ny', 'px', 'py', 'pz']);
  });

  it('drops a face that two boxes cover between them, and keeps it when they leave a gap', () => {
    const wall = box(1, [0, 0, -8], [200, 16, 128]);
    expect(facesOf([wall, box(2, [-64, -64, -16], [100, 64, 0]), box(3, [100, -64, -16], [264, 64, 0])], 1)).not.toContain('nz');
    expect(facesOf([wall, box(2, [-64, -64, -16], [90, 64, 0]), box(3, [110, -64, -16], [264, 64, 0])], 1)).toContain('nz');
  });

  it('keeps the side of a tall box that thin beams cross at even heights', () => {
    // A machine 2048 tall in a frame with a beam every 512: the old 25-point test had all its points inside the beams.
    const beams = [0, 1, 2, 3, 4].map((k) => box(10 + k, [-200, -10, -12 + k * 512], [968, 10, 8 + k * 512]));
    const got = facesOf([box(1, [0, 0, 0], [768, 512, 2048]), ...beams], 1);
    expect(got).toContain('ny');
    expect(got.length).toBe(6);
  });

  it('keeps a floor that is mostly, not wholly, under a slab', () => {
    expect(facesOf([box(1, [0, 0, -16], [1024, 1024, 0]), box(2, [0, 0, -4], [1024, 1000, 64])], 1)).toContain('pz');
  });

  it('is not hidden by a brush that is not drawn: a clip brush, or one with tool textures on every face', () => {
    const step = box(1, [0, 0, 0], [32, 64, 16], { solid: false });
    expect(facesOf([step, box(2, [-64, -64, -64], [64, 128, 64], { group: 'clip' })], 1)).toContain('pz');
    expect(facesOf([step, box(2, [-64, -64, -64], [64, 128, 64], { tex: 'tools/toolsnodraw' })], 1)).toContain('pz');
    expect(facesOf([step, box(2, [-64, -64, -64], [64, 128, 64])], 1)).toEqual([]);     // a drawn solid does hide it
  });
});
