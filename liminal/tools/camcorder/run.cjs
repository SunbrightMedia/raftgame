// Usage: start the dev server (npx vite --port 5199), then
//   NODE_PATH=$(npm root -g) node tools/camcorder/run.cjs <scene.png> <white> <outdir> [query]
//   python3 -I tools/camcorder/compare.py <capture frame dir> <outdir>
// Run the camcorder test bench on a captured scene picture; save each stage.
// node camrun.cjs <scene.png> <white> <outdir> [extra query]
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [scene, white, outdir, extra] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/camcheck/scene.png', (r) => r.fulfill({ body: fs.readFileSync(scene), contentType: 'image/png' }));
  for (const stage of ['tone', 'sharp', 'finish', 'final']) {
    await p.goto(`http://localhost:${process.env.PORT || 5199}/tools/camcorder/check.html?stage=${stage}&white=${white}${extra ? '&' + extra : ''}`);
    await p.waitForFunction(() => document.title === 'done', null, { timeout: 120000 });
    await (await p.$('#c')).screenshot({ path: `${outdir}/cam_${stage}.png` });
  }
  console.log('errors:', errs.length ? errs.join('\n') : 'none');
  await b.close();
})();
