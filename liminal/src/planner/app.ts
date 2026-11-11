/**
 * Backrooms Planner: the page. Knobs and the feature palette on the left, the
 * plan in the middle, the selected zone on the right. Every edit is stored as
 * an edit on top of the seed (move, turn, swap the feature, re-roll, delete,
 * add, notes), and the map is made again from scratch each time, so parts
 * always snap and wrap around each other.
 */
import './planner.css';
import { FEATURE, FEATURES, GROUPS, THEMES, TAG_FEATURES, ZONE_FEATURES } from './catalogue';
import { CanvasPen, DEFAULT_LAYERS, drawMap, SvgPen, type Layers, type View } from './draw';
import { DEFAULT_PARAMS, emptyEdits, generate } from './generate';
import { toLocal, v2, type V2 } from './geom';
import type { Edits, MapOut, Params, Zone, ZoneEdit } from './types';

interface Saved { params: Params; edits: Edits; layers: Layers }
const STORE = 'backrooms-planner-v1';

function load(): Saved | null {
  try {
    const s = localStorage.getItem(STORE);
    if (!s) return null;
    const d = JSON.parse(s) as Saved;
    return { params: { ...DEFAULT_PARAMS, ...d.params, weights: { ...(d.params?.weights ?? {}) } }, edits: { ...emptyEdits(), ...d.edits }, layers: { ...DEFAULT_LAYERS, ...d.layers } };
  } catch { return null; }
}
function save(): void {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* storage may be off */ }
}
const randSeed = () => Math.floor(Math.random() * 1e6);

const state: Saved = load() ?? { params: { ...DEFAULT_PARAMS, seed: randSeed() }, edits: emptyEdits(), layers: { ...DEFAULT_LAYERS } };
let map!: MapOut;
const view: View = { cx: 0, cy: 0, scale: 3, w: 800, h: 600 };
let selKey: string | null = null;
let noteMode = false;
const undoStack: string[] = [], redoStack: string[] = [];

const snap = () => JSON.stringify({ params: state.params, edits: state.edits });
function restore(s: string): void { const d = JSON.parse(s); state.params = d.params; state.edits = d.edits; }
function remember(before = snap()): void { undoStack.push(before); if (undoStack.length > 120) undoStack.shift(); redoStack.length = 0; }
function commit(mut: () => void, refit = false): void { remember(); mut(); regenerate(refit); save(); }

// ------------------------------------------------------------------ DOM helpers
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') e.addEventListener(k.replace(/^on/, ''), v as EventListener);
    else if (k === 'class') e.className = String(v);
    else if (k === 'text') e.textContent = String(v);
    else if (k in e && k !== 'list') (e as unknown as Record<string, unknown>)[k] = v;
    else e.setAttribute(k, String(v === true ? '' : v));
  }
  for (const c of kids) if (c !== null && c !== undefined) e.append(c);
  return e;
}

// ------------------------------------------------------------------ layout
const app = document.getElementById('app')!;
const header = el('header');
const left = el('aside', { class: 'left' });
const main = el('main');
const right = el('aside', { class: 'right' });
app.append(header, left, main, right);
const canvas = el('canvas', { id: 'map' });
const tip = el('div', { id: 'tip' });
const hint = el('div', { id: 'hint', text: 'drag: pan · wheel: zoom · click: pick · drag a zone: move · R: turn · Del: delete · double-click: re-roll' });
const statsEl = el('div', { id: 'stats' });
main.append(canvas, tip, hint, statsEl);
const g = canvas.getContext('2d')!;

// ------------------------------------------------------------------ header
const layerBtn = (key: keyof Layers, label: string) => {
  const b = el('button', { class: `small ${state.layers[key] ? 'on' : ''}`, text: label, title: `Show or hide: ${label}` });
  b.addEventListener('click', () => { state.layers[key] = !state.layers[key]; b.classList.toggle('on', state.layers[key]); save(); requestDraw(); });
  return b;
};
const noteBtn = el('button', { class: 'small', text: 'Note', title: 'Click on the map to write a note (N)' });
noteBtn.addEventListener('click', () => setNoteMode(!noteMode));
function setNoteMode(on: boolean): void { noteMode = on; noteBtn.classList.toggle('on', on); canvas.classList.toggle('note', on); }
header.append(
  el('h1', { text: 'Backrooms Planner' }),
  el('button', { class: 'small', text: 'New seed', title: 'A new random map', onclick: () => commit(() => { state.params.seed = randSeed(); state.edits = emptyEdits(); }, true) }),
  el('button', { class: 'small', text: 'Undo', title: 'Ctrl+Z', onclick: () => doUndo() }),
  el('button', { class: 'small', text: 'Redo', title: 'Ctrl+Y', onclick: () => doRedo() }),
  el('button', { class: 'small', text: 'Fit', title: 'Show the whole map (F)', onclick: () => { fit(); requestDraw(); } }),
  el('span', { class: 'sep' }),
  layerBtn('walls', 'Walls'), layerBtn('lights', 'Lights'), layerBtn('marks', 'Things'), layerBtn('labels', 'Names'), layerBtn('notes', 'Notes'),
  layerBtn('grid', 'Grid'), layerBtn('heights', 'Heights'), layerBtn('layer2', 'Above ceiling'),
  el('span', { class: 'sep' }),
  noteBtn,
  el('button', { class: 'small', text: 'PNG', title: 'Save a picture of the whole map', onclick: () => exportPng() }),
  el('button', { class: 'small', text: 'SVG', title: 'Save a drawing you can scale', onclick: () => exportSvg() }),
  el('button', { class: 'small', text: 'JSON', title: 'Save the plan (for the 3D builder later)', onclick: () => exportJson() }),
  el('button', { class: 'small', text: 'Open', title: 'Open a saved JSON plan', onclick: () => importJson() }),
  el('button', { class: 'small', text: 'Clear edits', title: 'Remove all hand edits on this seed', onclick: () => commit(() => { state.edits = emptyEdits(); }) }),
);

// ------------------------------------------------------------------ left: knobs and features
const seedInput = el('input', { type: 'number', value: state.params.seed, min: 0, step: 1 }) as HTMLInputElement;
seedInput.addEventListener('change', () => commit(() => { state.params.seed = Math.max(0, Math.floor(Number(seedInput.value) || 0)); state.edits = emptyEdits(); }, true));
left.append(
  el('h2', { text: 'Map' }),
  el('div', { class: 'seed' },
    el('label', { class: 'muted', text: 'Seed' }), seedInput,
    el('button', { class: 'small', text: '−', title: 'Previous seed', onclick: () => commit(() => { state.params.seed = Math.max(0, state.params.seed - 1); state.edits = emptyEdits(); }, true) }),
    el('button', { class: 'small', text: '+', title: 'Next seed', onclick: () => commit(() => { state.params.seed += 1; state.edits = emptyEdits(); }, true) }),
  ),
);
const sliders: (() => void)[] = [];
function knob(key: keyof Params, label: string, min: number, max: number, step: number, fmt: (v: number) => string, tipText: string, refit = false): void {
  const out = el('output');
  const input = el('input', { type: 'range', min, max, step, title: tipText }) as HTMLInputElement;
  let before = '';
  const sync = () => { input.value = String(state.params[key]); out.textContent = fmt(state.params[key] as number); };
  input.addEventListener('pointerdown', () => { before = snap(); });
  input.addEventListener('input', () => { (state.params as unknown as Record<string, number>)[key] = Number(input.value); out.textContent = fmt(Number(input.value)); scheduleRegen(refit); });
  input.addEventListener('change', () => { remember(before || snap()); save(); });
  sliders.push(sync);
  sync();
  left.append(el('div', { class: 'row', title: tipText }, el('label', { text: label }), input, out));
}
const pct = (v: number) => `${Math.round(v * 100)}`;
knob('size', 'Size', 50, 420, 5, (v) => `${Math.round((v * 4) / 3.28)}m`, 'How big the map is (radius in 2 ft tiles; shown as the width in metres).', true);
knob('turn', 'Turned groups', 0, 1, 0.01, pct, '0 = every wall on one grid (maps 2–5). 1 = groups turned at odd angles (map 1).');
knob('density', 'Fullness', 0, 1, 0.01, pct, 'How many zones the map holds.');
knob('loops', 'Loops', 0, 1, 0.01, pct, 'Extra corridors that close loops.');
knob('deadEnds', 'Dead ends', 0, 1, 0.01, pct, 'Branches that stop, each with something at the end.');
knob('corridors', 'Corridors', 0, 1, 0.01, pct, 'Rooms joined by corridors (high) or touching (low).');
knob('longRuns', 'Long runs', 0, 1, 0.01, pct, 'Very long corridors out to far groups.');
knob('landmarks', 'Landmarks', 0, 1, 0.01, pct, 'Pool rooms, theatres, churches, houses, parks, streets…');
knob('themes', 'Districts', 0, 1, 0.01, pct, 'Areas with their own carpet and walls.');
knob('heights', 'Floor heights', 0, 1, 0.01, pct, 'Stairs, ramps, sloped and sunken rooms (still one story).');
knob('anomalies', 'Wrongness', 0, 1, 0.01, pct, 'Portals, impossible stairs, repeat and melted rooms.');

left.append(el('h2', { text: 'Features' }), el('div', { class: 'muted', text: 'Tick to use, slide for how often. Drag a zone feature onto the map to add it.' }));
const featSyncs: (() => void)[] = [];
for (const grp of GROUPS) {
  const det = el('details', { open: grp === 'Rooms' || grp === 'Grid halls' || grp === 'Wall fields' });
  det.append(el('summary', { text: `${grp} (${FEATURES.filter((f) => f.group === grp).length})` }));
  for (const f of FEATURES.filter((x) => x.group === grp)) {
    const cb = el('input', { type: 'checkbox' }) as HTMLInputElement;
    const rng = el('input', { type: 'range', min: 0, max: 3, step: 0.05 }) as HTMLInputElement;
    const mult = () => (f.weight > 0 ? (state.params.weights[f.id] ?? f.weight) / f.weight : 0);
    const sync = () => { cb.checked = mult() > 0; rng.value = String(mult()); };
    featSyncs.push(sync);
    sync();
    let before = '';
    const set = (m: number) => { if (Math.abs(m - 1) < 1e-6) delete state.params.weights[f.id]; else state.params.weights[f.id] = f.weight * m; };
    cb.addEventListener('change', () => { remember(); set(cb.checked ? 1 : 0); sync(); scheduleRegen(); save(); });
    rng.addEventListener('pointerdown', () => { before = snap(); });
    rng.addEventListener('input', () => { set(Number(rng.value)); cb.checked = Number(rng.value) > 0; scheduleRegen(); });
    rng.addEventListener('change', () => { remember(before || snap()); save(); });
    const name = el('span', { class: `name ${f.kind === 'zone' ? 'drag' : ''}`, title: `${f.n}. ${f.desc} (seen in: ${f.src})` }, `${f.n}. ${f.name}`);
    if (f.kind === 'zone') {
      name.draggable = true;
      name.addEventListener('dragstart', (e) => { e.dataTransfer?.setData('text/plain', `feature:${f.id}`); });
    }
    det.append(el('div', { class: 'feat' }, cb, name, rng));
  }
  left.append(det);
}
left.append(el('div', { class: 'btns' }, el('button', { class: 'small', text: 'All features on', onclick: () => commit(() => { state.params.weights = {}; featSyncs.forEach((s) => s()); }) })));

// ------------------------------------------------------------------ right: selection
function renderSide(): void {
  right.replaceChildren();
  const z = selKey ? map.zones.find((q) => q.key === selKey) : undefined;
  if (!z) {
    right.append(
      el('h2', { text: 'How to use' }),
      el('div', { class: 'muted' },
        el('p', { text: 'Pick a seed and turn the knobs: the map is made again each time.' }),
        el('p', { text: 'Click a zone to change it. Drag it to move it; it stays where you put it and the corridors find their way to it.' }),
        el('p', { text: 'Drag a feature from the list onto the map to add it.' }),
        el('p', { text: 'Note: click "Note", then click the map and write.' }),
        el('p', { text: '1 tile = one 2 ft ceiling tile. The walls come from the outline of all floors, so parts merge where they meet.' }),
      ),
      el('h2', { text: 'Legend' }),
      el('div', { class: 'muted' },
        el('p', { text: 'Dashed wall: stops short of the ceiling (or an arch overhead). Dotted dark line: bars. Blue double line: windows.' }),
        el('p', { text: 'Hatched block: solid, you cannot enter. Arrow on stripes: stairs or a ramp, pointing down. Red arrow: stairs that arrive on the same floor.' }),
        el('p', { text: 'Purple rings joined by a dashed line: a portal pair. "Above ceiling" shows ducts (blue), crawlspaces (orange), vents and hatches.' }),
      ),
    );
    return;
  }
  const added = state.edits.added.find((a) => a.key === z.key);
  const ed: ZoneEdit = state.edits.zones[z.key] ?? {};
  const editZone = (fn: (e: ZoneEdit) => void) => commit(() => {
    if (added) { const e: ZoneEdit = {}; fn(e); if (e.feature) added.feature = e.feature; if (e.w) added.w = e.w; if (e.h) added.h = e.h; if (e.a !== undefined) added.a = e.a; if (e.x !== undefined) added.x = e.x; if (e.y !== undefined) added.y = e.y; }
    else { const e = (state.edits.zones[z.key] ??= {}); fn(e); }
  });
  const feat = el('select') as HTMLSelectElement;
  for (const f of ZONE_FEATURES) feat.append(el('option', { value: f.id, text: `${f.n}. ${f.name}`, selected: f.id === z.feature }));
  feat.addEventListener('change', () => editZone((e) => { e.feature = feat.value; delete e.w; delete e.h; }));
  const num = (val: number, onSet: (v: number) => void, step = 1) => { const i = el('input', { type: 'number', value: Math.round(val * 10) / 10, step }) as HTMLInputElement; i.addEventListener('change', () => onSet(Number(i.value))); return i; };
  const theme = el('select') as HTMLSelectElement;
  for (const t of THEMES) theme.append(el('option', { value: t.id, text: t.name, selected: t.id === z.theme }));
  theme.addEventListener('change', () => editZone((e) => { e.theme = theme.value; }));
  const level = el('select') as HTMLSelectElement;
  for (let l = -3; l <= 3; l++) level.append(el('option', { value: l, text: l === 0 ? 'base floor' : `${l > 0 ? '+' : ''}${l} step${Math.abs(l) > 1 ? 's' : ''}`, selected: l === z.level }));
  level.addEventListener('change', () => editZone((e) => { e.level = Number(level.value); }));
  const tags = el('div', { class: 'tags' });
  for (const t of [...TAG_FEATURES.map((f) => [f.id, f.name] as const), ['mono', 'Monochrome'] as const]) {
    const cb = el('input', { type: 'checkbox', checked: z.tags.includes(t[0]) }) as HTMLInputElement;
    cb.addEventListener('change', () => editZone((e) => { const cur = new Set(e.tags ?? z.tags); if (cb.checked) cur.add(t[0]); else cur.delete(t[0]); e.tags = [...cur]; }));
    tags.append(el('label', {}, cb, ` ${t[1]}`));
  }
  const deg = Math.round((z.frame.a * 180) / Math.PI) % 360;
  right.append(
    el('div', { class: 'sel-title', text: FEATURE[z.feature]?.name ?? z.feature }),
    el('div', { class: 'muted', text: `${added ? 'added by you' : `zone ${z.key}`} · ${Math.round(z.w * 2)}×${Math.round(z.h * 2)} ft · ${z.ports.length} way${z.ports.length === 1 ? '' : 's'} in${z.pinned ? ' · pinned' : ''}` }),
    el('div', { class: 'muted', text: FEATURE[z.feature]?.desc ?? '' }),
    el('div', { class: 'kv' },
      el('label', { text: 'Feature' }), feat,
      el('label', { text: 'Width' }), num(z.w, (v) => editZone((e) => { e.w = Math.max(3, v); e.h = e.h ?? z.h; })),
      el('label', { text: 'Depth' }), num(z.h, (v) => editZone((e) => { e.h = Math.max(3, v); e.w = e.w ?? z.w; })),
      el('label', { text: 'Turn °' }), num(deg, (v) => editZone((e) => { e.x = z.frame.x; e.y = z.frame.y; e.a = (v * Math.PI) / 180; }), 5),
      el('label', { text: 'Carpet' }), theme,
      el('label', { text: 'Floor' }), level,
    ),
    el('div', { class: 'muted', text: 'Width and depth are in tiles (2 ft).' }),
    el('h2', { text: 'Tags' }), tags,
    el('div', { class: 'btns' },
      el('button', { class: 'small', text: 'Re-roll', title: 'A new inside for this zone (double-click)', onclick: () => reroll(z) }),
      z.pinned && !added ? el('button', { class: 'small', text: 'Unpin', title: 'Let the generator place it again', onclick: () => editZone((e) => { delete e.x; delete e.y; delete e.a; }) }) : null,
      el('button', { class: 'small', text: 'Delete', title: 'Del', onclick: () => deleteZone(z) }),
      !added && Object.keys(ed).length ? el('button', { class: 'small', text: 'Reset zone', onclick: () => commit(() => { delete state.edits.zones[z.key]; }) }) : null,
    ),
  );
}

function reroll(z: Zone): void {
  const added = state.edits.added.find((a) => a.key === z.key);
  if (added) { commit(() => { added.key = `${added.key.split('~')[0]}~${Math.floor(Math.random() * 1e6)}`; selKey = added.key; }); return; }
  commit(() => { const e = (state.edits.zones[z.key] ??= {}); e.seed = (e.seed ?? 0) + 1; });
}
function deleteZone(z: Zone): void {
  commit(() => {
    const i = state.edits.added.findIndex((a) => a.key === z.key);
    if (i >= 0) state.edits.added.splice(i, 1);
    else (state.edits.zones[z.key] ??= {}).deleted = true;
    selKey = null;
  });
}

// ------------------------------------------------------------------ generate and draw
let regenTimer = 0, regenFit = false;
function scheduleRegen(refit = false): void {
  regenFit ||= refit;
  clearTimeout(regenTimer);
  regenTimer = window.setTimeout(() => { regenerate(regenFit); regenFit = false; save(); }, 50);
}
function regenerate(refit = false): void {
  seedInput.value = String(state.params.seed);
  sliders.forEach((s) => s());
  featSyncs.forEach((s) => s());
  map = generate(state.params, state.edits);
  if (refit) fit();
  const s = map.stats;
  const cut = s.cutOff.length;
  statsEl.replaceChildren(
    `${s.zones} zones · ${s.links} links · ${s.loops} loops · ${s.deadEnds} dead ends · ${s.landmarks} landmarks`, el('br'),
    `walkable from the hub ${Math.round(s.reached * 100)}% · floor fill ${Math.round(s.floorShare * 100)}% · ${Math.round(s.widthFt)}×${Math.round(s.heightFt)} ft · made in ${s.ms} ms`,
    cut ? el('span', { class: 'warn', text: ` · ${cut} cut off` }) : '',
  );
  renderSide();
  requestDraw();
}
function fit(): void {
  const b = map.bounds;
  const w = b.x1 - b.x0 + 16, h = b.y1 - b.y0 + 16;
  view.cx = (b.x0 + b.x1) / 2; view.cy = (b.y0 + b.y1) / 2;
  view.scale = Math.max(0.3, Math.min(view.w / w, view.h / h));
}
let drawQueued = false;
let ghost: { z: Zone; dx: number; dy: number; da: number } | null = null;
function requestDraw(): void { if (!drawQueued) { drawQueued = true; requestAnimationFrame(draw); } }
function draw(): void {
  drawQueued = false;
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
  view.w = cw; view.h = ch;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sel = selKey ? map.zones.findIndex((z) => z.key === selKey) : -1;
  drawMap(new CanvasPen(g), map, view, state.layers, sel);
  if (ghost) {
    const { z, dx, dy, da } = ghost;
    const c = Math.cos(z.frame.a + da), s = Math.sin(z.frame.a + da);
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
      const x = z.frame.x + dx + (sx * z.w) / 2 * c - (sy * z.h) / 2 * s, y = z.frame.y + dy + (sx * z.w) / 2 * s + (sy * z.h) / 2 * c;
      return { x: (x - view.cx) * view.scale + view.w / 2, y: (y - view.cy) * view.scale + view.h / 2 };
    });
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
    g.globalAlpha = 0.35; g.fillStyle = '#f2e3b8'; g.fill(); g.globalAlpha = 1; g.strokeStyle = '#fff'; g.setLineDash([5, 4]); g.lineWidth = 1.5; g.stroke(); g.setLineDash([]);
  }
}

// ------------------------------------------------------------------ canvas input
const toWorldPt = (cx: number, cy: number): V2 => v2(view.cx + (cx - view.w / 2) / view.scale, view.cy + (cy - view.h / 2) / view.scale);
function hit(p: V2): Zone | null {
  let best: Zone | null = null, area = Infinity;
  for (const z of map.zones) {
    const q = toLocal(z.frame, p);
    if (Math.abs(q.x) <= z.w / 2 && Math.abs(q.y) <= z.h / 2 && z.w * z.h < area) { best = z; area = z.w * z.h; }
  }
  return best;
}
let drag: { mode: 'pan' | 'move'; x: number; y: number; moved: boolean; z?: Zone; cx: number; cy: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const wp = toWorldPt(x, y);
  if (noteMode) {
    const text = window.prompt('Note:');
    if (text) commit(() => state.edits.notes.push({ x: wp.x, y: wp.y, text }));
    setNoteMode(false);
    return;
  }
  const z = hit(wp);
  if (z) {
    if (selKey !== z.key) { selKey = z.key; renderSide(); requestDraw(); }
    drag = { mode: 'move', x, y, moved: false, z, cx: view.cx, cy: view.cy };
  } else {
    drag = { mode: 'pan', x, y, moved: false, cx: view.cx, cy: view.cy };
    canvas.classList.add('panning');
  }
});
canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  if (drag) {
    if (Math.hypot(x - drag.x, y - drag.y) > 3) drag.moved = true;
    if (drag.mode === 'pan') { view.cx = drag.cx - (x - drag.x) / view.scale; view.cy = drag.cy - (y - drag.y) / view.scale; requestDraw(); }
    else if (drag.moved && drag.z) { ghost = { z: drag.z, dx: (x - drag.x) / view.scale, dy: (y - drag.y) / view.scale, da: 0 }; requestDraw(); }
    tip.style.display = 'none';
    return;
  }
  const z = hit(toWorldPt(x, y));
  if (z) {
    const f = FEATURE[z.feature];
    tip.replaceChildren(el('b', { text: f?.name ?? z.feature }), el('br'), `${Math.round(z.w * 2)}×${Math.round(z.h * 2)} ft · ${THEMES.find((t) => t.id === z.theme)?.name ?? z.theme}${z.level ? ` · floor ${z.level > 0 ? '+' : ''}${z.level}` : ''}`, z.tags.length ? el('div', { class: 'muted', text: z.tags.map((t) => FEATURE[t]?.name ?? t).join(', ') }) : '');
    tip.style.display = 'block';
    tip.style.left = `${Math.min(x + 14, view.w - 270)}px`;
    tip.style.top = `${y + 14}px`;
  } else tip.style.display = 'none';
});
canvas.addEventListener('pointerup', () => {
  canvas.classList.remove('panning');
  const d = drag;
  drag = null;
  if (!d) return;
  if (d.mode === 'pan' && !d.moved && selKey) { selKey = null; renderSide(); requestDraw(); }
  if (d.mode === 'move' && d.moved && d.z && ghost) {
    const z = d.z, gh = ghost;
    ghost = null;
    const added = state.edits.added.find((a) => a.key === z.key);
    commit(() => {
      if (added) { added.x = z.frame.x + gh.dx; added.y = z.frame.y + gh.dy; }
      else { const e = (state.edits.zones[z.key] ??= {}); e.x = z.frame.x + gh.dx; e.y = z.frame.y + gh.dy; e.a = z.frame.a; }
    });
  }
  ghost = null;
  requestDraw();
});
canvas.addEventListener('dblclick', (e) => {
  const r = canvas.getBoundingClientRect();
  const z = hit(toWorldPt(e.clientX - r.left, e.clientY - r.top));
  if (z) reroll(z);
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const before = toWorldPt(x, y);
  view.scale = Math.max(0.25, Math.min(60, view.scale * Math.pow(1.0015, -e.deltaY)));
  const after = toWorldPt(x, y);
  view.cx += before.x - after.x; view.cy += before.y - after.y;
  requestDraw();
}, { passive: false });
canvas.addEventListener('dragover', (e) => e.preventDefault());
canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  const data = e.dataTransfer?.getData('text/plain') ?? '';
  if (!data.startsWith('feature:')) return;
  const id = data.slice(8);
  const r = canvas.getBoundingClientRect();
  const wp = toWorldPt(e.clientX - r.left, e.clientY - r.top);
  const key = `u${Date.now().toString(36)}`;
  commit(() => { state.edits.added.push({ key, feature: id, x: wp.x, y: wp.y, a: 0 }); selKey = key; });
});
window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
  const z = selKey ? map.zones.find((q) => q.key === selKey) : undefined;
  if (e.key === 'Escape') { selKey = null; setNoteMode(false); renderSide(); requestDraw(); }
  if (e.key.toLowerCase() === 'f') { fit(); requestDraw(); }
  if (e.key.toLowerCase() === 'n') setNoteMode(!noteMode);
  if (!z) return;
  if (e.key === 'Delete' || e.key === 'Backspace') deleteZone(z);
  if (e.key.toLowerCase() === 'r') {
    const da = ((e.shiftKey ? -15 : 15) * Math.PI) / 180;
    const added = state.edits.added.find((a) => a.key === z.key);
    commit(() => {
      if (added) added.a = z.frame.a + da;
      else { const ed = (state.edits.zones[z.key] ??= {}); ed.x = z.frame.x; ed.y = z.frame.y; ed.a = z.frame.a + da; }
    });
  }
});
window.addEventListener('resize', () => requestDraw());

function doUndo(): void { const s = undoStack.pop(); if (!s) return; redoStack.push(snap()); restore(s); regenerate(); save(); }
function doRedo(): void { const s = redoStack.pop(); if (!s) return; undoStack.push(snap()); restore(s); regenerate(); save(); }

// ------------------------------------------------------------------ export
function download(name: string, blob: Blob): void {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
function fitView(maxPx: number): View {
  const b = map.bounds;
  const w = b.x1 - b.x0 + 16, h = b.y1 - b.y0 + 16;
  const scale = Math.min(maxPx / w, maxPx / h, 12);
  return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, scale, w: Math.round(w * scale), h: Math.round(h * scale) };
}
function exportPng(): void {
  const v = fitView(4096);
  const c = document.createElement('canvas');
  c.width = v.w; c.height = v.h;
  drawMap(new CanvasPen(c.getContext('2d')!), map, v, { ...state.layers }, -1);
  c.toBlob((b) => b && download(`backrooms-${state.params.seed}.png`, b), 'image/png');
}
function exportSvg(): void {
  const v = fitView(2400);
  const pen = new SvgPen(v.w, v.h);
  drawMap(pen, map, v, { ...state.layers }, -1);
  download(`backrooms-${state.params.seed}.svg`, new Blob([pen.svg()], { type: 'image/svg+xml' }));
}
function exportJson(): void {
  const data = {
    format: 'backrooms-plan', version: 1, units: { tile: '2 ft', note: '+x east, +y south, angles in radians' },
    params: state.params, edits: state.edits,
    zones: map.zones.map((z) => ({ key: z.key, feature: z.feature, frame: z.frame, w: z.w, h: z.h, theme: z.theme, level: z.level, tags: z.tags, edges: z.edges, ports: z.ports })),
    links: map.links.map((l) => ({ kind: l.kind, a: map.zones[l.a].key, b: map.zones[l.b].key, w: l.w, path: l.path, loop: l.loop, edge: l.edge })),
    prims: map.prims,
  };
  download(`backrooms-${state.params.seed}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
}
function importJson(): void {
  const inp = el('input', { type: 'file', accept: '.json,application/json' }) as HTMLInputElement;
  inp.addEventListener('change', async () => {
    const f = inp.files?.[0];
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!d.params) throw new Error('no params');
      commit(() => { state.params = { ...DEFAULT_PARAMS, ...d.params }; state.edits = { ...emptyEdits(), ...d.edits }; }, true);
    } catch (err) { window.alert(`Could not open that file: ${(err as Error).message}`); }
  });
  inp.click();
}

// ------------------------------------------------------------------ start
requestAnimationFrame(() => { view.w = canvas.clientWidth; view.h = canvas.clientHeight; regenerate(true); });
