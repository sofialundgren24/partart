import { projectSpecs, meshLoader } from "@/lib/server/projects";
import { componentSolid, getManifold, toMeshData } from "@/lib/geometry/kernel";
import { renderSvg } from "@/lib/export/render";
import { handle, type Ctx } from "../../../_util";

export const runtime = "nodejs";

/** Isometric render of the project's blockout, optionally highlighting some parts (used as lesson visuals). */
export const GET = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const hl = new Set((new URL(req.url).searchParams.get("highlight") ?? "").split(",").filter(Boolean));
  const wasm = await getManifold();
  const comps = (await projectSpecs(id)).filter((c) => !c.hidden);
  const items = comps.map((c) => ({
    id: c.partId, mesh: toMeshData(componentSolid(wasm, c, meshLoader, 18)), color: c.colorHex,
    style: hl.size ? (hl.has(c.partId) ? ("highlight" as const) : ("ghost" as const)) : ("normal" as const),
  }));
  return new Response(renderSvg(items, 480, 360), { headers: { "content-type": "image/svg+xml", "cache-control": "no-store" } });
});
