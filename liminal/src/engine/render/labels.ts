import * as THREE from 'three';
import type { EntityDef } from '../../data/map';
import { worldUniforms } from './worldMaterial';

/**
 * Text in the world: `label` entities, e.g. the cell names of the catalogue
 * rooms ("C7", a material's path). All of a map's labels are one mesh of
 * character quads over one font image, on a dark plate so they read on any
 * floor.
 *
 *   { "class": "label", "origin": [x, y, z], "angles": [0, yaw, 0],
 *     "props": { "text": "C7\nmetal/black_wall_metal_002a", "size": 8, "plane": "floor" } }
 *
 * size: capital height in units (lines after the first are half as tall).
 * plane: "floor" (lying on it, reading along yaw) or "wall" (upright, facing yaw).
 */
const FIRST = 32, LAST = 126, COLS = 16, CELL = 64;
let atlas: THREE.CanvasTexture | null = null;

function fontAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const rows = Math.ceil((LAST - FIRST + 2) / COLS);
  const c = document.createElement('canvas');
  c.width = COLS * CELL; c.height = rows * CELL;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.font = `bold ${Math.round(CELL * 0.78)}px ui-monospace, Menlo, Consolas, monospace`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let ch = FIRST; ch <= LAST; ch++) {
    const k = ch - FIRST;
    g.fillText(String.fromCharCode(ch), (k % COLS) * CELL + CELL / 2, Math.floor(k / COLS) * CELL + CELL / 2 + 2);
  }
  // Last cell: solid, for the backing plates.
  const k = LAST - FIRST + 1;
  g.fillRect((k % COLS) * CELL, Math.floor(k / COLS) * CELL, CELL, CELL);
  atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.NoColorSpace;
  atlas.anisotropy = 8;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  return atlas;
}

export function buildLabels(entities: EntityDef[]): THREE.Mesh | null {
  const labels = entities.filter((e) => e.class === 'label' && typeof e.props?.text === 'string');
  if (!labels.length) return null;
  const tex = fontAtlas();
  const rows = Math.ceil((LAST - FIRST + 2) / COLS);
  const pos: number[] = [], uv: number[] = [], col: number[] = [];
  const quad = (o: THREE.Vector3, r: THREE.Vector3, u: THREE.Vector3, x0: number, y0: number, w: number, h: number, cell: number, rgb: number[]) => {
    const cu = (cell % COLS) / COLS, cv = 1 - (Math.floor(cell / COLS) + 1) / rows, du = 1 / COLS, dv = 1 / rows;
    const P = (x: number, y: number) => [o.x + r.x * x + u.x * y, o.y + r.y * x + u.y * y, o.z + r.z * x + u.z * y];
    const corners = [P(x0, y0), P(x0 + w, y0), P(x0 + w, y0 + h), P(x0, y0 + h)];
    const uvs = [[cu, cv], [cu + du, cv], [cu + du, cv + dv], [cu, cv + dv]];
    for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(...corners[i]); uv.push(...uvs[i]); col.push(...rgb); }
  };
  for (const e of labels) {
    const text = String(e.props!.text);
    const size = typeof e.props?.size === 'number' ? e.props.size : 8;
    const yaw = ((e.angles?.[1] ?? 0) * Math.PI) / 180;
    const wall = e.props?.plane === 'wall';
    const fwd = new THREE.Vector3(Math.cos(yaw), Math.sin(yaw), 0);
    // Floor: read along yaw, the top of the letters away from the reader. Wall: the text faces yaw.
    // (a viewer facing the wall looks along -fwd; their right is (-fwd) × up)
    const right = wall ? new THREE.Vector3(-fwd.y, fwd.x, 0) : fwd.clone();
    const up = wall ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(-fwd.y, fwd.x, 0);
    const o = new THREE.Vector3(...e.origin).addScaledVector(wall ? fwd : new THREE.Vector3(0, 0, 1), 0.3);
    const lines = text.split('\n');
    const heights = lines.map((_, i) => (i === 0 ? size : size * 0.5));
    const widths = lines.map((l, i) => l.length * heights[i] * 0.62);
    const total = heights.reduce((a, b) => a + b * 1.25, 0);
    const maxW = Math.max(...widths);
    const pad = size * 0.3;
    // Backing plate, then the characters a hair in front of it.
    quad(o.clone().addScaledVector(wall ? fwd : new THREE.Vector3(0, 0, 1), -0.1), right, up, -maxW / 2 - pad, -total / 2 - pad, maxW + 2 * pad, total + 2 * pad, LAST - FIRST + 1, [0.06, 0.06, 0.07]);
    let y = total / 2;
    lines.forEach((line, i) => {
      const h = heights[i], cw = h * 0.62;
      y -= h * 1.25;
      let x = -widths[i] / 2;
      const rgb = i === 0 ? [1, 0.92, 0.35] : [0.9, 0.9, 0.9];
      for (const chr of line) {
        const c = chr.charCodeAt(0);
        if (c > FIRST && c <= LAST) quad(o, right, up, x, y, cw, h * 1.1, c - FIRST, rgb);
        x += cw;
      }
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide, fog: false });
  // Colours are display values: hand the camera pass the same linear light the world shaders do.
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.sourceUnit = worldUniforms.sourceUnit;
    sh.fragmentShader = 'uniform float sourceUnit;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.rgb = pow(max(gl_FragColor.rgb, 0.0), vec3(2.2)) * sourceUnit;');
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'labels';
  return mesh;
}
