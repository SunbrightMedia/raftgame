/**
 * Room paint: a wall brush shared by two rooms must show each room its own
 * paint. Rooms are declared once (extent + wall paint); paintByRoom() then
 * gives every vertical face whose texture is a room paint the paint of the
 * room it actually faces (sampled just in front of the face), so a wall
 * between the mint room and the warm-white room is mint on one side and
 * warm white on the other. Faces with other textures (trim, jambs) are left alone.
 */
import type { BrushDef, FaceTex } from '../../src/data/map';

export interface Room { name: string; min: [number, number, number]; max: [number, number, number]; paint: string }

const inRoom = (r: Room, p: number[]) => p.every((v, i) => v >= r.min[i] && v <= r.max[i]);

/** Which room a point is in (the first match), or undefined. */
export function roomAt(rooms: Room[], p: number[]): Room | undefined {
  return rooms.find((r) => inRoom(r, p));
}

/** Vertical faces of a brush: key, a few sample points on the face, outward normal. */
export function verticalFaces(b: BrushDef): { key: string; samples: number[][]; n: number[] }[] {
  const out: { key: string; samples: number[][]; n: number[] }[] = [];
  const lerp = (a: number, c: number, t: number) => a + (c - a) * t;
  if (b.type === 'box') {
    const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
    const zs = [0.25, 0.5, 0.75].map((t) => lerp(z0, z1, t));
    const xs = [0.2, 0.5, 0.8].map((t) => lerp(x0, x1, t)), ys = [0.2, 0.5, 0.8].map((t) => lerp(y0, y1, t));
    out.push({ key: 'px', n: [1, 0, 0], samples: ys.flatMap((y) => zs.map((z) => [x1, y, z])) });
    out.push({ key: 'nx', n: [-1, 0, 0], samples: ys.flatMap((y) => zs.map((z) => [x0, y, z])) });
    out.push({ key: 'py', n: [0, 1, 0], samples: xs.flatMap((x) => zs.map((z) => [x, y1, z])) });
    out.push({ key: 'ny', n: [0, -1, 0], samples: xs.flatMap((x) => zs.map((z) => [x, y0, z])) });
  } else if (!b.axis || b.axis === 'z') {
    const pts = b.points, zs = [0.25, 0.5, 0.75].map((t) => lerp(b.z0, b.z1, t));
    pts.forEach(([ax, ay], k) => {
      const [bx, by] = pts[(k + 1) % pts.length];
      const l = Math.hypot(bx - ax, by - ay) || 1;
      out.push({ key: `side${k}`, n: [(by - ay) / l, -(bx - ax) / l, 0], samples: [0.2, 0.5, 0.8].flatMap((t) => zs.map((z) => [lerp(ax, bx, t), lerp(ay, by, t), z])) });
    });
  }
  return out;
}

/** Repaint shared walls per room. Returns how many faces changed. */
export function paintByRoom(brushes: BrushDef[], rooms: Room[]): number {
  const paints = new Set(rooms.map((r) => r.paint));
  let changed = 0;
  for (const b of brushes) {
    if (b.solid === false) continue;
    const faces = (b.faces ?? {}) as Record<string, FaceTex>;
    for (const f of verticalFaces(b)) {
      const cur = faces[f.key]?.tex ?? (f.key.startsWith('side') ? faces.side?.tex : undefined) ?? b.tex;
      if (!cur || !paints.has(cur)) continue;
      // The room most of the face looks into.
      const votes = new Map<Room, number>();
      for (const s of f.samples) {
        const r = roomAt(rooms, s.map((v, i) => v + f.n[i] * 1.5));
        if (r) votes.set(r, (votes.get(r) ?? 0) + 1);
      }
      const best = [...votes.entries()].sort((a, c) => c[1] - a[1])[0]?.[0];
      if (!best || best.paint === cur) continue;
      faces[f.key] = { ...(faces[f.key] ?? {}), tex: best.paint };
      b.faces = faces as BrushDef['faces'];
      changed++;
    }
  }
  return changed;
}
