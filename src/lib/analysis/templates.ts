// Category templates — the offline analysis provider. These are generic starting structures, explicitly labelled
// "template" provenance: they are NOT derived from the user's photo. The user edits them to match the reference.

import { primitiveSize, type Cladding, type ComponentSpec, type Primitive, type Vec3 } from "../geometry/types";

export type Category = "architecture" | "vehicles" | "figurines" | "furniture" | "toys" | "sculptures" | "home" | "decorative" | "other";
export const CATEGORIES: { key: Category; label: string }[] = [
  { key: "architecture", label: "Architecture" },
  { key: "vehicles", label: "Vehicles" },
  { key: "figurines", label: "Dolls & figurines" },
  { key: "furniture", label: "Furniture" },
  { key: "toys", label: "Toys" },
  { key: "sculptures", label: "Sculptures" },
  { key: "home", label: "Home objects" },
  { key: "decorative", label: "Decorative objects" },
  { key: "other", label: "Other" },
];

type T = Omit<ComponentSpec, "provenance" | "confidence" | "hidden"> & { notes?: string };

const c = (partId: string, name: string, role: string, parent: string | null, primitive: Primitive, position: Vec3, colorHex: string, rotation: Vec3 = [0, 0, 0]): T => ({
  partId, name, role, parentPartId: parent, primitive, position, rotation, colorHex,
});

function house(): T[] {
  const W = 200, D = 140, H = 120, B = 6;
  const out: T[] = [
    c("C-BASE-01", "Foundation", "base", null, { type: "box", w: W + 20, d: D + 20, h: B }, [0, 0, 0], "#8f8a80"),
    c("C-BODY-01", "Main walls", "shell", "C-BASE-01", { type: "box", w: W, d: D, h: H }, [0, 0, B], "#e9d8b8"),
    c("C-ROOF-01", "Roof", "roof", "C-BODY-01", { type: "gable", w: W + 20, d: D + 16, h: 70 }, [0, 0, B + H], "#b5523b"),
    c("C-CHIM-01", "Chimney", "detail", "C-ROOF-01", { type: "box", w: 20, d: 20, h: 55 }, [55, 30, B + H + 20], "#9c4a36"),
    c("C-DOOR-01", "Front door", "opening", "C-BODY-01", { type: "box", w: 34, d: 3, h: 62 }, [0, -D / 2, B + 4], "#6b3e2e"),
  ];
  const win = (i: number, x: number, y: number, z: number, rz = 0) =>
    out.push(c(`C-WIN-${String(i).padStart(2, "0")}`, `Window ${i}`, "opening", "C-BODY-01", { type: "box", w: 28, d: 3, h: 36 }, [x, y, z], "#a9d1e0", [0, 0, rz]));
  win(1, -58, -D / 2, B + 52);
  win(2, 58, -D / 2, B + 52);
  win(3, -58, D / 2, B + 52, 180);
  win(4, 58, D / 2, B + 52, 180);
  win(5, -W / 2, 0, B + 52, -90);
  win(6, W / 2, 0, B + 52, 90);
  return out;
}

/**
 * Victorian / Queen Anne house: stone foundation, clapboard walls, an octagonal corner turret with a spire, a
 * front cross gable over a central bay, a right wing with its own gable, a wraparound porch with turned posts,
 * fretwork railings, frieze and brackets, steps, arched windows with muntins, chimney and gingerbread trim.
 * Dimensions are a nominal model (~330 mm wide); the project rescales it to your target size.
 */
function victorian(): T[] {
  const WALL = "#c9ccd0", TRIM = "#efe6d2", ROOF = "#5b6168", STONE = "#8a8a86", GLASS = "#f2c46b";
  const box = (w: number, d: number, h: number, cladding?: Cladding): Primitive => ({ type: "box", w, d, h, ...(cladding ? { cladding } : {}) });
  const win = (w: number, h: number, arch: "round" | "pointed" | "none", grid?: [number, number]): Primitive => ({ type: "box", w, d: 3, h, arch, ...(grid ? { grid } : {}) });
  const a = 44 * Math.cos(Math.PI / 8); // turret apothem
  const out: T[] = [
    c("C-BASE-01", "Stone foundation & porch deck", "base", null, box(330, 250, 20, "stone"), [5, 0, 0], STONE),
    c("C-BODY-01", "Main house walls", "shell", "C-BASE-01", box(170, 150, 150, "clapboard"), [0, 30, 20], WALL),
    c("C-TOWER-01", "Corner turret", "shell", "C-BODY-01", { type: "ngon", n: 8, r: 44, h: 170, cladding: "clapboard" }, [-100, -20, 20], WALL),
    c("C-WING-01", "Right wing walls", "shell", "C-BODY-01", box(80, 140, 150, "clapboard"), [125, 20, 20], WALL),
    c("C-BAY-01", "Front bay walls", "shell", "C-BODY-01", box(84, 20, 150, "clapboard"), [0, -55, 20], WALL),
    c("C-ROOF-01", "Main roof", "roof", "C-BODY-01", { type: "gable", w: 190, d: 170, h: 85, cladding: "shingle" }, [0, 30, 170], ROOF),
    c("C-ROOF-02", "Front cross gable", "roof", "C-BAY-01", { type: "gable", w: 100, d: 96, h: 110, cladding: "shingle" }, [0, -15, 170], ROOF, [0, 0, 90]),
    c("C-ROOF-03", "Wing gable roof", "roof", "C-WING-01", { type: "gable", w: 150, d: 90, h: 80, cladding: "shingle" }, [125, 20, 170], ROOF, [0, 0, 90]),
    c("C-ROOF-04", "Turret spire", "roof", "C-TOWER-01", { type: "pyramid", n: 8, r: 50, h: 100, cladding: "shingle" }, [-100, -20, 190], ROOF),
    c("C-ROOF-05", "Porch roof", "roof", "C-BASE-01", { type: "wedge", w: 250, d: 63, h: 18, cladding: "shingle" }, [5, -81.5, 95], ROOF, [0, 0, 180]),
    c("C-CHIM-01", "Chimney", "chimney", "C-ROOF-01", box(24, 24, 112, "stone"), [40, 70, 170], STONE),
    c("C-ORN-01", "Spire finial", "ornament", "C-ROOF-04", { type: "ornament", kind: "finial", w: 8, h: 28, d: 8 }, [-100, -20, 290], TRIM),
    c("C-ORN-02", "Ridge cresting", "ornament", "C-ROOF-01", { type: "ornament", kind: "cresting", w: 110, h: 8, d: 1.5 }, [-5, 30, 255], ROOF),
    c("C-ORN-03", "Front gable fan", "ornament", "C-ROOF-02", { type: "ornament", kind: "gablefan", w: 34, h: 40, d: 1.5 }, [0, -66, 236], TRIM),
    c("C-ORN-04", "Wing gable fan", "ornament", "C-ROOF-03", { type: "ornament", kind: "gablefan", w: 30, h: 34, d: 1.5 }, [125, -56, 211], TRIM),
    c("C-ORN-05", "Porch frieze", "ornament", "C-BASE-01", { type: "ornament", kind: "spandrel", w: 236, h: 9, d: 1.5 }, [5, -112, 82], TRIM),
    c("C-STAIR-01", "Porch steps", "stairs", "C-BASE-01", { type: "stairs", w: 40, d: 30, h: 20, steps: 4 }, [5, -140, 0], STONE),
    c("C-DOOR-01", "Front door", "opening", "C-BAY-01", win(26, 50, "round"), [0, -65, 22], "#4a4744"),
  ];
  // Porch posts with brackets, and fretwork railings between them (gap for the steps).
  const posts = [-112, -60, -18, 28, 75, 122];
  posts.forEach((x, i) => {
    out.push(c(`C-COL-0${i + 1}`, `Porch post ${i + 1}`, "column", "C-BASE-01", { type: "cylinder", r: 3.2, h: 72 }, [x, -108, 20], TRIM));
    if (i < posts.length - 1) out.push(c(`C-ORN-1${i}`, `Post bracket ${i + 1}`, "ornament", "C-BASE-01", { type: "ornament", kind: "bracket", w: 9, h: 9, d: 1.5 }, [x + 7.7, -108, 73], TRIM));
  });
  [[-112, -60], [-60, -18], [28, 75], [75, 122]].forEach(([x0, x1], i) =>
    out.push(c(`C-RAIL-0${i + 1}`, `Porch railing ${i + 1}`, "railing", "C-BASE-01", { type: "railing", w: x1 - x0 - 7, h: 18, d: 2 }, [(x0 + x1) / 2, -108, 20], TRIM)));
  // Windows (each its own part). Openings sit on the outer face of their parent; -Y is the front.
  const W: [string, string, Primitive, Vec3, Vec3?][] = [
    ["Bay window L", "C-BAY-01", win(16, 36, "round", [1, 2]), [-28, -65, 32]],
    ["Bay window R", "C-BAY-01", win(16, 36, "round", [1, 2]), [28, -65, 32]],
    ["Bay upper window L", "C-BAY-01", win(20, 40, "round", [2, 3]), [-16, -65, 104]],
    ["Bay upper window R", "C-BAY-01", win(20, 40, "round", [2, 3]), [16, -65, 104]],
    ["Gable window", "C-ROOF-02", win(22, 40, "pointed", [2, 3]), [0, -65, 186]],
    ["Turret window, ground", "C-TOWER-01", win(18, 36, "round", [1, 2]), [-100, -20 - a, 40]],
    ["Turret window, upper front", "C-TOWER-01", win(18, 40, "round", [1, 3]), [-100, -20 - a, 112]],
    ["Turret window, upper left", "C-TOWER-01", win(18, 40, "round", [1, 3]), [-100 - a * Math.SQRT1_2, -20 - a * Math.SQRT1_2, 112], [0, 0, -45]],
    ["Turret window, upper right", "C-TOWER-01", win(18, 40, "round", [1, 3]), [-100 + a * Math.SQRT1_2, -20 - a * Math.SQRT1_2, 112], [0, 0, 45]],
    ["Wing picture window", "C-WING-01", win(30, 40, "round", [3, 2]), [125, -50, 32]],
    ["Wing upper window L", "C-WING-01", win(16, 38, "round", [1, 3]), [110, -50, 104]],
    ["Wing upper window R", "C-WING-01", win(16, 38, "round", [1, 3]), [140, -50, 104]],
    ["Wing gable window", "C-ROOF-03", win(16, 30, "round", [1, 2]), [125, -55, 196]],
    ["Wing side window", "C-WING-01", win(18, 38, "round", [1, 3]), [165, 20, 104], [0, 0, 90]],
  ];
  W.forEach(([name, parent, prim, pos, rot], i) => out.push(c(`C-WIN-${String(i + 1).padStart(2, "0")}`, name, "opening", parent, prim, pos, GLASS, rot ?? [0, 0, 0])));
  return out;
}

function vehicle(): T[] {
  const L = 220, Wd = 90, wheelR = 20;
  const out: T[] = [
    c("C-BODY-01", "Lower body", "shell", null, { type: "box", w: L, d: Wd, h: 38 }, [0, 0, wheelR * 0.6], "#c8423b"),
    c("C-CABIN-01", "Cabin / roof", "structure", "C-BODY-01", { type: "box", w: L * 0.5, d: Wd * 0.9, h: 32 }, [-10, 0, wheelR * 0.6 + 38], "#c8423b"),
    c("C-BUMP-01", "Front bumper", "detail", "C-BODY-01", { type: "box", w: 6, d: Wd, h: 10 }, [L / 2 + 3, 0, wheelR * 0.6 + 2], "#9a9a9a"),
    c("C-BUMP-02", "Rear bumper", "detail", "C-BODY-01", { type: "box", w: 6, d: Wd, h: 10 }, [-L / 2 - 3, 0, wheelR * 0.6 + 2], "#9a9a9a"),
    c("C-LIGHT-01", "Headlight L", "detail", "C-BODY-01", { type: "cylinder", r: 6, h: 3 }, [L / 2, -28, wheelR * 0.6 + 26], "#f4e7a1", [0, 90, 0]),
    c("C-LIGHT-02", "Headlight R", "detail", "C-BODY-01", { type: "cylinder", r: 6, h: 3 }, [L / 2, 28, wheelR * 0.6 + 26], "#f4e7a1", [0, 90, 0]),
  ];
  const xs = [L * 0.32, -L * 0.32];
  let i = 1;
  for (const x of xs) {
    out.push(c(`C-AXLE-0${(i + 1) / 2}`, `Axle ${(i + 1) / 2}`, "axle", "C-BODY-01", { type: "cylinder", r: 2.5, h: Wd + 24 }, [x, (Wd + 24) / 2, wheelR], "#777777", [90, 0, 0]));
    for (const y of [-(Wd / 2 + 6), Wd / 2 + 6 + 12]) {
      out.push(c(`C-WHEEL-0${i}`, `Wheel ${i}`, "wheel", `C-AXLE-0${Math.ceil(i / 2)}`, { type: "cylinder", r: wheelR, h: 12 }, [x, y, wheelR], "#2b2b2b", [90, 0, 0]));
      i++;
    }
  }
  return out;
}

function figurine(): T[] {
  // Standing figure ~300 mm, proportions ≈ 7 heads.
  const hd = 42;
  return [
    c("C-BASE-01", "Display base", "base", null, { type: "cylinder", r: 60, h: 8 }, [0, 0, 0], "#5b4a6b"),
    c("C-FOOT-01", "Left foot", "foot", "C-LEG-03", { type: "box", w: 22, d: 34, h: 12 }, [-14, 4, 8], "#6b4a3a"),
    c("C-FOOT-02", "Right foot", "foot", "C-LEG-04", { type: "box", w: 22, d: 34, h: 12 }, [14, 4, 8], "#6b4a3a"),
    c("C-LEG-03", "Left lower leg", "limb", "C-LEG-01", { type: "cylinder", r: 9, rTop: 11, h: 62 }, [-14, 0, 20], "#e2b79a"),
    c("C-LEG-04", "Right lower leg", "limb", "C-LEG-02", { type: "cylinder", r: 9, rTop: 11, h: 62 }, [14, 0, 20], "#e2b79a"),
    c("C-LEG-01", "Left upper leg", "limb", "C-TORSO-01", { type: "cylinder", r: 11, rTop: 14, h: 66 }, [-14, 0, 84], "#3e5c8a"),
    c("C-LEG-02", "Right upper leg", "limb", "C-TORSO-01", { type: "cylinder", r: 11, rTop: 14, h: 66 }, [14, 0, 84], "#3e5c8a"),
    c("C-TORSO-01", "Torso", "torso", "C-BASE-01", { type: "ellipsoid", w: 62, d: 36, h: 96 }, [0, 0, 146], "#d8573f"),
    c("C-NECK-01", "Neck", "joint", "C-TORSO-01", { type: "cylinder", r: 8, h: 14 }, [0, 0, 236], "#e2b79a"),
    c("C-HEAD-01", "Head", "head", "C-NECK-01", { type: "ellipsoid", w: hd * 0.8, d: hd * 0.9, h: hd }, [0, 0, 246], "#e2b79a"),
    c("C-ARM-01", "Left upper arm", "limb", "C-TORSO-01", { type: "cylinder", r: 7, h: 56 }, [-38, 0, 168], "#d8573f", [0, 200, 0]),
    c("C-ARM-02", "Right upper arm", "limb", "C-TORSO-01", { type: "cylinder", r: 7, h: 56 }, [38, 0, 168], "#d8573f", [0, 160, 0]),
    c("C-ARM-03", "Left forearm", "limb", "C-ARM-01", { type: "cylinder", r: 6, h: 50 }, [-46, 0, 116], "#e2b79a", [0, 186, 0]),
    c("C-ARM-04", "Right forearm", "limb", "C-ARM-02", { type: "cylinder", r: 6, h: 50 }, [46, 0, 116], "#e2b79a", [0, 174, 0]),
    c("C-HAND-01", "Left hand", "hand", "C-ARM-03", { type: "ellipsoid", w: 12, d: 10, h: 18 }, [-48, 0, 50], "#e2b79a"),
    c("C-HAND-02", "Right hand", "hand", "C-ARM-04", { type: "ellipsoid", w: 12, d: 10, h: 18 }, [48, 0, 50], "#e2b79a"),
  ];
}

function furniture(): T[] {
  const S = 120, Hs = 120;
  const out: T[] = [
    c("C-SEAT-01", "Seat", "structure", null, { type: "box", w: S, d: S, h: 10 }, [0, 0, Hs - 10], "#c9a06b"),
    c("C-BACK-01", "Backrest", "structure", "C-SEAT-01", { type: "box", w: S, d: 10, h: 110 }, [0, S / 2 - 5, Hs], "#c9a06b"),
  ];
  let i = 1;
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    out.push(c(`C-LEG-0${i}`, `Leg ${i++}`, "structure", "C-SEAT-01", { type: "box", w: 10, d: 10, h: Hs - 10 }, [x * (S / 2 - 5), y * (S / 2 - 5), 0], "#a9824f"));
  return out;
}

function generic(): T[] {
  return [
    c("C-BASE-01", "Base", "base", null, { type: "cylinder", r: 50, h: 10 }, [0, 0, 0], "#8b7d6b"),
    c("C-BODY-01", "Main body", "structure", "C-BASE-01", { type: "box", w: 90, d: 70, h: 110 }, [0, 0, 10], "#d9b98a"),
    c("C-TOP-01", "Top", "detail", "C-BODY-01", { type: "ellipsoid", w: 80, d: 60, h: 40 }, [0, 0, 120], "#c25b3f"),
  ];
}

/**
 * Starting templates, chosen explicitly by the user — never guessed from words in the description.
 * Templates are only used when no vision model is available; with one, components come from the photo.
 */
export const TEMPLATE_OPTIONS: Record<string, { key: string; label: string }[]> = {
  architecture: [
    { key: "house", label: "Simple house (walls + pitched roof)" },
    { key: "victorian", label: "Victorian house (turret, porch, trim)" },
  ],
};

export function templateFor(category: string, templateKey?: string | null): { components: T[]; label: string } {
  switch (category) {
    case "architecture": return templateKey === "victorian" ? { components: victorian(), label: "Victorian house with turret" } : { components: house(), label: "Pitched-roof house" };
    case "vehicles": return { components: vehicle(), label: "Four-wheel vehicle" };
    case "figurines": return { components: figurine(), label: "Standing figure" };
    case "furniture": return { components: furniture(), label: "Chair" };
    case "toys": return { components: vehicle(), label: "Four-wheel toy" };
    default: return { components: generic(), label: "Generic object" };
  }
}

export function overallSize(components: Pick<ComponentSpec, "primitive" | "position" | "rotation">[]): number {
  // Conservative: use primitive extents around positions (rotation-agnostic bounding).
  let max = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const comp of components) {
    const s = primitiveSize(comp.primitive);
    const ext = Math.max(...s);
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], comp.position[k] - (k === 2 ? 0 : ext / 2));
      hi[k] = Math.max(hi[k], comp.position[k] + (k === 2 ? ext : ext / 2));
    }
  }
  for (let k = 0; k < 3; k++) max = Math.max(max, hi[k] - lo[k]);
  return max;
}

/** Uniformly scale primitive dimensions and positions. */
export function scaleComponent<C extends Pick<ComponentSpec, "primitive" | "position">>(comp: C, f: number): C {
  const p = comp.primitive;
  if (p.type === "mesh") return comp; // meshes are scaled at import time
  const prim = { ...p } as Record<string, unknown>;
  for (const k of ["w", "d", "h", "r", "rTop"]) if (typeof prim[k] === "number") prim[k] = (prim[k] as number) * f;
  return { ...comp, primitive: prim as Primitive, position: comp.position.map((x) => x * f) as Vec3 };
}
