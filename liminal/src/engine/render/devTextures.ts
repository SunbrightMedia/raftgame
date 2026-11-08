/**
 * Procedurally generated textures, all original work (CC0, like the rest of
 * the project's own content). Three families:
 *  - dev/*    measurement grids (16-unit lines, 64-unit bold lines, labels)
 *             for judging scale while building. Never crushed.
 *  - house/*  things the CC0 photo libraries don't have but suburban houses
 *             do: patterned wallpaper, 70s wood paneling.
 *  - office/* vinyl composition tile, the fluorescent light panel (which
 *             emits light, like a lights.rad entry), baseboard trim.
 *
 * Painted at a generous resolution as "source" images; the crusher then
 * brings them down to the same look as the photo textures.
 */
export interface TexImage {
  name: string;
  canvas: HTMLCanvasElement;
  /** World units one repeat covers. */
  worldW: number;
  worldH: number;
  emissive?: { color: [number, number, number]; intensity: number };
  /** Skip the crusher (dev grids stay crisp and exact). */
  raw?: boolean;
  material: string;
}

type Painter = (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => void;

interface Def {
  px: [number, number];
  world: [number, number];
  paint: Painter;
  material?: string;
  raw?: boolean;
  emissive?: TexImage['emissive'];
}

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

/** Soft vertical streaks: water stains, sun fade, grime collecting low. */
function wear(g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number, strength: number): void {
  for (let i = 0; i < 6; i++) {
    const x = rnd() * w, sw = 4 + rnd() * w * 0.2;
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(60,50,30,0)');
    grad.addColorStop(1, `rgba(60,50,30,${strength * rnd()})`);
    g.fillStyle = grad;
    g.fillRect(x, 0, sw, h);
  }
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
    g.font = 'bold 9px monospace';
    g.textBaseline = 'top';
    for (let i = 0; i < w; i += 64) for (let j = 0; j < h; j += 64) g.fillText(label, i + 4, j + 4);
  };
}

const grid = (base: string, minor: string, major: string): Def =>
  ({ px: [128, 128], world: [128, 128], paint: measureGrid(base, minor, major, '64'), raw: true, material: 'concrete' });

const DEFS: Record<string, Def> = {
  'dev/gray': grid('#8f8f8c', '#7d7d7a', '#5c5c5a'),
  'dev/floor': grid('#5b5a57', '#504f4c', '#3a3937'),
  'dev/orange': grid('#c8772f', '#b56a28', '#7a4519'),
  'dev/blue': grid('#4f6b8c', '#46607e', '#2c3e55'),
  'dev/green': grid('#5f7d52', '#557048', '#36482d'),
  'dev/white': grid('#cfcdc6', '#bdbbb4', '#94928b'),

  // Striped wallpaper: dusty rose and cream with pinstripes. 32" repeat.
  'house/wallpaper_stripe': {
    px: [128, 128], world: [32, 32], material: 'plaster',
    paint: (g, w, h, rnd) => {
      g.fillStyle = '#d9cbb0'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#b98f86'; g.fillRect(0, 0, w * 0.375, h);
      g.fillStyle = '#a77b72'; g.fillRect(w * 0.375, 0, 3, h); g.fillRect(w * 0.6, 0, 2, h);
      g.fillStyle = '#c9b494'; g.fillRect(w * 0.8, 0, 2, h);
      noise(g, w, h, rnd, 10); wear(g, w, h, rnd, 0.12);
    },
  },
  // Small repeating motif on pale green: the wallpaper in every grandparent's hallway. 16" repeat.
  'house/wallpaper_motif': {
    px: [128, 128], world: [16, 16], material: 'plaster',
    paint: (g, w, h, rnd) => {
      g.fillStyle = '#b9c2a3'; g.fillRect(0, 0, w, h);
      const motif = (cx: number, cy: number) => {
        g.fillStyle = '#8c9a78';
        g.beginPath(); g.moveTo(cx, cy - 14); g.lineTo(cx + 8, cy); g.lineTo(cx, cy + 14); g.lineTo(cx - 8, cy); g.closePath(); g.fill();
        g.fillStyle = '#d8d2b4';
        g.beginPath(); g.arc(cx, cy, 3, 0, Math.PI * 2); g.fill();
      };
      for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h], [w / 2, h / 2]]) motif(x, y);
      g.fillStyle = '#a5b08e';
      for (const [x, y] of [[w / 2, 0], [w / 2, h], [0, h / 2], [w, h / 2]]) g.fillRect(x - 1.5, y - 1.5, 3, 3);
      noise(g, w, h, rnd, 8);
    },
  },
  // 70s wood-grain paneling, grooves every 16". 64" repeat.
  'house/paneling': {
    px: [256, 256], world: [64, 64], material: 'wood',
    paint: (g, w, h, rnd) => {
      const boards = 4, bw = w / boards;
      for (let b = 0; b < boards; b++) {
        const base = 70 + rnd() * 18;
        for (let x = 0; x < bw; x++) {
          const grain = Math.sin(x * 0.35 + rnd() * 0.4 + b * 3) * 10 + Math.sin(x * 1.7 + b) * 4;
          const v = base + grain;
          g.fillStyle = `rgb(${v + 38},${v + 12},${v - 18})`;
          g.fillRect(b * bw + x, 0, 1, h);
        }
        g.fillStyle = 'rgba(25,14,6,0.9)'; g.fillRect(b * bw, 0, 2, h);
        g.fillStyle = 'rgba(160,110,70,0.35)'; g.fillRect(b * bw + 2, 0, 1, h);
      }
      noise(g, w, h, rnd, 12);
    },
  },
  // Vinyl composition tile, 12" squares, cream with flecks. 48" repeat (4×4 tiles).
  'office/vinyl_tile': {
    px: [192, 192], world: [48, 48], material: 'tile',
    paint: (g, w, h, rnd) => {
      const n = 4, s = w / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const v = 196 + rnd() * 14;
        g.fillStyle = `rgb(${v},${v - 6},${v - 22})`;
        g.fillRect(i * s, j * s, s, s);
      }
      const flecks = ['#8f8a7c', '#a7a091', '#6e6a62', '#b8ad94'];
      for (let k = 0; k < 2600; k++) {
        g.fillStyle = flecks[Math.floor(rnd() * flecks.length)];
        g.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1 + Math.floor(rnd() * 2), 1);
      }
      g.fillStyle = 'rgba(80,70,55,0.55)';
      for (let i = 0; i < n; i++) { g.fillRect(i * s, 0, 1, h); g.fillRect(0, i * s, w, 1); }
      wear(g, w, h, rnd, 0.06);
    },
  },
  // Fluorescent troffer with a prismatic diffuser. Emits light.
  'office/lightpanel': {
    px: [96, 96], world: [48, 48], material: 'glass',
    emissive: { color: [1, 0.98, 0.92], intensity: 1 },
    paint: (g, w, h) => {
      g.fillStyle = '#f7f5ea'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#e6e3d4';
      for (let i = 0; i < w; i += 4) for (let j = (i / 4) % 2 ? 2 : 0; j < h; j += 4) g.fillRect(i, j, 2, 2);
      g.fillStyle = '#9d9a8f';
      g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3); g.fillRect(0, 0, 3, h); g.fillRect(w - 3, 0, 3, h);
    },
  },
  // Baseboard / trim.
  'office/trim': {
    px: [64, 16], world: [64, 16], material: 'wood',
    paint: (g, w, h, rnd) => {
      g.fillStyle = '#6f5a43'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#5d4b37'; g.fillRect(0, 0, w, 2);
      noise(g, w, h, rnd, 14);
    },
  },
  missing: {
    px: [32, 32], world: [32, 32], raw: true,
    paint: (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#f0f'; g.fillRect(0, 0, w / 2, h / 2); g.fillRect(w / 2, h / 2, w / 2, h / 2);
    },
  },
};

export function devTextureNames(): string[] {
  return Object.keys(DEFS);
}

export function makeDevTexture(name: string): TexImage | null {
  const d = DEFS[name];
  if (!d) return null;
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = d.px;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  let seed = 0;
  for (const c of name) seed = (seed * 31 + c.charCodeAt(0)) | 0;
  d.paint(g, d.px[0], d.px[1], rng(seed));
  return { name, canvas, worldW: d.world[0], worldH: d.world[1], emissive: d.emissive, raw: d.raw, material: d.material ?? 'default' };
}
