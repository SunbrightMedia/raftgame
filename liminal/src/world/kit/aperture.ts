import models from './apertureModels.json';
import type { MapOut, V3 } from '../mapOut';

/**
 * The modern Aperture "behind the scenes" kit (Portal 2's props_bts family)
 * as building blocks: how each piece sits on its origin and how pieces join.
 * Sizes come from the models themselves (apertureModels.json, written by
 * tools/world/kit_data.py); the joining rules below were measured from the
 * pieces' collision shapes.
 *
 * Walkways live on a 128-unit grid: a tile is one 128 × 128 cell at a floor
 * height, open towards some of its four neighbours. The kit has a piece for
 * every combination (straight, L, T, X, dead end). The deck is 80 wide with
 * 54-high railings; a model's origin is the centre of its deck's top.
 */
export const MODELS = models as Record<string, { min: number[]; max: number[]; solid: number }>;
export const TILE = 128;
/** Stairs climb one STEP (hanging_stair_128: 128 up over two tiles). */
export const STEP = 128;

/** Compass directions as grid steps: 0 = +x (east), 1 = +y (north), 2 = −x, 3 = −y. */
export type Dir = 0 | 1 | 2 | 3;
export const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
export const opposite = (d: Dir): Dir => ((d + 2) % 4) as Dir;
/** Yaw that turns a piece's own +y (the way kit pieces run) to face `d`. */
const yawOf = (d: Dir) => d * 90 - 90;

// Light colours Valve types into Portal 2's lamps (sp_a3_speed_ramp and the fog/light survey in docs/P2_STUDY.md).
export const WARM: V3 = [250, 230, 170], WHITE: V3 = [255, 245, 215], COOL: V3 = [183, 204, 218], RED: V3 = [181, 67, 34];

/** A walkway tile: which neighbours it opens to (bit d set = open towards Dir d). */
export function walkTile(m: MapOut, c: V3, mask: number): void {
  const open = ([0, 1, 2, 3] as Dir[]).filter((d) => mask & (1 << d));
  const at = (model: string, yaw: number, along = 0, d: Dir = 0) => m.prop(`props_bts/${model}`, [c[0] + DX[d] * along, c[1] + DY[d] * along, c[2]], [0, yaw, 0]);
  if (open.length === 4) { at('hanging_walkway_x', 0); return; }
  if (open.length === 3) {
    // The T runs along its own y with the branch on +x: the closed side is behind the branch.
    const closed = ([0, 1, 2, 3] as Dir[]).find((d) => !(mask & (1 << d)))!;
    at('hanging_walkway_t', opposite(closed) * 90);
    return;
  }
  if (open.length === 2) {
    const [a, b] = open;
    if (opposite(a) === b) { at('hanging_walkway_128a', yawOf(a)); return; }
    // The L joins its own −y and +x: yaw θ joins directions θ and θ − 90°.
    const th = ((a + 3) % 4 === b ? a : b) as Dir;
    at('hanging_walkway_l', th * 90);
    return;
  }
  if (open.length === 1) {
    // A dead end: deck from the open side, closed by an end piece with its own railing.
    const d = open[0], away = opposite(d);
    at('hanging_walkway_64a', yawOf(away), -32, away);
    at('hanging_walkway_32a', yawOf(away), 16, away);
    at('hanging_walkway_end_a', yawOf(away), 48, away);
  }
}

/**
 * One flight of stairs: from the floor at `foot` (the middle of the bottom
 * edge) up 128 towards `d`, over two tiles.
 */
export function stairs(m: MapOut, foot: V3, d: Dir): void {
  m.prop('props_bts/hanging_stair_128', [foot[0] + DX[d] * TILE, foot[1] + DY[d] * TILE, foot[2] + STEP / 2], [0, yawOf(d), 0]);
}

/** A truss over a span: `length` 512 or 1024, centred on `c`, running along `d`. Its top chord is at c.z + 18. */
export function truss(m: MapOut, c: V3, d: Dir, length: 512 | 1024 = 1024): void {
  m.prop(`props_bts/truss_${length}`, c, [0, yawOf(d), 0]);
}

// ---- placing a piece along any direction

type V = [number, number, number];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * Source angles [pitch, yaw, roll] that turn a model so its own +y points
 * along `y` and its own +z along `z` (the two must be perpendicular).
 * Kit pieces run along their +y, so this aims a piece any way at all.
 */
export function anglesFromYZ(y: V, z: V): V3 {
  const l = unit(y), u = unit(z), f = cross(l, u);   // forward = left × up
  const deg = 180 / Math.PI;
  if (Math.abs(f[2]) > 0.99999) {
    // Looking straight up or down: yaw and roll turn about the same axis; put it all in yaw.
    return [f[2] < 0 ? 90 : -90, Math.atan2(-l[0], l[1]) * deg, 0];
  }
  return [Math.asin(-f[2]) * deg, Math.atan2(f[1], f[0]) * deg, Math.atan2(l[2], u[2]) * deg];
}

/** Any vector square to `d` (up, unless d is itself vertical). */
export const squareTo = (d: V): V => (Math.abs(d[2]) > 0.9 ? [1, 0, 0] : unit(cross(cross(d, [0, 0, 1]), d)));

/** Bend radius of vactube_90deg_02: with it, a tube path whose corners sit on the 128 grid needs only whole straight pieces. */
export const TUBE_BEND = 128;

/**
 * A hollow transport tube along a path of straight legs with right-angle
 * corners (corners on the 128 grid, legs at least 256 long between corners).
 * Returns the number of pieces placed.
 */
export function tubePath(m: MapOut, pts: V3[]): number {
  let count = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const d = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const s0 = i > 0 ? TUBE_BEND : 0, s1 = i < pts.length - 2 ? TUBE_BEND : 0;
    const ang = anglesFromYZ(d, squareTo(d));
    for (let u = s0; u < len - s1 - 1; u += 128) {
      m.prop('props_bts/vactube_128_straight', [a[0] + d[0] * u, a[1] + d[1] * u, a[2] + d[2] * u], ang, { solid: false, hollow: true });
      count++;
    }
    if (i < pts.length - 2) {
      // The corner piece starts along its +y and leaves along its −z.
      const c = pts[i + 2], d2 = unit([c[0] - b[0], c[1] - b[1], c[2] - b[2]]);
      m.prop('props_bts/vactube_90deg_02', [b[0] - d[0] * TUBE_BEND, b[1] - d[1] * TUBE_BEND, b[2] - d[2] * TUBE_BEND], anglesFromYZ(d, [-d2[0], -d2[1], -d2[2]]), { solid: false, hollow: true });
      count++;
    }
  }
  return count;
}

/** A straight hollow tube from a towards b at any angle (whole pieces; the last may overshoot b by under one piece). */
export function tubeLine(m: MapOut, a: V3, b: V3): number {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const d = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  const ang = anglesFromYZ(d, squareTo(d));
  const n = Math.ceil(len / 128);
  for (let i = 0; i < n; i++) m.prop('props_bts/vactube_128_straight', [a[0] + d[0] * 128 * i, a[1] + d[1] * 128 * i, a[2] + d[2] * 128 * i], ang, { solid: false, hollow: true });
  return n;
}
