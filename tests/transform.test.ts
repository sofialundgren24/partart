import { describe, it, expect } from "vitest";
import { getManifold, bboxOf } from "@/lib/geometry/kernel";
import { toWorld } from "@/lib/geometry/transform";
import type { Vec3 } from "@/lib/geometry/types";

describe("rotation convention matches manifold-3d", () => {
  it("maps an off-centre cube identically", async () => {
    const wasm = await getManifold();
    const cases: Vec3[] = [[90, 0, 0], [0, 90, 0], [0, 0, 90], [30, 45, 60], [-20, 110, 15]];
    for (const rot of cases) {
      const p: Vec3 = [7, -3, 11];
      const m = wasm.Manifold.cube([0.01, 0.01, 0.01], true).translate(p).rotate(rot).translate([1, 2, 3]);
      const b = bboxOf(m);
      const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
      const w = toWorld(p, rot, [1, 2, 3]);
      for (let k = 0; k < 3; k++) expect(c[k]).toBeCloseTo(w[k], 3);
    }
  });
});
