import { z } from "zod";
import { db } from "@/lib/server/db";
import { PrimitiveSchema } from "@/lib/geometry/types";
import { handle, json, type Ctx } from "../../../../_util";

export const runtime = "nodejs";

const Patch = z.object({
  name: z.string().min(1).optional(), role: z.string().optional(), parentPartId: z.string().nullable().optional(),
  primitive: PrimitiveSchema.optional(), position: z.tuple([z.number(), z.number(), z.number()]).optional(),
  rotation: z.tuple([z.number(), z.number(), z.number()]).optional(), colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  hidden: z.boolean().optional(), notes: z.string().optional(),
});

export const PATCH = handle(async (req: Request, { params }: Ctx<{ id: string; partId: string }>) => {
  const { id, partId } = await params;
  const b = Patch.parse(await req.json());
  if (b.parentPartId === partId) return json({ error: "A component cannot be its own parent." }, 400);
  const geometryEdited = b.primitive || b.position || b.rotation;
  const c = await db.component.update({
    where: { projectId_partId: { projectId: id, partId } },
    data: {
      name: b.name, role: b.role, parentId: b.parentPartId === undefined ? undefined : b.parentPartId,
      primitiveJson: b.primitive ? JSON.stringify(b.primitive) : undefined,
      positionJson: b.position ? JSON.stringify(b.position) : undefined,
      rotationJson: b.rotation ? JSON.stringify(b.rotation) : undefined,
      colorHex: b.colorHex, hidden: b.hidden, notes: b.notes,
      ...(geometryEdited ? { provenance: "user", confidence: 1 } : {}),
    },
  });
  return json(c);
});

export const DELETE = handle(async (_req: Request, { params }: Ctx<{ id: string; partId: string }>) => {
  const { id, partId } = await params;
  const c = await db.component.findUniqueOrThrow({ where: { projectId_partId: { projectId: id, partId } } });
  await db.component.updateMany({ where: { projectId: id, parentId: partId }, data: { parentId: c.parentId } });
  await db.component.delete({ where: { id: c.id } });
  await db.componentAssignment.deleteMany({ where: { partId, design: { projectId: id } } });
  return json({ ok: true });
});
