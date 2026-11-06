"use client";

export interface CladdingCount {
  panelId: string; partId: string; label: string; kind: string; courses: number; pieces: number; units: number;
  totalLengthMm: number; exposureMm: number; stripHeightMm: number; materialKey: string;
}

/** Exact counts of shingle courses and siding boards to cut, per wall/roof surface. */
export function CladdingTable({ counts }: { counts: CladdingCount[] }) {
  if (!counts.length) return null;
  const strips = counts.reduce((s, c) => s + c.pieces, 0);
  const shingles = counts.filter((c) => c.kind === "shingle" || c.kind === "fishscale").reduce((s, c) => s + c.units, 0);
  const metres = counts.reduce((s, c) => s + c.totalLengthMm, 0) / 1000;
  return (
    <div className="card p-4">
      <h3 className="font-display text-xl font-bold">Shingles &amp; siding — exact counts</h3>
      <p className="mb-3 text-sm text-ink-soft">
        Every course is a separate cut strip, shaped to the real wall or roof (around windows, along gables). Engraved guide lines on each panel show where each course goes; glue from the bottom (R01) up.
      </p>
      <div className="mb-3 flex flex-wrap gap-3 text-sm">
        <span className="chip bg-butter/50">{strips} strips</span>
        <span className="chip bg-tomato/15">{shingles} shingles</span>
        <span className="chip">{metres.toFixed(1)} m of strip</span>
      </div>
      <div className="max-h-[420px] overflow-auto scroll-thin">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-paper text-left text-ink-soft">
            <tr><th className="py-1">Part</th><th>Surface</th><th>Type</th><th className="text-right">Courses</th><th className="text-right">Strips</th><th className="text-right">Shingles</th><th className="text-right">Length mm</th><th className="text-right">Exposure</th></tr>
          </thead>
          <tbody>
            {counts.map((c) => (
              <tr key={c.panelId} className="border-t border-ink/10">
                <td className="py-1 font-mono">{c.partId}</td>
                <td>{c.label.split(" — ").slice(1).join(" — ")}</td>
                <td>{c.kind}</td>
                <td className="text-right font-mono">{c.courses}</td>
                <td className="text-right font-mono">{c.pieces}</td>
                <td className="text-right font-mono">{c.kind === "shingle" || c.kind === "fishscale" ? c.units : "—"}</td>
                <td className="text-right font-mono">{c.totalLengthMm}</td>
                <td className="text-right font-mono">{c.exposureMm} mm</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
