/**
 * Physical units for lighting. The world is in inches; light maths is in
 * metres, candela (cd), lux (lx) and cd/m², so values can be checked against
 * real fixtures and the falloff is real inverse-square (also the default in
 * Source's light entity: quadratic attenuation 1, constant/linear 0).
 */
export const INCH = 0.0254;

/** Linear RGB of a black body at `kelvin`, normalised to luminance 1. */
export function kelvinToLinear(kelvin: number): [number, number, number] {
  // Tanner Helland's fit of the Planckian locus to sRGB (1000–40000 K), then
  // decoded to linear and normalised so changing the colour never changes brightness.
  const t = Math.max(1000, Math.min(40000, kelvin)) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const lin = [r, g, b].map((v) => srgbToLinear(Math.max(0, Math.min(255, v)) / 255));
  const lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return [lin[0] / lum, lin[1] / lum, lin[2] / lum];
}

/** Linear colour (luminance 1) of an emitter: an explicit sRGB colour (signs, LEDs) or a colour temperature. */
export function emitterColor(e: { kelvin: number; color?: string }): [number, number, number] {
  if (!e.color) return kelvinToLinear(e.kelvin);
  const n = parseInt(e.color.replace('#', ''), 16);
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255));
  const lum = Math.max(1e-6, 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]);
  return [lin[0] / lum, lin[1] / lum, lin[2] / lum];
}

export const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

/**
 * Light profiles. `I0` is the peak intensity in candela.
 *
 * BR30 65 W incandescent flood (the 1990s recessed-can lamp): about 650 lm,
 * beam angle about 105° (typical manufacturer data; an assumption, not one
 * specific product). Modelled as I(θ) = I0·cos^n θ with the half-intensity
 * angle at 52.5° → n ≈ 1.4; total flux of cos^n over the lower hemisphere is
 * 2π·I0/(n+1) → I0 ≈ 650·2.4/2π ≈ 248 cd.
 * In a 6" recessed can the housing cuts the beam off at ~50° from straight
 * down (that edge is the scallop on nearby walls) and absorbs ~15%.
 * The lamp is not a point: a 3.75" BR30 sitting in a 6" can is cut off by the
 * rim gradually, giving the scallop's top edge a penumbra of roughly ±12°.
 * The can's reflector also spills a little light past the cutoff (~6%).
 */
export const BR30_65W = { lumens: 650, n: 1.4, cutoffDeg: 50, softDeg: 12, spill: 0.06, efficiency: 0.85 };

/** Peak candela of a cos^n emitter (lower hemisphere) given its total lumens. */
export const cosNPeak = (lumens: number, n: number) => (lumens * (n + 1)) / (2 * Math.PI);
