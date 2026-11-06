"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { activeDesign, useProject } from "@/components/ProjectContext";
import { useFetch } from "@/lib/client/api";
import { Empty, SectionTitle, Swatch } from "@/components/ui";
import { CladdingTable, type CladdingCount } from "@/components/CladdingTable";

interface CatalogPart {
  partId: string; name: string; method: string; material: string; materialSwatch: string; paint: { name: string; hex: string } | null;
  finish: string; glue: string[]; files: string[]; size: string; notes: string[];
}
interface CatalogGroup { heading: string; items: { name: string; spec: string; quantity: string; swatch?: string; usedFor: string[] }[] }
interface Build { id: string; files: { id: string; kitPath: string }[]; report: { catalog?: { groups: CatalogGroup[]; parts: CatalogPart[] }; cladding?: CladdingCount[] } | null }

const METHOD_STYLE: Record<string, string> = {
  "Laser cut": "bg-[#d9b98a]/40", "3D print": "bg-tomato/15", Paper: "bg-butter/40", Cardboard: "bg-[#c49a6c]/30", "Hand-made / bought": "bg-strawberry/20",
};

export default function CatalogPage() {
  const { project } = useProject();
  const design = activeDesign(project);
  const last = project?.builds.find((b) => b.status === "done" && b.designId === design?.id) ?? project?.builds.find((b) => b.status === "done");
  const build = useFetch<Build>(last ? `/api/builds/${last.id}` : null);
  const [filter, setFilter] = useState<string>("all");
  const cat = build.data?.report?.catalog;
  const methods = useMemo(() => Array.from(new Set(cat?.parts.map((p) => p.method) ?? [])), [cat]);
  const fileId = (name: string) => build.data?.files.find((f) => f.kitPath.endsWith("/" + name) || f.kitPath === name)?.id;
  const pdf = build.data?.files.find((f) => f.kitPath.endsWith("build_catalogue.pdf"));

  if (!project) return null;
  if (!last) return <Empty fruit="strawberry" title="Generate a kit first">The catalogue is built from the real manufacturing files. <Link className="underline" href={`/p/${project.id}/kit`}>Go to Build kit</Link></Empty>;
  if (!build.data) return null;
  if (!cat) return <Empty fruit="strawberry" title="Regenerate the kit">This kit was generated before catalogues existed — regenerate it on the Build kit page.</Empty>;

  return (
    <div>
      <SectionTitle fruit="strawberry" kicker="BUILD CATALOGUE" title="Everything, and how it's made">
        Every material, colour, glue and part in one place — like a flat-pack catalogue for <b>{project.name}</b>. Part IDs match the files, the sheet labels and the 3D view.
      </SectionTitle>
      {pdf && <a className="btn btn-primary btn-sm mb-6" href={`/api/files/${pdf.id}`}>Download catalogue PDF</a>}

      <section className="mb-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cat.groups.filter((g) => g.items.length).map((g) => (
          <div key={g.heading} className="card p-4">
            <h2 className="riso riso-pink mb-2 text-2xl font-black">{g.heading}</h2>
            <ul className="space-y-2 text-sm">
              {g.items.map((i, k) => (
                <li key={k} className="flex gap-2">
                  {i.swatch ? <Swatch hex={i.swatch} size={20} /> : <span className="inline-block h-5 w-5 shrink-0" />}
                  <span>
                    <b>{i.name}</b><br />
                    <span className="text-xs text-ink-soft">{i.spec} · {i.quantity}</span>
                    {i.usedFor.length > 0 && <><br /><span className="font-mono text-[10px] text-ink-soft">{i.usedFor.slice(0, 8).join(" ")}{i.usedFor.length > 8 ? ` +${i.usedFor.length - 8}` : ""}</span></>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {build.data.report?.cladding && build.data.report.cladding.length > 0 && <div className="mb-10"><CladdingTable counts={build.data.report.cladding} /></div>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="riso mr-4 text-3xl font-black">Every part ({cat.parts.length})</h2>
        {["all", ...methods].map((m) => <button key={m} className={`chip ${filter === m ? "bg-ink text-paper" : ""}`} onClick={() => setFilter(m)}>{m}</button>)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cat.parts.filter((p) => filter === "all" || p.method === filter).map((p) => (
          <article key={p.partId} className="card overflow-hidden">
            <div className={`border-b-2 border-ink ${METHOD_STYLE[p.method] ?? "bg-paper"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/projects/${project.id}/render?solo=${p.partId}&color=${(p.paint?.hex ?? p.materialSwatch).replace("#", "")}`} alt={p.name} className="h-36 w-full object-contain" loading="lazy" />
            </div>
            <div className="space-y-1.5 p-3 text-sm">
              <p className="font-mono text-[11px] text-ink-soft">{p.partId}</p>
              <h3 className="font-display text-lg font-bold leading-tight">{p.name}</h3>
              <p className="text-xs"><span className="chip mr-1">{p.method}</span>{p.size}</p>
              <p className="flex items-center gap-1.5 text-xs"><Swatch hex={p.materialSwatch} size={12} /> {p.material}</p>
              <p className="flex items-center gap-1.5 text-xs">{p.paint ? <><Swatch hex={p.paint.hex} size={12} /> paint: {p.paint.name}</> : <span className="text-ink-soft">{p.finish}</span>}</p>
              {p.glue.length > 0 && <p className="text-xs"><b>Glue:</b> {p.glue.join(", ")}</p>}
              {p.files.length > 0 && (
                <p className="text-xs"><b>Files:</b>{" "}
                  {p.files.slice(0, 3).map((f, i) => { const id = fileId(f); return <span key={f}>{i ? ", " : ""}{id ? <a className="underline" href={`/api/files/${id}`}>{f}</a> : f}</span>; })}
                  {p.files.length > 3 && ` +${p.files.length - 3}`}
                </p>
              )}
              {p.notes.slice(0, 2).map((n, i) => <p key={i} className="text-[11px] text-ink-soft">• {n}</p>)}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
