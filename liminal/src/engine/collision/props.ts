/**
 * Collision for props (placed models): an oriented box from the model's hull,
 * as planes for convexBrush. Plain math, no three.js (runs headless).
 */
import type { EntityDef } from '../../data/map';
import { convexBrush, type CollisionBrush } from './brush';
import { v3 } from '../vec3';

type P3 = [number, number, number];

/** The model a prop entity draws, if any. */
export function propModel(e: EntityDef): string | null {
  return e.class === 'prop' && typeof e.props?.model === 'string' ? e.props.model : null;
}

/** Source AngleMatrix columns (forward, left, up) for (pitch, yaw, roll) in degrees. */
export function sourceAxes(angles: P3 | undefined): [P3, P3, P3] {
  const [p, y, r] = (angles ?? [0, 0, 0]).map((a) => (a * Math.PI) / 180);
  const sp = Math.sin(p), cp = Math.cos(p), sy = Math.sin(y), cy = Math.cos(y), sr = Math.sin(r), cr = Math.cos(r);
  return [
    [cp * cy, cp * sy, -sp],
    [sr * sp * cy - cr * sy, sr * sp * sy + cr * cy, sr * cp],
    [cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp],
  ];
}

/** The hull box [min, max] (model space) placed at origin/angles/scale: planes n·p ≤ d and world bounds. */
export function propBox(origin: P3, angles: P3 | undefined, scale: number, hull: [P3, P3]): { planes: { n: P3; d: number }[]; min: P3; max: P3 } {
  const ax = sourceAxes(angles);
  const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const planes: { n: P3; d: number }[] = [];
  for (let k = 0; k < 3; k++) {
    const a = ax[k];
    planes.push({ n: a, d: dot(a, origin) + scale * hull[1][k] });
    planes.push({ n: [-a[0], -a[1], -a[2]], d: -dot(a, origin) - scale * hull[0][k] });
  }
  const min: P3 = [Infinity, Infinity, Infinity], max: P3 = [-Infinity, -Infinity, -Infinity];
  for (let c = 0; c < 8; c++) {
    const l = [0, 1, 2].map((k) => scale * hull[(c >> k) & 1][k]);
    for (let i = 0; i < 3; i++) {
      const v = origin[i] + ax[0][i] * l[0] + ax[1][i] * l[1] + ax[2][i] * l[2];
      min[i] = Math.min(min[i], v); max[i] = Math.max(max[i], v);
    }
  }
  return { planes, min, max };
}

/**
 * Props block as their hull box. Small physics props (mugs, paper, boxes) are
 * left out: in Source the player shoves them aside rather than standing on them.
 */
export function propSolids(entities: EntityDef[], hullOf: (model: string) => [P3, P3] | undefined): CollisionBrush[] {
  const out: CollisionBrush[] = [];
  for (const e of entities) {
    const name = propModel(e);
    const hull = name ? hullOf(name) : undefined;
    if (!hull || e.props?.solid === false) continue;
    const size = Math.max(...[0, 1, 2].map((k) => hull[1][k] - hull[0][k]));
    if (String(e.props?.source_class ?? '').startsWith('prop_physics') && size < 16) continue;
    const scale = typeof e.props?.scale === 'number' ? e.props.scale : 1;
    const box = propBox(e.origin, e.angles, scale, hull);
    out.push(convexBrush(e.id, box.planes.map((p) => ({ n: v3(...p.n), d: p.d })), v3(...box.min), v3(...box.max), 'prop'));
  }
  return out;
}
