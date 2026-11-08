/**
 * Procedurally generated placeholder textures, all original. Two families:
 *  - dev/*   measurement grids (16-unit lines, 64-unit bold lines, labels) for
 *            judging scale while building.
 *  - office/* rough stand-ins for the liminal palette (ceiling tile, carpet,
 *            drywall) so the test room already hints at the mood.
 *
 * Texel density is 1 texel = 1 unit (inch) at scale 1, like Quake. A 128px
 * texture covers 128 units. Real PNGs from textures/ (Milestone 2) use the
 * same rule, and a face's scale changes it.
 */
export interface TexImage { name: string; canvas: HTMLCanvasElement; width: number; height: number }

type Painter = (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => void;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number, amount: number): void {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

function measureGrid(base: string, minor: string, major: string, label: string): Painter {
  return (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    g.fillStyle = minor;
    for (let i = 0; i < w; i += 16) g.fillRect(i, 0, 1, h);
    for (let j = 0; j < h; j += 16) g.fillRect(0, j, w, 1);
    g.fillStyle = major;
    for (let i = 0; i < w; i += 64) g.fillRect(i, 0, 2, h);
    for (let j = 0; j < h; j += 64) g.fillRect(0, j, w, 2);
    g.fillStyle = major;
    g.font = 'bold 9px monospace';
    g.textBaseline = 'top';
    for (let i = 0; i < w; i += 64) for (let j = 0; j < h; j += 64) g.fillText(label, i + 4, j + 4);
  };
}

const PAINTERS: Record<string, [number, number, Painter]> = {
  'dev/gray': [128, 128, measureGrid('#8f8f8c', '#7d7d7a', '#5c5c5a', '64')],
  'dev/floor': [128, 128, measureGrid('#5b5a57', '#504f4c', '#3a3937', '64')],
  'dev/orange': [128, 128, measureGrid('#c8772f', '#b56a28', '#7a4519', '64')],
  'dev/blue': [128, 128, measureGrid('#4f6b8c', '#46607e', '#2c3e55', '64')],
  'dev/green': [128, 128, measureGrid('#5f7d52', '#557048', '#36482d', '64')],
  'dev/white': [128, 128, measureGrid('#cfcdc6', '#bdbbb4', '#94928b', '64')],

  // 2ft drop-ceiling tiles in a thin metal grid.
  'office/ceiling': [96, 96, (g, w, h, rnd) => {
    g.fillStyle = '#d9d6cc';
    g.fillRect(0, 0, w, h);
    for (let k = 0; k < 900; k++) {
      g.fillStyle = rnd() < 0.5 ? '#c9c5ba' : '#e2dfd6';
      g.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1, 1);
    }
    g.fillStyle = '#a7a49b';
    for (let i = 0; i < w; i += 24) g.fillRect(i, 0, 1, h);
    for (let j = 0; j < h; j += 24) g.fillRect(0, j, w, 1);
  }],
  // Flecked commercial carpet.
  'office/carpet': [64, 64, (g, w, h, rnd) => {
    g.fillStyle = '#48505a';
    g.fillRect(0, 0, w, h);
    const flecks = ['#3c434c', '#545d68', '#5a5148', '#424a3f'];
    for (let k = 0; k < 1400; k++) {
      g.fillStyle = flecks[Math.floor(rnd() * flecks.length)];
      g.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1, 1);
    }
  }],
  // Slightly yellowed drywall.
  'office/wall': [64, 64, (g, w, h, rnd) => {
    g.fillStyle = '#c7bd9f';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, rnd, 10);
  }],
  // Wooden-ish baseboard / trim.
  'office/trim': [64, 16, (g, w, h, rnd) => {
    g.fillStyle = '#6f5a43';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#5d4b37';
    g.fillRect(0, 0, w, 2);
    noise(g, w, h, rnd, 14);
  }],
  // Fluorescent light panel (no lighting yet; reads as a light fixture).
  'office/lightpanel': [48, 48, (g, w, h) => {
    g.fillStyle = '#f4f2e6';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e4e1d1';
    for (let i = 4; i < w; i += 8) g.fillRect(i, 0, 1, h);
    g.fillStyle = '#9c998f';
    g.fillRect(0, 0, w, 2); g.fillRect(0, h - 2, w, 2); g.fillRect(0, 0, 2, h); g.fillRect(w - 2, 0, 2, h);
  }],
  missing: [32, 32, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#f0f';
    g.fillRect(0, 0, w / 2, h / 2);
    g.fillRect(w / 2, h / 2, w / 2, h / 2);
  }],
};

export function devTextureNames(): string[] {
  return Object.keys(PAINTERS);
}

export function makeDevTexture(name: string): TexImage | null {
  const entry = PAINTERS[name];
  if (!entry) return null;
  const [w, h, paint] = entry;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  let seed = 0;
  for (const c of name) seed = (seed * 31 + c.charCodeAt(0)) | 0;
  paint(g, w, h, rng(seed));
  return { name, canvas, width: w, height: h };
}
