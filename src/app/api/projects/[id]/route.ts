import { z } from "zod";
import { db } from "@/lib/server/db";
import { storage } from "@/lib/server/storage";
import { handle, json, type Ctx } from "../../_util";

export const runtime = "nodejs";

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const project = await db.project.findUniqueOrThrow({
    where: { id },
    include: {
      images: true,
      analyses: { orderBy: { version: "desc" }, take: 1 },
      reconstructions: { orderBy: { createdAt: "desc" } },
      components: { orderBy: [{ sortOrder: "asc" }, { partId: "asc" }] },
      relationships: true,
      designs: { include: { assignments: true }, orderBy: { createdAt: "asc" } },
      jobs: { orderBy: { createdAt: "desc" }, take: 5 },
      builds: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  return json(project);
});

const Patch = z.object({
  name: z.string().min(1).optional(), description: z.string().optional(), intent: z.string().optional(),
  category: z.string().optional(), targetSizeMm: z.number().positive().nullable().optional(), realSizeMm: z.number().positive().nullable().optional(),
  region: z.string().optional(), activeDesignId: z.string().nullable().optional(),
});

export const PATCH = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const data = Patch.parse(await req.json());
  return json(await db.project.update({ where: { id }, data }));
});

export const DELETE = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  await db.project.delete({ where: { id } });
  await storage.remove(`projects/${id}`);
  return json({ ok: true });
});
