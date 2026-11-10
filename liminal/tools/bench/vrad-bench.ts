/**
 * Run the Source baker (engine/light/vrad.ts) on a map headless and report
 * timings and light levels: npm run bench:vrad -- maps/p2/shipyard_atrium.json
 */
import { readFileSync } from 'node:fs';
import { parseMap } from '../../src/data/map';
import { buildFaces } from '../../src/engine/light/faces';
import { bakeSource, sourceLayout } from '../../src/engine/light/vrad';
import { propBakeData, sourceBakeInfo } from '../../src/game/sourceLighting';
import { readdirSync } from 'node:fs';

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith('--')) ?? 'maps/p2/shipyard_atrium.json';
const map = parseMap(JSON.parse(readFileSync(path, 'utf8')));
const idx = JSON.parse(readFileSync('textures/p2/index.json', 'utf8')).textures as { name: string; size: [number, number]; source: Record<string, unknown> }[];
const mats = new Map(idx.map((t) => [t.name, { size: t.size, source: t.source }]));
const t0 = Date.now();
const faces = buildFaces(map.brushes);
const { info, occluders, lights } = sourceBakeInfo(map, faces, (tex) => mats.get(tex) as never);
console.log(`faces ${faces.length}, occluders ${occluders.length}, lights ${lights.length} (${Date.now() - t0} ms prep)`);
const lay = sourceLayout(faces, info, 4096);
let lux = 0;
for (const r of lay.rects.values()) lux += r.w * r.h * r.slots;
console.log(`layout ${lay.width}x${lay.height}, ${lux} luxels`);
if (args.includes('--layout')) process.exit(0);
// Models: header + .bin (float32 positions, normals, uvs, then indices).
const modelFiles = new Map<string, { positions: Float32Array; normals: Float32Array }>();
for (const f of readdirSync('models', { recursive: true }) as string[]) {
  if (!f.endsWith('.json')) continue;
  const h = JSON.parse(readFileSync(`models/${f}`, 'utf8'));
  if (h.format !== 'liminal-mesh') continue;
  const buf = readFileSync(`models/${f.replace(/[^/]*$/, h.bin)}`);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  modelFiles.set(String(h.source).toLowerCase(), { positions: new Float32Array(ab, 0, h.vertexCount * 3), normals: new Float32Array(ab, h.vertexCount * 12, h.vertexCount * 3) });
}
const props = args.includes('--props') ? propBakeData(map, (n) => modelFiles.get(n.toLowerCase())) : undefined;
if (props) console.log(`props: ${props.instances.length} instances, ${props.instances.reduce((a, i) => a + props.models[i.model].positions.length / 3, 0)} vertices`);
const out = bakeSource({ faces, info, occluders, lights, props, params: { bounces: Number(args[args.indexOf('--bounces') + 1]) || 100, patchRays: Number(args[args.indexOf("--rays") + 1]) || 256, chop: 4, supersample: !args.includes('--fast'), maxWidth: 4096 }, log: (m) => console.log(m, `${Math.round(process.memoryUsage().rss / 1e6)} MB`) });
console.log(`baked in ${out.ms} ms: ${out.width}x${out.height}, ${out.luxels} luxels, ${out.patches} patches, ${out.bounces} bounces`);
const v: number[] = [];
for (let i = 0; i < out.pixels.length; i += 4) if (out.pixels[i + 3] > 0) v.push((out.pixels[i] + out.pixels[i + 1] + out.pixels[i + 2]) / 3);
v.sort((a, b) => a - b);
console.log('luxel light (Source linear) p10/50/90/99:', [0.1, 0.5, 0.9, 0.99].map((q) => v[Math.floor(q * (v.length - 1))].toFixed(3)).join(' '));
