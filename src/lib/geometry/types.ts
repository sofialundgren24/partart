// Shared geometry types. All lengths are millimetres. Project space: Z up, origin at the centre of the base.
// A primitive is defined in its own local frame: centred on X/Y, resting on z = 0.

import { z } from "zod";

export const CLADDING = ["none", "clapboard", "shingle", "fishscale", "stone", "brick", "boardbatten"] as const;
export type Cladding = (typeof CLADDING)[number];
export const ARCHES = ["none", "round", "pointed"] as const;
export const ORNAMENTS = ["bracket", "spandrel", "gablefan", "cresting", "finial"] as const;
export type OrnamentKind = (typeof ORNAMENTS)[number];

const pos = z.number().positive();
const cladding = z.enum(CLADDING).optional();

export const PrimitiveSchema = z.discriminatedUnion("type", [
  // Box. For openings (role "opening") `arch` shapes the top and `grid` adds muntins [columns, rows].
  z.object({ type: z.literal("box"), w: pos, d: pos, h: pos, cladding, arch: z.enum(ARCHES).optional(), grid: z.tuple([z.number().int().min(1), z.number().int().min(1)]).optional() }),
  // Triangular prism: ridge runs along local X at height h, base spans d along Y.
  z.object({ type: z.literal("gable"), w: pos, d: pos, h: pos, cladding }),
  // Hip roof: ridge along the longer side, all four sides slope.
  z.object({ type: z.literal("hip"), w: pos, d: pos, h: pos, cladding }),
  // Shed / ramp: full height h at y = -d/2, zero at y = +d/2.
  z.object({ type: z.literal("wedge"), w: pos, d: pos, h: pos, cladding }),
  // Regular n-gon prism (turrets, bay towers); circumradius r, one flat face towards -Y.
  z.object({ type: z.literal("ngon"), n: z.number().int().min(3).max(24), r: pos, h: pos, cladding }),
  // Regular n-gon pyramid (turret roofs, spires).
  z.object({ type: z.literal("pyramid"), n: z.number().int().min(3).max(24), r: pos, h: pos, cladding }),
  // Straight flight of stairs rising towards +Y.
  z.object({ type: z.literal("stairs"), w: pos, d: pos, h: pos, steps: z.number().int().min(1).max(40) }),
  // Flat balustrade in the XZ plane, thickness d along Y.
  z.object({ type: z.literal("railing"), w: pos, h: pos, d: pos }),
  // Decorative trim ("gingerbread") in the XZ plane, thickness d; finials are turned (round).
  z.object({ type: z.literal("ornament"), kind: z.enum(ORNAMENTS), w: pos, h: pos, d: pos }),
  // Cylinder or cone (rTop differs) along local Z.
  z.object({ type: z.literal("cylinder"), r: pos, rTop: z.number().nonnegative().optional(), h: pos }),
  // Ellipsoid fitting a w × d × h box, resting on z = 0.
  z.object({ type: z.literal("ellipsoid"), w: pos, d: pos, h: pos }),
  // Imported mesh stored on disk (GLB/STL/OBJ), already in mm and in project space.
  z.object({ type: z.literal("mesh"), storagePath: z.string(), w: z.number(), d: z.number(), h: z.number() }),
]);
export type Primitive = z.infer<typeof PrimitiveSchema>;
export type PrimitiveType = Primitive["type"];

export type Vec3 = [number, number, number];

export type Provenance = "observed" | "inferred" | "user" | "assumed" | "template" | "imported";

export const ROLES = [
  "base", "structure", "shell", "roof", "opening", "detail", "joint", "wheel", "axle",
  "head", "torso", "limb", "hand", "foot", "accessory", "imported", "column", "railing", "stairs", "ornament", "chimney",
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
    case "ngon":
    case "pyramid":
      return [2 * p.r, 2 * p.r, p.h];
    default:
      return [p.w, p.d, p.h];
  }
}

/** Doors (and similar) are openings closed by an opaque leaf rather than glazed. */
export function isDoor(c: { name: string; role: string }) {
  return c.role === "opening" && /\b(door|gate|hatch|porte?)\b|dörr/i.test(c.name);
}
