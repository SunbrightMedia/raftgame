import * as THREE from 'three';
import { buildLightGrid, CELL, CHAIN_W, LAMP_ROW, LAMP_TEXELS, LIST_W, MAX_CHAIN, MAX_PER_CELL, SOFT, type Box3, type GridLamp, type LightGrid } from './lightGridCore';

export type { GridLamp, Box3 } from './lightGridCore';

/**
 * Lamps without a bake, for worlds made in the page: thousands of small
 * lights, each worked out per pixel. This file is the part on the graphics
 * card; how the lamps are sorted, and how they get shadows with no shadow
 * maps, is in lightGridCore.ts.
 *
 * The world is cut into cells (128 × 128 × 256 units); each cell lists the
 * lamps that can light something in it. A pixel looks up its cell and adds
 * those lamps: brightness falls with distance to nothing at the lamp's reach,
 * by the angle the light arrives at, and inside a spot's cone. A lamp inside
 * a mass is tested against the boxes of air between it and the pixel.
 */
export const lightGridUniforms = {
  lgOn: { value: 0 },
  lgGrid: { value: null as THREE.DataTexture | null },
  lgList: { value: null as THREE.DataTexture | null },
  lgLamps: { value: null as THREE.DataTexture | null },
  lgChains: { value: null as THREE.DataTexture | null },
  lgOrigin: { value: new THREE.Vector3() },
  lgCell: { value: new THREE.Vector3(...CELL) },
  lgDims: { value: new THREE.Vector3(1, 1, 1) },
  /** Light from everywhere (irradiance), and how much more of it comes from above than from below (0..1). */
  lgAmbient: { value: new THREE.Vector3(12, 14, 16) },
  lgAmbientUp: { value: 0.35 },
  lgScale: { value: 1 },
};

/** The grid now in use (null = none): tools read the light at a point from it (lightGridCore.gridLightAt). */
export let lightGridNow: LightGrid | null = null;

const row = (w: number) => `ivec2(i % ${w}, i / ${w})`;

/** Fragment-shader declarations: gridLight(world position, normal) = the irradiance there from the lamps and the ambient. */
export const LIGHT_GRID_PARS = /* glsl */ `
  uniform float lgOn;
  uniform highp sampler2D lgGrid;
  uniform highp sampler2D lgList;
  uniform highp sampler2D lgLamps;
  uniform highp sampler2D lgChains;
  uniform vec3 lgOrigin;
  uniform vec3 lgCell;
  uniform vec3 lgDims;
  uniform vec3 lgAmbient;
  uniform float lgAmbientUp;
  uniform float lgScale;
  vec4 lgChainTexel(int i) { return texelFetch(lgChains, ${row(CHAIN_W)}, 0); }
  // How much of a lamp's light gets from L to P through the chain of boxes of air that begins at texel \`at\`:
  // 1 = the whole line is inside them; less as more of it is not (the soft edge of a shadow); 0 = dark.
  float lgSees(vec3 L, vec3 P, int at) {
    vec3 d = P - L;
    vec3 safe = vec3(abs(d.x) < 1.0e-6 ? (d.x < 0.0 ? -1.0e-6 : 1.0e-6) : d.x, abs(d.y) < 1.0e-6 ? (d.y < 0.0 ? -1.0e-6 : 1.0e-6) : d.y, abs(d.z) < 1.0e-6 ? (d.z < 0.0 ? -1.0e-6 : 1.0e-6) : d.z);
    vec3 inv = 1.0 / safe;
    float lo[${MAX_CHAIN}];
    float hi[${MAX_CHAIN}];
    vec4 first = lgChainTexel(at);
    int n = int(first.w);
    for (int k = 0; k < ${MAX_CHAIN}; k++) {
      if (k >= n) { lo[k] = 2.0; hi[k] = -1.0; continue; }
      vec3 mn = k == 0 ? first.xyz : lgChainTexel(at + 2 * k).xyz;
      vec3 mx = lgChainTexel(at + 2 * k + 1).xyz;
      vec3 t0 = (mn - L) * inv, t1 = (mx - L) * inv;
      vec3 a = min(t0, t1), b = max(t0, t1);
      lo[k] = max(max(a.x, a.y), a.z);
      hi[k] = min(min(b.x, b.y), b.z);
    }
    // From the lamp: how far along the line the boxes reach, one handing on to the next.
    float t = 0.0;
    for (int pass = 0; pass < 2; pass++) for (int k = 0; k < ${MAX_CHAIN}; k++) if (lo[k] <= hi[k] && lo[k] <= t + 1.0e-4 && hi[k] > t) t = hi[k];
    if (t >= 1.0) return 1.0;
    // And back from the point. What lies between the two is outside the air.
    float s = 1.0;
    for (int pass = 0; pass < 2; pass++) for (int k = ${MAX_CHAIN - 1}; k >= 0; k--) if (lo[k] <= hi[k] && hi[k] >= s - 1.0e-4 && lo[k] < s) s = lo[k];
    return 1.0 - smoothstep(0.0, ${SOFT.toFixed(1)}, max(0.0, s - t) * length(d));
  }
  vec3 gridLight(vec3 wp, vec3 n) {
    vec3 E = lgAmbient * (1.0 + lgAmbientUp * n.z);
    // Read the cell just off the surface, on the side it faces.
    ivec3 ci = ivec3(floor((wp + n * 2.0 - lgOrigin) / lgCell));
    ivec3 dims = ivec3(lgDims);
    if (any(lessThan(ci, ivec3(0))) || any(greaterThanEqual(ci, dims))) return E * lgScale;
    vec2 cell = texelFetch(lgGrid, ivec2(ci.x, ci.y + ci.z * dims.y), 0).rg;
    int from = int(cell.x), count = int(cell.y);
    for (int q = 0; q < ${MAX_PER_CELL}; q++) {
      if (q >= count) break;
      int i = from + q;
      vec2 entry = texelFetch(lgList, ${row(LIST_W)}, 0).rg;        // the lamp, its chain (−1 = none)
      i = int(entry.x);
      ivec2 at = ivec2((i % ${LAMP_ROW}) * ${LAMP_TEXELS}, i / ${LAMP_ROW});
      vec4 a = texelFetch(lgLamps, at, 0);                          // place, reach (negative = a spot)
      vec3 to = a.xyz - wp;
      float d2 = dot(to, to), r2 = a.w * a.w;
      if (d2 >= r2) continue;
      float shut = 1.0;
      if (entry.y >= 0.0) {
        shut = lgSees(a.xyz, wp, int(entry.y));
        if (shut <= 0.0) continue;
      }
      vec4 b = texelFetch(lgLamps, at + ivec2(1, 0), 0);            // colour, size (negative = inside a mass)
      vec3 l = to * inversesqrt(max(d2, 1.0e-4));
      // There is no bounced light, so two things stand in for it. The light wraps a little round the edge of
      // what it falls on (more indoors, where walls are close). And a lamp inside gives a faint even fill to all
      // it can see, whichever way a surface faces: the glow a lit room has in its corners.
      bool indoor = b.w < 0.0;
      float wrap = indoor ? 0.5 : 0.25;
      float lam = clamp((dot(n, l) + wrap) / (1.0 + wrap), 0.0, 1.0);
      float win = 1.0 - d2 / r2;
      float cone = 1.0;
      if (a.w < 0.0) {
        vec4 c = texelFetch(lgLamps, at + ivec2(2, 0), 0);          // axis, cosine of the cone
        cone = smoothstep(c.w, texelFetch(lgLamps, at + ivec2(3, 0), 0).x, dot(-l, c.xyz));
      }
      float att = win * win / (1.0 + d2 / (b.w * b.w));
      float fill = indoor ? 0.08 * win * win : 0.0;
      E += b.rgb * ((att * lam + fill) * cone * shut);
    }
    return E * lgScale;
  }`;

/**
 * Builds the grid from a map's lamps and sets the uniforms. `shades`: boxes
 * whose insides lamps in the open do not light. `airs`: the map's boxes of
 * air, for its indoor lamps. With no lamps the grid is off.
 */
export function setLightGrid(lamps: GridLamp[], shades: Box3[] = [], airs: Box3[] = []): LightGrid['stats'] {
  const u = lightGridUniforms;
  for (const t of [u.lgGrid, u.lgList, u.lgLamps, u.lgChains]) { t.value?.dispose(); t.value = null; }
  u.lgOn.value = 0;
  const g = lightGridNow = buildLightGrid(lamps, shades, airs);
  if (!g) return { lamps: 0, cells: 0, entries: 0, full: 0, chains: 0, longest: 0, cut: 0, lost: 0, airs: 0, thin: 0 };
  const tex = (d: Float32Array, w: number, h: number, format: THREE.PixelFormat) => {
    const t = new THREE.DataTexture(d, w, h, format, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  const [nx, ny, nz] = g.dims;
  u.lgGrid.value = tex(g.grid, nx, ny * nz, THREE.RGFormat);
  u.lgList.value = tex(g.list, LIST_W, g.listRows, THREE.RGFormat);
  u.lgLamps.value = tex(g.lamps, LAMP_ROW * LAMP_TEXELS, g.lampRows, THREE.RGBAFormat);
  u.lgChains.value = tex(g.chains, CHAIN_W, g.chainRows, THREE.RGBAFormat);
  u.lgOrigin.value.set(g.origin[0], g.origin[1], g.origin[2]);
  u.lgDims.value.set(nx, ny, nz);
  u.lgOn.value = 1;
  return g.stats;
}
