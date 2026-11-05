"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { activeDesign, useProject } from "@/components/ProjectContext";
import { api, useFetch } from "@/lib/client/api";
import { Empty, SectionTitle } from "@/components/ui";

interface Item {
  key: string; name: string; category: string; spec: string; quantity: string; usedFor: string[]; basis: string; wastePct?: number;
  alternatives: string[]; tier: "minimum" | "recommended" | "premium"; suppliers: { name: string; url: string; verified: string; note: string }[];
}
interface Build { id: string; createdAt: string; shopping: { region: string; items: Item[]; notes: string[] } | null; files: { id: string; kitPath: string }[] }

const TIERS = [
  { k: "minimum", t: "Minimum shopping list", d: "Exactly what the generated files need." },
  { k: "recommended", t: "Recommended additions", d: "Test pieces and finishing supplies that save frustration." },
  { k: "premium", t: "Optional premium materials", d: "Upgrades for a display-quality result." },
] as const;

export default function MaterialsPage() {
  const { project, reload } = useProject();
  const design = activeDesign(project);
  const last = project?.builds.find((b) => b.status === "done" && b.designId === design?.id) ?? project?.builds.find((b) => b.status === "done");
  const build = useFetch<Build>(last ? `/api/builds/${last.id}` : null);
  const [regions, setRegions] = useState<{ code: string; name: string; hasDirectory: boolean }[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  useEffect(() => { api<{ regions: typeof regions }>("/api/meta").then((m) => setRegions(m.regions)); }, []);
  // Unit prices are the viewer's own numbers, kept only in this browser.
  useEffect(() => { try { setPrices(JSON.parse(localStorage.getItem("partart-prices") ?? "{}")); } catch { /* storage unavailable */ } }, []);
  const setPrice = (k: string, v: string) => { const n = { ...prices, [k]: v }; setPrices(n); try { localStorage.setItem("partart-prices", JSON.stringify(n)); } catch { /* ignore */ } };

  const items = build.data?.shopping?.items ?? [];
  const total = useMemo(() => items.filter((i) => i.tier === "minimum").reduce((s, i) => s + (Number(prices[i.key]) || 0), 0), [items, prices]);
  const priced = items.filter((i) => i.tier === "minimum" && Number(prices[i.key]) > 0).length;
  const csv = build.data?.files.find((f) => f.kitPath.endsWith("shopping_list.csv"));
  const pdf = build.data?.files.find((f) => f.kitPath.endsWith("shopping_list.pdf"));

  if (!project) return null;
  if (!last) return <Empty fruit="orange" title="Generate a kit first">The shopping list is calculated from the real files (sheet nesting, mesh volumes, joints). <Link className="underline" href={`/p/${project.id}/kit`}>Go to Build kit</Link></Empty>;
  const regionChanged = build.data?.shopping && build.data.shopping.region !== project.region;

  return (
    <div>
      <SectionTitle fruit="orange" kicker="GET YOUR MATERIALS" title="Shopping list">
        Quantities come from your generated kit. PARTART never invents prices or product links — shops below were checked on the date shown, and links go to the shop or category, not a guaranteed product.
      </SectionTitle>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm"><span className="label">Region</span>
          <select className="input w-auto py-1" value={project.region} onChange={async (e) => { await api(`/api/projects/${project.id}`, { method: "PATCH", json: { region: e.target.value } }); reload(); }}>
            {regions.map((r) => <option key={r.code} value={r.code}>{r.name}{r.hasDirectory ? "" : " — no verified shops yet"}</option>)}
          </select>
        </label>
        {regionChanged && <span className="rounded-full bg-butter px-3 py-1 text-xs">Region changed — regenerate the kit to update shop suggestions.</span>}
        {pdf && <a className="btn btn-sm" href={`/api/files/${pdf.id}`}>PDF</a>}
        {csv && <a className="btn btn-sm" href={`/api/files/${csv.id}`}>CSV</a>}
      </div>

      {TIERS.map((t) => {
        const list = items.filter((i) => i.tier === t.k);
        if (!list.length) return null;
        return (
          <section key={t.k} className="mb-8">
            <h2 className="riso riso-pink text-2xl font-black">{t.t}</h2>
            <p className="mb-3 text-sm text-ink-soft">{t.d}</p>
            <div className="grid gap-3 md:grid-cols-2">
              {list.map((i) => (
                <div key={i.key} className="card p-4 text-sm">
                  <div className="flex items-start gap-2">
                    <span className="chip shrink-0">{i.category}</span>
                    <h3 className="font-display text-lg font-bold leading-tight">{i.name}</h3>
                  </div>
                  <p className="mt-1">{i.spec}</p>
                  <p className="mt-1"><b>Quantity:</b> {i.quantity}{i.wastePct !== undefined ? <span className="text-ink-soft"> · ≈{i.wastePct}% offcut</span> : null}</p>
                  {i.usedFor.length > 0 && <p className="mt-1 font-mono text-[11px] text-ink-soft">for {i.usedFor.join(", ")}</p>}
                  <p className="mt-1 text-xs text-ink-soft">{i.basis}</p>
                  {i.alternatives.length > 0 && <p className="mt-1 text-xs"><b>Alternatives:</b> {i.alternatives.join(" · ")}</p>}
                  <div className="mt-2 rounded-lg bg-paper-2 p-2 text-xs">
                    {i.suppliers.length ? i.suppliers.map((s) => (
                      <p key={s.url}><a className="font-semibold underline" href={s.url} target="_blank" rel="noreferrer">{s.name}</a> <span className="text-ink-soft">— {s.note} (checked {s.verified})</span></p>
                    )) : <p className="text-ink-soft">No verified shop for this item in your region — source it locally using the specification above.</p>}
                  </div>
                  {t.k === "minimum" && (
                    <label className="mt-2 flex items-center gap-2 text-xs">Your price
                      <input className="input w-28 py-0.5" type="number" min={0} placeholder="—" value={prices[i.key] ?? ""} onChange={(e) => setPrice(i.key, e.target.value)} />
                    </label>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
      <div className="card-flat p-4 text-sm">
        <p><b>Estimated cost (your prices):</b> {priced ? `${total.toFixed(2)} for ${priced} of ${items.filter((i) => i.tier === "minimum").length} minimum items` : "enter the prices you find to total them up"}.</p>
        {build.data?.shopping?.notes.map((n, i) => <p key={i} className="mt-1 text-xs text-ink-soft">• {n}</p>)}
      </div>
    </div>
  );
}
