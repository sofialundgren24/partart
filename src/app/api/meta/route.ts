import { claudeProvider } from "@/lib/analysis/providers";
import { CATEGORIES } from "@/lib/analysis/templates";
import { MATERIALS } from "@/lib/materials/catalog";
import { MODES } from "@/lib/design/modes";
import { LASER_PRESETS, PRINTER_PRESETS } from "@/lib/manufacture/resolve";
import { REGIONS, hasDirectory } from "@/lib/materials/suppliers";
import { json } from "../_util";

export const runtime = "nodejs";

export async function GET() {
  return json({
    providers: {
      analysis: claudeProvider.available() ? { id: "claude-vision", model: "claude-opus-5-5" } : { id: "template", model: null },
      reconstruction: [
        { id: "parametric-proxy", status: "available", note: "Primitive proxy built from the component analysis." },
        { id: "mesh-import", status: "available", note: "Bring a GLB/STL/OBJ from photogrammetry or any image-to-3D tool." },
        { id: "generative-image-to-3d", status: "not-configured", note: "Interface defined; no provider wired in this build." },
      ],
    },
    categories: CATEGORIES, materials: MATERIALS, modes: MODES, printers: PRINTER_PRESETS, lasers: LASER_PRESETS,
    regions: REGIONS.map((r) => ({ ...r, hasDirectory: hasDirectory(r.code) })),
  });
}
