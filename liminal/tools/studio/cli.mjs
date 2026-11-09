/**
 * Drive the studio (tools/studio/server.mjs), starting it if needed.
 *
 *   npm run studio -- load industrial
 *   npm run studio -- views out/shot "100,200,,90,10" "300,40,,180,0"
 *   npm run studio -- set '{"camera":{"evComp":-0.5}}'
 *   npm run studio -- reload | bake | stats | log | quit
 *   npm run studio -- eval "window.liminal.game.lighting.status"
 *   npm run studio -- compare REF.png out/shot "x,y,z,yaw,pitch" ["ceiling,floor,wall"]
 *       (a view from the pose, then tools/look/compare.py against the reference)
 */
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const [cmdIn = 'stats', ...rest] = process.argv.slice(2);
const compare = cmdIn === 'compare' ? { ref: rest[0], out: rest[1] ?? 'studio_compare', pose: rest[2] ?? '', regions: rest[3] } : null;
const cmd = compare ? 'views' : cmdIn;
const args = compare ? { out: compare.out, poses: [compare.pose] } :
  cmd === 'load' ? { map: rest[0] } :
  cmd === 'views' ? { out: rest[0] ?? 'studio_views', poses: rest.slice(1).length ? rest.slice(1) : [''] } :
  cmd === 'set' ? JSON.parse(rest[0]) :
  cmd === 'eval' ? { js: rest.join(' ') } : {};

const send = async () => {
  const r = await fetch('http://127.0.0.1:5191/cmd', { method: 'POST', body: JSON.stringify({ cmd, args }) });
  return r.json();
};
let res;
try { res = await send(); } catch {
  if (cmd === 'quit') { console.log('studio not running'); process.exit(0); }
  const logf = openSync(resolve(HERE, '../../.studio.log'), 'a');
  spawn(process.execPath, [resolve(HERE, 'server.mjs')], { detached: true, stdio: ['ignore', logf, logf], cwd: resolve(HERE, '../..') }).unref();
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try { res = await send(); break; } catch { /* starting */ }
  }
  if (!res) { console.error('studio did not start; see .studio.log'); process.exit(1); }
}
if (!res.ok) { console.log(JSON.stringify({ error: res.error })); process.exit(1); }
if (compare) {
  // The look server keeps the vision models loaded between comparisons.
  const root = resolve(HERE, '../..');
  const body = JSON.stringify({ ref: resolve(compare.ref), render: res.out.views[0], out: `${resolve(compare.out)}_compare.png`, json: `${resolve(compare.out)}_compare.json`, regions: compare.regions });
  const post = async () => (await fetch('http://127.0.0.1:5192/', { method: 'POST', body })).json();
  let r;
  try { r = await post(); } catch {
    const logf = openSync(resolve(root, '.look.log'), 'a');
    spawn(resolve(root, '.venv-look/bin/python'), [resolve(root, 'tools/look/compare.py'), 'serve'], { detached: true, stdio: ['ignore', logf, logf], cwd: root }).unref();
    for (let i = 0; i < 300 && !r; i++) { await new Promise((ok) => setTimeout(ok, 1000)); try { r = await post(); } catch { /* loading models */ } }
  }
  if (!r || !r.ok) { console.error(r ? r.error : 'look server did not start; see .look.log'); process.exit(1); }
  console.log(r.summary.join('\n') + `\nreport: ${r.report}`);
  process.exit(0);
}
console.log(JSON.stringify(res.out, null, 1));
