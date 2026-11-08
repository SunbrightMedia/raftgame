import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * Dev-only file API so the in-game panels can read/write real files on disk.
 *
 *   GET  /api/file/<rel>   -> file contents (404 if missing)
 *   PUT  /api/file/<rel>   -> writes request body
 *   GET  /api/list/<dir>   -> JSON array of file names
 *
 * Only these top-level folders are reachable, so nothing outside the project
 * data can be touched: config/, maps/, textures/.
 *
 * A desktop build (Tauri/Electron, Milestone 5) will provide the same three
 * calls natively; the game only talks to them through src/data/storage.ts.
 */
const ROOTS = ['config', 'maps', 'textures'];

function resolveSafe(rel: string): string | null {
  const clean = decodeURIComponent(rel).replace(/\\/g, '/');
  const top = clean.split('/')[0];
  if (!ROOTS.includes(top)) return null;
  const abs = path.resolve(ROOT, clean);
  const rootAbs = path.resolve(ROOT, top);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null;
  return abs;
}

function fileApi(): Plugin {
  return {
    name: 'liminal-file-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        const file = url.match(/^\/api\/file\/([^?]+)/);
        const list = url.match(/^\/api\/list\/([^?]+)/);
        if (file) {
          const abs = resolveSafe(file[1]);
          if (!abs) { res.statusCode = 403; return res.end('forbidden'); }
          if (req.method === 'PUT') {
            const chunks: Buffer[] = [];
            req.on('data', (c: Buffer) => chunks.push(c));
            req.on('end', () => {
              fs.mkdirSync(path.dirname(abs), { recursive: true });
              fs.writeFileSync(abs, Buffer.concat(chunks));
              res.statusCode = 204;
              res.end();
            });
            return;
          }
          if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) { res.statusCode = 404; return res.end(); }
          res.setHeader('Cache-Control', 'no-store');
          return res.end(fs.readFileSync(abs));
        }
        if (list) {
          const abs = resolveSafe(list[1].replace(/\/$/, ''));
          if (!abs) { res.statusCode = 403; return res.end('forbidden'); }
          const names = fs.existsSync(abs) ? fs.readdirSync(abs).filter((n) => !n.startsWith('.')) : [];
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify(names));
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [fileApi()],
  server: {
    port: 5173,
    // Saving config/maps from the game must not trigger a page reload.
    watch: { ignored: ['**/config/**', '**/maps/**', '**/textures/**'] },
  },
});
