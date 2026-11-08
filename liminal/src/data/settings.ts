import { type Schema, type Values, num, bool, select, color, defaultsOf, coerce, type Def } from './schema';
import { DEFAULT_MOVE as M } from '../engine/movement/pmove';

/**
 * Everything that affects the feel lives here. All of it is live-editable in
 * the debug panel (` key) and saved to config/settings.json.
 *
 * Later milestones add categories here (post-processing, audio, lighting)
 * and maps will be able to override any of them per map.
 */
export const SETTINGS = {
  move: {
    label: 'Movement',
    help: 'Quake/Source player physics. Units are inches; 1 unit ≈ 1 inch.',
    defs: {
      runSpeed: num('Run speed', M.runSpeed, 0, 1000, 5, 'Default move speed. HL2 190, CS:S 250, Quake 320.', 'u/s'),
      walkSpeed: num('Walk speed (Alt)', M.walkSpeed, 0, 1000, 5, undefined, 'u/s'),
      sprintSpeed: num('Sprint speed (Shift)', M.sprintSpeed, 0, 1500, 5, undefined, 'u/s'),
      duckSpeedMul: num('Crouch speed ×', M.duckSpeedMul, 0, 1, 0.01),
      accelerate: num('Ground accelerate', M.accelerate, 0, 100, 0.5, 'sv_accelerate. Higher = snappier starts.'),
      friction: num('Ground friction', M.friction, 0, 20, 0.1, 'sv_friction. Lower = icy.'),
      stopSpeed: num('Stop speed', M.stopSpeed, 0, 500, 5, 'sv_stopspeed. Below this speed friction acts as if you were going this fast, so you stop crisply.'),
      airAccelerate: num('Air accelerate', M.airAccelerate, 0, 1000, 1, 'sv_airaccelerate. 10 = HL2-ish, 100 = bhop server, 1000 = surf.'),
      airWishCap: num('Air wish-speed cap', M.airWishCap, 0, 500, 1, 'Source caps air wish speed at 30. Air strafing depends on this; raise it for floatier air control.'),
      gravity: num('Gravity', M.gravity, 0, 3000, 10, 'sv_gravity', 'u/s²'),
      jumpImpulse: num('Jump impulse', Math.round(M.jumpImpulse * 10) / 10, 0, 1500, 1, '≈302 gives a 57-unit standing jump (CS:S). Jump height = v²/(2g).', 'u/s'),
      autoHop: bool('Auto-hop', M.autoHop, 'Holding jump re-jumps on the first ground tick. Otherwise you must re-press (scroll-wheel jump works too).'),
      landingFriction: bool('Friction on landing tick', M.landingFriction, 'Apply one tick of ground friction when you land, even if you jump on that tick. Source skips it, which is why bhop works. A mild tax; for no bhop at all use the jump speed cap.'),
      jumpSpeedCap: num('Jump speed cap ×run', M.jumpSpeedCap, 0, 5, 0.05, 'Bhop off switch. On each jump, horizontal speed is clamped to this × run speed. 0 = off (bhop works), 1 = no gain from bhop at all, 1.1 ≈ HL2 retail.'),
      stepHeight: num('Step height', M.stepHeight, 0, 64, 1, undefined, 'u'),
      maxVelocity: num('Max velocity', M.maxVelocity, 100, 10000, 50, 'sv_maxvelocity, per axis', 'u/s'),
      noclipSpeed: num('Noclip speed (V)', M.noclipSpeed, 50, 5000, 10, undefined, 'u/s'),
    },
  },
  hull: {
    label: 'Player hull',
    defs: {
      hullWidth: num('Hull width', M.hullWidth, 8, 128, 1, undefined, 'u'),
      standHeight: num('Hull height', M.standHeight, 16, 160, 1, undefined, 'u'),
      duckHeight: num('Crouched height', M.duckHeight, 8, 160, 1, undefined, 'u'),
      eyeHeight: num('Eye height', M.eyeHeight, 8, 160, 1, undefined, 'u'),
      duckEyeHeight: num('Crouched eye height', M.duckEyeHeight, 4, 160, 1, undefined, 'u'),
      airDuckLift: num('Air crouch lift', M.airDuckLift, 0, 1, 0.05, 'Crouching mid-air lifts your feet by this fraction of (hull − crouched height). 1 = Source (big crouch-jumps with a 36 crouch hull), 0 = none.'),
      duckTime: num('Crouch view time', 0.15, 0, 1, 0.01, 'How long the view takes to lower/raise. Visual only.', 's'),
    },
  },
  view: {
    label: 'View & mouse',
    defs: {
      fov: num('FOV (Source-style)', 90, 50, 130, 1, 'Horizontal FOV at 4:3, like Source fov_desired. Widescreen gets more, like Source does.', '°'),
      sensitivity: num('Sensitivity', 2.0, 0.05, 20, 0.05, 'Same scale as Source: degrees = counts × sensitivity × 0.022.'),
      invertY: bool('Invert Y', false),
      rawInput: bool('Raw mouse input', true, 'Ask the browser for unaccelerated mouse movement (Chrome/Edge).'),
      viewBob: num('View bob', 0, 0, 4, 0.05, 'HL2-ish head bob while walking. 0 = none (Source default).', 'u'),
      landDip: num('Landing dip', 0, 0, 16, 0.5, 'View dips briefly when you land.', 'u'),
    },
  },
  sim: {
    label: 'Simulation',
    defs: {
      tickRate: num('Tick rate', 66, 10, 300, 1, 'Physics ticks per second. Source servers: 66 or 100. Higher = slightly more air-strafe gain.', 'Hz'),
      interpolate: bool('Interpolate view', true, 'Smooth the camera between ticks. Turn off to see raw ticks.'),
      timeScale: num('Time scale', 1, 0.05, 4, 0.05, 'host_timescale'),
    },
  },
  render: {
    label: 'Render',
    help: 'The full look panel (grading, grain, bloom) arrives in Milestone 3.',
    defs: {
      internalHeight: num('Internal resolution (lines)', 480, 0, 2160, 1, 'The game renders this many lines tall and upscales. 0 = native.', 'px'),
      upscale: select('Upscale filter', 'linear', ['nearest', 'linear'] as const, 'nearest = crunchy pixels, linear = soft CRT-ish.'),
      faceShade: num('Face shading', 0.6, 0, 1, 0.01, 'Fake directional shading per face direction (fullbright Hammer look). 0 = flat, 1 = strong.'),
      brightness: num('Brightness', 1, 0, 3, 0.01),
      textureFilter: select('Texture filter', 'nearest', ['nearest', 'linear'] as const, 'nearest = crisp texels (retro), linear = smooth.'),
      clearColor: color('Void colour', '#0b0c0e'),
    },
  },
  fog: {
    label: 'Fog',
    defs: {
      enabled: bool('Fog', true),
      color: color('Fog colour', '#16181c'),
      near: num('Fog start', 400, 0, 20000, 10, undefined, 'u'),
      far: num('Fog end', 5000, 1, 40000, 10, undefined, 'u'),
    },
  },
  hud: {
    label: 'HUD',
    defs: {
      crosshair: bool('Crosshair', true),
      speed: bool('Speedometer', true),
      fps: bool('FPS', false),
      position: bool('Position / state', false),
    },
  },
} satisfies Schema;

export type Settings = Values<typeof SETTINGS>;

export const DEFAULT_SETTINGS: Settings = defaultsOf(SETTINGS);

/** A partial, nested settings object: what files store (only non-default values). */
export type SettingsPatch = { [C in keyof Settings]?: Partial<Settings[C]> };

export function cloneSettings(s: Settings): Settings {
  return JSON.parse(JSON.stringify(s));
}

export function applyPatch(target: Settings, patch: unknown): void {
  if (!patch || typeof patch !== 'object') return;
  const t = target as unknown as Record<string, Record<string, unknown>>;
  for (const [c, vals] of Object.entries(patch as Record<string, unknown>)) {
    const cat = (SETTINGS as Schema)[c];
    if (!cat || !vals || typeof vals !== 'object') continue;
    for (const [k, v] of Object.entries(vals as Record<string, unknown>)) {
      const d: Def | undefined = cat.defs[k];
      if (!d) continue;
      const cv = coerce(d, v);
      if (cv !== undefined) t[c][k] = cv;
    }
  }
}

/** Only the values that differ from `base` — keeps saved files short and lets code defaults evolve. */
export function diffSettings(s: Settings, base: Settings = DEFAULT_SETTINGS): SettingsPatch {
  const out: Record<string, Record<string, unknown>> = {};
  const a = s as unknown as Record<string, Record<string, unknown>>;
  const b = base as unknown as Record<string, Record<string, unknown>>;
  for (const c of Object.keys(a)) {
    for (const k of Object.keys(a[c])) {
      if (a[c][k] !== b[c]?.[k]) (out[c] ??= {})[k] = a[c][k];
    }
  }
  return out as SettingsPatch;
}

/**
 * Movement presets: a starting point, then tune from there.
 * Applying one only touches the movement values listed.
 */
export const MOVE_PRESETS: Record<string, SettingsPatch> = {
  'Source (HL2-ish)': {
    move: { runSpeed: 190, walkSpeed: 110, sprintSpeed: 320, accelerate: 10, airAccelerate: 10, friction: 4, stopSpeed: 100, autoHop: false, landingFriction: false, jumpSpeedCap: 0, airWishCap: 30 },
  },
  'CS:S': {
    move: { runSpeed: 250, walkSpeed: 130, sprintSpeed: 250, accelerate: 5, airAccelerate: 10, friction: 4, stopSpeed: 75, autoHop: false, landingFriction: false, jumpSpeedCap: 0, airWishCap: 30 },
  },
  'Bhop server': {
    move: { runSpeed: 260, walkSpeed: 130, sprintSpeed: 260, accelerate: 5, airAccelerate: 100, friction: 4, stopSpeed: 75, autoHop: true, landingFriction: false, jumpSpeedCap: 0, airWishCap: 30 },
  },
  'Liminal stroll': {
    move: { runSpeed: 140, walkSpeed: 80, sprintSpeed: 220, accelerate: 6, airAccelerate: 6, friction: 5, stopSpeed: 100, autoHop: false, landingFriction: true, jumpSpeedCap: 1, airWishCap: 30 },
  },
};
