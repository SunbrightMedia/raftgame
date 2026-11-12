/**
 * Map faults the eye misses (tools/planner/check.ts prints them; tests/planner.test.ts keeps them at zero):
 * long runs, rooms on rooms, corridors through rooms they do not join, corridors crossing on different floors
 * (on the same floor they are junctions), and pieces a room draws on another room outside its own box.
 */
import { bboxOf, convexOverlap, obb, segBox, toLocal, type V2 } from './geom';
import type { MapOut, Prim } from './types';

/** Area of the intersection of two convex polygons (Sutherland-Hodgman), tiles². */
function clipArea(a: V2[], b: V2[]): number {
  let out = a.slice();
  const sgn = Math.sign(b.reduce((s, p, i) => s + (p.x * b[(i + 1) % b.length].y - b[(i + 1) % b.length].x * p.y), 0)) || 1;
  for (let i = 0; i < b.length && out.length; i++) {
    const p = b[i], q = b[(i + 1) % b.length];
    const inside = (r: V2) => sgn * ((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)) >= 0;
    const cut = (r: V2, s: V2): V2 => {
      const d1 = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x), d2 = (q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x);
      const t = d1 / (d1 - d2);
      return { x: r.x + (s.x - r.x) * t, y: r.y + (s.y - r.y) * t };
    };
    const inp = out; out = [];
    for (let k = 0; k < inp.length; k++) {
      const r = inp[k], s = inp[(k + 1) % inp.length];
      if (inside(s)) { if (!inside(r)) out.push(cut(r, s)); out.push(s); } else if (inside(r)) out.push(cut(r, s));
    }
  }
  let s = 0;
  for (let i = 0; i < out.length; i++) { const p = out[i], q = out[(i + 1) % out.length]; s += p.x * q.y - q.x * p.y; }
  return Math.abs(s) / 2;
}

export interface Faults {
  long: number; roomRoom: [string, string, number][]; corrRoom: [number, string, number][]; crossSame: number; crossLevel: [number, number][];
  outside: Record<string, number>;
}

export function check(m: MapOut): Faults {
  const f: Faults = { long: 0, roomRoom: [], corrRoom: [], crossSame: 0, crossLevel: [], outside: {} };
  const Z = m.zones;
  const boxes = Z.map((z) => obb(z.frame, z.w, z.h));
  const bbs = boxes.map((b) => bboxOf(b));
  f.long = m.links.filter((l) => l.kind === 'long').length;
  for (let i = 0; i < Z.length; i++) for (let j = i + 1; j < Z.length; j++) {
    const a = bbs[i], b = bbs[j];
    if (a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0) continue;
    if (!convexOverlap(boxes[i], boxes[j])) continue;
    const ar = clipArea(boxes[i], boxes[j]);
    if (ar > 0.5) f.roomRoom.push([`${Z[i].key}/${Z[i].feature}`, `${Z[j].key}/${Z[j].feature}`, +ar.toFixed(1)]);
  }
  const segs: { link: number; level: number; poly: V2[]; bb: ReturnType<typeof bboxOf> }[] = [];
  for (const l of m.links) {
    if (l.path.length < 2) continue;
    const level = Math.min(Z[l.a].level, Z[l.b].level);
    for (let k = 0; k + 1 < l.path.length; k++) {
      const a = l.path[k], b = l.path[k + 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 0.3) continue;
      // keep clear of the two rooms it joins: shorten the ends
      const poly = segBox(a, b, l.w * 0.9);
      segs.push({ link: l.id, level, poly, bb: bboxOf(poly) });
      for (let i = 0; i < Z.length; i++) {
        if (i === l.a || i === l.b) continue;
        const zb = bbs[i], sb = segs[segs.length - 1].bb;
        if (zb.x1 <= sb.x0 || sb.x1 <= zb.x0 || zb.y1 <= sb.y0 || sb.y1 <= zb.y0) continue;
        if (!convexOverlap(poly, boxes[i])) continue;
        const ar = clipArea(poly, boxes[i]);
        if (ar > 0.5) f.corrRoom.push([l.id, `${Z[i].key}/${Z[i].feature}`, +ar.toFixed(1)]);
      }
    }
  }
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const a = segs[i], b = segs[j];
    if (a.link === b.link) continue;
    if (a.bb.x1 <= b.bb.x0 || b.bb.x1 <= a.bb.x0 || a.bb.y1 <= b.bb.y0 || b.bb.y1 <= a.bb.y0) continue;
    if (!convexOverlap(a.poly, b.poly)) continue;
    if (a.level === b.level) f.crossSame++; else f.crossLevel.push([a.link, b.link]);
  }
  // pieces drawn outside their own room (corridor floors and layer-2 excluded)
  const ptsOf = (p: Prim): V2[] => (p.t === 'wall' ? [p.a, p.b] : p.t === 'light' || p.t === 'mark' || p.t === 'label' ? [p.p] : p.t === 'duct' ? [] : p.pts);
  for (const p of m.prims) {
    if (p.t === 'floor' && p.corr) continue;
    if (p.t === 'duct' || p.t === 'label' || p.t === 'light' || !('zone' in p) || p.zone < 0) continue;
    const z = Z[p.zone];
    if (!z) continue;
    const pts = ptsOf(p);
    const out = pts.some((q) => { const l = toLocal(z.frame, q); return Math.abs(l.x) > z.w / 2 + 1.2 || Math.abs(l.y) > z.h / 2 + 1.2; });
    if (!out || p.t === 'stairs') continue;   // stairs on corridors carry the corridor's first room
    // only count it when it lands on another room
    const poly = p.t === 'wall' ? segBox(p.a, p.b, Math.max(0.2, p.w)) : p.t === 'mark' ? obb({ x: p.p.x, y: p.p.y, a: p.a }, p.s, p.s) : p.pts;
    const pb = bboxOf(poly);
    let hit = '';
    for (let i = 0; i < Z.length && !hit; i++) {
      if (i === p.zone) continue;
      const zb = bbs[i];
      if (zb.x1 <= pb.x0 || pb.x1 <= zb.x0 || zb.y1 <= pb.y0 || pb.y1 <= zb.y0) continue;
      if (convexOverlap(obb(Z[i].frame, Z[i].w - 0.6, Z[i].h - 0.6), poly.length > 2 ? poly : segBox(poly[0], poly[1] ?? poly[0], 0.3))) hit = Z[i].feature;
    }
    if (hit) { const k = `${z.feature}:${p.t} on ${hit}`; f.outside[k] = (f.outside[k] ?? 0) + 1; }
  }
  return f;
}

