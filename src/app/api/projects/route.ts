import { db } from "@/lib/server/db";
import { storage } from "@/lib/server/storage";
import { enqueue } from "@/lib/server/jobs";
import { importMesh } from "@/lib/server/projects";
import { handle, json } from "../_util";

export const runtime = "nodejs";

export const GET = handle(async () => {
  const projects = await db.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: { images: { take: 1 }, _count: { select: { components: true, builds: true } } },
  });
  return json(projects);
});

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const num = (v: FormDataEntryValue | null) => (v && !isNaN(Number(v)) && Number(v) > 0 ? Number(v) : null);

export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const name = String(form.get("name") || "").trim() || "Untitled object";
  const images = form.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
  const views = form.getAll("views").map(String);
  const mesh = form.get("mesh");
  const hasMesh = mesh instanceof File && mesh.size > 0;
  if (!images.length && !hasMesh) return json({ error: "Upload at least one image or a 3D model." }, 400);
  for (const img of images) {
    if (!IMAGE_TYPES.includes(img.type)) return json({ error: `${img.name}: unsupported image type ${img.type || "unknown"} (use JPG, PNG, WebP or GIF).` }, 400);
    if (img.size > 15 * 1024 * 1024) return json({ error: `${img.name} is larger than 15 MB.` }, 400);
  }
  const project = await db.project.create({
    data: {
      name, description: String(form.get("description") || ""), intent: String(form.get("intent") || ""),
      category: String(form.get("category") || "other"), templateKey: form.get("templateKey") ? String(form.get("templateKey")) : null, targetSizeMm: num(form.get("targetSizeMm")), realSizeMm: num(form.get("realSizeMm")),
      region: String(form.get("region") || "SE"),
    },
  });
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const safeName = `${String(i + 1).padStart(2, "0")}_${img.name.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
    const rel = await storage.put(`projects/${project.id}/reference/${safeName}`, Buffer.from(await img.arrayBuffer()));
    await db.referenceImage.create({ data: { projectId: project.id, storagePath: rel, fileName: safeName, mime: img.type, view: views[i] || "unspecified" } });
  }
  let meshNote: string | null = null;
  if (hasMesh) {
    const r = await importMesh(project.id, (mesh as File).name, Buffer.from(await (mesh as File).arrayBuffer()), project.targetSizeMm);
    meshNote = r.notes;
  }
  const job = await enqueue("analyze", project.id);
  return json({ project, job, meshNote }, 201);
});
