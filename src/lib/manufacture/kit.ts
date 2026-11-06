// Build-kit orchestrator: design + components → every manufacturing file, validation report, assembly guide,
// shopping list, tutorials and the ZIP. Pure function of its inputs (no DB), so it is directly testable.

import crypto from "node:crypto";
import JSZip from "jszip";
import type { ManifoldToplevel } from "manifold-3d";
import { bboxOf, bboxSize, componentSolid, getManifold, placeSolid, toMeshData, type Manifold } from "../geometry/kernel";
import { checkMesh } from "../geometry/meshCheck";
import { isDoor, primitiveSize, type ComponentSpec, type MeshData, type Vec3 } from "../geometry/types";
import { extrudeXZ, openingSection } from "../geometry/profiles";
import { MATERIALS, material } from "../materials/catalog";
import { write3mf, writeBinaryStl, writeGlb, writeObj, readStl, type GlbNode } from "../export/mesh-formats";
import { layoutsPdf, sheetDxf, sheetSvg } from "../export/vector-formats";
import { assemblyGuidePdf, catalogPdf, textPdf, type CatalogGroup, type CatalogPart, type PartRow } from "../export/pdf-docs";
import { nearestPaint, type Paint } from "../materials/paints";
import type { ShoppingItem } from "../materials/shopping";
import { explodeOffsets, type RenderItem } from "../export/render";
import { buildShoppingList, type ShoppingList } from "../materials/shopping";
import { blenderScript, buildCourse, courseMarkdown } from "../learn/tutorials";
import { assemblySequence, type AssemblyStepDef } from "./assembly";
import { nest, type SheetLayout } from "./nest";
import { claddingPieces, type CladdingCount } from "./cladding";
import { applyCladding, panelSolid, panelsFor, trimPanels, type Panel } from "./panels";
import { buildPrintParts, FRAME, printWallMm, type PrintPart } from "./print";
import { flatten, resolveTree, type Assignment, type LaserProfile, type PrinterProfile, type ResolvedPart } from "./resolve";

export interface KitInput {
  projectName: string;
  category: string;
  designName: string;
  mode: string;
  components: ComponentSpec[];
  assignments: Assignment[];
  printer: PrinterProfile;
  laser: LaserProfile;
  region: string;
  finish: string;
  difficulty?: string;
  claddingAs?: "pieces" | "engrave";
  references: { fileName: string; data: Buffer }[];
  meshLoader?: (p: string) => MeshData;
  analysisNotes?: string[];
}

export type CheckLevel = "pass" | "warn" | "fail";
export interface CheckItem { area: "geometry" | "print" | "laser" | "assembly" | "connection" | "dimensions"; level: CheckLevel; partIds: string[]; message: string }
export type Readiness = "ready" | "ready_with_warnings" | "needs_adjustment" | "not_manufacturable";

export interface KitFile { kitPath: string; data: Buffer; format: string; purpose: string; partIds: string[]; bytes: number; sha256: string }

export interface PrintCard {
  fileId: string; partIds: string[]; name: string; file: string; material: string; colorHex: string;
  layerHeightMm: number; nozzleMm: number; infillPct: number; walls: number; supports: string; adhesion: string;
  orientation: string; sizeMm: Vec3; volumeCm3: number; filamentEstimateG: number; overhangPct: number;
  notes: string[]; warnings: string[]; watertight: boolean;
}

export interface KitResult {
  files: KitFile[];
  readiness: Readiness;
  checks: CheckItem[];
  printCards: PrintCard[];
  layouts: { materialKey: string; thicknessMm: number; method: string; sheetW: number; sheetH: number; sheets: number; wastePct: number; svgFiles: string[]; unplaced: string[] }[];
  steps: AssemblyStepDef[];
  shopping: ShoppingList;
  manualParts: { partId: string; name: string; material: string; size: string; instructions: string }[];
  partsList: PartRow[];
  zip: Buffer;
  catalog: { groups: CatalogGroup[]; parts: Omit<CatalogPart, "render">[] };
  cladding: CladdingCount[];
  stats: { components: number; printedFiles: number; sheetParts: number; sheets: number; filamentG: number };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);

function file(kitPath: string, data: Buffer | string, format: string, purpose: string, partIds: string[] = []): KitFile {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return { kitPath, data: buf, format, purpose, partIds, bytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex") };
}

export async function buildKit(input: KitInput): Promise<KitResult> {
  const wasm = await getManifold();
  const roots = resolveTree(input.components, input.assignments);
  const all = flatten(roots);
  const live = all.filter((p) => p.method !== "omit" && !p.comp.hidden);
  const byId = new Map(all.map((p) => [p.comp.partId, p]));
  const checks: CheckItem[] = [];
  const files: KitFile[] = [];
  const base = `PARTART_${slug(input.projectName) || "project"}`;

  // ---------- hole map (openings + axles) in project space ----------
  const openingChildren = (partId: string) => (byId.get(partId)?.children ?? []).filter((c) => c.comp.role === "opening" && c.method !== "omit");
  const holeCache = new Map<string, Manifold[]>();
  const openingsFor = (partId: string): Manifold[] => {
    if (holeCache.has(partId)) return holeCache.get(partId)!;
    const holes: Manifold[] = [];
    const parent = byId.get(partId);
    for (const o of openingChildren(partId)) {
      const p = o.comp.primitive as { w: number; h: number; arch?: string };
      const ps = primitiveSize(parent!.comp.primitive);
      const depth = Math.max(8, Math.min(20, 0.5 * Math.min(ps[0], ps[1]))); // through one wall, never the opposite one
      holes.push(placeSolid(extrudeXZ(wasm, openingSection(wasm, p.w, p.h, p.arch), depth), o.comp.rotation, o.comp.position));
    }
    // Wheels get an axle bore: the wheel's parent axle plus radial clearance.
    if (parent && parent.comp.role === "wheel") {
      const ax = parent.comp.parentPartId ? byId.get(parent.comp.parentPartId) : undefined;
      if (ax && ax.comp.primitive.type === "cylinder") {
        const r = ax.comp.primitive.r + input.printer.clearanceMm;
        const bore = { ...ax.comp, primitive: { type: "cylinder" as const, r, h: ax.comp.primitive.h } };
        holes.push(componentSolid(wasm, bore, undefined, 32));
      }
    }
    holeCache.set(partId, holes);
    return holes;
  };

  // ---------- precedence trimming ----------
  // Where two parts overlap (a bay against the house, a cross gable running into the main roof, a chimney through
  // the roof), the ancestor — or, between unrelated parts, the earlier one — keeps its shape and the other is
  // trimmed to it. This gives sheet parts their true outline and printed parts their true contact faces.
  const order = new Map(input.components.map((c, i) => [c.partId, i]));
  const ancestors = (id: string) => {
    const out = new Set<string>();
    let cur = byId.get(id)?.comp.parentPartId ?? null;
    while (cur && !out.has(cur)) { out.add(cur); cur = byId.get(cur)?.comp.parentPartId ?? null; }
    return out;
  };
  const VOLUME_ROLES = new Set(["base", "structure", "shell", "roof", "chimney"]);
  const VOLUME_TYPES = new Set(["box", "gable", "hip", "wedge", "ngon", "pyramid", "cylinder"]);
  const volumeSolid = new Map<string, Manifold>();
  const volOf = (p: ResolvedPart) => {
    if (!volumeSolid.has(p.comp.partId)) volumeSolid.set(p.comp.partId, componentSolid(wasm, p.comp, input.meshLoader, 32));
    return volumeSolid.get(p.comp.partId)!;
  };
  const dominantsFor = (partId: string): Manifold[] => {
    const me = byId.get(partId);
    if (!me || me.comp.role === "opening") return [];
    const anc = ancestors(partId);
    const mySolid = volOf(me);
    const mb = mySolid.boundingBox();
    const out: Manifold[] = [];
    for (const other of live) {
      if (other === me || !VOLUME_ROLES.has(other.comp.role) || !VOLUME_TYPES.has(other.comp.primitive.type)) continue;
      if (ancestors(other.comp.partId).has(partId)) continue; // my descendants never trim me
      const wins = anc.has(other.comp.partId) || (order.get(other.comp.partId)! < order.get(partId)!);
      if (!wins) continue;
      const os = volOf(other);
      const ob = os.boundingBox();
      if ([0, 1, 2].some((k) => mb.max[k] <= ob.min[k] + 0.01 || ob.max[k] <= mb.min[k] + 0.01)) continue;
      out.push(os);
    }
    return out;
  };

  // ---------- 3D printing ----------
  const printParts = live.filter((p) => p.method === "print");
  const { prints, warnings: printWarnings } = buildPrintParts({ wasm, printer: input.printer, meshLoader: input.meshLoader, openingsFor, dominantsFor, parentThickness: (id) => { const par = byId.get(id); return par && par.method !== "print" ? material(par.materialKey).thicknessMm ?? 3 : printWallMm(input.printer); } }, printParts);
  for (const w of printWarnings) checks.push({ area: "print", level: "warn", partIds: [], message: w });
  const printCards: PrintCard[] = [];
  const printFolder = (p: PrintPart) => (p.kind === "pins" ? "connectors" : byId.get(p.partIds[0])?.comp.role ?? "parts");
  for (const p of prints) {
    const path = `03_3D_PRINT/${printFolder(p)}/${p.fileId}_${slug(p.name)}.stl`;
    const stl = writeBinaryStl(p.mesh, `PARTART ${p.fileId}`);
    files.push(file(path, stl, "stl", `Print file for ${p.name}`, p.partIds));
    // Round-trip validation: re-read the exact bytes written and check them again.
    const reread = checkMesh(weldForCheck(readStl(stl)));
    const ok = reread.watertight && reread.consistentOrientation && reread.outwardNormals && reread.degenerateTriangles === 0;
    checks.push({ area: "geometry", level: ok ? "pass" : "fail", partIds: p.partIds, message: `${p.fileId}: ${ok ? "watertight, manifold, outward normals (verified on the written STL)" : `mesh defects — boundary edges ${reread.boundaryEdges}, non-manifold ${reread.nonManifoldEdges}, degenerate ${reread.degenerateTriangles}`}` });
    for (const w of p.warnings) checks.push({ area: "print", level: "warn", partIds: p.partIds, message: `${p.fileId}: ${w}` });
    checks.push({ area: "print", level: "pass", partIds: p.partIds, message: `${p.fileId}: fits ${input.printer.name} (${p.size.map((x) => x.toFixed(1)).join(" × ")} mm); ${p.orientation.label.toLowerCase()}; supports ${p.supports}.` });
    printCards.push({
      fileId: p.fileId, partIds: p.partIds, name: p.name, file: path, material: material(p.materialKey).name, colorHex: p.colorHex,
      layerHeightMm: p.kind === "pins" ? Math.min(0.2, input.printer.layerHeightMm) : input.printer.layerHeightMm,
      nozzleMm: input.printer.nozzleMm, infillPct: p.kind === "pins" ? 100 : input.printer.infillPct, walls: input.printer.walls,
      supports: p.supports === "none" ? "None needed" : `${p.supports === "required" ? "Required" : "Recommended"} — ${input.printer.supports === "tree" ? "tree/organic" : "normal"} supports, ${(p.overhang.overhangFraction * 100).toFixed(0)} % of the surface overhangs > 45°`,
      adhesion: input.printer.adhesion === "none" ? (p.overhang.bedContactAreaMm2 < 150 ? "Brim recommended (small footprint)" : "None") : input.printer.adhesion,
      orientation: p.orientation.label, sizeMm: p.size, volumeCm3: p.check.volumeMm3 / 1000, filamentEstimateG: p.filamentEstimateG,
      overhangPct: p.overhang.overhangFraction * 100, notes: p.notes, warnings: p.warnings, watertight: p.check.watertight,
    });
  }
  const groups3mf = new Map<string, PrintPart[]>();
  for (const p of prints) {
    const k = `${p.materialKey}_${p.colorHex.replace("#", "")}`;
    groups3mf.set(k, [...(groups3mf.get(k) ?? []), p]);
  }
  for (const [k, ps] of groups3mf) {
    const buf = await write3mf(ps.map((p) => ({ name: p.fileId, mesh: p.mesh, colorHex: p.colorHex })), `${input.projectName} — ${k}`, { x: input.printer.buildX, y: input.printer.buildY });
    files.push(file(`03_3D_PRINT/3mf_projects/${slug(k)}.3mf`, buf, "3mf", `3MF project: all ${material(ps[0].materialKey).name} parts in ${ps[0].colorHex} (may need more than one plate)`, ps.flatMap((p) => p.partIds)));
  }

  // ---------- sheet parts ----------
  const sheetParts = live.filter((p) => p.method === "laser" || p.method === "paper" || p.method === "cardboard");
  const panelCtx = {
    wasm, openingsOf: (id: string) => openingChildren(id), fingers: input.difficulty !== "easy",
    frameMaterial: live.some((p) => p.method === "laser" && material(p.materialKey).key.startsWith("plywood")) ? { key: "plywood-3", t: 3 } : live.some((p) => p.method === "laser" && p.materialKey === "mdf-3") ? { key: "mdf-3", t: 3 } : null,
    parentThickness: (id: string) => { const par = byId.get(id); return par && par.method !== "print" ? material(par.materialKey).thicknessMm ?? 3 : printWallMm(input.printer); },
  };
  const panels: Panel[] = [];
  const claddingStrips: Panel[] = [];
  const claddingCounts: CladdingCount[] = [];
  const dowelStacks: { partId: string; heightMm: number }[] = [];
  const panelNotes = new Map<string, string[]>();
  for (const sp of sheetParts) {
    const r = panelsFor(panelCtx, sp);
    // Openings and overlapping volumes are cut in 3D, then cladding is engraved on the final outline.
    const cutters = [...openingsFor(sp.comp.partId), ...dominantsFor(sp.comp.partId)];
    const tr = trimPanels(wasm, r.panels, sp.comp, cutters);
    r.panels = [];
    for (const pn of tr.panels) {
      const stripStock = pn.method === "laser" ? { materialKey: "plywood-08", t: 0.8, method: pn.method } : { materialKey: "cardstock-250", t: 0.3, method: pn.method };
      const cp = input.claddingAs !== "engrave" && pn.place ? claddingPieces(wasm, pn, stripStock) : null;
      if (cp) { r.panels.push(cp.base); claddingStrips.push(...cp.strips); claddingCounts.push(cp.count); }
      else r.panels.push(applyCladding(pn));
    }
    if (tr.trimmed || tr.removed) r.notes.push(`${tr.trimmed} panel(s) shaped to meet neighbouring parts or openings${tr.removed ? `, ${tr.removed} hidden panel(s) dropped` : ""}.`);
    panels.push(...r.panels);
    panelNotes.set(sp.comp.partId, r.notes);
    r.warnings.forEach((w) => checks.push({ area: "laser", level: "warn", partIds: [sp.comp.partId], message: w }));
    if (r.notes.some((n) => n.includes("dowel"))) dowelStacks.push({ partId: sp.comp.partId, heightMm: r.panels.length * r.panels[0].thicknessMm });
    if (!r.panels.length) checks.push({ area: "laser", level: "fail", partIds: [sp.comp.partId], message: `${sp.comp.partId}: no sheet geometry could be generated.` });
  }
  // Cladding strips are real cut parts: they are nested onto their own (thin) sheets like everything else.
  panels.push(...claddingStrips);
  const laserPanels = panels.filter((p) => p.method === "laser");
  const paperPanels = panels.filter((p) => p.method !== "laser");
  const layouts: SheetLayout[] = [
    ...nest(wasm, laserPanels, input.laser, { w: input.laser.sheetW, h: input.laser.sheetH }, input.laser.kerfMm),
    ...nest(wasm, paperPanels, { ...input.laser, workX: 297, workY: 210, spacingMm: 4 }, { w: 297, h: 210 }, 0),
  ];
  const layoutSummary: KitResult["layouts"] = [];
  for (const l of layouts) {
    const isLaser = l.method === "laser";
    const folder = isLaser ? "04_LASER_CUT" : "04_PAPER_TEMPLATES";
    const svgFiles: string[] = [];
    l.sheets.forEach((s, i) => {
      const name = `${folder}/${slug(l.materialKey)}_${l.thicknessMm}mm_sheet${i + 1}`;
      const pids = Array.from(new Set(s.placed.map((p) => p.panel.partId)));
      files.push(file(`${name}.svg`, sheetSvg(l, i, { title: `${input.projectName} ${l.materialKey} sheet ${i + 1}`, forPrint: !isLaser }), "svg", `${isLaser ? "Laser" : "Printable"} sheet ${i + 1}: ${s.placed.length} parts`, pids));
      if (isLaser) files.push(file(`${name}.dxf`, sheetDxf(l, i), "dxf", `DXF of sheet ${i + 1} (layers CUT/ENGRAVE/SCORE)`, pids));
      svgFiles.push(`${name}.svg`);
      // Laser checks on the real, compensated contours.
      for (const p of s.placed) {
        const bad = p.cut.filter((c) => c.length < 3 || Math.abs(area(c)) < 0.01);
        const outside = p.cut.some((c) => c.some(([x, y]) => x < -0.01 || y < -0.01 || x > l.sheetW + 0.01 || y > l.sheetH + 0.01));
        if (bad.length || outside) checks.push({ area: "laser", level: "fail", partIds: [p.panel.partId], message: `${p.panel.panelId}: ${bad.length ? "degenerate contour" : ""}${outside ? " outside the sheet" : ""}` });
      }
    });
    for (const u of l.unplaced) checks.push({ area: "laser", level: "fail", partIds: [u.panel.partId], message: `${u.panel.panelId} (${u.panel.label}): ${u.reason}. Reduce the size, use larger stock, or 3D print this part.` });
    const total = l.sheets.length * l.sheetW * l.sheetH;
    const used = l.sheets.reduce((s, x) => s + x.usedAreaMm2, 0);
    if (l.sheets.length)
      checks.push({ area: "laser", level: "pass", partIds: [], message: `${l.materialKey} ${l.thicknessMm} mm: ${l.sheets.reduce((s, x) => s + x.placed.length, 0)} parts on ${l.sheets.length} sheet(s), all contours closed and inside ${l.sheetW} × ${l.sheetH} mm, ≥ ${isLaser ? input.laser.spacingMm : 4} mm spacing, kerf ${l.kerfMm} mm compensated.` });
    layoutSummary.push({ materialKey: l.materialKey, thicknessMm: l.thicknessMm, method: l.method, sheetW: l.sheetW, sheetH: l.sheetH, sheets: l.sheets.length, wastePct: total ? Math.round((1 - used / total) * 100) : 0, svgFiles, unplaced: l.unplaced.map((u) => u.panel.panelId) });
  }
  const laserLayouts = layouts.filter((l) => l.method === "laser" && l.sheets.length);
  const paperLayouts = layouts.filter((l) => l.method !== "laser" && l.sheets.length);
  if (laserLayouts.length) files.push(file("04_LASER_CUT/sheet_layouts.pdf", await layoutsPdf(laserLayouts, input.projectName), "pdf", "Reference printout of all laser sheets"));
  if (paperLayouts.length) files.push(file("04_PAPER_TEMPLATES/templates_print_at_100pct.pdf", await layoutsPdf(paperLayouts, input.projectName), "pdf", "Print-at-100% cut & fold templates"));
  if (claddingCounts.length) {
    const rows = claddingCounts.map((c) => `| ${c.partId} | ${c.label.split(" — ").slice(1).join(" — ")} | ${c.kind} | ${c.courses} | ${c.pieces} | ${c.kind === "shingle" || c.kind === "fishscale" ? c.units : "—"} | ${c.totalLengthMm} | ${c.exposureMm} |`);
    const sum = (k: "pieces" | "totalLengthMm") => claddingCounts.reduce((s, c) => s + c[k], 0);
    const shingles = claddingCounts.filter((c) => c.kind === "shingle" || c.kind === "fishscale").reduce((s, c) => s + c.units, 0);
    const md = [
      "# Shingles & siding — exact counts", "",
      "Every course is its own cut strip (thin sheets: 0.8 mm veneer ply, or cardstock for paper builds). Strip labels: panel · course (R01 = bottom) · letter (left → right).", "",
      "| Part | Surface | Type | Courses | Strips | Shingles | Total strip length mm | Exposure mm |", "|---|---|---|---|---|---|---|---|",
      ...rows, "", `**Total:** ${sum("pieces")} strips, ${shingles} shingles, ${(sum("totalLengthMm") / 1000).toFixed(2)} m of strip.`, "",
    ].join("\n");
    files.push(file("04_LASER_CUT/CLADDING_COUNTS.md", md, "md", "Exact shingle and siding counts per surface", [...new Set(claddingCounts.map((c) => c.partId))]));
  }
  if (laserLayouts.length) files.push(file("04_LASER_CUT/LASER_INSTRUCTIONS.md", laserInstructions(input.laser, laserLayouts), "md", "How to import and cut the sheets"));

  // ---------- assembled manufacturing geometry (shared coordinate system) ----------
  const worldMeshes = new Map<string, MeshData>();
  const lowPoly = new Map<string, MeshData>();
  const worldSolids = new Map<string, Manifold>();
  for (const p of prints) if (p.worldMesh.indices.length) { worldMeshes.set(p.partIds[0], p.worldMesh); if (p.worldSolid) worldSolids.set(p.partIds[0], p.worldSolid); }
  for (const sp of sheetParts) {
    const solids = panels.filter((x) => x.partId === sp.comp.partId).map((x) => panelSolid(wasm, x, sp.comp)).filter((x): x is Manifold => !!x);
    if (solids.length) { const comp = wasm.Manifold.compose(solids); worldMeshes.set(sp.comp.partId, toMeshData(comp)); worldSolids.set(sp.comp.partId, comp); }
    else worldMeshes.set(sp.comp.partId, toMeshData(componentSolid(wasm, sp.comp, input.meshLoader, 24)));
  }
  const manualParts: KitResult["manualParts"] = [];
  for (const mp of live.filter((p) => p.method === "manual")) {
    { const ms = componentSolid(wasm, mp.comp, input.meshLoader, 32); worldMeshes.set(mp.comp.partId, toMeshData(ms)); worldSolids.set(mp.comp.partId, ms); }
    manualParts.push({ partId: mp.comp.partId, name: mp.comp.name, material: material(mp.materialKey).name, size: primitiveSize(mp.comp.primitive).map((x) => x.toFixed(1)).join(" × ") + " mm", instructions: `Make ${mp.comp.name} by hand in ${material(mp.materialKey).name} to ${primitiveSize(mp.comp.primitive).map((x) => x.toFixed(0)).join(" × ")} mm. Print the reference-proxy STL in 02_3D_MODELS if you want a size gauge.` });
    files.push(file(`02_3D_MODELS/size_gauges/${mp.comp.partId}_gauge.stl`, writeBinaryStl(toMeshData(componentSolid(wasm, { ...mp.comp, position: [0, 0, 0], rotation: [0, 0, 0] }, input.meshLoader, 48))), "stl", `Size gauge for the hand-made ${mp.comp.name}`, [mp.comp.partId]));
  }
  for (const p of live) lowPoly.set(p.comp.partId, p.comp.primitive.type === "mesh" ? (worldMeshes.get(p.comp.partId) ?? toMeshData(componentSolid(wasm, p.comp, input.meshLoader))) : toMeshData(componentSolid(wasm, p.comp, input.meshLoader, 18)));

  // ---------- dimensional consistency & connections ----------
  dimensionChecks(wasm, live, worldMeshes, input, checks, dominantsFor);
  // Support check needs every part in place: folded paper nets have no placed geometry, so use their modelled volume.
  const supportSolids = new Map(worldSolids);
  for (const p of live) if (!supportSolids.has(p.comp.partId) && p.comp.role !== "opening") supportSolids.set(p.comp.partId, componentSolid(wasm, p.comp, input.meshLoader, 16));
  connectionChecks(live, byId, input, checks, panels, supportSolids);
  overlapChecks(live, worldSolids, ancestors, checks);

  // ---------- assembly ----------
  const steps = assemblySequence(roots.filter((r) => r.method !== "omit"));
  if (claddingCounts.length) {
    const byPart = new Map<string, CladdingCount[]>();
    for (const c of claddingCounts) byPart.set(c.partId, [...(byPart.get(c.partId) ?? []), c]);
    steps.push({
      index: steps.length + 1, title: "Shingles and siding", partIds: [...byPart.keys()], attachTo: null,
      instructions: [
        "Paint the strips before gluing (much easier than painting afterwards).",
        "Work from the BOTTOM up on every wall and roof surface: course R01 along the bottom edge, then R02 on the next engraved guide line, and so on. Each course overlaps the one below; the course label sits in the hidden overlap.",
        "Strips with the same course number and letters a, b, c… go side by side in that course (left to right as on the sheet). Shingle rows are already staggered.",
        ...[...byPart.entries()].map(([id, cs]) => `${id}: ${cs.map((c) => `${c.label.split(" — ").slice(-1)[0]} ${c.courses} courses, ${c.pieces} strips${c.kind === "shingle" || c.kind === "fishscale" ? ` (${c.units} shingles)` : ""}`).join("; ")}.`),
      ],
      tools: ["Tweezers", "Toothpicks for glue", "Steel ruler"],
      adhesives: ["PVA wood glue (thin) or tacky glue"],
      warnings: ["Use very little glue — excess shows when it squeezes out under the next course."],
    });
  }
  const covered = new Set(steps.flatMap((s) => s.partIds));
  const missing = live.filter((p) => !covered.has(p.comp.partId));
  checks.push(missing.length
    ? { area: "assembly", level: "warn", partIds: missing.map((m) => m.comp.partId), message: `Not in any assembly step: ${missing.map((m) => m.comp.partId).join(", ")} (their parent is omitted).` }
    : { area: "assembly", level: "pass", partIds: [], message: `All ${live.length} components appear in the ${steps.length}-step assembly sequence.` });
  const filesByPart = new Map<string, string[]>();
  for (const f of files) for (const id of f.partIds) filesByPart.set(id, [...(filesByPart.get(id) ?? []), f.kitPath.split("/").pop()!]);
  const unfiled = live.filter((p) => p.method !== "manual" && !filesByPart.has(p.comp.partId));
  checks.push(unfiled.length
    ? { area: "assembly", level: "fail", partIds: unfiled.map((u) => u.comp.partId), message: `No manufacturing file for: ${unfiled.map((u) => u.comp.partId).join(", ")}.` }
    : { area: "assembly", level: "pass", partIds: [], message: "Every component has a manufacturing file or hand-making instructions; every file is traceable to part IDs." });

  // ---------- 3D models ----------
  const colorOf = (p: ResolvedPart) => p.colorHex || material(p.materialKey).colorHex;
  const nodes: GlbNode[] = live.filter((p) => worldMeshes.has(p.comp.partId)).map((p) => ({
    name: p.comp.partId, mesh: worldMeshes.get(p.comp.partId)!, colorHex: colorOf(p), opacity: material(p.materialKey).transparent ? 0.45 : 1,
    extras: { partId: p.comp.partId, name: p.comp.name, method: p.method, material: p.materialKey },
  }));
  files.push(file("02_3D_MODELS/complete_assembly.glb", await writeGlb(nodes, input.projectName), "glb", "Assembled manufacturing geometry (all parts in place)", nodes.map((n) => n.name)));
  files.push(file("02_3D_MODELS/complete_assembly.obj", writeObj(nodes.map((n) => ({ name: n.name, mesh: n.mesh }))), "obj", "Assembled manufacturing geometry (OBJ, mm)", nodes.map((n) => n.name)));
  const offsets = explodeOffsets(nodes.map((n) => ({ id: n.name, mesh: n.mesh })), 0.7);
  const explodedNodes = nodes.map((n) => ({ ...n, mesh: shift(n.mesh, offsets.get(n.name)!) }));
  files.push(file("06_ASSEMBLY/exploded_view.glb", await writeGlb(explodedNodes, `${input.projectName} exploded`), "glb", "Exploded view", nodes.map((n) => n.name)));

  // ---------- readiness ----------
  const readiness: Readiness = checks.some((c) => c.level === "fail" && c.area === "geometry")
    ? "not_manufacturable"
    : checks.some((c) => c.level === "fail")
      ? "needs_adjustment"
      : checks.some((c) => c.level === "warn") ? "ready_with_warnings" : "ready";

  // ---------- parts list, shopping, guide ----------
  const partsList: PartRow[] = live.map((p) => ({
    partId: p.comp.partId, name: p.comp.name, method: p.method, material: material(p.materialKey).name,
    files: filesByPart.get(p.comp.partId) ?? [], size: primitiveSize(p.comp.primitive).map((x) => x.toFixed(1)).join(" × ") + " mm",
  }));
  // Finishes: paint every part whose colour differs from its raw material (natural wood/clear stays unpainted).
  const finishes = new Map<string, { paint: Paint | null; finish: string }>();
  for (const p of live) {
    const m = material(p.materialKey);
    const col = (p.colorHex || m.colorHex).toLowerCase();
    const framed = p.comp.role === "opening" && panels.some((x) => x.partId === p.comp.partId && x.label.endsWith("— frame"));
    if (m.transparent && framed) finishes.set(p.comp.partId, { paint: nearestPaint("#efe6d2"), finish: "clear pane, painted frame" });
    else if (m.transparent) finishes.set(p.comp.partId, { paint: null, finish: "clear — no paint" });
    else if (col === m.colorHex.toLowerCase() && p.method !== "print") finishes.set(p.comp.partId, { paint: null, finish: input.finish === "oiled" ? "natural, oiled" : "natural" });
    else finishes.set(p.comp.partId, { paint: nearestPaint(col), finish: "painted" });
  }
  const glazed = live.filter((p) => p.comp.role === "opening" && !isDoor(p.comp)).map((p) => p.comp.partId);
  const shopping = buildShoppingList({
    region: input.region, layouts, prints, parts: live, steps, dowelStacks, finish: input.finish,
    paints: [...finishes].filter(([, f]) => f.paint).map(([partId, f]) => ({ partId, paint: f.paint! })),
    glazedOpenings: glazed, ornaments: live.filter((p) => p.comp.role === "ornament").map((p) => p.comp.partId),
  });
  const renderItems: RenderItem[] = live.map((p) => ({ id: p.comp.partId, mesh: lowPoly.get(p.comp.partId)!, color: colorOf(p) }));
  const rOff = explodeOffsets(renderItems.map((r) => ({ id: r.id, mesh: r.mesh })), 0.7);
  const guide = await assemblyGuidePdf({
    title: input.projectName, readiness, parts: partsList, steps, renderItems,
    exploded: renderItems.map((r) => ({ ...r, offset: rOff.get(r.id) })),
    finalChecks: [
      "Compare the finished object with the assembled view on page 1 from the front and the side.",
      "Check every joint is fully seated: no visible gaps at finger joints, slots or pins.",
      "Measure the overall size and compare with the dimensions report.",
      "Moving parts (wheels, joints) move freely without wobble.",
      "Let all adhesive cure for the full time on its label before handling or painting.",
      "This guide checks geometric fit only — it is not a structural or safety rating. Do not use as a toy for small children (small parts).",
    ],
  });
  files.push(file("06_ASSEMBLY/assembly_guide.pdf", guide, "pdf", "Step-by-step illustrated assembly guide", live.map((p) => p.comp.partId)));
  steps.forEach((s) => files.push(file(`06_ASSEMBLY/assembly_steps/step_${String(s.index).padStart(2, "0")}.json`, JSON.stringify(s, null, 2), "json", `Assembly step ${s.index}`, s.partIds)));

  // ---------- build catalogue ----------
  const glueFor = new Map<string, string[]>();
  for (const st of steps) for (const id of st.partIds) glueFor.set(id, st.adhesives);
  const notesFor = new Map<string, string[]>();
  for (const c of printCards) for (const id of c.partIds) notesFor.set(id, [...(notesFor.get(id) ?? []), ...c.notes]);
  for (const [id, ns] of panelNotes) notesFor.set(id, [...(notesFor.get(id) ?? []), ...ns]);
  const catalogParts: CatalogPart[] = live.map((p) => {
    const m = material(p.materialKey);
    const f = finishes.get(p.comp.partId)!;
    return {
      partId: p.comp.partId, name: p.comp.name, method: METHOD_NAME[p.method] ?? p.method, material: m.name, materialSwatch: m.colorHex,
      paint: f.paint ? { name: f.paint.name, hex: f.paint.hex } : null, finish: f.finish, glue: glueFor.get(p.comp.partId) ?? [],
      files: filesByPart.get(p.comp.partId) ?? [], size: primitiveSize(p.comp.primitive).map((x) => x.toFixed(1)).join(" × ") + " mm",
      notes: [...(notesFor.get(p.comp.partId) ?? []), ...manualParts.filter((x) => x.partId === p.comp.partId).map((x) => x.instructions)],
      render: [{ id: p.comp.partId, mesh: lowPoly.get(p.comp.partId)!, color: f.paint?.hex ?? colorOf(p) }],
    };
  });
  const groupDefs: [string, string[]][] = [
    ["Wood", ["sheet:wood", "wood"]], ["Acrylic & glazing", ["sheet:acrylic"]], ["Card & paper", ["paper", "sheet:card"]], ["3D-printing filament", ["filament"]],
    ["Metal", ["metal"]], ["Paint & finishing", ["paint", "finishing"]], ["Adhesives", ["adhesive"]], ["Lighting", ["lighting"]], ["Hardware & other", ["hardware", "clay", "fabric", "tool"]],
  ];
  const catOf = (i: ShoppingItem) => i.category === "sheet" ? (i.key.startsWith("acrylic") ? "sheet:acrylic" : /card|grey/.test(i.key) ? "sheet:card" : "sheet:wood") : i.category;
  const catalogGroups: CatalogGroup[] = groupDefs.map(([heading, cats]) => ({
    heading,
    items: shopping.items.filter((i) => i.tier !== "premium" && cats.includes(catOf(i))).map((i) => ({ name: i.name, spec: i.spec, quantity: i.quantity, swatch: i.swatch ?? (i.category === "sheet" || i.category === "filament" ? swatchFor(i.key) : undefined), usedFor: i.usedFor })),
  }));
  files.push(file("05_MATERIALS/build_catalogue.pdf", await catalogPdf({ title: input.projectName, cover: renderItems, groups: catalogGroups, parts: catalogParts }), "pdf", "Illustrated build catalogue: materials, colours, glue and every part", live.map((p) => p.comp.partId)));

  files.push(file("05_MATERIALS/material_manifest.json", JSON.stringify({ region: input.region, items: shopping.items, notes: shopping.notes }, null, 2), "json", "Machine-readable material list"));
  files.push(file("05_MATERIALS/shopping_list.csv", shoppingCsv(shopping), "csv", "Shopping list (spreadsheet)"));
  files.push(file("05_MATERIALS/shopping_list.pdf", await textPdf(`${input.projectName} — shopping list`, [
    ...(["minimum", "recommended", "premium"] as const).map((tier) => ({
      heading: tier === "minimum" ? "Minimum shopping list" : tier === "recommended" ? "Recommended additions" : "Optional premium materials",
      lines: shopping.items.filter((i) => i.tier === tier).map((i) => `${i.name} — ${i.spec} — qty ${i.quantity}${i.wastePct !== undefined ? ` (≈${i.wastePct}% waste)` : ""}${i.usedFor.length ? ` — for ${i.usedFor.join(", ")}` : ""}${i.suppliers.length ? ` — e.g. ${i.suppliers.map((s) => `${s.name} (${s.url})`).join("; ")}` : ""}`),
    })),
    { heading: "Notes", lines: shopping.notes },
  ]), "pdf", "Printable shopping list"));

  // ---------- tutorials ----------
  const refNames = input.references.map((r) => r.fileName);
  files.push(file("07_TUTORIALS/blender/build_blockout.py", blenderScript(input.projectName, input.components, refNames), "py", "Blender script that builds the blockout scene", input.components.map((c) => c.partId)));
  files.push(file("07_TUTORIALS/blender/course.md", courseMarkdown(buildCourse("blender", input.projectName, input.category, input.components)), "md", "Personalised Blender course"));
  files.push(file("07_TUTORIALS/nomad_sculpt/course.md", courseMarkdown(buildCourse("nomad", input.projectName, input.category, input.components)), "md", "Personalised Nomad Sculpt course"));

  // ---------- reference + documentation ----------
  input.references.forEach((r) => files.push(file(`01_REFERENCE/${r.fileName}`, r.data, r.fileName.split(".").pop() ?? "img", "Original reference")));
  const proxyNodes: GlbNode[] = input.components.filter((c) => !c.hidden).map((c) => ({ name: c.partId, mesh: lowPoly.get(c.partId) ?? toMeshData(componentSolid(wasm, c, input.meshLoader, 24)), colorHex: c.colorHex }));
  files.push(file("02_3D_MODELS/reference_proxy.glb", await writeGlb(proxyNodes, `${input.projectName} proxy`), "glb", "Reconstruction proxy (approved component geometry, not a scan)", proxyNodes.map((n) => n.name)));
  files.push(file("08_DOCUMENTATION/validation_report.json", JSON.stringify({ readiness, checks, note: ENGINEERING_NOTE }, null, 2), "json", "Manufacturing validation report"));
  files.push(file("08_DOCUMENTATION/dimensions.csv", dimensionsCsv(input.components, worldMeshes), "csv", "Modelled vs manufactured dimensions per part"));
  files.push(file("08_DOCUMENTATION/manufacturing_report.pdf", await textPdf(`${input.projectName} — manufacturing report`, [
    { heading: `Readiness: ${readiness.replace(/_/g, " ")}`, lines: [ENGINEERING_NOTE, `Design: ${input.designName} (${input.mode}). Printer: ${input.printer.name}. Laser: ${input.laser.name}, kerf ${input.laser.kerfMm} mm.`] },
    ...(["geometry", "print", "laser", "connection", "dimensions", "assembly"] as const).map((a) => ({ heading: a[0].toUpperCase() + a.slice(1), lines: checks.filter((c) => c.area === a).map((c) => `[${c.level.toUpperCase()}] ${c.message}`) })),
    { heading: "3D print cards", lines: printCards.map((c) => `${c.fileId} ${c.name}: ${c.material}, layer ${c.layerHeightMm} mm, nozzle ${c.nozzleMm} mm, ${c.walls} walls, ${c.infillPct}% infill, ${c.orientation}, supports: ${c.supports}. ≈${c.filamentEstimateG.toFixed(0)} g (estimate; print time: see slicer).`) },
    { heading: "Analysis notes", lines: input.analysisNotes ?? [] },
  ]), "pdf", "Human-readable manufacturing report"));

  const manifest = {
    project: input.projectName, design: input.designName, mode: input.mode, generatedAt: new Date().toISOString(), readiness,
    coordinateSystem: "millimetres, Z up, origin at the centre of the base",
    components: input.components.map((c) => ({ partId: c.partId, name: c.name, role: c.role, parent: c.parentPartId, provenance: c.provenance, confidence: c.confidence, method: byId.get(c.partId)?.method, material: byId.get(c.partId)?.materialKey, files: filesByPart.get(c.partId) ?? [] })),
    files: files.map((f) => ({ path: f.kitPath, format: f.format, purpose: f.purpose, partIds: f.partIds, bytes: f.bytes, sha256: f.sha256 })),
  };
  files.push(file("08_DOCUMENTATION/project_manifest.json", JSON.stringify(manifest, null, 2), "json", "Every file, its purpose and traceability"));
  files.push(file("README.md", kitReadme(input, readiness, files), "md", "Start here"));

  const zip = new JSZip();
  for (const f of files) zip.file(`${base}/${f.kitPath}`, f.data);
  const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

  return {
    files, readiness, checks, printCards, layouts: layoutSummary, steps, shopping, manualParts, partsList, zip: zipBuf,
    cladding: claddingCounts,
    catalog: { groups: catalogGroups, parts: catalogParts.map(({ render: _r, ...rest }) => { void _r; return rest; }) },
    stats: { components: live.length, printedFiles: prints.length, sheetParts: panels.length, sheets: layouts.reduce((s, l) => s + l.sheets.length, 0), filamentG: prints.reduce((s, p) => s + p.filamentEstimateG, 0) },
  };
}

export const ENGINEERING_NOTE = "Validation covers geometry (watertight/manifold meshes, closed cut paths), fit (build volume, sheet size, clearances, mating dimensions) and completeness. It is not structural engineering: a valid mesh is not proof that a part is strong, safe or load-bearing.";

function weldForCheck(m: MeshData): MeshData {
  // STL stores unshared vertices; weld exact duplicates so edge topology can be checked.
  const map = new Map<string, number>();
  const pos: number[] = [];
  const idx = new Uint32Array(m.indices.length);
  for (let i = 0; i < m.indices.length; i++) {
    const v = m.indices[i] * 3;
    const key = `${m.positions[v]},${m.positions[v + 1]},${m.positions[v + 2]}`;
    let k = map.get(key);
    if (k === undefined) { k = pos.length / 3; pos.push(m.positions[v], m.positions[v + 1], m.positions[v + 2]); map.set(key, k); }
    idx[i] = k;
  }
  return { positions: new Float32Array(pos), indices: idx };
}

function area(c: [number, number][]) {
  let a = 0;
  for (let i = 0; i < c.length; i++) { const [x0, y0] = c[i], [x1, y1] = c[(i + 1) % c.length]; a += x0 * y1 - x1 * y0; }
  return a / 2;
}

function shift(m: MeshData, o: Vec3): MeshData {
  const p = new Float32Array(m.positions);
  for (let i = 0; i < p.length; i += 3) { p[i] += o[0]; p[i + 1] += o[1]; p[i + 2] += o[2]; }
  return { positions: p, indices: m.indices };
}

function dimensionChecks(wasm: ManifoldToplevel, live: ResolvedPart[], world: Map<string, MeshData>, input: KitInput, checks: CheckItem[], dominantsFor: (id: string) => Manifold[]) {
  for (const p of live) {
    const m = world.get(p.comp.partId);
    if (!m || p.comp.role === "opening") continue;
    // Compare against the modelled shape *after* precedence trimming (a chimney is meant to stop at the roof).
    let target = componentSolid(wasm, p.comp, input.meshLoader, 24);
    const dom = dominantsFor(p.comp.partId);
    if (dom.length) { const tr = target.subtract(wasm.Manifold.union(dom)); if (!tr.isEmpty()) target = tr; }
    const want = bboxSize(bboxOf(target));
    const got = checkMesh(m).size;
    const t = material(p.materialKey).thicknessMm ?? 0;
    const tol = Math.max(1, 1.01 * t, 0.02 * Math.max(...want));
    // Thin dimensions of flat trim (railings, fretwork) follow the sheet thickness, not the model.
    const worst = Math.max(...want.map((w, i) => (w < 5 ? 0 : Math.abs(w - got[i]))));
    checks.push({
      area: "dimensions", level: worst <= tol ? "pass" : "warn", partIds: [p.comp.partId],
      message: `${p.comp.partId}: manufactured ${got.map((x) => x.toFixed(1)).join(" × ")} mm vs modelled ${want.map((x) => x.toFixed(1)).join(" × ")} mm (max deviation ${worst.toFixed(1)} mm, tolerance ${tol.toFixed(1)} mm${p.method === "laser" ? ", layered/sheet construction rounds to whole sheets" : ""}).`,
    });
  }
}

function connectionChecks(live: ResolvedPart[], byId: Map<string, ResolvedPart>, input: KitInput, checks: CheckItem[], panels: Panel[], solids: Map<string, Manifold>) {
  for (const p of live) {
    const parentId = p.comp.parentPartId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (!parent || parent.method === "omit") continue;
    const ids = [p.comp.partId, parent.comp.partId];
    if (p.comp.role === "opening" && p.comp.primitive.type === "box") {
      const o = p.comp.primitive;
      const pm = material(p.materialKey);
      const pt = material(parent.materialKey).thicknessMm ?? 2;
      if (parent.comp.primitive.type === "box" && parent.comp.rotation.every((r) => r === 0)) {
        const pb = parent.comp.primitive;
        const along = Math.abs(p.comp.rotation[2]) % 180 === 90 ? pb.d : pb.w;
        const localX = Math.abs(p.comp.rotation[2]) % 180 === 90 ? p.comp.position[1] - parent.comp.position[1] : p.comp.position[0] - parent.comp.position[0];
        const margin = along / 2 - (Math.abs(localX) + o.w / 2);
        const need = pt + (pm.transparent ? 3 : FRAME.border);
        checks.push({ area: "connection", level: margin >= need ? "pass" : "warn", partIds: ids, message: `${p.comp.partId} in ${parent.comp.partId}: ${margin.toFixed(1)} mm from the corner (needs ≥ ${need.toFixed(1)} mm for the ${pm.transparent ? "pane overlap" : "frame"} to clear the corner joint).` });
      } else {
        checks.push({ area: "connection", level: "pass", partIds: ids, message: `${p.comp.partId}: ${o.arch && o.arch !== "none" ? `${o.arch}-arched ` : ""}opening cut through the ${parent.comp.primitive.type} ${parent.comp.partId} in 3D.` });
      }
      if (pm.transparent || /door leaf/i.test(panels.find((x) => x.partId === p.comp.partId)?.label ?? "") || (p.method === "print" && isDoor(p.comp))) checks.push({ area: "connection", level: "pass", partIds: ids, message: `${p.comp.partId}: ${pm.transparent ? "pane" : "door leaf"} ${(o.w + 6).toFixed(1)} × ${(o.h + 6).toFixed(1)} mm overlaps the ${o.w.toFixed(1)} × ${o.h.toFixed(1)} mm hole by 3 mm per side.` });
      else checks.push({ area: "connection", level: "pass", partIds: ids, message: `${p.comp.partId}: frame aperture ${(o.w - 2 * FRAME.lip).toFixed(1)} × ${(o.h - 2 * FRAME.lip).toFixed(1)} mm sits inside the ${o.w.toFixed(1)} × ${o.h.toFixed(1)} mm hole with ${FRAME.lip} mm lip.` });
      continue;
    }
    if (p.comp.role === "wheel" && parent.comp.role === "axle" && p.method === "print") {
      checks.push({ area: "connection", level: "pass", partIds: ids, message: `${p.comp.partId}: axle bore = axle Ø + ${(2 * input.printer.clearanceMm).toFixed(2)} mm diametral clearance (free-spinning).` });
      continue;
    }
    // Support: every part must touch something (its parent or a neighbour) in the manufactured geometry.
    const me = solids.get(p.comp.partId);
    if (!me) continue;
    const mb = me.boundingBox();
    const touching = [...solids.entries()].filter(([id, o]) => {
      if (id === p.comp.partId) return false;
      const ob = o.boundingBox();
      return [0, 1, 2].every((k) => mb.min[k] <= ob.max[k] + 0.6 && ob.min[k] <= mb.max[k] + 0.6);
    }).map(([id]) => id);
    if (!touching.length) checks.push({ area: "connection", level: "warn", partIds: ids, message: `${p.comp.partId} does not touch any other part — it would float. Check its position.` });
    else checks.push({ area: "connection", level: "pass", partIds: [p.comp.partId, ...touching.slice(0, 3)], message: `${p.comp.partId} is supported by ${touching.slice(0, 3).join(", ")}${touching.length > 3 ? ` +${touching.length - 3}` : ""}.` });
  }
  // Only stock that carries slots/fingers/tabs is sensitive to thickness (panes and plain slices are not).
  const jointed = panels.filter((p) => p.method === "laser" && /wall|floor|lid/.test(p.label) && !/-C\d{3}$/.test(p.panelId));
  const laserThick = new Set(jointed.map((p) => `${p.materialKey} ${p.thicknessMm} mm`));
  for (const t of laserThick) checks.push({ area: "connection", level: "warn", partIds: [], message: `Slots and finger joints are sized for nominal ${t}. Measure your stock — if it differs by > 0.1 mm, update the material and regenerate.` });
}

function overlapChecks(live: ResolvedPart[], solids: Map<string, Manifold>, ancestors: (id: string) => Set<string>, checks: CheckItem[]) {
  // Runs on the real manufacturing geometry (after trimming), so it reports physical collisions, not modelling overlaps.
  const list = live.filter((p) => p.comp.role !== "opening" && solids.has(p.comp.partId)).map((p) => ({ p, s: solids.get(p.comp.partId)! }));
  let clean = 0;
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const A = list[i], B = list[j];
      const ba = A.s.boundingBox(), bb = B.s.boundingBox();
      if ([0, 1, 2].some((k) => ba.max[k] <= bb.min[k] || bb.max[k] <= ba.min[k])) continue;
      const v = A.s.intersect(B.s).volume();
      const small = Math.min(A.s.volume(), B.s.volume());
      if (v < 0.02 * small || v < 1) { clean++; continue; }
      const related = ancestors(A.p.comp.partId).has(B.p.comp.partId) || ancestors(B.p.comp.partId).has(A.p.comp.partId);
      checks.push({
        area: "assembly", level: related ? "pass" : "warn", partIds: [A.p.comp.partId, B.p.comp.partId],
        message: related
          ? `${A.p.comp.partId} and ${B.p.comp.partId} interlock by ${v.toFixed(0)} mm³ (parent/child — e.g. a tab in a slot or a pane behind its wall).`
          : `${A.p.comp.partId} and ${B.p.comp.partId} still collide by ${v.toFixed(0)} mm³ (${((100 * v) / small).toFixed(0)} % of the smaller part) after trimming — adjust their positions or parent one to the other.`,
      });
    }
  checks.push({ area: "assembly", level: "pass", partIds: [], message: `Collision check on the manufactured parts: ${clean} touching pairs with no meaningful overlap.` });
}

function dimensionsCsv(components: ComponentSpec[], world: Map<string, MeshData>) {
  const rows = ["part_id,name,primitive,model_w_mm,model_d_mm,model_h_mm,mfg_x_mm,mfg_y_mm,mfg_z_mm,provenance,confidence"];
  for (const c of components) {
    const s = primitiveSize(c.primitive);
    const m = world.get(c.partId);
    const g = m ? checkMesh(m).size : null;
    rows.push([c.partId, `"${c.name}"`, c.primitive.type, ...s.map((x) => x.toFixed(2)), ...(g ? g.map((x) => x.toFixed(2)) : ["", "", ""]), c.provenance, c.confidence.toFixed(2)].join(","));
  }
  return rows.join("\n") + "\n";
}

function shoppingCsv(s: ShoppingList) {
  const rows = ["tier,category,name,spec,quantity,waste_pct,used_for,basis,suppliers"];
  for (const i of s.items) rows.push([i.tier, i.category, i.name, i.spec, i.quantity, i.wastePct ?? "", i.usedFor.join(" "), i.basis, i.suppliers.map((x) => x.url).join(" ")].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  return rows.join("\n") + "\n";
}

function laserInstructions(l: LaserProfile, layouts: SheetLayout[]) {
  return `# Laser cutting instructions

Machine profile: **${l.name}** — work area ${l.workX} × ${l.workY} mm, kerf compensation **${l.kerfMm} mm** already applied to every cut path.

## Layers / colours
| Colour | Layer | Operation |
|---|---|---|
| Red #FF0000 | CUT | Cut through (line mode) |
| Blue #0000FF | ENGRAVE | Line engrave / mark at low power (labels, alignment marks) |
| Green #00A000 | SCORE | Very low power, does not cut through (fold/score lines) |

The DXF files use layers named CUT, ENGRAVE and SCORE with the same meanings. Lines are hairlines (0.01 mm). Some software treats stroke colour, some treats layer names — check after import that you see three layers.

## Sheets
${layouts.map((x) => `- ${x.materialKey} ${x.thicknessMm} mm: ${x.sheets.length} sheet(s) of ${x.sheetW} × ${x.sheetH} mm`).join("\n")}

## Importing
- **Inkscape:** open the SVG directly — the document is in mm at true size. Layers panel (Ctrl+Shift+L) shows CUT, SCORE and ENGRAVE; Objects panel lists every part as a named group (e.g. "C-BODY-01-P03 · Main walls — front wall"). Hide ENGRAVE to see only the cut lines; move a part by selecting its group in each layer. Save as *Plain SVG* for laser software, or export DXF (R14) via Save As.
- **LightBurn:** File → Import → choose the SVG (or DXF). Verify the size in the Shape Properties (should match the sheet). Assign speed/power per colour layer. Set "Cut" layers to Line mode.
- **xTool Creative Space:** Import the SVG; each colour becomes a separate group — set the red group to *Cut*, blue to *Engrave (line)*, green to *Score*. Check the material thickness setting matches your stock.
- Other software: import at 1:1, units mm. If the drawing comes in 3.78× too large or small, your software assumed 96 DPI pixels — set import units to millimetres.

## Test cut first (always)
1. Cut a 20 × 20 mm square and a 20 mm slot from an offcut with your planned settings.
2. Measure the square: if it is smaller than 20 mm by more than 0.05 mm, your kerf is larger than ${l.kerfMm} mm — update the profile and regenerate.
3. Test that a tab from the same stock fits the slot: snug by hand = good; loose = increase kerf; too tight = decrease kerf.

## Safety
Never leave a laser unattended. Do not cut PVC/vinyl (toxic chlorine gas) or polycarbonate. Use air assist and extraction. Plywood glue and MDF produce smoke and fine dust.
`;
}

function kitReadme(input: KitInput, readiness: Readiness, files: KitFile[]) {
  const count = (pfx: string) => files.filter((f) => f.kitPath.startsWith(pfx)).length;
  return `# ${input.projectName} — PARTART build kit

Design: **${input.designName}** (${input.mode}) · Readiness: **${readiness.replace(/_/g, " ")}**

Units: millimetres, Z up. Every part has an ID (e.g. C-ROOF-01) used in file names, sheet labels, the shopping list and the assembly guide.

| Folder | Contents |
|---|---|
| 01_REFERENCE | your reference images (${count("01_")}) |
| 02_3D_MODELS | assembled model (GLB/OBJ), reconstruction proxy, size gauges (${count("02_")}) |
| 03_3D_PRINT | one STL per printable part, oriented for printing, + 3MF projects (${count("03_")}) |
| 04_LASER_CUT / 04_PAPER_TEMPLATES | SVG + DXF per sheet, PDF layouts, instructions (${count("04_")}) |
| 05_MATERIALS | shopping list (PDF/CSV/JSON) (${count("05_")}) |
| 06_ASSEMBLY | illustrated assembly guide PDF, exploded GLB, step data (${count("06_")}) |
| 07_TUTORIALS | Blender script + courses (${count("07_")}) |
| 08_DOCUMENTATION | validation report, dimensions, manifest (${count("08_")}) |

Start with 06_ASSEMBLY/assembly_guide.pdf, then 08_DOCUMENTATION/manufacturing_report.pdf.

Print time and exact filament use are not included — open the STL/3MF files in PrusaSlicer, OrcaSlicer or Bambu Studio for those.

${ENGINEERING_NOTE}
`;
}

const METHOD_NAME: Record<string, string> = { print: "3D print", laser: "Laser cut", paper: "Paper", cardboard: "Cardboard", manual: "Hand-made / bought" };
function swatchFor(key: string) {
  const m = MATERIALS.find((x) => key.startsWith(x.key));
  return m?.colorHex;
}
