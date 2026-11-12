import { db } from "@/lib/server/db";
import { projectSpecs, proxyGlb } from "@/lib/server/projects";
import { inferHiddenSides } from "@/lib/analysis/inference";
import { handle, type Ctx } from "../../../_util";

export const runtime = "nodejs";

/** Proxy model. `?preview=id1,id2` adds those hidden-side suggestions (not saved) for a look before accepting. */
export const GET = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const want = new URL(req.url).searchParams.get("preview")?.split(",").filter(Boolean) ?? [];
  let preview: Awaited<ReturnType<typeof inferHiddenSides>>[number]["components"] = [];
  if (want.length) {
    const p = await db.project.findUniqueOrThrow({ where: { id } });
    preview = inferHiddenSides(await projectSpecs(id), JSON.parse(p.dismissedSuggestions)).filter((s) => want.includes(s.id)).flatMap((s) => s.components);
  }
  const glb = await proxyGlb(id, preview);
  return new Response(new Uint8Array(glb), { headers: { "content-type": "model/gltf-binary", "cache-control": "no-store" } });
});
