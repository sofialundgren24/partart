import { db } from "@/lib/server/db";
import { handle, json, type Ctx } from "../../_util";

export const runtime = "nodejs";

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const b = await db.buildKit.findUniqueOrThrow({
    where: { id },
    include: { files: { orderBy: { kitPath: "asc" } }, validation: true, shopping: true, steps: { orderBy: { index: "asc" } } },
  });
  return json({
    ...b,
    printer: JSON.parse(b.printerProfileJson),
    laser: JSON.parse(b.laserProfileJson),
    files: b.files.map((f) => ({ id: f.id, kitPath: f.kitPath, format: f.format, purpose: f.purpose, partIds: JSON.parse(f.partIds), bytes: f.bytes, sha256: f.sha256 })),
    report: b.validation ? JSON.parse(b.validation.reportJson) : null,
    shopping: b.shopping ? JSON.parse(b.shopping.listJson) : null,
    steps: b.steps.map((s) => JSON.parse(s.contentJson)),
    snapshot: JSON.parse(b.snapshotJson),
  });
});
