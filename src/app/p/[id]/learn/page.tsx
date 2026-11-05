"use client";
import { useState } from "react";
import { useProject } from "@/components/ProjectContext";
import { useFetch } from "@/lib/client/api";
import { Empty, RisoLoader, SectionTitle } from "@/components/ui";
import { Fruit } from "@/components/Fruit";

interface Lesson { n: number; title: string; objective: string; tools: string[]; steps: string[]; mistakes: string[]; result: string; partIds: string[] }
interface Course { software: string; title: string; intro: string; lessons: Lesson[] }

export default function LearnPage() {
  const { project } = useProject();
  const [software, setSoftware] = useState<"blender" | "nomad">("blender");
  const course = useFetch<Course>(project?.components.length ? `/api/projects/${project.id}/tutorial?software=${software}` : null);
  const [open, setOpen] = useState(1);
  if (!project) return null;
  if (!project.components.length) return <Empty fruit="lemon" title="Analyse your object first">Lessons are built from your object&apos;s own parts and sizes.</Empty>;
  return (
    <div>
      <SectionTitle fruit="lemon" kicker="LEARN TO MAKE IT" title="Model it yourself">
        A course written for <b>your</b> object: its parts, its proportions, its dimensions. Visuals are renders of your own blockout — not screen recordings of the apps.
      </SectionTitle>
      <div className="mb-6 flex flex-wrap gap-3">
        {(["blender", "nomad"] as const).map((s) => (
          <button key={s} onClick={() => { setSoftware(s); setOpen(1); }} className={`card flex items-center gap-3 px-5 py-3 ${software === s ? "ring-4 ring-tomato" : ""}`}>
            <Fruit kind={s === "blender" ? "orange" : "strawberry"} size={36} />
            <span className="text-left"><b className="font-display text-xl">{s === "blender" ? "Blender" : "Nomad Sculpt"}</b><br /><span className="text-xs text-ink-soft">{s === "blender" ? "Desktop, free · precise blockout + script" : "Tablet sculpting · organic forms"}</span></span>
          </button>
        ))}
        {software === "blender" && <a className="btn ml-auto self-center" href={`/api/projects/${project.id}/tutorial?format=py`}>Download blockout script (.py)</a>}
      </div>
      {!course.data ? <RisoLoader label="Writing your lessons…" /> : (
        <div>
          <p className="mb-4 max-w-3xl text-sm text-ink-soft">{course.data.intro}</p>
          <ol className="space-y-3">
            {course.data.lessons.map((l) => (
              <li key={l.n} className="card overflow-hidden">
                <button className="flex w-full items-center gap-3 p-4 text-left" onClick={() => setOpen(open === l.n ? 0 : l.n)}>
                  <span className="riso flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-butter font-black">{l.n}</span>
                  <span className="flex-1"><b className="font-display text-xl">{l.title}</b><br /><span className="text-sm text-ink-soft">{l.objective}</span></span>
                  <span className="font-mono text-xs">{open === l.n ? "–" : "+"}</span>
                </button>
                {open === l.n && (
                  <div className="grid gap-5 border-t-2 border-ink p-4 md:grid-cols-[1fr_380px]">
                    <div className="space-y-3 text-sm">
                      <p><b>Tools:</b> {l.tools.join(" · ")}</p>
                      <ol className="list-decimal space-y-1 pl-5">{l.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                      <div className="rounded-lg bg-tomato/10 p-2"><b>Common mistakes</b><ul className="list-disc pl-5">{l.mistakes.map((m, i) => <li key={i}>{m}</li>)}</ul></div>
                      <p><b>Expected result:</b> {l.result}</p>
                    </div>
                    <figure>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/projects/${project.id}/render?highlight=${l.partIds.join(",")}`} alt="Render of your blockout" className="w-full rounded-xl border-2 border-ink bg-[#fffaf0]" />
                      <figcaption className="mt-1 text-[11px] text-ink-soft">Render of your blockout{l.partIds.length ? ` — this lesson's parts highlighted` : ""}.</figcaption>
                    </figure>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
