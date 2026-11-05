import { db } from "@/lib/server/db";
import { storage } from "@/lib/server/storage";
import { handle, json, type Ctx } from "../../../_util";

export const runtime = "nodejs";

/** Add more reference views (e.g. ones the analysis asked for). Re-run analysis afterwards to use them. */
export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const form = await req.formData();
  const files = form.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
  const views = form.getAll("views").map(String);
  const existing = await db.referenceImage.count({ where: { projectId: id } });
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f.type.startsWith("image/")) return json({ error: `${f.name} is not an image` }, 400);
    const safe = `${String(existing + i + 1).padStart(2, "0")}_${f.name.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
    const rel = await storage.put(`projects/${id}/reference/${safe}`, Buffer.from(await f.arrayBuffer()));
    out.push(await db.referenceImage.create({ data: { projectId: id, storagePath: rel, fileName: safe, mime: f.type, view: views[i] || "unspecified" } }));
  }
  return json(out, 201);
});
