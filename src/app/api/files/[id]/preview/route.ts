import { db } from "@/lib/server/db";
import { storage } from "@/lib/server/storage";
import { readStl } from "@/lib/export/mesh-formats";
import { renderSvg } from "@/lib/export/render";
import { weldVertices } from "@/lib/geometry/kernel";
import { handle, json, type Ctx } from "../../../_util";

export const runtime = "nodejs";

/**
 * Screen previews of generated files:
 *  - STL: isometric render of the exact file as oriented on the bed; ?view=bottom shows the underside with
 *    overhangs (> 45°, not touching the bed) in pink — i.e. where supports will be needed.
 *  - SVG sheet: same drawing with visible stroke widths (laser files use 0.01 mm hairlines).
 */
export const GET = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const f = await db.generatedFile.findUniqueOrThrow({ where: { id } });
  const data = await storage.get(f.storagePath);
  const headers = { "content-type": "image/svg+xml", "cache-control": "private, max-age=600" };
  if (f.format === "stl") {
    const view = new URL(req.url).searchParams.get("view") === "bottom" ? "bottom" : "top";
    const mesh = weldVertices(readStl(data), 1e-4);
    return new Response(renderSvg([{ id: "p", mesh, color: "#e9b48a", overhangs: true }], 360, 280, view), { headers });
  }
  if (f.format === "svg") {
    const svg = data.toString("utf8").replace(/stroke-width="0\.01"/g, 'stroke-width="0.6" vector-effect="non-scaling-stroke"').replace("<svg ", '<svg style="background:#fffaf0" ');
    return new Response(svg, { headers });
  }
  return json({ error: "No preview for this file type" }, 400);
});
