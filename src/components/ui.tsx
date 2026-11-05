"use client";
import { Fruit, type FruitKind } from "./Fruit";

export function RisoLoader({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10">
      <div className="riso-loader"><span /><span /><span /></div>
      {label && <p className="hand text-lg">{label}</p>}
    </div>
  );
}

export function JobProgress({ job }: { job: { status: string; progress: number; message: string; error: string | null } | null }) {
  if (!job) return <RisoLoader label="Starting…" />;
  return (
    <div className="card p-6">
      <div className="flex items-center gap-5">
        {job.status === "failed" ? <Fruit kind="tomato" size={56} /> : <div className="riso-loader shrink-0"><span /><span /><span /></div>}
        <div className="flex-1">
          <p className="font-semibold">{job.status === "failed" ? "Something went wrong" : job.message || "Working…"}</p>
          {job.error && <p className="mt-1 text-sm text-tomato">{job.error}</p>}
          <div className="mt-3 h-3 overflow-hidden rounded-full border-2 border-ink bg-paper">
            <div className="h-full bg-tangerine transition-all" style={{ width: `${Math.round(job.progress * 100)}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function Empty({ fruit, title, children }: { fruit: FruitKind; title: string; children?: React.ReactNode }) {
  return (
    <div className="card-flat flex flex-col items-center gap-3 px-6 py-12 text-center">
      <Fruit kind={fruit} size={88} />
      <h3 className="riso text-2xl font-bold">{title}</h3>
      <div className="max-w-md text-sm text-ink-soft">{children}</div>
    </div>
  );
}

const PROV: Record<string, string> = {
  observed: "bg-leaf/20 text-leaf",
  inferred: "bg-sky/30 text-[#3d6f84]",
  assumed: "bg-butter/40 text-[#8a6a00]",
  template: "bg-strawberry/20 text-[#b03a64]",
  user: "bg-plum/15 text-plum",
  imported: "bg-tangerine/25 text-[#a85a10]",
};

export function ProvenanceChip({ p }: { p: string }) {
  return <span className={`chip ${PROV[p] ?? ""}`}>{p}</span>;
}

const READY: Record<string, { label: string; cls: string; fruit: FruitKind }> = {
  ready: { label: "Ready to manufacture", cls: "bg-leaf text-paper", fruit: "pear" },
  ready_with_warnings: { label: "Ready with warnings", cls: "bg-butter text-ink", fruit: "lemon" },
  needs_adjustment: { label: "Needs adjustment", cls: "bg-tangerine text-ink", fruit: "orange" },
  not_manufacturable: { label: "Not manufacturable", cls: "bg-tomato text-paper", fruit: "tomato" },
};

export function ReadinessBadge({ r, large }: { r: string | null; large?: boolean }) {
  const d = READY[r ?? ""] ?? { label: "Not generated", cls: "bg-paper-2", fruit: "apple" as FruitKind };
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border-2 border-ink font-bold ${d.cls} ${large ? "px-4 py-2 text-lg" : "px-2.5 py-0.5 text-xs"}`}>
      {large && <Fruit kind={d.fruit} size={28} />}
      {d.label}
    </span>
  );
}

export function Swatch({ hex, size = 16 }: { hex: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full border-2 border-ink" style={{ background: hex, width: size, height: size }} />;
}

export function SectionTitle({ fruit, kicker, title, children }: { fruit: FruitKind; kicker: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-start gap-4">
      <Fruit kind={fruit} size={60} />
      <div className="flex-1">
        <p className="font-mono text-xs text-ink-soft">{kicker}</p>
        <h1 className="riso text-4xl font-black">{title}</h1>
        {children && <div className="mt-1 max-w-3xl text-ink-soft">{children}</div>}
      </div>
    </div>
  );
}
