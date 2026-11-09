import './style.css';
import { openStorage } from './data/storage';
import { ConfigStore } from './data/config';
import { parseMap } from './data/map';
import { Game } from './game/game';
import { DebugPanel } from './ui/debugPanel';
import { Hud } from './ui/hud';

const DEFAULT_MAP = 'maps/blank.json';

/** Milliseconds since boot start at each step (window.liminal.bootTimes). */
const bootTimes: Record<string, number> = {};

async function boot(): Promise<void> {
  const T = performance.now();
  const mark = (what: string) => (bootTimes[what] = Math.round(performance.now() - T));
  bootTimes.pageParsed = Math.round(T);
  const storage = await openStorage();
  mark('storage');
  const config = new ConfigStore(storage);
  await config.load();
  mark('config');

  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const game = new Game(canvas, storage, config);
  await game.init();
  mark('textures registered');

  const params = new URLSearchParams(location.search);
  const mapPath = params.get('map') ? `maps/${params.get('map')}.json` : DEFAULT_MAP;
  try {
    await game.loadMapPath(mapPath);
    mark('map loaded');
  } catch (e) {
    showError(`Could not load ${mapPath}: ${(e as Error).message}`);
    return;
  }

  const hud = new Hud();
  const panel = new DebugPanel(config, {
    onOpenChange: (open) => { if (open) game.input.unlock(); },
    reloadMap: () => void game.loadMapPath(game.mapPath).catch((e) => showError((e as Error).message)),
    listMaps: () => storage.list('maps'),
    loadMap: (path) => void game.loadMapPath(path).catch((e) => showError((e as Error).message)),
    currentMap: () => game.mapPath,
    loadMapFile: (f) => void loadDropped(f),
    mapStatus: () => game.mapStatus,
  });

  async function loadDropped(f: File): Promise<void> {
    try {
      await game.setMap(parseMap(JSON.parse(await f.text())), f.name);
    } catch (e) {
      showError(`${f.name}: ${(e as Error).message}`);
    }
  }

  game.input.onPress = (action, e) => {
    switch (action) {
      case 'panel': e.preventDefault(); panel.toggle(); break;
      case 'noclip': if (game.input.locked) game.player.state.noclip = !game.player.state.noclip; break;
      case 'respawn': if (game.input.locked) game.player.respawn(game.level); break;
    }
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') { e.preventDefault(); toast('The editor arrives in Milestone 2: Tab will switch between edit and play.'); }
  });

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0];
    if (f) void loadDropped(f);
  });

  game.onFrame = (dt) => hud.update(dt, config.values, game.player, game.input.locked, panel.open, game.renderer.renderSize, config.values.sim.tickRate);
  game.start();
  requestAnimationFrame(() => requestAnimationFrame(() => mark('first frames drawn')));

  // For poking at things from the browser console.
  (window as unknown as { liminal: unknown }).liminal = { game, config, panel, bootTimes };
}

function showError(msg: string): void {
  console.error(msg);
  const d = document.createElement('div');
  d.className = 'fatal';
  d.textContent = msg;
  document.body.append(d);
}

let toastTimer = 0;
function toast(msg: string): void {
  let t = document.querySelector<HTMLDivElement>('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.append(t); }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { t!.style.opacity = '0'; }, 2500);
}

void boot();
