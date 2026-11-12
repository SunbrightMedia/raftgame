import type { Settings } from '../data/settings';
import type { Player } from '../game/player';
import { len2d } from '../engine/vec3';

/** Crosshair, speedometer, FPS, debug readout. Plain DOM over the canvas. */
export class Hud {
  private cross = div('hud-cross');
  private speed = div('hud-speed');
  private info = div('hud-info');
  private prompt = div('hud-prompt');
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fps = 0;
  private topSpeed = 0;
  private topTimer = 0;

  constructor() {
    document.body.append(this.cross, this.speed, this.info, this.prompt);
    this.prompt.innerHTML = 'click to play<br><span>WASD move · Space jump · C crouch · Shift sprint · Alt walk · V noclip · R respawn · ` tweak panel</span>';
  }

  update(dt: number, s: Settings, p: Player, locked: boolean, panelOpen: boolean, renderSize: { x: number; y: number }, tickRate: number, stats?: { calls: number; triangles: number; frameMs: number; aa: number; gpu: string }, note = ''): void {
    this.fpsAcc += dt; this.fpsFrames++;
    if (this.fpsAcc >= 0.5) { this.fps = this.fpsFrames / this.fpsAcc; this.fpsAcc = 0; this.fpsFrames = 0; }

    const v = len2d(p.state.velocity);
    // Top speed of the current run of airtime, held briefly, so bhop gains are readable.
    this.topTimer -= dt;
    if (v > this.topSpeed || this.topTimer <= 0) { this.topSpeed = v; this.topTimer = 1.5; }

    this.cross.style.display = s.hud.crosshair && locked ? '' : 'none';
    this.speed.style.display = s.hud.speed ? '' : 'none';
    this.speed.textContent = `${Math.round(v)}`;
    this.speed.title = 'horizontal speed, u/s';
    this.prompt.style.display = locked || panelOpen ? 'none' : '';

    const lines: string[] = [];
    if (s.hud.fps) {
      lines.push(`${this.fps.toFixed(0)} fps · ${renderSize.x}×${renderSize.y} · ${tickRate} Hz${stats ? ` · ${stats.frameMs.toFixed(1)} ms · AA ${stats.aa} · ${(stats.triangles / 1e6).toFixed(2)} M tris · ${stats.calls} draws` : ''}`);
      if (stats?.gpu) lines.push(stats.gpu);
    }
    if (s.hud.position) {
      const o = p.state.origin, st = p.state;
      lines.push(
        `pos ${o.x.toFixed(1)} ${o.y.toFixed(1)} ${o.z.toFixed(1)}`,
        `vel ${st.velocity.x.toFixed(0)} ${st.velocity.y.toFixed(0)} ${st.velocity.z.toFixed(0)}  peak ${Math.round(this.topSpeed)}`,
        `ang ${p.pitch.toFixed(1)} ${p.yaw.toFixed(1)}`,
        `${st.noclip ? 'NOCLIP' : st.onGround ? 'ground' : 'air'}${st.ducked ? ' · ducked' : ''}`,
      );
    }
    if (note) lines.push(note);   // e.g. the Blender camera compiling, or why it is off
    this.info.textContent = lines.join('\n');
    this.info.style.display = lines.length ? '' : 'none';
  }
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}
