/**
 * VRAD's per-vertex lighting of static props (vradstaticprops.cpp
 * ComputeLighting; vraddetailprops.cpp ComputeIndirectLightingAtPoint), which
 * Portal 2 ships in each map (.vhv): for every vertex of every prop,
 *  - direct: every unstyled light, sampled 4 units towards the light from
 *    the vertex, with the vertex normal (GatherSampleLight);
 *  - indirect: the same 40 directions for every vertex (a Halton sequence over
 *    the sphere; those behind the normal skipped), each reading the final
 *    lightmap where it hits × that surface's reflectivity × 1/(1 + (d/128)²),
 *    summed and divided by the sum of the cosines.
 * Vertices inside solids take the light of the nearest vertex that isn't
 * (VRAD crawls towards it).
 * Rays and shadow tests are shared by vertices within 2 units of each other
 * (models repeat a position once per UV seam and face).
 */
import type { Axis } from './faces';
import type { SolidGrid } from './bake';
import { gatherSample, type SourceLight, type RGB, type Occluder } from './vrad';

export interface PropModelData {
  /** Model-space positions and normals, xyz per vertex. */
  positions: Float32Array;
  normals: Float32Array;
}

export interface PropInstance {
  model: number;
  /** Column-major 4×4 world matrix (three.js Matrix4.elements). */
  matrix: number[];
}

/** Where a ray hit: Source light at that point of the final lightmap (÷255 units) and the surface's reflectivity, or null. */
export type LightmapProbe = (faceId: number, x: number, y: number, z: number) => { light: RGB; reflectivity: RGB } | null;

/** mathlib DirectionalSampler_t: Halton(2) for z, Halton(3) for the angle; the generator's seed is advanced before use. */
export function directionalSamples(n: number): Axis[] {
  const halton = (seed: number, base: number) => { let r = 0, f = 1 / base, s = seed; while (s) { r += (s % base) * f; f /= base; s = Math.floor(s / base); } return r; };
  const out: Axis[] = [];
  for (let i = 0; i < n; i++) {
    const z = 2 * halton(i + 2, 2) - 1;
    const phi = Math.acos(z), theta = 2 * Math.PI * halton(i + 2, 3), sp = Math.sin(phi);
    out.push([Math.cos(theta) * sp, Math.sin(theta) * sp, z]);
  }
  return out;
}

const NUM_SAMPLES = 162 / 4; // NUMVERTEXNORMALS / 4 (force_fast)
const MAX_TRACE = 1.732050807569 * 32768;

export function lightProps(models: PropModelData[], instances: PropInstance[], lights: SourceLight[], grid: SolidGrid, probe: LightmapProbe, onProgress?: (done: number) => void, shadows: Occluder = grid): { colors: Float32Array; offsets: Int32Array } {
  const dirs = directionalSamples(Math.floor(NUM_SAMPLES));
  const unstyled = lights.filter((l) => !l.style);
  const offsets = new Int32Array(instances.length + 1);
  instances.forEach((inst, i) => { offsets[i + 1] = offsets[i] + models[inst.model].positions.length / 3; });
  const colors = new Float32Array(offsets[instances.length] * 3);
  const dots = [0];
  const nrm: Axis[] = [[0, 0, 1]];
  const vis = new Map<number, Uint8Array>();
  for (let ii = 0; ii < instances.length; ii++) {
    const inst = instances[ii], m = models[inst.model], e = inst.matrix;
    const nv = m.positions.length / 3;
    const wp = new Float64Array(nv * 3), wn = new Float64Array(nv * 3);
    const lo: Axis = [Infinity, Infinity, Infinity], hi: Axis = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < nv; v++) {
      const x = m.positions[v * 3], y = m.positions[v * 3 + 1], z = m.positions[v * 3 + 2];
      for (let k = 0; k < 3; k++) {
        const p = e[k] * x + e[4 + k] * y + e[8 + k] * z + e[12 + k];
        wp[v * 3 + k] = p; lo[k] = Math.min(lo[k], p); hi[k] = Math.max(hi[k], p);
      }
      const nx = m.normals[v * 3], ny = m.normals[v * 3 + 1], nz = m.normals[v * 3 + 2];
      let a = e[0] * nx + e[4] * ny + e[8] * nz, b = e[1] * nx + e[5] * ny + e[9] * nz, c = e[2] * nx + e[6] * ny + e[10] * nz;
      const l = Math.hypot(a, b, c) || 1; a /= l; b /= l; c /= l;
      wn[v * 3] = a; wn[v * 3 + 1] = b; wn[v * 3 + 2] = c;
    }
    // Lights that can reach the prop at all.
    const cand = unstyled.filter((dl) => {
      if (!(dl.endFade > dl.startFade)) return true;
      let d2 = 0;
      for (let k = 0; k < 3; k++) { const t = dl.origin[k] < lo[k] ? lo[k] - dl.origin[k] : dl.origin[k] > hi[k] ? dl.origin[k] - hi[k] : 0; d2 += t * t; }
      return d2 <= (dl.endFade + 4) ** 2;
    });
    // Per 2-unit cell: in a solid?, each light's visibility, and each direction's indirect light.
    vis.clear();
    const cells = new Map<string, { solid: boolean; lit: Uint8Array; ind: Float32Array }>();
    const cellOf = (v: number) => {
      const key = `${Math.round(wp[v * 3] / 2)},${Math.round(wp[v * 3 + 1] / 2)},${Math.round(wp[v * 3 + 2] / 2)}`;
      let c = cells.get(key);
      if (c) return c;
      const x = wp[v * 3], y = wp[v * 3 + 1], z = wp[v * 3 + 2];
      const solid = grid.inside([x, y, z]);
      const lit = new Uint8Array(cand.length);
      const ind = new Float32Array(dirs.length * 3);
      if (!solid) {
        cand.forEach((dl, li) => {
          const dx = dl.origin[0] - x, dy = dl.origin[1] - y, dz = dl.origin[2] - z, d = Math.hypot(dx, dy, dz) || 1;
          const px = x + dx / d * 4, py = y + dy / d * 4, pz = z + dz / d * 4;
          lit[li] = shadows.occluded(px, py, pz, dl.origin[0], dl.origin[1], dl.origin[2]) ? 0 : 1;   // props shadow props too (and themselves)
        });
        dirs.forEach((d, k) => {
          const hit = grid.cast(x, y, z, d[0] * MAX_TRACE, d[1] * MAX_TRACE, d[2] * MAX_TRACE);
          if (!hit) return;
          const t = hit.t * MAX_TRACE;
          const s = probe(hit.faceId, x + d[0] * t, y + d[1] * t, z + d[2] * t);
          if (!s) return;
          const f = 1 / (1 + (t / 128) * (t / 128));
          ind[k * 3] = s.light[0] * s.reflectivity[0] * f; ind[k * 3 + 1] = s.light[1] * s.reflectivity[1] * f; ind[k * 3 + 2] = s.light[2] * s.reflectivity[2] * f;
        });
      }
      c = { solid, lit, ind };
      cells.set(key, c);
      return c;
    };
    const base = offsets[ii];
    const valid = new Uint8Array(nv);
    for (let v = 0; v < nv; v++) {
      const c = cellOf(v);
      if (c.solid) continue;
      valid[v] = 1;
      const x = wp[v * 3], y = wp[v * 3 + 1], z = wp[v * 3 + 2];
      nrm[0] = [wn[v * 3], wn[v * 3 + 1], wn[v * 3 + 2]];
      let r = 0, g = 0, b = 0;
      cand.forEach((dl, li) => {
        if (!c.lit[li]) return;
        const dx = dl.origin[0] - x, dy = dl.origin[1] - y, dz = dl.origin[2] - z, d = Math.hypot(dx, dy, dz) || 1;
        const fo = gatherSample(dl, x + dx / d * 4, y + dy / d * 4, z + dz / d * 4, nrm, dots, null);
        if (fo <= 0) return;
        const w = fo * dots[0];
        r += w * dl.intensity[0]; g += w * dl.intensity[1]; b += w * dl.intensity[2];
      });
      // Direct light is in VRAD units (0..255 scale); the lightmap probes are already ÷255.
      r /= 255; g /= 255; b /= 255;
      let ir = 0, ig = 0, ib = 0, total = 0;
      for (let k = 0; k < dirs.length; k++) {
        const dd = dirs[k][0] * nrm[0][0] + dirs[k][1] * nrm[0][1] + dirs[k][2] * nrm[0][2];
        if (dd <= 0.001) continue;
        total += dd;
        ir += c.ind[k * 3]; ig += c.ind[k * 3 + 1]; ib += c.ind[k * 3 + 2];
      }
      if (total > 0) { r += ir / total; g += ig / total; b += ib / total; }
      colors[(base + v) * 3] = r; colors[(base + v) * 3 + 1] = g; colors[(base + v) * 3 + 2] = b;
    }
    // Vertices inside solids: the nearest lit vertex's light.
    for (let v = 0; v < nv; v++) {
      if (valid[v]) continue;
      let best = -1, bd = Infinity;
      for (let u = 0; u < nv; u++) {
        if (!valid[u]) continue;
        const d = (wp[u * 3] - wp[v * 3]) ** 2 + (wp[u * 3 + 1] - wp[v * 3 + 1]) ** 2 + (wp[u * 3 + 2] - wp[v * 3 + 2]) ** 2;
        if (d < bd) { bd = d; best = u; }
      }
      if (best >= 0) for (let k = 0; k < 3; k++) colors[(base + v) * 3 + k] = colors[(base + best) * 3 + k];
    }
    onProgress?.(ii + 1);
  }
  return { colors, offsets };
}
