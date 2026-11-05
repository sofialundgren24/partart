"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { activeDesign, useProject } from "@/components/ProjectContext";
import { api, useFetch } from "@/lib/client/api";
import { Viewer } from "@/components/viewer";
import { ComponentTree } from "@/components/ComponentEditor";
import { Empty, ProvenanceChip, SectionTitle, Swatch } from "@/components/ui";

type Mode = "assembled" | "exploded" | "components" | "materials" | "manufacturing" | "assembly";
const MODES: { k: Mode; label: string }[] = [
  { k: "assembled", label: "Assembled" }, { k: "exploded", label: "Exploded" }, { k: "components", label: "Components" },
  { k: "materials", label: "Materials" }, { k: "manufacturing", label: "Manufacturing" }, { k: "assembly", label: "Assembly" },
];
const METHOD_COLOR: Record<string, string> = { print: "#e8553f", laser: "#d9b98a", paper: "#f2d36b", cardboard: "#a7835a", manual: "#e86a92", omit: "#cccccc" };

interface BuildData {
  id: string; readiness: string | null;
  files: { id: string; kitPath: string; format: string; partIds: string[]; purpose: string }[];
  steps: { index: number; title: string; partIds: string[]; instructions: string[] }[];
  report: { printCards: { fileId: string; partIds: string[]; orientation: string; sizeMm: number[]; supports: string }[] } | null;
}

export default function WorkshopPage() {
  const { project, reload } = useProject();
  const [mode, setMode] = useState<Mode>("assembled");
  const [source, setSource] = useState<"proxy" | "kit">("proxy");
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [isolated, setIsolated] = useState<string | null>(null);
  const [explode, setExplode] = useState(0.6);
  const [clipOn, setClipOn] = useState(false);
  const [clip, setClip] = useState<{ axis: "x" | "y" | "z"; t: number }>({ axis: "y", t: 0.5 });
  const [measure, setMeasure] = useState(false);
  const [step, setStep] = useState(1);
  const [materials, setMaterials] = useState<{ key: string; name: string; colorHex: string; transparent?: boolean }[]>([]);
  useEffect(() => { api<{ materials: typeof materials }>("/api/meta").then((m) => setMaterials(m.materials)); }, []);

  const design = activeDesign(project);
  const lastBuild = project?.builds.find((b) => b.status === "done" && b.designId === design?.id) ?? project?.builds.find((b) => b.status === "done");
  const build = useFetch<BuildData>(lastBuild ? `/api/builds/${lastBuild.id}` : null);
  useEffect(() => { if (lastBuild) setSource("kit"); }, [lastBuild?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const assign = useMemo(() => new Map(design?.assignments.map((a) => [a.partId, a]) ?? []), [design]);
  const colors = useMemo(() => {
    if (!project) return undefined;
    if (mode === "materials") {
      const o: Record<string, string> = {};
      for (const [id, a] of assign) o[id] = a.colorHex ?? materials.find((m) => m.key === a.materialKey)?.colorHex ?? "#ccc";
      return o;
    }
    if (mode === "manufacturing") {
      const o: Record<string, string> = {};
      for (const [id, a] of assign) o[id] = METHOD_COLOR[a.method] ?? "#ccc";
      return o;
    }
    return undefined;
  }, [mode, assign, materials, project]);
  const opacity = useMemo(() => {
    if (mode !== "materials") return undefined;
    const o: Record<string, number> = {};
    for (const [id, a] of assign) if (materials.find((m) => m.key === a.materialKey)?.transparent) o[id] = 0.45;
    return o;
  }, [mode, assign, materials]);

  const steps = build.data?.steps ?? [];
  const visible = mode === "assembly" && steps.length ? new Set(steps.filter((s) => s.index <= step).flatMap((s) => s.partIds)) : null;
  const highlight = mode === "assembly" && steps.length ? new Set(steps.find((s) => s.index === step)?.partIds ?? []) : null;
  const omitted = useMemo(() => new Set([...assign.values()].filter((a) => a.method === "omit").map((a) => a.partId)), [assign]);

  if (!project) return null;
  if (!project.components.length) return <Empty fruit="tomato" title="Nothing to inspect yet">Run the analysis first.</Empty>;

  const comp = project.components.find((c) => c.partId === selected);
  const a = selected ? assign.get(selected) : undefined;
  const files = build.data?.files.filter((f) => selected && f.partIds.includes(selected)) ?? [];
  const card = build.data?.report?.printCards.find((c) => selected && c.partIds.includes(selected));
  const url = source === "kit" && lastBuild ? `/api/builds/${lastBuild.id}/model` : `/api/projects/${project.id}/model?d=${project.components.length}`;

  return (
    <div>
      <SectionTitle fruit="tomato" kicker="STEP 04 · DECONSTRUCT" title="Workshop">
        Rotate, zoom, pick parts, explode the assembly, slice through it and measure. Readouts are in millimetres.
      </SectionTitle>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {MODES.map((m) => (
          <button key={m.k} onClick={() => { setMode(m.k); if (m.k === "components" && !isolated && selected) setIsolated(selected); if (m.k !== "components") setIsolated(null); }}
            className={`btn btn-sm ${mode === m.k ? "btn-plum" : ""}`}>{m.label}</button>
        ))}
        <span className="ml-auto flex items-center gap-2 text-sm">
          <span className="label">Geometry</span>
          <button className={`chip ${source === "proxy" ? "bg-ink text-paper" : ""}`} onClick={() => setSource("proxy")}>reference proxy</button>
          <button className={`chip ${source === "kit" ? "bg-ink text-paper" : ""}`} disabled={!lastBuild} onClick={() => setSource("kit")} title={lastBuild ? "" : "Generate a build kit first"}>manufacturing (kit)</button>
        </span>
      </div>

      <div className="grid gap-5 xl:grid-cols-[260px_1fr_300px]">
        <aside className="card-flat max-h-[640px] overflow-auto p-2 scroll-thin">
          <p className="label px-1">Component tree</p>
          <ComponentTree components={project.components} selected={selected} onSelect={(id) => { setSelected(id); if (mode === "components") setIsolated(id); }} />
          <div className="mt-3 flex flex-wrap gap-1 px-1">
            <button className="btn btn-sm" disabled={!selected} onClick={() => selected && setHidden((h) => { const n = new Set(h); if (n.has(selected)) n.delete(selected); else n.add(selected); return n; })}>{selected && hidden.has(selected) ? "Unhide" : "Hide"}</button>
            <button className="btn btn-sm" disabled={!selected} onClick={() => setIsolated(isolated ? null : selected)}>{isolated ? "Show all" : "Isolate"}</button>
            {hidden.size > 0 && <button className="btn btn-sm" onClick={() => setHidden(new Set())}>Unhide {hidden.size}</button>}
          </div>
        </aside>

        <section>
          <Viewer url={url} selected={selected} onSelect={setSelected} hidden={new Set([...hidden, ...(source === "kit" ? [] : [])])} isolated={isolated}
            explode={mode === "exploded" ? explode : 0} colors={colors} opacity={opacity} visible={visible} highlight={highlight}
            clip={clipOn ? clip : null} measure={measure} height={620} />
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            {mode === "exploded" && (
              <label className="flex items-center gap-2"><span className="label">Spread</span>
                <input type="range" min={0} max={1.5} step={0.05} value={explode} onChange={(e) => setExplode(Number(e.target.value))} className="accent-[#e8553f]" />
              </label>
            )}
            {mode === "assembly" && (steps.length ? (
              <div className="flex flex-1 items-center gap-2">
                <button className="btn btn-sm" onClick={() => setStep(Math.max(1, step - 1))}>‹</button>
                <input type="range" min={1} max={steps.length} value={step} onChange={(e) => setStep(Number(e.target.value))} className="flex-1 accent-[#e8553f]" />
                <button className="btn btn-sm" onClick={() => setStep(Math.min(steps.length, step + 1))}>›</button>
                <span className="font-mono text-xs">Step {step}/{steps.length}: {steps[step - 1]?.title}</span>
              </div>
            ) : <span className="text-ink-soft">Generate a build kit to step through the assembly.</span>)}
            <label className="flex items-center gap-2"><input type="checkbox" checked={clipOn} onChange={(e) => setClipOn(e.target.checked)} /> Cross-section</label>
            {clipOn && (
              <>
                {(["x", "y", "z"] as const).map((ax) => <button key={ax} className={`chip ${clip.axis === ax ? "bg-ink text-paper" : ""}`} onClick={() => setClip({ ...clip, axis: ax })}>{ax.toUpperCase()}</button>)}
                <input type="range" min={0} max={1} step={0.01} value={clip.t} onChange={(e) => setClip({ ...clip, t: Number(e.target.value) })} className="accent-[#e8553f]" />
              </>
            )}
            <label className="flex items-center gap-2"><input type="checkbox" checked={measure} onChange={(e) => setMeasure(e.target.checked)} /> Measure</label>
          </div>
          {mode === "manufacturing" && (
            <div className="mt-2 flex flex-wrap gap-3 text-xs">{Object.entries(METHOD_COLOR).map(([k, v]) => <span key={k} className="flex items-center gap-1"><Swatch hex={v} size={12} />{k}</span>)}</div>
          )}
          {source === "proxy" && <p className="mt-2 text-xs text-ink-soft">Showing the reference proxy. Switch to <b>manufacturing</b> after generating a kit to see the real panels, slices and printed parts in place.</p>}
        </section>

        <aside className="card p-4 text-sm">
          {!comp ? <p className="text-ink-soft">Select a part to see how it will be made.</p> : (
            <div className="space-y-3">
              <div><span className="font-mono text-xs">{comp.partId}</span><h3 className="font-display text-xl font-bold">{comp.name}</h3></div>
              <div className="flex flex-wrap gap-1"><ProvenanceChip p={comp.provenance} /><span className="chip">{comp.role}</span><span className="chip">{Math.round(comp.confidence * 100)}% conf.</span></div>
              <Dims json={comp.primitiveJson} />
              {omitted.has(comp.partId) && <p className="rounded bg-paper-2 p-2 text-xs">Left out of the active design.</p>}
              {a && (
                <div className="rounded-xl border-2 border-ink p-2">
                  <p className="label">Manufacturing</p>
                  <p><b>{a.method}</b> · {materials.find((m) => m.key === a.materialKey)?.name}</p>
                  <Link className="text-xs underline" href={`/p/${project.id}/design`}>change in Design</Link>
                </div>
              )}
              {card && (
                <div className="text-xs">
                  <p className="label">Print card</p>
                  <p>{card.orientation}</p><p>{card.sizeMm.map((x) => x.toFixed(1)).join(" × ")} mm · supports: {card.supports}</p>
                </div>
              )}
              {files.length > 0 && (
                <div>
                  <p className="label">Files</p>
                  <ul className="space-y-1">{files.map((f) => <li key={f.id}><a className="font-mono text-xs underline" href={`/api/files/${f.id}`}>{f.kitPath.split("/").pop()}</a></li>)}</ul>
                </div>
              )}
              {!lastBuild && <p className="text-xs text-ink-soft">No kit generated yet — files appear here after you generate one.</p>}
            </div>
          )}
          <button className="btn btn-sm mt-4" onClick={() => reload()}>Refresh</button>
        </aside>
      </div>
    </div>
  );
}

function Dims({ json }: { json: string }) {
  const p = JSON.parse(json) as { type: string; w?: number; d?: number; h?: number; r?: number; rTop?: number };
  const s = p.type === "cylinder" ? `Ø${((p.r ?? 0) * 2).toFixed(1)}${p.rTop !== undefined ? `→Ø${(p.rTop * 2).toFixed(1)}` : ""} × ${p.h?.toFixed(1)} mm` : `${p.w?.toFixed(1)} × ${p.d?.toFixed(1)} × ${p.h?.toFixed(1)} mm`;
  return <p className="font-mono text-xs">{p.type} · {s}</p>;
}
