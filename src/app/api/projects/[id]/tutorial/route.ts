import { db } from "@/lib/server/db";
import { projectSpecs } from "@/lib/server/projects";
import { blenderScript, buildCourse } from "@/lib/learn/tutorials";
import { handle, json, type Ctx } from "../../../_util";

export const runtime = "nodejs";

export const GET = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const url = new URL(req.url);
  const software = url.searchParams.get("software") === "nomad" ? "nomad" : "blender";
  const project = await db.project.findUniqueOrThrow({ where: { id }, include: { images: true } });
  const comps = await projectSpecs(id);
  if (url.searchParams.get("format") === "py") {
    // Standalone download: reference paths resolve only inside the kit ZIP, so they are omitted here.
    return new Response(blenderScript(project.name, comps, []), {
      headers: { "content-type": "text/x-python; charset=utf-8", "content-disposition": `attachment; filename="partart_blockout_${id.slice(-6)}.py"` },
    });
  }
  const course = buildCourse(software, project.name, project.category, comps);
  await db.tutorial.create({ data: { projectId: id, software, contentJson: JSON.stringify(course) } });
  return json(course);
});
