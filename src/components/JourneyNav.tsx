"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fruit, type FruitKind } from "./Fruit";
import { useProject } from "./ProjectContext";

const STEPS: { slug: string; label: string; fruit: FruitKind }[] = [
  { slug: "analyze", label: "Analyze", fruit: "lemon" },
  { slug: "design", label: "Design", fruit: "strawberry" },
  { slug: "workshop", label: "Workshop", fruit: "tomato" },
  { slug: "kit", label: "Build kit", fruit: "apple" },
  { slug: "materials", label: "Materials", fruit: "orange" },
  { slug: "assembly", label: "Assembly", fruit: "pear" },
  { slug: "learn", label: "Learn", fruit: "lemon" },
];

export function JourneyNav({ id }: { id: string }) {
  const path = usePathname();
  const { project } = useProject();
  const reached = (slug: string) => {
    if (!project) return true;
    if (slug === "analyze") return true;
    if (["design", "workshop", "learn"].includes(slug)) return project.components.length > 0;
    if (slug === "kit") return project.designs.length > 0;
    return project.builds.some((b) => b.status === "done");
  };
  return (
    <div className="border-b-2 border-ink bg-paper-2/70">
      <div className="mx-auto flex max-w-7xl items-center gap-4 overflow-x-auto px-5 py-2 scroll-thin">
        <span className="shrink-0 font-display text-lg font-bold">{project?.name ?? "…"}</span>
        <nav className="flex items-center gap-1">
          {STEPS.map((s, i) => {
            const active = path?.endsWith(`/${s.slug}`);
            const ok = reached(s.slug);
            return (
              <Link
                key={s.slug}
                href={`/p/${id}/${s.slug}`}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border-2 px-3 py-1 text-sm font-semibold transition ${active ? "border-ink bg-tomato text-paper shadow-[2px_2px_0_#2d1f33]" : ok ? "border-transparent hover:border-ink" : "border-transparent opacity-45"}`}
              >
                <Fruit kind={s.fruit} size={20} />
                <span className="font-mono text-[10px] opacity-70">{i + 1}</span>
                {s.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
