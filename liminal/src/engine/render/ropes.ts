import * as THREE from 'three';
import type { EntityDef } from '../../data/map';
import { worldUniforms } from './worldMaterial';
import { fogUniforms, FOG_PARS } from './fog';

/**
 * Cables: a line hanging between two points (Source's move_rope /
 * keyframe_rope with its slack).
 *
 *   { "class": "rope", "origin": [x, y, z],
 *     "props": { "to": [x, y, z], "sag": 40, "width": 3, "color": [20, 20, 22] } }
 *
 * sag: how far the middle hangs below the straight line (a parabola, which is
 * what a taut cable's catenary looks like). width: thickness in units.
 * color: 0..255 (default near-black rubber).
 *
 * All of a map's cables are one mesh: each is a thin four-sided tube of a few
 * straight pieces (more for longer or slacker cables).
 */
const col = (v: unknown, d: number[]): number[] => (Array.isArray(v) && v.length >= 3 ? (v as number[]).map((c) => c / 255) : d);

export function buildRopes(entities: EntityDef[]): THREE.Mesh | null {
  const ropes = entities.filter((e) => e.class === 'rope' && Array.isArray(e.props?.to));
  if (!ropes.length) return null;
  const pos: number[] = [], nrm: number[] = [], rgb: number[] = [], index: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Vector3();
  const t = new THREE.Vector3(), s = new THREE.Vector3(), u = new THREE.Vector3(), up = new THREE.Vector3(0, 0, 1);
  for (const e of ropes) {
    const to = e.props!.to as number[];
    a.set(e.origin[0], e.origin[1], e.origin[2]); b.set(to[0], to[1], to[2]);
    const sag = typeof e.props?.sag === 'number' ? e.props.sag : 0;
    const r = (typeof e.props?.width === 'number' ? e.props.width : 3) / 2;
    const c = col(e.props?.color, [0.07, 0.07, 0.08]);
    const len = a.distanceTo(b);
    const n = Math.max(2, Math.min(24, Math.round(4 + Math.sqrt(Math.abs(sag)) * 1.5 + len / 400)));
    const at = (k: number, out: THREE.Vector3) => { const f = k / n; out.lerpVectors(a, b, f); out.z -= sag * 4 * f * (1 - f); return out; };
    const base = pos.length / 3;
    for (let k = 0; k <= n; k++) {
      at(k, p);
      // The tangent, from the neighbours.
      at(Math.max(0, k - 1), q); t.copy(at(Math.min(n, k + 1), s)).sub(q).normalize();
      s.crossVectors(t, up); if (s.lengthSq() < 1e-6) s.set(1, 0, 0); s.normalize();
      u.crossVectors(s, t).normalize();
      for (const [cs, cu] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        pos.push(p.x + (s.x * cs + u.x * cu) * r, p.y + (s.y * cs + u.y * cu) * r, p.z + (s.z * cs + u.z * cu) * r);
        nrm.push(s.x * cs + u.x * cu, s.y * cs + u.y * cu, s.z * cs + u.z * cu);
        rgb.push(c[0], c[1], c[2]);
      }
    }
    for (let k = 0; k < n; k++) for (let j = 0; j < 4; j++) {
      const i0 = base + k * 4 + j, i1 = base + k * 4 + ((j + 1) % 4), i2 = i0 + 4, i3 = i1 + 4;
      index.push(i0, i1, i3, i0, i3, i2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(rgb, 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    uniforms: { sourceUnit: worldUniforms.sourceUnit, gamma22: worldUniforms.gamma22, faceShade: worldUniforms.faceShade, ...fogUniforms },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vViewPos;   // exact per pixel: a distance interpolated across a huge face is far off
      #define vDepth length(vViewPos)
      #define vFogZ (cameraPosition.z + dot(viewMatrix[2].xyz, vViewPos))
      void main() {
        vColor = color;
        vNormal = normal;
        vec4 mv = viewMatrix * vec4(position, 1.0);
        vViewPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float sourceUnit;
      uniform float gamma22;
      uniform float faceShade;
      ${FOG_PARS}
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vViewPos;   // exact per pixel: a distance interpolated across a huge face is far off
      #define vDepth length(vViewPos)
      #define vFogZ (cameraPosition.z + dot(viewMatrix[2].xyz, vViewPos))
      void main() {
        // A matt cable under even light: a little brighter on top, as the world's flat shading does.
        float shade = mix(1.0, 0.72 + 0.28 * normalize(vNormal).z, faceShade);
        vec3 L = pow(vColor, vec3(2.2)) * sourceUnit * shade;
        gl_FragColor = vec4(applyFog(L, vDepth, vFogZ), 0.0);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'ropes';
  mesh.frustumCulled = false;
  return mesh;
}
