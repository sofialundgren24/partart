import Link from "next/link";
import { db } from "@/lib/server/db";
import { Empty } from "@/components/ui";
import { Fruit } from "@/components/Fruit";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await db.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: { images: { take: 1 }, builds: { orderBy: { createdAt: "desc" }, take: 1 }, _count: { select: { components: true } } },
  });
  return (
    <main className="mx-auto max-w-7xl px-5 py-10">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div className="flex items-end gap-4">
          <Fruit kind="strawberry" size={64} />
          <h1 className="riso text-5xl font-black">Projects</h1>
        </div>
        <Link href="/create" className="btn btn-primary">New project</Link>
      </div>
      {projects.length === 0 ? (
        <Empty fruit="orange" title="Nothing on the workbench yet">
          Upload a photo of something you&apos;d like to build. <Link className="underline" href="/create">Start a project →</Link>
        </Empty>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/p/${p.id}/analyze`} className="card group overflow-hidden transition hover:-translate-y-1">
              <div className="halftone relative aspect-[4/3] overflow-hidden border-b-2 border-ink">
                {p.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/images/${p.images[0].id}`} alt="" className="h-full w-full object-cover mix-blend-multiply" />
                ) : (
                  <div className="flex h-full items-center justify-center"><Fruit kind="pear" size={90} /></div>
                )}
                <span className="absolute left-3 top-3 rounded-full border-2 border-ink bg-paper px-2 py-0.5 font-mono text-[11px]">{p.status}</span>
              </div>
              <div className="p-4">
                <h2 className="font-display text-xl font-bold">{p.name}</h2>
                <p className="mt-1 text-sm text-ink-soft">{p.category} · {p._count.components} components{p.targetSizeMm ? ` · ${p.targetSizeMm} mm` : ""}</p>
                {p.builds[0]?.readiness && <p className="mt-1 text-xs font-semibold">Last kit: {p.builds[0].readiness.replace(/_/g, " ")}</p>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
