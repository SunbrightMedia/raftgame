/**
 * The texture crusher: turns a clean photo texture into something that looks
 * like it shipped in 1998–2004. Old engine textures look the way they do
 * because of how they were made, not where they came from: photos shrunk
 * hard, contrast pushed so they read at low res, colours reduced (Doom: one
 * 256-colour palette for the whole game; Source: DXT compression banding),
 * then sharpened.
 *
 * Every step is a live setting, so the look can be dialled anywhere between
 * Doom and HL2. Pixel operations work on plain RGBA arrays and are unit-testable.
 */
export interface CrushParams {
  /** Texels per world unit. Doom ≈ 1, HL2 ≈ 2–4. */
  density: number;
  /** Max texture edge in pixels (keeps huge surfaces sane). */
  maxSize: number;
  /** Colours per texture (0 = no reduction). */
  colors: number;
  /** One palette shared by every texture (Doom-style) instead of one each. */
  sharedPalette: boolean;
  contrast: number;
  saturation: number;
  brightness: number;
  /** Unsharp-mask strength after downscaling. */
  sharpen: number;
  /** Ordered (Bayer) dithering when reducing colours, 0..1. */
  dither: number;
}

/** Contrast/saturation/brightness in place. Values in display space (0..255). */
export function grade(px: Uint8ClampedArray, p: Pick<CrushParams, 'contrast' | 'saturation' | 'brightness'>): void {
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i], g = px[i + 1], b = px[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    r = l + (r - l) * p.saturation; g = l + (g - l) * p.saturation; b = l + (b - l) * p.saturation;
    r = (r - 128) * p.contrast + 128; g = (g - 128) * p.contrast + 128; b = (b - 128) * p.contrast + 128;
    px[i] = r * p.brightness; px[i + 1] = g * p.brightness; px[i + 2] = b * p.brightness;
  }
}

/** 3×3 unsharp mask, wrapping at the edges (textures tile). */
export function sharpen(px: Uint8ClampedArray, w: number, h: number, amount: number): void {
  if (amount <= 0) return;
  const src = px.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            sum += src[((((y + dy + h) % h) * w + ((x + dx + w) % w)) * 4) + c];
          }
        }
        const o = (y * w + x) * 4 + c;
        px[o] = src[o] + (src[o] - sum / 9) * amount;
      }
    }
  }
}

export type Palette = [number, number, number][];

/** Median-cut palette from RGBA pixels (alpha ignored). */
export function medianCut(px: Uint8ClampedArray, n: number, stride = 1): Palette {
  const pts: number[][] = [];
  for (let i = 0; i < px.length; i += 4 * stride) pts.push([px[i], px[i + 1], px[i + 2]]);
  let boxes: number[][][] = [pts];
  while (boxes.length < n) {
    // Split the box with the widest channel range.
    let bi = -1, bc = 0, br = -1;
    for (let i = 0; i < boxes.length; i++) {
      const bx = boxes[i];
      if (bx.length < 2) continue;
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0;
        for (const p of bx) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; }
        if (hi - lo > br) { br = hi - lo; bi = i; bc = c; }
      }
    }
    if (bi < 0 || br <= 0) break;
    const bx = boxes[bi].sort((a, b) => a[bc] - b[bc]);
    const mid = bx.length >> 1;
    boxes.splice(bi, 1, bx.slice(0, mid), bx.slice(mid));
  }
  return boxes.filter((b) => b.length).map((b) => {
    const s = [0, 0, 0];
    for (const p of b) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
    return [Math.round(s[0] / b.length), Math.round(s[1] / b.length), Math.round(s[2] / b.length)];
  });
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Map every pixel to its nearest palette colour, optionally with ordered dithering. */
export function applyPalette(px: Uint8ClampedArray, w: number, pal: Palette, dither: number): void {
  const cache = new Map<number, number>();
  const spread = dither * 32;
  for (let i = 0, k = 0; i < px.length; i += 4, k++) {
    const x = k % w, y = (k - x) / w;
    const d = spread ? (BAYER4[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * spread : 0;
    const r = clamp255(px[i] + d), g = clamp255(px[i + 1] + d), b = clamp255(px[i + 2] + d);
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    let best = cache.get(key);
    if (best === undefined) {
      let bd = Infinity;
      best = 0;
      for (let j = 0; j < pal.length; j++) {
        const dr = r - pal[j][0], dg = g - pal[j][1], db = b - pal[j][2];
        // Weighted distance: the eye cares most about green.
        const dist = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
        if (dist < bd) { bd = dist; best = j; }
      }
      cache.set(key, best);
    }
    px[i] = pal[best][0]; px[i + 1] = pal[best][1]; px[i + 2] = pal[best][2];
  }
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function averageColor(px: Uint8ClampedArray): [number, number, number] {
  let r = 0, g = 0, b = 0;
  const n = px.length / 4;
  for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
  return [r / n / 255, g / n / 255, b / n / 255];
}
