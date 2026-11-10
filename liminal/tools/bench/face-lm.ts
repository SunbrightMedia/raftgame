/**
 * One face's lightmap from two caches side by side (PNG, gamma, ×scale), to see where bakes differ:
 *   npx vite-node tools/bench/face-lm.ts -- MAP A.json B.json OUT.png x,y,z nx,ny,nz [scale]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync, deflateSync } from 'node:zlib';
import { parseMap } from '../../src/data/map';
import { buildFaces } from '../../src/engine/light/faces';
import { sourceLayout, SOURCE_LM_WIDTH } from '../../src/engine/light/vrad';
import { sourceBakeInfo } from '../../src/game/sourceLighting';

const [mapPath, aPath, bPath, outPath, pArg, nArg, scaleArg] = process.argv.slice(2).filter((a) => a !== '--');
const P = pArg.split(',').map(Number), Nn = nArg.split(',').map(Number), scale = Number(scaleArg ?? 2);
const map = parseMap(JSON.parse(readFileSync(mapPath, 'utf8')));
const idx = JSON.parse(readFileSync('textures/p2/index.json', 'utf8')).textures as { name: string; size: [number, number]; source: Record<string, unknown> }[];
const mats = new Map(idx.map((t) => [t.name, { size: t.size, source: t.source }]));
const faces = buildFaces(map.brushes);
const { info } = sourceBakeInfo(map, faces, (tex) => mats.get(tex) as never);
const lay = sourceLayout(faces, info, SOURCE_LM_WIDTH);
let best = null as null | { id: number; d: number };
for (const f of faces) {
  if (!lay.rects.has(f.id) || f.n[0] * Nn[0] + f.n[1] * Nn[1] + f.n[2] * Nn[2] < 0.99) continue;
  const d = Math.abs((P[0] - f.origin[0]) * f.n[0] + (P[1] - f.origin[1]) * f.n[1] + (P[2] - f.origin[2]) * f.n[2]);
  const g = lay.rects.get(f.id)!.grid, s = P[0] * g.lmS[0] + P[1] * g.lmS[1] + P[2] * g.lmS[2] - g.minS, t = P[0] * g.lmT[0] + P[1] * g.lmT[1] + P[2] * g.lmT[2] - g.minT;
  if (d > 1 || s < 0 || t < 0 || s > g.w || t > g.h) continue;
  if (!best || d < best.d) best = { id: f.id, d };
}
if (!best) throw new Error('no face there');
const r = lay.rects.get(best.id)!, W = lay.width;
const dec = (p: string) => { const c = JSON.parse(readFileSync(p, 'utf8')); return inflateRawSync(Buffer.from(c.data, 'base64')); };
const A = dec(aPath), B = dec(bPath);
const val = (buf: Buffer, i: number, k: number) => { const e = buf[i * 5 + 3]; return e ? buf[i * 5 + k] * Math.pow(2, e - 128) / 255 : 0; };
const w = r.w, h = r.h, outW = w * 3 + 4;
const rgb = new Uint8Array(outW * h * 3);
for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
  const src = (r.y + j) * W + r.x + i;
  for (let k = 0; k < 3; k++) {
    const a = val(A, src, k), b = val(B, src, k);
    const enc = (v: number) => Math.min(255, Math.round(255 * Math.pow(Math.max(0, v * scale), 1 / 2.2)));
    rgb[(j * outW + i) * 3 + k] = enc(a);
    rgb[(j * outW + w + 2 + i) * 3 + k] = enc(b);
    // ratio: red = B brighter, blue = A brighter
    const q = Math.log2((b + 1e-4) / (a + 1e-4));
    rgb[(j * outW + 2 * w + 4 + i) * 3 + k] = k === 0 ? Math.min(255, Math.max(0, q * 400)) : k === 2 ? Math.min(255, Math.max(0, -q * 400)) : 0;
  }
}
// minimal PNG
const crc = (buf: Buffer) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const raw = Buffer.alloc((outW * 3 + 1) * h);
for (let j = 0; j < h; j++) { raw[j * (outW * 3 + 1)] = 0; Buffer.from(rgb.buffer, j * outW * 3, outW * 3).copy(raw, j * (outW * 3 + 1) + 1); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(outW, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(outPath, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`face ${best.id} ${map.brushes.length ? '' : ''}${w}x${h} luxels → ${outPath} (A | B | red = B brighter, blue = A brighter)`);
