// Shared geometry types. All lengths are millimetres. Project space: Z up, origin at the centre of the base.
// A primitive is defined in its own local frame: centred on X/Y, resting on z = 0.

import { z } from "zod";

export const PrimitiveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("box"), w: z.number().positive(), d: z.number().positive(), h: z.number().positive() }),
  // Triangular prism: ridge runs along local X at height h, base spans d along Y.
  z.object({ type: z.literal("gable"), w: z.number().positive(), d: z.number().positive(), h: z.number().positive() }),
  // Shed / ramp: full height h at y = -d/2, zero at y = +d/2.
  z.object({ type: z.literal("wedge"), w: z.number().positive(), d: z.number().positive(), h: z.number().positive() }),
  // Cylinder or cone (rTop differs) along local Z.
  z.object({ type: z.literal("cylinder"), r: z.number().positive(), rTop: z.number().nonnegative().optional(), h: z.number().positive() }),
  // Ellipsoid fitting a w × d × h box, resting on z = 0.
  z.object({ type: z.literal("ellipsoid"), w: z.number().positive(), d: z.number().positive(), h: z.number().positive() }),
  // Imported mesh stored on disk (GLB/STL/OBJ), already in mm and in project space.
  z.object({ type: z.literal("mesh"), storagePath: z.string(), w: z.number(), d: z.number(), h: z.number() }),
]);
export type Primitive = z.infer<typeof PrimitiveSchema>;
export type PrimitiveType = Primitive["type"];

export type Vec3 = [number, number, number];

export type Provenance = "observed" | "inferred" | "user" | "assumed" | "template" | "imported";

export const ROLES = [
  "base", "structure", "shell", "roof", "opening", "detail", "joint", "wheel", "axle",
  "head", "torso", "limb", "hand", "foot", "accessory", "imported",
] as const;
export type Role = (typeof ROLES)[number];

/** Plain component record used by the geometry kernel (decoupled from Prisma). */
export interface ComponentSpec {
  partId: string;
  name: string;
  role: Role | string;
  parentPartId: string | null;
  primitive: Primitive;
  position: Vec3; // mm
  rotation: Vec3; // degrees, applied X then Y then Z about the primitive's local origin
  colorHex: string;
  provenance: Provenance | string;
  confidence: number;
  hidden?: boolean;
}

/** Indexed triangle mesh, float positions in mm. Counter-clockwise winding = outward normal. */
export interface MeshData {
  positions: Float32Array; // xyz triples
  indices: Uint32Array;
}

export interface BBox {
  min: Vec3;
  max: Vec3;
}

export function primitiveSize(p: Primitive): Vec3 {
  switch (p.type) {
    case "cylinder": {
      const r = Math.max(p.r, p.rTop ?? p.r);
      return [2 * r, 2 * r, p.h];
    }
    default:
      return [p.w, p.d, p.h];
  }
}

/** Doors (and similar) are openings closed by an opaque leaf rather than glazed. */
export function isDoor(c: { name: string; role: string }) {
  return c.role === "opening" && /\b(door|gate|hatch|porte?)\b|dörr/i.test(c.name);
}
