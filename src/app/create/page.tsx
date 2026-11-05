"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Fruit } from "@/components/Fruit";
import { api } from "@/lib/client/api";

const VIEWS = ["front", "side", "back", "top", "detail", "unspecified"];
const EXAMPLES = [
  "I want to recreate this Victorian house as a 25 cm miniature.",
  "I want to make this doll as a 30 cm articulated collectible.",
  "I want to turn this car into a wooden model with 3D-printed wheels.",
];

interface Meta {
  providers: { analysis: { id: string; model: string | null } };
  categories: { key: string; label: string }[];
  regions: { code: string; name: string; hasDirectory: boolean }[];
}

export default function CreatePage() {
  const router = useRouter();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [files, setFiles] = useState<{ file: File; url: string; view: string }[]>([]);
  const [mesh, setMesh] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [intent, setIntent] = useState("");
  const [category, setCategory] = useState("architecture");
  const [targetSize, setTargetSize] = useState("250");
  const [realSize, setRealSize] = useState("");
  const [region, setRegion] = useState("SE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { api<Meta>("/api/meta").then(setMeta).catch(() => {}); }, []);

  const add = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (/\.(stl|obj|glb)$/i.test(f.name)) { setMesh(f); continue; }
      if (!f.type.startsWith("image/")) continue;
      next.push({ file: f, url: URL.createObjectURL(f), view: next.length === 0 ? "front" : next.length === 1 ? "side" : "unspecified" });
    }
    setFiles(next);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("name", name || files[0]?.file.name.replace(/\.[^.]+$/, "") || mesh?.name || "Untitled object");
      fd.set("description", description);
      fd.set("intent", intent);
      fd.set("category", category);
      fd.set("targetSizeMm", targetSize);
      fd.set("realSizeMm", realSize);
      fd.set("region", region);
      files.forEach((f) => { fd.append("images", f.file); fd.append("views", f.view); });
      if (mesh) fd.set("mesh", mesh);
      const r = await api<{ project: { id: string }; job: { id: string } }>("/api/projects", { method: "POST", body: fd });
      router.push(`/p/${r.project.id}/analyze?job=${r.job.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const analysis = meta?.providers.analysis;

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-8 flex items-end gap-4">
        <Fruit kind="orange" size={72} />
        <div>
          <p className="font-mono text-xs text-ink-soft">STEP 01 · UPLOAD</p>
          <h1 className="riso text-5xl font-black">What do you want to make?</h1>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        <section>
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
            onClick={() => input.current?.click()}
            className={`card flex cursor-pointer flex-col items-center justify-center gap-3 border-dashed p-10 text-center transition ${drag ? "halftone-tomato scale-[1.01]" : "halftone"}`}
          >
            <Fruit kind="apple" size={80} />
            <p className="riso text-2xl font-bold">Drop photos here</p>
            <p className="max-w-sm text-sm text-ink-soft">JPG, PNG or WebP. Front, side, back and detail views all help — one photo works too. You can also drop an STL, OBJ or GLB if you already have a 3D model.</p>
            <input ref={input} type="file" multiple accept="image/*,.stl,.obj,.glb" className="hidden" onChange={(e) => add(e.target.files)} />
          </div>

          {files.length > 0 && (
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {files.map((f, i) => (
                <div key={f.url} className="card-flat peel-in overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.url} alt="" className="aspect-square w-full object-cover" />
                  <div className="flex items-center gap-2 p-2">
                    <select className="input py-1 text-sm" value={f.view} onChange={(e) => setFiles(files.map((x, j) => (j === i ? { ...x, view: e.target.value } : x)))}>
                      {VIEWS.map((v) => <option key={v}>{v}</option>)}
                    </select>
                    <button className="btn btn-sm" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove">×</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {mesh && (
            <div className="card-flat mt-4 flex items-center gap-3 p-3">
              <Fruit kind="strawberry" size={36} />
              <div className="flex-1 text-sm"><b>3D model:</b> {mesh.name} ({(mesh.size / 1024).toFixed(0)} kB) — it will be used as the geometry and validated.</div>
              <button className="btn btn-sm" onClick={() => setMesh(null)}>Remove</button>
            </div>
          )}
          <p className="mt-4 text-xs text-ink-soft">
            Analysis: {analysis ? (analysis.id === "claude-vision" ? `Claude vision (${analysis.model}) will read your photos.` : "No vision API key configured — PARTART will start from an editable category template and label it as such.") : "…"}
          </p>
        </section>

        <section className="card space-y-4 p-6">
          <div>
            <label className="label">Name</label>
            <input className="input mt-1" placeholder="e.g. Grandma's Victorian house" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">What do you want to create?</label>
            <textarea className="input mt-1 min-h-20" value={intent} onChange={(e) => setIntent(e.target.value)} placeholder={EXAMPLES[0]} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXAMPLES.map((e) => <button key={e} className="chip text-ink-soft hover:text-ink" onClick={() => setIntent(e)}>{e.slice(0, 42)}…</button>)}
            </div>
          </div>
          <div>
            <label className="label">Describe the object (optional)</label>
            <textarea className="input mt-1 min-h-16" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Materials, colours, anything the photo doesn't show" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Category</label>
              <select className="input mt-1" value={category} onChange={(e) => setCategory(e.target.value)}>
                {(meta?.categories ?? [{ key: "architecture", label: "Architecture" }]).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-ink-soft">With vision analysis the category is detected automatically; this is a hint.</p>
            </div>
            <div>
              <label className="label">Region (shopping)</label>
              <select className="input mt-1" value={region} onChange={(e) => setRegion(e.target.value)}>
                {(meta?.regions ?? [{ code: "SE", name: "Sweden", hasDirectory: true }]).map((r) => <option key={r.code} value={r.code}>{r.name}{r.hasDirectory ? "" : " (no supplier list yet)"}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Finished size (mm)</label>
              <input className="input mt-1" type="number" min={10} value={targetSize} onChange={(e) => setTargetSize(e.target.value)} />
              <p className="mt-1 text-[11px] text-ink-soft">Largest dimension of your build.</p>
            </div>
            <div>
              <label className="label">Real size (mm, optional)</label>
              <input className="input mt-1" type="number" min={1} value={realSize} onChange={(e) => setRealSize(e.target.value)} placeholder="if you measured it" />
              <p className="mt-1 text-[11px] text-ink-soft">Treated as a measurement, not a guess.</p>
            </div>
          </div>
          {error && <p className="rounded-lg border-2 border-tomato bg-tomato/10 p-2 text-sm text-tomato">{error}</p>}
          <button className="btn btn-primary w-full justify-center text-lg" disabled={busy || (!files.length && !mesh)} onClick={submit}>
            {busy ? "Uploading…" : "Analyse my object →"}
          </button>
        </section>
      </div>
    </main>
  );
}
