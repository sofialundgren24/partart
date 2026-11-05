"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/client/api";

export interface ComponentRow {
  id: string; partId: string; name: string; role: string; parentId: string | null; primitiveJson: string; positionJson: string; rotationJson: string;
  colorHex: string; provenance: string; confidence: number; notes: string; hidden: boolean; sortOrder: number;
}
export interface AssignmentRow { partId: string; method: string; materialKey: string; colorHex: string | null; userLocked: boolean }
export interface DesignRow { id: string; name: string; mode: string; controlsJson: string; assignments: AssignmentRow[] }
export interface ProjectData {
  id: string; name: string; description: string; intent: string; category: string; targetSizeMm: number | null; realSizeMm: number | null;
  region: string; status: string; activeDesignId: string | null;
  images: { id: string; fileName: string; view: string }[];
  analyses: { id: string; version: number; provider: string; model: string | null; category: string; summary: string; findingsJson: string; createdAt: string }[];
  reconstructions: { id: string; provider: string; kind: string; notes: string }[];
  components: ComponentRow[];
  relationships: { fromPart: string; toPart: string; type: string }[];
  designs: DesignRow[];
  jobs: { id: string; type: string; status: string; progress: number; message: string; error: string | null }[];
  builds: { id: string; designId: string; status: string; readiness: string | null; createdAt: string }[];
}

const Ctx = createContext<{ project: ProjectData | null; reload: () => Promise<void>; error: string | null }>({ project: null, reload: async () => {}, error: null });

export function ProjectProvider({ id, children }: { id: string; children: React.ReactNode }) {
  const [project, setProject] = useState<ProjectData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try { setProject(await api<ProjectData>(`/api/projects/${id}`)); setError(null); } catch (e) { setError(String((e as Error).message)); }
  }, [id]);
  useEffect(() => { reload(); }, [reload]);
  return <Ctx.Provider value={{ project, reload, error }}>{children}</Ctx.Provider>;
}

export const useProject = () => useContext(Ctx);

export function activeDesign(p: ProjectData | null): DesignRow | null {
  if (!p) return null;
  return p.designs.find((d) => d.id === p.activeDesignId) ?? p.designs[p.designs.length - 1] ?? null;
}
