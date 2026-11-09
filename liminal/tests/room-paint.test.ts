import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseMap, type FaceTex } from '../src/data/map';
import { verticalFaces, roomAt } from '../tools/lib/roomPaint';
import { PMP_ROOMS, NOOK_ROOMS, REC_ROOMS, LQ_ROOMS } from '../junk/tools/lib/rooms';

describe.each([['pmp_basement', PMP_ROOMS], ['pmp_nook', NOOK_ROOMS], ['rec_room', REC_ROOMS], ['laquinta', LQ_ROOMS]] as const)('%s room paint', (name, ROOMS) => {
  it('every painted wall face shows the paint of the room it faces', () => {
    const m = parseMap(JSON.parse(readFileSync(new URL(`../junk/maps/${name}.json`, import.meta.url), 'utf8')));
    const paints = new Set(ROOMS.map((r) => r.paint));
    const bad: string[] = [];
    for (const b of m.brushes) {
      if (b.solid === false) continue;
      const faces = (b.faces ?? {}) as Record<string, FaceTex>;
      for (const f of verticalFaces(b)) {
        const tex = faces[f.key]?.tex ?? (f.key.startsWith('side') ? faces.side?.tex : undefined) ?? b.tex;
        if (!tex || !paints.has(tex)) continue;
        const mid = f.samples[Math.floor(f.samples.length / 2)];
        const r = roomAt(ROOMS as never, mid.map((v, i) => v + f.n[i] * 1.5));
        if (r && r.paint !== tex) bad.push(`brush #${b.id} ${f.key}: ${tex} facing ${r.name} (${r.paint})`);
      }
    }
    expect(bad).toEqual([]);
  });
});
