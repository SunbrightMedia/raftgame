/**
 * Turns the single-file build (dist-page/index.html) into a page body for
 * publishing as a claude.ai artifact, which supplies its own <html>/<head>/<body>
 * skeleton. Usage: npm run build:page -- <output.html>
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'dist-page/liminal-page.html';
const html = readFileSync(new URL('../dist-page/index.html', import.meta.url), 'utf8');
const pick = (re) => [...html.matchAll(re)].map((m) => m[0]).join('\n');
const styles = pick(/<style[^>]*>[\s\S]*?<\/style>/g);
const scripts = pick(/<script[^>]*>[\s\S]*?<\/script>/g);
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1].replace(/<script[^>]*>[\s\S]*?<\/script>/g, '').trim();
const page = `<title>Liminal Playtest</title>\n<style>:root{color-scheme:dark}body{background:#000}</style>\n${styles}\n${body}\n${scripts}\n`;
writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);

// The 'blender' camera model's data, staged for publishing next to the page (dist-page/data/blender/). Artifacts
// serve no raw binary files, so the float tables go as base64 text (name.b64.txt); the game decodes them.
const files = JSON.parse(readFileSync(new URL('../data/blender/files.json', import.meta.url), 'utf8'));
const dir = new URL('../dist-page/data/blender/', import.meta.url);
mkdirSync(dir, { recursive: true });
let total = 0;
for (const f of [...files, 'files.json']) {
  const src = new URL(`../data/blender/${f}`, import.meta.url);
  if (f.endsWith('.json')) { copyFileSync(src, new URL(f, dir)); total += readFileSync(src).length; continue; }
  const b64 = readFileSync(src).toString('base64');
  writeFileSync(new URL(`${f}.b64.txt`, dir), b64);
  total += b64.length;
}
console.log(`staged dist-page/data/blender/ (${files.length} files, ${(total / 1048576).toFixed(1)} MB): publish them with the page at the same paths`);
