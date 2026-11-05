import { z } from "zod";
import { db } from "@/lib/server/db";
import { MATERIALS } from "@/lib/materials/catalog";
import { handle, json, type Ctx } from "../../../_util";

export const runtime = "nodejs";

const Patch = z.object({
  partIds: z.array(z.string()).min(1),
  method: z.enum(["print", "laser", "paper", "cardboard", "manual", "omit"]),
  materialKey: z.string(),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

/** Override one or more components' manufacturing (e.g. "make the roof wooden"). Locks them against re-proposal. */
export const PATCH = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const b = Patch.parse(await req.json());
  const m = MATERIALS.find((x) => x.key === b.materialKey);
  if (!m) return json({ error: `Unknown material ${b.materialKey}` }, 400);
  if (b.method !== "omit" && !m.methods.includes(b.method)) return json({ error: `${m.name} cannot be used for ${b.method}. Allowed: ${m.methods.join(", ")}` }, 400);
  for (const partId of b.partIds)
    await db.componentAssignment.upsert({
      where: { designId_partId: { designId: id, partId } },
      create: { designId: id, partId, method: b.method, materialKey: b.materialKey, colorHex: b.colorHex ?? null, userLocked: true },
      update: { method: b.method, materialKey: b.materialKey, ...(b.colorHex !== undefined ? { colorHex: b.colorHex } : {}), userLocked: true },
    });
  return json(await db.manufacturingDesign.findUniqueOrThrow({ where: { id }, include: { assignments: true } }));
});
