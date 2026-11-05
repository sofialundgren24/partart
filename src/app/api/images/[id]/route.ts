import { db } from "@/lib/server/db";
import { storage } from "@/lib/server/storage";
import { handle, type Ctx } from "../../_util";

export const runtime = "nodejs";

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const img = await db.referenceImage.findUniqueOrThrow({ where: { id } });
  return new Response(new Uint8Array(await storage.get(img.storagePath)), { headers: { "content-type": img.mime, "cache-control": "private, max-age=3600" } });
});
