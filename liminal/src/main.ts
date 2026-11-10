import './style.css';
import * as THREE from 'three';
import { openStorage } from './data/storage';
import { ConfigStore } from './data/config';
import { parseMap } from './data/map';
import { Game } from './game/game';
import { DebugPanel } from './ui/debugPanel';
import { Hud } from './ui/hud';

// The private atrium build (npm run build:atrium) opens the Portal 2 reference map.
const DEFAULT_MAP = import.meta.env.MODE === 'atrium' ? 'maps/p2/shipyard_atrium.json' : import.meta.env.MODE === 'catalogue' ? 'maps/p2lib/room0.json' : import.meta.env.MODE === 'industrial' ? 'maps/iw/industrial.json' : 'maps/blank.json';

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
    if (import.meta.env.MODE === 'atrium' && !params.get('map')) {
      // Start where the reference screenshot was taken: on the elevator, stopped at that floor.
      game.setMover('office_elevator', [0, 0, 506.61]);
      game.level!.spawn = { origin: { x: 10188.36, y: 1178.52, z: 1274.75 }, yaw: 217.6, pitch: -1.5 };
      game.player!.respawn(game.level!);
    }
  } catch (e) {
    showError(`Could not load ${mapPath}: ${(e as Error).message}`);
    return;
  }

  // Number keys open the maps the current one links to (the catalogue rooms).
  addEventListener('keydown', (e: KeyboardEvent) => {
    const d = /^(?:Digit|Numpad)([0-9])$/.exec(e.code)?.[1];
    const link = d !== undefined ? game.level?.map.links?.[d] : undefined;
    if (link && `maps/${link}.json` !== game.mapPath) void game.loadMapPath(`maps/${link}.json`).catch((err) => showError((err as Error).message));
  });

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
  // THREE too, for dev tools driving the page (tools/studio).
  (window as unknown as { liminal: unknown }).liminal = { game, config, panel, bootTimes, THREE };
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
