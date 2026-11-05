"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { activeDesign, useProject } from "@/components/ProjectContext";
import { api, useFetch, useJob } from "@/lib/client/api";
import { Empty, JobProgress, ReadinessBadge, SectionTitle } from "@/components/ui";
import { Fruit } from "@/components/Fruit";

interface Printer { name: string; buildX: number; buildY: number; buildZ: number; nozzleMm: number; layerHeightMm: number; filament: string; walls: number; infillPct: number; supports: string; adhesion: string; clearanceMm: number }
interface Laser { name: string; workX: number; workY: number; kerfMm: number; software: string; sheetW: number; sheetH: number; spacingMm: number; jointClearanceMm: number }
interface Check { area: string; level: "pass" | "warn" | "fail"; partIds: string[]; message: string }
interface PrintCard { fileId: string; partIds: string[]; name: string; file: string; material: string; colorHex: string; layerHeightMm: number; nozzleMm: number; infillPct: number; walls: number; supports: string; adhesion: string; orientation: string; sizeMm: number[]; volumeCm3: number; filamentEstimateG: number; overhangPct: number; notes: string[]; warnings: string[]; watertight: boolean }
export interface BuildFull {
  id: string; status: string; readiness: string | null; createdAt: string; designId: string; printer: Printer; laser: Laser;
  files: { id: string; kitPath: string; format: string; purpose: string; partIds: string[]; bytes: number; sha256: string }[];
  report: { checks: Check[]; printCards: PrintCard[]; layouts: { materialKey: string; thicknessMm: number; method: string; sheetW: number; sheetH: number; sheets: number; wastePct: number; svgFiles: string[]; unplaced: string[] }[]; manualParts: { partId: string; name: string; material: string; size: string; instructions: string }[]; stats: { components: number; printedFiles: number; sheetParts: number; sheets: number; filamentG: number } } | null;
}

export default function KitPage() {
  const { project, reload } = useProject();
  const design = activeDesign(project);
  const [presets, setPresets] = useState<{ printers: Printer[]; lasers: Laser[] } | null>(null);
  const [printer, setPrinter] = useState<Printer | null>(null);
  const [laser, setLaser] = useState<Laser | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [tab, setTab] = useState<"print" | "laser" | "files" | "report">("report");
  useEffect(() => { api<{ printers: Printer[]; lasers: Laser[] }>("/api/meta").then((m) => { setPresets(m); setPrinter((p) => p ?? m.printers[0]); setLaser((l) => l ?? m.lasers[0]); }); }, []);
  const lastBuild = project?.builds.find((b) => b.designId === design?.id) ?? null;
  const pending = project?.jobs.find((j) => j.type === "build-kit" && (j.status === "queued" || j.status === "running"));
  useEffect(() => { if (pending) setJobId(pending.id); }, [pending]);
  const job = useJob(jobId, () => { reload(); });
  const build = useFetch<BuildFull>(lastBuild && lastBuild.status === "done" ? `/api/builds/${lastBuild.id}` : null);
  useEffect(() => { if (build.data) { setPrinter(build.data.printer); setLaser(build.data.laser); } }, [build.data]);

  if (!project) return null;
  if (!design) return <Empty fruit="apple" title="Choose a design first">Pick how you want to make it in <Link className="underline" href={`/p/${project.id}/design`}>Design</Link>.</Empty>;
  const running = job && (job.status === "queued" || job.status === "running");

  const generate = async () => {
    const r = await api<{ job: { id: string } }>(`/api/projects/${project.id}/builds`, { method: "POST", json: { designId: design.id, printer, laser } });
    setJobId(r.job.id);
    reload();
  };

  return (
    <div>
      <SectionTitle fruit="apple" kicker="STEP 05 · MANUFACTURE" title="Your build kit">
        Real files for <b>{design.name}</b>: print-ready STL/3MF, laser-ready SVG/DXF, PDFs and a manifest — validated before they are marked ready.
      </SectionTitle>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <aside className="space-y-4">
          {printer && presets && <PrinterForm value={printer} presets={presets.printers} onChange={setPrinter} />}
          {laser && presets && <LaserForm value={laser} presets={presets.lasers} onChange={setLaser} />}
          <button className="btn btn-primary w-full justify-center text-lg" disabled={!!running || !printer} onClick={generate}>
            {lastBuild ? "Regenerate kit" : "Generate kit"}
          </button>
          <p className="text-[11px] text-ink-soft">Profiles are starting points. Machines differ — check your nozzle, build plate, kerf and sheet thickness.</p>
        </aside>

        <section className="min-w-0">
          {running || (jobId && !job) ? <JobProgress job={job} /> : job?.status === "failed" ? <JobProgress job={job} /> : null}
          {!running && !build.data && !lastBuild && <Empty fruit="apple" title="No kit yet">Set your printer and laser on the left, then generate.</Empty>}
          {!running && build.data && <KitResult b={build.data} tab={tab} setTab={setTab} projectId={project.id} />}
        </section>
      </div>
    </div>
  );
}

function KitResult({ b, tab, setTab, projectId }: { b: BuildFull; tab: string; setTab: (t: "print" | "laser" | "files" | "report") => void; projectId: string }) {
  const r = b.report!;
  const counts = useMemo(() => ({ fail: r.checks.filter((c) => c.level === "fail").length, warn: r.checks.filter((c) => c.level === "warn").length, pass: r.checks.filter((c) => c.level === "pass").length }), [r]);
  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-center gap-4 p-5">
        <ReadinessBadge r={b.readiness} large />
        <div className="text-sm">
          <p><b>{b.files.length}</b> files · <b>{r.stats.printedFiles}</b> print files · <b>{r.stats.sheetParts}</b> sheet parts on <b>{r.stats.sheets}</b> sheets · filament ≈ <b>{r.stats.filamentG.toFixed(0)} g</b> <span className="text-ink-soft">(estimate)</span></p>
          <p className="text-ink-soft">{counts.pass} checks passed · {counts.warn} warnings · {counts.fail} failures · generated {new Date(b.createdAt).toLocaleString()}</p>
        </div>
        <a className="btn btn-primary ml-auto" href={`/api/builds/${b.id}/zip`}>Download ZIP</a>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["report", "print", "laser", "files"] as const).map((t) => (
          <button key={t} className={`btn btn-sm ${tab === t ? "btn-plum" : ""}`} onClick={() => setTab(t)}>
            {t === "report" ? "Readiness report" : t === "print" ? `3D print (${r.printCards.length})` : t === "laser" ? `Sheets (${r.layouts.reduce((s, l) => s + l.sheets, 0)})` : `All files (${b.files.length})`}
          </button>
        ))}
        <Link className="btn btn-sm" href={`/p/${projectId}/materials`}>Shopping list →</Link>
        <Link className="btn btn-sm" href={`/p/${projectId}/assembly`}>Assembly →</Link>
      </div>
      {tab === "report" && <Report checks={r.checks} />}
      {tab === "print" && <PrintCards cards={r.printCards} files={b.files} manual={r.manualParts} />}
      {tab === "laser" && <Sheets b={b} />}
      {tab === "files" && <Files files={b.files} />}
    </div>
  );
}

function Report({ checks }: { checks: Check[] }) {
  const areas = ["geometry", "print", "laser", "connection", "dimensions", "assembly"];
  const [showPass, setShowPass] = useState(false);
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showPass} onChange={(e) => setShowPass(e.target.checked)} /> show passed checks</label>
      {areas.map((a) => {
        const list = checks.filter((c) => c.area === a && (showPass || c.level !== "pass"));
        const all = checks.filter((c) => c.area === a);
        if (!all.length) return null;
        return (
          <div key={a} className="card-flat p-3">
            <p className="label mb-2">{a} · {all.filter((c) => c.level === "pass").length}/{all.length} passed</p>
            {list.length === 0 ? <p className="text-sm text-leaf">All checks passed.</p> : (
              <ul className="space-y-1 text-sm">
                {list.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className={`chip shrink-0 ${c.level === "fail" ? "bg-tomato text-paper" : c.level === "warn" ? "bg-butter" : "bg-leaf/20 text-leaf"}`}>{c.level}</span>
                    <span>{c.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <p className="text-xs text-ink-soft">These checks cover geometry, fit and completeness. A watertight mesh is not proof of structural strength or safety.</p>
    </div>
  );
}

function PrintCards({ cards, files, manual }: { cards: PrintCard[]; files: BuildFull["files"]; manual: { partId: string; name: string; material: string; size: string; instructions: string }[] }) {
  if (!cards.length && !manual.length) return <Empty fruit="tomato" title="Nothing to print">This design has no 3D-printed parts.</Empty>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-soft">Each STL is already oriented as recommended and sits on the bed. Print time and exact filament use: open the file or 3MF in PrusaSlicer, OrcaSlicer or Bambu Studio.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((c) => {
          const f = files.find((x) => x.kitPath === c.file);
          return (
            <div key={c.fileId} className="card overflow-hidden">
              <div className="grid grid-cols-2 border-b-2 border-ink bg-[#fffaf0]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {f && <img src={`/api/files/${f.id}/preview`} alt="print orientation" className="h-36 w-full object-contain" />}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {f && <img src={`/api/files/${f.id}/preview?view=bottom`} alt="overhangs from below" className="h-36 w-full border-l border-ink/20 object-contain" title="Seen from below: pink = overhang > 45° needing support" />}
              </div>
              <div className="space-y-1 p-3 text-sm">
                <p className="font-mono text-xs text-ink-soft">Component {c.fileId}</p>
                <h4 className="font-display text-lg font-bold">{c.name}</h4>
                <ul className="grid grid-cols-2 gap-x-3 text-xs">
                  <li><b>File:</b> {f ? <a className="underline" href={`/api/files/${f.id}`}>{c.file.split("/").pop()}</a> : c.file}</li>
                  <li><b>Material:</b> {c.material}</li>
                  <li><b>Layer height:</b> {c.layerHeightMm} mm</li>
                  <li><b>Nozzle:</b> {c.nozzleMm} mm</li>
                  <li><b>Infill:</b> {c.infillPct}%</li>
                  <li><b>Walls:</b> {c.walls}</li>
                  <li className="col-span-2"><b>Orientation:</b> {c.orientation}</li>
                  <li className="col-span-2"><b>Supports:</b> {c.supports}</li>
                  <li className="col-span-2"><b>Bed adhesion:</b> {c.adhesion}</li>
                  <li className="col-span-2"><b>Size:</b> {c.sizeMm.map((x) => x.toFixed(1)).join(" × ")} mm · volume {c.volumeCm3.toFixed(1)} cm³</li>
                  <li className="col-span-2"><b>Filament:</b> ≈{c.filamentEstimateG.toFixed(1)} g (geometric estimate) · <b>Print time:</b> from your slicer</li>
                </ul>
                {c.notes.map((n, i) => <p key={i} className="text-xs text-ink-soft">• {n}</p>)}
                {c.warnings.map((w, i) => <p key={i} className="text-xs text-tomato">! {w}</p>)}
                <p className="text-xs">{c.watertight ? "✓ watertight & manifold" : "✗ mesh defects"}</p>
              </div>
            </div>
          );
        })}
      </div>
      {manual.length > 0 && (
        <div className="card-flat p-3">
          <p className="label mb-2">Hand-made parts</p>
          {manual.map((m) => <p key={m.partId} className="text-sm"><b>{m.partId} {m.name}</b> — {m.material}, {m.size}. {m.instructions}</p>)}
        </div>
      )}
    </div>
  );
}

function Sheets({ b }: { b: BuildFull }) {
  const r = b.report!;
  if (!r.layouts.length) return <Empty fruit="pear" title="No sheet parts">This design has no laser-cut, paper or cardboard parts.</Empty>;
  const instr = b.files.find((f) => f.kitPath.endsWith("LASER_INSTRUCTIONS.md"));
  return (
    <div className="space-y-5">
      {instr && <p className="text-sm">Before cutting, read <a className="underline" href={`/api/files/${instr.id}?inline`}>LASER_INSTRUCTIONS.md</a> — layer colours, LightBurn / xTool import and the test-cut procedure. Kerf {b.laser.kerfMm} mm is already compensated.</p>}
      {r.layouts.map((l) => (
        <div key={l.materialKey + l.thicknessMm + l.method} className="card p-4">
          <h4 className="font-display text-lg font-bold">{l.materialKey} · {l.thicknessMm} mm · {l.method}</h4>
          <p className="text-xs text-ink-soft">{l.sheets} sheet(s) of {l.sheetW} × {l.sheetH} mm · ≈{l.wastePct}% offcut {l.unplaced.length > 0 && <b className="text-tomato">· {l.unplaced.length} part(s) did not fit</b>}</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {l.svgFiles.map((p) => {
              const f = b.files.find((x) => x.kitPath === p);
              const dxf = b.files.find((x) => x.kitPath === p.replace(/\.svg$/, ".dxf"));
              return f && (
                <figure key={p} className="overflow-hidden rounded-xl border-2 border-ink">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/files/${f.id}/preview`} alt={p} className="w-full bg-[#fffaf0]" />
                  <figcaption className="flex flex-wrap gap-2 border-t-2 border-ink bg-paper p-2 text-xs">
                    <span className="font-mono">{p.split("/").pop()}</span>
                    <a className="underline" href={`/api/files/${f.id}`}>SVG</a>
                    {dxf && <a className="underline" href={`/api/files/${dxf.id}`}>DXF</a>}
                  </figcaption>
                </figure>
              );
            })}
          </div>
          <div className="mt-2 flex gap-3 text-xs"><span className="text-[#FF0000]">■ cut</span><span className="text-[#0000FF]">■ engrave</span><span className="text-[#00A000]">■ score / fold</span></div>
        </div>
      ))}
    </div>
  );
}

function Files({ files }: { files: BuildFull["files"] }) {
  const groups = useMemo(() => {
    const m = new Map<string, BuildFull["files"]>();
    for (const f of files) { const k = f.kitPath.includes("/") ? f.kitPath.split("/")[0] : "(root)"; m.set(k, [...(m.get(k) ?? []), f]); }
    return [...m.entries()].sort();
  }, [files]);
  return (
    <div className="space-y-3">
      {groups.map(([g, list]) => (
        <details key={g} className="card-flat p-3" open={g.startsWith("03") || g.startsWith("04")}>
          <summary className="cursor-pointer font-mono text-sm font-bold">{g}/ <span className="font-normal text-ink-soft">({list.length})</span></summary>
          <table className="mt-2 w-full text-xs">
            <tbody>
              {list.map((f) => (
                <tr key={f.id} className="border-t border-ink/10">
                  <td className="py-1 font-mono"><a className="underline" href={`/api/files/${f.id}`}>{f.kitPath.slice(g.length + 1) || f.kitPath}</a></td>
                  <td className="text-ink-soft">{f.purpose}</td>
                  <td className="font-mono text-[10px] text-ink-soft">{f.partIds.slice(0, 4).join(" ")}{f.partIds.length > 4 ? ` +${f.partIds.length - 4}` : ""}</td>
                  <td className="text-right font-mono">{(f.bytes / 1024).toFixed(1)} kB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
      <p className="flex items-center gap-2 text-xs text-ink-soft"><Fruit kind="lemon" size={20} /> Every file has a SHA-256 in 08_DOCUMENTATION/project_manifest.json and is traceable to its part IDs.</p>
    </div>
  );
}

function PrinterForm({ value, presets, onChange }: { value: Printer; presets: Printer[]; onChange: (p: Printer) => void }) {
  const N = (k: keyof Printer, label: string, step = 1) => (
    <label className="text-[11px] font-semibold text-ink-soft">{label}
      <input className="input px-2 py-1 font-mono text-sm text-ink" type="number" step={step} value={value[k] as number} onChange={(e) => onChange({ ...value, [k]: Number(e.target.value) })} />
    </label>
  );
  return (
    <div className="card space-y-2 p-4">
      <p className="label">3D printer</p>
      <select className="input py-1 text-sm" value={value.name} onChange={(e) => onChange(presets.find((p) => p.name === e.target.value) ?? value)}>
        {[...new Set([value.name, ...presets.map((p) => p.name)])].map((n) => <option key={n}>{n}</option>)}
      </select>
      <div className="grid grid-cols-3 gap-2">{N("buildX", "build X")}{N("buildY", "build Y")}{N("buildZ", "build Z")}</div>
      <div className="grid grid-cols-3 gap-2">{N("nozzleMm", "nozzle", 0.05)}{N("layerHeightMm", "layer", 0.02)}{N("walls", "walls")}</div>
      <div className="grid grid-cols-3 gap-2">{N("infillPct", "infill %")}{N("clearanceMm", "clearance", 0.05)}
        <label className="text-[11px] font-semibold text-ink-soft">filament<input className="input px-2 py-1 text-sm text-ink" value={value.filament} onChange={(e) => onChange({ ...value, filament: e.target.value })} /></label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] font-semibold text-ink-soft">supports
          <select className="input px-2 py-1 text-sm text-ink" value={value.supports} onChange={(e) => onChange({ ...value, supports: e.target.value })}>{["none", "normal", "tree"].map((o) => <option key={o}>{o}</option>)}</select>
        </label>
        <label className="text-[11px] font-semibold text-ink-soft">adhesion
          <select className="input px-2 py-1 text-sm text-ink" value={value.adhesion} onChange={(e) => onChange({ ...value, adhesion: e.target.value })}>{["none", "brim", "raft"].map((o) => <option key={o}>{o}</option>)}</select>
        </label>
      </div>
    </div>
  );
}

function LaserForm({ value, presets, onChange }: { value: Laser; presets: Laser[]; onChange: (p: Laser) => void }) {
  const N = (k: keyof Laser, label: string, step = 1) => (
    <label className="text-[11px] font-semibold text-ink-soft">{label}
      <input className="input px-2 py-1 font-mono text-sm text-ink" type="number" step={step} value={value[k] as number} onChange={(e) => onChange({ ...value, [k]: Number(e.target.value) })} />
    </label>
  );
  return (
    <div className="card space-y-2 p-4">
      <p className="label">Laser / sheet cutting</p>
      <select className="input py-1 text-sm" value={value.name} onChange={(e) => onChange(presets.find((p) => p.name === e.target.value) ?? value)}>
        {[...new Set([value.name, ...presets.map((p) => p.name)])].map((n) => <option key={n}>{n}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-2">{N("workX", "work area X")}{N("workY", "work area Y")}</div>
      <div className="grid grid-cols-2 gap-2">{N("sheetW", "sheet W")}{N("sheetH", "sheet H")}</div>
      <div className="grid grid-cols-2 gap-2">{N("kerfMm", "kerf mm", 0.01)}{N("spacingMm", "spacing mm", 0.5)}</div>
      <label className="text-[11px] font-semibold text-ink-soft">software
        <select className="input px-2 py-1 text-sm text-ink" value={value.software} onChange={(e) => onChange({ ...value, software: e.target.value })}>{["LightBurn", "xTool Creative Space", "Other"].map((o) => <option key={o}>{o}</option>)}</select>
      </label>
    </div>
  );
}
