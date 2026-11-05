// Fast concept comparison: real panel areas and solid volumes, without writing files.
import { getManifold, componentSolid } from "../geometry/kernel";
import type { ComponentSpec, MeshData } from "../geometry/types";
import { material } from "../materials/catalog";
import { panelsFor } from "../manufacture/panels";
import { flatten, resolveTree, type Assignment } from "../manufacture/resolve";
import { MODES, type ModeKey } from "./modes";

export interface ConceptStats {
  pieces: number;
  printedParts: number;
  sheetPieces: number;
  manualParts: number;
  omitted: number;
  printVolumeCm3: number;
  filamentEstimateG: number;
  sheetAreaCm2: Record<string, number>;
  materials: string[];
  equipment: string[];
  difficulty: "easy" | "medium" | "hard";
  difficultyReason: string;
}

export async function conceptStats(mode: ModeKey, comps: ComponentSpec[], assignments: Assignment[], meshLoader?: (p: string) => MeshData): Promise<ConceptStats> {
  const wasm = await getManifold();
  const parts = flatten(resolveTree(comps, assignments)).filter((p) => !p.comp.hidden);
  const byId = new Map(parts.map((p) => [p.comp.partId, p]));
  let printVol = 0, pieces = 0, sheetPieces = 0;
  const area: Record<string, number> = {};
  const mats = new Set<string>();
  for (const p of parts) {
    if (p.method === "omit") continue;
    mats.add(material(p.materialKey).name);
    if (p.method === "print") {
      const v = componentSolid(wasm, p.comp, meshLoader, 16).volume();
      printVol += p.comp.role === "shell" || p.comp.role === "roof" ? v * 0.25 : v; // shells/roofs print hollow
      pieces++;
    } else if (p.method === "manual") pieces++;
    else {
      const r = panelsFor({ wasm, openingsOf: (id) => (byId.get(id)?.children ?? []).filter((c) => c.comp.role === "opening" && c.method !== "omit") }, p);
      const key = `${material(p.materialKey).name}`;
      area[key] = (area[key] ?? 0) + r.panels.reduce((s, x) => s + x.cut.area(), 0) / 100;
      sheetPieces += r.panels.length;
      pieces += r.panels.length;
    }
  }
  const printed = parts.filter((p) => p.method === "print").length;
  const manual = parts.filter((p) => p.method === "manual").length;
  const fil = (printVol / 1000) * 1.24 * 0.45; // rough shells+15 % infill share, labelled estimate
  const methods = new Set(parts.filter((p) => p.method !== "omit").map((p) => p.method));
  const difficulty = pieces > 60 || methods.size >= 3 || manual > 3 ? "hard" : pieces > 20 || methods.size === 2 ? "medium" : "easy";
  return {
    pieces, printedParts: printed, sheetPieces, manualParts: manual, omitted: parts.filter((p) => p.method === "omit").length,
    printVolumeCm3: printVol / 1000, filamentEstimateG: fil, sheetAreaCm2: area, materials: Array.from(mats),
    equipment: MODES.find((m) => m.key === mode)?.equipment ?? [],
    difficulty, difficultyReason: `${pieces} physical pieces, ${methods.size} manufacturing method${methods.size === 1 ? "" : "s"}${manual ? `, ${manual} hand-made` : ""}.`,
  };
}
