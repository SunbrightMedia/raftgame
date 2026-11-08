import * as THREE from 'three';
import type { Storage } from '../data/storage';
import type { ConfigStore } from '../data/config';
import type { Settings } from '../data/settings';
import { parseMap, type MapFile } from '../data/map';
import { LowResRenderer } from '../engine/render/renderer';
import { TextureRegistry } from '../engine/render/textures';
import { worldUniforms } from '../engine/render/worldMaterial';
import { angleVectors } from '../engine/vec3';
import { Input } from './input';
import { Level } from './level';
import { Player } from './player';

/**
 * Owns the play loop: fixed-rate physics ticks, per-frame mouse look,
 * interpolated rendering. The editor (Milestone 2) will sit beside this and
 * share the same Level, renderer and Tab key.
 */
export class Game {
  readonly renderer: LowResRenderer;
  readonly textures = new TextureRegistry();
  readonly input: Input;
  readonly scene = new THREE.Scene();
  level!: Level;
  player!: Player;
  mapPath = '';
  mapStatus = 'no map';
  private acc = 0;
  private last = performance.now();
  onFrame: ((dt: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, private storage: Storage, readonly config: ConfigStore) {
    this.renderer = new LowResRenderer(canvas);
    this.input = new Input(canvas);
    this.applySettings(config.values);
    config.onChange((s) => this.applySettings(s));
  }

  get settings(): Settings { return this.config.values; }

  applySettings(s: Settings): void {
    this.renderer.internalHeight = Math.round(s.render.internalHeight);
    this.renderer.upscale = s.render.upscale as 'nearest' | 'linear';
    this.renderer.setSourceFov(s.view.fov);
    this.renderer.setClearColor(s.fog.enabled ? s.fog.color : s.render.clearColor);
    this.textures.setFilter(s.render.textureFilter as 'nearest' | 'linear');
    worldUniforms.faceShade.value = s.render.faceShade;
    worldUniforms.brightness.value = s.render.brightness;
    worldUniforms.fogOn.value = s.fog.enabled ? 1 : 0;
    worldUniforms.fogColor.value.set(s.fog.color);
    worldUniforms.fogNear.value = s.fog.near;
    worldUniforms.fogFar.value = s.fog.far;
    this.input.rawInput = s.view.rawInput;
  }

  async loadMapPath(path: string): Promise<void> {
    const text = await this.storage.read(path);
    if (text === null) throw new Error(`map not found: ${path}`);
    this.mapPath = path;
    this.setMap(parseMap(JSON.parse(text)), path);
  }

  setMap(map: MapFile, label: string): void {
    const level = new Level(map, this.textures);
    if (this.level) {
      this.scene.remove(this.level.meshes);
      this.level.dispose();
    }
    this.level = level;
    this.scene.add(level.meshes);
    if (this.player) this.player.setLevel(level);
    else this.player = new Player(level, this.settings);
    this.mapStatus = `${label}: ${map.brushes.length} brushes, ${map.entities.length} entities`;
  }

  start(): void {
    const frame = (now: number) => {
      requestAnimationFrame(frame);
      const dt = Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
    };
    requestAnimationFrame(frame);
  }

  private frame(dt: number): void {
    const s = this.settings;
    const [mx, my] = this.input.consumeMouse();
    this.player.look(mx, my, s);

    const tickRate = Math.max(1, s.sim.tickRate);
    const tick = 1 / tickRate;
    this.acc += dt * s.sim.timeScale;
    let steps = 0;
    while (this.acc >= tick && steps < 16) {
      this.player.tick(this.player.buildCmd(this.input), s, tick);
      this.input.endTick();
      this.acc -= tick;
      steps++;
    }
    if (steps === 16) this.acc = 0; // fell far behind (tab was hidden): don't spiral

    const alpha = this.acc / tick;
    const eye = this.player.eye(alpha, s);
    const cam = this.renderer.camera;
    cam.position.set(eye.x, eye.y, eye.z);
    const { forward } = angleVectors(this.player.pitch, this.player.yaw);
    cam.up.set(0, 0, 1);
    cam.lookAt(eye.x + forward.x, eye.y + forward.y, eye.z + forward.z);

    this.renderer.render(this.scene);
    this.onFrame?.(dt);
  }
}
