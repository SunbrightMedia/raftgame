// node tools/complex/run_camera.cjs JOB.json OUT.json: runs camera_page.ts's runJob in headless Chromium
// (SwiftShader) on a job written by check_camera.py, and writes the result.
const path = require('path'), fs = require('fs');
const root = path.resolve(__dirname, '../..');
const { chromium } = require('playwright');
const esbuild = require(require.resolve('esbuild', { paths: [root] }));
(async () => {
  const [jobFile, outFile] = process.argv.slice(2);
  const bundle = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'camera_page.ts')], bundle: true, write: false, format: 'iife', target: 'es2020' }).outputFiles[0].text;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: bundle });
  const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  const res = await page.evaluate((j) => window.runJob(j), job);
  fs.writeFileSync(outFile, JSON.stringify(res));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
