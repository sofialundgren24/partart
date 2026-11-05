import { z } from "zod";
import { db } from "@/lib/server/db";
import { startBuild } from "@/lib/server/projects";
import { handle, json, type Ctx } from "../../../_util";

export const runtime = "nodejs";

const Printer = z.object({
  name: z.string(), buildX: z.number().positive(), buildY: z.number().positive(), buildZ: z.number().positive(),
  nozzleMm: z.number().positive(), layerHeightMm: z.number().positive(), filament: z.string(), walls: z.number().int().min(1).max(10),
  infillPct: z.number().int().min(0).max(100), supports: z.enum(["none", "normal", "tree"]), adhesion: z.enum(["none", "brim", "raft"]),
  clearanceMm: z.number().min(0).max(1),
});
const Laser = z.object({
  name: z.string(), workX: z.number().positive(), workY: z.number().positive(), kerfMm: z.number().min(0).max(1),
  software: z.enum(["LightBurn", "xTool Creative Space", "Other"]), sheetW: z.number().positive(), sheetH: z.number().positive(),
  spacingMm: z.number().min(0.5).max(20), jointClearanceMm: z.number().min(0).max(1),
});

export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const b = z.object({ designId: z.string(), printer: Printer.optional(), laser: Laser.optional() }).parse(await req.json());
  const d = await db.manufacturingDesign.findUniqueOrThrow({ where: { id: b.designId } });
  if (d.projectId !== id) return json({ error: "Design belongs to another project" }, 400);
  const { build, job } = await startBuild(id, b.designId, b.printer, b.laser);
  return json({ build, job }, 202);
});

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  return json(await db.buildKit.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" } }));
});
