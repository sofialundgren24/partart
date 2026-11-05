import { db } from "@/lib/server/db";
import { storage } from "@/lib/server/storage";
import { handle, json, type Ctx } from "../../../_util";

export const runtime = "nodejs";

/** The assembled manufacturing geometry of a kit (what will actually be cut/printed, in place). */
export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const f = await db.generatedFile.findFirst({ where: { buildId: id, kitPath: "02_3D_MODELS/complete_assembly.glb" } });
  if (!f) return json({ error: "No assembled model for this build" }, 404);
  return new Response(new Uint8Array(await storage.get(f.storagePath)), { headers: { "content-type": "model/gltf-binary" } });
});
