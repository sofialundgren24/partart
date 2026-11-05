"use client";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { activeDesign, useProject, type DesignRow } from "@/components/ProjectContext";
import { api, useFetch } from "@/lib/client/api";
import { Fruit, type FruitKind } from "@/components/Fruit";
import { Empty, RisoLoader, SectionTitle, Swatch } from "@/components/ui";

interface ModeDef { key: string; name: string; fruit: FruitKind; blurb: string; equipment: string[] }
interface MaterialDef { key: string; name: string; methods: string[]; colorHex: string; kind: string }
interface Meta { modes: ModeDef[]; materials: MaterialDef[] }
interface Stats {
  pieces: number; printedParts: number; sheetPieces: number; manualParts: number; omitted: number; printVolumeCm3: number; filamentEstimateG: number;
  sheetAreaCm2: Record<string, number>; materials: string[]; equipment: string[]; difficulty: string; difficultyReason: string;
}
type DesignWithStats = DesignRow & { stats: Stats; controls: Controls; updatedAt: string };
interface Controls { detail: number; difficulty: string; targetSizeMm: number | null; palette: string; finish: string }

const METHOD_LABEL: Record<string, string> = { print: "3D print", laser: "Laser cut", paper: "Paper", cardboard: "Cardboard", manual: "Hand-made", omit: "Leave out" };

export default function DesignPage() {
  const { project, reload } = useProject();
  const [meta, setMeta] = useState<Meta | null>(null);
  const designs = useFetch<DesignWithStats[]>(project ? `/api/projects/${project.id}/designs` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ method: string; materialKey: string; colorHex: string }>({ method: "print", materialKey: "pla", colorHex: "" });
  const [stamp, setStamp] = useState(0);
  useEffect(() => { api<Meta>("/api/meta").then(setMeta); }, []);

  const active = activeDesign(project);
  const activeStats = designs.data?.find((d) => d.id === active?.id);
  const matsFor = (method: string) => meta?.materials.filter((m) => method === "omit" || m.methods.includes(method)) ?? [];

  const refresh = async () => { await reload(); designs.reload(); setStamp((s) => s + 1); };
  const create = async (mode: string) => {
    setBusy(mode);
    try { await api(`/api/projects/${project!.id}/designs`, { method: "POST", json: { mode } }); await refresh(); } finally { setBusy(null); }
  };
  const setActive = async (id: string) => { await api(`/api/projects/${project!.id}`, { method: "PATCH", json: { activeDesignId: id } }); await reload(); };

  const assignment = useMemo(() => new Map(active?.assignments.map((a) => [a.partId, a]) ?? []), [active]);
  const parts = useMemo(() => {
    const comps = project?.components ?? [];
    const extra = active?.assignments.filter((a) => !comps.some((c) => c.partId === a.partId)).map((a) => ({ partId: a.partId, name: "Design extra (e.g. plinth)", role: "base" })) ?? [];
    return [...comps.map((c) => ({ partId: c.partId, name: c.name, role: c.role })), ...extra];
  }, [project, active]);

  if (!project) return null;
  if (!project.components.length) return <Empty fruit="strawberry" title="Analyse first">Components are needed before you can design. <Link href={`/p/${project.id}/analyze`} className="underline">Go to Analyze</Link></Empty>;

  return (
    <div>
      <SectionTitle fruit="strawberry" kicker="STEP 03 · DESIGN" title="Make it your way">
        Pick a starting style. Every concept assigns a manufacturing method and material to each part — then change any part you like.
      </SectionTitle>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {meta?.modes.map((m) => (
          <button key={m.key} disabled={!!busy} onClick={() => create(m.key)} className="card group p-3 text-left transition hover:-translate-y-0.5">
            <div className="flex items-center gap-2"><Fruit kind={m.fruit} size={34} /><span className="font-display text-lg font-bold">{m.name}</span></div>
            <p className="mt-1 text-xs text-ink-soft">{m.blurb}</p>
            <p className="mt-2 text-[11px] font-semibold text-tomato">{busy === m.key ? "Generating…" : "+ Generate concept"}</p>
          </button>
        ))}
      </div>

      <h2 className="riso riso-leaf mb-4 mt-10 text-3xl font-black">Compare concepts</h2>
      {!project.designs.length ? (
        <Empty fruit="apple" title="No concepts yet">Generate one or more concepts above to compare them side by side.</Empty>
      ) : !designs.data ? <RisoLoader label="Counting pieces…" /> : (
        <div className="flex gap-4 overflow-x-auto pb-3 scroll-thin">
          {designs.data.map((d) => {
            const m = meta?.modes.find((x) => x.key === d.mode);
            const isActive = d.id === active?.id;
            return (
              <div key={d.id} className={`card w-[300px] shrink-0 overflow-hidden ${isActive ? "ring-4 ring-tomato" : ""}`}>
                <div className="halftone border-b-2 border-ink bg-paper">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/designs/${d.id}/preview?s=${stamp}`} alt={`${d.name} preview`} className="h-[190px] w-full object-contain" />
                </div>
                <div className="space-y-2 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    {m && <Fruit kind={m.fruit} size={24} />}
                    <b className="font-display text-lg">{d.name}</b>
                    <span className="ml-auto chip">{d.stats.difficulty}</span>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                    <dt className="text-ink-soft">Physical pieces</dt><dd className="font-mono">{d.stats.pieces}</dd>
                    <dt className="text-ink-soft">Printed parts</dt><dd className="font-mono">{d.stats.printedParts}</dd>
                    <dt className="text-ink-soft">Sheet pieces</dt><dd className="font-mono">{d.stats.sheetPieces}</dd>
                    <dt className="text-ink-soft">Hand-made</dt><dd className="font-mono">{d.stats.manualParts}</dd>
                    <dt className="text-ink-soft">Print volume</dt><dd className="font-mono">{d.stats.printVolumeCm3.toFixed(0)} cm³</dd>
                    <dt className="text-ink-soft">Filament (est.)</dt><dd className="font-mono">≈{d.stats.filamentEstimateG.toFixed(0)} g</dd>
                    {Object.entries(d.stats.sheetAreaCm2).map(([k, v]) => (<Fragment key={k}><dt className="truncate text-ink-soft">{k}</dt><dd className="font-mono">{v.toFixed(0)} cm²</dd></Fragment>))}
                    <dt className="text-ink-soft">Cost</dt><dd className="text-[11px]">set prices in Materials</dd>
                  </dl>
                  <p className="text-[11px] text-ink-soft"><b>Equipment:</b> {d.stats.equipment.join(", ")}</p>
                  <p className="text-[11px] text-ink-soft">{d.stats.difficultyReason}</p>
                  <div className="flex gap-2 pt-1">
                    <button className={`btn btn-sm ${isActive ? "btn-primary" : ""}`} onClick={() => setActive(d.id)}>{isActive ? "Selected" : "Select"}</button>
                    <button className="btn btn-sm" onClick={async () => { if (confirm("Delete this concept?")) { await api(`/api/designs/${d.id}`, { method: "DELETE" }); refresh(); } }}>Delete</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {active && activeStats && (
        <div className="mt-10 grid gap-6 lg:grid-cols-[320px_1fr]">
          <ControlsPanel design={activeStats} onSaved={refresh} />
          <section className="card p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="font-display text-xl font-bold">Customise parts — {active.name}</h3>
              <span className="text-xs text-ink-soft">Changes are locked and survive control changes. Shared coordinates and connections are re-validated when you generate the kit.</span>
            </div>
            {checked.size > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border-2 border-dashed border-tangerine p-2 text-sm">
                <b>{checked.size} selected →</b>
                <select className="input w-auto py-1" value={bulk.method} onChange={(e) => setBulk({ ...bulk, method: e.target.value, materialKey: matsFor(e.target.value)[0]?.key ?? "pla" })}>
                  {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select className="input w-auto py-1" value={bulk.materialKey} onChange={(e) => setBulk({ ...bulk, materialKey: e.target.value })}>
                  {matsFor(bulk.method).map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                </select>
                <input type="color" value={bulk.colorHex || "#d9b98a"} onChange={(e) => setBulk({ ...bulk, colorHex: e.target.value })} />
                <button className="btn btn-primary btn-sm" onClick={async () => {
                  await api(`/api/designs/${active.id}/assignments`, { method: "PATCH", json: { partIds: [...checked], method: bulk.method, materialKey: bulk.materialKey, colorHex: bulk.colorHex || null } });
                  setChecked(new Set()); refresh();
                }}>Apply</button>
              </div>
            )}
            <div className="max-h-[520px] overflow-auto scroll-thin">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-paper text-left text-xs text-ink-soft"><tr><th className="p-1"></th><th>Part</th><th>Method</th><th>Material</th><th>Colour</th></tr></thead>
                <tbody>
                  {parts.map((p) => {
                    const a = assignment.get(p.partId);
                    return (
                      <tr key={p.partId} className="border-t border-ink/10">
                        <td className="p-1"><input type="checkbox" checked={checked.has(p.partId)} onChange={() => setChecked((s) => { const n = new Set(s); if (n.has(p.partId)) n.delete(p.partId); else n.add(p.partId); return n; })} /></td>
                        <td className="py-1"><span className="font-mono text-[11px] text-ink-soft">{p.partId}</span> {p.name} {a?.userLocked && <span className="chip ml-1 text-plum">yours</span>}</td>
                        <td>
                          <select className="input w-auto px-2 py-0.5 text-xs" value={a?.method ?? "print"} onChange={async (e) => {
                            const method = e.target.value;
                            const mat = matsFor(method).find((m) => m.key === a?.materialKey) ?? matsFor(method)[0];
                            await api(`/api/designs/${active.id}/assignments`, { method: "PATCH", json: { partIds: [p.partId], method, materialKey: mat?.key ?? "pla" } });
                            refresh();
                          }}>{Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                        </td>
                        <td>
                          <select className="input w-auto px-2 py-0.5 text-xs" value={a?.materialKey ?? "pla"} disabled={a?.method === "omit"} onChange={async (e) => {
                            await api(`/api/designs/${active.id}/assignments`, { method: "PATCH", json: { partIds: [p.partId], method: a?.method ?? "print", materialKey: e.target.value } });
                            refresh();
                          }}>{matsFor(a?.method ?? "print").map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select>
                        </td>
                        <td><Swatch hex={a?.colorHex ?? meta?.materials.find((m) => m.key === a?.materialKey)?.colorHex ?? "#ccc"} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Link href={`/p/${project.id}/workshop`} className="btn">Inspect in Workshop</Link>
              <Link href={`/p/${project.id}/kit`} className="btn btn-primary">Generate build kit →</Link>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ControlsPanel({ design, onSaved }: { design: DesignWithStats; onSaved: () => void }) {
  const [c, setC] = useState<Controls>(design.controls);
  const [saving, setSaving] = useState(false);
  useEffect(() => setC(design.controls), [design.id, design.controls]);
  const save = async () => {
    setSaving(true);
    try { await api(`/api/designs/${design.id}`, { method: "PATCH", json: { controls: c } }); onSaved(); } finally { setSaving(false); }
  };
  const Seg = ({ k, opts }: { k: "difficulty" | "palette" | "finish"; opts: string[] }) => (
    <div className="flex flex-wrap gap-1">{opts.map((o) => <button key={o} onClick={() => setC({ ...c, [k]: o })} className={`chip ${c[k] === o ? "bg-ink text-paper" : ""}`}>{o}</button>)}</div>
  );
  return (
    <section className="card space-y-4 p-4">
      <h3 className="font-display text-xl font-bold">Design controls</h3>
      <label className="block text-sm">
        <span className="label">Detail level · {Math.round(c.detail * 100)}%</span>
        <input type="range" min={0} max={1} step={0.05} value={c.detail} onChange={(e) => setC({ ...c, detail: Number(e.target.value) })} className="w-full accent-[#e8553f]" />
        <span className="text-[11px] text-ink-soft">Lower = fewer pieces: small details are left out.</span>
      </label>
      <div><span className="label">Assembly difficulty</span><Seg k="difficulty" opts={["easy", "medium", "hard"]} /></div>
      <div><span className="label">Palette</span><Seg k="palette" opts={["reference", "bold", "natural", "mono"]} /></div>
      <div><span className="label">Finish</span><Seg k="finish" opts={["raw", "painted", "oiled", "polished"]} /></div>
      <label className="block">
        <span className="label">Final size (largest dimension, mm)</span>
        <input className="input mt-1" type="number" placeholder="project size" value={c.targetSizeMm ?? ""} onChange={(e) => setC({ ...c, targetSizeMm: e.target.value ? Number(e.target.value) : null })} />
      </label>
      <p className="text-[11px] text-ink-soft">Saving re-applies the concept&apos;s rules to every part you haven&apos;t customised.</p>
      <button className="btn btn-primary w-full justify-center" disabled={saving} onClick={save}>{saving ? "Applying…" : "Apply controls"}</button>
    </section>
  );
}
