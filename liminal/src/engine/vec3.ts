/**
 * Minimal mutable 3-vector for physics. Z is up (Hammer/Source convention):
 * the whole engine, and the map format, use x/y as the floor plane and z as height.
 *
 * Kept free of three.js so collision and movement can run headless (tests,
 * future dedicated tools) without a renderer.
 */
export interface Vec3 { x: number; y: number; z: number }

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const copy = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const set = (o: Vec3, a: Vec3): Vec3 => { o.x = a.x; o.y = a.y; o.z = a.z; return o; };
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
/** a + b * s */
export const madd = (a: Vec3, b: Vec3, s: number): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const len2d = (a: Vec3): number => Math.hypot(a.x, a.y);
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});
export const normalize = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : v3();
};

/**
 * Source-style view angles in degrees: pitch (positive = looking down), yaw
 * (0 = +x, 90 = +y). Returns forward/right/up basis vectors.
 */
export function angleVectors(pitchDeg: number, yawDeg: number): { forward: Vec3; right: Vec3; up: Vec3 } {
  const p = (pitchDeg * Math.PI) / 180;
  const y = (yawDeg * Math.PI) / 180;
  const cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y);
  const forward = v3(cp * cy, cp * sy, -sp);
  const right = v3(sy, -cy, 0);
  const up = cross(right, forward);
  return { forward, right, up };
}
