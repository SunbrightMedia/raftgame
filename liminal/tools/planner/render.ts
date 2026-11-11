import { writeFileSync } from 'node:fs';
import { generate, DEFAULT_PARAMS } from '../../src/planner/generate';
import { drawMap, SvgPen, DEFAULT_LAYERS } from '../../src/planner/draw';
const out = process.argv[2];
const seeds = (process.argv[3] ?? '1,2,3').split(',').map(Number);
const over = JSON.parse(process.argv[4] ?? '{}');
for (const seed of seeds) {
  const t = performance.now();
  const m = generate({ ...DEFAULT_PARAMS, ...over, seed });
  const ms = performance.now() - t;
  const b = m.bounds;
  const W = 1400, scale = Math.min(W / (b.x1 - b.x0 + 10), W / (b.y1 - b.y0 + 10));
  const H = Math.round((b.y1 - b.y0 + 10) * scale);
  const pen = new SvgPen(W, H);
  drawMap(pen, m, { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, scale, w: W, h: H }, { ...DEFAULT_LAYERS, labels: over.labels ?? false });
  writeFileSync(`${out}/map_${seed}.svg`, pen.svg());
  const feats: Record<string, number> = {};
  for (const z of m.zones) feats[z.feature] = (feats[z.feature] ?? 0) + 1;
  const { cutOff, ...rest } = m.stats;
  console.log(seed, `${ms.toFixed(0)}ms`, JSON.stringify(rest), 'prims', m.prims.length);
  if (cutOff.length) console.log('   cut off:', cutOff.map((id) => { const z = m.zones[id]; const l = m.links.find((k) => k.b === id || k.a === id); return `${z.key}/${z.feature}/${l?.kind}${l?.edge ? '+' + l.edge : ''}`; }).join(' '));
  console.log('   ', Object.entries(feats).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
}
