"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { activeDesign, useProject } from "@/components/ProjectContext";
import { useFetch } from "@/lib/client/api";
import { Viewer } from "@/components/viewer";
import { Empty, ReadinessBadge, SectionTitle } from "@/components/ui";

interface Step { index: number; title: string; partIds: string[]; attachTo: string | null; instructions: string[]; tools: string[]; adhesives: string[]; warnings: string[] }
interface Build {
  id: string; readiness: string | null; steps: Step[]; files: { id: string; kitPath: string; partIds: string[] }[];
  report: { partsList: { partId: string; name: string; method: string; material: string; files: string[]; size: string }[] } | null;
}

export default function AssemblyPage() {
  const { project } = useProject();
  const design = activeDesign(project);
  const last = project?.builds.find((b) => b.status === "done" && b.designId === design?.id) ?? project?.builds.find((b) => b.status === "done");
  const build = useFetch<Build>(last ? `/api/builds/${last.id}` : null);
  const [step, setStep] = useState(0); // 0 = overview (all parts, exploded)
  const [playing, setPlaying] = useState(false);
  const steps = build.data?.steps ?? [];
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setStep((s) => { if (s >= steps.length) { setPlaying(false); return s; } return s + 1; }), 2200);
    return () => clearInterval(t);
  }, [playing, steps.length]);

  if (!project) return null;
  if (!last) return <Empty fruit="pear" title="No assembly yet">Assembly instructions are generated with the build kit. <Link className="underline" href={`/p/${project.id}/kit`}>Generate it</Link></Empty>;
  if (!build.data) return null;
  const guide = build.data.files.find((f) => f.kitPath.endsWith("assembly_guide.pdf"));
  const cur = steps[step - 1];
  const visible = step === 0 ? null : new Set(steps.filter((s) => s.index <= step).flatMap((s) => s.partIds));
  const highlight = cur ? new Set(cur.partIds) : null;

  return (
    <div>
      <SectionTitle fruit="pear" kicker="STEP 06 · ASSEMBLE" title="Put it together">
        {steps.length} steps, built from the part hierarchy. The 3D view shows the real manufacturing geometry; parts appear in the order you add them.
      </SectionTitle>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ReadinessBadge r={build.data.readiness} />
        {guide && <a className="btn btn-primary btn-sm" href={`/api/files/${guide.id}`}>Download illustrated PDF guide</a>}
        <button className="btn btn-sm" onClick={() => { setStep(0); setPlaying(true); }}>▶ Play assembly</button>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div>
          <Viewer url={`/api/builds/${build.data.id}/model`} visible={visible} highlight={highlight} explode={step === 0 ? 0.7 : 0} height={560} />
          <div className="mt-3 flex items-center gap-2">
            <button className="btn btn-sm" onClick={() => { setPlaying(false); setStep(Math.max(0, step - 1)); }}>‹ Back</button>
            <input type="range" min={0} max={steps.length} value={step} onChange={(e) => { setPlaying(false); setStep(Number(e.target.value)); }} className="flex-1 accent-[#e8553f]" />
            <button className="btn btn-sm btn-primary" onClick={() => { setPlaying(false); setStep(Math.min(steps.length, step + 1)); }}>Next ›</button>
          </div>
        </div>
        <aside className="card p-5">
          {step === 0 ? (
            <div>
              <p className="font-mono text-xs text-ink-soft">OVERVIEW</p>
              <h2 className="font-display text-2xl font-bold">Parts list</h2>
              <ul className="mt-2 max-h-[440px] space-y-1 overflow-auto text-xs scroll-thin">
                {build.data.report?.partsList.map((p, i) => (
                  <li key={p.partId} className="flex gap-2 border-b border-ink/10 py-1">
                    <span className="font-mono text-ink-soft">{String(i + 1).padStart(2, "0")}</span>
                    <span className="font-mono">{p.partId}</span>
                    <span className="flex-1">{p.name}<br /><span className="text-ink-soft">{p.method} · {p.material} · {p.size}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          ) : cur && (
            <div className="peel-in space-y-3" key={cur.index}>
              <p className="font-mono text-xs text-ink-soft">STEP {cur.index} OF {steps.length}</p>
              <h2 className="font-display text-2xl font-bold leading-tight">{cur.title}</h2>
              <p className="font-mono text-xs">{cur.partIds.join(" · ")}</p>
              <ol className="list-decimal space-y-1 pl-5 text-sm">{cur.instructions.map((x, i) => <li key={i}>{x}</li>)}</ol>
              <p className="text-sm"><b>Tools:</b> {cur.tools.join(", ") || "—"}</p>
              <p className="text-sm"><b>Adhesive:</b> {cur.adhesives.join(", ")}</p>
              {cur.warnings.filter(Boolean).map((w, i) => <p key={i} className="rounded-lg bg-butter/40 p-2 text-xs">! {w}</p>)}
              <p className="text-[11px] text-ink-soft">Time: not estimated — depends on glue cure times.</p>
            </div>
          )}
          {step === steps.length && steps.length > 0 && (
            <div className="mt-4 rounded-xl border-2 border-leaf p-3 text-sm">
              <b>Final inspection</b>
              <ul className="mt-1 list-disc pl-5 text-xs">
                <li>Compare with the assembled model from front and side.</li>
                <li>Check every joint is seated — no gaps at fingers, slots or pins.</li>
                <li>Measure the overall size against 08_DOCUMENTATION/dimensions.csv.</li>
                <li>Moving parts move freely. Let all glue fully cure.</li>
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
