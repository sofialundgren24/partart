// Resolves a design (mode + per-component assignments) against the component graph.

import type { ComponentSpec } from "../geometry/types";
import type { Method } from "../materials/catalog";

export interface Assignment {
  partId: string;
  method: Method;
  materialKey: string;
  colorHex?: string | null;
}

export interface ResolvedPart {
  comp: ComponentSpec;
  method: Method;
  materialKey: string;
  colorHex: string;
  children: ResolvedPart[];
}

export interface PrinterProfile {
  name: string;
  buildX: number;
  buildY: number;
  buildZ: number;
  nozzleMm: number;
  layerHeightMm: number;
  filament: string;
  walls: number;
  infillPct: number;
  supports: "none" | "normal" | "tree";
  adhesion: "none" | "brim" | "raft";
  clearanceMm: number;
}

export interface LaserProfile {
  name: string;
  workX: number;
  workY: number;
  kerfMm: number;
  software: "LightBurn" | "xTool Creative Space" | "Other";
  sheetW: number; // stock sheet size you will buy/use
  sheetH: number;
  spacingMm: number;
  jointClearanceMm: number; // extra slot width for press fit vs glue fit
}

export const PRINTER_PRESETS: PrinterProfile[] = [
  { name: "Prusa MK4 / MK4S (250×210×220)", buildX: 250, buildY: 210, buildZ: 220, nozzleMm: 0.4, layerHeightMm: 0.2, filament: "PLA", walls: 3, infillPct: 15, supports: "tree", adhesion: "none", clearanceMm: 0.2 },
  { name: "Bambu Lab P1S / X1C (256×256×256)", buildX: 256, buildY: 256, buildZ: 256, nozzleMm: 0.4, layerHeightMm: 0.2, filament: "PLA", walls: 3, infillPct: 15, supports: "tree", adhesion: "none", clearanceMm: 0.2 },
  { name: "Bambu Lab A1 mini (180×180×180)", buildX: 180, buildY: 180, buildZ: 180, nozzleMm: 0.4, layerHeightMm: 0.2, filament: "PLA", walls: 3, infillPct: 15, supports: "tree", adhesion: "none", clearanceMm: 0.2 },
  { name: "Creality Ender-3 V3 (220×220×250)", buildX: 220, buildY: 220, buildZ: 250, nozzleMm: 0.4, layerHeightMm: 0.2, filament: "PLA", walls: 3, infillPct: 15, supports: "normal", adhesion: "brim", clearanceMm: 0.25 },
  { name: "Elegoo Mars-class resin (≈143×89×175)", buildX: 143, buildY: 89, buildZ: 175, nozzleMm: 0.05, layerHeightMm: 0.05, filament: "Resin", walls: 1, infillPct: 100, supports: "normal", adhesion: "raft", clearanceMm: 0.1 },
];

export const LASER_PRESETS: LaserProfile[] = [
  { name: "xTool S1 / similar 10 W diode (498×319)", workX: 498, workY: 319, kerfMm: 0.12, software: "xTool Creative Space", sheetW: 400, sheetH: 300, spacingMm: 3, jointClearanceMm: 0 },
  { name: "Glowforge-class CO₂ (495×279)", workX: 495, workY: 279, kerfMm: 0.2, software: "Other", sheetW: 495, sheetH: 279, spacingMm: 3, jointClearanceMm: 0 },
  { name: "LightBurn CO₂ 60 W (600×400)", workX: 600, workY: 400, kerfMm: 0.18, software: "LightBurn", sheetW: 600, sheetH: 400, spacingMm: 3, jointClearanceMm: 0 },
  { name: "Hand-cut / no laser (A4 templates)", workX: 297, workY: 210, kerfMm: 0, software: "Other", sheetW: 297, sheetH: 210, spacingMm: 4, jointClearanceMm: 0.2 },
];

export function resolveTree(components: ComponentSpec[], assignments: Assignment[]): ResolvedPart[] {
  const byPart = new Map(assignments.map((a) => [a.partId, a]));
  const nodes = new Map<string, ResolvedPart>();
  for (const c of components) {
    const a = byPart.get(c.partId);
    nodes.set(c.partId, {
      comp: c,
      method: a?.method ?? "print",
      materialKey: a?.materialKey ?? "pla",
      colorHex: a?.colorHex ?? c.colorHex,
      children: [],
    });
  }
  const roots: ResolvedPart[] = [];
  for (const n of nodes.values()) {
    const p = n.comp.parentPartId ? nodes.get(n.comp.parentPartId) : undefined;
    if (p) p.children.push(n);
    else roots.push(n);
  }
  return roots;
}

export function flatten(roots: ResolvedPart[]): ResolvedPart[] {
  const out: ResolvedPart[] = [];
  const walk = (n: ResolvedPart) => { out.push(n); n.children.forEach(walk); };
  roots.forEach(walk);
  return out;
}
