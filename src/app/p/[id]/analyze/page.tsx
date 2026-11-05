"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useProject } from "@/components/ProjectContext";
import { api, useJob } from "@/lib/client/api";
import { JobProgress, ProvenanceChip, SectionTitle, Empty } from "@/components/ui";
import { Viewer } from "@/components/viewer";
import { AddComponent, ComponentInspector, ComponentTree } from "@/components/ComponentEditor";

interface Findings {
  objectName: string; observed: string[]; inferred: string[]; assumptions: string[];
  uncertainties: { partIds: string[]; issue: string; impact: string }[];
  requestedViews: { view: string; reason: string }[]; requestedMeasurements: { what: string; why: string }[];
  symmetry: string; repeated: string[]; materialsObserved: string[]; manufacturingIdeas: string[]; scaleBasis: string;
}

export default function AnalyzePage() {
  const { project, reload } = useProject();
  const search = useSearchParams();
  const pending = project?.jobs.find((j) => j.type === "analyze" && (j.status === "queued" || j.status === "running"));
  const [jobId, setJobId] = useState<string | null>(search.get("job"));
  useEffect(() => { if (pending) setJobId(pending.id); }, [pending]);
  const job = useJob(jobId, () => { reload(); setVersion((v) => v + 1); });
  const running = job && (job.status === "queued" || job.status === "running");
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [version, setVersion] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<"model" | "confidence" | "provenance">("model");
  const [target, setTarget] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const analysis = project?.analyses[0];
  const findings: Findings | null = analysis ? JSON.parse(analysis.findingsJson) : null;
  const comp = project?.components.find((c) => c.partId === selected) ?? null;

  const colors = useMemo(() => {
    if (!project || colorMode === "model") return undefined;
    const out: Record<string, string> = {};
    const P: Record<string, string> = { observed: "#7a9a5b", inferred: "#8fb8c9", assumed: "#f2d36b", template: "#e86a92", user: "#4b2c4f", imported: "#f29b38" };
    for (const c of project.components) out[c.partId] = colorMode === "provenance" ? P[c.provenance] ?? "#999" : confColor(c.confidence);
    return out;
  }, [project, colorMode]);

  const changed = (m?: string) => { setMsg(m ?? null); reload(); setVersion((v) => v + 1); };

  if (!project) return null;
  if (running || (jobId && !job)) return (<><SectionTitle fruit="lemon" kicker="STEP 02 · UNDERSTAND" title="Analysing your object" /><JobProgress job={job} /></>);

  return (
    <div>
      <SectionTitle fruit="lemon" kicker="STEP 02 · UNDERSTAND" title={findings?.objectName ?? project.name}>
        {analysis ? (
          <span>
            Analysed by <b>{analysis.provider === "claude-vision" ? `Claude vision (${analysis.model})` : "category template"}</b> · v{analysis.version}. Every component is tagged with where its geometry came from. Edit anything that is wrong — your edits become the source of truth.
          </span>
        ) : "No analysis yet."}
      </SectionTitle>

      {job?.status === "failed" && <div className="mb-4"><JobProgress job={job} /></div>}

      {analysis?.provider === "template" && (
        <div className="card mb-6 border-strawberry bg-strawberry/10 p-4 text-sm">
          <b>This is a template, not your object.</b> No vision model is configured (set <code className="font-mono">ANTHROPIC_API_KEY</code> to enable photo analysis), so PARTART started from a generic {project.category} structure.
          Adjust parts, sizes and positions below to match your reference — or import a 3D scan.
        </div>
      )}

      {!project.components.length ? (
        <Empty fruit="lemon" title="No components yet">
          <button className="btn btn-primary mt-2" onClick={async () => { const r = await api<{ job: { id: string } }>(`/api/projects/${project.id}/analyze`, { method: "POST" }); setJobId(r.job.id); }}>Run analysis</button>
        </Empty>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[260px_1fr_340px]">
          {/* left: references + findings */}
          <aside className="space-y-4">
            <div className="card-flat p-3">
              <p className="label mb-2">References</p>
              <div className="grid grid-cols-2 gap-2">
                {project.images.map((i) => (
                  <figure key={i.id} className="overflow-hidden rounded-lg border-2 border-ink">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/images/${i.id}`} alt={i.view} className="aspect-square w-full object-cover" />
                    <figcaption className="bg-paper px-1 text-center font-mono text-[10px]">{i.view}</figcaption>
                  </figure>
                ))}
              </div>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={async (e) => {
                if (!e.target.files?.length) return;
                const fd = new FormData();
                Array.from(e.target.files).forEach((f) => { fd.append("images", f); fd.append("views", "detail"); });
                await api(`/api/projects/${project.id}/images`, { method: "POST", body: fd });
                reload(); setMsg("Views added — re-run analysis to use them.");
              }} />
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>+ Add views</button>
                <button className="btn btn-sm" onClick={async () => {
                  if (!confirm("Re-run analysis? This replaces the current components (your edits will be lost).")) return;
                  const r = await api<{ job: { id: string } }>(`/api/projects/${project.id}/analyze`, { method: "POST" }); setJobId(r.job.id);
                }}>Re-analyse</button>
              </div>
            </div>
            {findings && <FindingsPanel f={findings} summary={analysis!.summary} />}
          </aside>

          {/* centre: viewer */}
          <section>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="label">Colour by</span>
              {(["model", "confidence", "provenance"] as const).map((m) => (
                <button key={m} className={`chip ${colorMode === m ? "bg-ink text-paper" : ""}`} onClick={() => setColorMode(m)}>{m}</button>
              ))}
              {colorMode === "confidence" && <span className="text-xs text-ink-soft">red = low · green = high (reconstruction uncertainty)</span>}
              {colorMode === "provenance" && <span className="flex gap-1">{["observed", "inferred", "assumed", "template", "user", "imported"].map((p) => <ProvenanceChip key={p} p={p} />)}</span>}
            </div>
            <Viewer url={`/api/projects/${project.id}/model?v=${version}`} selected={selected} onSelect={setSelected} colors={colors} height={560} />
            <p className="mt-2 text-xs text-ink-soft">
              {project.reconstructions[0]?.kind === "imported" ? "Imported 3D model." : "Primitive proxy reconstruction — a structured approximation for planning, not a scan and not yet validated for manufacturing."}
            </p>
            {msg && <p className="mt-2 rounded-lg bg-butter/40 px-3 py-1 text-sm">{msg}</p>}
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="text-xs font-semibold text-ink-soft">Rescale whole model — largest dimension (mm)
                <input className="input mt-1 w-40 py-1" type="number" placeholder={String(project.targetSizeMm ?? "")} value={target} onChange={(e) => setTarget(e.target.value)} />
              </label>
              <button className="btn btn-sm" disabled={!Number(target)} onClick={async () => {
                const r = await api<{ message: string }>(`/api/projects/${project.id}/components/ops`, { method: "POST", json: { op: "rescale", targetSizeMm: Number(target) } });
                changed(r.message);
              }}>Rescale</button>
              <Link href={`/p/${project.id}/design`} className="btn btn-primary ml-auto">Looks right — design it →</Link>
            </div>
          </section>

          {/* right: component tree + inspector */}
          <aside className="space-y-4">
            <div className="card-flat max-h-[340px] overflow-auto p-2 scroll-thin">
              <div className="mb-1 flex items-center justify-between px-1">
                <p className="label">Components ({project.components.length})</p>
                {checked.size >= 2 && (
                  <button className="btn btn-sm" onClick={async () => {
                    const r = await api<{ message: string }>(`/api/projects/${project.id}/components/ops`, { method: "POST", json: { op: "merge", partIds: [...checked] } });
                    setChecked(new Set()); changed(r.message);
                  }}>Merge {checked.size}</button>
                )}
              </div>
              <ComponentTree components={project.components} selected={selected} onSelect={setSelected} checked={checked}
                onCheck={(id) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })} />
            </div>
            <AddComponent projectId={project.id} components={project.components} onAdded={changed} />
            {comp ? (
              <div className="card p-4"><ComponentInspector projectId={project.id} comp={comp} components={project.components} onChanged={changed} /></div>
            ) : <p className="text-sm text-ink-soft">Select a component in the tree or the viewport to edit it.</p>}
          </aside>
        </div>
      )}
    </div>
  );
}

function FindingsPanel({ f, summary }: { f: Findings; summary: string }) {
  const L = ({ title, items, chip }: { title: string; items: string[]; chip?: string }) =>
    items.length ? (
      <div>
        <p className="label mb-1 flex items-center gap-1">{title} {chip && <ProvenanceChip p={chip} />}</p>
        <ul className="space-y-1 text-xs text-ink-soft">{items.map((x, i) => <li key={i}>• {x}</li>)}</ul>
      </div>
    ) : null;
  return (
    <div className="card-flat space-y-3 p-3">
      <p className="text-sm">{summary}</p>
      <p className="text-xs"><b>Scale:</b> {f.scaleBasis}</p>
      <L title="Observed" items={f.observed} chip="observed" />
      <L title="Inferred" items={f.inferred} chip="inferred" />
      <L title="Assumptions" items={f.assumptions} chip="assumed" />
      {f.symmetry && <p className="text-xs"><b>Symmetry:</b> {f.symmetry}</p>}
      <L title="Repeated" items={f.repeated} />
      {f.uncertainties.length > 0 && (
        <div>
          <p className="label mb-1">Uncertain</p>
          <ul className="space-y-1 text-xs">{f.uncertainties.map((u, i) => <li key={i} className="rounded bg-butter/30 p-1.5"><b>{u.issue}</b>{u.partIds.length ? ` (${u.partIds.join(", ")})` : ""} — <span className="text-ink-soft">{u.impact}</span></li>)}</ul>
        </div>
      )}
      {(f.requestedViews.length > 0 || f.requestedMeasurements.length > 0) && (
        <div className="rounded-lg border-2 border-dashed border-tangerine p-2">
          <p className="label mb-1 text-tangerine">Would materially improve the result</p>
          <ul className="space-y-1 text-xs">
            {f.requestedViews.map((v, i) => <li key={`v${i}`}><span className="font-mono">VIEW</span> <b>{v.view}</b> — {v.reason}</li>)}
            {f.requestedMeasurements.map((m, i) => <li key={`m${i}`}><span className="font-mono">MEASURE</span> <b>{m.what}</b> — {m.why}</li>)}
          </ul>
        </div>
      )}
      <L title="Materials seen" items={f.materialsObserved} />
      <L title="Manufacturing ideas" items={f.manufacturingIdeas} />
    </div>
  );
}

function confColor(c: number) {
  const r = Math.round(232 - c * (232 - 122)), g = Math.round(85 + c * (154 - 85)), b = Math.round(63 + c * (91 - 63));
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}
