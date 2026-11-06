import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { scaleComponent, templateFor } from "@/lib/analysis/templates";
import { proposeAssignments, DEFAULT_CONTROLS, modeExtras, type ModeKey } from "@/lib/design/modes";
import { buildKit } from "@/lib/manufacture/kit";
import { PRINTER_PRESETS, LASER_PRESETS } from "@/lib/manufacture/resolve";
import type { ComponentSpec } from "@/lib/geometry/types";
import { readStl } from "@/lib/export/mesh-formats";

const OUT = path.resolve("storage/test-out");

function comps(category: string): ComponentSpec[] {
  return templateFor(category).components.map((c) => ({ ...c, provenance: "template", confidence: 0.5 }));
}

async function run(category: string, mode: ModeKey, printer = PRINTER_PRESETS[0]) {
  const base = comps(category);
  const all = [...base, ...modeExtras(mode, base)];
  const assignments = proposeAssignments(mode, all, DEFAULT_CONTROLS);
  const kit = await buildKit({
    projectName: `Test ${category} ${mode}`, category, designName: mode, mode, components: all, assignments,
    printer, laser: LASER_PRESETS[0], region: "SE", finish: "raw", references: [],
  });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${category}_${mode}.zip`), kit.zip);
  return kit;
}

describe("build kit", () => {
  for (const [cat, mode] of [["architecture", "realistic"], ["architecture", "woodwork"], ["architecture", "mixed"], ["architecture", "papercraft"], ["vehicles", "realistic"], ["figurines", "sculptural"], ["figurines", "collectible"], ["furniture", "flatpack"], ["architecture", "cardboard"]] as const) {
    it(`${cat} / ${mode}`, async () => {
      const kit = await run(cat, mode);
      const fails = kit.checks.filter((c) => c.level === "fail");
      if (fails.length) console.log(cat, mode, fails.map((f) => f.message));
      console.log(`${cat}/${mode}: ${kit.readiness}, ${kit.files.length} files, ${kit.stats.printedFiles} prints, ${kit.stats.sheetParts} sheet parts on ${kit.stats.sheets} sheets, ${kit.stats.filamentG.toFixed(0)} g, zip ${(kit.zip.length / 1024).toFixed(0)} kB`);
      expect(kit.checks.filter((c) => c.area === "geometry" && c.level === "fail")).toEqual([]);
      for (const f of kit.files) expect(f.bytes).toBeGreaterThan(0);
      // Every STL reparses and has triangles
      for (const f of kit.files.filter((f) => f.format === "stl")) expect(readStl(f.data).indices.length).toBeGreaterThan(0);
      const zip = await JSZip.loadAsync(kit.zip);
      expect(Object.keys(zip.files).length).toBeGreaterThan(kit.files.length - 1);
    });
  }

  it("splits a part that is larger than the printer", async () => {
    const big = comps("architecture").map((c) => ({ ...c, ...scaleComponent(c, 1.6) }));
    const kit = await buildKit({ projectName: "big", category: "architecture", designName: "r", mode: "realistic", components: big, assignments: proposeAssignments("realistic", big, DEFAULT_CONTROLS), printer: PRINTER_PRESETS[2], laser: LASER_PRESETS[0], region: "SE", finish: "raw", references: [] });
    const sections = kit.printCards.filter((c) => /-S\d/.test(c.fileId));
    expect(sections.length).toBeGreaterThan(1);
    expect(kit.printCards.some((c) => c.fileId === "PINS")).toBe(true);
    for (const c of kit.printCards) for (let k = 0; k < 3; k++) expect(c.sizeMm[k]).toBeLessThanOrEqual([180, 180, 180][k]);
  });
});
