import { db } from "@/lib/server/db";
import { storage } from "@/lib/server/storage";
import { handle, json, type Ctx } from "../../_util";

export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  stl: "model/stl", "3mf": "model/3mf", glb: "model/gltf-binary", obj: "text/plain", svg: "image/svg+xml", dxf: "application/dxf",
  pdf: "application/pdf", json: "application/json", csv: "text/csv", md: "text/markdown; charset=utf-8", py: "text/x-python; charset=utf-8",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};

export const GET = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const f = await db.generatedFile.findUniqueOrThrow({ where: { id } });
  if (!storage.exists(f.storagePath)) return json({ error: "File missing from storage — regenerate the kit." }, 410);
  const inline = new URL(req.url).searchParams.has("inline");
  const name = f.kitPath.split("/").pop()!;
  return new Response(new Uint8Array(await storage.get(f.storagePath)), {
    headers: {
      "content-type": TYPES[f.format] ?? "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
      "x-sha256": f.sha256,
    },
  });
});
