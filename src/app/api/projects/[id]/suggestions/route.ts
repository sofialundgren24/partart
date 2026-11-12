import { z } from "zod";
import { db } from "@/lib/server/db";
import { projectSpecs, writeComponents } from "@/lib/server/projects";
import { acceptSuggestions, inferHiddenSides, RULES } from "@/lib/analysis/inference";
import { handle, json, type Ctx } from "../../../_util";

export const runtime = "nodejs";

const dismissedOf = (s: string) => { try { return JSON.parse(s) as string[]; } catch { return []; } };

/** Hidden-side suggestions computed by PARTART's own rules (no AI) from the current components. */
export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const p = await db.project.findUniqueOrThrow({ where: { id } });
  const dismissed = dismissedOf(p.dismissedSuggestions);
  const specs = await projectSpecs(id);
  return json({ rules: RULES, dismissed, suggestions: inferHiddenSides(specs, dismissed) });
});

const Body = z.object({ accept: z.array(z.string()).default([]), dismiss: z.array(z.string()).default([]), restore: z.boolean().optional() });

export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const b = Body.parse(await req.json());
  const p = await db.project.findUniqueOrThrow({ where: { id } });
  let dismissed = b.restore ? [] : dismissedOf(p.dismissedSuggestions);
  const specs = await projectSpecs(id);
  const all = inferHiddenSides(specs, dismissed);
  const { added, notes } = acceptSuggestions(specs, all, b.accept);
  if (added.length) {
    const rows = await db.component.findMany({ where: { projectId: id } });
    const old = new Map(rows.map((r) => [r.partId, r.notes]));
    await writeComponents(id, [...specs.map((c) => ({ ...c, notes: old.get(c.partId) ?? "" })), ...added.map((c) => ({ ...c, notes: notes.get(c.partId) ?? "" }))]);
    for (const c of specs.filter((c) => c.hidden)) await db.component.update({ where: { projectId_partId: { projectId: id, partId: c.partId } }, data: { hidden: true } });
  }
  dismissed = [...new Set([...dismissed, ...b.dismiss])];
  await db.project.update({ where: { id }, data: { dismissedSuggestions: JSON.stringify(dismissed) } });
  const parts = added.length ? `Added ${added.length} inferred part${added.length > 1 ? "s" : ""} (${added.map((c) => c.partId).join(", ")}).` : "";
  return json({ ok: true, added: added.map((c) => c.partId), message: [parts, b.dismiss.length ? `Rejected ${b.dismiss.length} suggestion(s).` : "", b.restore ? "Rejected suggestions restored." : ""].filter(Boolean).join(" ") });
});
