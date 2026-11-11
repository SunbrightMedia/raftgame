import * as THREE from 'three';
import * as assets from '@globs';
import type { Storage } from '../data/storage';
import type { ConfigStore } from '../data/config';
import { type Settings, DEFAULT_SETTINGS, cloneSettings } from '../data/settings';
import { parseMap, type MapFile } from '../data/map';
import { LowResRenderer } from '../engine/render/renderer';
import { TextureRegistry } from '../engine/render/textures';
import { ModelRegistry } from '../engine/render/models';
import { propMaterials } from '../engine/render/propMeshes';
import { glowTextures } from '../engine/render/glows';
import { propModel } from '../engine/collision/props';
import { worldUniforms, MAX_RECTS } from '../engine/render/worldMaterial';
import { fogUniforms, fogAt, fogReach, fogThickness, FogBackdrop } from '../engine/render/fog';
import { lightGridUniforms, setLightGrid } from '../engine/render/lightGrid';
import { mapLamps } from '../engine/render/mapLamps';
import { LotWorld } from './lotWorld';
import { LOT_SIZE } from '../world/lotBuild';
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
  /** Parts of the map with fog of their own (fog_volume entities): the fog is the one where the camera is. */
  private fogVolumes: { min: number[]; max: number[]; fog: Record<string, unknown> }[] = [];
  /** The fog of the volume the camera was last in, and how far the fog has gone over to it (0..1). */
  private fogInside: Record<string, unknown> | null = null;
  private fogMix = 0;
  /** The lamp grid of the map loaded (lamps, cells with lamps, cells with more lamps than they can hold). */
  /** A world with no edge, held as lots round the player (lotWorld.ts); null for a map. */
  lots: LotWorld | null = null;
  private lotStart: ((i: number, j: number) => [number, number, number]) | null = null;
  lampStats = { lamps: 0, cells: 0, entries: 0, full: 0, chains: 0, longest: 0, cut: 0, lost: 0, airs: 0, thin: 0 };
  readonly sky = new Sky();
  readonly fogBackdrop = new FogBackdrop();
  private precompiled = false;

  constructor(canvas: HTMLCanvasElement, private storage: Storage, readonly config: ConfigStore) {
    this.scene.add(this.sky.mesh);
    this.scene.add(this.fogBackdrop.mesh);
    this.renderer = new LowResRenderer(canvas);
    this.lighting = new Lighting(storage);
    this.input = new Input(canvas);
    this.lighting.onPropLight = (colors, offsets) => this.level?.setPropLight(colors, offsets);
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
    this.renderer.targetFps = s.render.targetFps;
    this.renderer.minHeight = s.render.minHeight;
    this.renderer.depthFirst = s.render.depthFirst;
    this.renderer.cameraOver = s.camera.over;
    this.renderer.camera_ = s.camera;
    this.renderer.camcorder = s.camera.model === 'camcorder' ? { ...s.camcorder } : null;
    const C = s.camera;
    // Source's non-HDR path: fixed brightness (scale 1 unless set), no bloom, plain 2.2 gamma.
    const hdr = C.sourceHdr;
    this.renderer.sourceCamera = C.model === 'source' ? {
      autoExposure: hdr && C.autoExposure, scale: C.sourceScale, min: C.sourceExposureMin, max: C.sourceExposureMax, bloomScale: hdr ? C.sourceBloom : 0,
      rate: C.adaptSpeed, percentBright: 2, percentTarget: 60, minAvgLum: 3, gamma22: !hdr,
    } : null;
    worldUniforms.gamma22.value = C.model === 'source' && !hdr ? 1 : 0;
    this.lighting.reencode(C.model === 'source' && !hdr);
    this.renderer.sourceUnit = worldUniforms.sourceUnit.value;
    this.renderer.setSourceFov(s.view.fov);
    const recrushed = this.textures.setCrush(s.textures, s.render.textureFilter as 'nearest' | 'linear');
    if (recrushed && this.level) this.level.rebuild();
    if (this.level) this.lighting.request(this.level, s, this.textures);
    this.updateLightUniforms(s);
    worldUniforms.faceShade.value = s.render.faceShade;
    worldUniforms.brightness.value = s.render.brightness;
    // Lamps without a bake: the light from everywhere, in the lamps' units (300 = fully lit; colour as typed, gamma 2.2).
    const amb = new THREE.Color(s.light.lampAmbientColor);
    lightGridUniforms.lgAmbient.value.set(Math.pow(amb.r, 2.2), Math.pow(amb.g, 2.2), Math.pow(amb.b, 2.2)).multiplyScalar(s.light.lampAmbient);
    lightGridUniforms.lgAmbientUp.value = s.light.lampAmbientUp;
    lightGridUniforms.lgScale.value = s.light.lampScale;
    this.updateFog(s);
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

  /**
   * The fog in force: the map's, or part-way (fogMix) to the fog of the volume
   * the camera is in. Numbers and colours go over smoothly; switches change
   * half-way.
   */
  private fogNow(base: Settings['fog']): Settings['fog'] {
    const k = this.fogMix, over = this.fogInside;
    if (k <= 0 || !over) return base;
    const out = { ...base } as Record<string, unknown>;
    for (const [key, v] of Object.entries(over)) {
      const b = (base as Record<string, unknown>)[key];
      if (typeof v === 'number' && typeof b === 'number') out[key] = b + (v - b) * k;
      else if (typeof v === 'string' && typeof b === 'string' && v.startsWith('#')) out[key] = `#${new THREE.Color(b).lerp(new THREE.Color(v), k).getHexString()}`;
      else if (k > 0.5) out[key] = v;
    }
    return out as Settings['fog'];
  }

  /**
   * Fog uniforms from the settings, and the void behind everything drawn as the
   * fog at its densest. Source fog with two colours depends on where the camera
   * looks (c_baseplayer.cpp GetFogColor), so this also runs every frame.
   */
  private updateFog(s: Settings, forward?: { x: number; y: number; z: number }): void {
    const F = this.fogNow(s.fog), u = fogUniforms;
    u.fogOn.value = F.enabled ? 1 : 0;
    u.fogNear.value = F.near;
    u.fogFar.value = F.far;
    u.fogMaxDensity.value = F.maxDensity;
    u.fogHaze.value = F.haze && !F.source ? 1 : 0;
    u.fogSquare.value = F.source ? 1 : 0;
    const c = new THREE.Color(F.color);
    if (F.source && F.blend && forward) {
      // Blended as Source does, on the colours as typed (not linear light).
      const p = (F.dirPitch * Math.PI) / 180, y = (F.dirYaw * Math.PI) / 180;
      const k = 0.5 * (forward.x * Math.cos(p) * Math.cos(y) + forward.y * Math.cos(p) * Math.sin(y) - forward.z * Math.sin(p)) + 0.5;
      const c2 = new THREE.Color(F.color2);
      c.setRGB(c.r * k + c2.r * (1 - k), c.g * k + c2.g * (1 - k), c.b * k + c2.b * (1 - k));
    }
    const gamma22 = F.source || worldUniforms.gamma22.value > 0.5;
    const lin = (v: number) => (gamma22 ? Math.pow(v, 2.2) : v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    const lum = F.source ? worldUniforms.sourceUnit.value * F.hdrScale : F.luminance;
    const radiance = (hex: string, into: THREE.Vector3) => { const k = new THREE.Color(hex); into.set(lin(k.r) * lum, lin(k.g) * lum, lin(k.b) * lum); };
    u.fogRadiance.value.set(lin(c.r) * lum, lin(c.g) * lum, lin(c.b) * lum);
    // Layers: the start, then three distances in rising order, each with how much it hides and its colour.
    u.fogLayers.value = F.layers ? 1 : 0;
    if (F.layers) u.fogSquare.value = 0;
    const d1 = Math.max(F.near + 1, F.d1), d2 = Math.max(d1 + 1, F.d2), d3 = Math.max(d2 + 1, F.d3);
    u.fogStopD.value.set(F.near, d1, d2, d3);
    const t1 = fogThickness(F.a1), t2 = Math.max(t1, fogThickness(F.a2)), t3 = Math.max(t2, fogThickness(F.a3));   // fog only ever adds up
    u.fogStopA.value.set(0, t1, t2, t3);
    radiance(F.c1, u.fogStopC.value[0]); radiance(F.c2, u.fogStopC.value[1]); radiance(F.c3, u.fogStopC.value[2]);
    // Height: where each begins, how far to full strength, how much thicker, how much of its colour.
    u.fogLow.value.set(F.lowTop, Math.max(1, F.lowDepth), F.lowOn ? F.lowThicken : 0, F.lowOn ? F.lowTint : 0);
    u.fogHigh.value.set(F.highBase, Math.max(1, F.highRise), F.highOn ? F.highThicken : 0, F.highOn ? F.highTint : 0);
    radiance(F.lowColor, u.fogLowC.value); radiance(F.highColor, u.fogHighC.value);
    // Behind everything: the fog at its end in every direction (FogBackdrop), over the void's own colour.
    const clear = new THREE.Color(s.render.clearColor);
    const voidRadiance = new THREE.Vector3(lin(clear.r), lin(clear.g), lin(clear.b)).multiplyScalar(F.enabled ? 0 : 1);
    this.fogBackdrop.set(F.enabled && !this.sky.mesh.visible, voidRadiance);
    if (F.enabled) {
      const f = fogAt(1e9), r = F.layers ? u.fogStopC.value[2] : u.fogRadiance.value;
      this.renderer.setClearRadiance(r.x * f, r.y * f, r.z * f);
    } else this.renderer.setClearColor(s.render.clearColor);
    this.renderer.distanceBlur = F.enabled && F.blur > 0 ? { radius: F.blur, start: F.blurStart, end: Math.max(F.blurStart + 1, F.blurEnd) } : null;
  }

  async loadMapPath(path: string): Promise<void> {
    // "world:<name>:<seed>": made here by that world's generator, not read from a file.
    // A square of the world built as one map. With ":endless" after it (NOT FINISHED, not yet checked: off unless
    // asked for): the world has no edge and is loaded as lots round the player as they move (lotWorld.ts).
    const world = /^world:([a-z]+):(\d+)(:endless)?$/.exec(path);
    if (world) {
      const endless = world[3] ? assets.lots[world[1]] : undefined;
      const make = assets.worlds[world[1]];
      if (!make && !endless) throw new Error(`no such world in this build: ${world[1]}`);
      this.mapPath = path;
      if (!endless) { await this.setMap(parseMap(make(Number(world[2]))), path); return; }
      const seed = Number(world[2]), start = endless.start(seed, 0, 0);
      await this.setMap(parseMap({ format: 'liminal-map', version: 1, name: path, settings: endless.settings, brushes: [], entities: [{ id: 1, class: 'player_start', origin: start, angles: [0, 0, 0] }] }), path);
      const lots = this.lots = new LotWorld(seed, this.renderer.gl, this.textures, this.models);
      this.lotStart = (i, j) => endless.start(seed, i, j);
      this.scene.add(lots.root);
      this.level!.collision = lots.collision;
      this.player.refreshWorld(this.level!);
      await lots.start({ x: start[0], y: start[1] });
      if (this.lots === lots) this.player.respawn(this.level!);
      this.mapLabel = `${path}: a world of lots, ${lots.stats.workers || 'no'} worker${lots.stats.workers === 1 ? '' : 's'}`;
      return;
    }
    const text = await this.storage.read(path);
    if (text === null) throw new Error(`map not found: ${path}`);
    this.mapPath = path;
    await this.setMap(parseMap(JSON.parse(text)), path);
  }

  async setMap(map: MapFile, label: string): Promise<void> {
    const t0 = performance.now();
    if (this.lots) { this.lots.dispose(); this.lots = null; this.lotStart = null; }
    await this.models.prepare(map.entities.map(propModel).filter((m): m is string => !!m));
    const texNames = [
      ...map.brushes.flatMap((b) => [b.tex ?? 'dev/gray', ...Object.values(b.faces ?? {}).map((f) => f?.tex ?? '')]).filter(Boolean),
      ...propMaterials(map.entities, this.models),
      ...glowTextures(map.entities),
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
    // Lamps worked out per pixel, with no bake (lightGrid.ts): for worlds made in the page.
    const L = mapLamps(map.entities);
    this.lampStats = setLightGrid(L.lamps, L.shades, L.airs);
    this.fogVolumes = map.entities.filter((e) => e.class === 'fog_volume').map((e) => ({ min: e.props?.min as number[], max: e.props?.max as number[], fog: (e.props?.fog ?? {}) as Record<string, unknown> }));
    this.fogInside = null;
    this.fogMix = 0;
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
  /** Extra camera roll in degrees (tools matching a screenshot taken with a tilted view). */
  viewRoll = 0;

  /** Move a brush entity (elevator, door...) and what's parented to it; see Level.setMover. */
  setMover(name: string, offset: [number, number, number]): void {
    if (!this.level) return;
    this.level.setMover(name, offset);
    this.player?.refreshWorld(this.level);
    this.lighting.relightProps(this.level);
  }

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
      if (this.level && this.player.state.origin.z < s.hull.voidZ) {
        // Fallen out of the world. In a world of lots: back to the crossing at the corner of the lot fallen from (the world's own start may be far off, and not loaded).
        const o = this.player.state.origin;
        if (this.lotStart) { const p = this.lotStart(Math.floor(o.x / LOT_SIZE), Math.floor(o.y / LOT_SIZE)); this.level.spawn.origin = { x: p[0], y: p[1], z: p[2] }; }
        this.player.respawn(this.level);
      }
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
    this.fogBackdrop.follow(cam);
    cam.rotateZ(((this.player.roll(s) + this.viewRoll) * Math.PI) / 180);
    // A camera held by hand: slow drift in turn, tilt and roll (overlapping waves, never repeating exactly).
    const hh = s.view.handheld;
    if (hh > 0) {
      const t = performance.now() / 1000, w = (f: number, ph: number) => Math.sin(t * f * 2 * Math.PI + ph);
      const d2r = Math.PI / 180;
      cam.rotateY(hh * d2r * (0.6 * w(0.37, 0.3) + 0.3 * w(0.83, 1.1) + 0.1 * w(1.9, 2.3)));
      cam.rotateX(hh * d2r * 0.8 * (0.6 * w(0.29, 2.0) + 0.3 * w(0.71, 0.4) + 0.1 * w(2.3, 1.4)));
      cam.rotateZ(hh * d2r * 0.5 * (0.7 * w(0.23, 0.9) + 0.3 * w(0.61, 2.7)));
    }
    const C = s.camera;
    worldUniforms.flashOn.value = C.flash ? 1 : 0;
    worldUniforms.flashPos.value.set(eye.x, eye.y, eye.z + C.flashHeight);
    worldUniforms.flashCandela.value = C.flashCandela;
    worldUniforms.flashDir.value.set(forward.x, forward.y, forward.z);
    // Half-intensity half-angle θ → cos^n beam with cos(θ)^n = 0.5.
    const half = (Math.min(89, Math.max(1, C.flashBeam)) * Math.PI) / 180;
    worldUniforms.flashBeamN.value = C.flashBeam >= 90 ? 0 : Math.log(0.5) / Math.log(Math.cos(half));
    worldUniforms.flashColor.value.set(...kelvinToLinear(C.flashKelvin));

    this.lots?.update(this.player.state.origin);
    // Fog of its own inside some parts of the map: go over to it (and back) in under half a second.
    const vol = this.lots ? this.lots.fogAt(cam.position) : this.fogVolumes.find((v) => eye.x > v.min[0] && eye.x < v.max[0] && eye.y > v.min[1] && eye.y < v.max[1] && eye.z > v.min[2] && eye.z < v.max[2])?.fog;
    if (vol) this.fogInside = vol;
    const want = vol ? 1 : 0;
    const moving = this.fogMix !== want;
    if (moving) this.fogMix += Math.sign(want - this.fogMix) * Math.min(Math.abs(want - this.fogMix), dt > 0 ? dt / 0.4 : 1);
    if (moving || (s.fog.source && s.fog.blend)) this.updateFog(s, forward);
    this.level?.cull(cam.position, fogReach(0.985), s.render.detailDistance);
    this.lots?.cull(cam.position, fogReach(0.985), s.render.detailDistance);
    worldUniforms.time.value = performance.now() / 1000;
    this.renderer.render(this.scene);
    this.onFrame?.(dt);
  }
}
