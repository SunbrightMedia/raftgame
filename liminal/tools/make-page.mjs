/**
 * Turns the single-file build (dist-page/index.html) into a page body for
 * publishing as a claude.ai artifact, which supplies its own <html>/<head>/<body>
 * skeleton. Usage: npm run build:page -- <output.html>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'dist-page/liminal-page.html';
const html = readFileSync(new URL('../dist-page/index.html', import.meta.url), 'utf8');
const pick = (re) => [...html.matchAll(re)].map((m) => m[0]).join('\n');
const styles = pick(/<style[^>]*>[\s\S]*?<\/style>/g);
const scripts = pick(/<script[^>]*>[\s\S]*?<\/script>/g);
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1].replace(/<script[^>]*>[\s\S]*?<\/script>/g, '').trim();
const page = `<title>Liminal Playtest</title>\n<style>:root{color-scheme:dark}body{background:#000}</style>\n${styles}\n${body}\n${scripts}\n`;
writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
