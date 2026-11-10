import * as THREE from 'three';
import type { EntityDef } from '../../data/map';
import type { TextureRegistry } from './textures';
import { worldUniforms } from './worldMaterial';
import { fogUniforms, FOG_PARS } from './fog';

/**
 * Light you see in the air rather than on a surface, as Source draws it:
 *
 *  - `glow`: a sprite facing the view, added to the picture (env_sprite with
 *    render mode "additive": the glow Portal 2 puts on every lamp).
 *      { "class": "glow", "origin": [x, y, z],
 *        "props": { "tex": "p2lib/sprites/glow04", "size": 58, "color": [247, 228, 170], "brightness": 1 } }
 *    size: width in units (Source: the sprite's texels × scale). color: 0..255,
 *    multiplied onto the texture as Source does. brightness: renderamt/255 × HDRColorScale.
 *  - `beam`: a spotlight's visible shaft (point_spotlight, beam_spotlight): a
 *    ribbon from the lamp along its direction that turns to face the view,
 *    fading to nothing at its end, plus a halo at the lamp that swells and
 *    brightens as you step into the beam and look at the lamp (Source's
 *    DrawBeamWithHalo).
 *      { "class": "beam", "origin": [x, y, z],
 *        "props": { "dir": [dx, dy, dz], "length": 128, "width": 64, "color": [247, 228, 170], "brightness": 0.5,
 *                   "tex": "p2lib/sprites/glow_test02", "halo": "p2lib/sprites/light_glow03" } }
 *
 * All of a map's glows and beams are a handful of meshes (one per texture).
 * Additive things fog towards black, as in Source.
 */
const col = (v: unknown, d: number[]): number[] => (Array.isArray(v) && v.length >= 3 ? (v as number[]).map((c) => c / 255) : d);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const BEAM_BRIGHTNESS = 64 / 255;   // point_spotlight: SetBrightness(64)
const HALO_SCALE = 60;              // point_spotlight: SetHaloScale(60)

/** Every texture a map's glows and beams draw with (for TextureRegistry.prepare). */
export function glowTextures(entities: EntityDef[]): string[] {
  const out = new Set<string>();
  for (const e of entities) {
    if (e.class === 'glow' && typeof e.props?.tex === 'string') out.add(e.props.tex);
    if (e.class === 'beam') {
      if (typeof e.props?.tex === 'string') out.add(e.props.tex);
      if (typeof e.props?.halo === 'string') out.add(e.props.halo);
    }
  }
  return [...out];
}

function additive(mat: THREE.ShaderMaterial): THREE.ShaderMaterial {
  mat.transparent = true;
  mat.depthWrite = false;
  mat.side = THREE.DoubleSide;
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneFactor;
  // The frame's alpha marks light sources for the camera pass: leave it alone.
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
  return mat;
}

const FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform float sourceUnit;
  uniform float gamma22;
  uniform float linearTex;
  ${FOG_PARS}
  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vViewPos;   // exact per pixel: a distance interpolated across a huge face is far off
  #define vDepth length(vViewPos)
  #define vFogZ (cameraPosition.z + dot(viewMatrix[2].xyz, vViewPos))
  vec3 toLinear(vec3 c) { return gamma22 > 0.5 ? pow(c, vec3(2.2)) : mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
  void main() {
    vec3 t = texture2D(map, vUv).rgb;
    if (linearTex < 0.5) t = toLinear(t);
    gl_FragColor = vec4(t * vColor * sourceUnit * fogOver(vDepth, vFogZ).a, 0.0);
  }`;

interface Sprite { origin: number[]; size: number; color: number[]; dir?: number[]; width?: number }

/** View-facing quads. With `dir` (a beam's halo) the size and colour follow Source's halo rules. */
function spriteMesh(tex: THREE.Texture, linearTex: boolean, sprites: Sprite[]): THREE.Mesh {
  const n = sprites.length;
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const centre = new Float32Array(n * 3), size = new Float32Array(n), color = new Float32Array(n * 3), halo = new Float32Array(n * 4);
  const box = new THREE.Box3();
  sprites.forEach((s, i) => {
    centre.set(s.origin, i * 3); size[i] = s.size; color.set(s.color, i * 3);
    if (s.dir) halo.set([s.dir[0], s.dir[1], s.dir[2], s.width ?? 1], i * 4);
    box.expandByPoint(new THREE.Vector3(s.origin[0], s.origin[1], s.origin[2]));
  });
  g.setAttribute('centre', new THREE.InstancedBufferAttribute(centre, 3));
  g.setAttribute('size', new THREE.InstancedBufferAttribute(size, 1));
  g.setAttribute('tint', new THREE.InstancedBufferAttribute(color, 3));
  g.setAttribute('halo', new THREE.InstancedBufferAttribute(halo, 4));
  g.instanceCount = n;
  g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  g.boundingSphere.radius += 256;
  const mat = additive(new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, sourceUnit: worldUniforms.sourceUnit, gamma22: worldUniforms.gamma22, linearTex: { value: linearTex ? 1 : 0 }, ...fogUniforms },
    vertexShader: /* glsl */ `
      attribute vec3 centre;
      attribute float size;
      attribute vec3 tint;
      attribute vec4 halo;
      varying vec2 vUv;
      varying vec3 vColor;
      varying vec3 vViewPos;   // exact per pixel: a distance interpolated across a huge face is far off
      #define vDepth length(vViewPos)
      #define vFogZ (cameraPosition.z + dot(viewMatrix[2].xyz, vViewPos))
      void main() {
        float s = size;
        vColor = tint;
        if (halo.w > 0.0) {
          // A beam's halo (DrawBeamWithHalo): bigger the closer the eye is to the beam's axis,
          // brighter the more the beam points at the eye.
          vec3 toEye = cameraPosition - centre;
          float along = dot(toEye, halo.xyz);
          float distToLine = length(toEye - halo.xyz * along);
          float fade = clamp(2.0 * dot(halo.xyz, normalize(toEye)), 0.0, 1.0);
          s *= clamp(1.0 - distToLine / (4.0 * halo.w), 0.0, 1.0);
          vColor *= fade * fade;
        }
        vec4 mv = viewMatrix * vec4(centre, 1.0);
        mv.xy += position.xy * s;
        vUv = position.xy + 0.5;
        vViewPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: FRAG,
  }));
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'glows';
  return mesh;
}

interface Beam { origin: number[]; dir: number[]; length: number; width: number; color: number[] }

/** Ribbons along each beam, turned about the beam's axis to face the view. */
function beamMesh(tex: THREE.Texture, linearTex: boolean, beams: Beam[]): THREE.Mesh {
  const pos: number[] = [], axis: number[] = [], par: number[] = [], color: number[] = [], index: number[] = [];
  const box = new THREE.Box3();
  beams.forEach((b, i) => {
    for (const [t, side] of [[0, -1], [0, 1], [1, 1], [1, -1]]) {
      pos.push(...b.origin); axis.push(b.dir[0] * b.length, b.dir[1] * b.length, b.dir[2] * b.length); par.push(t, side, b.width); color.push(...b.color);
    }
    index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    box.expandByPoint(new THREE.Vector3(...b.origin));
    box.expandByPoint(new THREE.Vector3(b.origin[0] + b.dir[0] * b.length, b.origin[1] + b.dir[1] * b.length, b.origin[2] + b.dir[2] * b.length));
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('axis', new THREE.Float32BufferAttribute(axis, 3));
  g.setAttribute('par', new THREE.Float32BufferAttribute(par, 3));
  g.setAttribute('tint', new THREE.Float32BufferAttribute(color, 3));
  g.setIndex(index);
  g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  g.boundingSphere.radius += 256;
  const mat = additive(new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, sourceUnit: worldUniforms.sourceUnit, gamma22: worldUniforms.gamma22, linearTex: { value: linearTex ? 1 : 0 }, ...fogUniforms },
    vertexShader: /* glsl */ `
      attribute vec3 axis;
      attribute vec3 par;
      attribute vec3 tint;
      varying vec2 vUv;
      varying vec3 vColor;
      varying vec3 vViewPos;   // exact per pixel: a distance interpolated across a huge face is far off
      #define vDepth length(vViewPos)
      #define vFogZ (cameraPosition.z + dot(viewMatrix[2].xyz, vViewPos))
      void main() {
        vec3 dir = normalize(axis);
        vec3 p = position + axis * par.x;
        vec3 side = cross(dir, cameraPosition - p);
        float sl = length(side);
        side = sl > 1e-4 ? side / sl : vec3(0.0);
        p += side * par.y * par.z * 0.5;
        // Fades as the eye nears the beam's axis, gone inside its width (you'd be looking down a flat ribbon).
        vec3 toEye = cameraPosition - position;
        float distToLine = length(toEye - dir * dot(toEye, dir));
        float k = distToLine < par.z ? 0.0 : clamp((distToLine - par.z) / (3.0 * par.z), 0.0, 1.0);
        // Brightest at the lamp, nothing at the far end (FBEAM_SHADEOUT).
        vColor = tint * k * (1.0 - par.x);
        vUv = vec2(par.y * 0.5 + 0.5, par.x);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vViewPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: FRAG,
  }));
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'beams';
  return mesh;
}

export function buildGlows(entities: EntityDef[], textures: TextureRegistry): THREE.Group | null {
  const sprites = new Map<string, Sprite[]>(), beams = new Map<string, Beam[]>();
  const add = <T>(m: Map<string, T[]>, k: string, v: T) => { let a = m.get(k); if (!a) { a = []; m.set(k, a); } a.push(v); };
  for (const e of entities) {
    const p = e.props ?? {};
    if (e.class === 'glow' && typeof p.tex === 'string') {
      const b = num(p.brightness, 1);
      add(sprites, p.tex, { origin: e.origin, size: num(p.size, 64), color: col(p.color, [1, 1, 1]).map((c) => c * b) });
    } else if (e.class === 'beam' && Array.isArray(p.dir)) {
      const d = p.dir as number[], l = Math.hypot(d[0], d[1], d[2]) || 1, dir = [d[0] / l, d[1] / l, d[2] / l];
      const b = num(p.brightness, 1), c = col(p.color, [1, 1, 1]), width = num(p.width, 64);
      if (typeof p.tex === 'string') add(beams, p.tex, { origin: e.origin, dir, length: num(p.length, 128), width, color: c.map((v) => v * b * BEAM_BRIGHTNESS) });
      if (typeof p.halo === 'string') add(sprites, p.halo, { origin: e.origin, size: HALO_SCALE, color: c.map((v) => v * b), dir, width });
    }
  }
  if (!sprites.size && !beams.size) return null;
  const group = new THREE.Group();
  group.name = 'glows';
  const linear = (name: string) => !!(textures.get(name).source as { nosrgb?: boolean } | undefined)?.nosrgb;
  for (const [tex, list] of sprites) group.add(spriteMesh(textures.get(tex).texture, linear(tex), list));
  for (const [tex, list] of beams) group.add(beamMesh(textures.get(tex).texture, linear(tex), list));
  // Drawn after the world's own see-through surfaces.
  group.traverse((o) => { o.renderOrder = 10; });
  return group;
}

export function disposeGlows(g: THREE.Group): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  });
}
