/**
 * How Source lights props that aren't baked per vertex (prop_dynamic,
 * prop_physics, anything on a mover), at run time, from where they are now:
 *  - an ambient cube (six colours, one per axis direction) at the prop's
 *    lighting origin (its bounds' centre): VRAD's leaf ambient samples in
 *    the BSP leaf there, weighted 1/(d² + 1) (leaf_ambient_lighting.cpp
 *    Mod_LeafAmbientColorAtPos). They hold bounced light only;
 *  - the world lights that can see the lighting origin: the strongest four
 *    are lit per vertex (Lambert, the light's own falloff and cone), the rest
 *    are folded into the ambient cube along their direction.
 * Per vertex: Σ n_k² · cube[sign n_k] + Σ local lights.
 */
import type { Axis } from './faces';
import { gatherSample, type Occluder, type SourceLight } from './vrad';
import type { PropInstance, PropModelData } from './vradProps';

/** VRAD's leaf ambient samples and the BSP tree to find a point's leaf (tools/source/valve-lightmap.ts ambientData). */
export class AmbientTree {
  private nodes: Float32Array;
  private leaves: Float32Array;
  private samples: Float32Array;
  private head: number;

  constructor(data: Float32Array) {
    const [nNodes, nLeaves, nSamples, head] = data;
    let o = 4;
    this.nodes = data.subarray(o, o += nNodes * 6);
    this.leaves = data.subarray(o, o += nLeaves * 2);
    this.samples = data.subarray(o, o + nSamples * 21);
    this.head = head;
  }

  leaf(p: Axis): number {
    let n = this.head;
    while (n >= 0) {
      const o = n * 6, N = this.nodes;
      n = N[o] * p[0] + N[o + 1] * p[1] + N[o + 2] * p[2] - N[o + 3] >= 0 ? N[o + 4] : N[o + 5];
    }
    return -1 - n;
  }

  /** The six colours at p (+x −x +y −y +z −z, rgb each). */
  cube(p: Axis, out: Float32Array = new Float32Array(18)): Float32Array {
    out.fill(0);
    const l = this.leaf(p), first = this.leaves[l * 2], count = this.leaves[l * 2 + 1];
    let total = 0;
    for (let i = first; i < first + count; i++) {
      const o = i * 21, S = this.samples;
      const d2 = (S[o] - p[0]) ** 2 + (S[o + 1] - p[1]) ** 2 + (S[o + 2] - p[2]) ** 2;
      const w = 1 / (d2 + 1);
      total += w;
      for (let k = 0; k < 18; k++) out[k] += S[o + 3 + k] * w;
    }
    if (total > 0) for (let k = 0; k < 18; k++) out[k] /= total;
    return out;
  }
}

const BOX: Axis[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const MODEL_LIGHTS = 4; // r_worldlights

/**
 * Light the chosen instances (`which`) the run-time way, writing linear light
 * (÷255 units, like the lightmaps) into `colors` at each instance's offset.
 */
export function lightModelsRuntime(models: PropModelData[], instances: PropInstance[], which: Iterable<number>, offsets: Int32Array,
  colors: Float32Array, lights: SourceLight[], ambient: (p: Axis, out: Float32Array) => Float32Array, vis: Occluder, debug?: Map<number, unknown>): void {
  const cube = new Float32Array(18);
  const nrm: Axis[] = [[0, 0, 1]];
  const dots = [0];
  for (const ii of which) {
    const inst = instances[ii], m = models[inst.model], e = inst.matrix;
    const nv = m.positions.length / 3;
    // Lighting origin: the centre of the world-space bounds.
    const lo: Axis = [Infinity, Infinity, Infinity], hi: Axis = [-Infinity, -Infinity, -Infinity];
    const wp = new Float64Array(nv * 3);
    for (let v = 0; v < nv; v++) {
      const x = m.positions[v * 3], y = m.positions[v * 3 + 1], z = m.positions[v * 3 + 2];
      for (let k = 0; k < 3; k++) {
        const q = e[k] * x + e[4 + k] * y + e[8 + k] * z + e[12 + k];
        wp[v * 3 + k] = q; lo[k] = Math.min(lo[k], q); hi[k] = Math.max(hi[k], q);
      }
    }
    const c: Axis = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    ambient(c, cube);
    // World lights that reach and see the lighting origin, strongest first.
    const seen: { l: SourceLight; s: number; dir: Axis }[] = [];
    for (const l of lights) {
      if (l.style) continue;
      const dx = l.origin[0] - c[0], dy = l.origin[1] - c[1], dz = l.origin[2] - c[2], d = Math.hypot(dx, dy, dz) || 1;
      nrm[0] = [dx / d, dy / d, dz / d];
      const f = gatherSample(l, c[0], c[1], c[2], nrm, dots, null);
      if (f <= 0) continue;
      if (vis.occluded(c[0], c[1], c[2], l.origin[0], l.origin[1], l.origin[2])) continue;
      seen.push({ l, s: f * Math.max(l.intensity[0], l.intensity[1], l.intensity[2]) / 255, dir: nrm[0] });
    }
    seen.sort((a, b) => b.s - a.s);
    if (debug) debug.set(ii, { origin: c, cube: Array.from(cube), lights: seen.length, strongest: seen.slice(0, 6).map((x) => [x.l.origin, +x.s.toFixed(4)]), blocked: lights.length - seen.length });
    const local = seen.slice(0, MODEL_LIGHTS).map((x) => x.l);
    for (const x of seen.slice(MODEL_LIGHTS)) {
      const k = x.s / Math.max(x.l.intensity[0], x.l.intensity[1], x.l.intensity[2]);
      BOX.forEach((b, side) => {
        const t = b[0] * x.dir[0] + b[1] * x.dir[1] + b[2] * x.dir[2];
        if (t > 0) for (let ch = 0; ch < 3; ch++) cube[side * 3 + ch] += x.l.intensity[ch] * k * t;
      });
    }
    const base = offsets[ii];
    for (let v = 0; v < nv; v++) {
      const nx0 = m.normals[v * 3], ny0 = m.normals[v * 3 + 1], nz0 = m.normals[v * 3 + 2];
      let nx = e[0] * nx0 + e[4] * ny0 + e[8] * nz0, ny = e[1] * nx0 + e[5] * ny0 + e[9] * nz0, nz = e[2] * nx0 + e[6] * ny0 + e[10] * nz0;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const sx = nx >= 0 ? 0 : 1, sy = ny >= 0 ? 2 : 3, sz = nz >= 0 ? 4 : 5;
      let r = 0, g = 0, b = 0;
      for (const [w, side] of [[nx * nx, sx], [ny * ny, sy], [nz * nz, sz]] as const) {
        r += w * cube[side * 3]; g += w * cube[side * 3 + 1]; b += w * cube[side * 3 + 2];
      }
      nrm[0] = [nx, ny, nz];
      for (const l of local) {
        const f = gatherSample(l, wp[v * 3], wp[v * 3 + 1], wp[v * 3 + 2], nrm, dots, null);
        if (f <= 0) continue;
        const w = f * dots[0] / 255;
        r += w * l.intensity[0]; g += w * l.intensity[1]; b += w * l.intensity[2];
      }
      colors[(base + v) * 3] = r; colors[(base + v) * 3 + 1] = g; colors[(base + v) * 3 + 2] = b;
    }
  }
}
