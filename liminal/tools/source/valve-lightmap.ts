/**
 * Copy the lighting Valve's own compiler (VRAD) baked into a BSP onto our
 * version of the same map, luxel for luxel. Both put luxels on the same grid
 * (texture axes ÷ lightmapscale), so each of our luxels has a Valve luxel at
 * the same spot on the same plane.
 *
 *   npm run valve:lightmap -- maps/p2/shipyard_atrium.json reference/portal2/shipyard_v13p.bsp [ours.lightmap.json]
 *
 * Writes maps/p2/<map>.valve.lightmap.json (our cache format; the game uses it
 * when light.sourceBaker = valve) and, given our own baked cache, prints how
 * ours differs from Valve's by material.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { parseMap } from '../../src/data/map';
import { buildFaces, facePoint, type Face } from '../../src/engine/light/faces';
import { sourceLayout, SOURCE_LM_WIDTH } from '../../src/engine/light/vrad';
import { sourceBakeInfo } from '../../src/game/sourceLighting';

const [mapPath, bspPath, oursPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const map = parseMap(JSON.parse(readFileSync(mapPath, 'utf8')));
// Every converted Portal 2 material: the atrium's set (textures/p2) and the whole library (textures/p2lib).
const idx = ['textures/p2/index.json', 'textures/p2lib/index.json'].filter((f) => existsSync(f))
  .flatMap((f) => JSON.parse(readFileSync(f, 'utf8')).textures as { name: string; size: [number, number]; source: Record<string, unknown> }[]);
const mats = new Map(idx.map((t) => [t.name, { size: t.size, source: t.source }]));
const faces = buildFaces(map.brushes);
const { info } = sourceBakeInfo(map, faces, (tex) => mats.get(tex) as never);
const layout = sourceLayout(faces, info, SOURCE_LM_WIDTH);
const W = layout.width, H = layout.height;

// ---- BSP (v21)
const b = readFileSync(bspPath);
const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
const lump = (i: number) => ({ o: dv.getInt32(8 + i * 16, true), l: dv.getInt32(12 + i * 16, true) });
const hdr = lump(53).l > 0;
const L = { planes: lump(1), texinfo: lump(6), verts: lump(3), edges: lump(12), surfedges: lump(13), faces: hdr ? lump(58) : lump(7), light: hdr ? lump(53) : lump(8) };
const f32 = (o: number) => dv.getFloat32(o, true), i32 = (o: number) => dv.getInt32(o, true);
const vert = (i: number): [number, number, number] => { const o = L.verts.o + i * 12; return [f32(o), f32(o + 4), f32(o + 8)]; };
interface VFace { n: [number, number, number]; d: number; poly: [number, number, number][]; lmS: number[]; lmT: number[]; minS: number; minT: number; w: number; h: number; lightofs: number; slots: number; lo: number[]; hi: number[] }
// Brush entities with an origin (func_tracktrain, doors...) are stored relative to it; VRAD lights them at
// face + entity origin (the compile-time position, which is where our brushes are).
const faceOffset = new Map<number, [number, number, number]>();
{
  const E = lump(0), text = b.subarray(E.o, E.o + E.l).toString('latin1');
  const M = lump(14);
  for (const block of text.split('}')) {
    const model = /"model"\s+"\*(\d+)"/.exec(block), origin = /"origin"\s+"([^"]+)"/.exec(block);
    if (!model || !origin) continue;
    const o = origin[1].trim().split(/\s+/).map(Number) as [number, number, number];
    if (!o.some((v) => v)) continue;
    const mo = M.o + Number(model[1]) * 48, first = i32(mo + 40), num = i32(mo + 44);
    for (let k = first; k < first + num; k++) faceOffset.set(k, o);
  }
}
const vfaces: VFace[] = [];
for (let fo = L.faces.o; fo + 56 <= L.faces.o + L.faces.l; fo += 56) {
  const off = faceOffset.get((fo - L.faces.o) / 56) ?? [0, 0, 0];
  const planenum = dv.getUint16(fo, true), side = dv.getUint8(fo + 2);
  const firstedge = i32(fo + 4), numedges = dv.getInt16(fo + 8, true), ti = dv.getInt16(fo + 10, true), disp = dv.getInt16(fo + 12, true);
  const style0 = dv.getUint8(fo + 16), lightofs = i32(fo + 20);
  if (lightofs < 0 || style0 === 255 || ti < 0 || disp !== -1) continue;
  const po = L.planes.o + planenum * 20;
  let n: [number, number, number] = [f32(po), f32(po + 4), f32(po + 8)], d = f32(po + 12);
  // planenum is the face's own plane (side just says it's the odd, flipped one of a pair): no flip.
  void side;
  const poly: [number, number, number][] = [];
  for (let k = 0; k < numedges; k++) {
    const se = i32(L.surfedges.o + (firstedge + k) * 4);
    const eo = L.edges.o + Math.abs(se) * 4;
    const v = vert(se >= 0 ? dv.getUint16(eo, true) : dv.getUint16(eo + 2, true));
    poly.push([v[0] + off[0], v[1] + off[1], v[2] + off[2]]);
  }
  const to = L.texinfo.o + ti * 72;
  const flags = i32(to + 64);
  // Lightmap axes are in the model's own space: fold the offset into their constants.
  const lmS = [0, 1, 2, 3].map((k) => f32(to + 32 + k * 4)), lmT = [0, 1, 2, 3].map((k) => f32(to + 48 + k * 4));
  lmS[3] -= lmS[0] * off[0] + lmS[1] * off[1] + lmS[2] * off[2]; lmT[3] -= lmT[0] * off[0] + lmT[1] * off[1] + lmT[2] * off[2];
  d += n[0] * off[0] + n[1] * off[1] + n[2] * off[2];
  const lo = [0, 1, 2].map((k) => Math.min(...poly.map((p) => p[k]))), hi = [0, 1, 2].map((k) => Math.max(...poly.map((p) => p[k])));
  vfaces.push({ n, d, poly, lmS, lmT, minS: i32(fo + 28), minT: i32(fo + 32), w: i32(fo + 36) + 1, h: i32(fo + 40) + 1, lightofs, slots: flags & 0x800 ? 4 : 1, lo, hi });
}
console.log(`${vfaces.length} lit Valve faces (${hdr ? 'HDR' : 'LDR'} lighting)`);

const dot = (a: number[], p: number[]) => a[0] * p[0] + a[1] * p[1] + a[2] * p[2];
// Inside a convex face whichever way it is wound (Source winds faces clockwise seen from the front).
const inside = (vf: VFace, p: number[], eps = 0.05) => {
  const k = vf.poly.length;
  let pos = true, neg = true;
  for (let i = 0; i < k; i++) {
    const a = vf.poly[i], c = vf.poly[(i + 1) % k];
    const e = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], q = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const cr = [e[1] * q[2] - e[2] * q[1], e[2] * q[0] - e[0] * q[2], e[0] * q[1] - e[1] * q[0]];
    const v = dot(cr, vf.n), tol = eps * Math.hypot(...e);
    if (v < -tol) pos = false;
    if (v > tol) neg = false;
  }
  return pos || neg;
};
const rgbe = (o: number, out: number[]) => {
  const e = dv.getInt8(o + 3), sc = Math.pow(2, e) / 255;
  out[0] = dv.getUint8(o) * sc; out[1] = dv.getUint8(o + 1) * sc; out[2] = dv.getUint8(o + 2) * sc;
};

// ---- transfer
const pixels = new Float32Array(W * H * 4);
const got = new Uint8Array(W * H);
let hit = 0, total = 0, boxHit = 0, boxTotal = 0;
// The atrium (for a match rate where every face is visible): x 8700..10300, y 400..1500, z 700..2400.
const inBox = (p: number[]) => p[0] > 8700 && p[0] < 10300 && p[1] > 400 && p[1] < 1500 && p[2] > 700 && p[2] < 2400;
const c3 = [0, 0, 0];
for (const f of faces) {
  const r = layout.rects.get(f.id);
  if (!r) continue;
  const fd = dot(f.n, f.origin);
  const fp = (s: number, t: number) => facePoint(f, s, t);
  const flo = [0, 1, 2].map((k) => Math.min(fp(0, 0)[k], fp(f.width, 0)[k], fp(0, f.height)[k], fp(f.width, f.height)[k]) - 16);
  const fhi = [0, 1, 2].map((k) => Math.max(fp(0, 0)[k], fp(f.width, 0)[k], fp(0, f.height)[k], fp(f.width, f.height)[k]) + 16);
  const cand = vfaces.filter((v) => dot(v.n, f.n) > 0.999 && Math.abs(v.d - fd) < 0.5 && v.lo[0] <= fhi[0] && v.hi[0] >= flo[0] && v.lo[1] <= fhi[1] && v.hi[1] >= flo[1] && v.lo[2] <= fhi[2] && v.hi[2] >= flo[2]);
  const g = r.grid;
  // Solve p on our plane at luxel coordinates (s, t) (same as vrad.ts luxelToWorld).
  const A = [g.lmS, g.lmT, f.n];
  const cr = (a: number[], c: number[]) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
  const i0 = cr(A[1], A[2]), i1 = cr(A[2], A[0]), i2 = cr(A[0], A[1]), det = dot(A[0], i0);
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
    total++;
    const s = g.minS + i, t = g.minT + j;
    const p = [0, 1, 2].map((k) => (s * i0[k] + t * i1[k] + fd * i2[k]) / det);
    const vf = cand.find((v) => inside(v, p));
    const ib = inBox(p);
    if (ib) boxTotal++;
    if (!vf) continue;
    if (ib) boxHit++;
    const vs = Math.round(dot(vf.lmS, p) + vf.lmS[3] - vf.minS), vt = Math.round(dot(vf.lmT, p) + vf.lmT[3] - vf.minT);
    if (vs < 0 || vt < 0 || vs >= vf.w || vt >= vf.h) continue;
    hit++;
    for (let k = 0; k < r.slots; k++) {
      const slot = vf.slots === 4 ? k : 0; // a face bumped here but not in the BSP: flat light in every slot
      rgbe(L.light.o + vf.lightofs + (slot * vf.w * vf.h + vt * vf.w + vs) * 4, c3);
      const o = ((r.y + j) * W + r.x + k * g.w + i) * 4;
      pixels[o] = c3[0]; pixels[o + 1] = c3[1]; pixels[o + 2] = c3[2]; pixels[o + 3] = 1;
    }
    got[(r.y + j) * W + r.x + i] = 1;
  }
}
console.log(`matched ${hit} of ${total} luxels (${(100 * hit / total).toFixed(1)}%); in the atrium ${(100 * boxHit / Math.max(1, boxTotal)).toFixed(1)}% of ${boxTotal}. The rest are under walls or faces the compiler removed.`);

// RGBE + alpha byte, deflated: the game's lightmap cache format.
const enc = new Uint8Array(W * H * 5);
for (let i = 0; i < W * H; i++) {
  const r = pixels[i * 4], g2 = pixels[i * 4 + 1], bl = pixels[i * 4 + 2], m = Math.max(r, g2, bl);
  if (m > 1e-6) { const e = Math.ceil(Math.log2(m) + 1e-9), sc = 255 / Math.pow(2, e); enc[i * 5] = Math.min(255, Math.round(r * sc)); enc[i * 5 + 1] = Math.min(255, Math.round(g2 * sc)); enc[i * 5 + 2] = Math.min(255, Math.round(bl * sc)); enc[i * 5 + 3] = e + 128; }
  enc[i * 5 + 4] = 255;
}
const out = mapPath.replace(/\.json$/, '.valve.lightmap.json');
// Leaf ambient light (what Source lights moving and physics props with at run time): VRAD's samples
// per BSP leaf (lumps 52/56, or 51/55 in an HDR map), with the BSP tree to find a point's leaf. Packed as float32:
// [nNodes, nLeaves, nSamples, headnode], nodes (nx ny nz d child0 child1), leaves (first count),
// samples (x y z, then 6 × rgb for +x −x +y −y +z −z, in the lightmaps' units).
function ambientData(): string {
  const N = lump(5), P = lump(1), LF = lump(10), AI = hdr ? lump(51) : lump(52), AL = hdr ? lump(55) : lump(56), M = lump(14);
  const nNodes = N.l / 32, nLeaves = LF.l / 32, nSamples = AL.l / 28;
  const out = new Float32Array(4 + nNodes * 6 + nLeaves * 2 + nSamples * 21);
  out.set([nNodes, nLeaves, nSamples, i32(M.o + 36)]);
  let o = 4;
  for (let k = 0; k < nNodes; k++) {
    const no = N.o + k * 32, po = P.o + i32(no) * 20;
    out.set([f32(po), f32(po + 4), f32(po + 8), f32(po + 12), i32(no + 4), i32(no + 8)], o); o += 6;
  }
  const s16 = (q: number) => dv.getInt16(q, true), u16 = (q: number) => dv.getUint16(q, true);
  const sampleLeaf = new Int32Array(nSamples).fill(-1);
  for (let k = 0; k < nLeaves; k++) {
    const io = AI.o + k * 4;
    let count = u16(io), first = u16(io + 2);
    // No samples of its own: VRAD points it at the nearest leaf that has some.
    if (count === 0) { const ro = AI.o + first * 4; count = u16(ro); first = u16(ro + 2); }
    else for (let i = first; i < first + count; i++) sampleLeaf[i] = k;
    out.set([first, count], o); o += 2;
  }
  const c = [0, 0, 0];
  for (let i = 0; i < nSamples; i++) {
    const so = AL.o + i * 28, leaf = sampleLeaf[i];
    const lo = leaf >= 0 ? LF.o + leaf * 32 : -1;
    for (let a = 0; a < 3; a++) {
      const mn = lo >= 0 ? s16(lo + 8 + a * 2) : 0, mx = lo >= 0 ? s16(lo + 14 + a * 2) : 0;
      out[o + a] = mn + (mx - mn) * (b[so + 24 + a] / 255);
    }
    // Stored already in 0..1 units (TexLightToLinear: c·2^e), where lightmap luxels are 0..255: no ÷255.
    for (let side = 0; side < 6; side++) { rgbe(so + side * 4, c); out.set([c[0] * 255, c[1] * 255, c[2] * 255], o + 3 + side * 3); }
    o += 21;
  }
  return deflateRawSync(Buffer.from(out.buffer)).toString('base64');
}

// Keep prop vertex light added by valve_proplight.py.
let keep: { props?: string } = {};
try { keep = JSON.parse(readFileSync(out, 'utf8')); } catch { /* first run */ }
writeFileSync(out, JSON.stringify({ format: 'liminal-lightmap', version: 0, encoding: 'rgbe-deflate', key: 'valve', width: W, height: H, luxel: 16, data: deflateRawSync(enc).toString('base64'), ...(keep.props ? { props: keep.props } : {}), ambient: ambientData() }));
console.log(`wrote ${out}`);

// ---- ours vs Valve's, by material (flat slot, luxels both have)
const probeArg = process.argv.indexOf('--probe');
const probe = probeArg > 0 ? process.argv[probeArg + 1].split(',').map(Number) : null;   // x,y,z,nx,ny,nz
if (oursPath) {
  const c = JSON.parse(readFileSync(oursPath, 'utf8'));
  if (c.width !== W || c.height !== H) throw new Error('our cache has a different layout');
  const ob = inflateRawSync(Buffer.from(c.data, 'base64'));
  const ours = (i: number, k: number) => { const e = ob[i * 5 + 3]; return e ? ob[i * 5 + k] * Math.pow(2, e - 128) / 255 : 0; };
  const per = new Map<string, { n: number; v: number; o: number; vb: number; ob: number }>();
  const all = { n: 0, v: 0, o: 0, vb: 0, ob: 0 };
  for (const f of faces as Face[]) {
    const r = layout.rects.get(f.id);
    if (!r) continue;
    let e = per.get(f.tex);
    if (!e) { e = { n: 0, v: 0, o: 0, vb: 0, ob: 0 }; per.set(f.tex, e); }
    for (let j = 0; j < r.grid.h; j++) for (let i = 0; i < r.grid.w; i++) {
      const px = (r.y + j) * W + r.x + i;
      if (!got[px]) continue;
      const v = (pixels[px * 4] + pixels[px * 4 + 1] + pixels[px * 4 + 2]) / 3, o = (ours(px, 0) + ours(px, 1) + ours(px, 2)) / 3;
      for (const t of [e, all]) { t.n++; t.v += v; t.o += o; t.vb += pixels[px * 4 + 2]; t.ob += ours(px, 2); }
    }
  }
  // By how bright Valve's luxel is: direct-lit spots vs bounce-lit ones.
  const bins = [0.02, 0.05, 0.1, 0.2, 0.4, 0.8, 1e9].map((hi) => ({ hi, n: 0, v: 0, o: 0 }));
  for (const f of faces as Face[]) {
    const r = layout.rects.get(f.id);
    if (!r) continue;
    for (let j = 0; j < r.grid.h; j++) for (let i = 0; i < r.grid.w; i++) {
      const px = (r.y + j) * W + r.x + i;
      if (!got[px]) continue;
      const v = (pixels[px * 4] + pixels[px * 4 + 1] + pixels[px * 4 + 2]) / 3, o = (ours(px, 0) + ours(px, 1) + ours(px, 2)) / 3;
      const bn = bins.find((x) => v < x.hi)!;
      bn.n++; bn.v += v; bn.o += o;
    }
  }
  // Faces in the atrium that differ most (area-weighted), to chase down one by one.
  const worst: { id: number; tex: string; n: number; v: number; o: number; c: number[]; nrm: number[] }[] = [];
  for (const f of faces as Face[]) {
    const r = layout.rects.get(f.id);
    if (!r) continue;
    let n = 0, v = 0, o = 0;
    for (let j = 0; j < r.grid.h; j++) for (let i = 0; i < r.grid.w; i++) {
      const px = (r.y + j) * W + r.x + i;
      if (!got[px]) continue;
      n++; v += (pixels[px * 4] + pixels[px * 4 + 1] + pixels[px * 4 + 2]) / 3; o += (ours(px, 0) + ours(px, 1) + ours(px, 2)) / 3;
    }
    const c = facePoint(f, f.width / 2, f.height / 2);
    if (n < 4 || !inBox(c)) continue;
    worst.push({ id: f.id, tex: f.tex, n, v: v / n, o: o / n, c: c.map(Math.round), nrm: f.n.map((x) => +x.toFixed(2)) });
  }
  worst.sort((a, b) => b.n * Math.abs(Math.log((b.o + 0.01) / (b.v + 0.01))) - a.n * Math.abs(Math.log((a.o + 0.01) / (a.v + 0.01))));
  console.log('atrium faces that differ most (luxels, valve, ours, centre, normal):');
  for (const w of worst.slice(0, 20)) console.log(`  ${w.id} ${w.tex.padEnd(44)} ${String(w.n).padStart(5)}  ${w.v.toFixed(3)}  ${w.o.toFixed(3)}  ${JSON.stringify(w.c)} ${JSON.stringify(w.nrm)}`);
  console.log('by Valve brightness: ' + bins.map((x) => `<${x.hi}: ${x.n ? (x.o / x.v).toFixed(2) : '-'} (${x.n})`).join('  '));
  if (probe) {
    // The 5×5 luxels around a point on a face with that normal: Valve's / ours (flat slot, mean of RGB).
    for (const f of faces as Face[]) {
      const r = layout.rects.get(f.id);
      if (!r || dot(f.n, probe.slice(3)) < 0.99 || Math.abs(dot(f.n, probe.slice(0, 3)) - dot(f.n, f.origin)) > 1) continue;
      const g = r.grid, si = Math.round(dot(g.lmS, probe) - g.minS), ti = Math.round(dot(g.lmT, probe) - g.minT);
      if (si < 0 || ti < 0 || si >= g.w || ti >= g.h) continue;
      console.log(`probe face ${f.id} ${f.tex} at luxel ${si},${ti} of ${g.w}x${g.h}:`);
      for (let j = ti - 2; j <= ti + 2; j++) {
        const row: string[] = [];
        for (let i = si - 2; i <= si + 2; i++) {
          if (i < 0 || j < 0 || i >= g.w || j >= g.h) { row.push('     -     '); continue; }
          const px = (r.y + j) * W + r.x + i;
          row.push(`${got[px] ? ((pixels[px * 4] + pixels[px * 4 + 1] + pixels[px * 4 + 2]) / 3).toFixed(3) : '  -  '}/${((ours(px, 0) + ours(px, 1) + ours(px, 2)) / 3).toFixed(3)}`);
        }
        console.log('   ' + row.join(' '));
      }
    }
  }
  console.log(`all: ours/valve mean light ${(all.o / all.v).toFixed(3)}, blue ${(all.ob / all.vb).toFixed(3)} over ${all.n} luxels`);
  for (const [t, e] of [...per].sort((a, b) => b[1].n - a[1].n).slice(0, 25)) {
    console.log(`${t.padEnd(52)} n ${String(e.n).padStart(7)}  valve ${(e.v / e.n).toFixed(3)}  ours ${(e.o / e.n).toFixed(3)}  ratio ${(e.o / e.v).toFixed(2)}  blue ratio ${(e.ob / e.vb).toFixed(2)}`);
  }
}
