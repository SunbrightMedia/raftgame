/**
 * Check engine/light/vrad.ts against what Valve's VRAD actually wrote into a
 * shipped Portal 2 map: each light entity's keys (entity lump) parsed by us vs
 * the light VRAD exported (worldlights lump, HDR): intensity and falloff.
 *   npm run validate:vrad -- reference/portal2/sp_a3_speed_ramp.bsp
 */
import { readFileSync } from 'node:fs';
import { gatherSample, parseSourceLight } from '../../src/engine/light/vrad';

const path = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'reference/portal2/sp_a3_speed_ramp.bsp';
const b = readFileSync(path);
const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
const lump = (i: number) => ({ o: dv.getInt32(8 + i * 16, true), l: dv.getInt32(12 + i * 16, true), v: dv.getInt32(16 + i * 16, true) });

// Entity lump: { "key" "value" ... } blocks.
const text = b.subarray(lump(0).o, lump(0).o + lump(0).l).toString('latin1');
const ents: Record<string, string>[] = [];
for (const blk of text.split('}')) {
  const e: Record<string, string> = {};
  for (const m of blk.matchAll(/"([^"]*)"\s+"([^"]*)"/g)) e[m[1].toLowerCase()] = m[2];
  if (e.classname) ents.push(e);
}

// Worldlights (HDR, lump 54), Portal 2 layout (100 bytes: shadow_cast_offset after normal).
const wl = lump(54);
const lights: { origin: number[]; intensity: number[]; type: number; style: number; stopdot: number; stopdot2: number; exponent: number; c: number; l: number; q: number }[] = [];
for (let o = wl.o; o + 100 <= wl.o + wl.l; o += 100) {
  const f = (k: number) => dv.getFloat32(o + k * 4, true), n = (k: number) => dv.getInt32(o + k * 4, true);
  lights.push({ origin: [f(0), f(1), f(2)], intensity: [f(3), f(4), f(5)], type: n(13), style: n(14), stopdot: f(15), stopdot2: f(16), exponent: f(17), c: f(19), l: f(20), q: f(21) });
}
console.log(`${ents.filter((e) => e.classname.startsWith('light')).length} light entities, ${lights.length} worldlights`);

let matched = 0, worst = 0, worstFall = 0;
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-6, Math.abs(b));
for (const e of ents) {
  if (e.classname !== 'light' && e.classname !== 'light_spot') continue;
  const origin = (e.origin ?? '0 0 0').split(/\s+/).map(Number) as [number, number, number];
  const w = lights.find((l) => Math.hypot(l.origin[0] - origin[0], l.origin[1] - origin[1], l.origin[2] - origin[2]) < 0.01);
  const ours = parseSourceLight(e, origin);
  if (!w || !ours) continue;
  matched++;
  const di = Math.max(...[0, 1, 2].map((k) => rel(ours.intensity[k] / 255, w.intensity[k])));
  // Compare the falloff curves (what matters), at a few distances.
  const fall = (c: number, l: number, q: number, d: number) => 1 / (c + l * d + q * d * d);
  const df = Math.max(...[16, 64, 128, 256, 512].map((d) => rel(fall(ours.constant, ours.linear, ours.quadratic, d), fall(w.c, w.l, w.q, d))));
  if (di > 1e-3 || df > 1e-3 || (ours.type === 'spot' && Math.abs(ours.stopdot2 - w.stopdot2) > 1e-4)) {
    console.log('MISMATCH', e.classname, e.origin, { ours: [...ours.intensity.map((x) => +(x / 255).toFixed(4)), ours.constant, ours.linear, ours.quadratic], vrad: [...w.intensity.map((x) => +x.toFixed(4)), w.c, w.l, w.q], keys: { _light: e._light, _lighthdr: e._lighthdr, _lightscalehdr: e._lightscalehdr, d50: e._fifty_percent_distance, d0: e._zero_percent_distance } });
  }
  worst = Math.max(worst, di); worstFall = Math.max(worstFall, df);
}
console.log(`matched ${matched}; worst intensity error ${(worst * 100).toFixed(3)}%, worst falloff error ${(worstFall * 100).toFixed(3)}%`);

// ---- Lightmap units: our unshadowed direct light at the BSP's own luxels vs the luxel values VRAD stored.
// (Direct + bounce ≥ our unshadowed direct where nothing blocks; where a luxel is lit mostly directly the ratio is a little over 1.)
const planes = lump(1), texinfo = lump(6), faces = lump(58), lighting = lump(53);
const srcLights = ents.filter((e) => e.classname === 'light' || e.classname === 'light_spot').map((e) => parseSourceLight(e, (e.origin ?? '0 0 0').split(/\s+/).map(Number) as [number, number, number])).filter((l) => l && !l.style) as NonNullable<ReturnType<typeof parseSourceLight>>[];
const ratios: number[] = [];
const dots = [0];
let facesSeen = 0;
for (let fo = faces.o; fo + 56 <= faces.o + faces.l; fo += 56) {
  const planenum = dv.getUint16(fo, true), side = dv.getUint8(fo + 2);
  const ti = dv.getInt16(fo + 10, true), disp = dv.getInt16(fo + 12, true);
  const style0 = dv.getUint8(fo + 16), lightofs = dv.getInt32(fo + 20, true);
  const minS = dv.getInt32(fo + 28, true), minT = dv.getInt32(fo + 32, true), sizeS = dv.getInt32(fo + 36, true), sizeT = dv.getInt32(fo + 40, true);
  if (lightofs < 0 || style0 !== 0 || disp !== -1 || ti < 0) continue;
  const po = planes.o + planenum * 20;
  let n: [number, number, number] = [dv.getFloat32(po, true), dv.getFloat32(po + 4, true), dv.getFloat32(po + 8, true)];
  let d = dv.getFloat32(po + 12, true);
  void side; // planenum is already the face's own plane
  const to = texinfo.o + ti * 72;
  const L = (r: number) => [0, 1, 2, 3].map((k) => dv.getFloat32(to + 32 + r * 16 + k * 4, true));
  const ls = L(0), lt = L(1);
  // Solve p: p·ls.xyz = s - ls.w, p·lt.xyz = t - lt.w, p·n = d.
  const A = [ls.slice(0, 3), lt.slice(0, 3), n];
  const cr = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const det = A[0][0] * cr(A[1], A[2])[0] + A[0][1] * cr(A[1], A[2])[1] + A[0][2] * cr(A[1], A[2])[2];
  if (Math.abs(det) < 1e-9) continue;
  const i0 = cr(A[1], A[2]), i1 = cr(A[2], A[0]), i2 = cr(A[0], A[1]);
  facesSeen++;
  const W = sizeS + 1, H = sizeT + 1;
  for (let t = 0; t < H; t += 2) for (let s = 0; s < W; s += 2) {
    const a = minS + s - ls[3], bb = minT + t - lt[3];
    const p = [0, 1, 2].map((k) => (a * i0[k] + bb * i1[k] + d * i2[k]) / det);
    const x = p[0] + n[0], y = p[1] + n[1], z = p[2] + n[2];
    let direct = 0;
    for (const l of srcLights) {
      const fo2 = gatherSample(l, x, y, z, [n], dots, null);
      if (fo2 > 0) direct += fo2 * dots[0] * (l.intensity[0] + l.intensity[1] + l.intensity[2]) / 3;
    }
    direct /= 255;
    if (direct < 0.25) continue;
    const lo = lighting.o + lightofs + (t * W + s) * 4;
    const e = dv.getInt8(lo + 3), sc = Math.pow(2, e) / 255;
    const v = (dv.getUint8(lo) + dv.getUint8(lo + 1) + dv.getUint8(lo + 2)) / 3 * sc;
    ratios.push(v / direct);
  }
}
ratios.sort((x, y) => x - y);
const q = (f: number) => ratios[Math.floor(f * (ratios.length - 1))]?.toFixed(3);
console.log(`lightmap/our-direct over ${ratios.length} directly lit luxels of ${facesSeen} faces: p10 ${q(0.1)} p25 ${q(0.25)} median ${q(0.5)} p75 ${q(0.75)} p90 ${q(0.9)}`);
