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

/**
 * Smooth tiling value noise in 0..1: random values on a `cells`×`cells` grid,
 * bicubic-smoothed and wrapped so the result tiles.
 */
function valueNoise(w: number, h: number, cells: number, rnd: () => number): Float32Array {
  const grid = Array.from({ length: cells * cells }, () => rnd());
  const out = new Float32Array(w * h);
  const sm = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) {
    const gy = (y / h) * cells, y0 = Math.floor(gy), ty = sm(gy - y0);
    for (let x = 0; x < w; x++) {
      const gx = (x / w) * cells, x0 = Math.floor(gx), tx = sm(gx - x0);
      const at = (i: number, j: number) => grid[((j + cells) % cells) * cells + ((i + cells) % cells)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
      out[y * w + x] = a + (b - a) * ty;
    }
  }
  return out;
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

  // ---- 90s house details (Postmodern Palace reference; see STYLE.md) ----

  // Six-panel colonial door, painted white. One door: 36" × 80".
  'house/door_6panel': {
    px: [144, 320], world: [36, 80], material: 'wood',
    paint: (g, w, h, rnd) => {
      g.fillStyle = '#ecebe5'; g.fillRect(0, 0, w, h);
      // Panels: top pair small, middle pair tall, bottom pair medium (inches → px at 4px/in).
      const P = 4;
      const panels = [[5, 5, 11, 17], [20, 5, 11, 17], [5, 26, 11, 30], [20, 26, 11, 30], [5, 60, 11, 15], [20, 60, 11, 15]];
      for (const [x, y, pw, ph] of panels) {
        const X = x * P, Y = y * P, W = pw * P, H = ph * P;
        g.fillStyle = '#c9c8c1'; g.fillRect(X - 3, Y - 3, W + 6, H + 6);   // shadowed bevel
        g.fillStyle = '#f6f5f0'; g.fillRect(X - 3, Y - 3, W + 6, 2); g.fillRect(X - 3, Y - 3, 2, H + 6); // lit edges
        g.fillStyle = '#e4e3dc'; g.fillRect(X, Y, W, H);                   // raised field
      }
      noise(g, w, h, rnd, 5);
    },
  },
  // Fake laminate marble: printed soft grey veining on off-white. Bar and counter tops.
  'house/laminate_marble': {
    px: [256, 256], world: [48, 48], material: 'tile',
    paint: (g, w, h, rnd) => {
      g.fillStyle = '#e8e6df'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 14; k++) {
        let x = rnd() * w, y = rnd() * h, a = rnd() * Math.PI;
        const pts: [number, number][] = [[x, y]];
        for (let i = 0; i < 18; i++) {
          a += (rnd() - 0.5) * 0.9; x += Math.cos(a) * 14; y += Math.sin(a) * 14;
          pts.push([x, y]);
        }
        g.strokeStyle = `rgba(${120 + rnd() * 40},${120 + rnd() * 40},${125 + rnd() * 40},${0.12 + rnd() * 0.25})`;
        g.lineWidth = 0.6 + rnd() * 2.2;
        // Draw the vein at every wrapped offset so the texture tiles.
        for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
          g.beginPath();
          pts.forEach(([px, py], i) => (i ? g.lineTo(px + ox, py + oy) : g.moveTo(px + ox, py + oy)));
          g.stroke();
        }
      }
      noise(g, w, h, rnd, 6);
    },
  },
  // Very orange stained veneer (maple/oak), vertical grain. 24" × 48" repeat.
  'house/wood_orange': {
    px: [128, 256], world: [24, 48], material: 'wood',
    paint: (g, w, h, rnd) => {
      for (let x = 0; x < w; x++) {
        const v = Math.sin(x * 0.21 + Math.sin(x * 0.05) * 3) * 10 + Math.sin(x * 1.3) * 4 + (rnd() - 0.5) * 6;
        g.fillStyle = `rgb(${200 + v},${112 + v * 0.8},${48 + v * 0.5})`;
        g.fillRect(x, 0, 1, h);
      }
      for (let k = 0; k < 40; k++) {
        g.fillStyle = `rgba(120,55,20,${0.08 + rnd() * 0.12})`;
        g.fillRect(rnd() * w, rnd() * h, 1, 6 + rnd() * 30);
      }
      noise(g, w, h, rnd, 7);
    },
  },
  // Tall display cabinet front: orange wood frame, frosted glass, thin gold lines. One unit: 36" × 84".
  'house/cabinet_glass': {
    px: [144, 336], world: [36, 84], material: 'wood',
    paint: (g, w, h, rnd) => {
      const P = 4;
      g.fillStyle = '#c8722f'; g.fillRect(0, 0, w, h);
      for (const x0 of [3, 19]) {
        const X = x0 * P, Y = 4 * P, W = 14 * P, H = 74 * P;
        const grad = g.createLinearGradient(X, Y, X + W, Y + H);
        grad.addColorStop(0, '#9fab a0'.replace(' ', '')); grad.addColorStop(0.5, '#7f8b83'); grad.addColorStop(1, '#6c776f');
        g.fillStyle = grad; g.fillRect(X, Y, W, H);
        // faint shelves and objects behind frosted glass
        g.fillStyle = 'rgba(40,45,40,0.45)';
        for (const sy of [22, 40, 58]) g.fillRect(X, sy * P, W, 3);
        for (let k = 0; k < 6; k++) g.fillRect(X + 6 + rnd() * (W - 16), (18 + Math.floor(rnd() * 3) * 18) * P - 12, 6, 12);
        // thin gold trim lines inset in the glass
        g.strokeStyle = '#c9a54a'; g.lineWidth = 2;
        g.strokeRect(X + 6, Y + 6, W - 12, H - 12);
      }
      noise(g, w, h, rnd, 6);
    },
  },
  // Burgundy vinyl upholstery (bar stools).
  'house/vinyl_burgundy': {
    px: [64, 64], world: [16, 16], material: 'fabric',
    paint: (g, w, h, rnd) => {
      g.fillStyle = '#6e1c26'; g.fillRect(0, 0, w, h);
      noise(g, w, h, rnd, 10);
    },
  },
  // Patterned band around a round ottoman: muted stripes with a row of dark beads.
  'house/ottoman_band': {
    px: [128, 64], world: [16, 8], material: 'fabric', raw: true,
    paint: (g, w, h, rnd) => {
      const stripes: [number, string][] = [[0, '#b99a86'], [10, '#d8c6ae'], [16, '#9b8f63'], [22, '#c79a8f'], [40, '#d8c6ae'], [46, '#9b8f63'], [52, '#b99a86']];
      stripes.forEach(([y, c], i) => { g.fillStyle = c; g.fillRect(0, y, w, (stripes[i + 1]?.[0] ?? h) - y); });
      g.fillStyle = '#3b3326';
      for (let x = 4; x < w; x += 8) { g.beginPath(); g.arc(x, 56, 2.2, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(x, 6, 1.6, 0, Math.PI * 2); g.fill(); }
      noise(g, w, h, rnd, 6);
    },
  },
  // Plush wall-to-wall carpet, neutral grey: recoloured per room (textures/variants.json).
  // Soft on purpose: up close a cut-pile carpet is a fine haze with gentle
  // mottling and traffic wear, not crunchy speckles. Bypasses the crusher.
  'house/carpet_plush': {
    px: [256, 256], world: [48, 48], material: 'carpet', raw: true,
    paint: (g, w, h, rnd) => {
      const mottle = valueNoise(w, h, 4, rnd), mid = valueNoise(w, h, 16, rnd), fine = valueNoise(w, h, 64, rnd);
      const img = g.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const v = 128 + (mottle[i] - 0.5) * 22 + (mid[i] - 0.5) * 14 + (fine[i] - 0.5) * 16 + (rnd() - 0.5) * 10;
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    },
  },
  // Woven upholstery fabric, neutral: a fine basket weave with soft slubs.
  'house/upholstery': {
    px: [128, 128], world: [8, 8], material: 'fabric', raw: true,
    paint: (g, w, h, rnd) => {
      const slub = valueNoise(w, h, 8, rnd);
      const img = g.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        // Over-under threads: alternate which direction is on top every 2px.
        const warp = ((x >> 1) + (y >> 2)) % 2 === 0;
        const thread = warp ? Math.sin((y % 4) * Math.PI / 4) : Math.sin((x % 4) * Math.PI / 4);
        const v = 120 + thread * 16 + (slub[i] - 0.5) * 18 + (rnd() - 0.5) * 8;
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    },
  },
  // Polished chrome: banded reflections.
  'fixture/chrome': {
    px: [32, 64], world: [8, 16], material: 'metal',
    paint: (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, w, 0);
      [['#5a5d62', 0], ['#e9ecef', 0.3], ['#8b9096', 0.5], ['#f7f8f9', 0.7], ['#666a70', 1]].forEach(([c, t]) => grad.addColorStop(t as number, c as string));
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
    },
  },
  // Recessed pot light lens. Glows, but casts no light itself: the light is a separate entity.
  'fixture/potlight': {
    px: [32, 32], world: [6, 6], material: 'glass',
    emissive: { color: [1, 0.93, 0.8], intensity: 0 },
    paint: (g, w, h) => {
      g.fillStyle = '#d9d6cf'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff6e4'; g.beginPath(); g.arc(w / 2, h / 2, w * 0.36, 0, Math.PI * 2); g.fill();
    },
  },
  // Semi-gloss white trim (baseboards, casing).
  'house/trim_white': {
    px: [32, 32], world: [16, 16], material: 'wood',
    paint: (g, w, h, rnd) => {
      g.fillStyle = '#efede6'; g.fillRect(0, 0, w, h);
      noise(g, w, h, rnd, 4);
    },
  },
  // Almond rocker light switch plate, 3" × 4.5".
  'house/switchplate': {
    px: [24, 36], world: [3, 4.5], material: 'plastic',
    paint: (g, w, h) => {
      g.fillStyle = '#e3d9c3'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#d4c8ae'; g.fillRect(8, 10, 8, 16);
      g.fillStyle = '#efe7d4'; g.fillRect(8, 10, 8, 7);
    },
  },
  // Dark rubber cove base for commercial spaces (STYLE.md: "VERY important").
  'commercial/cove_base_plum': {
    px: [64, 16], world: [32, 4], material: 'rubber',
    paint: (g, w, h, rnd) => {
      g.fillStyle = '#3e1d2c'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#4c2536'; g.fillRect(0, 0, w, 2);
      noise(g, w, h, rnd, 6);
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
