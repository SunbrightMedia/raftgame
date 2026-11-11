import { facePoint, type Face, type LightmapLayout } from '../light/faces';

/**
 * The vertices of a set of brush faces, sorted into one batch per texture:
 * plain arrays, with no three.js and no texture registry, so that a worker
 * can make them (world/lotBuild.ts). `sizeOf` gives a texture's size in the
 * world's units (what one repeat covers at scale 1).
 */
export interface FaceBatch { pos: number[]; nrm: number[]; uv: number[]; lm: number[]; lmoff: number[]; shade: number[]; gu: number[]; gv: number[]; idx: number[] }

export function faceBatches(faces: Face[], sizeOf: (tex: string) => { worldW: number; worldH: number }, layout: LightmapLayout | null, offsetOf?: (brushId: number) => [number, number, number] | undefined): Map<string, FaceBatch> {
  const batches = new Map<string, FaceBatch>();
  for (const f of faces) {
    let bt = batches.get(f.tex);
    if (!bt) { bt = { pos: [], nrm: [], uv: [], lm: [], lmoff: [], shade: [], gu: [], gv: [], idx: [] }; batches.set(f.tex, bt); }
    const tex = sizeOf(f.tex);
    const rect = layout?.rects.get(f.id);
    const base = bt.pos.length / 3;
    const rot = (f.rot * Math.PI) / 180;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const sx = f.scale[0] || 1, sy = f.scale[1] || 1;
    // How texture u and v change per inch moved across the face (for bump mapping).
    const ku = 1 / (sx * tex.worldW), kv = 1 / (sy * tex.worldH);
    // Source axes: u = (p·ua/scale + shift)/width; v runs down the image (Source), so it's negated.
    const ua = f.ua, va = f.va;
    const gu = ua ? [ua[0] / (sx * tex.worldW), ua[1] / (sx * tex.worldW), ua[2] / (sx * tex.worldW)] : [0, 1, 2].map((a) => (cr * f.r[a] - sr * f.u[a]) * ku);
    const gv = va ? [-va[0] / (sy * tex.worldH), -va[1] / (sy * tex.worldH), -va[2] / (sy * tex.worldH)] : [0, 1, 2].map((a) => (sr * f.r[a] + cr * f.u[a]) * kv);
    // Outline counter-clockwise seen from outside: the polygon, or the rectangle.
    const outline: [number, number][] = f.poly ?? [[0, 0], [f.width, 0], [f.width, f.height], [0, f.height]];
    // A moved brush entity draws displaced; its texture and lightmap stay as baked (as in Source).
    const off = offsetOf?.(f.brushId);
    for (const [s, t] of outline) {
      const p = facePoint(f, s, t);
      if (off) bt.pos.push(p[0] + off[0], p[1] + off[1], p[2] + off[2]);
      else bt.pos.push(p[0], p[1], p[2]);
      if (f.nS && !f.poly) {
        const nn = f.nS[s > f.width / 2 ? 1 : 0];
        bt.nrm.push(nn[0], nn[1], nn[2]);
      } else bt.nrm.push(f.n[0], f.n[1], f.n[2]);
      if (ua && va) {
        bt.uv.push(((p[0] * ua[0] + p[1] * ua[1] + p[2] * ua[2]) / sx + ua[3]) / tex.worldW, -((p[0] * va[0] + p[1] * va[1] + p[2] * va[2]) / sy + va[3]) / tex.worldH);
      } else {
        // World-aligned texture projection.
        const wu = p[0] * f.r[0] + p[1] * f.r[1] + p[2] * f.r[2];
        const wv = p[0] * f.u[0] + p[1] * f.u[1] + p[2] * f.u[2];
        const ru = wu * cr - wv * sr, rv = wu * sr + wv * cr;
        bt.uv.push((ru / sx + f.offset[0]) / tex.worldW, (rv / sy + f.offset[1]) / tex.worldH);
      }
      if (rect?.src && layout) {
        // Source's luxel grid: integer luxel coordinates are texel centres.
        const g = rect.src;
        const ls = p[0] * g.lmS[0] + p[1] * g.lmS[1] + p[2] * g.lmS[2] - g.minS, lt = p[0] * g.lmT[0] + p[1] * g.lmT[1] + p[2] * g.lmT[2] - g.minT;
        bt.lm.push((rect.x + 0.5 + ls) / layout.width, (rect.y + 0.5 + lt) / layout.height);
        bt.lmoff.push(g.slots > 1 ? rect.w / layout.width : 0);
      } else if (rect && layout) {
        const fs = f.width > 0 ? s / f.width : 0, ft = f.height > 0 ? t / f.height : 0;
        bt.lm.push((rect.x + 0.5 + fs * (rect.w - 1)) / layout.width, (rect.y + 0.5 + ft * (rect.h - 1)) / layout.height);
        bt.lmoff.push(0);
      } else { bt.lm.push(0, 0); bt.lmoff.push(0); }
      bt.shade.push(f.shade);
      bt.gu.push(gu[0], gu[1], gu[2]);
      bt.gv.push(gv[0], gv[1], gv[2]);
    }
    // Convex: a triangle fan.
    for (let k = 1; k < outline.length - 1; k++) bt.idx.push(base, base + k, base + k + 1);
  }
  return batches;
}
