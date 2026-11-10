/**
 * Seeded random numbers for world generation. The same seed always gives the
 * same world; `fork(label)` gives an independent stream for one part (a room,
 * a street), so changing one part never reshuffles the others.
 */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export class Rng {
  private s: number;
  constructor(readonly seed: number) { this.s = seed >>> 0; }

  /** A stream of its own for `label`, fixed by this generator's seed and the label alone. */
  fork(label: string | number): Rng {
    return new Rng((Math.imul(this.seed ^ 0x9e3779b9, 0x85ebca6b) ^ hashString(String(label))) >>> 0);
  }

  /** 0 ≤ x < 1 (mulberry32). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number { return lo + (hi - lo) * this.next(); }
  /** Integer in lo..hi, both included. */
  int(lo: number, hi: number): number { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(a: readonly T[]): T { return a[Math.floor(this.next() * a.length)]; }
  /** One of the items, each with its weight. */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of items) total += w;
    let r = this.next() * total;
    for (const [v, w] of items) { r -= w; if (r < 0) return v; }
    return items[items.length - 1][0];
  }
  shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
}
