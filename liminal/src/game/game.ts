import * as THREE from 'three';
import type { Storage } from '../data/storage';
import type { ConfigStore } from '../data/config';
import { type Settings, DEFAULT_SETTINGS, cloneSettings, applyPatch, diffSettings } from '../data/settings';
import { parseMap, type MapFile } from '../data/map';
import { LowResRenderer } from '../engine/render/renderer';
import { TextureRegistry } from '../engine/render/textures';
import { worldUniforms } from '../engine/render/worldMaterial';
import { angleVectors } from '../engine/vec3';
import { Input } from './input';
import { Level } from './level';
import { Player } from './player';
import { Lighting } from './lighting';

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
  readonly lighting = new Lighting();
  level!: Level;
  player!: Player;
  mapPath = '';
  private mapLabel = 'no map';
  get mapStatus(): string { return `${this.mapLabel} · ${this.lighting.status}`; }
  private acc = 0;
  private last = performance.now();
  onFrame: ((dt: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, private storage: Storage, readonly config: ConfigStore) {
    this.renderer = new LowResRenderer(canvas);
    this.input = new Input(canvas);
    this.lighting.onBaked = (layout, tex) => {
      if (!this.level) return;
      this.level.setLightmap(layout, tex);
      worldUniforms.lightmap.value = tex;
      this.updateLightUniforms(this.settings);
    };
  }

  /** Load textures and start reacting to settings. Call once before loading a map. */
  async init(): Promise<void> {
    await this.textures.init();
    this.applySettings();
    this.config.onChange(() => this.applySettings());
  }

  private updateLightUniforms(s: Settings): void {
    const lm = this.level?.lightmap;
    worldUniforms.lightmapOn.value = s.light.enabled && lm ? 1 : 0;
    worldUniforms.exposure.value = s.light.exposure;
    worldUniforms.sourceBrightness.value = s.light.sourceBrightness;
    if (lm) {
      const f = s.light.filter === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
      if (lm.magFilter !== f) { lm.magFilter = lm.minFilter = f; lm.needsUpdate = true; }
    }
  }

  /**
   * The settings actually in effect: code defaults, then the current map's
   * own settings (its lighting mood, look...), then anything the user has
   * changed in the panel, which always wins.
   */
  private effective: Settings = cloneSettings(DEFAULT_SETTINGS);
  get settings(): Settings { return this.effective; }

  private computeEffective(): void {
    const e = cloneSettings(DEFAULT_SETTINGS);
    if (this.level?.map.settings) applyPatch(e, this.level.map.settings);
    applyPatch(e, diffSettings(this.config.values));
    this.effective = e;
  }

  applySettings(): void {
    this.computeEffective();
    const s = this.effective;
    this.renderer.internalHeight = Math.round(s.render.internalHeight);
    this.renderer.upscale = s.render.upscale as 'nearest' | 'linear';
    this.renderer.msaa = s.render.msaa;
    this.renderer.camera_ = s.camera;
    this.renderer.setSourceFov(s.view.fov);
    this.renderer.setClearColor(s.fog.enabled ? s.fog.color : s.render.clearColor);
    const recrushed = this.textures.setCrush(s.textures, s.render.textureFilter as 'nearest' | 'linear');
    if (recrushed && this.level) this.level.rebuild();
    if (this.level) this.lighting.request(this.level, s, this.textures);
    this.updateLightUniforms(s);
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
    await this.setMap(parseMap(JSON.parse(text)), path);
  }

  async setMap(map: MapFile, label: string): Promise<void> {
    await this.textures.prepare(map.brushes.flatMap((b) => [b.tex ?? 'dev/gray', ...Object.values(b.faces ?? {}).map((f) => f?.tex ?? '')]).filter(Boolean));
    const level = new Level(map, this.textures);
    if (this.level) {
      this.scene.remove(this.level.root);
      this.level.dispose();
    }
    this.level = level;
    this.scene.add(level.root);
    worldUniforms.lightmapOn.value = 0;
    this.applySettings();
    this.lighting.request(level, this.settings, this.textures, true);
    if (this.player) this.player.setLevel(level);
    else this.player = new Player(level, this.settings);
    const own = map.settings ? Object.values(map.settings).reduce<number>((n, c) => n + Object.keys(c as object).length, 0) : 0;
    this.mapLabel = `${label}: ${map.brushes.length} brushes, ${map.entities.length} entities${own ? `, ${own} map settings` : ''}`;
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
    const C = s.camera;
    worldUniforms.flashOn.value = C.flash ? 1 : 0;
    worldUniforms.flashPos.value.set(eye.x, eye.y, eye.z + C.flashHeight);
    worldUniforms.flashIntensity.value = C.flashIntensity;
    worldUniforms.flashFifty.value = C.flashFifty;
    worldUniforms.flashColor.value.set(C.flashColor);

    this.renderer.render(this.scene);
    this.onFrame?.(dt);
  }
}
