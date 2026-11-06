import { z } from "zod";
import { db } from "@/lib/server/db";
import { createDesign, designInputs, meshLoader } from "@/lib/server/projects";
import { conceptStats } from "@/lib/design/compare";
import { DEFAULT_CONTROLS, MODES, type ModeKey } from "@/lib/design/modes";
import { handle, json, type Ctx } from "../../../_util";

export const runtime = "nodejs";

/** List designs with comparison stats computed from real panel areas / solid volumes. */
export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const designs = await db.manufacturingDesign.findMany({ where: { projectId: id }, include: { assignments: true }, orderBy: { createdAt: "asc" } });
  const out = [];
  for (const d of designs) {
    const { comps, assignments, controls } = await designInputs(id, d);
    out.push({ ...d, controls, stats: await conceptStats(d.mode as ModeKey, comps, assignments, meshLoader) });
  }
  return json(out);
});

const Create = z.object({
  mode: z.enum(MODES.map((m) => m.key) as [ModeKey, ...ModeKey[]]),
  name: z.string().optional(),
  controls: z.object({
    detail: z.number().min(0).max(1), difficulty: z.enum(["easy", "medium", "hard"]), targetSizeMm: z.number().positive().nullable(),
    palette: z.enum(["reference", "bold", "natural", "mono"]), finish: z.enum(["raw", "painted", "oiled", "polished"]), claddingAs: z.enum(["pieces", "engrave"]), shingleExposureMm: z.number().min(1.5).max(20),
  }).partial().optional(),
});

export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const b = Create.parse(await req.json());
  const d = await createDesign(id, b.mode, { ...DEFAULT_CONTROLS, ...b.controls }, b.name);
  return json(d, 201);
});
