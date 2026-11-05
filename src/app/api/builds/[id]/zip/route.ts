import { db } from "@/lib/server/db";
import { storage } from "@/lib/server/storage";
import { handle, json, type Ctx } from "../../../_util";

export const runtime = "nodejs";

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const b = await db.buildKit.findUniqueOrThrow({ where: { id } });
  if (!b.zipPath || !storage.exists(b.zipPath)) return json({ error: "Kit not generated yet" }, 404);
  return new Response(new Uint8Array(await storage.get(b.zipPath)), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${b.zipPath.split("/").pop()}"` },
  });
});
