// 3D-printing pipeline: component → solid (hollow shells, cut openings, frames) → orientation search →
// build-volume split with alignment pins → validated bed-ready mesh.

import type { ManifoldToplevel } from "manifold-3d";
import { bboxOf, bboxSize, componentSolid, dropToBed, placeSolid, toMeshData, type Manifold } from "../geometry/kernel";
import { checkMesh, overhangs, type MeshCheckResult, type OverhangResult } from "../geometry/meshCheck";
import { isDoor, primitiveSize, type ComponentSpec, type MeshData, type Vec3 } from "../geometry/types";
import { extrudeXZ, frameSection, ngonPoints, openingSection } from "../geometry/profiles";
import { material } from "../materials/catalog";
import type { PrinterProfile, ResolvedPart } from "./resolve";

export interface PrintPart {
  fileId: string; // e.g. C-ROOF-01 or C-ROOF-01-S2 or PINS
  partIds: string[];
  name: string;
  materialKey: string;
  colorHex: string;
  kind: "part" | "section" | "pins";
  mesh: MeshData; // oriented for printing, on the bed (min z = 0), centred on XY
  worldMesh: MeshData; // in project space for the assembled preview
  worldSolid?: Manifold;
  orientation: { label: string; rotation: Vec3 };
  check: MeshCheckResult;
  overhang: OverhangResult;
  supports: "none" | "recommended" | "required";
  size: Vec3;
  minFeatureMm: number;
  filamentEstimateG: number;
  notes: string[];
  warnings: string[];
}

export interface PrintContext {
  wasm: ManifoldToplevel;
  printer: PrinterProfile;
  meshLoader?: (p: string) => MeshData;
  /** World solids of the openings that must be cut out of a given parent (partId → hole solids). */
  openingsFor: (partId: string) => Manifold[];
  /** Volumes of parts that take precedence where they overlap this part (it is trimmed to them). */
  dominantsFor?: (partId: string) => Manifold[];
  /** Wall thickness of a part's parent (so panes/leaves sit behind the wall, frames in front). */
  parentThickness?: (partId: string) => number;
}

export const FRAME = { border: 2.5, lip: 1.5, thickness: 2 };
export const PIN = { d: 3, holeDepth: 6 };

export function printWallMm(printer: PrinterProfile) {
  return Math.max(1.6, printer.nozzleMm * 4);
}

/** Solid for a component in project space as it will be printed (before orientation). */
export function printSolid(ctx: PrintContext, part: ResolvedPart): { solid: Manifold; minFeature: number; notes: string[] } {
  const { wasm } = ctx;
  const c = part.comp;
  const notes: string[] = [];
  const p = c.primitive;
  let minFeature = Math.min(...primitiveSize(p));
  let local: Manifold;

  const parentT = c.parentPartId && ctx.parentThickness ? ctx.parentThickness(c.parentPartId) : printWallMm(ctx.printer);
  if (isDoor(c) && p.type === "box") {
    // Door leaf: the doorway outline grown by 3 mm, glued behind the wall, with two raised panels on its face.
    const leafSec = openingSection(wasm, p.w, p.h, p.arch).offset(3, "Round", 2, 24);
    const leaf = extrudeXZ(wasm, leafSec, 2).translate([0, parentT + 1, 0]);
    const panel = wasm.Manifold.cube([p.w * 0.34, 1.2, p.h * 0.3], true);
    local = wasm.Manifold.union([leaf, ...[-0.2, 0.2].flatMap((fx) => [panel.translate([p.w * fx, parentT - 0.6, p.h * 0.28]), panel.translate([p.w * fx, parentT - 0.6, p.h * 0.66])])]);
    minFeature = 1.2;
    notes.push(`Door leaf ${p.arch && p.arch !== "none" ? `(${p.arch} arch) ` : ""}glued behind the ${fmt(p.w)} × ${fmt(p.h)} mm doorway; raised panels face out.`);
  } else if (c.role === "opening" && p.type === "box") {
    // A printed opening is a flat frame (with muntins if requested) glued over the hole from outside.
    const sec = frameSection(wasm, p.w, p.h, p.arch, FRAME.border, FRAME.lip, p.grid);
    local = extrudeXZ(wasm, sec, FRAME.thickness).translate([0, -FRAME.thickness / 2, 0]);
    minFeature = Math.min(FRAME.border + FRAME.lip, FRAME.thickness);
    notes.push(`Frame${p.arch && p.arch !== "none" ? ` (${p.arch} arch)` : ""}${p.grid ? ` with ${p.grid[0]}×${p.grid[1]} muntins` : ""}: overlaps the ${fmt(p.w)} × ${fmt(p.h)} mm opening by ${FRAME.lip} mm. Glaze from behind with clear acetate or an acrylic offcut.`);
  } else if (c.role === "shell" && p.type === "ngon") {
    const t = printWallMm(ctx.printer);
    const outer = componentLocal(ctx, c);
    const ri = p.r - t / Math.cos(Math.PI / p.n);
    const inner = wasm.Manifold.extrude(wasm.CrossSection.ofPolygons([ngonPoints(p.n, ri)]), p.h).translate([0, 0, t]);
    local = outer.subtract(inner);
    minFeature = t;
    notes.push(`Hollow ${p.n}-sided tower, ${fmt(t)} mm walls, open top.`);
  } else if (c.role === "shell" && p.type === "box") {
    const t = printWallMm(ctx.printer);
    const outer = wasm.Manifold.cube([p.w, p.d, p.h], true).translate([0, 0, p.h / 2]);
    const inner = wasm.Manifold.cube([p.w - 2 * t, p.d - 2 * t, p.h], true).translate([0, 0, p.h / 2 + t]);
    local = outer.subtract(inner);
    minFeature = t;
    notes.push(`Hollow shell, ${fmt(t)} mm walls, closed floor, open top.`);
  } else if (c.role === "roof" && p.type === "gable" && Math.min(p.d, p.h) > 6 * printWallMm(ctx.printer)) {
    // Hollow roof: outer prism minus an inset prism, open underneath (it sits on the walls).
    const t = printWallMm(ctx.printer);
    const alpha = Math.atan2(p.h, p.d / 2);
    const inset = t / Math.sin(alpha);
    const apex = p.h - t / Math.cos(alpha);
    const { Manifold, CrossSection } = wasm;
    const tri = (pts: [number, number][], len: number) =>
      Manifold.extrude(CrossSection.ofPolygons([pts]), len).transform([0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, -len / 2, 0, 0, 1]);
    const outer = tri([[-p.d / 2, 0], [p.d / 2, 0], [0, p.h]], p.w);
    const inner = tri([[-p.d / 2 + inset, -1], [p.d / 2 - inset, -1], [0, apex]], p.w - 2 * t);
    local = outer.subtract(inner);
    minFeature = t;
    notes.push(`Hollow roof shell, ${fmt(t)} mm thick, closed gable ends, open underneath.`);
  } else {
    local = componentLocal(ctx, c);
  }
  let solid = placeSolid(local, c.rotation, c.position);
  const holes = ctx.openingsFor(c.partId);
  if (holes.length) {
    solid = solid.subtract(wasm.Manifold.union(holes));
    notes.push(`${holes.length} opening(s) cut through.`);
  }
  const dom = ctx.dominantsFor?.(c.partId) ?? [];
  if (dom.length) {
    const before = solid.volume();
    const trimmed = solid.subtract(wasm.Manifold.union(dom));
    if (trimmed.volume() < before * 0.999) {
      solid = trimmed;
      notes.push("Shaped to sit against the neighbouring parts (hidden portion removed).");
    }
  }
  return { solid, minFeature, notes };
}

function componentLocal(ctx: PrintContext, c: ComponentSpec): Manifold {
  // componentSolid places it; we want local, so build at origin with zero transform.
  return componentSolid(ctx.wasm, { ...c, position: [0, 0, 0], rotation: [0, 0, 0] }, ctx.meshLoader);
}

const ORIENTATIONS: { label: string; rotation: Vec3 }[] = [
  { label: "As modelled — bottom face on the bed", rotation: [0, 0, 0] },
  { label: "Upside down — top face on the bed", rotation: [180, 0, 0] },
  { label: "Front (−Y) face on the bed", rotation: [90, 0, 0] },
  { label: "Back (+Y) face on the bed", rotation: [-90, 0, 0] },
  { label: "Right (+X) side on the bed", rotation: [0, 90, 0] },
  { label: "Left (−X) side on the bed", rotation: [0, -90, 0] },
];

/** Pick the axis-aligned pose with least overhang, most bed contact, lowest height. */
export function chooseOrientation(solid: Manifold, printer?: PrinterProfile) {
  type Cand = { label: string; rotation: Vec3; solid: Manifold; ov: OverhangResult; score: number; fits: boolean };
  const cands: Cand[] = [];
  for (const o of ORIENTATIONS) {
    const s = dropToBed(solid.rotate(o.rotation));
    const mesh = toMeshData(s);
    const ov = overhangs(mesh);
    const size = bboxSize(bboxOf(s));
    const score = ov.overhangAreaMm2 - 0.25 * ov.bedContactAreaMm2 + 2 * size[2];
    // Also try the pose turned 90° on the bed — a long part may only fit diagonally-free that way.
    const fitsXY = printer ? fits(size, printer) || fits([size[1], size[0], size[2]], printer) : true;
    cands.push({ ...o, solid: fitsXY && printer && !fits(size, printer) ? dropToBed(s.rotate([0, 0, 90])) : s, ov, score, fits: fitsXY });
  }
  // A pose that fits the printer beats any pose that needs splitting.
  const pool = cands.some((c) => c.fits) ? cands.filter((c) => c.fits) : cands;
  return pool.reduce((a, b) => (b.score < a.score - 1e-6 ? b : a));
}

function fits(size: Vec3, pr: PrinterProfile, margin = 4) {
  return size[0] <= pr.buildX - margin && size[1] <= pr.buildY - margin && size[2] <= pr.buildZ - margin;
}

/** Split an oriented solid into sections that fit the printer, with alignment-pin holes at each cut. */
export function splitToFit(wasm: ManifoldToplevel, solid: Manifold, pr: PrinterProfile) {
  let pieces: Manifold[] = [solid];
  let pinCount = 0;
  const warnings: string[] = [];
  const limits: Vec3 = [pr.buildX - 4, pr.buildY - 4, pr.buildZ - 4];
  for (let axis = 0; axis < 3; axis++) {
    const next: Manifold[] = [];
    for (const piece of pieces) {
      const b = bboxOf(piece);
      const len = b.max[axis] - b.min[axis];
      if (len <= limits[axis]) { next.push(piece); continue; }
      const k = Math.ceil(len / (limits[axis] - 2));
      let rest = piece;
      for (let i = 1; i < k; i++) {
        const at = b.min[axis] + (len * i) / k;
        const normal: Vec3 = [0, 0, 0];
        normal[axis] = 1;
        // Pin holes straddling the cut.
        const pins = pinPositions(wasm, rest, axis, at);
        if (pins.length === 0) warnings.push(`Cut at ${fmt(at)} mm on ${"XYZ"[axis]} has no room for alignment pins — glue as a butt joint and align by eye.`);
        let holed = rest;
        for (const ptn of pins) holed = holed.subtract(pinHole(wasm, axis, ptn, pr.clearanceMm));
        pinCount += pins.length;
        const [above, below] = holed.splitByPlane(normal, at);
        next.push(below);
        rest = above;
      }
      next.push(rest);
    }
    pieces = next.filter((m) => !m.isEmpty());
  }
  return { pieces, pinCount, warnings };
}

function pinHole(wasm: ManifoldToplevel, axis: number, p: Vec3, clearance: number): Manifold {
  const r = PIN.d / 2 + clearance / 2;
  let cyl = wasm.Manifold.cylinder(PIN.holeDepth * 2, r, r, 24, true);
  if (axis === 0) cyl = cyl.rotate([0, 90, 0]);
  if (axis === 1) cyl = cyl.rotate([90, 0, 0]);
  return cyl.translate(p);
}

/** Candidate pin centres on the cut plane where a pin plus 1.2 mm of wall fits fully inside the solid. */
function pinPositions(wasm: ManifoldToplevel, solid: Manifold, axis: number, at: number): Vec3[] {
  const b = bboxOf(solid);
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  const guardR = PIN.d / 2 + 1.2;
  const valid: Vec3[] = [];
  const N = 6;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const p: Vec3 = [0, 0, 0];
      p[axis] = at;
      p[u] = b.min[u] + ((b.max[u] - b.min[u]) * i) / N;
      p[v] = b.min[v] + ((b.max[v] - b.min[v]) * j) / N;
      let guard = wasm.Manifold.cylinder(PIN.holeDepth * 2 + 1, guardR, guardR, 24, true);
      if (axis === 0) guard = guard.rotate([0, 90, 0]);
      if (axis === 1) guard = guard.rotate([90, 0, 0]);
      guard = guard.translate(p);
      const inside = guard.intersect(solid).volume();
      if (inside > guard.volume() * 0.995) valid.push(p);
    }
  }
  if (valid.length <= 2) return valid;
  // Two farthest-apart candidates give the best alignment.
  let best: [Vec3, Vec3] = [valid[0], valid[1]];
  let bd = -1;
  for (let i = 0; i < valid.length; i++)
    for (let j = i + 1; j < valid.length; j++) {
      const d = Math.hypot(valid[i][u] - valid[j][u], valid[i][v] - valid[j][v]);
      if (d > bd) { bd = d; best = [valid[i], valid[j]]; }
    }
  return best;
}

export function filamentEstimateG(check: MeshCheckResult, materialKey: string, pr: PrinterProfile): number {
  const m = material(materialKey);
  const density = m.densityGcm3 ?? 1.24;
  if (m.kind === "resin") return (check.volumeMm3 / 1000) * density;
  const lineW = pr.nozzleMm * 1.125;
  const shell = Math.min(check.volumeMm3, check.surfaceAreaMm2 * pr.walls * lineW);
  const inner = Math.max(0, check.volumeMm3 - shell) * (pr.infillPct / 100);
  return ((shell + inner) / 1000) * density;
}

export function buildPrintParts(ctx: PrintContext, parts: ResolvedPart[]): { prints: PrintPart[]; warnings: string[] } {
  const out: PrintPart[] = [];
  const warnings: string[] = [];
  let totalPins = 0;
  for (const part of parts) {
    const c = part.comp;
    const { solid, minFeature, notes } = printSolid(ctx, part);
    if (solid.isEmpty() || solid.volume() < 0.5) {
      warnings.push(`${c.partId}: nothing left to print — it lies entirely inside another part.`);
      continue;
    }
    const worldMesh = toMeshData(solid);
    const best = chooseOrientation(solid, ctx.printer);
    const size0 = bboxSize(bboxOf(best.solid));
    const sectionWarnings: string[] = [];
    let pieces: Manifold[] = [best.solid];
    if (!fits(size0, ctx.printer)) {
      const split = splitToFit(ctx.wasm, best.solid, ctx.printer);
      pieces = split.pieces;
      totalPins += split.pinCount;
      sectionWarnings.push(...split.warnings);
      notes.push(`Too large for ${ctx.printer.name} (${size0.map(fmt).join(" × ")} mm) — split into ${pieces.length} sections with ${split.pinCount} alignment pin(s).`);
    }
    pieces.forEach((piece, i) => {
      const bed = dropToBed(piece);
      const mesh = toMeshData(bed);
      const check = checkMesh(mesh);
      const ov = overhangs(mesh);
      const size = check.size;
      const w: string[] = [...sectionWarnings];
      if (minFeature < ctx.printer.nozzleMm * 2) w.push(`Minimum feature ${fmt(minFeature)} mm is below 2 × nozzle (${fmt(ctx.printer.nozzleMm * 2)} mm) — it may not print.`);
      else if (minFeature < 1) w.push(`Thin feature (${fmt(minFeature)} mm) — fragile.`);
      if (!fits(size, ctx.printer, 0)) w.push(`Still exceeds the build volume after splitting (${size.map(fmt).join(" × ")} mm).`);
      const supports: PrintPart["supports"] = ov.overhangAreaMm2 < 1 ? "none" : ov.overhangFraction > 0.05 ? "required" : "recommended";
      out.push({
        fileId: pieces.length > 1 ? `${c.partId}-S${i + 1}` : c.partId,
        partIds: [c.partId],
        name: pieces.length > 1 ? `${c.name} — section ${i + 1}/${pieces.length}` : c.name,
        materialKey: part.materialKey,
        colorHex: part.colorHex,
        kind: pieces.length > 1 ? "section" : "part",
        mesh,
        worldMesh: i === 0 ? worldMesh : { positions: new Float32Array(), indices: new Uint32Array() },
        worldSolid: i === 0 ? solid : undefined,
        orientation: { label: best.label, rotation: best.rotation },
        check,
        overhang: ov,
        supports,
        size,
        minFeatureMm: minFeature,
        filamentEstimateG: filamentEstimateG(check, part.materialKey, ctx.printer),
        notes: [...notes],
        warnings: w,
      });
    });
  }
  if (totalPins > 0) {
    const len = PIN.holeDepth * 2 - 0.5;
    const pins: Manifold[] = [];
    for (let i = 0; i < totalPins + 2; i++) // two spares
      pins.push(ctx.wasm.Manifold.cylinder(len, PIN.d / 2, PIN.d / 2, 24, false).translate([(i % 6) * 6, Math.floor(i / 6) * 6, 0]));
    const mesh = toMeshData(dropToBed(ctx.wasm.Manifold.union(pins)));
    const check = checkMesh(mesh);
    out.push({
      fileId: "PINS",
      partIds: [],
      name: `Alignment pins ×${totalPins + 2} (incl. 2 spares), Ø${PIN.d} × ${fmt(len)} mm`,
      materialKey: "pla",
      colorHex: "#888888",
      kind: "pins",
      mesh,
      worldMesh: { positions: new Float32Array(), indices: new Uint32Array() },
      orientation: { label: "Standing upright", rotation: [0, 0, 0] },
      check,
      overhang: overhangs(mesh),
      supports: "none",
      size: check.size,
      minFeatureMm: PIN.d,
      filamentEstimateG: filamentEstimateG(check, "pla", ctx.printer),
      notes: ["Print at 100% infill for strength. Test-fit one pin first; sand lightly if tight."],
      warnings: [],
    });
  }
  return { prints: out, warnings };
}

export function fmt(n: number) {
  return Number(n.toFixed(1)).toString();
}
