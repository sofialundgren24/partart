import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { getManifold, toMeshData, weldVertices } from "@/lib/geometry/kernel";
import { checkMesh } from "@/lib/geometry/meshCheck";
import { readGlb, readObj, readStl, write3mf, writeBinaryStl, writeGlb, writeObj } from "@/lib/export/mesh-formats";
import { panelsFor } from "@/lib/manufacture/panels";
import { compensate, nest } from "@/lib/manufacture/nest";
import { sheetDxf, sheetSvg } from "@/lib/export/vector-formats";
import { LASER_PRESETS } from "@/lib/manufacture/resolve";

describe("mesh formats round-trip", async () => {
  const wasm = await getManifold();
  const cube = toMeshData(wasm.Manifold.cube([20, 10, 5], true).subtract(wasm.Manifold.cylinder(10, 2, 2, 24, true)));

  it("STL keeps a watertight solid with the right volume", () => {
    const back = readStl(writeBinaryStl(cube));
    expect(back.indices.length).toBe(cube.indices.length);
    expect(checkMesh(weldVertices(back, 1e-4)).watertight).toBe(true);
    expect(checkMesh(cube).volumeMm3).toBeCloseTo(20 * 10 * 5 - Math.PI * 4 * 5, -1);
  });

  it("OBJ and GLB round-trip sizes in mm", async () => {
    const o = readObj(writeObj([{ name: "a", mesh: cube }]));
    expect(checkMesh(o).size.map((x) => Math.round(x))).toEqual([20, 10, 5]);
    const g = await readGlb(await writeGlb([{ name: "C-TEST-01", mesh: cube, colorHex: "#ff0000" }], "t"));
    expect(checkMesh(g).size.map((x) => Math.round(x))).toEqual([20, 10, 5]);
  });

  it("3MF has the core structure, millimetre units and one object per part", async () => {
    const zip = await JSZip.loadAsync(await write3mf([{ name: "A", mesh: cube }, { name: "B", mesh: cube }], "t"));
    const model = await zip.file("3D/3dmodel.model")!.async("string");
    expect(model).toContain('unit="millimeter"');
    expect(model.match(/<object /g)?.length).toBe(2);
    expect(zip.file("[Content_Types].xml")).toBeTruthy();
    expect(zip.file("_rels/.rels")).toBeTruthy();
  });
});

describe("laser geometry", async () => {
  const wasm = await getManifold();
  const box = {
    comp: { partId: "C-BOX-01", name: "Box", role: "structure", parentPartId: null, primitive: { type: "box" as const, w: 120, d: 80, h: 60 }, position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], colorHex: "#cccccc", provenance: "user", confidence: 1 },
    method: "laser" as const, materialKey: "plywood-3", colorHex: "#cccccc", children: [],
  };

  it("box becomes 4 walls + floor + lid with consistent areas", () => {
    const r = panelsFor({ wasm, openingsOf: () => [] }, box);
    expect(r.panels.length).toBe(6);
    // Walls + floor + lid enclose the box: total sheet area ≈ surface area of a 3 mm shell (fingers interleave).
    const area = r.panels.reduce((s, p) => s + p.cut.area(), 0);
    expect(area).toBeGreaterThan(2 * (120 * 80) + 2 * (120 * 54) + 2 * (74 * 54) - 2000);
  });

  it("kerf compensation grows outlines by kerf/2 per side", () => {
    const sq = wasm.CrossSection.ofPolygons([[[0, 0], [20, 0], [20, 20], [0, 20]]]);
    const k = compensate(sq, 0.2);
    const b = k.bounds();
    expect(b.max[0] - b.min[0]).toBeCloseTo(20.2, 5);
  });

  it("nests onto sheets and writes SVG/DXF with the three layers", () => {
    const r = panelsFor({ wasm, openingsOf: () => [] }, box);
    const [layout] = nest(wasm, r.panels, LASER_PRESETS[0], { w: 400, h: 300 }, 0.12);
    expect(layout.unplaced).toEqual([]);
    const svg = sheetSvg(layout, 0, { title: "t" });
    expect(svg).toContain('width="400mm"');
    expect(svg).toContain('id="CUT"');
    expect(svg).toContain("#FF0000");
    const dxf = sheetDxf(layout, 0);
    expect(dxf).toContain("AC1009");
    for (const l of ["CUT", "ENGRAVE", "SCORE"]) expect(dxf).toContain(l);
    expect(dxf.trim().endsWith("EOF")).toBe(true);
  });
});
