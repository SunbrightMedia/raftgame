/**
 * Run the Source baker (engine/light/vrad.ts) on a map headless and report
 * timings and light levels: npm run bench:vrad -- maps/p2/shipyard_atrium.json
 */
import { readFileSync } from 'node:fs';
import { parseMap } from '../../src/data/map';
import { buildFaces } from '../../src/engine/light/faces';
import { bakeSource, sourceLayout, SOURCE_LM_WIDTH } from '../../src/engine/light/vrad';
import { propBakeData, propShadowTris, sourceBakeInfo } from '../../src/game/sourceLighting';
import { readdirSync, writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith('--')) ?? 'maps/p2/shipyard_atrium.json';
const map = parseMap(JSON.parse(readFileSync(path, 'utf8')));
const idx = JSON.parse(readFileSync('textures/p2/index.json', 'utf8')).textures as { name: string; size: [number, number]; source: Record<string, unknown> }[];
const mats = new Map(idx.map((t) => [t.name, { size: t.size, source: t.source }]));
const t0 = Date.now();
const faces = buildFaces(map.brushes);
const { info, occluders, reflectors, lights } = sourceBakeInfo(map, faces, (tex) => mats.get(tex) as never);
console.log(`faces ${faces.length}, occluders ${occluders.length}, lights ${lights.length} (${Date.now() - t0} ms prep)`);
const lay = sourceLayout(faces, info, SOURCE_LM_WIDTH);
let lux = 0;
for (const r of lay.rects.values()) lux += r.w * r.h * r.slots;
console.log(`layout ${lay.width}x${lay.height}, ${lux} luxels`);
if (args.includes('--layout')) process.exit(0);
// Models: header + .bin (float32 positions, normals, uvs, then indices).
const modelFiles = new Map<string, { positions: Float32Array; normals: Float32Array }>();
const shadows = new Map<string, number[]>();
for (const f of readdirSync('models', { recursive: true }) as string[]) {
  if (!f.endsWith('.json')) continue;
  const h = JSON.parse(readFileSync(`models/${f}`, 'utf8'));
  if (h.format !== 'liminal-mesh') continue;
  if (h.shadow) shadows.set(String(h.source).toLowerCase(), h.shadow);
  const buf = readFileSync(`models/${f.replace(/[^/]*$/, h.bin)}`);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  modelFiles.set(String(h.source).toLowerCase(), { positions: new Float32Array(ab, 0, h.vertexCount * 3), normals: new Float32Array(ab, h.vertexCount * 12, h.vertexCount * 3) });
}
const props = args.includes('--props') ? propBakeData(map, (n) => modelFiles.get(n.toLowerCase())) : undefined;
if (props) console.log(`props: ${props.instances.length} instances, ${props.instances.reduce((a, i) => a + props.models[i.model].positions.length / 3, 0)} vertices`);
const propShadows = propShadowTris(map, (n) => shadows.get(n.toLowerCase()));
console.log(`prop shadow triangles: ${propShadows.length / 9}`);
const out = bakeSource({ faces, info, occluders, reflectors, lights, props, propShadows, params: { bounces: Number(args[args.indexOf('--bounces') + 1]) || 100, patchRays: Number(args[args.indexOf("--rays") + 1]) || 256, chop: 4, supersample: !args.includes('--fast'), maxWidth: SOURCE_LM_WIDTH }, log: (m) => console.log(m, `${Math.round(process.memoryUsage().rss / 1e6)} MB`) });
console.log(`baked in ${out.ms} ms: ${out.width}x${out.height}, ${out.luxels} luxels, ${out.patches} patches, ${out.bounces} bounces`);
const v: number[] = [];
for (let i = 0; i < out.pixels.length; i += 4) if (out.pixels[i + 3] > 0) v.push((out.pixels[i] + out.pixels[i + 1] + out.pixels[i + 2]) / 3);
v.sort((a, b) => a - b);
console.log('luxel light (Source linear) p10/50/90/99:', [0.1, 0.5, 0.9, 0.99].map((q) => v[Math.floor(q * (v.length - 1))].toFixed(3)).join(' '));

// --out FILE: save in the game's lightmap cache format (compare with npm run valve:lightmap -- MAP BSP FILE).
const outArg = args.indexOf('--out');
if (outArg > 0) {
  const n = out.width * out.height, enc = new Uint8Array(n * 5);
  for (let i = 0; i < n; i++) {
    const r = out.pixels[i * 4], g = out.pixels[i * 4 + 1], b = out.pixels[i * 4 + 2], m = Math.max(r, g, b);
    if (m > 1e-6) { const e = Math.ceil(Math.log2(m) + 1e-9), sc = 255 / Math.pow(2, e); enc[i * 5] = Math.min(255, Math.round(r * sc)); enc[i * 5 + 1] = Math.min(255, Math.round(g * sc)); enc[i * 5 + 2] = Math.min(255, Math.round(b * sc)); enc[i * 5 + 3] = e + 128; }
    enc[i * 5 + 4] = 255;
  }
  writeFileSync(args[outArg + 1], JSON.stringify({ format: 'liminal-lightmap', version: 0, encoding: 'rgbe-deflate', key: 'bench', width: out.width, height: out.height, luxel: 16, data: deflateRawSync(enc).toString('base64') }));
  console.log('wrote', args[outArg + 1]);
}
