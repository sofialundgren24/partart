import { db } from "@/lib/server/db";
import { enqueue } from "@/lib/server/jobs";
import "@/lib/server/projects";
import { handle, json, type Ctx } from "../../../_util";

export const runtime = "nodejs";

export const POST = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  await db.project.findUniqueOrThrow({ where: { id } });
  const job = await enqueue("analyze", id);
  return json({ job }, 202);
});
