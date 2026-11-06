import { z } from "zod";
import { db } from "@/lib/server/db";
import { projectSpecs } from "@/lib/server/projects";
import { DEFAULT_CONTROLS, modeExtras, proposeAssignments, type DesignControls, type ModeKey } from "@/lib/design/modes";
import { handle, json, type Ctx } from "../../_util";

export const runtime = "nodejs";

const Patch = z.object({
  name: z.string().min(1).optional(),
  controls: z.object({
    detail: z.number().min(0).max(1), difficulty: z.enum(["easy", "medium", "hard"]), targetSizeMm: z.number().positive().nullable(),
    palette: z.enum(["reference", "bold", "natural", "mono"]), finish: z.enum(["raw", "painted", "oiled", "polished"]), claddingAs: z.enum(["pieces", "engrave"]), shingleExposureMm: z.number().min(1.5).max(20),
  }).partial().optional(),
  /** Re-run the mode's proposals for every component the user has not locked. */
  repropose: z.boolean().optional(),
});

export const PATCH = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const b = Patch.parse(await req.json());
  const d = await db.manufacturingDesign.findUniqueOrThrow({ where: { id }, include: { assignments: true } });
  const controls: DesignControls = { ...DEFAULT_CONTROLS, ...JSON.parse(d.controlsJson), ...b.controls };
  await db.manufacturingDesign.update({ where: { id }, data: { name: b.name, controlsJson: JSON.stringify(controls) } });
  if (b.repropose || b.controls) {
    const comps = await projectSpecs(d.projectId);
    const all = [...comps, ...modeExtras(d.mode as ModeKey, comps)];
    const locked = new Set(d.assignments.filter((a) => a.userLocked).map((a) => a.partId));
    for (const p of proposeAssignments(d.mode as ModeKey, all, controls)) {
      if (locked.has(p.partId)) continue;
      await db.componentAssignment.upsert({
        where: { designId_partId: { designId: id, partId: p.partId } },
        create: { designId: id, partId: p.partId, method: p.method, materialKey: p.materialKey, colorHex: p.colorHex },
        update: { method: p.method, materialKey: p.materialKey, colorHex: p.colorHex },
      });
    }
  }
  return json(await db.manufacturingDesign.findUniqueOrThrow({ where: { id }, include: { assignments: true } }));
});

export const DELETE = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const d = await db.manufacturingDesign.delete({ where: { id } });
  const p = await db.project.findUniqueOrThrow({ where: { id: d.projectId } });
  if (p.activeDesignId === id) await db.project.update({ where: { id: p.id }, data: { activeDesignId: null } });
  return json({ ok: true });
});
