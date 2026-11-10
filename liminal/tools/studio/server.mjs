/**
 * The studio: one dev server and one headless browser that stay open, driven
 * by commands (tools/studio/cli.mjs). Maps, settings and cameras change in
 * place, so checking a change takes seconds instead of a rebuild.
 *
 * Listens on 127.0.0.1:5191 for POST /cmd {cmd, args}. The game runs at
 * http://localhost:5190. Settings changes made here are never saved to
 * config/ (writes to it are dropped).
 */
import http from 'node:http';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
// Playwright is installed globally in this environment (not a project dependency).
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GAME_PORT = 5190, CMD_PORT = 5191;

const vite = await createServer({ root: ROOT, server: { port: GAME_PORT, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 750 } });
const log = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => log.push('pageerror: ' + e.message));
// Settings changes are never saved; `load` can start a map with given settings (served as the config file).
let loadSettings = null;
await page.route('**/api/file/config/**', (r) => {
  if (r.request().method() === 'PUT') return r.fulfill({ status: 204 });
  if (loadSettings && r.request().url().includes('settings.json')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ format: 'liminal-config', version: 1, settings: loadSettings }) });
  return r.continue();
});

// On every page load (including Vite's own reloads after a code change): no HUD or
// panels in shots, and exposure snaps to each new view instead of easing in.
await page.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style');
    st.textContent = '[class*=hud],[class*=panel],[class*=Panel]{visibility:hidden !important}';
    document.head.append(st);
  });
  const t = setInterval(() => { const c = window.liminal?.config; if (c) { clearInterval(t); c.set('camera', 'adaptSpeed', 1000); c.set('view', 'viewBob', 0); window.liminal.game.paused = true; } }, 20);
});

const ready = () => page.waitForFunction(() => window.liminal && window.liminal.game.level && (window.liminal.game.lighting.shownAt > 0 || !window.liminal.config.values.light.enabled), null, { timeout: 180000 });
let current = '';
async function open(map) {
  await page.goto(`http://localhost:${GAME_PORT}/?map=${encodeURIComponent(map)}`);
  await ready();
  // Exposure snaps to each new view instead of easing in (shots are deterministic).
  current = map;
}
// The game's own loop is paused in the studio (see Game.paused): frames are drawn
// here, each waited for (a 1-pixel read), so nothing queues up behind a shot.
const render = (n, dt = 1 / 60) => page.evaluate(([n, dt]) => {
  const g = window.liminal.game, gl = g.renderer.gl.getContext(), px = new Uint8Array(4);
  for (let i = 0; i < n; i++) { g.renderNow(dt); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
}, [n, dt]);

async function pose(p) {
  const [x, y, z, yaw, pitch, roll] = p.split(',').map((s) => (s === '' ? NaN : Number(s)));
  await page.evaluate((r) => { window.liminal.game.viewRoll = r; }, Number.isNaN(roll) || roll === undefined ? 0 : roll);
  await page.evaluate(([x, y, z, yaw, pitch]) => {
    const pl = window.liminal.game.player;
    if (!Number.isNaN(x)) pl.state.origin.x = x;
    if (!Number.isNaN(y)) pl.state.origin.y = y;
    if (!Number.isNaN(z)) pl.state.origin.z = z;
    pl.prevOrigin = { ...pl.state.origin };
    if (!Number.isNaN(yaw)) pl.yaw = yaw;
    if (!Number.isNaN(pitch)) pl.pitch = pitch;
    pl.state.noclip = !Number.isNaN(z);
    pl.state.velocity.x = pl.state.velocity.y = pl.state.velocity.z = 0;
  }, [x, y, z, yaw, pitch]);
}

const commands = {
  /** Open a map (name in maps/, e.g. "p2/shipyard_atrium"), fresh page; optional settings to start with. */
  async load({ map, settings }) { loadSettings = settings ?? null; await open(map); return { map, status: await commands.stats() }; },
  /** Re-read the current map from disk (after a generator ran) without reloading the page. */
  async reload() {
    const t0 = Date.now();
    await page.evaluate(async (m) => { const g = window.liminal.game; g.lighting.shownAt = 0; await g.loadMapPath(`maps/${m}.json`); }, current);
    await ready();
    return { ms: Date.now() - t0, status: await commands.stats() };
  },
  /** Wait for the full bake (or a cache hit). */
  async bake() {
    await page.waitForFunction(() => /cached|from cache|^baked/.test(window.liminal.game.lighting.status), null, { timeout: 1800000 });
    return commands.stats();
  },
  /** Set settings: {"camera": {"evComp": -0.5}, ...}. Not saved. */
  async set(patch) {
    // Kept for the session: served as the config file, so they survive page reloads too.
    loadSettings = loadSettings ?? {};
    for (const [cat, kv] of Object.entries(patch)) loadSettings[cat] = { ...loadSettings[cat], ...kv };
    await page.evaluate((patch) => { for (const [cat, kv] of Object.entries(patch)) for (const [k, v] of Object.entries(kv)) window.liminal.config.set(cat, k, v); }, patch);
    await render(1);
    return commands.stats();
  },
  async stats() {
    return page.evaluate(() => {
      const g = window.liminal.game, o = g.player.state.origin;
      return { map: g.mapPath, lighting: g.lighting.status, pos: [Math.round(o.x), Math.round(o.y), Math.round(o.z)], yaw: Math.round(g.player.yaw), pitch: Math.round(g.player.pitch) };
    });
  },
  /** Screenshots from poses "x,y,z,yaw,pitch[,roll]" (blank z = walk on the floor). One PNG per view plus a contact sheet. */
  async views({ poses = [''], out = 'studio_views', settle = 2 }) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    const files = [];
    for (let i = 0; i < poses.length; i++) {
      if (poses[i]) await pose(poses[i]);
      await render(settle);
      const f = `${out}_${i + 1}.png`;
      // Render one frame and read the canvas in the same task (the drawing buffer is
      // still intact): much faster than a page screenshot, which waits on compositing.
      const png = await page.evaluate(() => { const g = window.liminal.game; g.renderNow(0); return g.renderer.gl.domElement.toDataURL('image/png').split(',')[1]; });
      writeFileSync(f, Buffer.from(png, 'base64'));
      files.push(f);
    }
    if (files.length > 1) {
      const sheet = await browser.newPage();
      const imgs = files.map((f) => 'data:image/png;base64,' + readFileSync(f).toString('base64'));
      const data = await sheet.evaluate(async (imgs) => {
        const cols = imgs.length <= 4 ? 2 : 3, w = 500, h = 375, rows = Math.ceil(imgs.length / cols);
        const c = document.createElement('canvas'); c.width = cols * w + (cols - 1) * 6; c.height = rows * h + (rows - 1) * 6;
        const g = c.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height);
        for (let i = 0; i < imgs.length; i++) {
          const im = new Image(); im.src = imgs[i]; await im.decode();
          g.drawImage(im, (i % cols) * (w + 6), Math.floor(i / cols) * (h + 6), w, h);
          g.fillStyle = '#ff0'; g.font = '14px monospace'; g.fillText(String(i + 1), (i % cols) * (w + 6) + 6, Math.floor(i / cols) * (h + 6) + 16);
        }
        return c.toDataURL('image/png').split(',')[1];
      }, imgs);
      await sheet.close();
      writeFileSync(`${out}_sheet.png`, Buffer.from(data, 'base64'));
      return { views: files, sheet: `${out}_sheet.png` };
    }
    return { views: files };
  },
  /** Render size in pixels (default 1000×750), e.g. a reference screenshot's. */
  async size({ width = 1000, height = 750 }) { await page.setViewportSize({ width, height }); await render(1); return { width, height }; },
  /** Run JS in the page (window.liminal is the game). */
  async eval({ js }) { return page.evaluate(js); },
  /** Console errors and warnings since the last call. */
  async log() { return log.splice(0); },
  async quit() { setTimeout(async () => { await browser.close(); await vite.close(); process.exit(0); }, 50); return 'bye'; },
};
await open('blank');
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    try {
      const { cmd, args } = JSON.parse(body || '{}');
      if (!commands[cmd]) throw new Error(`unknown command ${cmd}; have ${Object.keys(commands).join(', ')}`);
      const out = await commands[cmd](args ?? {});
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, out }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
    }
  });
}).listen(CMD_PORT, '127.0.0.1', () => console.log(`studio ready: game http://localhost:${GAME_PORT}, commands on ${CMD_PORT}`));
