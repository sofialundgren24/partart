import { db } from "@/lib/server/db";
import { designInputs, meshLoader } from "@/lib/server/projects";
import { componentSolid, getManifold, toMeshData } from "@/lib/geometry/kernel";
import { renderSvg } from "@/lib/export/render";
import { material } from "@/lib/materials/catalog";
import { handle, type Ctx } from "../../../_util";

export const runtime = "nodejs";

/** Isometric SVG preview of a design concept, coloured by its material assignments (rendered from real solids). */
export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const d = await db.manufacturingDesign.findUniqueOrThrow({ where: { id }, include: { assignments: true } });
  const { comps, assignments } = await designInputs(d.projectId, d);
  const wasm = await getManifold();
  const by = new Map(assignments.map((a) => [a.partId, a]));
  const items = comps
    .filter((c) => !c.hidden && by.get(c.partId)?.method !== "omit")
    .map((c) => {
      const a = by.get(c.partId);
      return { id: c.partId, mesh: toMeshData(componentSolid(wasm, c, meshLoader, 18)), color: a?.colorHex ?? (a ? material(a.materialKey).colorHex : c.colorHex) };
    });
  return new Response(renderSvg(items, 480, 360), { headers: { "content-type": "image/svg+xml", "cache-control": "no-store" } });
});
