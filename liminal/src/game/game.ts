import * as THREE from 'three';
import type { Storage } from '../data/storage';
import type { ConfigStore } from '../data/config';
import { type Settings, DEFAULT_SETTINGS, cloneSettings } from '../data/settings';
import { parseMap, type MapFile } from '../data/map';
import { LowResRenderer } from '../engine/render/renderer';
import { TextureRegistry } from '../engine/render/textures';
import { ModelRegistry } from '../engine/render/models';
import { propMaterials } from '../engine/render/propMeshes';
import { propModel } from '../engine/collision/props';
import { worldUniforms, MAX_RECTS } from '../engine/render/worldMaterial';
import { kelvinToLinear, emitterColor } from '../engine/light/units';
import { angleVectors } from '../engine/vec3';
import { Input } from './input';
import { Level } from './level';
import { Player } from './player';
import { Lighting, mapLights, MAX_DYNAMIC, skyColour } from './lighting';
import { Sky } from '../engine/render/sky';

/**
 * Owns the play loop: fixed-rate physics ticks, per-frame mouse look,
 * interpolated rendering. The editor (Milestone 2) will sit beside this and
 * share the same Level, renderer and Tab key.
 */
export class Game {
  readonly renderer: LowResRenderer;
  readonly textures = new TextureRegistry();
  readonly models = new ModelRegistry();
  readonly input: Input;
  readonly scene = new THREE.Scene();
  readonly lighting: Lighting;
  /** Where map loading time went (texture prep, level/mesh build). */
  loadTimes: Record<string, number> = {};
  level!: Level;
  player!: Player;
  mapPath = '';
  private mapLabel = 'no map';
  get mapStatus(): string { return `${this.mapLabel} · ${this.lighting.status}`; }
  private acc = 0;
  private last = performance.now();
  onFrame: ((dt: number) => void) | null = null;
  private holdUntil = 0;
  readonly sky = new Sky();
  private precompiled = false;

  constructor(canvas: HTMLCanvasElement, private storage: Storage, readonly config: ConfigStore) {
    this.scene.add(this.sky.mesh);
    this.renderer = new LowResRenderer(canvas);
    this.lighting = new Lighting(storage);
    this.input = new Input(canvas);
    this.lighting.onBaked = (layout, tex, dir, mask) => {
      if (!this.level) return;
      this.level.setLightmap(layout, tex);
      worldUniforms.lightmapDir.value?.dispose();
      worldUniforms.lightmap.value = tex;
      worldUniforms.lightmapDir.value = dir;
      worldUniforms.lightmapMask.value?.dispose();
      worldUniforms.lightmapMask.value = mask;
      this.updateLightUniforms(this.settings);
    };
  }

  /** Load textures and start reacting to settings. Call once before loading a map. */
  async init(): Promise<void> {
    await this.textures.init();
    this.applySettings();
    this.config.onChange(() => this.applySettings());
  }

  /** Cans and bulbs drawn per pixel by the world shader (see mapLights). */
  private uploadDynamicLights(): void {
    if (!this.level) return;
    const dyn = mapLights(this.level).filter((l) => l.dynamic).slice(0, MAX_DYNAMIC);
    const u = worldUniforms;
    u.dynCount.value = dyn.length;
    dyn.forEach((l, i) => {
      u.dynPos.value[i].set(...l.pos);
      u.dynColor.value[i].set(l.color[0] * l.I0, l.color[1] * l.I0, l.color[2] * l.I0);
      const c = l.cutoffDeg ?? 180, sd = l.softDeg ?? 2;
      const cos = (deg: number) => Math.cos((Math.min(180, Math.max(0, deg)) * Math.PI) / 180);
      // x: -(1 + spill) for a downward beam, 0 for a bare bulb.
      u.dynBeam.value[i].set(l.dir ? -(1 + (l.spill ?? 0)) : 0, l.n ?? 1, cos(c - sd), cos(c + sd));
      u.dynChan.value[i] = l.channel ?? 0;
    });
  }

  /** Light-emitting rectangles (troffers) in the current map, for reflections. */
  private rects: { c: number[]; hw: number[]; hh: number[]; lum: number[] }[] = [];
  private rectFrame = 0;

  private collectRects(): void {
    this.rects = [];
    for (const f of this.level.faces) {
      const t = this.textures.get(f.tex);
      if (!t.emissive?.castsLight) continue;
      const col = emitterColor(t.emissive);
      const c = [0, 1, 2].map((a) => f.origin[a] + (f.r[a] * f.width + f.u[a] * f.height) / 2);
      const hw = [0, 1, 2].map((a) => (f.r[a] * f.width) / 2);
      let hh = [0, 1, 2].map((a) => (f.u[a] * f.height) / 2);
      // The LTC code expects corners wound so that cross(hw, hh) points away from the lit side.
      const cx = [hw[1] * hh[2] - hw[2] * hh[1], hw[2] * hh[0] - hw[0] * hh[2], hw[0] * hh[1] - hw[1] * hh[0]];
      if (cx[0] * f.n[0] + cx[1] * f.n[1] + cx[2] * f.n[2] > 0) hh = hh.map((x) => -x);
      this.rects.push({ c, hw, hh, lum: col.map((x) => x * t.emissive!.luminance) });
    }
    this.rectFrame = 0;
  }

  /** Upload the light rectangles nearest the eye (all of them, in most rooms). */
  private uploadRects(eye: { x: number; y: number; z: number }): void {
    if (this.rectFrame++ % 6 !== 0) return;
    const d2 = (r: { c: number[] }) => (r.c[0] - eye.x) ** 2 + (r.c[1] - eye.y) ** 2 + (r.c[2] - eye.z) ** 2;
    const list = this.rects.length > MAX_RECTS ? [...this.rects].sort((a, b) => d2(a) - d2(b)).slice(0, MAX_RECTS) : this.rects;
    const tex = worldUniforms.rectTex.value;
    const data = tex.image.data as Float32Array;
    list.forEach((r, i) => {
      data.set([...r.c, 0, ...r.hw, 0, ...r.hh, 0, ...r.lum, 0], i * 16);
    });
    worldUniforms.rectCount.value = list.length;
    tex.needsUpdate = true;
  }

  /** Sky dome and sun disc from the light settings and the map's sun entity. */
  private updateSky(s: Settings): void {
    const sunEnt = this.level?.map.entities.find((e) => e.class === 'light' && e.props?.type === 'sun');
    let sun: { dir: [number, number, number]; color: [number, number, number] } | null = null;
    if (sunEnt) {
      const p = sunEnt.props as Record<string, number>;
      const pr = ((p.pitch ?? -60) * Math.PI) / 180, yr = ((p.yaw ?? 0) * Math.PI) / 180;
      sun = { dir: [-Math.cos(pr) * Math.cos(yr), -Math.cos(pr) * Math.sin(yr), -Math.sin(pr)], color: kelvinToLinear(p.kelvin ?? 5600) };
    }
    this.sky.set(s.light.skyLuminance, skyColour(s.light.skyZenith), skyColour(s.light.skyHorizon), sun, s.light.skyBand);
  }

  private updateLightUniforms(s: Settings): void {
    worldUniforms.lightScale.value = s.light.lightScale;
    const lm = this.level?.lightmap;
    worldUniforms.lightmapOn.value = s.light.enabled && lm ? 1 : 0;

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
    // The config store already layers defaults ⊕ map ⊕ the user's overrides.
    this.effective = cloneSettings(this.config.values);
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
    worldUniforms.fogLuminance.value = s.fog.luminance;
    worldUniforms.fogHaze.value = s.fog.haze ? 1 : 0;
    worldUniforms.tileBreakup.value = s.render.tileBreakup;
    worldUniforms.specScale.value = s.surface.reflections;
    this.updateSky(s);
    worldUniforms.roughnessAdd.value = s.surface.roughness;
    worldUniforms.bumpScale.value = s.surface.bump;
    worldUniforms.parallaxScale.value = s.surface.parallax;
    worldUniforms.bakedRelief.value = s.surface.bakedRelief;
    worldUniforms.cavityScale.value = s.surface.cavity;
    worldUniforms.sheenScale.value = s.surface.sheen;
    worldUniforms.detailScale.value = s.surface.detail;
    this.input.rawInput = s.view.rawInput;
  }

  async loadMapPath(path: string): Promise<void> {
    const text = await this.storage.read(path);
    if (text === null) throw new Error(`map not found: ${path}`);
    this.mapPath = path;
    await this.setMap(parseMap(JSON.parse(text)), path);
  }

  async setMap(map: MapFile, label: string): Promise<void> {
    const t0 = performance.now();
    await this.models.prepare(map.entities.map(propModel).filter((m): m is string => !!m));
    const texNames = [
      ...map.brushes.flatMap((b) => [b.tex ?? 'dev/gray', ...Object.values(b.faces ?? {}).map((f) => f?.tex ?? '')]).filter(Boolean),
      ...propMaterials(map.entities, this.models),
    ];
    await this.textures.prepare([...texNames, ...this.textures.extrasOf(texNames)]);
    const t1 = performance.now();
    const level = new Level(map, this.textures, this.models, label.endsWith('.json') ? label : undefined);
    this.loadTimes = { texturesMs: Math.round(t1 - t0), levelMs: Math.round(performance.now() - t1) };
    if (this.level) {
      this.scene.remove(this.level.root);
      this.level.dispose();
    }
    this.level = level;
    this.config.setMapSettings(map.settings);
    this.scene.add(level.root);
    worldUniforms.lightmapOn.value = 0;
    this.applySettings();
    this.uploadDynamicLights();
    this.collectRects();
    this.lighting.request(level, this.settings, this.textures, true);
    this.holdUntil = performance.now() + this.settings.render.lightHoldMs;
    if (this.player) this.player.setLevel(level);
    else this.player = new Player(level, this.settings);
    const own = map.settings ? Object.values(map.settings).reduce<number>((n, c) => n + Object.keys(c as object).length, 0) : 0;
    this.mapLabel = `${label}: ${map.brushes.length} brushes, ${map.entities.length} entities${own ? `, ${own} map settings` : ''}`;
  }

  /**
   * No frames of its own: a driver renders on demand with renderNow (the
   * studio, whose software GPU can't keep up with requestAnimationFrame and
   * would queue frames behind every screenshot).
   */
  paused = false;

  start(): void {
    const frame = (now: number) => {
      requestAnimationFrame(frame);
      const dt = Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      if (!this.paused) this.frame(dt);
    };
    requestAnimationFrame(frame);
  }

  /** Advance by dt seconds and draw one frame now (for drivers that pause the loop). */
  renderNow(dt = 0): void {
    this.frame(dt);
  }

  private frame(dt: number): void {
    const s = this.settings;
    // Until the lightmap arrives the world would draw flat and fullbright for a
    // moment. Hold the frame instead (a dark screen reads as loading), and
    // compile the shaders meanwhile so the first lit frame doesn't stall.
    if (s.light.enabled && !this.lighting.shownAt && performance.now() < this.holdUntil) {
      if (!this.precompiled) { this.renderer.gl.compile(this.scene, this.renderer.camera); this.precompiled = true; }
      return;
    }
    const [mx, my] = this.input.consumeMouse();
    this.player.look(mx, my, s);

    const tickRate = Math.max(1, s.sim.tickRate);
    const tick = 1 / tickRate;
    this.acc += dt * s.sim.timeScale;
    let steps = 0;
    while (this.acc >= tick && steps < 16) {
      this.player.tick(this.player.buildCmd(this.input), s, tick);
      if (this.level && this.player.state.origin.z < s.hull.voidZ) this.player.respawn(this.level);
      this.input.endTick();
      this.acc -= tick;
      steps++;
    }
    if (steps === 16) this.acc = 0; // fell far behind (tab was hidden): don't spiral

    const alpha = this.acc / tick;
    const eye = this.player.eye(alpha, s);
    const cam = this.renderer.camera;
    cam.position.set(eye.x, eye.y, eye.z);
    this.uploadRects(eye);
    const { forward } = angleVectors(this.player.pitch, this.player.yaw);
    cam.up.set(0, 0, 1);
    cam.lookAt(eye.x + forward.x, eye.y + forward.y, eye.z + forward.z);
    this.sky.follow(cam);
    cam.rotateZ((this.player.roll(s) * Math.PI) / 180);
    const C = s.camera;
    worldUniforms.flashOn.value = C.flash ? 1 : 0;
    worldUniforms.flashPos.value.set(eye.x, eye.y, eye.z + C.flashHeight);
    worldUniforms.flashCandela.value = C.flashCandela;
    worldUniforms.flashDir.value.set(forward.x, forward.y, forward.z);
    // Half-intensity half-angle θ → cos^n beam with cos(θ)^n = 0.5.
    const half = (Math.min(89, Math.max(1, C.flashBeam)) * Math.PI) / 180;
    worldUniforms.flashBeamN.value = C.flashBeam >= 90 ? 0 : Math.log(0.5) / Math.log(Math.cos(half));
    worldUniforms.flashColor.value.set(...kelvinToLinear(C.flashKelvin));

    worldUniforms.time.value = performance.now() / 1000;
    this.renderer.render(this.scene);
    this.onFrame?.(dt);
  }
}
