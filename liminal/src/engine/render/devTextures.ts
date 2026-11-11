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
  /**
   * A light source. luminance in cd/m² (a 1990s fluorescent troffer ≈ 2000,
   * a BR30 lens ≈ 48000); kelvin = colour temperature; castsLight = also
   * light the room from this surface in the bake (lights.rad-style), or only
   * glow (a pot-light lens, whose light is a separate entity).
   */
  emissive?: { kelvin: number; luminance: number; castsLight: boolean; color?: string; anim?: 'static' };
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
    // 2×4 troffer, three F32T8 tubes (~2800 lm each, ~65% fixture efficiency → ~5500 lm)
    // over ~0.74 m²: L = Φ/(π·A) ≈ 2300 cd/m². Warm-white 3500 K tubes.
    emissive: { kelvin: 3500, luminance: 2200, castsLight: true },
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
  // Fake LAMINATE marble (Formica-style), not stone: a flat printed photo of
  // marble. Warm off-white, soft low-contrast veining, fine print grain, and
  // a small repeat you can spot across a long counter. Satin, not polished.
  'house/laminate_marble': {
    px: [256, 256], world: [24, 24], material: 'laminate', raw: true,
    paint: (g, w, h, rnd) => {
      const cloud = valueNoise(w, h, 6, rnd), cloud2 = valueNoise(w, h, 18, rnd);
      const img = g.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const v = (cloud[i] - 0.5) * 10 + (cloud2[i] - 0.5) * 6;
        img.data[i * 4] = 232 + v; img.data[i * 4 + 1] = 225 + v; img.data[i * 4 + 2] = 212 + v * 0.9; img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      // Soft printed veins: faint, blurry, mostly one direction.
      g.filter = 'blur(1.2px)';
      for (let k = 0; k < 9; k++) {
        let x = rnd() * w, y = rnd() * h, a = -0.5 + (rnd() - 0.5) * 0.6;
        const pts: [number, number][] = [[x, y]];
        for (let i = 0; i < 16; i++) { a += (rnd() - 0.5) * 0.7; x += Math.cos(a) * 12; y += Math.sin(a) * 12; pts.push([x, y]); }
        g.strokeStyle = `rgba(150,140,130,${0.10 + rnd() * 0.14})`;
        g.lineWidth = 0.8 + rnd() * 2.5;
        for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
          g.beginPath();
          pts.forEach(([px, py], i) => (i ? g.lineTo(px + ox, py + oy) : g.moveTo(px + ox, py + oy)));
          g.stroke();
        }
      }
      g.filter = 'none';
      // Print grain: tiny warm-grey dots, the giveaway that it's a printed sheet.
      for (let k = 0; k < 2200; k++) {
        g.fillStyle = `rgba(${120 + rnd() * 50},${110 + rnd() * 40},${100 + rnd() * 30},${0.12 + rnd() * 0.2})`;
        g.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1, 1);
      }
    },
  },
  // The laminate edge strip on a counter's front: same print, slightly darker,
  // with the thin dark seam line where the edge strip meets the top.
  // Map it so v=0 is the bottom of the 1.5" edge (offset [0, -z0]).
  'house/laminate_edge': {
    px: [256, 16], world: [24, 1.5], material: 'laminate', raw: true,
    paint: (g, w, h, rnd) => {
      g.fillStyle = '#ddd5c6'; g.fillRect(0, 0, w, h);
      noise(g, w, h, rnd, 8);
      g.fillStyle = '#5a4636'; g.fillRect(0, 0, w, 1);      // seam at the top (canvas row 0 = v 1)
      g.fillStyle = 'rgba(90,70,54,0.35)'; g.fillRect(0, 1, w, 1);
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
    // BR30 face: ~248 cd over a ~3.2" lens (≈0.0052 m²) → ≈48000 cd/m². The can's light is an entity.
    emissive: { kelvin: 2700, luminance: 48000, castsLight: false },
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
  // ---- Mall / commercial (Backrooms "Mall Run" lighting reference; original designs) ----
  // Gold vinyl wallpaper: pinstripe pairs every 12" with a column of stacked
  // scallops between them. Paper-flat, a little satin. 24" repeat.
  'mall/wallpaper_gold': {
    px: [192, 192], world: [24, 24], material: 'wallpaper',
    paint: (g, w, h, rnd) => {
      g.fillStyle = '#e4cd7a'; g.fillRect(0, 0, w, h);
      const col = w / 2;
      for (let c = 0; c < 2; c++) {
        const x0 = c * col;
        g.fillStyle = '#c4a046'; g.fillRect(x0 + 2, 0, 3, h); g.fillRect(x0 + 8, 0, 1, h);
        // Scallop column, offset half a step on alternate columns.
        const cx = x0 + col / 2 + 3, step = h / 6, off = c ? step / 2 : 0;
        for (let k = -1; k < 7; k++) {
          const cy = k * step + off;
          g.strokeStyle = '#c9a74e'; g.lineWidth = 4;
          g.beginPath(); g.arc(cx, cy + step * 0.55, step * 0.62, Math.PI * 1.12, Math.PI * 1.88); g.stroke();
          g.strokeStyle = '#d6b960'; g.lineWidth = 2;
          g.beginPath(); g.arc(cx, cy + step * 0.55, step * 0.36, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
          g.fillStyle = '#c29d44'; g.fillRect(cx - 1.5, cy + step * 0.05, 3, 3);
        }
      }
      noise(g, w, h, rnd, 7); wear(g, w, h, rnd, 0.05);
    },
  },
  // Commercial loop carpet, maroon, full of coloured flecks (light, dark,
  // blue-violet, cream) like real solution-dyed carpet. Bypasses the crusher.
  'mall/carpet_maroon': {
    px: [256, 256], world: [36, 36], material: 'carpet', raw: true,
    paint: (g, w, h, rnd) => {
      const mottle = valueNoise(w, h, 5, rnd), mid = valueNoise(w, h, 24, rnd);
      const img = g.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const m = (mottle[i] - 0.5) * 16 + (mid[i] - 0.5) * 12 + (rnd() - 0.5) * 18;
        let r = 122 + m, gg = 48 + m * 0.5, b = 66 + m * 0.6;
        const f = rnd();
        if (f < 0.07) { r = 196; gg = 112; b = 132; }
        else if (f < 0.13) { r = 58; gg = 20; b = 32; }
        else if (f < 0.155) { r = 92; gg = 74; b = 140; }
        else if (f < 0.17) { r = 214; gg = 192; b = 170; }
        img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    },
  },
  // A 3×3 ft LED panel with a flat white diffuser (the reference capture's ceilings). The capture's
  // panels are dim: at the tone curve's input a panel is about 2.9 (scene units, colour 1 / 0.85 /
  // 0.55), the lit right wall 0.42: about 7× the wall. In the rebuilds' units (game light × 1000,
  // exposure 34.13 / 1000; tools/recreate/cx.ts) that is 2.9 / 0.03413 ≈ 88 cd/m². A real panel
  // (≈ 3500 cd/m²) would glow far too much. The light on the room is a "spot" entity.
  'cx/ledpanel': {
    px: [64, 64], world: [36, 36], material: 'glass',
    emissive: { kelvin: 4000, color: '#ffecc5', luminance: 88, castsLight: false },
    paint: (g, w, h) => { g.fillStyle = '#fbfbf7'; g.fillRect(0, 0, w, h); g.fillStyle = '#d8d8d2'; g.fillRect(0, 0, w, 2); g.fillRect(0, h - 2, w, 2); g.fillRect(0, 0, 2, h); g.fillRect(w - 2, 0, 2, h); },
  },
  // Floor tape, 7" wide: yellow (the reference capture's #f0ce22) with dark chevrons pointing along +u.
  'cx/tape': {
    px: [32, 32], world: [7, 7], material: 'plastic',
    paint: (g, w, h) => {
      g.fillStyle = '#f0ce22'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#2e2b1c';
      g.beginPath(); g.moveTo(w * 0.62, h * 0.18); g.lineTo(w * 0.86, h * 0.5); g.lineTo(w * 0.62, h * 0.82); g.lineTo(w * 0.44, h * 0.82); g.lineTo(w * 0.68, h * 0.5); g.lineTo(w * 0.44, h * 0.18); g.closePath(); g.fill();
    },
  },
  // A ceiling panel that is switched off (the reference capture's corridor has one): dark diffuser, grey frame.
  'cx/panel_off': {
    px: [64, 64], world: [36, 36], material: 'glass',
    paint: (g, w, h) => { g.fillStyle = '#1c1c1a'; g.fillRect(0, 0, w, h); g.fillStyle = '#9a9a92'; g.fillRect(0, 0, w, 2); g.fillRect(0, h - 2, w, 2); g.fillRect(0, 0, 2, h); g.fillRect(w - 2, 0, 2, h); },
  },
  // 2×4 troffer with a flat diffuser, cool-white tubes (4100 K) in a thin dark frame.
  'mall/troffer': {
    px: [64, 128], world: [24, 48], material: 'glass',
    // Same fixture as office/lightpanel: three T8 tubes ≈ 5500 lm over 0.74 m² → ≈2200 cd/m².
    emissive: { kelvin: 4100, luminance: 2200, castsLight: true },
    paint: (g, w, h) => {
      g.fillStyle = '#fbfaf4'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#efeee6';
      for (let i = 0; i < w; i += 4) for (let j = (i / 4) % 2 ? 2 : 0; j < h; j += 4) g.fillRect(i, j, 2, 2);
      g.fillStyle = '#5c5a55';
      g.fillRect(0, 0, w, 2); g.fillRect(0, h - 2, w, 2); g.fillRect(0, 0, 2, h); g.fillRect(w - 2, 0, 2, h);
    },
  },
  // Exit sign face: red LED letters on a dark lens. Glows red; too small to light the room.
  'mall/exit_sign': {
    px: [64, 32], world: [12, 6], material: 'plastic',
    emissive: { kelvin: 2000, color: '#ff2a14', luminance: 400, castsLight: false },
    paint: (g, w, h) => {
      g.fillStyle = '#1c0705'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ff4030';
      g.font = 'bold 20px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('EXIT', w / 2, h / 2 + 1);
    },
  },
  // ---- Reference 3-5 rooms (original designs) ----
  // Gold for trophies: warm metallic yellow with a soft vertical highlight. Matte by default (reflections off).
  'rec/gold': {
    px: [16, 32], world: [4, 8], material: 'plastic',
    paint: (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, '#8a6516'); gr.addColorStop(0.45, '#e2bd4f'); gr.addColorStop(0.6, '#f4dc84'); gr.addColorStop(1, '#7a5612');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    },
  },
  // Faux-painted mural: a potted tree on a muddy olive-gold wall, soft and smeared,
  // the kind of thing a 1990s hotel had painted on its atrium wall.
  // The lobby mural (photo): pale ochre wash, a big dark ficus in a pot, two small
  // potted plants at its foot.
  'lq/mural_tree': {
    px: [256, 256], world: [160, 100], material: 'plaster', raw: true,
    paint: (g, w, h, rnd) => {
      const Y = (v: number) => h * (1 - v);                                       // v: 0 bottom .. 1 top
      const bg = g.createLinearGradient(0, 0, w, 0);
      bg.addColorStop(0, '#b4a679'); bg.addColorStop(0.5, '#c2b388'); bg.addColorStop(1, '#ab9c70');
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 700; k++) { g.fillStyle = `rgba(${120 + rnd() * 60},${105 + rnd() * 50},${60 + rnd() * 30},0.07)`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 6 + rnd() * 18, 0, Math.PI * 2); g.fill(); }
      const cx = w * 0.36;
      g.fillStyle = '#9a8a62'; g.fillRect(cx - 22, Y(0.2), 44, h * 0.16);          // pot
      g.fillStyle = '#3f3322';
      for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(cx - 3 + k * 2, Y(0.2)); g.quadraticCurveTo(cx - 10 + k * 9, Y(0.45), cx - 6 + k * 6, Y(0.62)); g.lineWidth = 2.5; g.strokeStyle = '#3f3322'; g.stroke(); }
      for (let k = 0; k < 260; k++) {                                              // canopy
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd());
        g.fillStyle = `rgba(${24 + rnd() * 18},${32 + rnd() * 20},${18 + rnd() * 12},0.6)`;
        g.beginPath(); g.arc(cx + Math.cos(a) * r * w * 0.11, Y(0.74) + Math.sin(a) * r * h * 0.22, 2 + rnd() * 5, 0, Math.PI * 2); g.fill();
      }
      for (const [px, s] of [[0.2, 0.09], [0.47, 0.07]] as const) {               // small potted plants
        g.fillStyle = '#5b4a33'; g.fillRect(w * px - 9, Y(0.12), 18, h * 0.1);
        for (let k = 0; k < 50; k++) {
          const a = -Math.PI * rnd(), r = rnd() * w * s;
          g.fillStyle = 'rgba(28,38,22,0.7)'; g.beginPath(); g.ellipse(w * px + Math.cos(a) * r, Y(0.13) + Math.sin(a) * r, 5, 2, a, 0, Math.PI * 2); g.fill();
        }
      }
      noise(g, w, h, rnd, 10);
    },
  },
  // Lobby floor tile (photo): big cream squares, thin grout, a small dark-teal
  // diamond set into every third corner.
  'lq/tile': {
    px: [256, 256], world: [54, 54], material: 'tile', raw: true,
    paint: (g, w, h, rnd) => {
      g.fillStyle = '#ddd3bf'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 500; k++) { g.fillStyle = `rgba(${170 + rnd() * 60},${160 + rnd() * 55},${140 + rnd() * 45},0.08)`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 2 + rnd() * 9, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#a89c86';
      for (let i = 0; i < 3; i++) { g.fillRect((i * w) / 3, 0, 1.5, h); g.fillRect(0, (i * h) / 3, w, 1.5); }
      g.fillStyle = '#2f4f50';
      const d = w / 9;
      g.beginPath(); g.moveTo(0, -d); g.lineTo(d, 0); g.lineTo(0, d); g.lineTo(-d, 0); g.closePath(); g.fill();
      for (const [x, y] of [[w, 0], [0, h], [w, h]]) { g.beginPath(); g.moveTo(x, y - d); g.lineTo(x + d, y); g.lineTo(x, y + d); g.lineTo(x - d, y); g.closePath(); g.fill(); }
      noise(g, w, h, rnd, 6);
    },
  },
  // CRT screen tuned to nothing: animated snow (the world shader draws the
  // static; this texture is only its average colour, for the bake).
  'lq/tv_screen': {
    px: [16, 12], world: [16, 12], material: 'glass',
    emissive: { kelvin: 7500, luminance: 45, castsLight: false, anim: 'static' },
    paint: (g, w, h) => { g.fillStyle = '#8c8c8c'; g.fillRect(0, 0, w, h); },
  },
  // Arcade cabinet screen: saturated sprites on black.
  'arcade/screen': {
    px: [48, 36], world: [20, 15], material: 'glass',
    emissive: { kelvin: 6500, luminance: 160, castsLight: false },
    paint: (g, w, h, rnd) => {
      g.fillStyle = '#101028'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 18; k++) { g.fillStyle = ['#ff3a7a', '#3ac8ff', '#ffe23a', '#7aff5a'][k % 4]; g.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 2 + Math.floor(rnd() * 4), 2 + Math.floor(rnd() * 3)); }
    },
  },
  // Purple neon tube: lights the arcade (and leaks through the window).
  'arcade/neon_purple': {
    px: [16, 4], world: [32, 2], material: 'glass',
    emissive: { kelvin: 6500, color: '#b24dff', luminance: 900, castsLight: true },
    paint: (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); },
  },
  // Flush dome light lens (frosted glass). Glows; the light itself is an entity.
  'fixture/dome': {
    px: [32, 32], world: [12, 12], material: 'glass',
    emissive: { kelvin: 3000, luminance: 9000, castsLight: false },
    paint: (g, w, h) => { g.fillStyle = '#f4efe4'; g.fillRect(0, 0, w, h); },
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
