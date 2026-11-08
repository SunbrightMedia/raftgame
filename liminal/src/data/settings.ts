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
      friction: num('Ground friction', 6, 0, 20, 0.1, 'sv_friction. Lower = icy.'),
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
      viewBob: num('View bob', 0.3, 0, 4, 0.05, 'Handheld camera bob: the view dips with each footstep.', 'u'),
      viewSway: num('View sway', 0.25, 0, 4, 0.05, 'Side-to-side sway, one cycle every two steps.', 'u'),
      viewRoll: num('View roll', 0.15, 0, 3, 0.05, 'Camera tilts slightly with the sway.', '°'),
      bobRate: num('Steps per second', 1.8, 0.5, 4, 0.05, 'Footstep rate at full run speed (slower when walking). Sets how fast the bob goes.', 'Hz'),
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
      internalHeight: num('Internal resolution (lines)', 540, 0, 2160, 1, 'The game renders this many lines tall and upscales. 0 = native.', 'px'),
      msaa: num('Antialiasing (MSAA)', 4, 0, 8, 1, 'Multisample antialiasing on the internal render: smooths jagged geometry edges. 0 = off (crunchier), 4 = smooth.', 'x'),
      upscale: select('Upscale filter', 'linear', ['nearest', 'linear'] as const, 'nearest = crunchy pixels, linear = soft CRT-ish.'),
      faceShade: num('Fullbright face shading', 0.6, 0, 1, 0.01, 'Fake per-face shading used only when baked lighting is off. 0 = flat, 1 = strong.'),
      brightness: num('Scene light × (auto exposure undoes this)', 1, 0, 3, 0.01, 'Multiplies the light in the scene itself. With auto exposure on, the camera re-meters and cancels it. For picture brightness use Camera › Brightness.'),
      textureFilter: select('Texture filter', 'linear', ['nearest', 'linear'] as const, 'nearest = crisp texels (retro), linear = smooth.'),
      lightHoldMs: num('Wait for lighting', 4000, 0, 30000, 100, 'On map load, draw nothing until the lightmap is ready (at most this long), instead of flashing the flat unlit world.', 'ms'),
      clearColor: color('Void colour', '#0b0c0e'),
    },
  },
  light: {
    label: 'Lighting',
    help: 'Baked lightmaps in physical units: lights in lumens/kelvin, irradiance in lux, inverse-square falloff, linear albedo for bounce. Changes re-bake in the background.',
    defs: {
      enabled: bool('Baked lighting', true, 'Off = fullbright with fake face shading (Hammer-style), handy while building.'),
      luxelSize: num('Luxel size', 16, 2, 256, 1, 'World units per lightmap pixel. Source default is 16. Lower = sharper shadows and scallops, slower bake.', 'u'),
      filter: select('Lightmap filter', 'linear', ['linear', 'nearest'] as const, 'linear = smooth (Source), nearest = blocky (Quake software renderer).'),
      lightScale: num('All lights ×', 1, 0, 8, 0.01, '1 = physical. An artist override, not a fix.'),
      bounces: num('Bounces', 2, 0, 2, 1, 'Passes of indirect light. 2 is more accurate in small rooms; slower.'),
      skyLuminance: num('Sky brightness', 0, 0, 20000, 50, 'Open sky (outdoor maps): average sky luminance. Lights the scene from above in the bake and is drawn as the sky. A clear day ≈ 5000–8000. 0 = no sky (indoors).', 'cd/m²'),
      skyZenith: color('Sky colour overhead', '#3a5cb2', 'Its brightness counts too: a deep zenith is darker than a pale horizon, as in a real clear sky.'),
      skyHorizon: color('Sky colour at the horizon', '#e4e8ec'),
      skyBand: num('Horizon haze height', 2.5, 0.2, 30, 0.1, 'How high above the horizon the pale haze reaches before the sky turns its overhead colour. Photos of clear days: a few degrees.', '°'),
      extraBounces: num('Remaining bounces', 1, 0, 1, 0.05, 'Adds the light from all bounces beyond the simulated ones, coloured by what each spot sees: a salmon-carpeted room fills with salmon light. 0 = off (old).'),
      bounceScale: num('Bounce ×', 1, 0, 3, 0.05, '1 = physically correct bounce.'),
      bounceSamples: num('Bounce rays', 40, 4, 128, 1, 'Rays per luxel per bounce. More = smoother, slower.'),
      ambientLux: num('Ambient fill', 0, 0, 30, 0.1, 'Flat extra light everywhere. Physically 0.', 'lx'),
      aoStrength: num('Corner darkening (AO)', 0.9, 0, 1, 0.01, 'Darkening where surfaces close in: the band along the bottom of walls and into corners. Computed from the room\'s geometry in the bake.'),
      aoRadius: num('AO radius', 48, 2, 128, 1, 'How far from a corner or wall base the darkening reaches.', 'u'),
      aoDirect: num('AO on direct light', 1, 0, 1, 0.01, 'How much the corner darkening also applies to light straight from lamps (not just bounce light). Camcorder footage shows it strongly.'),
      aoCurve: num('Corner darkening falloff', 2.5, 1, 6, 0.1, 'Deepens the darkness right at wall bases and in corners while leaving open wall alone. 1 = gentle (old).'),
    },
  },
  surface: {
    label: 'Surfaces & reflections',
    help: 'How surfaces reflect light (per material in textures/surfaces.json). Reflections of lamps and light panels, Fresnel sheen at grazing angles, relief from each texture.',
    defs: {
      reflections: num('Reflections ×', 0, 0, 3, 0.01, '1 = physical. 0 = every surface fully matte (the old look).'),
      roughness: num('Roughness +', 0, -0.5, 0.5, 0.01, 'Added to every material\'s roughness. Negative = glossier everywhere.'),
      bump: num('Relief ×', 1, 0, 4, 0.05, 'Scales the bump relief read from textures. 0 = flat.'),
    },
  },
  textures: {
    label: 'Textures',
    help: 'The texture crusher: clean CC0 photos in, 1998–2004 out. Doom ≈ density 1, 256 shared colours. HL2 ≈ density 3–4, no palette.',
    defs: {
      density: num('Texel density', 4, 0.25, 8, 0.25, 'Texels per world unit (inch). Doom 1, HL2 ~4.', 'px/u'),
      maxSize: num('Max texture size', 512, 16, 2048, 16, undefined, 'px'),
      colors: num('Colours per texture', 0, 0, 256, 1, '0 = no reduction. Low values give banding/posterised look.'),
      sharedPalette: bool('Shared palette', false, 'All textures use one palette (Doom PLAYPAL-style), which ties everything together.'),
      dither: num('Dither', 0, 0, 1, 0.05, 'Ordered dithering when reducing colours (PS1-ish).'),
      contrast: num('Contrast', 1.05, 0.3, 2.5, 0.01),
      saturation: num('Saturation', 0.95, 0, 2, 0.01),
      brightness: num('Brightness', 1, 0.3, 2, 0.01),
      sharpen: num('Sharpen', 0.2, 0, 2, 0.05, 'Old textures were sharpened after shrinking so they read at a distance.'),
    },
  },
  camera: {
    label: 'Camera',
    help: 'A 2001–2006 consumer digicam: meters the scene and sets exposure itself, has its own white balance and a short dynamic range. The look comes from this, not from filters (STYLE.md, "The medium").',
    defs: {
      autoExposure: bool('Auto exposure', true, 'Meter the scene like a point-and-shoot (centre-weighted average) and expose for it. Why lamps blow out while the room stays readable.'),
      brightness: num('Brightness', -0.18, -1.5, 1.5, 0.01, 'Picture brightness (midtones), applied after auto exposure so it stays put. 0 = neutral.'),
      contrast: num('Contrast', 0.95, 0.5, 3, 0.01, 'Camera contrast: an S-curve around mid-grey. 1 = flat (as before); consumer digicams pushed this hard.'),
      blackCrush: num('Black crush', 0.03, 0, 0.3, 0.005, 'Where the picture goes fully black. Deep shadows, as in the photos.'),
      evComp: num('Exposure compensation', 0, -4, 4, 0.1, 'Like the +/- button on the camera.', 'EV'),
      manualEV: num('Manual exposure', 5, -2, 14, 0.1, 'Used when auto exposure is off. Dim interiors ≈ 4–6, offices ≈ 7–8.', 'EV100'),
      adaptSpeed: num('Exposure adapt speed', 2, 0.1, 20, 0.1, 'How fast auto exposure follows the scene.'),
      whiteBalanceK: num('White balance', 4300, 2000, 10000, 50, 'The colour temperature the camera treats as white. Cheap auto WB under 2700 K bulbs lands around 4000–4500 K, so tungsten rooms come out amber, as in the references.', 'K'),
      tint: num('White balance tint', 0, -1, 1, 0.01, 'Green (−) to magenta (+), like a camera\'s tint/shift control. Set per map for each photo\'s cast.'),
      clip: num('Highlight clip', 1.0, 0.5, 2, 0.01, 'Where exposed highlights flatten to white. Low dynamic range is part of the look.'),
      surfaceHue: num('Overexposed surfaces keep colour', 0.6, 0, 1, 0.01, 'A brightly lit coloured surface keeps its colour instead of going white. Lamps still blow out white.'),
      knee: num('Highlight knee', 0.72, 0.2, 1, 0.01, 'Where highlight compression starts (× clip), like a camcorder\'s knee. 1 = hard clip (the old look).'),
      rolloff: num('Highlight roll-off', 1, 1, 8, 0.1, '1 = the original crisp clip (sharp lamp edges). Higher keeps detail in brighter rooms next door, but softens lamp edges.'),
      blackStretch: num('Black stretch', 0.25, 0, 3, 0.05, 'Lifts the darkest tones so a dim room next door is still visible.'),
      saturation: num('Saturation', 0.95, 0, 2, 0.01),
      flash: bool('On-camera flash', true, 'A light riding just above the lens: flat frontal light up close, fast falloff into the dark.'),
      flashCandela: num('Flash strength', 25, 0, 400, 1, 'Continuous stand-in for the flash burst. A stylistic control: no real camera keeps its flash on.', 'cd'),
      flashKelvin: num('Flash colour', 5500, 2500, 9000, 50, 'Xenon flash is daylight-balanced: cool against warm room light.', 'K'),
      flashHeight: num('Flash above lens', 3, 0, 12, 0.5, undefined, 'u'),
      flashBeam: num('Camera light beam', 90, 5, 90, 1, 'Half-angle where the camera light falls to half strength. 90 = even in every direction (a flash). A camcorder video light is ~25–35°: bright centre, dark frame edges.', '°'),
      artifacts: bool('Sensor & JPEG artifacts', true, 'The medium on top: glow and fringing around blown highlights, softness with sharpening halos, banding, shadow noise, vignette. Off = a clean exposure.'),
      glare: num('Glare amount', 0.018, 0, 0.3, 0.001, 'Lens glare: every bright point spreads into a soft halo in proportion to its energy (sharp core, long faint tail). Distant lamps get small faint halos, close ones big strong ones. 0 = off.'),
      lampGlow: num('Lamp glow', 8, 0, 40, 0.5, 'Extra glow from light sources only (lamps, light panels), on top of the lens glare. Panels are only ~30× brighter than a lit office, so without this they barely glow.'),
      glareSpread: num('Glare spread', 0.5, 0.2, 0.95, 0.01, 'How far the halo tail reaches. Low = tight halo hugging the light, high = wide veil.'),
      fringe: num('Purple fringe', 0.45, 0, 3, 0.01, 'Purple halo just outside the dark edge of blown lamps.'),
      edgeDark: num('Lamp edge darkness', 0.7, 0, 1, 0.01, 'The sharp dark line hugging a blown lamp (reference footage). About one pixel wide, so it shows close up and far away.'),
      blownTint: num('Blown highlights keep colour', 0, 0, 1, 0.01, 'How much of its own hue a hugely overexposed light keeps. 0 = pure white, as a clean digital sensor; footage clips warm lights to cream.'),
      aberration: num('Chromatic aberration', 0, 0, 4, 0.05, 'Red/blue split toward the frame edges. Off by default: a filter cliché.'),
      softness: num('Lens softness', 0.6, 0, 3, 0.05, 'Blur before sharpening, in pixels.', 'px'),
      softnessH: num('Extra horizontal softness', 0.4, 0, 4, 0.05, 'Video records less detail across than down. Also makes the sharpening halos mostly horizontal.', 'px'),
      sharpen: num('In-camera sharpening', 1.0, 0, 3, 0.05, 'The thin bright/dark halos on edges.'),
      chromaBlur: num('Colour bleed', 2, 0, 12, 0.1, 'Colour is stored at lower resolution than brightness (JPEG halves it, video far more), so colour smears sideways past edges.', 'px'),
      warmSaturation: num('Warm colour boost', 0, 0, 1, 0.01, 'Reds, oranges and yellows saturate more than other hues.'),
      shadowTint: num('Shadow tint (magenta)', 0, 0, 1, 0.01, 'Colour of the lifted blacks: 0 = grey, 1 = magenta.'),
      banding: num('Compression banding', 64, 0, 256, 1, 'Colour steps in smooth gradients. 0 = off; lower = more banding.'),
      noise: num('Sensor noise', 0.25, 0, 2, 0.01, 'Chroma noise, mostly in shadows.'),
      blackLift: num('Black lift', 0.025, 0, 0.3, 0.005, 'Milky, slightly lifted blacks.'),
      vignette: num('Vignette', 0.3, 0, 2, 0.01),
      fisheye: num('Fisheye', 0, 0, 1.5, 0.01, 'Barrel distortion of a wide lens: straight lines bow outward, the centre swells, the corners stay put.'),
    },
  },
  fog: {
    label: 'Fog',
    defs: {
      enabled: bool('Fog', true),
      color: color('Fog colour', '#121315'),
      near: num('Fog start', 600, 0, 20000, 10, undefined, 'u'),
      far: num('Fog end', 6000, 1, 40000, 10, undefined, 'u'),
      luminance: num('Fog brightness', 2, 0, 50000, 0.1, 'How bright the haze itself is.', 'cd/m²'),
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
 * Presets: a starting point, then tune from there.
 * Applying one only touches the values it lists.
 */
export const PRESETS: Record<string, SettingsPatch> = {
  'Look: Source / GMod (default)': {
    textures: { density: 4, colors: 0, sharedPalette: false, dither: 0, contrast: 1.05, saturation: 0.95, sharpen: 0.2, maxSize: 512 },
    render: { internalHeight: 720, upscale: 'linear', textureFilter: 'linear' },
    light: { luxelSize: 16, filter: 'linear', bounces: 1 },
  },
  'Look: Late-90s crunchy': {
    textures: { density: 2, colors: 64, sharedPalette: false, dither: 0, contrast: 1.1, saturation: 0.85, sharpen: 0.35, maxSize: 512 },
    render: { internalHeight: 480, upscale: 'linear', textureFilter: 'nearest' },
    light: { luxelSize: 16, filter: 'linear', bounces: 1 },
  },
  'Look: Doom / myhouse': {
    textures: { density: 1, colors: 256, sharedPalette: true, dither: 0, contrast: 1.2, saturation: 1, sharpen: 0.2, maxSize: 256 },
    render: { internalHeight: 400, upscale: 'nearest', textureFilter: 'nearest' },
    light: { luxelSize: 16, filter: 'nearest', bounces: 1 },
  },
  'Look: PS1': {
    textures: { density: 1, colors: 24, sharedPalette: false, dither: 0.6, contrast: 1.15, saturation: 1.1, sharpen: 0, maxSize: 128 },
    render: { internalHeight: 240, upscale: 'nearest', textureFilter: 'nearest' },
    light: { luxelSize: 32, filter: 'linear', bounces: 1 },
  },
  'Movement: Source (HL2-ish)': {
    move: { runSpeed: 190, walkSpeed: 110, sprintSpeed: 320, accelerate: 10, airAccelerate: 10, friction: 4, stopSpeed: 100, autoHop: false, landingFriction: false, jumpSpeedCap: 0, airWishCap: 30 },
  },
  'Movement: CS:S': {
    move: { runSpeed: 250, walkSpeed: 130, sprintSpeed: 250, accelerate: 5, airAccelerate: 10, friction: 4, stopSpeed: 75, autoHop: false, landingFriction: false, jumpSpeedCap: 0, airWishCap: 30 },
  },
  'Movement: Bhop server': {
    move: { runSpeed: 260, walkSpeed: 130, sprintSpeed: 260, accelerate: 5, airAccelerate: 100, friction: 4, stopSpeed: 75, autoHop: true, landingFriction: false, jumpSpeedCap: 0, airWishCap: 30 },
  },
  'Movement: Liminal stroll': {
    move: { runSpeed: 140, walkSpeed: 80, sprintSpeed: 220, accelerate: 6, airAccelerate: 6, friction: 5, stopSpeed: 100, autoHop: false, landingFriction: true, jumpSpeedCap: 1, airWishCap: 30 },
  },
};
