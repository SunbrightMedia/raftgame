/**
 * Turns the single-file planner build (dist-planner/planner.html) into a page
 * body for a claude.ai artifact (which brings its own html/head/body).
 * Usage: npm run build:planner && node tools/planner/make-page.mjs <output.html>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'dist-planner/backrooms-planner.html';
const html = readFileSync(new URL('../../dist-planner/planner.html', import.meta.url), 'utf8');
const pick = (re) => [...html.matchAll(re)].map((m) => m[0]).join('\n');
const styles = pick(/<style[^>]*>[\s\S]*?<\/style>/g);
const scripts = pick(/<script[^>]*>[\s\S]*?<\/script>/g);
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1].replace(/<script[^>]*>[\s\S]*?<\/script>/g, '').trim();
const page = `<title>Backrooms Planner</title>\n<style>:root{color-scheme:dark}body{background:#2b2b2b}</style>\n${styles}\n${body}\n${scripts}\n`;
writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
