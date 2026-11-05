import { z } from "zod";
import { db } from "@/lib/server/db";
import { measuredSize, projectSpecs, writeComponents, meshLoader } from "@/lib/server/projects";
import { scaleComponent } from "@/lib/analysis/templates";
import { nextPartId } from "@/lib/design/partIds";
import { bboxOf, componentSolid, getManifold } from "@/lib/geometry/kernel";
import type { ComponentSpec, Vec3 } from "@/lib/geometry/types";
import { handle, json, type Ctx } from "../../../../_util";

export const runtime = "nodejs";

const Op = z.discriminatedUnion("op", [
  z.object({ op: z.literal("merge"), partIds: z.array(z.string()).min(2) }),
  z.object({ op: z.literal("split"), partId: z.string() }),
  z.object({ op: z.literal("duplicate"), partId: z.string(), mirrorX: z.boolean().optional() }),
  z.object({ op: z.literal("rescale"), targetSizeMm: z.number().positive() }),
]);

export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const op = Op.parse(await req.json());
  const specs = await projectSpecs(id);
  const rows = await db.component.findMany({ where: { projectId: id } });
  const notes = new Map(rows.map((r) => [r.partId, r.notes]));
  let next: ComponentSpec[] = specs;
  let message = "";

  if (op.op === "rescale") {
    const size = await measuredSize(specs);
    const f = op.targetSizeMm / Math.max(1, ...size);
    next = specs.map((c) => (c.primitive.type === "mesh" ? c : scaleComponent(c, f)));
    await db.project.update({ where: { id }, data: { targetSizeMm: op.targetSizeMm } });
    message = `Scaled ×${f.toFixed(3)}${specs.some((c) => c.primitive.type === "mesh") ? " (imported meshes keep their size — re-import to rescale)" : ""}.`;
  } else if (op.op === "merge") {
    const wasm = await getManifold();
    const group = specs.filter((c) => op.partIds.includes(c.partId));
    if (group.length < 2) return json({ error: "Select at least two components" }, 400);
    const b = bboxOf(wasm.Manifold.compose(group.map((c) => componentSolid(wasm, c, meshLoader, 16))));
    const [first] = group;
    const merged: ComponentSpec = {
      ...first, name: `${first.name} (merged)`, primitive: { type: "box", w: b.max[0] - b.min[0], d: b.max[1] - b.min[1], h: b.max[2] - b.min[2] },
      position: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]], rotation: [0, 0, 0], provenance: "user",
      confidence: Math.min(...group.map((g) => g.confidence)),
    };
    const removed = new Set(group.slice(1).map((g) => g.partId));
    next = specs
      .filter((c) => !removed.has(c.partId))
      .map((c) => (c.partId === first.partId ? merged : c.parentPartId && removed.has(c.parentPartId) ? { ...c, parentPartId: first.partId } : c));
    message = `Merged ${group.length} components into ${first.partId} as their bounding box.`;
  } else if (op.op === "split") {
    const c = specs.find((s) => s.partId === op.partId);
    if (!c || c.primitive.type !== "box") return json({ error: "Only box components can be split (along their longest axis)." }, 400);
    if (c.rotation.some((r) => r)) return json({ error: "Split is only supported for unrotated boxes." }, 400);
    const p = c.primitive;
    const axis = [p.w, p.d, p.h].indexOf(Math.max(p.w, p.d, p.h));
    const half = { ...p };
    const off: Vec3 = [0, 0, 0];
    if (axis === 0) { half.w = p.w / 2; off[0] = p.w / 4; }
    if (axis === 1) { half.d = p.d / 2; off[1] = p.d / 4; }
    if (axis === 2) { half.h = p.h / 2; off[2] = p.h / 2; }
    const a: ComponentSpec = { ...c, primitive: half, position: axis === 2 ? c.position : [c.position[0] - off[0], c.position[1] - off[1], c.position[2]], provenance: "user", name: `${c.name} A` };
    const newId = nextPartId(specs.map((s) => s.partId), c.role);
    const bComp: ComponentSpec = { ...c, partId: newId, primitive: half, position: [c.position[0] + off[0], c.position[1] + off[1], c.position[2] + off[2]], provenance: "user", name: `${c.name} B` };
    next = specs.flatMap((s) => (s.partId === c.partId ? [a, bComp] : [s]));
    message = `Split ${c.partId} into ${c.partId} and ${newId} along ${"XYZ"[axis]}.`;
  } else if (op.op === "duplicate") {
    const c = specs.find((s) => s.partId === op.partId);
    if (!c) return json({ error: "Component not found" }, 404);
    const newId = nextPartId(specs.map((s) => s.partId), c.role);
    const pos: Vec3 = op.mirrorX ? [-c.position[0], c.position[1], c.position[2]] : [c.position[0] + 10, c.position[1], c.position[2]];
    const rot: Vec3 = op.mirrorX ? [c.rotation[0], -c.rotation[1], -c.rotation[2]] : c.rotation;
    next = [...specs, { ...c, partId: newId, name: `${c.name} ${op.mirrorX ? "(mirrored)" : "copy"}`, position: pos, rotation: rot, provenance: "user" }];
    message = `Created ${newId}.`;
  }
  await writeComponents(id, next.map((c) => ({ ...c, notes: notes.get(c.partId) ?? "" })));
  for (const c of next.filter((c) => c.hidden)) await db.component.update({ where: { projectId_partId: { projectId: id, partId: c.partId } }, data: { hidden: true } });
  return json({ ok: true, message });
});
