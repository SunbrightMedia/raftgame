import type { EntityDef } from '../../data/map';
import type { Box3, GridLamp } from './lightGridCore';

/**
 * What the lamp grid is built from, read out of a map's entities: its lamps
 * (class `lamp`), the boxes lamps in the open do not light the inside of
 * (`lamp_shade`), and the boxes of air inside its masses (`lamp_air`, many
 * boxes to an entity, six numbers a box). No three.js: the game and the
 * tools both use it.
 */
export function mapLamps(entities: EntityDef[]): { lamps: GridLamp[]; shades: Box3[]; airs: Box3[] } {
  const lin22 = (v: number) => Math.pow(v / 255, 2.2);
  const lamps = entities.filter((e) => e.class === 'lamp').map((e): GridLamp => {
    const p = (e.props ?? {}) as { color: number[]; brightness: number; size: number; reach: number; dir?: number[]; inner?: number; cone?: number; box?: Box3; open?: boolean; indoor?: boolean };
    const k = 300 * p.brightness;   // 300 = a surface fully lit
    return { pos: e.origin, color: [lin22(p.color[0]) * k, lin22(p.color[1]) * k, lin22(p.color[2]) * k], size: p.size, reach: p.reach, dir: p.dir as GridLamp['dir'], inner: p.inner, cone: p.cone, box: p.box, open: p.open, indoor: p.indoor };
  });
  const shades = entities.filter((e) => e.class === 'lamp_shade').map((e) => ({ min: e.props?.min as number[], max: e.props?.max as number[] }));
  const airs = entities.filter((e) => e.class === 'lamp_air').flatMap((e) => {
    const v = (e.props?.boxes ?? []) as number[];
    return Array.from({ length: v.length / 6 }, (_, i) => ({ min: v.slice(i * 6, i * 6 + 3), max: v.slice(i * 6 + 3, i * 6 + 6) }));
  });
  return { lamps, shades, airs };
}
