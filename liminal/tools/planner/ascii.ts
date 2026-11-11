// Debug: ASCII view of the walk raster around a point.
import { generate, DEFAULT_PARAMS } from '../../src/planner/generate';
import { pointInPoly } from '../../src/planner/geom';
const [seedS, xs, ys] = process.argv.slice(2);
const m = generate({ ...DEFAULT_PARAMS, seed: Number(seedS) });
const cx = Number(xs), cy = Number(ys);
const rows: string[] = [];
for (let y = cy - 8; y <= cy + 8; y += 0.5) {
  let row = '';
  for (let x = cx - 20; x <= cx + 20; x += 0.5) {
    const p = { x, y };
    let c = ' ';
    if (m.prims.some((q) => q.t === 'floor' && pointInPoly(p, q.pts))) c = '.';
    if (m.prims.some((q) => q.t === 'solid' && pointInPoly(p, q.pts))) c = '#';
    for (const q of m.prims) if (q.t === 'wall' && q.kind !== 'fake') {
      const dx = q.b.x - q.a.x, dy = q.b.y - q.a.y, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - q.a.x) * dx + (y - q.a.y) * dy) / L2));
      if (Math.hypot(q.a.x + dx * t - x, q.a.y + dy * t - y) <= q.w / 2 + 0.1) { c = 'W'; break; }
    }
    row += c;
  }
  rows.push(row);
}
console.log(rows.join('\n'));
