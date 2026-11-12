"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";

interface Suggestion {
  id: string; rule: string; title: string; reason: string; parentPartId: string; face: string;
  evidence: string[]; confidence: number; components: { partId: string; name: string }[]; rejected: string[];
}
interface Payload { rules: Record<string, { label: string; explain: string }>; dismissed: string[]; suggestions: Suggestion[] }

/**
 * Suggestions for the sides the photo cannot show, made by PARTART's own rules (no AI). The user previews each one in
 * the 3D view, then accepts (parts are added as "inferred") or rejects it (it is not offered again).
 */
export function HiddenSidesPanel({ projectId, version, preview, onPreview, onChanged }: {
  projectId: string; version: number; preview: string[]; onPreview: (ids: string[]) => void; onChanged: (msg: string) => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setData(await api<Payload>(`/api/projects/${projectId}/suggestions`)), [projectId]);
  useEffect(() => { load(); }, [load, version]);

  const post = async (body: { accept?: string[]; dismiss?: string[]; restore?: boolean }) => {
    setBusy(true);
    try {
      const r = await api<{ message: string }>(`/api/projects/${projectId}/suggestions`, { method: "POST", json: body });
      onPreview(preview.filter((id) => !(body.accept ?? []).includes(id) && !(body.dismiss ?? []).includes(id)));
      onChanged(r.message);
      await load();
    } finally { setBusy(false); }
  };

  if (!data) return null;
  const list = data.suggestions;
  const toggle = (id: string) => onPreview(preview.includes(id) ? preview.filter((x) => x !== id) : [...preview, id]);

  return (
    <div className="card-flat space-y-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="label">Hidden sides</p>
        <span className="chip text-[10px]">rules · no AI</span>
      </div>
      <p className="text-xs text-ink-soft">
        The photo shows the front. These are PARTART&apos;s own rules for the sides it cannot see — each one says what it
        is based on. Tick to preview in pink, then accept or reject.
      </p>
      {!list.length && <p className="text-xs">Nothing to suggest: every hidden wall already has parts, or the suggestions were rejected.</p>}
      <ul className="space-y-2">
        {list.map((s) => (
          <li key={s.id} className={`rounded-lg border-2 p-2 text-xs ${preview.includes(s.id) ? "border-strawberry bg-strawberry/10" : "border-ink/20"}`}>
            <label className="flex cursor-pointer items-start gap-2">
              <input type="checkbox" className="mt-0.5" checked={preview.includes(s.id)} onChange={() => toggle(s.id)} />
              <span>
                <b>{s.title}</b>
                <span className="ml-1 font-mono text-[10px] text-ink-soft">{data.rules[s.rule]?.label} · {Math.round(s.confidence * 100)} %</span>
                <span className="mt-1 block text-ink-soft">{s.reason}</span>
              </span>
            </label>
            {s.rejected.length > 0 && (
              <details className="mt-1 pl-6 text-ink-soft">
                <summary className="cursor-pointer">{s.rejected.length} candidate{s.rejected.length > 1 ? "s" : ""} left out by the geometry check</summary>
                <ul className="mt-1 space-y-0.5">{s.rejected.map((r, i) => <li key={i}>• {r}</li>)}</ul>
              </details>
            )}
            <div className="mt-2 flex gap-2 pl-6">
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => post({ accept: [s.id] })}>Accept {s.components.length}</button>
              <button className="btn btn-sm" disabled={busy} onClick={() => post({ dismiss: [s.id] })}>Reject</button>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {list.length > 1 && <button className="btn btn-sm" disabled={busy} onClick={() => post({ accept: list.map((s) => s.id) })}>Accept all ({list.reduce((n, s) => n + s.components.length, 0)} parts)</button>}
        {data.dismissed.length > 0 && <button className="btn btn-sm" disabled={busy} onClick={() => post({ restore: true })}>Show {data.dismissed.length} rejected again</button>}
      </div>
      <details className="text-xs text-ink-soft">
        <summary className="cursor-pointer">How the rules work</summary>
        <ul className="mt-1 space-y-1">{Object.entries(data.rules).map(([k, r]) => <li key={k}><b>{r.label}:</b> {r.explain}</li>)}</ul>
        <p className="mt-1">Every candidate is checked in 3D: it must lie on a real face of its wall (under a gable&apos;s slopes, clear of the corner joints) and must not be buried inside another part such as a turret or wing. Nothing is ever added to the photographed front.</p>
      </details>
    </div>
  );
}
