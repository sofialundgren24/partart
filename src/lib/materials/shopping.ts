// Shopping list from the actual generated manufacturing data: sheet counts from the nesting, filament mass from
// mesh volumes, hardware from pins/dowels, adhesives from the assembly joints. No prices are invented.

import { material } from "./catalog";
import { suppliersFor, type SupplierRef } from "./suppliers";
import type { SheetLayout } from "../manufacture/nest";
import type { PrintPart } from "../manufacture/print";
import type { AssemblyStepDef } from "../manufacture/assembly";
import type { ResolvedPart } from "../manufacture/resolve";
import { primitiveSize } from "../geometry/types";

export interface ShoppingItem {
  key: string;
  name: string;
  category: "sheet" | "filament" | "paper" | "clay" | "fabric" | "hardware" | "adhesive" | "finishing" | "tool" | "wood" | "metal" | "paint" | "lighting";
  swatch?: string;
  spec: string;
  quantity: string;
  usedFor: string[]; // partIds
  basis: string; // how the quantity was computed
  wastePct?: number;
  alternatives: string[];
  tier: "minimum" | "recommended" | "premium";
  suppliers: SupplierRef[];
}

export interface ShoppingList {
  region: string;
  items: ShoppingItem[];
  notes: string[];
}

export function buildShoppingList(opts: {
  region: string;
  layouts: SheetLayout[];
  prints: PrintPart[];
  parts: ResolvedPart[];
  steps: AssemblyStepDef[];
  dowelStacks: { partId: string; heightMm: number }[];
  finish: string;
  paints?: { partId: string; paint: { key: string; name: string; hex: string } }[];
  glazedOpenings?: string[];
  ornaments?: string[];
}): ShoppingList {
  const items: ShoppingItem[] = [];
  const sup = (cat: string) => suppliersFor(opts.region, cat);

  for (const l of opts.layouts) {
    const m = material(l.materialKey);
    const sheetArea = l.sheetW * l.sheetH;
    const used = l.sheets.reduce((s, x) => s + x.usedAreaMm2, 0);
    const n = l.sheets.length;
    const parts = Array.from(new Set(l.sheets.flatMap((s) => s.placed.map((p) => p.panel.partId))));
    const isPaper = l.method === "paper";
    items.push({
      key: `${l.materialKey}-${l.thicknessMm}`,
      name: m.name,
      category: isPaper ? "paper" : "sheet",
      spec: isPaper ? `${m.name}, ${l.sheetW} × ${l.sheetH} mm pages` : `${l.thicknessMm} mm thick, ${l.sheetW} × ${l.sheetH} mm sheets (or larger, cut down)`,
      quantity: `${n} ${isPaper ? "page" : "sheet"}${n === 1 ? "" : "s"}`,
      usedFor: parts,
      basis: `Nested layout: ${(used / 100).toFixed(0)} cm² of parts on ${n} × ${(sheetArea / 100).toFixed(0)} cm².`,
      wastePct: n ? Math.round((1 - used / (n * sheetArea)) * 100) : 0,
      alternatives: altFor(l.materialKey),
      tier: "minimum",
      suppliers: sup(isPaper ? "paper" : l.materialKey.startsWith("acrylic") ? "acrylic" : l.materialKey.startsWith("card") || l.materialKey.startsWith("grey") ? "craft" : "wood"),
    });
    if (!isPaper)
      items.push({
        key: `${l.materialKey}-${l.thicknessMm}-test`, name: `${m.name} — offcut for test cuts`, category: "sheet",
        spec: `Same stock, ≈ 100 × 100 mm`, quantity: "1 offcut", usedFor: [], basis: "Kerf/power test before cutting the real parts.",
        alternatives: [], tier: "recommended", suppliers: [],
      });
  }

  const fil = new Map<string, { g: number; parts: string[]; color: string; key: string }>();
  for (const p of opts.prints) {
    const k = `${p.materialKey}|${p.colorHex}`;
    if (!fil.has(k)) fil.set(k, { g: 0, parts: [], color: p.colorHex, key: p.materialKey });
    const e = fil.get(k)!;
    e.g += p.filamentEstimateG;
    e.parts.push(...p.partIds);
  }
  for (const [, e] of fil) {
    const m = material(e.key);
    const withMargin = e.g * 1.15 + (e.parts.length ? 5 : 0);
    const isResin = m.kind === "resin";
    items.push({
      key: `${e.key}-${e.color}`,
      name: `${m.name} — colour ${e.color}`,
      category: "filament",
      swatch: e.color,
      spec: isResin ? "Resin, colour of choice" : "1.75 mm diameter (check your printer)",
      quantity: isResin
        ? `≈ ${Math.ceil(withMargin)} g → 1 × 500 g / 1 kg bottle`
        : `≈ ${Math.ceil(withMargin)} g → ${Math.max(1, Math.ceil(withMargin / 1000))} × 1 kg spool${withMargin > 1000 ? "s" : ""}`,
      usedFor: Array.from(new Set(e.parts)),
      basis: "Geometric estimate from mesh volume, wall count and infill +15 % for supports/purge. Your slicer gives the real figure.",
      alternatives: altFor(e.key),
      tier: "minimum",
      suppliers: sup(isResin ? "resin" : "filament"),
    });
  }

  for (const part of opts.parts.filter((p) => p.method === "manual")) {
    const m = material(part.materialKey);
    const s = primitiveSize(part.comp.primitive);
    const volCm3 = (s[0] * s[1] * s[2] * 0.52) / 1000; // ellipsoid-ish fill of the bounding box
    if (m.kind === "wood" || m.kind === "metal") {
      const p = part.comp.primitive;
      const dia = p.type === "cylinder" ? `Ø${(2 * p.r).toFixed(1)} mm` : `${s[0].toFixed(1)} × ${s[1].toFixed(1)} mm section`;
      items.push({
        key: `${part.materialKey}-${part.comp.partId}`, name: `${m.name} ${dia}`, category: m.kind === "wood" ? "wood" : "metal", swatch: m.colorHex,
        spec: `${dia}, cut to ${s[2].toFixed(1)} mm for ${part.comp.name}`, quantity: `${s[2].toFixed(0)} mm (+ 50 mm spare)`, usedFor: [part.comp.partId],
        basis: "Length from the part height; diameter from the modelled post.", alternatives: m.kind === "wood" ? ["3D-print the post instead (Design → method: 3D print)"] : ["Birch dowel of the same diameter"], tier: "minimum", suppliers: sup(m.kind === "wood" ? "wood" : "craft"),
      });
      continue;
    }
    items.push({
      key: `${part.materialKey}-${part.comp.partId}`, name: m.name, category: m.kind === "clay" ? "clay" : m.kind === "fabric" ? "fabric" : "finishing",
      spec: `For ${part.comp.name}: ${s.map((x) => x.toFixed(0)).join(" × ")} mm`, quantity: m.kind === "clay" ? `≈ ${Math.ceil(volCm3 * 1.7)} g (density ≈ 1.7 g/cm³)` : "as required",
      usedFor: [part.comp.partId], basis: "Bounding volume × 0.52 (rounded form).", alternatives: [], tier: "minimum", suppliers: sup("craft"),
    });
  }

  const pins = opts.prints.find((p) => p.kind === "pins");
  if (pins) items.push({ key: "pins", name: "Alignment pins (printed)", category: "hardware", spec: pins.name, quantity: "included in print files", usedFor: [], basis: "One pair per cut of every split part.", alternatives: ["Ø3 mm steel dowel pins or 3 mm filament offcuts"], tier: "minimum", suppliers: [] });
  if (opts.dowelStacks.length) {
    const total = opts.dowelStacks.reduce((s, d) => s + d.heightMm + 10, 0);
    items.push({ key: "dowel-3", name: "Round wooden dowel Ø3 mm", category: "hardware", spec: "Ø 3 mm (beech/birch)", quantity: `${Math.ceil(total / 10) * 10} mm total (${opts.dowelStacks.length} piece${opts.dowelStacks.length > 1 ? "s" : ""})`, usedFor: opts.dowelStacks.map((d) => d.partId), basis: "Stack height + 10 mm per layered part.", alternatives: ["Ø3 mm bamboo skewer", "1.75 mm filament through a drilled-out hole"], tier: "minimum", suppliers: sup("wood") });
  }

  const glues = new Map<string, string[]>();
  for (const s of opts.steps) for (const a of s.adhesives) glues.set(a, [...(glues.get(a) ?? []), ...s.partIds]);
  for (const [g, parts] of glues) items.push({ key: `glue-${g}`, name: g, category: "adhesive", spec: "Small bottle/tube", quantity: "1", usedFor: Array.from(new Set(parts)), basis: "Chosen from the materials that meet at each joint.", alternatives: [], tier: "minimum", suppliers: sup("craft") });

  // Paints: one entry per colour, listing the parts it is for.
  const byPaint = new Map<string, { paint: { key: string; name: string; hex: string }; parts: string[] }>();
  for (const p of opts.paints ?? []) {
    const e = byPaint.get(p.paint.key) ?? { paint: p.paint, parts: [] };
    e.parts.push(p.partId);
    byPaint.set(p.paint.key, e);
  }
  for (const { paint, parts } of byPaint.values())
    items.push({
      key: `paint-${paint.key}`, name: `Acrylic paint — ${paint.name}`, category: "paint", swatch: paint.hex, spec: `Colour close to ${paint.hex} (matched from your reference)`,
      quantity: parts.length > 6 ? "1 × 60 ml" : "1 × 20 ml", usedFor: parts, basis: "Nearest standard hobby colour to each part's colour in the analysis.",
      alternatives: ["Print in a filament of this colour and skip painting"], tier: opts.finish === "painted" ? "minimum" : "recommended", suppliers: sup("craft"),
    });
  if (byPaint.size) items.push({ key: "primer", name: "Primer (grey or white, spray or brush)", category: "paint", swatch: "#b9b9b5", spec: "Acrylic primer for plastic and wood", quantity: "1", usedFor: [], basis: "Painted parts need a primer coat for adhesion.", alternatives: [], tier: opts.finish === "painted" ? "minimum" : "recommended", suppliers: sup("craft") });
  if ((opts.glazedOpenings ?? []).length)
    items.push({
      key: "led", name: "Warm-white LED micro fairy lights (battery box)", category: "lighting", swatch: "#ffd98a", spec: "Copper-wire 'micro' string, warm white (≈2700 K), battery or USB powered",
      quantity: `1 string of ≥ ${opts.glazedOpenings!.length} LEDs (≈ 1 m)`, usedFor: opts.glazedOpenings!, basis: "One LED behind each glazed window/door; route the wire through a 4 mm hole in the floor.",
      alternatives: ["A single USB LED puck under an open floor"], tier: "recommended", suppliers: [],
    });
  if ((opts.ornaments ?? []).length)
    items.push({ key: "brass-wire", name: "Brass wire Ø0.8–1 mm", category: "metal", swatch: "#c9a24a", spec: "Straight lengths", quantity: "≈ 300 mm", usedFor: opts.ornaments!, basis: "Spikes for finials/cresting and pins to reinforce delicate trim.", alternatives: ["Steel pins with the heads cut off"], tier: "recommended", suppliers: sup("craft") });

  items.push({ key: "sandpaper", name: "Sandpaper assortment", category: "finishing", spec: "180 / 240 / 400 grit", quantity: "1 pack", usedFor: [], basis: "Clean-up of cut edges and printed contact faces.", alternatives: [], tier: "recommended", suppliers: sup("craft") });
  if (opts.finish === "painted") items.push({ key: "paint", name: "Acrylic paints + primer", category: "finishing", spec: "Colours as in the design palette", quantity: "1 set", usedFor: [], basis: "Painted finish selected.", alternatives: ["Spray primer for printed parts"], tier: "recommended", suppliers: sup("craft") });
  if (opts.finish === "oiled") items.push({ key: "oil", name: "Hard-wax oil or Danish oil", category: "finishing", spec: "Small tin", quantity: "1", usedFor: [], basis: "Oiled wood finish selected.", alternatives: [], tier: "recommended", suppliers: sup("wood") });
  items.push({ key: "premium-wood", name: "Premium: B/BB-grade birch plywood or walnut veneer ply", category: "sheet", spec: "Same thickness as the design", quantity: "same as above", usedFor: [], basis: "Optional upgrade for visible faces.", alternatives: [], tier: "premium", suppliers: sup("wood") });
  items.push({ key: "premium-fil", name: "Premium: matte or silk PLA in curated colours", category: "filament", spec: "1.75 mm", quantity: "same as above", usedFor: [], basis: "Optional finish upgrade.", alternatives: [], tier: "premium", suppliers: sup("filament") });

  const notes = [
    "Prices are not shown: PARTART has no verified live price feed. Quantities and specifications are computed from your generated files.",
    "Measure actual sheet thickness with calipers before cutting; nominal 3 mm plywood is often 2.8–3.2 mm. Update the material thickness and regenerate if it differs by more than 0.1 mm.",
  ];
  return { region: opts.region, items, notes };
}

function altFor(key: string): string[] {
  const m: Record<string, string[]> = {
    "plywood-3": ["MDF 3 mm (cheaper, paint it)", "Poplar plywood 3 mm (lighter, softer)"],
    "mdf-3": ["Birch plywood 3 mm (stronger, nicer edge)"],
    "acrylic-clear-2": ["PETG sheet 2 mm (shatter-resistant, not ideal for diode lasers)", "Clear acetate film for paper builds"],
    pla: ["PETG (more heat resistant)"],
    "cardboard-3": ["Greyboard 2 mm (denser, cleaner edges)"],
    "cardstock-250": ["Cardstock 200–300 g/m² (check printer max)"],
  };
  return m[key] ?? [];
}
