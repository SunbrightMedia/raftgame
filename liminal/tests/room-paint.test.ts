import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseMap, type FaceTex } from '../src/data/map';
import { verticalFaces, roomAt } from '../tools/lib/roomPaint';
import { PMP_ROOMS } from '../tools/lib/pmpRooms';

describe('pmp_basement room paint', () => {
  it('every painted wall face shows the paint of the room it faces', () => {
    const m = parseMap(JSON.parse(readFileSync(new URL('../maps/pmp_basement.json', import.meta.url), 'utf8')));
    const paints = new Set(PMP_ROOMS.map((r) => r.paint));
    const bad: string[] = [];
    for (const b of m.brushes) {
      if (b.solid === false) continue;
      const faces = (b.faces ?? {}) as Record<string, FaceTex>;
      for (const f of verticalFaces(b)) {
        const tex = faces[f.key]?.tex ?? (f.key.startsWith('side') ? faces.side?.tex : undefined) ?? b.tex;
        if (!tex || !paints.has(tex)) continue;
        const mid = f.samples[Math.floor(f.samples.length / 2)];
        const r = roomAt(PMP_ROOMS, mid.map((v, i) => v + f.n[i] * 1.5));
        if (r && r.paint !== tex) bad.push(`brush #${b.id} ${f.key}: ${tex} facing ${r.name} (${r.paint})`);
      }
    }
    expect(bad).toEqual([]);
  });
});
