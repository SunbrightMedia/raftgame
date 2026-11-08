import { type Vec3, v3 } from '../vec3';

/** A plane n·p = d, with n pointing out of the solid. */
export interface Plane { n: Vec3; d: number }

/**
 * A convex solid described by its bounding planes, like a Quake/Source brush.
 *
 * Boxes are the only shape in Milestone 1, but the trace code works on any
 * convex plane set so wedges and arbitrary convex brushes (Milestone 5) slot in
 * by generating more planes. Non-axial brushes will also need axial "bevel"
 * planes added here so box traces don't catch on their edges.
 */
export interface CollisionBrush {
  id: number;
  planes: Plane[];
  min: Vec3;
  max: Vec3;
  /** Surface material for footsteps etc. (Milestone 3). */
  material: string;
}

export function boxBrush(id: number, min: Vec3, max: Vec3, material = 'default'): CollisionBrush {
  return {
    id,
    material,
    min: { ...min },
    max: { ...max },
    planes: [
      { n: v3(1, 0, 0), d: max.x },
      { n: v3(-1, 0, 0), d: -min.x },
      { n: v3(0, 1, 0), d: max.y },
      { n: v3(0, -1, 0), d: -min.y },
      { n: v3(0, 0, 1), d: max.z },
      { n: v3(0, 0, -1), d: -min.z },
    ],
  };
}
