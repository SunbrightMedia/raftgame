/**
 * What every rebuild of a frame of the reference capture shares (reference/complex/FINDINGS.md).
 * Nothing here is fitted to one frame: per-frame scripts only add the room (measured with
 * tools/recreate/measure.py) and the lamps.
 *
 * Units: the game's lamps are about 1 candela ("10000" in its light constants, which carry
 * cd × 100² for its centimetres) and its exposure is a fixed 34.13. Our baker drops light below
 * 0.02 lux, so every light here is 1000× the game's and the exposure 1000× smaller: the same
 * picture, in the engine's usual range.
 */
import type { MapBuilder } from '../lib/build';

export const PAINT = 'cx/paint_yellow', CARPET = 'cx/carpet', CEIL = 'cx/ceiling', PANEL = 'cx/ledpanel', CLOTH = 'cx/cloth', TAPE = 'cx/tape', PANEL_OFF = 'cx/panel_off';
/** Our light units per game unit (see above). */
export const K = 1000;
/** The game's fixed exposure, in our units. */
export const EXPOSURE = 34.13 / K;
/** The lamp colour of the capture's light constants: (1, 0.871, 0.386) linear. */
export const LAMP_COLOR = '#fff0a7';
/** Luminance of a lamp whose constants read (10000, 8713.67, 3864.29): red 1 cd, so 0.8635 cd. */
export const LAMP_CD = 0.2126 + 0.7152 * 0.871367 + 0.0722 * 0.386429;
/** Our player's eye height (move.eyeHeight default): a pose's z is the feet, so feet = eye - this. */
export const EYE = 48;

/**
 * A ceiling panel (dim emitter, cx/ledpanel) with its lamp: an unshadowed downward spot, 87° cone.
 * `red` is the lamp's red constant / 10000 (1 for the usual lamp); `lampAt` puts the lamp elsewhere
 * than the panel's centre (where the capture's constants say).
 */
export function panel(m: MapBuilder, x: number, y: number, zCeil: number, opts: { size?: number; red?: number; drop?: number; lampAt?: [number, number] } = {}): void {
  const s = opts.size ?? 36, h = s / 2;
  m.box([x - h, y - h, zCeil - 0.25], [x + h, y + h, zCeil], CEIL, { faces: { nz: { tex: PANEL } } });
  // The game's lamps hang 8 cm (3.1") under the ceiling.
  const [lx, ly] = opts.lampAt ?? [x, y];
  m.light([lx, ly, zCeil - (opts.drop ?? 3.1)], { type: 'spot', candela: (opts.red ?? 1) * LAMP_CD * K, color: LAMP_COLOR, n: 2.2, cutoff: 87, shadows: 0 });
}

/** Settings of a rebuilt frame: the game's camera, exposure and light model. */
export function settings(): Record<string, Record<string, unknown>> {
  return {
    camera: { model: 'camcorder', flash: false },
    view: { fov: 98.2, viewBob: 0 },
    render: { internalHeight: 756 },
    fog: { enabled: false },
    camcorder: { exposure: EXPOSURE },
    // Physical bounce (the engine's default): in the hall of frames 18325/18829/19259 the game's
    // bounce is floor 0.18, walls 0.30, ceiling 0.35 (× albedo); this gives 0.21 / 0.22 / 0.32.
    light: { bounceEven: 0, bounces: 2, extraBounces: 1 },
  };
}
