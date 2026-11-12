// The 'blender' camera model's data (data/blender/): the program and its tables fit together, and the dither
// noise is Blender's.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ditherNoise, type BPProgram } from '../src/engine/render/blenderPost';

const DIR = path.resolve(__dirname, '../data/blender');

/** Code size of main() once every call is inlined (what D3D's shader compiler, behind Chrome on Windows, does). */
function inlinedSize(src: string): number {
  const body = new Map<string, string>();
  for (const m of src.matchAll(/^[A-Za-z_]\w*\s+([A-Za-z_]\w*)\s*\([^;{]*\)\s*\{/gm)) {
    let d = 1, i = m.index! + m[0].length;
    const start = i;
    while (d) { d += src[i] === '{' ? 1 : src[i] === '}' ? -1 : 0; i++; }
    body.set(m[1], (body.get(m[1]) ?? '') + src.slice(start, i));
  }
  const memo = new Map<string, number>();
  const size = (f: string, stack: string[]): number => {
    if (memo.has(f)) return memo.get(f)!;
    const b = body.get(f)!;
    let n = b.replace(/\s+/g, ' ').length;
    for (const [, c] of b.matchAll(/([A-Za-z_]\w*)\s*\(/g)) if (body.has(c) && c !== f && !stack.includes(c)) n += size(c, [...stack, f]);
    memo.set(f, n);
    return n;
  };
  return size('main', []);
}

describe('blender post data', () => {
  const prog = JSON.parse(fs.readFileSync(path.join(DIR, 'blenderPost.json'), 'utf8')) as BPProgram;
  const fast = JSON.parse(fs.readFileSync(path.join(DIR, 'blenderPost.fast.json'), 'utf8')) as BPProgram;

  it('the fast program is the exact one on lighter maths: same passes, textures, tables', () => {
    expect(fast.passes.map((p) => [p.label, p.out, p.inputs])).toEqual(prog.passes.map((p) => [p.label, p.out, p.inputs]));
    expect(fast.textures).toEqual(prog.textures);
    expect(fast.data).toEqual(prog.data);
    expect([fast.display, fast.output, fast.size]).toEqual([prog.display, prog.output, prog.size]);
    // the published page plays the fast one
    expect(JSON.parse(fs.readFileSync(path.join(DIR, 'files.json'), 'utf8'))[0]).toBe('blenderPost.fast.json');
  });

  it('the fast program stays small once inlined (the exact one froze Chrome on Windows while compiling)', () => {
    const sizes = fast.passes.map((p) => inlinedSize(p.frag));
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThan(3 * 1024 * 1024);
    expect(Math.max(...sizes)).toBeLessThan(256 * 1024);
  });

  it('every table is complete, in parts under 15 MB', () => {
    expect(Object.keys(prog.data).length).toBeGreaterThan(0);
    for (const [name, files] of Object.entries(prog.data)) {
      const n = Number(/^ocio(\d+)_/.exec(name)![1]);
      let bytes = 0;
      for (const f of files) {
        const sz = fs.statSync(path.join(DIR, f)).size;
        expect(sz).toBeLessThan(15 * 1024 * 1024);
        bytes += sz;
      }
      expect(bytes).toBe(n * n * n * 3 * 4);
    }
  });

  it('every pass reads textures that exist or come before it', () => {
    const made = new Set<string>(['input', 'curves', 'coords', 'rot', 'dither', ...Object.keys(prog.data)]);
    for (const p of prog.passes) {
      for (const tid of Object.values(p.inputs)) expect(made.has(tid), `${p.label} reads ${tid}`).toBe(true);
      made.add(p.out);
    }
    expect(made.has(prog.display!)).toBe(true);
    expect(prog.size).toEqual([854, 480]);
  });

  it('dither noise follows Blender (hash_iqint3, triangle, 0.0033)', () => {
    const d = ditherNoise(4, 2, 1);
    // values from tools/blender/compeval.py dither_bytes (float32), pixels (0,0) (1,0) (2,0) (0,1)
    const ref = [0, 0, 0, 0];
    const u = (x: number, y: number) => {
      const imul = (a: number, b: number) => Math.imul(a, b) >>> 0;
      const qx = imul(1103515245, (x >>> 1) ^ y), qy = imul(1103515245, (y >>> 1) ^ x);
      const nn = imul(1103515245, (qx ^ (qy >>> 3)) >>> 0);
      const f = Math.fround;
      let v = f(f(nn) * f(1 / 4294967296)); v = f(f(v * 2) - 1);
      const s = v < 0 ? -1 : 1;
      return f(f(s * f(1 - f(Math.sqrt(f(1 - Math.abs(v)))))) * f(0.0033));
    };
    ref[0] = u(0, 0); ref[1] = u(1, 0); ref[2] = u(2, 0); ref[3] = u(0, 1);
    expect([d[0], d[1], d[2], d[4]]).toEqual(ref);
    for (const v of d) expect(Math.abs(v)).toBeLessThanOrEqual(0.0033);
  });
});
