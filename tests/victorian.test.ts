import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { templateFor } from "@/lib/analysis/templates";
import { proposeAssignments, DEFAULT_CONTROLS, modeExtras, type ModeKey } from "@/lib/design/modes";
import { buildKit } from "@/lib/manufacture/kit";
import { PRINTER_PRESETS, LASER_PRESETS } from "@/lib/manufacture/resolve";
import type { ComponentSpec } from "@/lib/geometry/types";

const OUT = path.resolve("storage/test-out");

describe("Victorian house", () => {
  const base: ComponentSpec[] = templateFor("architecture", "victorian").components.map((c) => ({ ...c, provenance: "template", confidence: 0.5 }));

  it("template has the architectural vocabulary", () => {
    const types = new Set(base.map((c) => c.primitive.type));
    for (const t of ["ngon", "pyramid", "gable", "wedge", "stairs", "railing", "ornament"]) expect(types.has(t as never)).toBe(true);
    expect(base.filter((c) => c.role === "opening").length).toBeGreaterThan(12);
  });

  for (const mode of ["woodwork", "mixed", "realistic", "papercraft"] as ModeKey[]) {
    it(`builds a ${mode} kit`, async () => {
      const all = [...base, ...modeExtras(mode, base)];
      const kit = await buildKit({
        projectName: `Victorian ${mode}`, category: "architecture", designName: mode, mode, components: all,
        assignments: proposeAssignments(mode, all, DEFAULT_CONTROLS), printer: PRINTER_PRESETS[1], laser: { ...LASER_PRESETS[2] },
        region: "SE", finish: "painted", references: [],
      });
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, `victorian_${mode}.zip`), kit.zip);
      const bad = kit.checks.filter((c) => c.level !== "pass");
      console.log(`victorian/${mode}: ${kit.readiness}, ${kit.files.length} files, ${kit.stats.printedFiles} prints, ${kit.stats.sheetParts} sheet parts / ${kit.stats.sheets} sheets, ${kit.stats.filamentG.toFixed(0)} g`);
      for (const b of bad.slice(0, 25)) console.log(`  [${b.level}] ${b.message}`);
      expect(kit.checks.filter((c) => c.area === "geometry" && c.level === "fail")).toEqual([]);
      expect(kit.files.some((f) => f.kitPath.endsWith("build_catalogue.pdf"))).toBe(true);
    });
  }
});
