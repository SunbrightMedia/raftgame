import { type MoveParams, type PlayerState, type UserCmd, PlayerMove, newPlayerState, hullMins, hullMaxs } from '../engine/movement/pmove';
import { type Vec3, v3, copy, lerp, len2d } from '../engine/vec3';
import type { Settings } from '../data/settings';
import type { Input } from './input';
import type { Level } from './level';

/** Settings → the flat parameter object the movement code reads every tick. */
export function moveParamsFrom(s: Settings): MoveParams {
  const { duckTime: _dt, ...hull } = s.hull;
  void _dt;
  return { ...s.move, ...hull, noclipAccelerate: 6, noclipFriction: 6, minGroundNormalZ: 0.7, nonJumpVelocity: 140 };
}

/**
 * The player: fixed-tick Source movement plus the presentation layer (smooth
 * crouch view, interpolation between ticks, bob and landing dip). Mouse look
 * is applied every rendered frame, not per tick, so aiming never feels
 * quantised to the tick rate.
 */
export class Player {
  state: PlayerState;
  pitch = 0;
  yaw = 0;
  private move: PlayerMove;
  private prevOrigin: Vec3;
  private eyeOffset = 64;
  private bobPhase = 0;
  private dip = 0;
  private dipVel = 0;
  private lastVz = 0;
  params: MoveParams;

  constructor(level: Level, settings: Settings) {
    this.params = moveParamsFrom(settings);
    this.move = new PlayerMove(level.collision);
    this.state = newPlayerState(level.spawn.origin);
    this.prevOrigin = copy(this.state.origin);
    this.respawn(level);
  }

  setLevel(level: Level): void {
    this.move.world = level.collision;
    this.respawn(level);
  }

  respawn(level: Level): void {
    const keepNoclip = this.state.noclip;
    // Spawns are placed at floor level; lift to the first spot the hull fits.
    const o = copy(level.spawn.origin);
    for (let i = 0; i < 64 && level.collision.testPosition(o, hullMins(this.params), hullMaxs(this.params, false)); i++) o.z += 1;
    this.state = newPlayerState(o);
    this.state.noclip = keepNoclip;
    this.prevOrigin = copy(this.state.origin);
    this.yaw = level.spawn.yaw;
    this.pitch = level.spawn.pitch;
    this.eyeOffset = this.params.eyeHeight;
  }

  /** Called every rendered frame. */
  look(dx: number, dy: number, s: Settings): void {
    const k = s.view.sensitivity * 0.022;
    this.yaw -= dx * k;
    this.pitch += dy * k * (s.view.invertY ? -1 : 1);
    this.pitch = Math.max(-89, Math.min(89, this.pitch));
    this.yaw = ((this.yaw % 360) + 360) % 360;
  }

  buildCmd(input: Input): UserCmd {
    const f = (input.heldOrLatched('forward') ? 1 : 0) - (input.heldOrLatched('back') ? 1 : 0);
    const r = (input.heldOrLatched('right') ? 1 : 0) - (input.heldOrLatched('left') ? 1 : 0);
    const noclip = this.state.noclip;
    const jump = input.heldOrLatched('jump') || input.consumeWheelJump();
    return {
      forward: f,
      side: r,
      up: noclip ? (input.held('flyUp') ? 1 : 0) - (input.held('flyDown') ? 1 : 0) : 0,
      jump,
      duck: !noclip && input.held('duck'),
      speed: input.held('sprint') ? 'sprint' : input.held('walk') ? 'walk' : 'run',
      pitch: this.pitch,
      yaw: this.yaw,
    };
  }

  tick(cmd: UserCmd, s: Settings, dt: number): void {
    this.params = moveParamsFrom(s);
    this.prevOrigin = copy(this.state.origin);
    const vzBefore = this.lastVz;
    this.move.step(this.state, cmd, this.params, dt);
    const st = this.state;

    // Air crouch moved the origin; keep the eye exactly where it was.
    if (st.duckShift !== 0) {
      this.prevOrigin.z += st.duckShift;
      this.eyeOffset -= st.duckShift;
    }

    if (st.justLanded && s.view.landDip > 0) {
      // Impulse sized so the critically damped spring below peaks at ~landDip units for a hard landing.
      this.dipVel -= s.view.landDip * Math.min(1, Math.max(0, -vzBefore / 500)) * Math.sqrt(180) * Math.E;
    }
    this.lastVz = st.velocity.z;

    // Crouch view: ease the eye toward its target height.
    const target = st.ducked ? this.params.duckEyeHeight : this.params.eyeHeight;
    const rate = Math.abs(this.params.eyeHeight - this.params.duckEyeHeight) / Math.max(0.001, s.hull.duckTime);
    const diff = target - this.eyeOffset;
    this.eyeOffset += Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);

    // One step per whole bobPhase: a cadence in Hz, scaled by speed (√, so walking is
    // only a little slower than running, as with real footsteps).
    if (st.onGround && !st.noclip) this.bobPhase += s.view.bobRate * Math.sqrt(Math.min(1, len2d(st.velocity) / Math.max(1, this.params.runSpeed))) * dt;

    // Landing dip: critically damped spring back to zero.
    const k = 180, c = 2 * Math.sqrt(k);
    this.dipVel += (-k * this.dip - c * this.dipVel) * dt;
    this.dip += this.dipVel * dt;
  }

  /** Eye position for rendering, `alpha` (0..1) between the last two ticks. */
  eye(alpha: number, s: Settings): Vec3 {
    const o = s.sim.interpolate ? lerp(this.prevOrigin, this.state.origin, alpha) : copy(this.state.origin);
    const speedFrac = Math.min(1, len2d(this.state.velocity) / Math.max(1, this.params.runSpeed));
    const g = this.state.onGround && !this.state.noclip ? speedFrac : 0;
    const ph = this.bobPhase * Math.PI;
    // Handheld: the view dips at each footfall (bobPhase is whole at a step)...
    const bob = (0.5 - Math.abs(Math.cos(ph))) * 2 * s.view.viewBob * g;
    // ...and sways left/right once every two steps.
    const sway = Math.sin(ph) * s.view.viewSway * g;
    const yaw = (this.yaw * Math.PI) / 180;
    return v3(o.x + Math.sin(yaw) * sway, o.y - Math.cos(yaw) * sway, o.z + this.eyeOffset + bob + this.dip);
  }

  /** Camera roll in degrees from the handheld sway. */
  roll(s: Settings): number {
    const speedFrac = Math.min(1, len2d(this.state.velocity) / Math.max(1, this.params.runSpeed));
    const g = this.state.onGround && !this.state.noclip ? speedFrac : 0;
    return Math.sin(this.bobPhase * Math.PI) * s.view.viewRoll * g;
  }
}
