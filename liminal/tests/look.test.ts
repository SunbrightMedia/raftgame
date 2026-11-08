import { describe, it, expect } from 'vitest';
import { buildFaces, layoutLightmap } from '../src/engine/light/faces';
import { bake, falloff, type BakeInput } from '../src/engine/light/bake';
import { medianCut, applyPalette } from '../src/engine/render/crusher';
import type { BrushDef } from '../src/data/map';

// A closed 512×512×128 room, plus an optional pillar.
function room(extra: BrushDef[] = []): BrushDef[] {
  const b = (id: number, min: [number, number, number], max: [number, number, number]): BrushDef => ({ id, type: 'box', min, max, tex: 'wall' });
  return [
    b(1, [-16, -16, -16], [528, 528, 0]), b(2, [-16, -16, 128], [528, 528, 144]),
    b(3, [-16, -16, 0], [0, 528, 128]), b(4, [512, -16, 0], [528, 528, 128]),
    b(5, [0, -16, 0], [512, 0, 128]), b(6, [0, 512, 0], [512, 528, 128]),
    ...extra,
  ];
}

function bakeRoom(brushes: BrushDef[], lightPos: [number, number, number], bounces = 0) {
  const faces = buildFaces(brushes);
  const lay = layoutLightmap(faces, 16);
  const input: BakeInput = {
    faces, width: lay.width, height: lay.height, rects: [...lay.rects],
    boxes: brushes.map((b) => ({ brushId: b.id, min: b.min, max: b.max })),
    lights: [{ pos: lightPos, color: [1, 1, 1], fifty: 128, range: 1024 }],
    emissive: {}, albedo: { wall: [0.5, 0.5, 0.5] },
    params: { ambient: [0, 0, 0], lightScale: 1, bounces, bounceScale: 1, bounceSamples: 16, surfaceSpacing: 32, surfaceFifty: 128, surfaceGlow: 1 },
  };
  const out = bake(input);
  // Brightness of the floor (brush 1, top face) at world (x, y).
  const floor = faces.find((f) => f.brushId === 1 && f.key === 'pz')!;
  const rect = lay.rects.get(floor.id)!;
  const at = (x: number, y: number) => {
    const i = Math.round((x - floor.origin[0]) / (floor.width / (rect.w - 1)));
    const j = Math.round((y - floor.origin[1]) / (floor.height / (rect.h - 1)));
    return out.pixels[((rect.y + j) * lay.width + rect.x + i) * 4];
  };
  return { at, out, faces };
}

describe('lightmap bake', () => {
  it('falloff is 50% at the fifty-percent distance and 0 at range', () => {
    expect(falloff(0, 100, 1e9)).toBeCloseTo(1, 3);
    expect(falloff(100, 100, 1e9)).toBeCloseTo(0.5, 3);
    expect(falloff(600, 100, 600)).toBe(0);
  });
  it('drops faces buried in other brushes', () => {
    const faces = buildFaces(room());
    // The walls' bottom faces sit on the floor slab: none of them should survive.
    expect(faces.some((f) => [3, 4, 5, 6].includes(f.brushId) && f.key === 'nz')).toBe(false);
  });
  it('lights the floor under the light more than the corners', () => {
    const { at } = bakeRoom(room(), [256, 256, 100]);
    expect(at(256, 256)).toBeGreaterThan(at(32, 32) * 2);
  });
  it('casts shadows', () => {
    const pillar: BrushDef = { id: 7, type: 'box', min: [300, 240, 0], max: [332, 272, 128], tex: 'wall' };
    const lit = bakeRoom(room(), [200, 256, 100]).at(420, 256);
    const shadowed = bakeRoom(room([pillar]), [200, 256, 100]).at(420, 256);
    expect(shadowed).toBeLessThan(lit * 0.3);
  });
  it('bounce light fills the shadow', () => {
    const pillar: BrushDef = { id: 7, type: 'box', min: [300, 240, 0], max: [332, 272, 128], tex: 'wall' };
    const direct = bakeRoom(room([pillar]), [200, 256, 100], 0).at(420, 256);
    const bounced = bakeRoom(room([pillar]), [200, 256, 100], 1).at(420, 256);
    expect(bounced).toBeGreaterThan(direct);
  });
});

describe('texture crusher', () => {
  it('reduces an image to at most N colours', () => {
    const px = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < px.length; i += 4) { px[i] = (i * 7) % 256; px[i + 1] = (i * 13) % 256; px[i + 2] = (i * 3) % 256; px[i + 3] = 255; }
    const pal = medianCut(px, 16);
    expect(pal.length).toBeLessThanOrEqual(16);
    applyPalette(px, 64, pal, 0);
    const unique = new Set<number>();
    for (let i = 0; i < px.length; i += 4) unique.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
    expect(unique.size).toBeLessThanOrEqual(16);
  });
});
