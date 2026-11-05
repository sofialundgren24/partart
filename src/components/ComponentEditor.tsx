"use client";
import { useMemo, useState } from "react";
import { api } from "@/lib/client/api";
import type { ComponentRow } from "./ProjectContext";
import { ProvenanceChip, Swatch } from "./ui";

const ROLES = ["base", "structure", "shell", "roof", "opening", "detail", "joint", "wheel", "axle", "head", "torso", "limb", "hand", "foot", "accessory"];
type Prim = { type: string; w?: number; d?: number; h?: number; r?: number; rTop?: number; storagePath?: string };

export function ComponentTree({ components, selected, onSelect, checked, onCheck }: {
  components: ComponentRow[]; selected: string | null; onSelect: (id: string) => void; checked?: Set<string>; onCheck?: (id: string) => void;
}) {
  const children = useMemo(() => {
    const m = new Map<string | null, ComponentRow[]>();
    const ids = new Set(components.map((c) => c.partId));
    for (const c of components) {
      const k = c.parentId && ids.has(c.parentId) ? c.parentId : null;
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return m;
  }, [components]);
  const render = (parent: string | null, depth: number): React.ReactNode =>
    (children.get(parent) ?? []).map((c) => (
      <div key={c.partId}>
        <div
          onClick={() => onSelect(c.partId)}
          className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm ${selected === c.partId ? "bg-tomato/15 ring-2 ring-tomato" : "hover:bg-paper-2"} ${c.hidden ? "opacity-45" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {onCheck && <input type="checkbox" checked={checked?.has(c.partId) ?? false} onClick={(e) => e.stopPropagation()} onChange={() => onCheck(c.partId)} />}
          <Swatch hex={c.colorHex} size={12} />
          <span className="font-mono text-[11px] text-ink-soft">{c.partId}</span>
          <span className="truncate">{c.name}</span>
          <span className="ml-auto shrink-0 text-[10px] text-ink-soft">{Math.round(c.confidence * 100)}%</span>
        </div>
        {render(c.partId, depth + 1)}
      </div>
    ));
  return <div className="space-y-0.5">{render(null, 0)}</div>;
}

export function ComponentInspector({ projectId, comp, components, onChanged }: { projectId: string; comp: ComponentRow; components: ComponentRow[]; onChanged: (msg?: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const prim = JSON.parse(comp.primitiveJson) as Prim;
  const pos = JSON.parse(comp.positionJson) as number[];
  const rot = JSON.parse(comp.rotationJson) as number[];
  const [draft, setDraft] = useState({ name: comp.name, role: comp.role, parent: comp.parentId ?? "", prim, pos, rot, color: comp.colorHex });
  const key = comp.partId + comp.primitiveJson + comp.positionJson + comp.rotationJson + comp.name;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) { setLastKey(key); setDraft({ name: comp.name, role: comp.role, parent: comp.parentId ?? "", prim, pos, rot, color: comp.colorHex }); }

  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    setBusy(true); setErr(null);
    try { const r = await fn(); onChanged((r as { message?: string })?.message ?? msg); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const save = () => run(() => api(`/api/projects/${projectId}/components/${comp.partId}`, {
    method: "PATCH",
    json: { name: draft.name, role: draft.role, parentPartId: draft.parent || null, primitive: cleanPrim(draft.prim), position: draft.pos, rotation: draft.rot, colorHex: draft.color },
  }), "Saved");
  const num = (v: number | undefined, set: (n: number) => void, label: string, min = 0.1) => (
    <label className="flex flex-col text-[11px] font-semibold text-ink-soft">{label}
      <input type="number" step="0.5" min={min} className="input px-2 py-1 font-mono text-sm text-ink" value={v ?? 0} onChange={(e) => set(Number(e.target.value))} />
    </label>
  );
  const setPrim = (p: Partial<Prim>) => setDraft({ ...draft, prim: { ...draft.prim, ...p } });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs">{comp.partId}</span>
        <ProvenanceChip p={comp.provenance} />
        <span className="text-xs text-ink-soft">confidence {Math.round(comp.confidence * 100)}%</span>
      </div>
      {comp.notes && <p className="rounded-lg bg-paper-2 p-2 text-xs text-ink-soft">{comp.notes}</p>}
      <input className="input font-semibold" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] font-semibold text-ink-soft">Role
          <select className="input px-2 py-1 text-sm text-ink" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>{[...ROLES, "imported"].map((r) => <option key={r}>{r}</option>)}</select>
        </label>
        <label className="text-[11px] font-semibold text-ink-soft">Parent
          <select className="input px-2 py-1 text-sm text-ink" value={draft.parent} onChange={(e) => setDraft({ ...draft, parent: e.target.value })}>
            <option value="">— none —</option>
            {components.filter((c) => c.partId !== comp.partId).map((c) => <option key={c.partId} value={c.partId}>{c.partId} {c.name}</option>)}
          </select>
        </label>
      </div>
      {prim.type !== "mesh" ? (
        <>
          <label className="text-[11px] font-semibold text-ink-soft">Shape
            <select className="input px-2 py-1 text-sm text-ink" value={draft.prim.type} onChange={(e) => {
              const t = e.target.value;
              const s = Math.max(draft.prim.w ?? (draft.prim.r ?? 10) * 2, 1);
              setDraft({ ...draft, prim: t === "cylinder" ? { type: t, r: s / 2, h: draft.prim.h ?? s } : { type: t, w: draft.prim.w ?? s, d: draft.prim.d ?? s, h: draft.prim.h ?? s } });
            }}>
              {["box", "gable", "wedge", "cylinder", "ellipsoid"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {draft.prim.type === "cylinder" ? (
              <>
                {num(draft.prim.r, (n) => setPrim({ r: n }), "radius")}
                {num(draft.prim.rTop ?? draft.prim.r, (n) => setPrim({ rTop: n }), "top radius", 0)}
                {num(draft.prim.h, (n) => setPrim({ h: n }), "height")}
              </>
            ) : (
              <>
                {num(draft.prim.w, (n) => setPrim({ w: n }), "width X")}
                {num(draft.prim.d, (n) => setPrim({ d: n }), "depth Y")}
                {num(draft.prim.h, (n) => setPrim({ h: n }), "height Z")}
              </>
            )}
          </div>
        </>
      ) : <p className="text-xs text-ink-soft">Imported mesh — {[prim.w, prim.d, prim.h].map((x) => x?.toFixed(1)).join(" × ")} mm.</p>}
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => num(draft.pos[i], (n) => setDraft({ ...draft, pos: draft.pos.map((x, j) => (j === i ? n : x)) }), `pos ${"XYZ"[i]}`, -1e6))}
        {[0, 1, 2].map((i) => num(draft.rot[i], (n) => setDraft({ ...draft, rot: draft.rot.map((x, j) => (j === i ? n : x)) }), `rot ${"XYZ"[i]}°`, -360))}
      </div>
      <label className="flex items-center gap-2 text-[11px] font-semibold text-ink-soft">Colour
        <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
      </label>
      {err && <p className="text-xs text-tomato">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>Save</button>
        <button className="btn btn-sm" disabled={busy} onClick={() => run(() => api(`/api/projects/${projectId}/components/${comp.partId}`, { method: "PATCH", json: { hidden: !comp.hidden } }))}>{comp.hidden ? "Show" : "Hide"}</button>
        <button className="btn btn-sm" disabled={busy} onClick={() => run(() => api(`/api/projects/${projectId}/components/ops`, { method: "POST", json: { op: "duplicate", partId: comp.partId, mirrorX: true } }))}>Mirror copy</button>
        <button className="btn btn-sm" disabled={busy || prim.type !== "box"} title="Split a box in two along its longest axis" onClick={() => run(() => api(`/api/projects/${projectId}/components/ops`, { method: "POST", json: { op: "split", partId: comp.partId } }))}>Separate</button>
        <button className="btn btn-sm" disabled={busy} onClick={() => confirm(`Remove ${comp.partId}? Its children move to its parent.`) && run(() => api(`/api/projects/${projectId}/components/${comp.partId}`, { method: "DELETE" }), "Removed")}>Remove</button>
      </div>
      <p className="text-[11px] text-ink-soft">Positions are the base centre of the shape in mm (Z up, origin at the centre of the base, front faces −Y). Editing geometry marks it as <b>user</b>-provided.</p>
    </div>
  );
}

function cleanPrim(p: Prim) {
  if (p.type === "cylinder") return { type: "cylinder", r: p.r, h: p.h, ...(p.rTop !== undefined && p.rTop !== p.r ? { rTop: p.rTop } : {}) };
  if (p.type === "mesh") return p;
  return { type: p.type, w: p.w, d: p.d, h: p.h };
}

export function AddComponent({ projectId, components, onAdded }: { projectId: string; components: ComponentRow[]; onAdded: (m?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("New part");
  const [role, setRole] = useState("detail");
  const [type, setType] = useState("box");
  const [parent, setParent] = useState("");
  if (!open) return <button className="btn btn-sm" onClick={() => setOpen(true)}>+ Add component</button>;
  return (
    <div className="card-flat space-y-2 p-3">
      <input className="input py-1 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="grid grid-cols-3 gap-2">
        <select className="input px-2 py-1 text-sm" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
        <select className="input px-2 py-1 text-sm" value={type} onChange={(e) => setType(e.target.value)}>{["box", "gable", "wedge", "cylinder", "ellipsoid"].map((t) => <option key={t}>{t}</option>)}</select>
        <select className="input px-2 py-1 text-sm" value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">no parent</option>
          {components.map((c) => <option key={c.partId} value={c.partId}>{c.partId}</option>)}
        </select>
      </div>
      <div className="flex gap-2">
        <button className="btn btn-primary btn-sm" onClick={async () => {
          await api(`/api/projects/${projectId}/components`, { method: "POST", json: { name, role, parentPartId: parent || null, primitive: type === "cylinder" ? { type, r: 10, h: 20 } : { type, w: 20, d: 20, h: 20 } } });
          setOpen(false); onAdded("Added");
        }}>Add</button>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
