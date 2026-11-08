import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CollisionWorld } from '../src/engine/collision/trace';
import { boxBrush } from '../src/engine/collision/brush';
import { PlayerMove, DEFAULT_MOVE, newPlayerState, type UserCmd, type MoveParams, type PlayerState, hullMins, hullMaxs } from '../src/engine/movement/pmove';
import { v3, len2d } from '../src/engine/vec3';
import { parseMap } from '../src/data/map';

const DT = 1 / 66;
const cmd = (o: Partial<UserCmd> = {}): UserCmd => ({ forward: 0, side: 0, up: 0, jump: false, duck: false, speed: 'run', pitch: 0, yaw: 0, ...o });

function floorWorld(...extra: ReturnType<typeof boxBrush>[]) {
  return new CollisionWorld([boxBrush(1, v3(-4096, -4096, -16), v3(4096, 4096, 0)), ...extra]);
}

function sim(world: CollisionWorld, ticks: number, c: UserCmd | ((i: number, ps: PlayerState) => UserCmd), start = v3(0, 0, 0.125), p: MoveParams = DEFAULT_MOVE) {
  const pm = new PlayerMove(world);
  const ps = newPlayerState(start);
  const trail: number[] = [start.z];
  for (let i = 0; i < ticks; i++) {
    pm.step(ps, typeof c === 'function' ? c(i, ps) : c, p, DT);
    trail.push(ps.origin.z);
  }
  return { ps, trail };
}

describe('ground', () => {
  it('stands still on the floor without sinking or drifting', () => {
    const { ps } = sim(floorWorld(), 200, cmd(), v3(0, 0, 4));
    expect(ps.onGround).toBe(true);
    expect(ps.origin.z).toBeGreaterThan(0);
    expect(ps.origin.z).toBeLessThan(0.2);
    expect(len2d(ps.velocity)).toBe(0);
  });

  it('accelerates to run speed and no faster, diagonals included', () => {
    expect(len2d(sim(floorWorld(), 200, cmd({ forward: 1 })).ps.velocity)).toBeCloseTo(DEFAULT_MOVE.runSpeed, 0);
    expect(len2d(sim(floorWorld(), 200, cmd({ forward: 1, side: 1 })).ps.velocity)).toBeCloseTo(DEFAULT_MOVE.runSpeed, 0);
  });

  it('crosses brush seams at full speed (no snagging)', () => {
    const tiles = [];
    for (let i = 0; i < 64; i++) tiles.push(boxBrush(i + 1, v3(i * 32, -512, -16), v3(i * 32 + 32, 512, 0)));
    const world = new CollisionWorld(tiles);
    const { ps } = sim(world, 300, cmd({ forward: 1, speed: 'sprint' }), v3(40, 0, 0.125));
    expect(ps.origin.x).toBeGreaterThan(40 + 320 * 300 * DT * 0.85);
    expect(len2d(ps.velocity)).toBeCloseTo(320, 0);
  });
});

describe('walls', () => {
  const wall = boxBrush(2, v3(200, -1000, 0), v3(216, 1000, 200));
  it('stops at a wall', () => {
    const { ps } = sim(floorWorld(wall), 200, cmd({ forward: 1 }));
    expect(ps.origin.x).toBeLessThan(200 - 16);
    expect(ps.origin.x).toBeGreaterThan(200 - 16 - 1);
  });
  it('slides along a wall when moving diagonally into it', () => {
    const { ps } = sim(floorWorld(wall), 200, cmd({ forward: 1, side: -1 })); // yaw 0: forward=+x, left=+y
    expect(ps.origin.y).toBeGreaterThan(300);
    expect(ps.origin.x).toBeLessThan(200 - 16);
  });
});

describe('steps', () => {
  const stepOf = (h: number) => floorWorld(boxBrush(2, v3(100, -200, 0), v3(400, 200, h)));
  it('steps up 18 units', () => {
    expect(sim(stepOf(18), 120, cmd({ forward: 1 })).ps.origin.z).toBeCloseTo(18, 0);
  });
  it('does not step up 20 units', () => {
    expect(sim(stepOf(20), 120, cmd({ forward: 1 })).ps.origin.z).toBeLessThan(1);
  });
  it('climbs a staircase of 8x16 steps smoothly', () => {
    const steps = [];
    for (let i = 0; i < 8; i++) steps.push(boxBrush(10 + i, v3(100 + i * 16, -200, 0), v3(100 + (i + 1) * 16, 200, (i + 1) * 8)));
    steps.push(boxBrush(30, v3(228, -200, 0), v3(600, 200, 64)));
    const { ps } = sim(floorWorld(...steps), 150, cmd({ forward: 1 }));
    expect(ps.origin.z).toBeCloseTo(64, 0);
    expect(ps.origin.x).toBeGreaterThan(300);
  });
  it('stays glued to the floor walking down stairs', () => {
    const steps = [];
    for (let i = 0; i < 8; i++) steps.push(boxBrush(10 + i, v3(100 + i * 16, -200, 0), v3(100 + (i + 1) * 16, 200, 64 - i * 8)));
    const { ps, trail } = sim(floorWorld(boxBrush(9, v3(-200, -200, 0), v3(100, 200, 64)), ...steps), 120, cmd({ forward: 1 }), v3(0, 0, 64.125));
    expect(ps.origin.z).toBeLessThan(1);
    // Never more than a step above the floor below it = never airborne off a step.
    const maxDrop = Math.max(...trail.slice(1).map((z, i) => trail[i] - z));
    expect(maxDrop).toBeLessThanOrEqual(8.5);
  });
});

describe('jumping', () => {
  it('reaches ~57 units with the default impulse', () => {
    const { trail } = sim(floorWorld(), 80, (i) => cmd({ jump: i === 2 }));
    expect(Math.max(...trail)).toBeGreaterThan(55);
    expect(Math.max(...trail)).toBeLessThan(59);
  });
  it('needs a re-press without auto-hop, re-jumps with it', () => {
    const held = (p: MoveParams) => sim(floorWorld(), 200, cmd({ jump: true }), v3(0, 0, 0.125), p).trail;
    const jumps = (t: number[]) => t.filter((z, i) => i > 0 && t[i - 1] < 1 && z >= 1).length;
    expect(jumps(held(DEFAULT_MOVE))).toBe(1);
    expect(jumps(held({ ...DEFAULT_MOVE, autoHop: true }))).toBeGreaterThan(2);
  });
});

describe('air strafing / bhop', () => {
  // A crude strafe bot: turn the view a little each tick and strafe into the turn.
  const strafeRun = (p: MoveParams) => {
    let yaw = 0;
    return sim(floorWorld(), 66 * 6, (i) => {
      if (i < 40) return cmd({ forward: 1, yaw: 0 });
      yaw += 2.2;
      return cmd({ side: -1, yaw, jump: true });
    }, v3(0, 0, 0.125), p).ps;
  };
  it('gains speed past run speed with bhop allowed', () => {
    const ps = strafeRun({ ...DEFAULT_MOVE, autoHop: true, airAccelerate: 100 });
    expect(len2d(ps.velocity)).toBeGreaterThan(DEFAULT_MOVE.runSpeed * 1.5);
  });
  it('landing friction taxes the gain', () => {
    const free = len2d(strafeRun({ ...DEFAULT_MOVE, autoHop: true, airAccelerate: 100 }).velocity);
    const fric = len2d(strafeRun({ ...DEFAULT_MOVE, autoHop: true, airAccelerate: 100, landingFriction: true }).velocity);
    expect(fric).toBeLessThan(free);
  });
  it('jump speed cap 1 removes it entirely', () => {
    const capped = len2d(strafeRun({ ...DEFAULT_MOVE, autoHop: true, airAccelerate: 100, jumpSpeedCap: 1 }).velocity);
    expect(capped).toBeLessThan(DEFAULT_MOVE.runSpeed * 1.2);
  });
});

describe('crouch', () => {
  const crawl = floorWorld(boxBrush(2, v3(100, -200, 48), v3(400, 200, 64)));
  it('cannot walk under a 48-unit ceiling standing', () => {
    expect(sim(crawl, 120, cmd({ forward: 1 })).ps.origin.x).toBeLessThan(100);
  });
  it('can crawl through crouched, and cannot stand up inside', () => {
    const { ps } = sim(crawl, 200, (i) => cmd({ forward: 1, duck: i < 150 }));
    expect(ps.origin.x).toBeGreaterThan(150);
    expect(ps.ducked).toBe(true); // released crouch under the roof: stays crouched
  });
  it('crouch-jumping gets higher than a plain jump', () => {
    const plain = Math.max(...sim(floorWorld(), 80, (i) => cmd({ jump: i === 2 })).trail.map((z) => z));
    // Run up, jump ~60 units before the block, crouch in the air.
    let jumpedAt = -1;
    const { ps } = sim(floorWorld(boxBrush(2, v3(40, -100, 0), v3(200, 100, 64))), 160, (i, st) => {
      if (jumpedAt < 0 && st.origin.x > -60) jumpedAt = i;
      return cmd({ forward: 1, jump: i === jumpedAt, duck: jumpedAt >= 0 && i > jumpedAt && i < jumpedAt + 50 });
    }, v3(-400, 0, 0.125));
    expect(ps.origin.z).toBeCloseTo(64, 0); // landed on a 64 block that a standing jump (57) can't reach
    expect(plain).toBeLessThan(64);
  });
});

describe('test map', () => {
  it('parses, and the player start is not inside a brush', () => {
    const map = parseMap(JSON.parse(readFileSync(new URL('../maps/test_room.json', import.meta.url), 'utf8')));
    const world = new CollisionWorld(map.brushes.filter((b) => b.solid !== false).map((b) => boxBrush(b.id, v3(...b.min), v3(...b.max))));
    const s = map.entities.find((e) => e.class === 'player_start')!;
    // Spawns sit on the floor; the game lifts the player until the hull fits. Make sure that's ~1 unit, not a wall.
    const o = v3(...s.origin);
    let lift = 0;
    while (lift < 64 && world.testPosition(o, hullMins(DEFAULT_MOVE), hullMaxs(DEFAULT_MOVE, false))) { o.z += 1; lift++; }
    expect(lift).toBeLessThanOrEqual(1);
    // Drop to the floor and stand there.
    const { ps } = sim(world, 60, cmd(), o);
    expect(ps.onGround).toBe(true);
  });
});
