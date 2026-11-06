import { projectSpecs, meshLoader } from "@/lib/server/projects";
import { componentSolid, getManifold, toMeshData } from "@/lib/geometry/kernel";
import { renderSvg } from "@/lib/export/render";
import { handle, type Ctx } from "../../../_util";

export const runtime = "nodejs";

/** Isometric render of the project's blockout, optionally highlighting some parts (used as lesson visuals). */
export const GET = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const hl = new Set((sp.get("highlight") ?? "").split(",").filter(Boolean));
  const solo = sp.get("solo");
  const color = sp.get("color");
  const wasm = await getManifold();
  const comps = (await projectSpecs(id)).filter((c) => !c.hidden && (!solo || c.partId === solo));
  const items = comps.map((c) => ({
    id: c.partId, mesh: toMeshData(componentSolid(wasm, c, meshLoader, 18)), color: solo && color ? `#${color.replace("#", "")}` : c.colorHex,
    style: hl.size ? (hl.has(c.partId) ? ("highlight" as const) : ("ghost" as const)) : ("normal" as const),
  }));
  return new Response(renderSvg(items, solo ? 240 : 480, solo ? 200 : 360), { headers: { "content-type": "image/svg+xml", "cache-control": "no-store" } });
});
