// Debug: draw a close-up of one zone (by key) of a generated map.
import { writeFileSync } from 'node:fs';
import { generate, DEFAULT_PARAMS } from '../../src/planner/generate';
import { drawMap, SvgPen, DEFAULT_LAYERS } from '../../src/planner/draw';
const [out, seedS, key, overS] = process.argv.slice(2);
const m = generate({ ...DEFAULT_PARAMS, ...(overS ? JSON.parse(overS) : {}), seed: Number(seedS) });
const z = m.zones.find((q) => q.key === key)!;
const W = 900, H = 900, scale = 900 / (Math.max(z.w, z.h) + 30);
const pen = new SvgPen(W, H);
drawMap(pen, m, { cx: z.frame.x, cy: z.frame.y, scale, w: W, h: H }, { ...DEFAULT_LAYERS, labels: true, grid: true }, z.id);
writeFileSync(`${out}/zoom_${seedS}_${key}.svg`, pen.svg());
const links = m.links.filter((l) => l.a === z.id || l.b === z.id);
console.log(z.key, z.feature, 'w', z.w, 'h', z.h, 'a', z.frame.a.toFixed(2), 'ports', JSON.stringify(z.ports.map((p) => ({ x: +p.p.x.toFixed(2), y: +p.p.y.toFixed(2), a: +p.a.toFixed(2), w: p.w }))));
for (const l of links) console.log('  link', l.kind, 'a', m.zones[l.a].key, m.zones[l.a].feature, 'b', m.zones[l.b].key, m.zones[l.b].feature, 'w', l.w, 'path', JSON.stringify(l.path.map((p) => [+p.x.toFixed(1), +p.y.toFixed(1)])));
