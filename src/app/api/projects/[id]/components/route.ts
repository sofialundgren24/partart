import { z } from "zod";
import { db } from "@/lib/server/db";
import { PrimitiveSchema } from "@/lib/geometry/types";
import { nextPartId } from "@/lib/design/partIds";
import { handle, json, type Ctx } from "../../../_util";

export const runtime = "nodejs";

const Add = z.object({
  name: z.string().min(1), role: z.string(), parentPartId: z.string().nullable().optional(),
  primitive: PrimitiveSchema, position: z.tuple([z.number(), z.number(), z.number()]).optional(),
  rotation: z.tuple([z.number(), z.number(), z.number()]).optional(), colorHex: z.string().optional(),
});

export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const body = Add.parse(await req.json());
  const existing = await db.component.findMany({ where: { projectId: id }, select: { partId: true } });
  const partId = nextPartId(existing.map((e) => e.partId), body.role);
  const c = await db.component.create({
    data: {
      projectId: id, partId, name: body.name, role: body.role, parentId: body.parentPartId ?? null,
      primitiveJson: JSON.stringify(body.primitive), positionJson: JSON.stringify(body.position ?? [0, 0, 0]), rotationJson: JSON.stringify(body.rotation ?? [0, 0, 0]),
      colorHex: body.colorHex ?? "#d8c7a8", provenance: "user", confidence: 1, sortOrder: existing.length,
    },
  });
  return json(c, 201);
});
