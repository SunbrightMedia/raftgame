/**
 * Generate a world map with the generator in src/world.
 *
 *   npx vite-node tools/world/gen.ts -- testbed [seed]        → maps/iw/testbed.json
 *   npx vite-node tools/world/gen.ts -- blockout [seed]       → maps/iw/blockout.json (the bare layout)
 *   npx vite-node tools/world/gen.ts -- industrial [seed]     → maps/iw/industrial.json (the world's geometry)
 *   npx vite-node tools/world/gen.ts -- kit [seeds]           → maps/iw/industrial-kit.json: one of every texture and
 *       model the worlds of seeds 1..N use (default 16), for packing the private page, which makes its world itself
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { serializeMap } from '../../src/data/map';
import { testbed, BTS_SETTINGS } from '../../src/world/industrial/testbed';
import { blockout } from '../../src/world/industrial/blockout';
import { industrial, industrialLots, industrialWorld, GEOMETRY_SETTINGS } from '../../src/world/industrial/world';

// (--old: the old generator, one whole world with an edge, in place of the world of lots; --lots n: that many lots a side.)
const argv = process.argv.slice(2).filter((a) => a !== '--');
const old = argv.includes('--old');
const lotsAt = argv.indexOf('--lots'), lots = lotsAt >= 0 ? Number(argv[lotsAt + 1]) : 0;
const world = old ? industrial : lots ? (n: number) => industrialLots(n, -Math.floor(lots / 2), -Math.floor(lots / 2), lots) : industrialWorld;
const [what = 'testbed', seedArg] = argv.filter((a, k) => a !== '--old' && a !== '--lots' && argv[k - 1] !== '--lots');
const seed = seedArg ? Number(seedArg) : 1;
const t0 = performance.now();
if (what === 'kit') {
  const tex = new Set<string>(), ents = new Map<string, unknown>();
  for (let n = 1; n <= (seedArg ? seed : 16); n++) {
    const m = world(n).map.toMap('kit', GEOMETRY_SETTINGS);
    for (const b of m.brushes as unknown as { faces: Record<string, { tex: string }> }[]) for (const f of Object.values(b.faces)) tex.add(f.tex);
    for (const e of m.entities) {
      const p = (e.props ?? {}) as Record<string, unknown>;
      if (e.class === 'prop') ents.set(`prop ${p.model} ${p.skin}`, e);
      else if (e.class === 'glow' || e.class === 'beam') ents.set(`${e.class} ${p.tex} ${p.halo}`, e);
    }
  }
  mkdirSync('maps/iw', { recursive: true });
  const brushes = [...tex].filter((t) => !t.startsWith('tools/')).map((t, i) => ({ id: i + 1, type: 'box', min: [i * 80, 0, 0], max: [i * 80 + 64, 64, 64], tex: t }));
  writeFileSync('maps/iw/industrial-kit.json', JSON.stringify({ format: 'liminal-map', version: 1, name: 'kit', settings: {}, brushes, entities: [...ents.values()] }));
  console.log(`maps/iw/industrial-kit.json: ${brushes.length} textures, ${ents.size} models and sprites`);
  process.exit(0);
}
const made = what === 'blockout' ? blockout(seed) : what === 'industrial' ? world(seed) : null;
const out = what === 'testbed' ? testbed(seed) : made?.map ?? null;
if (made) {
  const l = made.layout;
  console.log(`layout: ${l.blocks.filter((b) => b.kind === 'mass').length} masses, ${l.blocks.filter((b) => b.kind === 'hall').length} halls, ${l.streets.length} streets, ${l.junctions.length} junctions, ${l.segments.length} segments, ${l.walks.length} catwalks (${l.walks.filter((w) => w.la !== w.lb).length} with stairs), ${l.nodes.size} nodes`);
}
if (!out) throw new Error(`unknown world: ${what}`);
mkdirSync('maps/iw', { recursive: true });
const map = out.toMap(what, what === 'industrial' ? GEOMETRY_SETTINGS : BTS_SETTINGS);
writeFileSync(`maps/iw/${what}.json`, serializeMap(map));
console.log(`maps/iw/${what}.json: ${map.brushes.length} brushes, ${map.entities.length} entities, seed ${seed}, ${Math.round(performance.now() - t0)} ms`);
