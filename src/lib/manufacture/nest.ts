// Sheet nesting: kerf-compensate each panel, then shelf-pack bounding rectangles onto sheets
// (with optional 90° rotation). Rectangle packing is not true-shape nesting; waste figures below use the real
// part areas so they stay honest about how much material is actually used.

import type { ManifoldToplevel } from "manifold-3d";
import type { CrossSection } from "../geometry/kernel";
import type { LaserProfile } from "./resolve";
import type { Panel, Poly, Pt } from "./panels";

export interface PlacedPanel {
  panel: Panel;
  sheet: number;
  /** Kerf-compensated contours in sheet coordinates (mm, origin top-left, y down for SVG). */
  cut: Poly[];
  engrave: Poly[];
  score: Poly[];
  text: { at: Pt; text: string; size: number }[];
  rotated: boolean;
  w: number;
  h: number;
  areaMm2: number;
}

export interface SheetLayout {
  materialKey: string;
  thicknessMm: number;
  method: Panel["method"];
  sheetW: number;
  sheetH: number;
  sheets: { index: number; placed: PlacedPanel[]; usedAreaMm2: number }[];
  unplaced: { panel: Panel; reason: string }[];
  kerfMm: number;
}

export function compensate(cut: CrossSection, kerf: number): CrossSection {
  if (kerf <= 0) return cut;
  // Outer contours grow, holes shrink, by half the kerf — the beam removes kerf/2 on each side of the path.
  return cut.offset(kerf / 2, "Miter", 2);
}

export function nest(wasm: ManifoldToplevel, panels: Panel[], laser: LaserProfile, sheet: { w: number; h: number }, kerf: number): SheetLayout[] {
  void wasm;
  const groups = new Map<string, Panel[]>();
  for (const p of panels) {
    const key = `${p.materialKey}|${p.thicknessMm}|${p.method}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  const SW = Math.min(sheet.w, laser.workX), SH = Math.min(sheet.h, laser.workY);
  const gap = laser.spacingMm;
  const layouts: SheetLayout[] = [];
  for (const [, group] of groups) {
    const items = group.map((panel) => {
      const k = compensate(panel.cut, kerf);
      const b = k.bounds();
      return { panel, k, b, w: b.max[0] - b.min[0], h: b.max[1] - b.min[1], area: k.area() };
    });
    items.sort((a, b) => Math.max(b.h, b.w) - Math.max(a.h, a.w));
    const layout: SheetLayout = {
      materialKey: group[0].materialKey, thicknessMm: group[0].thicknessMm, method: group[0].method,
      sheetW: SW, sheetH: SH, sheets: [], unplaced: [], kerfMm: kerf,
    };
    type Shelf = { y: number; h: number; x: number };
    const sheets: { shelves: Shelf[]; placed: PlacedPanel[]; used: number }[] = [];
    const tryPlace = (s: (typeof sheets)[number], w: number, h: number): { x: number; y: number } | null => {
      for (const sh of s.shelves) if (h <= sh.h && sh.x + w <= SW - gap) { const at = { x: sh.x, y: sh.y }; sh.x += w + gap; return at; }
      const top = s.shelves.length ? s.shelves[s.shelves.length - 1].y + s.shelves[s.shelves.length - 1].h + gap : gap;
      if (top + h <= SH - gap && gap + w <= SW - gap) { s.shelves.push({ y: top, h, x: gap + w + gap }); return { x: gap, y: top }; }
      return null;
    };
    for (const it of items) {
      const fitsA = it.w <= SW - 2 * gap && it.h <= SH - 2 * gap;
      const fitsB = it.h <= SW - 2 * gap && it.w <= SH - 2 * gap;
      if (!fitsA && !fitsB) {
        layout.unplaced.push({ panel: it.panel, reason: `${it.w.toFixed(0)} × ${it.h.toFixed(0)} mm does not fit a ${SW} × ${SH} mm sheet/work area` });
        continue;
      }
      // Prefer landscape (wide, short) to keep shelves low.
      const options: { rot: boolean; w: number; h: number }[] = [];
      if (fitsA) options.push({ rot: false, w: it.w, h: it.h });
      if (fitsB) options.push({ rot: true, w: it.h, h: it.w });
      options.sort((a, b) => a.h - b.h);
      let placed = false;
      for (let si = 0; si <= sheets.length && !placed; si++) {
        if (si === sheets.length) sheets.push({ shelves: [], placed: [], used: 0 });
        for (const o of options) {
          const at = tryPlace(sheets[si], o.w, o.h);
          if (!at) continue;
          sheets[si].placed.push(place(it.panel, it.k, it.b, o.rot, at, si, kerf));
          sheets[si].used += it.area;
          placed = true;
          break;
        }
        if (!placed && sheets[si].placed.length === 0) break;
      }
    }
    layout.sheets = sheets.filter((s) => s.placed.length).map((s, i) => ({ index: i, placed: s.placed.map((p) => ({ ...p, sheet: i })), usedAreaMm2: s.used }));
    layouts.push(layout);
  }
  return layouts;
}

function place(panel: Panel, k: CrossSection, b: { min: number[]; max: number[] }, rot: boolean, at: { x: number; y: number }, sheet: number, kerf: number): PlacedPanel {
  const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1];
  // Map panel coords → sheet coords. Panel y up; sheet y down (SVG). Rotation swaps axes.
  const tf = (pt: Pt): Pt => {
    const x = pt[0] - b.min[0], y = pt[1] - b.min[1];
    if (!rot) return [at.x + x, at.y + (h - y)];
    return [at.x + y, at.y + x];
  };
  void kerf;
  const contours = k.toPolygons().map((poly) => poly.map((v) => tf([v[0], v[1]])));
  return {
    panel, sheet, rotated: rot,
    cut: contours,
    engrave: panel.engrave.map((l) => l.map(tf)),
    score: panel.score.map((l) => l.map(tf)),
    text: panel.text.filter((t) => t.text).map((t) => ({ ...t, at: tf(t.at) })),
    w: rot ? h : w, h: rot ? w : h,
    areaMm2: k.area(),
  };
}
