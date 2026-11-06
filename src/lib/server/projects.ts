// Server-side project services: analysis + kit jobs, component mapping, mesh import, designs.
import type { Component, ManufacturingDesign, ComponentAssignment } from "@prisma/client";
import { db } from "./db";
import { storage } from "./storage";
import { registerJob, enqueue } from "./jobs";
import { pickProvider, templateProvider, type AnalysisResult } from "../analysis/providers";
import { scaleComponent } from "../analysis/templates";
import { bboxOf, bboxSize, componentSolid, getManifold, manifoldFromMesh, toMeshData, weldVertices, meshBBox } from "../geometry/kernel";
import { checkMesh } from "../geometry/meshCheck";
import { PrimitiveSchema, type ComponentSpec, type MeshData, type Vec3 } from "../geometry/types";
import { readGlb, readObj, readStl, writeBinaryStl, writeGlb } from "../export/mesh-formats";
import { buildKit } from "../manufacture/kit";
import { DEFAULT_CONTROLS, modeExtras, proposeAssignments, type DesignControls, type ModeKey } from "../design/modes";
import { LASER_PRESETS, PRINTER_PRESETS, type LaserProfile, type PrinterProfile } from "../manufacture/resolve";
import type { Method } from "../materials/catalog";

export function toSpec(c: Component): ComponentSpec {
  return {
    partId: c.partId, name: c.name, role: c.role, parentPartId: c.parentId,
    primitive: PrimitiveSchema.parse(JSON.parse(c.primitiveJson)),
    position: JSON.parse(c.positionJson) as Vec3, rotation: JSON.parse(c.rotationJson) as Vec3,
    colorHex: c.colorHex, provenance: c.provenance, confidence: c.confidence, hidden: c.hidden,
  };
}

export async function projectSpecs(projectId: string): Promise<ComponentSpec[]> {
  const rows = await db.component.findMany({ where: { projectId }, orderBy: [{ sortOrder: "asc" }, { partId: "asc" }] });
  return rows.map(toSpec);
}

export function meshLoader(rel: string): MeshData {
  return weldVertices(readStl(storage.getSync(rel)), 1e-4);
}

/** Real bounding size of a component set, from actual solids. */
export async function measuredSize(comps: ComponentSpec[]): Promise<Vec3> {
  if (!comps.length) return [0, 0, 0];
  const wasm = await getManifold();
  const solids = comps.filter((c) => !c.hidden).map((c) => componentSolid(wasm, c, meshLoader, 16));
  if (!solids.length) return [0, 0, 0];
  return bboxSize(bboxOf(wasm.Manifold.compose(solids)));
}

export async function writeComponents(projectId: string, comps: (Omit<ComponentSpec, "hidden"> & { notes?: string })[]) {
  await db.component.deleteMany({ where: { projectId } });
  await db.component.createMany({
    data: comps.map((c, i) => ({
      projectId, partId: c.partId, name: c.name, role: c.role, parentId: c.parentPartId,
      primitiveJson: JSON.stringify(c.primitive), positionJson: JSON.stringify(c.position.map(round)), rotationJson: JSON.stringify(c.rotation.map(round)),
      colorHex: c.colorHex, provenance: c.provenance, confidence: c.confidence, notes: c.notes ?? "", sortOrder: i,
    })),
  });
}

const round = (n: number) => Math.round(n * 100) / 100;

// ---------------- mesh import (reconstruction provider: mesh-import) ----------------

export async function importMesh(projectId: string, fileName: string, data: Buffer, targetSizeMm: number | null) {
  const ext = fileName.toLowerCase().split(".").pop();
  let mesh: MeshData;
  if (ext === "stl") mesh = readStl(data);
  else if (ext === "obj") mesh = readObj(data.toString("utf8"));
  else if (ext === "glb") mesh = await readGlb(data);
  else throw new Error("Supported mesh formats: STL, OBJ, GLB");
  mesh = weldVertices(mesh, 1e-5);
  let b = meshBBox(mesh);
  let size = bboxSize(b);
  let notes = `Imported ${fileName}: ${mesh.indices.length / 3} triangles.`;
  // Unit heuristic: tiny models were almost certainly exported in metres.
  if (Math.max(...size) < 5) { mesh = scaleMesh(mesh, 1000); notes += " Units looked like metres — converted to mm."; }
  b = meshBBox(mesh);
  size = bboxSize(b);
  const f = targetSizeMm ? targetSizeMm / Math.max(...size) : 1;
  // Centre on X/Y, base on z = 0, then scale.
  const P = new Float32Array(mesh.positions);
  const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, z0 = b.min[2];
  for (let i = 0; i < P.length; i += 3) { P[i] = (P[i] - cx) * f; P[i + 1] = (P[i + 1] - cy) * f; P[i + 2] = (P[i + 2] - z0) * f; }
  mesh = { positions: P, indices: mesh.indices };
  const chk = checkMesh(mesh);
  // Try to make it a proper solid. manifold-3d refuses non-manifold input, so report honestly if it fails.
  let solidOk = false;
  try {
    const wasm = await getManifold();
    const m = manifoldFromMesh(wasm, mesh);
    if (m.status() === "NoError" && !m.isEmpty()) { mesh = toMeshData(m); solidOk = true; }
  } catch { /* reported below */ }
  if (!solidOk) notes += ` Mesh is not watertight (${chk.boundaryEdges} open edges, ${chk.nonManifoldEdges} non-manifold) — repair it (e.g. Blender 3D-Print Toolbox → Make Manifold, or Meshmixer) before printing; validation will fail until then.`;
  const rel = await storage.put(`projects/${projectId}/reconstruction/imported.stl`, writeBinaryStl(mesh));
  const s = bboxSize(meshBBox(mesh));
  await db.reconstructedModel.create({ data: { projectId, provider: "mesh-import", kind: "imported", storagePath: rel, format: "stl", notes } });
  return { rel, size: s, notes, solidOk };
}

function scaleMesh(m: MeshData, f: number): MeshData {
  const p = new Float32Array(m.positions);
  for (let i = 0; i < p.length; i++) p[i] *= f;
  return { positions: p, indices: m.indices };
}

// ---------------- jobs ----------------

registerJob("analyze", async (job, progress) => {
  const project = await db.project.findUniqueOrThrow({ where: { id: job.projectId }, include: { images: true, reconstructions: true } });
  await db.project.update({ where: { id: project.id }, data: { status: "analyzing" } });
  const imported = project.reconstructions.find((r) => r.kind === "imported");
  let result: AnalysisResult;
  const provider = project.images.length ? pickProvider() : templateProvider;
  await progress(0.1, provider.id === "claude-vision" ? "Looking at your reference with Claude vision…" : "No vision model configured — preparing an editable template…");
  try {
    result = await provider.analyse({
      images: await Promise.all(project.images.map(async (i) => ({ mime: i.mime, data: await storage.get(i.storagePath), view: i.view, note: i.note }))),
      description: project.description, intent: project.intent, categoryHint: project.category, templateKey: project.templateKey,
      realSizeMm: project.realSizeMm, targetSizeMm: project.targetSizeMm,
    });
  } catch (e) {
    if (provider.id === "template") throw e;
    await progress(0.4, `Vision analysis failed (${e instanceof Error ? e.message : e}); falling back to template.`);
    result = await templateProvider.analyse({ images: [], description: project.description, intent: project.intent, categoryHint: project.category, templateKey: project.templateKey, realSizeMm: project.realSizeMm, targetSizeMm: project.targetSizeMm });
    result.findings.assumptions.unshift(`Vision analysis failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  await progress(0.6, "Building component hierarchy and scaling to your target size…");
  let comps: (Omit<ComponentSpec, "hidden"> & { notes?: string })[] = result.components;
  if (imported?.storagePath) {
    const s = bboxSize(meshBBox(meshLoader(imported.storagePath)));
    comps = [{ partId: "C-SCAN-01", name: "Imported model", role: "imported", parentPartId: null, primitive: { type: "mesh", storagePath: imported.storagePath, w: s[0], d: s[1], h: s[2] }, position: [0, 0, 0], rotation: [0, 0, 0], colorHex: "#c9b79c", provenance: "imported", confidence: 0.9, notes: imported.notes }];
    result.findings.assumptions.unshift("Components come from your imported 3D model (single body). Split it in your modelling tool for separate parts.");
  } else if (project.targetSizeMm) {
    const size = await measuredSize(comps.map((c) => ({ ...c, hidden: false })));
    const f = project.targetSizeMm / Math.max(1, ...size);
    comps = comps.map((c) => scaleComponent(c, f));
    result.findings.scaleBasis += ` Scaled ×${f.toFixed(3)} so the largest dimension is ${project.targetSizeMm} mm.`;
  }
  await writeComponents(project.id, comps);
  await db.componentRelationship.deleteMany({ where: { projectId: project.id } });
  if (result.relationships.length)
    await db.componentRelationship.createMany({ data: result.relationships.map((r) => ({ projectId: project.id, fromPart: r.from, toPart: r.to, type: r.type })) });
  const version = (await db.objectAnalysis.count({ where: { projectId: project.id } })) + 1;
  await db.objectAnalysis.create({
    data: { projectId: project.id, version, provider: result.provider, model: result.model, category: result.category, summary: result.summary, findingsJson: JSON.stringify(result.findings), rawJson: JSON.stringify(result.raw ?? {}) },
  });
  if (!imported) await db.reconstructedModel.create({ data: { projectId: project.id, provider: "parametric-proxy", kind: "proxy", notes: `Primitive proxy from ${result.provider} analysis v${version}.` } });
  await db.project.update({ where: { id: project.id }, data: { status: "analyzed", category: result.category } });
  return { components: comps.length, provider: result.provider };
});

registerJob("build-kit", async (job, progress) => {
  const { buildId } = job.payload as { buildId: string };
  const build = await db.buildKit.findUniqueOrThrow({ where: { id: buildId } });
  const project = await db.project.findUniqueOrThrow({ where: { id: job.projectId }, include: { images: true, analyses: { orderBy: { version: "desc" }, take: 1 } } });
  const design = await db.manufacturingDesign.findUniqueOrThrow({ where: { id: build.designId }, include: { assignments: true } });
  await progress(0.05, "Collecting components and design…");
  const { comps, assignments } = await designInputs(project.id, design);
  await progress(0.15, "Generating solids, sheets, joints and files…");
  // Idempotent: clear anything from a previous attempt.
  await db.generatedFile.deleteMany({ where: { buildId } });
  await db.assemblyStep.deleteMany({ where: { buildId } });
  await db.validationReport.deleteMany({ where: { buildId } });
  await db.shoppingList.deleteMany({ where: { buildId } });
  const controls = { ...DEFAULT_CONTROLS, ...(JSON.parse(design.controlsJson) as Partial<DesignControls>) };
  const findings = project.analyses[0] ? JSON.parse(project.analyses[0].findingsJson) : null;
  const kit = await buildKit({
    projectName: project.name, category: project.category, designName: design.name, mode: design.mode,
    components: comps, assignments, printer: JSON.parse(build.printerProfileJson) as PrinterProfile, laser: JSON.parse(build.laserProfileJson) as LaserProfile,
    region: project.region, finish: controls.finish, difficulty: controls.difficulty, claddingAs: controls.claddingAs,
    references: await Promise.all(project.images.map(async (i) => ({ fileName: i.fileName, data: await storage.get(i.storagePath) }))),
    meshLoader,
    analysisNotes: findings ? [project.analyses[0].summary, ...(findings.assumptions ?? []), findings.scaleBasis].filter(Boolean) : [],
  });
  await progress(0.8, `Saving ${kit.files.length} files…`);
  const dir = `projects/${project.id}/builds/${buildId}`;
  for (const f of kit.files) {
    const rel = await storage.put(`${dir}/kit/${f.kitPath}`, f.data);
    await db.generatedFile.create({ data: { buildId, kitPath: f.kitPath, storagePath: rel, format: f.format, purpose: f.purpose, partIds: JSON.stringify(f.partIds), bytes: f.bytes, sha256: f.sha256 } });
  }
  const zipRel = await storage.put(`${dir}/PARTART_${project.name.replace(/[^A-Za-z0-9]+/g, "_")}.zip`, kit.zip);
  await db.validationReport.create({ data: { buildId, status: kit.readiness, reportJson: JSON.stringify({ checks: kit.checks, printCards: kit.printCards, layouts: kit.layouts, manualParts: kit.manualParts, partsList: kit.partsList, stats: kit.stats, catalog: kit.catalog, cladding: kit.cladding }) } });
  await db.shoppingList.create({ data: { buildId, listJson: JSON.stringify(kit.shopping) } });
  for (const s of kit.steps) await db.assemblyStep.create({ data: { buildId, index: s.index, title: s.title, contentJson: JSON.stringify(s) } });
  await db.buildKit.update({ where: { id: buildId }, data: { status: "done", readiness: kit.readiness, zipPath: zipRel, snapshotJson: JSON.stringify({ components: comps, assignments, controls }) } });
  await db.project.update({ where: { id: project.id }, data: { status: "ready" } });
  return { readiness: kit.readiness, files: kit.files.length };
});

// ---------------- designs ----------------

export async function designInputs(projectId: string, design: ManufacturingDesign & { assignments: ComponentAssignment[] }) {
  const base = await projectSpecs(projectId);
  const controls = { ...DEFAULT_CONTROLS, ...(JSON.parse(design.controlsJson) as Partial<DesignControls>) };
  let comps = [...base, ...modeExtras(design.mode as ModeKey, base)];
  if (controls.targetSizeMm) {
    const size = await measuredSize(base);
    const f = controls.targetSizeMm / Math.max(1, ...size);
    if (Math.abs(f - 1) > 1e-3) comps = comps.map((c) => (c.primitive.type === "mesh" ? c : scaleComponent(c, f)));
  }
  const assignments = design.assignments.map((a) => ({ partId: a.partId, method: a.method as Method, materialKey: a.materialKey, colorHex: a.colorHex }));
  // Components added after the design was created get the mode's default proposal.
  const known = new Set(assignments.map((a) => a.partId));
  const missing = comps.filter((c) => !known.has(c.partId));
  if (missing.length) assignments.push(...proposeAssignments(design.mode as ModeKey, missing, controls));
  return { comps, assignments, controls };
}

export async function createDesign(projectId: string, mode: ModeKey, controls: DesignControls, name?: string) {
  const comps = await projectSpecs(projectId);
  const all = [...comps, ...modeExtras(mode, comps)];
  const proposals = proposeAssignments(mode, all, controls);
  const design = await db.manufacturingDesign.create({
    data: {
      projectId, mode, name: name ?? mode[0].toUpperCase() + mode.slice(1), controlsJson: JSON.stringify(controls),
      assignments: { create: proposals.map((p) => ({ partId: p.partId, method: p.method, materialKey: p.materialKey, colorHex: p.colorHex })) },
    },
  });
  await db.project.update({ where: { id: projectId }, data: { activeDesignId: design.id, status: "designing" } });
  return design;
}

export async function startBuild(projectId: string, designId: string, printer?: PrinterProfile, laser?: LaserProfile) {
  const build = await db.buildKit.create({
    data: { projectId, designId, printerProfileJson: JSON.stringify(printer ?? PRINTER_PRESETS[0]), laserProfileJson: JSON.stringify(laser ?? LASER_PRESETS[0]) },
  });
  const job = await enqueue("build-kit", projectId, { buildId: build.id });
  await db.project.update({ where: { id: projectId }, data: { status: "building" } });
  return { build, job };
}

export async function proxyGlb(projectId: string): Promise<Buffer> {
  const wasm = await getManifold();
  const comps = await projectSpecs(projectId);
  const nodes = comps.map((c) => ({
    name: c.partId, mesh: toMeshData(componentSolid(wasm, c, meshLoader, 40)), colorHex: c.colorHex,
    opacity: c.role === "opening" ? 0.6 : 1,
    extras: { partId: c.partId, name: c.name, role: c.role, provenance: c.provenance, confidence: c.confidence },
  }));
  return writeGlb(nodes, "proxy");
}

export function ensureJobsRegistered() {
  // Importing this module registers the handlers; this function exists so routes can import it explicitly.
  return true;
}
