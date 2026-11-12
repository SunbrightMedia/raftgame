/**
 * Shift-click a room: a spinning low-poly 3D model of it fills the map area, with the map heavily blurred
 * behind. Orthographic camera 45° down, turning by itself; drag to turn it, wheel to zoom, Esc or × to close.
 * The room type's name on top can be edited, and stays (names.ts).
 */
import * as THREE from 'three';
import { FEATURE, THEMES } from './catalogue';
import { typeName, setTypeName } from './names';
import { buildRoom3D } from './room3d';
import type { MapOut } from './types';

export interface RoomViewHandle { close(): void }

export function openRoomView(host: HTMLElement, blurTarget: HTMLElement, m: MapOut, zi: number, onClose: () => void): RoomViewHandle {
  const z = m.zones[zi];
  const room = buildRoom3D(m, zi);

  // ---- page parts
  const box = document.createElement('div');
  box.id = 'room-view';
  const head = document.createElement('div');
  head.className = 'rv-head';
  const title = document.createElement('input');
  title.type = 'text';
  title.className = 'rv-title';
  title.value = typeName(z.feature);
  title.title = 'Your name for this room type (every room of this type uses it). Empty = the original name.';
  title.spellcheck = false;
  const orig = document.createElement('div');
  orig.className = 'rv-orig';
  const meta = document.createElement('div');
  meta.className = 'rv-meta';
  const district = THEMES.find((t) => t.id === z.theme)?.name ?? z.theme;
  const tags = z.tags.map((t) => typeName(t));
  meta.textContent = `${Math.round(z.w * 2)} × ${Math.round(z.h * 2)} ft${z.level ? ` · floor ${z.level > 0 ? '+' : ''}${z.level}` : ''} · ${district}${tags.length ? ` · ${tags.join(', ')}` : ''}`;
  const syncOrig = () => { const o = FEATURE[z.feature]?.name ?? z.feature; orig.textContent = title.value.trim() && title.value.trim() !== o ? `(${FEATURE[z.feature]?.n ?? ''}. ${o})` : `${FEATURE[z.feature]?.n ?? ''}. ${FEATURE[z.feature]?.desc ?? ''}`; };
  syncOrig();
  head.append(title, orig, meta);
  const close = document.createElement('button');
  close.className = 'rv-close';
  close.textContent = '×';
  close.title = 'Close (Esc)';
  const hint = document.createElement('div');
  hint.className = 'rv-hint';
  hint.textContent = 'drag: turn · wheel: zoom · Esc: close';
  const canvas = document.createElement('canvas');
  canvas.className = 'rv-canvas';
  box.append(canvas, head, close, hint);
  host.append(box);
  blurTarget.classList.add('rv-blur');

  const save = () => { void setTypeName(z.feature, title.value); syncOrig(); };
  title.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') title.blur(); if (e.key === 'Escape') { title.value = typeName(z.feature); title.blur(); } });
  title.addEventListener('change', save);
  title.addEventListener('input', syncOrig);

  // ---- 3D
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(room.group);
  scene.add(new THREE.HemisphereLight(0xfffaf0, 0x5e5850, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(room.center.x + 30, room.center.y - 50, room.center.z + 80);
  sun.target.position.copy(room.center);
  scene.add(sun, sun.target);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  cam.up.set(0, 0, 1);
  const EL = Math.PI / 4;
  let az = -Math.PI / 2 + 0.6, zoom = 1, lastTouch = -1e9, dragging: { x: number; az: number } | null = null, raf = 0, last = performance.now();
  const resize = () => {
    const w = box.clientWidth, h = box.clientHeight;
    renderer.setSize(w, h, false);
    const half = room.radius * 1.15 / zoom, aspect = w / Math.max(1, h);
    cam.left = -half * Math.max(1, aspect); cam.right = half * Math.max(1, aspect);
    cam.top = half / Math.min(1, aspect); cam.bottom = -half / Math.min(1, aspect);
    cam.updateProjectionMatrix();
  };
  const frame = (t: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    if (!dragging && t - lastTouch > 2500) az += dt * 0.35;
    const R = room.radius * 4;
    cam.position.set(room.center.x + Math.cos(az) * Math.cos(EL) * R, room.center.y + Math.sin(az) * Math.cos(EL) * R, room.center.z + Math.sin(EL) * R);
    cam.lookAt(room.center);
    renderer.render(scene, cam);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(box);
  resize();
  raf = requestAnimationFrame(frame);

  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); dragging = { x: e.clientX, az }; lastTouch = performance.now(); });
  canvas.addEventListener('pointermove', (e) => { if (dragging) { az = dragging.az - (e.clientX - dragging.x) * 0.008; lastTouch = performance.now(); } });
  canvas.addEventListener('pointerup', () => { dragging = null; lastTouch = performance.now(); });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(0.5, Math.min(4, zoom * Math.pow(1.0015, -e.deltaY))); resize(); }, { passive: false });

  let open = true;
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && document.activeElement !== title) { e.stopPropagation(); handle.close(); } };
  window.addEventListener('keydown', onKey, true);
  close.addEventListener('click', () => handle.close());

  const handle: RoomViewHandle = {
    close() {
      if (!open) return;
      open = false;
      if (document.activeElement === title) save();
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', onKey, true);
      room.group.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); } });
      renderer.dispose();
      box.remove();
      blurTarget.classList.remove('rv-blur');
      onClose();
    },
  };
  return handle;
}
