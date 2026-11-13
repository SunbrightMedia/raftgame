// Debugging: our tone cell's named intermediate values for given cells (x y z ...), as JSON.
import { toneCell, traceTone, COMPLEX_TONE, toneTrace } from '../../src/engine/render/complexTone';

const f = Math.fround, n = 32, args = process.argv.slice(2).filter((a) => /^-?\d+$/.test(a)).map(Number), out: Record<string, unknown> = {};
for (let k = 0; k + 2 < args.length; k += 3) {
  const [x, y, z] = args.slice(k, k + 3);
  const half = f(0.5 / n), step = f(n - 1);
  const enc = [f(f(f(f((x + 0.5) / n) - half) * n) / step), f(f(f(f((y + 0.5) / n) - half) * n) / step), f(z / step)] as [number, number, number];
  traceTone(true);
  const c = toneCell(COMPLEX_TONE, enc);
  out[`${x},${y},${z}`] = { ...toneTrace, out: c };
}
console.log(JSON.stringify(out));
