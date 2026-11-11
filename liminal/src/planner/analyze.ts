/**
 * Checks on a generated plan, on a raster of half-tile cells: how much of the
 * floor can be walked to from the hub, and how full the mapped area is
 * (map 1 measured 0.66).
 */
import { bboxOf, pointInPoly, type V2 } from './geom';
import type { MapOut } from './types';

const RES = 2; // cells per tile

function fillPoly(grid: Uint8Array, W: number, H: number, x0: number, y0: number, pts: V2[], val: number): void {
  const bb = bboxOf(pts);
  const gx0 = Math.max(0, Math.floor((bb.x0 - x0) * RES)), gx1 = Math.min(W - 1, Math.ceil((bb.x1 - x0) * RES));
  const gy0 = Math.max(0, Math.floor((bb.y0 - y0) * RES)), gy1 = Math.min(H - 1, Math.ceil((bb.y1 - y0) * RES));
  for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
    if (pointInPoly({ x: x0 + (gx + 0.5) / RES, y: y0 + (gy + 0.5) / RES }, pts)) grid[gy * W + gx] = val;
  }
}

function fillSeg(grid: Uint8Array, W: number, H: number, x0: number, y0: number, a: V2, b: V2, half: number): void {
  const bx0 = Math.min(a.x, b.x) - half, bx1 = Math.max(a.x, b.x) + half, by0 = Math.min(a.y, b.y) - half, by1 = Math.max(a.y, b.y) + half;
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
  for (let gy = Math.max(0, Math.floor((by0 - y0) * RES)); gy <= Math.min(H - 1, Math.ceil((by1 - y0) * RES)); gy++) {
    for (let gx = Math.max(0, Math.floor((bx0 - x0) * RES)); gx <= Math.min(W - 1, Math.ceil((bx1 - x0) * RES)); gx++) {
      const px = x0 + (gx + 0.5) / RES, py = y0 + (gy + 0.5) / RES;
      const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / L2));
      const qx = a.x + dx * t - px, qy = a.y + dy * t - py;
      if (qx * qx + qy * qy <= half * half) grid[gy * W + gx] = 0;
    }
  }
}

/** Box sum over radius r (in cells) via a summed-area table. */
function boxCount(src: Uint8Array, W: number, H: number, r: number): Int32Array {
  const S = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += src[y * W + x]; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row; } }
  const out = new Int32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const xa = Math.max(0, x - r), xb = Math.min(W, x + r + 1), ya = Math.max(0, y - r), yb = Math.min(H, y + r + 1);
    out[y * W + x] = S[yb * (W + 1) + xb] - S[ya * (W + 1) + xb] - S[yb * (W + 1) + xa] + S[ya * (W + 1) + xa];
  }
  return out;
}

export function analyze(m: MapOut): { reached: number; floorShare: number; cutOff: number[] } {
  const b = m.bounds;
  const PAD = 12;
  const x0 = Math.floor(b.x0) - PAD, y0 = Math.floor(b.y0) - PAD;
  const W = Math.ceil((b.x1 - x0 + PAD) * RES), H = Math.ceil((b.y1 - y0 + PAD) * RES);
  if (W * H > 9_000_000 || W <= 0 || H <= 0) return { reached: 0, floorShare: 0, cutOff: [] };
  const g = new Uint8Array(W * H);
  for (const p of m.prims) if (p.t === 'floor') fillPoly(g, W, H, x0, y0, p.pts, 1);
  const floorOnly = g.slice();
  for (const p of m.prims) {
    if (p.t === 'solid' && !p.closed) fillPoly(g, W, H, x0, y0, p.pts, 0);
    else if (p.t === 'area' && (p.kind === 'pit' || p.kind === 'pool' || p.kind === 'crevice')) fillPoly(g, W, H, x0, y0, p.pts, 0);
    else if (p.t === 'wall' && p.kind !== 'fake' && p.kind !== 'over' && !p.closed) fillSeg(g, W, H, x0, y0, p.a, p.b, p.w / 2 + 0.1);
  }
  let total = 0;
  for (let k = 0; k < g.length; k++) total += g[k];
  // walk from the hub's middle (nearest open cell)
  const hub = m.zones[0];
  let start = -1;
  if (hub) {
    const cx = Math.floor((hub.frame.x - x0) * RES), cy = Math.floor((hub.frame.y - y0) * RES);
    for (let r = 0; r < 40 && start < 0; r++) for (let dy = -r; dy <= r && start < 0; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && y >= 0 && x < W && y < H && g[y * W + x]) { start = y * W + x; break; }
    }
  }
  let reached = 0;
  const seen = new Uint8Array(W * H);
  if (start >= 0) {
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      reached++;
      const x = c % W;
      for (const n of [c - 1, c + 1, c - W, c + W]) {
        if (n < 0 || n >= W * H || seen[n] || !g[n]) continue;
        if ((n === c - 1 && x === 0) || (n === c + 1 && x === W - 1)) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
  // floor share inside the mapped area (closing by about 7 tiles, as for map 1)
  const r = 7 * RES;
  const grown = boxCount(floorOnly, W, H, r);
  const dil = new Uint8Array(W * H);
  for (let k = 0; k < dil.length; k++) dil[k] = grown[k] > 0 ? 1 : 0;
  const back = boxCount(dil, W, H, r);
  const full = (2 * r + 1) * (2 * r + 1);
  let explored = 0, floor = 0;
  for (let k = 0; k < dil.length; k++) {
    if (back[k] >= full) explored++;
    floor += floorOnly[k];
  }
  // zones whose own floor (inside their box) was never reached
  const cutOff: number[] = [];
  for (const z of m.zones) {
    if (z.feature === 'mass') continue;
    const c = Math.cos(z.frame.a), s = Math.sin(z.frame.a);
    const ext = (Math.abs(z.w * c) + Math.abs(z.h * s)) / 2, eyt = (Math.abs(z.w * s) + Math.abs(z.h * c)) / 2;
    let any = false, found = false;
    for (let gy = Math.max(0, Math.floor((z.frame.y - eyt - y0) * RES)); gy <= Math.min(H - 1, Math.ceil((z.frame.y + eyt - y0) * RES)) && !found; gy++) {
      for (let gx = Math.max(0, Math.floor((z.frame.x - ext - x0) * RES)); gx <= Math.min(W - 1, Math.ceil((z.frame.x + ext - x0) * RES)); gx++) {
        const k = gy * W + gx;
        if (!g[k]) continue;
        const dx = x0 + (gx + 0.5) / RES - z.frame.x, dy = y0 + (gy + 0.5) / RES - z.frame.y;
        const lx = dx * c + dy * s, ly = -dx * s + dy * c;
        if (Math.abs(lx) > z.w / 2 - 0.5 || Math.abs(ly) > z.h / 2 - 0.5) continue;
        any = true;
        if (seen[k]) { found = true; break; }
      }
    }
    if (any && !found) cutOff.push(z.id);
  }
  return { reached: total ? reached / total : 0, floorShare: explored ? Math.min(1, floor / explored) : 0, cutOff };
}
