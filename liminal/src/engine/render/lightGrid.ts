import * as THREE from 'three';

/**
 * Lamps without a bake, for worlds made in the page: thousands of small
 * lights, each worked out per pixel, with no shadows.
 *
 * The world is cut into cells (128 × 128 × 256 units); each cell holds the
 * (up to eight) lamps that matter most there. A pixel looks up its cell and
 * adds those lamps: brightness falls with distance to nothing at the lamp's
 * reach, by the angle the light arrives at, and inside a spot's cone.
 *
 * With no shadows a lamp would shine through walls and floors, so each lamp
 * can be shut in a box (the corridor, room or shaft it hangs in) and lights
 * nothing outside it (its light fades out over the last few units); and a lamp out in the open does not reach cells that
 * lie wholly inside a "shade" box (a mass with rooms in it).
 *
 * Light here is irradiance in the renderer's flat-light units: 300 = a
 * surface fully lit (Source's "1.0").
 */
export interface GridLamp {
  pos: [number, number, number];
  /** Irradiance on a surface facing the lamp, right at it (linear r, g, b). */
  color: [number, number, number];
  /** The distance at which that has halved, and the distance past which the lamp gives nothing. */
  size: number; reach: number;
  /** A spot: its axis, and the angles (degrees from the axis) where it is full and where it ends. */
  dir?: [number, number, number]; inner?: number; cone?: number;
  /** It lights only what lies inside this box. */
  box?: { min: number[]; max: number[] };
  /** It hangs in the open: it does not light the inside of shade boxes. */
  open?: boolean;
}
export interface Box3 { min: number[]; max: number[] }

const CELL = [128, 128, 256];
const PER_CELL = 8;
/** How far past its box a shut-in lamp's light fades out (the box is first grown by 3 to take in its own walls). */
const EDGE = 24;

export const lightGridUniforms = {
  lgOn: { value: 0 },
  lgLamps: { value: null as THREE.DataTexture | null },
  lgCells: { value: null as THREE.DataTexture | null },
  lgOrigin: { value: new THREE.Vector3() },
  lgCell: { value: new THREE.Vector3(...CELL) },
  lgDims: { value: new THREE.Vector3(1, 1, 1) },
  /** Light from everywhere (irradiance), and how much more of it comes from above than from below (0..1). */
  lgAmbient: { value: new THREE.Vector3(12, 14, 16) },
  lgAmbientUp: { value: 0.35 },
  lgScale: { value: 1 },
};

/** Fragment-shader declarations: gridLight(world position, normal) = the irradiance there from the lamps and the ambient. */
export const LIGHT_GRID_PARS = /* glsl */ `
  uniform float lgOn;
  uniform sampler2D lgLamps;
  uniform sampler2D lgCells;
  uniform vec3 lgOrigin;
  uniform vec3 lgCell;
  uniform vec3 lgDims;
  uniform vec3 lgAmbient;
  uniform float lgAmbientUp;
  uniform float lgScale;
  vec3 gridLight(vec3 wp, vec3 n) {
    vec3 E = lgAmbient * (1.0 + lgAmbientUp * n.z);
    // Read the cell just off the surface, on the side it faces.
    ivec3 ci = ivec3(floor((wp + n * 2.0 - lgOrigin) / lgCell));
    ivec3 dims = ivec3(lgDims);
    if (any(lessThan(ci, ivec3(0))) || any(greaterThanEqual(ci, dims))) return E;
    for (int k = 0; k < 2; k++) {
      vec4 idx = texelFetch(lgCells, ivec2(ci.x * 2 + k, ci.y + ci.z * dims.y), 0);
      for (int q = 0; q < 4; q++) {
        if (idx[q] < 0.0) return E;   // the list ends at the first empty place
        int i = int(idx[q]);
        ivec2 at = ivec2((i & 255) * 5, i >> 8);        // lamps lie 256 to a row, five texels each
        vec4 a = texelFetch(lgLamps, at, 0);            // place, reach
        vec3 to = a.xyz - wp;
        float d2 = dot(to, to), r2 = a.w * a.w;
        if (d2 >= r2) continue;
        vec4 lo = texelFetch(lgLamps, at + ivec2(3, 0), 0);  // box min, spot inner cosine
        vec4 hi = texelFetch(lgLamps, at + ivec2(4, 0), 0);  // box max, 1 = has a box
        // A lamp shut in a box lights nothing outside it; its light fades out over the last few units, so the
        // edge of the box (at a doorway, say) is not a hard line on the floor.
        float shut = 1.0;
        if (hi.w > 0.5) {
          vec3 past = max(max(lo.xyz - wp, wp - hi.xyz), 0.0);
          float o = max(past.x, max(past.y, past.z));
          if (o >= 20.0) continue;
          shut = 1.0 - smoothstep(0.0, 20.0, o);
        }
        vec4 b = texelFetch(lgLamps, at + ivec2(1, 0), 0);   // colour, size
        vec4 c = texelFetch(lgLamps, at + ivec2(2, 0), 0);   // spot axis, cone cosine (−2 = not a spot)
        vec3 l = to * inversesqrt(max(d2, 1.0e-4));
        // A little wrap round the edge, standing in for the light a real room bounces back.
        float lam = clamp((dot(n, l) + 0.25) / 1.25, 0.0, 1.0);
        float win = 1.0 - d2 / r2;
        float att = win * win / (1.0 + d2 / (b.w * b.w));
        if (c.w > -1.5) att *= smoothstep(c.w, lo.w, dot(-l, c.xyz));
        E += b.rgb * (att * lam * shut);
      }
    }
    return E * lgScale;
  }`;

/**
 * Builds the grid from a map's lamps and sets the uniforms. `shades`: boxes
 * whose insides lamps in the open do not light. With no lamps the grid is off.
 */
export function setLightGrid(lamps: GridLamp[], shades: Box3[] = []): { lamps: number; cells: number; full: number } {
  const u = lightGridUniforms;
  u.lgLamps.value?.dispose();
  u.lgCells.value?.dispose();
  u.lgLamps.value = null;
  u.lgCells.value = null;
  u.lgOn.value = 0;
  if (!lamps.length) return { lamps: 0, cells: 0, full: 0 };

  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const l of lamps) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], Math.max(l.pos[k] - l.reach, l.box ? l.box.min[k] - EDGE : -Infinity));
    hi[k] = Math.max(hi[k], Math.min(l.pos[k] + l.reach, l.box ? l.box.max[k] + EDGE : Infinity));
  }
  const origin = lo.map((v, k) => Math.floor(v / CELL[k]) * CELL[k]);
  const dims = hi.map((v, k) => Math.max(1, Math.min(k === 2 ? 64 : 512, Math.ceil((v - origin[k]) / CELL[k]))));
  const [nx, ny, nz] = dims;
  const at = (x: number, y: number, z: number) => (z * ny + y) * nx + x;

  // Cells wholly inside a shade box.
  const shaded = new Uint8Array(nx * ny * nz);
  for (const s of shades) {
    const a = s.min.map((v, k) => Math.max(0, Math.ceil((v - origin[k]) / CELL[k]))), b = s.max.map((v, k) => Math.min(dims[k], Math.floor((v - origin[k]) / CELL[k])));
    for (let z = a[2]; z < b[2]; z++) for (let y = a[1]; y < b[1]; y++) for (let x = a[0]; x < b[0]; x++) shaded[at(x, y, z)] = 1;
  }

  // Each cell's lamps, with how much each gives at the cell's nearest point: the strongest eight stay.
  const picks = new Map<number, { i: number; score: number }[]>();
  lamps.forEach((l, i) => {
    const a = [0, 1, 2].map((k) => Math.max(0, Math.floor((Math.max(l.pos[k] - l.reach, l.box ? l.box.min[k] - EDGE : -Infinity) - origin[k]) / CELL[k])));
    const b = [0, 1, 2].map((k) => Math.min(dims[k] - 1, Math.floor((Math.min(l.pos[k] + l.reach, l.box ? l.box.max[k] + EDGE : Infinity) - origin[k]) / CELL[k])));
    const power = Math.max(l.color[0], l.color[1], l.color[2]);
    for (let z = a[2]; z <= b[2]; z++) for (let y = a[1]; y <= b[1]; y++) for (let x = a[0]; x <= b[0]; x++) {
      const c = at(x, y, z);
      if (l.open && shaded[c]) continue;
      // The cell's nearest point to the lamp.
      let d2 = 0;
      const cell = [x, y, z];
      for (let k = 0; k < 3; k++) { const c0 = origin[k] + cell[k] * CELL[k], p = Math.max(c0, Math.min(l.pos[k], c0 + CELL[k])); d2 += (p - l.pos[k]) ** 2; }
      const r2 = l.reach * l.reach;
      if (d2 >= r2) continue;
      const win = 1 - d2 / r2;
      const list = picks.get(c);
      const pick = { i, score: (power * win * win) / (1 + d2 / (l.size * l.size)) };
      if (list) list.push(pick); else picks.set(c, [pick]);
    }
  });
  const cells = new Float32Array(nx * 2 * ny * nz * 4).fill(-1);
  let full = 0;
  for (const [c, list] of picks) {
    if (list.length > PER_CELL) { list.sort((p, q) => q.score - p.score); full++; }
    const x = c % nx, row = (c - x) / nx;
    for (let n = 0; n < Math.min(PER_CELL, list.length); n++) cells[(row * nx * 2 + x * 2) * 4 + n] = list[n].i;
  }
  const rows = Math.ceil(lamps.length / 256);
  const data = new Float32Array(rows * 256 * 5 * 4);
  lamps.forEach((l, i) => {
    const o = i * 20;
    data.set([l.pos[0], l.pos[1], l.pos[2], l.reach, l.color[0], l.color[1], l.color[2], l.size], o);
    const spot = l.dir && l.cone !== undefined;
    const n = spot ? Math.hypot(...l.dir!) || 1 : 1;
    data.set(spot ? [l.dir![0] / n, l.dir![1] / n, l.dir![2] / n, Math.cos((l.cone! * Math.PI) / 180)] : [0, 0, -1, -2], o + 8);
    const inner = spot ? Math.cos(((l.inner ?? l.cone! * 0.5) * Math.PI) / 180) : 1;
    // The box, grown a little so the surfaces that bound it are inside.
    data.set(l.box ? [l.box.min[0] - 3, l.box.min[1] - 3, l.box.min[2] - 3, inner, l.box.max[0] + 3, l.box.max[1] + 3, l.box.max[2] + 3, 1] : [0, 0, 0, inner, 0, 0, 0, 0], o + 12);
  });
  const tex = (d: Float32Array, w: number, h: number) => {
    const t = new THREE.DataTexture(d, w, h, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  u.lgLamps.value = tex(data, 256 * 5, rows);
  u.lgCells.value = tex(cells, nx * 2, ny * nz);
  u.lgOrigin.value.set(origin[0], origin[1], origin[2]);
  u.lgDims.value.set(nx, ny, nz);
  u.lgOn.value = 1;
  return { lamps: lamps.length, cells: picks.size, full };
}
