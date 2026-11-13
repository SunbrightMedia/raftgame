// Our cx_area_a seen from a capture frame's camera: the light before the camera passes (the complex camera's
// 'scene' target, 1008 x 756 = the game's view), with everything and with the lamps' direct light off (the baked
// bounce and the panels only), as raw float32 RGBA files for tools/complex/compare_light.py. Lets the page save the
// map's lightmap cache (a fresh bake when the map or its lights changed).
//   node tools/complex/ingame.mjs OUT_DIR [frame] [map]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const ROOT = new URL('../..', import.meta.url).pathname, OUT = process.argv[2], frame = process.argv[3] ?? '18325', MAP = process.argv[4] ?? 'cx_area_a';
const req = createRequire(ROOT + 'package.json');
const { createServer } = req('vite');
const { chromium } = req('playwright');
mkdirSync(OUT, { recursive: true });
const frames = JSON.parse(readFileSync(ROOT + 'tools/recreate/frames.json', 'utf8'));
const vite = await createServer({ root: ROOT, server: { port: 5198, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1008, height: 756 } });
const log = [];
page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
await page.goto(`http://localhost:5198/?map=${MAP}`);
await page.waitForFunction(() => window.liminal && window.liminal.game.level, null, { timeout: 240000 });
const t0 = Date.now();
await page.waitForFunction(() => /cached|from cache/.test(window.liminal.game.lighting.status), null, { timeout: 3600000, polling: 2000 });
console.log('lighting:', await page.evaluate(() => window.liminal.game.lighting.status), `(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
await page.evaluate(() => { window.liminal.game.paused = true; document.querySelectorAll('.hud-cross,.hud-speed,.hud-info,.hud-prompt').forEach((e) => e.remove()); });
await page.evaluate(() => { const l = window.liminal; l.config.set('camera', 'model', 'complex'); l.config.set('complex', 'exposure', 0.03413); l.game.applySettings(); });
const f = frames[frame];
const [x, y, z, yaw, pitch] = f.pose.split(',').map(Number);
const feet = (f.eyeExact ?? f.eye ?? 63.4) - 48;
await page.evaluate(([x, y, z, yaw, pitch]) => {
  const pl = window.liminal.game.player;
  Object.assign(pl.state.origin, { x, y, z }); pl.prevOrigin = { ...pl.state.origin };
  pl.yaw = yaw; pl.pitch = pitch; pl.state.noclip = true; pl.state.velocity.x = pl.state.velocity.y = pl.state.velocity.z = 0;
}, [x, y, feet, yaw, pitch]);
const shot = async (name) => {
  const r = await page.evaluate(() => {
    const g = window.liminal.game;
    for (let i = 0; i < 3; i++) g.renderNow(1 / 60);
    const cp = g.renderer.complexPost, d = cp.debugRead('scene');
    g.renderer.gl.resetState();
    const u = new Uint8Array(d.data.buffer); let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return { w: d.w, h: d.h, b64: btoa(s) };
  });
  writeFileSync(`${OUT}/${frame}_${name}.f32`, Buffer.from(r.b64, 'base64'));
  console.log(name, r.w, 'x', r.h);
};
await shot('full');
await page.evaluate(() => { window.liminal.worldUniforms.dynCount.value = 0; });
await shot('nodirect');
console.log('errors:', log.length ? log.slice(0, 5).join('\n') : 'none');
await browser.close();
await vite.close();
