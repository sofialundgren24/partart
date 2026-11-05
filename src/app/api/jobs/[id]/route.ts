import { db } from "@/lib/server/db";
import { kick } from "@/lib/server/jobs";
import "@/lib/server/projects";
import { handle, json, type Ctx } from "../../_util";

export const runtime = "nodejs";

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const job = await db.job.findUniqueOrThrow({ where: { id } });
  if (job.status === "queued") kick(); // resumes processing after a server restart
  return json(job);
});
