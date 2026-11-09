import { describe, it, expect } from 'vitest';
import { buildFaces, layoutLightmap, solidPlanes } from '../src/engine/light/faces';
import { bake, type BakeInput, type BakeLight } from '../src/engine/light/bake';
import { lightFromEntity } from '../src/game/lighting';
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

function bakeRoom(brushes: BrushDef[], lights: BakeLight[], bounces = 0) {
  const faces = buildFaces(brushes);
  const lay = layoutLightmap(faces, 8);
  const input: BakeInput = {
    faces, width: lay.width, height: lay.height, rects: [...lay.rects],
    boxes: brushes.map(solidPlanes), lights,
    emissive: {}, albedo: { wall: [0.5, 0.5, 0.5] },
    params: { ambient: [0, 0, 0], lightScale: 1, bounces, bounceScale: 1, bounceSamples: 16, surfaceSpacing: 16, aoStrength: 0 },
  };
  const out = bake(input);
  /** Irradiance (lux, red channel) on a brush face at the luxel nearest to world (a, b) in that face's plane. */
  const at = (brushId: number, key: string, x: number, y: number, z: number) => {
    const f = faces.find((q) => q.brushId === brushId && q.key === key)!;
    const rect = lay.rects.get(f.id)!;
    const o = [x - f.origin[0], y - f.origin[1], z - f.origin[2]];
    const s2 = o[0] * f.r[0] + o[1] * f.r[1] + o[2] * f.r[2], t2 = o[0] * f.u[0] + o[1] * f.u[1] + o[2] * f.u[2];
    const i = Math.round(s2 / (f.width / (rect.w - 1))), j = Math.round(t2 / (f.height / (rect.h - 1)));
    return out.pixels[((rect.y + j) * lay.width + rect.x + i) * 4];
  };
  return { at, out, faces };
}
const can = (x: number, y: number, z: number): BakeLight => lightFromEntity([x, y, z], { type: 'can', lumens: 650, kelvin: 6500 });

describe('lightmap bake (physical units)', () => {
  it('drops faces buried in other brushes', () => {
    const faces = buildFaces(room());
    expect(faces.some((f) => [3, 4, 5, 6].includes(f.brushId) && f.key === 'nz')).toBe(false);
  });
  it('a 650 lm BR30 can 96" up puts ~35 lux on the floor below it (inverse square)', () => {
    const tall = room().map((b) => (b.id === 2 ? { ...b, min: [-16, -16, 128], max: [528, 528, 144] } as BrushDef : b));
    const { at } = bakeRoom(tall, [can(256, 256, 96)]);
    // I0 = 650·(1.4+1)/2π · 0.85 ≈ 211 cd; d = 96" - 1" sample lift = 2.413 m → E ≈ 36 lx
    expect(at(1, 'pz', 256, 256, 0)).toBeGreaterThan(32);
    expect(at(1, 'pz', 256, 256, 0)).toBeLessThan(40);
  });
  it("the can's cutoff draws a scallop edge on a nearby wall", () => {
    // Can 24" from the west wall (x=0), 96" up: the 50° cutoff hits the wall ~20" below the ceiling.
    const tall = room().map((b) => (b.id === 2 ? { ...b, min: [-16, -16, 128], max: [528, 528, 144] } as BrushDef : b));
    const { at } = bakeRoom(tall, [can(24, 256, 96)]);
    const above = at(3, 'px', 0, 256, 90), below = at(3, 'px', 0, 256, 50);
    // A clear edge, but not black above it: ~6% reflector spill lights the wall faintly.
    expect(above).toBeLessThan(below * 0.3);
    expect(above).toBeGreaterThan(0);
    expect(below).toBeGreaterThan(5);
  });
  it('casts shadows', () => {
    const pillar: BrushDef = { id: 7, type: 'box', min: [300, 240, 0], max: [332, 272, 128], tex: 'wall' };
    const bulb = lightFromEntity([200, 256, 100], { type: 'bulb', lumens: 800, kelvin: 6500 });
    const lit = bakeRoom(room(), [bulb]).at(1, 'pz', 420, 256, 0);
    const shadowed = bakeRoom(room([pillar]), [bulb]).at(1, 'pz', 420, 256, 0);
    expect(shadowed).toBeLessThan(lit * 0.3);
  });
  it('bounce light fills the shadow', () => {
    const pillar: BrushDef = { id: 7, type: 'box', min: [300, 240, 0], max: [332, 272, 128], tex: 'wall' };
    const bulb = lightFromEntity([200, 256, 100], { type: 'bulb', lumens: 800, kelvin: 6500 });
    const direct = bakeRoom(room([pillar]), [bulb], 0).at(1, 'pz', 420, 256, 0);
    const bounced = bakeRoom(room([pillar]), [bulb], 1).at(1, 'pz', 420, 256, 0);
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

describe.each(['test_room', 'pmp_basement', 'mall_hall', 'pmp_nook', 'rec_room', 'laquinta'])('map %s', (name) => {
  it('has no overlapping coplanar box faces (they z-fight and flicker)', async () => {
    const { readFileSync } = await import('node:fs');
    const map = JSON.parse(readFileSync(new URL(`../maps/${name}.json`, import.meta.url), 'utf8'));
    const solids = map.brushes.filter((b: BrushDef) => b.solid !== false && b.type === 'box') as BrushDef[];
    const bad: string[] = [];
    for (let i = 0; i < solids.length; i++) for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i], b = solids[j];
      for (let ax = 0; ax < 3; ax++) for (const side of ['min', 'max'] as const) {
        if (a[side][ax] !== b[side][ax]) continue;
        const others = [0, 1, 2].filter((k) => k !== ax);
        if (others.every((k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]) > 0)) bad.push(`${a.id}/${b.id}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('prism brushes', () => {
  it('block the player, render polygon tops, and cast shadows', async () => {
    const { parseMap } = await import('../src/data/map');
    const { CollisionWorld } = await import('../src/engine/collision/trace');
    const { convexBrush } = await import('../src/engine/collision/brush');
    const { v3 } = await import('../src/engine/vec3');
    const oct = Array.from({ length: 8 }, (_, i) => [200 + 32 * Math.cos((i / 8) * Math.PI * 2), 32 * Math.sin((i / 8) * Math.PI * 2)]);
    const map = parseMap({ format: 'liminal-map', version: 1, name: 't', entities: [], brushes: [
      { id: 1, type: 'box', min: [-512, -512, -16], max: [512, 512, 0], tex: 'wall' },
      { id: 2, type: 'prism', points: oct, z0: 0, z1: 64, tex: 'wall' },
    ] });
    const faces = buildFaces(map.brushes);
    expect(faces.filter((f) => f.brushId === 2 && f.poly).length).toBe(1); // top (bottom is buried in the floor)
    expect(faces.filter((f) => f.brushId === 2 && f.key.startsWith('side')).length).toBe(8);
    const world = new CollisionWorld(map.brushes.map((b) => { const sp = solidPlanes(b); return convexBrush(b.id, sp.planes.map((p) => ({ n: v3(...p.n), d: p.d })), v3(...b.min), v3(...b.max)); }));
    const tr = world.trace(v3(0, 0, 1), v3(300, 0, 1), v3(-12, -12, 0), v3(12, 12, 54));
    expect(tr.fraction).toBeLessThan(1);
    expect(tr.endpos.x).toBeGreaterThan(200 - 32 - 13);
    expect(tr.endpos.x).toBeLessThan(200 - 32 - 11);
  });
});
