import { proxyGlb } from "@/lib/server/projects";
import { handle, type Ctx } from "../../../_util";

export const runtime = "nodejs";

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const glb = await proxyGlb(id);
  return new Response(new Uint8Array(glb), { headers: { "content-type": "model/gltf-binary", "cache-control": "no-store" } });
});
