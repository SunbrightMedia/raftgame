import {
  type Vec3, v3, copy, set, add, sub, scale, madd, dot, cross, len, len2d, normalize, angleVectors,
} from '../vec3';
import type { CollisionWorld, TraceResult } from '../collision/trace';

/**
 * Every constant the movement uses. Read fresh each tick, so changing a value
 * in the debug panel takes effect on the very next physics step.
 * Units are inches and seconds.
 */
export interface MoveParams {
  gravity: number;
  friction: number;
  stopSpeed: number;
  accelerate: number;
  airAccelerate: number;
  /** Source's 30-unit cap on air wish speed. This is what makes air strafing work. */
  airWishCap: number;
  walkSpeed: number;
  runSpeed: number;
  sprintSpeed: number;
  duckSpeedMul: number;
  jumpImpulse: number;
  /** Holding jump re-jumps the instant you touch the ground. */
  autoHop: boolean;
  /** Apply ground friction on the tick you land even if you jump. On = no bhop. */
  landingFriction: boolean;
  /** HL2-style limiter: on jump, clamp horizontal speed to this x run speed. 0 = off. */
  jumpSpeedCap: number;
  stepHeight: number;
  hullWidth: number;
  standHeight: number;
  duckHeight: number;
  eyeHeight: number;
  duckEyeHeight: number;
  /**
   * Crouching in mid-air pulls the feet up by this fraction of the hull height
   * difference (the head comes down by the rest). 1 = Source, where it is
   * the whole of the crouch-jump bonus.
   */
  airDuckLift: number;
  /** Walkable slope: ground normals with z below this count as walls. */
  minGroundNormalZ: number;
  /** Moving up faster than this means you're not on the ground (Source NON_JUMP_VELOCITY). */
  nonJumpVelocity: number;
  maxVelocity: number;
  noclipSpeed: number;
  noclipAccelerate: number;
  noclipFriction: number;
}

/** Source / CS:S-flavoured defaults. The debug panel exposes all of them. */
export const DEFAULT_MOVE: MoveParams = {
  gravity: 800,
  friction: 4,
  stopSpeed: 100,
  accelerate: 10,
  airAccelerate: 10,
  airWishCap: 30,
  walkSpeed: 110,
  runSpeed: 190,
  sprintSpeed: 320,
  duckSpeedMul: 0.34,
  jumpImpulse: Math.sqrt(2 * 800 * 57), // ≈302: a 57-unit standing jump, as in CS:S
  autoHop: false,
  landingFriction: false,
  jumpSpeedCap: 0,
  stepHeight: 18,
  hullWidth: 32,
  standHeight: 72,
  duckHeight: 36,
  eyeHeight: 64,
  duckEyeHeight: 28,
  airDuckLift: 0.5,
  minGroundNormalZ: 0.7,
  nonJumpVelocity: 140,
  maxVelocity: 3500,
  noclipSpeed: 600,
  noclipAccelerate: 6,
  noclipFriction: 6,
};

/** One tick of player intent, built from input. */
export interface UserCmd {
  /** -1..1 */
  forward: number;
  /** -1..1, positive = right */
  side: number;
  /** -1..1, for noclip flying */
  up: number;
  jump: boolean;
  duck: boolean;
  speed: 'walk' | 'run' | 'sprint';
  pitch: number;
  yaw: number;
}

export interface PlayerState {
  /** Feet, centre of the hull bottom. */
  origin: Vec3;
  velocity: Vec3;
  onGround: boolean;
  groundNormal: Vec3;
  ducked: boolean;
  /** Jump was held last tick (Source's oldbuttons & IN_JUMP). */
  jumpHeld: boolean;
  noclip: boolean;
  /** Set on the tick the player touches down. */
  justLanded: boolean;
  /** Touched down and hasn't had a ground tick yet (for landing friction). */
  landPending: boolean;
  /** Ticks since leaving the ground; handy for HUD/footsteps later. */
  airTicks: number;
  /**
   * How far the origin jumped this tick because of a crouch/uncrouch in the
   * air. The view uses it to stay steady while the hull rearranges itself.
   */
  duckShift: number;
}

export function newPlayerState(origin: Vec3): PlayerState {
  return {
    origin: copy(origin),
    velocity: v3(),
    onGround: false,
    groundNormal: v3(0, 0, 1),
    ducked: false,
    jumpHeld: false,
    noclip: false,
    justLanded: false,
    landPending: false,
    airTicks: 0,
    duckShift: 0,
  };
}

export function hullMins(p: MoveParams): Vec3 {
  const h = p.hullWidth / 2;
  return v3(-h, -h, 0);
}
export function hullMaxs(p: MoveParams, ducked: boolean): Vec3 {
  const h = p.hullWidth / 2;
  return v3(h, h, ducked ? p.duckHeight : p.standHeight);
}

const MAX_CLIP_PLANES = 5;

/**
 * Quake/Source player movement against a CollisionWorld.
 * Structure follows Source's CGameMovement::FullWalkMove closely, because the
 * feel of that code (order of gravity, jump, friction) is what people
 * recognise as "Source movement".
 */
export class PlayerMove {
  constructor(public world: CollisionWorld) {}

  private ps!: PlayerState;
  private p!: MoveParams;
  private dt = 0;

  private trace(start: Vec3, end: Vec3): TraceResult {
    return this.world.trace(start, end, hullMins(this.p), hullMaxs(this.p, this.ps.ducked));
  }

  step(ps: PlayerState, cmd: UserCmd, p: MoveParams, dt: number): void {
    this.ps = ps;
    this.p = p;
    this.dt = dt;
    ps.justLanded = false;
    ps.duckShift = 0;

    if (ps.noclip) {
      this.noclipMove(cmd);
      ps.jumpHeld = cmd.jump;
      return;
    }

    this.duck(cmd);

    this.categorizePosition();

    this.startGravity();

    if (cmd.jump) {
      // Landing friction (bhop off): bleed speed on the landing tick even if a
      // jump is about to happen. Source skips friction when you jump, and that
      // gap is the whole reason bunnyhopping exists.
      if (ps.onGround && ps.landPending && p.landingFriction) this.friction();
      this.checkJump();
    } else {
      ps.jumpHeld = false;
    }
    ps.landPending = false;

    if (ps.onGround) {
      ps.velocity.z = 0;
      this.friction();
    }

    this.clampVelocity();

    const { wishdir, wishspeed } = this.wish(cmd);
    if (ps.onGround) this.walkMove(wishdir, wishspeed);
    else this.airMove(wishdir, wishspeed);

    this.categorizePosition();
    this.clampVelocity();
    this.finishGravity();
    if (ps.onGround) ps.velocity.z = 0;

    ps.airTicks = ps.onGround ? 0 : ps.airTicks + 1;
  }

  // --- input -> wish velocity -------------------------------------------

  private wish(cmd: UserCmd): { wishdir: Vec3; wishspeed: number } {
    const p = this.p;
    const { forward, right } = angleVectors(cmd.pitch, cmd.yaw);
    forward.z = 0; right.z = 0;
    const f = normalize(forward), r = normalize(right);
    let fm = cmd.forward, sm = cmd.side;
    // Diagonal isn't faster: Source clamps the combined wish speed to maxspeed.
    const m = Math.hypot(fm, sm);
    if (m > 1) { fm /= m; sm /= m; }
    let maxspeed = cmd.speed === 'walk' ? p.walkSpeed : cmd.speed === 'sprint' ? p.sprintSpeed : p.runSpeed;
    if (this.ps.ducked && this.ps.onGround) maxspeed *= p.duckSpeedMul;
    const wishvel = v3(f.x * fm + r.x * sm, f.y * fm + r.y * sm, 0);
    const wl = len(wishvel);
    const wishdir = wl > 0 ? scale(wishvel, 1 / wl) : v3();
    return { wishdir, wishspeed: wl * maxspeed };
  }

  // --- gravity / jump ---------------------------------------------------

  private startGravity(): void {
    this.ps.velocity.z -= this.p.gravity * 0.5 * this.dt;
  }
  private finishGravity(): void {
    if (!this.ps.onGround) this.ps.velocity.z -= this.p.gravity * 0.5 * this.dt;
  }

  private checkJump(): void {
    const ps = this.ps, p = this.p;
    if (!ps.onGround) { ps.jumpHeld = true; return; }
    if (ps.jumpHeld && !p.autoHop) return; // must release and press again
    ps.onGround = false;
    if (p.jumpSpeedCap > 0) {
      const cap = p.runSpeed * p.jumpSpeedCap;
      const s = len2d(ps.velocity);
      if (s > cap) { ps.velocity.x *= cap / s; ps.velocity.y *= cap / s; }
    }
    ps.velocity.z = p.jumpImpulse;
    this.finishGravity();
    ps.jumpHeld = true;
  }

  // --- friction / acceleration -----------------------------------------

  private friction(): void {
    const v = this.ps.velocity, p = this.p;
    const speed = len(v);
    if (speed < 0.1) return;
    const control = speed < p.stopSpeed ? p.stopSpeed : speed;
    const drop = control * p.friction * this.dt;
    const ns = Math.max(0, speed - drop) / speed;
    v.x *= ns; v.y *= ns; v.z *= ns;
  }

  private accelerate(wishdir: Vec3, wishspeed: number, accel: number): void {
    const v = this.ps.velocity;
    const current = dot(v, wishdir);
    const add = wishspeed - current;
    if (add <= 0) return;
    const accelspeed = Math.min(accel * this.dt * wishspeed, add);
    v.x += accelspeed * wishdir.x; v.y += accelspeed * wishdir.y; v.z += accelspeed * wishdir.z;
  }

  private airAccelerate(wishdir: Vec3, wishspeed: number, accel: number): void {
    const v = this.ps.velocity;
    // The cap applies to the *target*, not to the acceleration rate. Turning
    // while strafing keeps `current` near zero, so you keep gaining speed.
    const wishspd = Math.min(wishspeed, this.p.airWishCap);
    const current = dot(v, wishdir);
    const add = wishspd - current;
    if (add <= 0) return;
    const accelspeed = Math.min(accel * wishspeed * this.dt, add);
    v.x += accelspeed * wishdir.x; v.y += accelspeed * wishdir.y; v.z += accelspeed * wishdir.z;
  }

  private clampVelocity(): void {
    const v = this.ps.velocity, m = this.p.maxVelocity;
    v.x = Math.max(-m, Math.min(m, v.x));
    v.y = Math.max(-m, Math.min(m, v.y));
    v.z = Math.max(-m, Math.min(m, v.z));
  }

  // --- ground / air moves -------------------------------------------------

  private walkMove(wishdir: Vec3, wishspeed: number): void {
    const ps = this.ps;
    ps.velocity.z = 0;
    this.accelerate(wishdir, wishspeed, this.p.accelerate);
    ps.velocity.z = 0;

    if (len(ps.velocity) < 1) { ps.velocity = v3(); return; }

    const dest = v3(ps.origin.x + ps.velocity.x * this.dt, ps.origin.y + ps.velocity.y * this.dt, ps.origin.z);
    const tr = this.trace(ps.origin, dest);
    if (tr.fraction === 1) {
      set(ps.origin, tr.endpos);
      this.stayOnGround();
      return;
    }
    this.stepMove();
    this.stayOnGround();
  }

  private airMove(wishdir: Vec3, wishspeed: number): void {
    this.airAccelerate(wishdir, wishspeed, this.p.airAccelerate);
    this.tryPlayerMove();
  }

  /**
   * Try the move flat, then try it lifted by a step and set back down, and
   * keep whichever got further horizontally. This is how stairs work with no
   * special stair geometry.
   */
  private stepMove(): void {
    const ps = this.ps, p = this.p;
    const startPos = copy(ps.origin);
    const startVel = copy(ps.velocity);

    this.tryPlayerMove();
    const downPos = copy(ps.origin);
    const downVel = copy(ps.velocity);

    set(ps.origin, startPos);
    set(ps.velocity, startVel);

    let tr = this.trace(ps.origin, v3(ps.origin.x, ps.origin.y, ps.origin.z + p.stepHeight + 0.03125));
    if (!tr.startsolid && !tr.allsolid) set(ps.origin, tr.endpos);
    this.tryPlayerMove();

    tr = this.trace(ps.origin, v3(ps.origin.x, ps.origin.y, ps.origin.z - p.stepHeight - 0.03125));
    if (!tr.startsolid && !tr.allsolid) set(ps.origin, tr.endpos);

    // Stepped onto nothing walkable: the flat attempt wins.
    if (tr.fraction === 1 || tr.normal.z < p.minGroundNormalZ) {
      set(ps.origin, downPos);
      set(ps.velocity, downVel);
      return;
    }

    const downDist = (downPos.x - startPos.x) ** 2 + (downPos.y - startPos.y) ** 2;
    const upDist = (ps.origin.x - startPos.x) ** 2 + (ps.origin.y - startPos.y) ** 2;
    if (downDist > upDist) {
      set(ps.origin, downPos);
      set(ps.velocity, downVel);
    } else {
      ps.velocity.z = downVel.z;
    }
  }

  /** Keep the player glued to the floor walking down stairs instead of skipping off each step. */
  private stayOnGround(): void {
    const ps = this.ps, p = this.p;
    let tr = this.trace(ps.origin, v3(ps.origin.x, ps.origin.y, ps.origin.z + 2));
    const start = tr.endpos;
    tr = this.trace(start, v3(ps.origin.x, ps.origin.y, ps.origin.z - p.stepHeight));
    if (tr.fraction > 0 && tr.fraction < 1 && !tr.startsolid && tr.normal.z >= p.minGroundNormalZ) {
      if (Math.abs(ps.origin.z - tr.endpos.z) > 0.015625) set(ps.origin, tr.endpos);
    }
  }

  /**
   * Slide along up to 4 surfaces in one tick (Source TryPlayerMove / Quake
   * SV_FlyMove). Handles corners by moving along the crease of two planes.
   */
  private tryPlayerMove(): void {
    const ps = this.ps;
    const primal = copy(ps.velocity);
    let original = copy(ps.velocity);
    const planes: Vec3[] = [];
    let timeLeft = this.dt;
    let allFraction = 0;

    for (let bump = 0; bump < 4; bump++) {
      if (len(ps.velocity) === 0) break;
      const end = madd(ps.origin, ps.velocity, timeLeft);
      const tr = this.trace(ps.origin, end);
      allFraction += tr.fraction;

      if (tr.allsolid) { ps.velocity = v3(); return; }
      if (tr.fraction > 0) {
        set(ps.origin, tr.endpos);
        original = copy(ps.velocity);
        planes.length = 0;
      }
      if (tr.fraction === 1) break;

      timeLeft -= timeLeft * tr.fraction;
      if (planes.length >= MAX_CLIP_PLANES) { ps.velocity = v3(); break; }
      planes.push(copy(tr.normal));

      if (planes.length === 1 && !ps.onGround) {
        // In the air against one plane: plain clip (this is what lets you surf
        // ramps and slide along walls mid-jump without losing all speed).
        ps.velocity = clipVelocity(original, planes[0], 1);
        original = copy(ps.velocity);
      } else {
        let i = 0;
        for (; i < planes.length; i++) {
          ps.velocity = clipVelocity(original, planes[i], 1);
          let j = 0;
          for (; j < planes.length; j++) {
            if (j !== i && dot(ps.velocity, planes[j]) < 0) break;
          }
          if (j === planes.length) break;
        }
        if (i === planes.length) {
          // Caught in a crease of two planes: slide along their intersection.
          if (planes.length !== 2) { ps.velocity = v3(); break; }
          const dir = normalize(cross(planes[0], planes[1]));
          ps.velocity = scale(dir, dot(dir, ps.velocity));
        }
        // Don't bounce back the way we came (stops jitter in tight corners).
        if (dot(ps.velocity, primal) <= 0) { ps.velocity = v3(); break; }
      }
    }
    if (allFraction === 0) ps.velocity = v3();
  }

  // --- ground detection ---------------------------------------------------

  private categorizePosition(): void {
    const ps = this.ps;
    const was = ps.onGround;
    this.groundTrace();
    if (!was && ps.onGround) { ps.justLanded = true; ps.landPending = true; }
  }

  private groundTrace(): void {
    const ps = this.ps, p = this.p;
    if (ps.velocity.z > p.nonJumpVelocity) {
      ps.onGround = false;
      return;
    }
    const tr = this.trace(ps.origin, v3(ps.origin.x, ps.origin.y, ps.origin.z - 2));
    if (tr.fraction < 1 && tr.normal.z >= p.minGroundNormalZ && !tr.allsolid) {
      ps.onGround = true;
      ps.groundNormal = copy(tr.normal);
      // Settle onto the floor (HL1 PM_CatagorizePosition) so you never hover.
      if (!tr.startsolid) set(ps.origin, tr.endpos);
    } else {
      ps.onGround = false;
    }
  }

  // --- crouch -------------------------------------------------------------

  private duck(cmd: UserCmd): void {
    const ps = this.ps, p = this.p;
    const lift = (p.standHeight - p.duckHeight) * Math.max(0, Math.min(1, p.airDuckLift));
    if (cmd.duck && !ps.ducked) {
      ps.ducked = true;
      // Crouching in the air pulls the legs up while the head stays (mostly)
      // put, which is why crouch-jumping gets you higher.
      if (!ps.onGround && lift > 0) {
        ps.origin.z += lift;
        ps.duckShift = lift;
        // The shrunk hull may now poke into a ceiling: undo as much as needed.
        if (this.world.testPosition(ps.origin, hullMins(p), hullMaxs(p, true))) { ps.origin.z -= lift; ps.duckShift = 0; }
      }
    } else if (!cmd.duck && ps.ducked) {
      const mins = hullMins(p), standMaxs = hullMaxs(p, false);
      // In the air the feet drop back down first; on the ground the head rises.
      const tries = ps.onGround ? [0] : [lift, 0];
      for (const drop of tries) {
        const pos = v3(ps.origin.x, ps.origin.y, ps.origin.z - drop);
        if (!this.world.testPosition(pos, mins, standMaxs)) {
          ps.origin = pos;
          ps.ducked = false;
          ps.duckShift = -drop;
          return;
        }
      }
    }
  }

  // --- noclip -------------------------------------------------------------

  private noclipMove(cmd: UserCmd): void {
    const ps = this.ps, p = this.p;
    const { forward, right } = angleVectors(cmd.pitch, cmd.yaw);
    let wish = add(scale(forward, cmd.forward), scale(right, cmd.side));
    wish.z += cmd.up;
    const wl = Math.min(1, len(wish));
    wish = normalize(wish);
    const mul = cmd.speed === 'sprint' ? 2.5 : cmd.speed === 'walk' ? 0.3 : 1;
    const wishspeed = wl * p.noclipSpeed * mul;
    const speed = len(ps.velocity);
    if (speed > 0.1) {
      const drop = Math.max(speed, p.stopSpeed) * p.noclipFriction * this.dt;
      ps.velocity = scale(ps.velocity, Math.max(0, speed - drop) / speed);
    }
    this.accelerate(wish, wishspeed, p.noclipAccelerate);
    ps.origin = madd(ps.origin, ps.velocity, this.dt);
    ps.onGround = false;
  }
}

/** Remove the component of `v` going into the plane, then make sure it really is gone. */
export function clipVelocity(v: Vec3, n: Vec3, overbounce: number): Vec3 {
  const backoff = dot(v, n) * overbounce;
  const out = sub(v, scale(n, backoff));
  const adjust = dot(out, n);
  if (adjust < 0) return sub(out, scale(n, adjust));
  return out;
}
