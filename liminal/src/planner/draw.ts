/**
 * Draws a plan in the clean look of map 1: dark grey ground, flat floor
 * colours per district, thin darker outlines. The outer walls are the outline
 * of all floors together: every floor is stroked first and filled after, so
 * only the outside edge of the union stays visible. The same calls draw to a
 * canvas or to SVG.
 */
import { FEATURE, THEME } from './catalogue';
import { bboxOf, dir, type BBox, type V2 } from './geom';
import type { MapOut, MarkKind, Prim } from './types';

export interface Style { fill?: string; stroke?: string; lw?: number; dash?: number[]; alpha?: number; join?: CanvasLineJoin; cap?: CanvasLineCap }
export interface TextStyle { size: number; color: string; align?: 'center' | 'left' | 'right'; angle?: number; hand?: boolean; bold?: boolean; alpha?: number }

export interface Pen {
  clear(color: string): void;
  poly(pts: V2[], s: Style): void;
  line(pts: V2[], s: Style): void;
  circle(c: V2, r: number, s: Style): void;
  text(p: V2, str: string, s: TextStyle): void;
}

export interface View { cx: number; cy: number; scale: number; w: number; h: number }
export interface Layers { walls: boolean; lights: boolean; marks: boolean; labels: boolean; notes: boolean; grid: boolean; layer2: boolean; heights: boolean }
export const DEFAULT_LAYERS: Layers = { walls: true, lights: true, marks: true, labels: false, notes: true, grid: false, layer2: false, heights: false };

export const BG = '#575757';
const HAND = "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive";

export class CanvasPen implements Pen {
  constructor(private g: CanvasRenderingContext2D) {}
  private style(s: Style): void {
    const g = this.g;
    g.globalAlpha = s.alpha ?? 1;
    if (s.fill) g.fillStyle = s.fill;
    if (s.stroke) { g.strokeStyle = s.stroke; g.lineWidth = s.lw ?? 1; g.setLineDash(s.dash ?? []); g.lineJoin = s.join ?? 'miter'; g.lineCap = s.cap ?? 'butt'; }
  }
  clear(color: string): void { const g = this.g; g.globalAlpha = 1; g.fillStyle = color; g.fillRect(0, 0, g.canvas.width, g.canvas.height); }
  poly(pts: V2[], s: Style): void {
    const g = this.g;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
    this.style(s);
    if (s.fill) g.fill();
    if (s.stroke) g.stroke();
  }
  line(pts: V2[], s: Style): void {
    const g = this.g;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    this.style(s);
    g.stroke();
  }
  circle(c: V2, r: number, s: Style): void {
    const g = this.g;
    g.beginPath();
    g.arc(c.x, c.y, Math.max(0.3, r), 0, Math.PI * 2);
    this.style(s);
    if (s.fill) g.fill();
    if (s.stroke) g.stroke();
  }
  text(p: V2, str: string, s: TextStyle): void {
    const g = this.g;
    g.save();
    g.globalAlpha = s.alpha ?? 1;
    g.translate(p.x, p.y);
    if (s.angle) g.rotate(s.angle);
    g.font = `${s.bold ? 'bold ' : ''}${s.size}px ${s.hand ? HAND : 'system-ui, sans-serif'}`;
    g.fillStyle = s.color;
    g.textAlign = s.align ?? 'center';
    g.textBaseline = 'middle';
    g.fillText(str, 0, 0);
    g.restore();
  }
}

export class SvgPen implements Pen {
  readonly parts: string[] = [];
  constructor(readonly w: number, readonly h: number) {}
  private st(s: Style): string {
    let a = '';
    a += s.fill ? ` fill="${s.fill}"` : ' fill="none"';
    if (s.stroke) a += ` stroke="${s.stroke}" stroke-width="${(s.lw ?? 1).toFixed(2)}" stroke-linejoin="${s.join ?? 'miter'}" stroke-linecap="${s.cap ?? 'butt'}"`;
    if (s.dash?.length) a += ` stroke-dasharray="${s.dash.map((d) => d.toFixed(1)).join(' ')}"`;
    if (s.alpha !== undefined && s.alpha < 1) a += ` opacity="${s.alpha.toFixed(3)}"`;
    return a;
  }
  private pts(p: V2[]): string { return p.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' '); }
  clear(color: string): void { this.parts.push(`<rect width="${this.w}" height="${this.h}" fill="${color}"/>`); }
  poly(p: V2[], s: Style): void { this.parts.push(`<polygon points="${this.pts(p)}"${this.st(s)}/>`); }
  line(p: V2[], s: Style): void { this.parts.push(`<polyline points="${this.pts(p)}"${this.st({ ...s, fill: undefined })}/>`); }
  circle(c: V2, r: number, s: Style): void { this.parts.push(`<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${Math.max(0.3, r).toFixed(2)}"${this.st(s)}/>`); }
  text(p: V2, str: string, s: TextStyle): void {
    const esc = str.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const anchor = s.align === 'left' ? 'start' : s.align === 'right' ? 'end' : 'middle';
    const rotate = s.angle ? ` transform="rotate(${((s.angle * 180) / Math.PI).toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)})"` : '';
    this.parts.push(`<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" font-size="${s.size.toFixed(1)}" font-family="${s.hand ? HAND.replace(/'/g, '') : 'system-ui, sans-serif'}"${s.bold ? ' font-weight="bold"' : ''} fill="${s.color}" text-anchor="${anchor}" dominant-baseline="middle"${s.alpha !== undefined ? ` opacity="${s.alpha}"` : ''}${rotate}>${esc}</text>`);
  }
  svg(): string { return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}" viewBox="0 0 ${this.w} ${this.h}">\n${this.parts.join('\n')}\n</svg>\n`; }
}

/** Darken or lighten a #rrggbb colour. */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(k < 1 ? c * k : c + (255 - c) * (k - 1))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, '0')).join('')}`;
}

const AREA: Record<string, { fill: string; stroke?: string }> = {
  water: { fill: '#6eaaf0' }, pool: { fill: '#5aa0e6', stroke: '#3d7cc0' }, pit: { fill: '#1f1f1f', stroke: '#111' }, crevice: { fill: '#161616' },
  lawn: { fill: '#8fb070' }, path: { fill: '#dcd2b4' }, road: { fill: '#5d5d5d' }, walk: { fill: '#bdb5a7' }, grate: { fill: '#3a3a3a', stroke: '#222' },
  tile: { fill: '#d5dde0' }, stage: { fill: 'rgba(110,80,40,0.18)' }, dark: { fill: 'rgba(0,0,0,0.25)' }, field: { fill: '#a9bf6a' },
};

export function viewBox(v: View): BBox {
  return { x0: v.cx - v.w / 2 / v.scale, y0: v.cy - v.h / 2 / v.scale, x1: v.cx + v.w / 2 / v.scale, y1: v.cy + v.h / 2 / v.scale };
}

/** The whole plan. `parts: 'base'` leaves out the selection and scale bar (drawOverlay), so the base can be
 * cached as a picture while those change. */
export function drawMap(pen: Pen, m: MapOut, v: View, L: Layers, sel = -1, parts: 'all' | 'base' = 'all'): void {
  const S = v.scale;
  const T = (p: V2): V2 => ({ x: (p.x - v.cx) * S + v.w / 2, y: (p.y - v.cy) * S + v.h / 2 });
  const vb = viewBox(v);
  const visible = (pts: V2[], pad = 2): boolean => {
    const b = bboxOf(pts);
    return !(b.x1 < vb.x0 - pad || b.x0 > vb.x1 + pad || b.y1 < vb.y0 - pad || b.y0 > vb.y1 + pad);
  };
  const near = (p: V2, pad = 4): boolean => p.x > vb.x0 - pad && p.x < vb.x1 + pad && p.y > vb.y0 - pad && p.y < vb.y1 + pad;
  const themeOf = (zone: number) => THEME[m.zones[zone]?.theme ?? 'base'] ?? THEME.base;
  pen.clear(BG);

  if (L.grid && S >= 3) {
    const step = S >= 8 ? 1 : 5;
    for (let x = Math.ceil(vb.x0 / step) * step; x <= vb.x1; x += step) pen.line([T({ x, y: vb.y0 }), T({ x, y: vb.y1 })], { stroke: x % 10 === 0 ? '#656565' : '#5e5e5e', lw: 1 });
    for (let y = Math.ceil(vb.y0 / step) * step; y <= vb.y1; y += step) pen.line([T({ x: vb.x0, y }), T({ x: vb.x1, y })], { stroke: y % 10 === 0 ? '#656565' : '#5e5e5e', lw: 1 });
  }

  const floors = m.prims.filter((p): p is Extract<Prim, { t: 'floor' }> => p.t === 'floor' && visible(p.pts));
  // 1. outline: stroke every floor, then fill over it
  const wallLw = Math.max(2.2, 0.6 * S);
  for (const f of floors) pen.poly(f.pts.map(T), { stroke: themeOf(f.zone).line, lw: wallLw, join: 'miter' });
  for (const f of floors) if (f.corr) pen.poly(f.pts.map(T), { fill: themeOf(f.zone).floor });
  for (const f of floors) if (!f.corr) pen.poly(f.pts.map(T), { fill: themeOf(f.zone).floor });

  // 2. floor overlays
  for (const p of m.prims) {
    if (p.t !== 'area' || !visible(p.pts)) continue;
    const st = AREA[p.kind] ?? { fill: '#888' };
    const pts = p.pts.map(T);
    pen.poly(pts, { fill: st.fill, stroke: st.stroke, lw: st.stroke ? Math.max(1, 0.15 * S) : undefined });
    if ((p.kind === 'pool' || p.kind === 'tile' || p.kind === 'grate') && S >= 4) gridIn(pen, p.pts, T, p.kind === 'tile' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.25)', p.kind === 'grate' ? 0.35 : 1);
    if (p.kind === 'road') roadLine(pen, p.pts, T, S);
    if (p.kind === 'field' && S >= 2) rows(pen, p.pts, T, S);
  }
  if (L.heights) {
    for (const z of m.zones) {
      if (!z.level) continue;
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => T(rotAdd(z.frame, sx * z.w / 2, sy * z.h / 2)));
      pen.poly(pts, { fill: z.level > 0 ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,40,0.18)' });
      pen.text(T({ x: z.frame.x, y: z.frame.y }), `${z.level > 0 ? '+' : ''}${z.level}`, { size: Math.max(10, S * 1.4), color: '#222', bold: true, alpha: 0.7 });
    }
  }

  // 3. stairs and ramps
  for (const p of m.prims) {
    if (p.t !== 'stairs' || !visible(p.pts)) continue;
    stairs(pen, p, T, S);
  }

  // 4. inside walls
  if (L.walls) for (const p of m.prims) {
    if (p.t !== 'wall' || !visible([p.a, p.b])) continue;
    const th = themeOf(p.zone);
    const a = T(p.a), b = T(p.b);
    const lw = Math.max(1, p.w * S);
    if (p.kind === 'glass') {
      const d = dir(Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2);
      const o = Math.max(1, lw * 0.35);
      pen.line([{ x: a.x + d.x * o, y: a.y + d.y * o }, { x: b.x + d.x * o, y: b.y + d.y * o }], { stroke: '#a9d4f5', lw: Math.max(1, lw * 0.3) });
      pen.line([{ x: a.x - d.x * o, y: a.y - d.y * o }, { x: b.x - d.x * o, y: b.y - d.y * o }], { stroke: '#a9d4f5', lw: Math.max(1, lw * 0.3) });
    } else if (p.kind === 'bars') pen.line([a, b], { stroke: '#2e2e2e', lw: Math.max(1.5, lw * 1.6), dash: [Math.max(1, S * 0.12), Math.max(1.5, S * 0.25)] });
    else if (p.kind === 'fake') pen.line([a, b], { stroke: shade(th.line, 0.9), lw: Math.max(0.6, lw), alpha: 0.5 });
    else if (p.kind === 'over') pen.line([a, b], { stroke: th.line, lw: Math.max(0.8, lw), dash: [Math.max(1.5, S * 0.3), Math.max(1.5, S * 0.3)], alpha: 0.8 });
    else pen.line([a, b], { stroke: th.line, lw, dash: p.kind === 'short' ? [Math.max(2, S * 0.6), Math.max(1.5, S * 0.35)] : undefined, cap: 'square' });
  }

  // 5. solids
  for (const p of m.prims) {
    if (p.t !== 'solid' || !visible(p.pts)) continue;
    const th = themeOf(p.zone);
    const pts = p.pts.map(T);
    if (p.kind === 'mass') {
      pen.poly(pts, { fill: '#4b4b4b', stroke: th.line, lw: Math.max(1, 0.4 * S) });
      hatch(pen, p.pts, T, S);
    } else if (p.kind === 'pillar') pen.poly(pts, { fill: shade(th.line, 0.85) });
    else if (p.kind === 'furniture') pen.poly(pts, { fill: '#7a5f44', stroke: '#4f3c2b', lw: 1 });
    else pen.poly(pts, { fill: shade(th.line, 0.75), stroke: shade(th.line, 0.55), lw: 1 });
  }

  // 6. lights
  if (L.lights && S >= 1.6) for (const p of m.prims) {
    if (p.t !== 'light' || !near(p.p)) continue;
    const c = T(p.p);
    const r = Math.max(0.8, 0.2 * S);
    const fill = p.kind === 'off' ? '#7b7b7b' : p.kind === 'emergency' ? '#ff8a3c' : p.kind === 'flicker' ? '#fff2a0' : '#fffdf2';
    pen.circle(c, r, { fill, stroke: 'rgba(0,0,0,0.18)', lw: 0.6 });
    if (p.kind === 'flicker' && S >= 4) pen.circle(c, r * 2, { stroke: '#fff2a0', lw: 0.8, dash: [1.5, 1.5] });
  }

  // 7. marks
  if (L.marks) {
    const portals = new Map<string, V2[]>();
    for (const p of m.prims) {
      if (p.t !== 'mark' || !near(p.p, p.s + 4)) continue;
      glyph(pen, p.kind, T(p.p), p.a, p.s * S, S, p.label);
      if (p.kind === 'portal' && p.label) portals.set(p.label, [...(portals.get(p.label) ?? []), p.p]);
    }
    for (const [, pts] of portals) if (pts.length === 2) pen.line(pts.map(T), { stroke: '#b67cf0', lw: 1.2, dash: [6, 5], alpha: 0.75 });
  }

  // 8. layer 2: above the ceiling
  if (L.layer2) {
    pen.poly([{ x: 0, y: 0 }, { x: v.w, y: 0 }, { x: v.w, y: v.h }, { x: 0, y: v.h }], { fill: 'rgba(20,24,30,0.45)' });
    for (const p of m.prims) {
      if (p.t !== 'duct' || !visible(p.pts)) continue;
      if (p.kind === 'duct') pen.line(p.pts.map(T), { stroke: '#56d0e3', lw: Math.max(1.5, p.w * S), alpha: 0.85, join: 'round' });
      else pen.line(p.pts.map(T), { stroke: '#ffb35a', lw: Math.max(1.5, p.w * S), dash: [Math.max(2, S * 0.4), Math.max(2, S * 0.4)], cap: 'round' });
    }
    for (const p of m.prims) if (p.t === 'mark' && (p.kind === 'vent' || p.kind === 'hatch') && near(p.p)) pen.circle(T(p.p), Math.max(3, S * 0.7), { stroke: '#56d0e3', lw: 1.5 });
  }

  // 9. text
  if (L.labels) for (const z of m.zones) {
    if (!near({ x: z.frame.x, y: z.frame.y }, 10)) continue;
    pen.text(T({ x: z.frame.x, y: z.frame.y }), FEATURE[z.feature]?.name ?? z.feature, { size: Math.max(9, Math.min(13, S * 1.1)), color: '#2f2a22', alpha: 0.75 });
  }
  if (L.notes) for (const p of m.prims) {
    if (p.t !== 'label' || !near(p.p, 12)) continue;
    const user = p.zone < 0;
    if (!user && S < 3.5) continue;
    pen.text(T(p.p), p.text, { size: Math.max(9, Math.min(user ? 18 : 13, S * (p.size ?? 0.8))), color: user ? '#f4f1e8' : '#3b3328', hand: true, alpha: user ? 1 : 0.8 });
  }

  if (parts === 'all') drawOverlay(pen, m, v, sel);
}

/** The selected zone's outline and doors, and the scale bar: drawn over the (cached) plan every frame. */
export function drawOverlay(pen: Pen, m: MapOut, v: View, sel: number): void {
  const S = v.scale;
  const T = (p: V2): V2 => ({ x: (p.x - v.cx) * S + v.w / 2, y: (p.y - v.cy) * S + v.h / 2 });
  if (sel >= 0 && m.zones[sel]) {
    const z = m.zones[sel];
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => T(rotAdd(z.frame, sx * (z.w / 2 + 0.6), sy * (z.h / 2 + 0.6))));
    pen.poly(pts, { stroke: '#ffffff', lw: 1.5, dash: [6, 4] });
    for (const p of z.ports) {
      const c = T(rotAdd(z.frame, p.p.x, p.p.y));
      pen.circle(c, 4, { fill: '#ffffff', stroke: '#222', lw: 1 });
    }
  }
  scaleBar(pen, v);
}

function rotAdd(f: { x: number; y: number; a: number }, x: number, y: number): V2 {
  const c = Math.cos(f.a), s = Math.sin(f.a);
  return { x: f.x + x * c - y * s, y: f.y + x * s + y * c };
}

/** Lines across a convex quad, parallel to its first edge. */
function gridIn(pen: Pen, pts: V2[], T: (p: V2) => V2, color: string, step: number): void {
  if (pts.length !== 4) return;
  const [a, b, , d] = pts;
  const lu = Math.hypot(b.x - a.x, b.y - a.y), lv = Math.hypot(d.x - a.x, d.y - a.y);
  for (let u = step; u < lu - 1e-6; u += step) { const t = u / lu; pen.line([T({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }), T({ x: d.x + (b.x - a.x) * t, y: d.y + (b.y - a.y) * t })], { stroke: color, lw: 1 }); }
  for (let w = step; w < lv - 1e-6; w += step) { const t = w / lv; pen.line([T({ x: a.x + (d.x - a.x) * t, y: a.y + (d.y - a.y) * t }), T({ x: b.x + (d.x - a.x) * t, y: b.y + (d.y - a.y) * t })], { stroke: color, lw: 1 }); }
}

function roadLine(pen: Pen, pts: V2[], T: (p: V2) => V2, S: number): void {
  if (pts.length !== 4) return;
  const [a, b, c, d] = pts;
  const long = Math.hypot(b.x - a.x, b.y - a.y) >= Math.hypot(d.x - a.x, d.y - a.y);
  const m1 = long ? { x: (a.x + d.x) / 2, y: (a.y + d.y) / 2 } : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const m2 = long ? { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 } : { x: (d.x + c.x) / 2, y: (d.y + c.y) / 2 };
  pen.line([T(m1), T(m2)], { stroke: '#e8c53a', lw: Math.max(1, S * 0.18), dash: [S * 1.5, S * 1.2] });
}

function rows(pen: Pen, pts: V2[], T: (p: V2) => V2, S: number): void {
  if (pts.length !== 4) return;
  const [a, b, , d] = pts;
  const lv = Math.hypot(d.x - a.x, d.y - a.y);
  for (let w = 0.75; w < lv; w += 1.5) { const t = w / lv; pen.line([T({ x: a.x + (d.x - a.x) * t, y: a.y + (d.y - a.y) * t }), T({ x: b.x + (d.x - a.x) * t, y: b.y + (d.y - a.y) * t })], { stroke: '#7f9445', lw: Math.max(1, S * 0.12) }); }
}

function hatch(pen: Pen, pts: V2[], T: (p: V2) => V2, S: number): void {
  const b = bboxOf(pts);
  const step = Math.max(1.2, 8 / S);
  for (let k = b.x0 - (b.y1 - b.y0); k < b.x1; k += step) {
    // clip the 45° line to the bbox, then keep it only if its middle is inside (good enough for boxes and discs)
    const a = { x: k, y: b.y0 }, c = { x: k + (b.y1 - b.y0), y: b.y1 };
    const p0 = { x: Math.max(a.x, b.x0), y: b.y0 + Math.max(0, b.x0 - a.x) }, p1 = { x: Math.min(c.x, b.x1), y: b.y1 - Math.max(0, c.x - b.x1) };
    if (p1.x <= p0.x) continue;
    const segs: V2[] = [];
    const n = 12;
    let on = false;
    for (let i = 0; i <= n; i++) {
      const q = { x: p0.x + ((p1.x - p0.x) * i) / n, y: p0.y + ((p1.y - p0.y) * i) / n };
      const inside = inPoly(q, pts);
      if (inside && !on) { segs.push(q); on = true; } else if (!inside && on) { segs.push(q); on = false; }
    }
    if (on) segs.push(p1);
    for (let i = 0; i + 1 < segs.length; i += 2) pen.line([T(segs[i]), T(segs[i + 1])], { stroke: '#6a6a6a', lw: 1 });
  }
}

function inPoly(p: V2, pts: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function stairs(pen: Pen, p: Extract<Prim, { t: 'stairs' }>, T: (p: V2) => V2, S: number): void {
  const pts = p.pts.map(T);
  const whole = p.steps === 0;
  if (!whole) pen.poly(pts, { fill: 'rgba(0,0,0,0.10)', stroke: 'rgba(0,0,0,0.35)', lw: 1 });
  const d = dir(p.dir);
  // which pair of edges runs along the fall line
  const e0 = { x: p.pts[1].x - p.pts[0].x, y: p.pts[1].y - p.pts[0].y };
  const alongFirst = Math.abs(e0.x * d.x + e0.y * d.y) > Math.hypot(e0.x, e0.y) * 0.7;
  const [a, b, c, q] = p.pts;
  const A = alongFirst ? a : b, B = alongFirst ? b : c, C = alongFirst ? q : a, D = alongFirst ? c : q;
  if (!whole && p.steps > 0) {
    for (let i = 1; i < p.steps; i++) {
      const t = i / p.steps;
      const u = { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t }, w = { x: C.x + (D.x - C.x) * t, y: C.y + (D.y - C.y) * t };
      pen.line([T(u), T(w)], { stroke: 'rgba(0,0,0,0.35)', lw: 1, dash: p.ramp ? [2, 3] : undefined });
    }
  }
  const cx = (a.x + b.x + c.x + q.x) / 4, cy = (a.y + b.y + c.y + q.y) / 4;
  const span = whole ? Math.min(Math.hypot(B.x - A.x, B.y - A.y), 6) : Math.hypot(B.x - A.x, B.y - A.y) * 0.8;
  const s0 = T({ x: cx - (d.x * span) / 2, y: cy - (d.y * span) / 2 }), s1 = T({ x: cx + (d.x * span) / 2, y: cy + (d.y * span) / 2 });
  const col = p.impossible ? '#b02a2a' : whole ? 'rgba(40,30,20,0.45)' : 'rgba(30,25,20,0.8)';
  pen.line([s0, s1], { stroke: col, lw: Math.max(1, S * 0.12) });
  const hd = Math.max(4, S * 0.5);
  const ang = Math.atan2(s1.y - s0.y, s1.x - s0.x);
  pen.line([{ x: s1.x - Math.cos(ang - 0.45) * hd, y: s1.y - Math.sin(ang - 0.45) * hd }, s1, { x: s1.x - Math.cos(ang + 0.45) * hd, y: s1.y - Math.sin(ang + 0.45) * hd }], { stroke: col, lw: Math.max(1, S * 0.12) });
  if (p.impossible && S >= 3) pen.text({ x: (s0.x + s1.x) / 2, y: (s0.y + s1.y) / 2 - S }, 'down… same floor?', { size: Math.max(9, S * 0.8), color: '#7a1c1c', hand: true });
}

/** Small symbols. `s` is the size in pixels, `S` the pixels per tile. */
function glyph(pen: Pen, kind: MarkKind, c: V2, a: number, s: number, S: number, label?: string): void {
  const R = (x: number, y: number): V2 => ({ x: c.x + x * Math.cos(a) - y * Math.sin(a), y: c.y + x * Math.sin(a) + y * Math.cos(a) });
  const rect = (w: number, h: number, ox = 0, oy = 0) => [R(ox - w / 2, oy - h / 2), R(ox + w / 2, oy - h / 2), R(ox + w / 2, oy + h / 2), R(ox - w / 2, oy + h / 2)];
  const brown = '#8a6a4a', dark = '#4c3a28';
  const tiny = S < 2.2;
  switch (kind) {
    case 'seat': pen.poly(rect(s, s), { fill: brown }); break;
    case 'pew': pen.poly(rect(s, S * 0.45), { fill: brown, stroke: dark, lw: 1 }); break;
    case 'sofa': pen.poly(rect(s, s * 0.45), { fill: '#7f5b3e', stroke: dark, lw: 1 }); if (!tiny) pen.poly(rect(s, s * 0.14, 0, -s * 0.22), { fill: dark }); break;
    case 'table': case 'counter': pen.poly(rect(s, s * 0.6), { fill: '#9b7650', stroke: dark, lw: 1 }); break;
    case 'desk': pen.poly(rect(s, s * 0.5), { fill: '#9b7650', stroke: dark, lw: 1 }); if (!tiny) pen.poly(rect(s * 0.3, s * 0.3, 0, s * 0.45), { fill: '#6b6b6b' }); break;
    case 'bed': pen.poly(rect(s * 0.7, s), { fill: '#d8d0c0', stroke: dark, lw: 1 }); if (!tiny) pen.poly(rect(s * 0.6, s * 0.2, 0, -s * 0.36), { fill: '#f4efe6' }); break;
    case 'shelf': case 'cupboard': pen.poly(rect(s, Math.max(2, S * 0.45)), { fill: '#6e5236', stroke: dark, lw: 1 }); break;
    case 'car': pen.poly(rect(s * 0.5, s), { fill: '#56708c', stroke: '#2c3a49', lw: 1 }); break;
    case 'boiler': pen.circle(c, s / 2, { fill: '#8f8f8f', stroke: '#555', lw: 1 }); pen.circle(c, s / 4, { stroke: '#555', lw: 1 }); break;
    case 'tank': pen.poly(rect(s, s * 0.6), { fill: '#8a9494', stroke: '#555', lw: 1 }); break;
    case 'pipe': pen.line([R(-s / 2, 0), R(s / 2, 0)], { stroke: '#7a7a7a', lw: Math.max(1.5, S * 0.35), alpha: 0.9 }); break;
    case 'fan': pen.circle(c, s / 2, { stroke: '#555', lw: 1 }); for (let k = 0; k < 3; k++) pen.line([c, R(Math.cos((k * 2 * Math.PI) / 3) * s * 0.45, Math.sin((k * 2 * Math.PI) / 3) * s * 0.45)], { stroke: '#555', lw: Math.max(1, S * 0.12) }); break;
    case 'door': case 'stuckdoor': {
      const hinge = R(0, -s / 2);
      pen.line([hinge, R(s * 0.9, -s / 2)], { stroke: dark, lw: Math.max(1, S * 0.12) });
      const arc: V2[] = [];
      for (let k = 0; k <= 8; k++) { const t = (k / 8) * (Math.PI / 2); arc.push(R(Math.cos(t) * s * 0.9, -s / 2 + Math.sin(t) * s)); }
      pen.line(arc, { stroke: dark, lw: 1, dash: [2, 2] });
      if (kind === 'stuckdoor') { pen.line([R(-s * 0.3, -s * 0.3), R(s * 0.3, s * 0.3)], { stroke: '#b02a2a', lw: 2 }); pen.line([R(-s * 0.3, s * 0.3), R(s * 0.3, -s * 0.3)], { stroke: '#b02a2a', lw: 2 }); }
      break;
    }
    case 'window': case 'fakewindow':
      pen.poly(rect(Math.max(2, S * 0.3), s), { fill: kind === 'window' ? '#cfe6f7' : '#b6c9d6', stroke: '#5b7486', lw: 1 });
      if (kind === 'fakewindow' && S >= 4) pen.text(R(-S * 0.7, 0), 'fake', { size: Math.max(8, S * 0.55), color: '#5b7486', hand: true, angle: a + Math.PI / 2 });
      break;
    case 'shopfront': {
      const zig: V2[] = [];
      const n = Math.max(2, Math.round(s / Math.max(3, S * 0.8)));
      for (let k = 0; k <= n; k++) zig.push(R(-S * 0.25 * (k % 2), -s / 2 + (s * k) / n));
      pen.line(zig, { stroke: '#b0473b', lw: Math.max(1, S * 0.15) });
      if (S >= 4) pen.text(R(-S * 0.9, 0), 'shop', { size: Math.max(8, S * 0.6), color: '#7a2b22', hand: true, angle: a + Math.PI / 2 });
      break;
    }
    case 'exit': pen.poly(rect(Math.max(3, S * 0.8), Math.max(2, S * 0.4)), { fill: '#2f9e44', stroke: '#1d5f29', lw: 1 }); break;
    case 'vent': pen.poly(rect(s, s), { fill: '#4a4a4a', stroke: '#2a2a2a', lw: 1 }); if (!tiny) for (let k = -1; k <= 1; k++) pen.line([R(-s * 0.35, (k * s) / 4), R(s * 0.35, (k * s) / 4)], { stroke: '#8a8a8a', lw: 1 }); break;
    case 'hatch': pen.poly(rect(s, s), { stroke: '#2a2a2a', lw: 1, dash: [3, 2] }); pen.line([R(-s / 2, -s / 2), R(s / 2, s / 2)], { stroke: '#2a2a2a', lw: 1 }); break;
    case 'wires': { const w: V2[] = []; for (let k = 0; k <= 8; k++) w.push(R(-s / 2 + (s * k) / 8, (k % 2 ? 1 : -1) * s * 0.15)); pen.line(w, { stroke: '#333', lw: 1 }); break; }
    case 'lift': pen.poly(rect(s, s), { fill: '#9a9a9a', stroke: '#444', lw: 1 }); pen.line([R(-s / 2, -s / 2), R(s / 2, s / 2)], { stroke: '#444', lw: 1 }); pen.line([R(-s / 2, s / 2), R(s / 2, -s / 2)], { stroke: '#444', lw: 1 }); break;
    case 'sign': case 'note':
      pen.poly(rect(Math.max(3, S * 0.6), Math.max(3, S * 0.6)), { fill: kind === 'note' ? '#f1e27a' : '#e9e4d6', stroke: '#5a5040', lw: 1 });
      if (label && S >= 2.5) pen.text({ x: c.x, y: c.y - Math.max(8, S * 0.9) }, label, { size: Math.max(9, S * 0.75), color: '#2f2a22', hand: true });
      break;
    case 'tree': pen.circle(c, s / 2, { fill: '#5f8f4a', stroke: '#3e6430', lw: 1 }); break;
    case 'plant': pen.circle(c, Math.max(1.5, s / 3), { fill: '#5f8f4a' }); break;
    case 'bench': pen.poly(rect(s, Math.max(2, S * 0.35)), { fill: brown }); break;
    case 'fountain': pen.circle(c, s / 2, { fill: '#8cc0ea', stroke: '#4d86b8', lw: 1.5 }); break;
    case 'portal':
      pen.circle(c, Math.max(3, s / 2), { stroke: '#b67cf0', lw: Math.max(1.5, S * 0.2) });
      if (label && S >= 3) pen.text({ x: c.x, y: c.y - Math.max(8, S) }, label, { size: Math.max(9, S * 0.7), color: '#e3c8ff', bold: true });
      break;
    case 'crate': pen.poly(rect(s * 0.7, s * 0.7), { fill: '#a07f55', stroke: dark, lw: 1 }); if (!tiny) pen.line([R(-s * 0.35, -s * 0.35), R(s * 0.35, s * 0.35)], { stroke: dark, lw: 1 }); break;
    case 'pooltable': pen.poly(rect(s, s * 0.55), { fill: '#3f7f4f', stroke: '#2a4f33', lw: 1 }); break;
    case 'mannequin': pen.circle(c, Math.max(1.5, S * 0.25), { fill: '#d9c9b0', stroke: '#6b5b45', lw: 1 }); break;
    case 'arrow': pen.line([R(-s / 2, 0), R(s / 2, 0)], { stroke: '#222', lw: 1.5 }); break;
    case 'gate': case 'stage': break;
  }
}

function scaleBar(pen: Pen, v: View): void {
  const ftPerPx = 2 / v.scale;
  const want = 120 * ftPerPx;
  const steps = [5, 10, 20, 50, 100, 200, 500, 1000, 2000];
  const ft = steps.find((s) => s >= want * 0.6) ?? 2000;
  const px = ft / ftPerPx;
  const x = 16, y = v.h - 18;
  pen.line([{ x, y }, { x: x + px, y }], { stroke: '#f0ece2', lw: 2 });
  pen.line([{ x, y: y - 4 }, { x, y: y + 4 }], { stroke: '#f0ece2', lw: 2 });
  pen.line([{ x: x + px, y: y - 4 }, { x: x + px, y: y + 4 }], { stroke: '#f0ece2', lw: 2 });
  pen.text({ x: x + px + 8, y }, `${ft} ft (${Math.round(ft * 0.3048)} m)`, { size: 12, color: '#f0ece2', align: 'left' });
}
