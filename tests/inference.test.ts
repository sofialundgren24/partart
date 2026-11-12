import { describe, it, expect } from "vitest";
import { templateFor } from "@/lib/analysis/templates";
import { inferHiddenSides, insideLocal, acceptSuggestions } from "@/lib/analysis/inference";
import type { ComponentSpec } from "@/lib/geometry/types";
import { proposeAssignments, DEFAULT_CONTROLS } from "@/lib/design/modes";
import { buildKit } from "@/lib/manufacture/kit";
import { PRINTER_PRESETS, LASER_PRESETS } from "@/lib/manufacture/resolve";

const load = (key?: string): ComponentSpec[] => templateFor("architecture", key).components.map((c) => ({ ...c, provenance: "observed", confidence: 0.8 }));

describe("hidden-side inference (rules, no AI)", () => {
  it("point-in-solid follows the gable slope", () => {
    const g = { type: "gable" as const, w: 100, d: 60, h: 40 };
    expect(insideLocal(g, [0, 0, 39])).toBe(true);
    expect(insideLocal(g, [0, 20, 30])).toBe(false); // above the slope
    expect(insideLocal(g, [0, 10, 10])).toBe(true);
  });

  it("a house seen only from the front gets its back and sides proposed", () => {
    // Keep only what a front photo shows: the front door and the two front windows.
    const front = load().filter((c) => c.role !== "opening" || c.position[1] < 0);
    const s = inferHiddenSides(front);
    const mirror = s.find((x) => x.rule === "mirror-face")!;
    expect(mirror.face).toBe("back");
    expect(mirror.components).toHaveLength(2);
    // Same x as the front windows, on the back wall (y = +70), facing out (+Y → rotation 180).
    expect(mirror.components.map((c) => c.position[0]).sort((a, b) => a - b)).toEqual([-58, 58]);
    for (const c of mirror.components) { expect(c.position[1]).toBeCloseTo(70); expect(Math.abs(c.rotation[2])).toBe(180); }
    const fills = s.filter((x) => x.rule === "fill-face");
    expect(fills.map((f) => f.face).sort()).toEqual(["left", "right"]);
    for (const f of fills) {
      expect(f.components).toHaveLength(2); // 140 mm wall / (28 mm × 2.4) → 2 per floor, 1 floor
      for (const c of f.components) expect(Math.abs(c.position[0])).toBeCloseTo(100);
    }
    expect(s.find((x) => x.rule === "back-door")?.components[0].position[1]).toBeCloseTo(70);
    // Every proposed part is inferred, never "observed".
    for (const x of s) for (const c of x.components) expect(c.provenance).toBe("inferred");
  });

  it("a fully modelled house gets nothing but the back door", () => {
    const s = inferHiddenSides(load());
    expect(s.map((x) => x.rule)).toEqual(["back-door"]);
  });

  it("dismissed suggestions do not come back", () => {
    const front = load().filter((c) => c.role !== "opening" || c.position[1] < 0);
    const all = inferHiddenSides(front);
    const again = inferHiddenSides(front, [all[0].id]);
    expect(again.find((x) => x.id === all[0].id)).toBeUndefined();
  });

  it("accepting gives unique part ids and a note with the evidence", () => {
    const front = load().filter((c) => c.role !== "opening" || c.position[1] < 0);
    const all = inferHiddenSides(front);
    const { added, notes } = acceptSuggestions(front, all, all.map((x) => x.id));
    const ids = [...front, ...added].map((c) => c.partId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(notes.get(added[0].partId)).toMatch(/Inferred by rule/);
  });

  it("Victorian: proposals never land inside the turret, wing or porch", () => {
    const s = inferHiddenSides(load("victorian"));
    expect(s.map((x) => x.id).sort()).toEqual([
      "fill-face:C-BODY-01:back", "fill-face:C-BODY-01:left", "mirror-face:C-ROOF-03:right", "mirror-face:C-WING-01:back",
    ]);
    // Nothing is invented on the photographed front: a mounted part facing -Y has rotation 0.
    for (const x of s) for (const c of x.components) expect(Math.abs(c.rotation[2])).toBeGreaterThan(45);
    // The two window columns of the left wall that sit behind the corner turret are refused, with the reason.
    const left = s.find((x) => x.id === "fill-face:C-BODY-01:left")!;
    expect(left.components).toHaveLength(4);
    expect(left.rejected.every((r) => r.includes("C-TOWER-01"))).toBe(true);
  });

  it("accepted parts are cut into the walls of a real kit", async () => {
    const front = load().filter((c) => c.role !== "opening" || c.position[1] < 0);
    const all = inferHiddenSides(front);
    const { added } = acceptSuggestions(front, all, all.map((x) => x.id));
    const comps = [...front, ...added];
    const kit = await buildKit({
      projectName: "inferred", category: "architecture", designName: "woodwork", mode: "woodwork", components: comps,
      assignments: proposeAssignments("woodwork", comps, DEFAULT_CONTROLS), printer: PRINTER_PRESETS[1], laser: { ...LASER_PRESETS[2] },
      region: "SE", finish: "painted", references: [],
    });
    expect(kit.checks.filter((c) => c.level === "fail")).toEqual([]);
    // Every inferred opening is cut into its wall and clears the corner joints.
    for (const c of added) expect(kit.checks.find((k) => k.message.startsWith(`${c.partId} in C-BODY-01:`))?.level).toBe("pass");
  }, 120000);
});
