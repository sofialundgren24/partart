// Cladding as real, countable pieces: instead of only engraving a pattern, every course of shingles and every
// siding board becomes its own cut strip, sized to the actual wall/roof outline (windows, gables and trimmed
// edges included). The base panel gets engraved guide lines showing where each course goes.
//
//   clapboard   → horizontal boards, 3.0 mm exposure + 1.5 mm overlap, glued bottom-up
//   shingle     → strips of square-tab shingles (slits between tiles), 3.2 mm exposure, rows staggered
//   fishscale   → strips with a scalloped (round-tab) bottom edge, staggered
//   boardbatten → vertical boards with narrow battens over the joints
// Stone and brick stay engraved (individual stones are not practical to cut).

import type { ManifoldToplevel } from "manifold-3d";
import type { CrossSection } from "../geometry/kernel";
import type { Cladding } from "../geometry/types";
import { clipLines, type Panel, type Poly, type Pt } from "./panels";

export interface CladdingCount {
  panelId: string;
  partId: string;
  label: string;
  kind: Cladding;
  courses: number; // rows (or vertical boards)
  pieces: number; // strips to cut
  units: number; // individual shingles / boards visible
  totalLengthMm: number;
  exposureMm: number;
  stripHeightMm: number;
  materialKey: string;
}

export const PIECE_KINDS = new Set<Cladding>(["clapboard", "shingle", "fishscale", "boardbatten"]);

const SPEC = {
  clapboard: { e: 3.0, H: 4.5, W: 0 },
  shingle: { e: 3.2, H: 6.4, W: 4.0 },
  fishscale: { e: 2.8, H: 5.6, W: 3.6 },
  boardbatten: { e: 6.0, H: 0, W: 0 },
};
const MAX_LEN = 200; // longer strips are split so they fit sheets and are easy to handle

function rect(wasm: ManifoldToplevel, x0: number, y0: number, x1: number, y1: number) {
  return wasm.CrossSection.ofPolygons([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]);
}

/**
 * @param scale multiplies every course size (exposure, strip height, tile width). 1 = defaults
 *              (shingle 3.2 mm exposure × 4 mm tiles, clapboard 3 mm, board-and-batten 6 mm boards).
 */
export function claddingPieces(
  wasm: ManifoldToplevel, base: Panel, strip: { materialKey: string; t: number; method: Panel["method"] }, scale = 1,
): { base: Panel; strips: Panel[]; count: CladdingCount } | null {
  const kind = base.cladding;
  if (!kind || !PIECE_KINDS.has(kind)) return null;
  // Only the visible part of the face is clad (faces against another volume are skipped).
  const region = base.visible ?? base.cut;
  if (region.isEmpty() || region.area() < 10) return null;
  const b = region.bounds();
  const [u0, v0] = b.min, [u1, v1] = b.max;
  const strips: Panel[] = [];
  const guides: Poly[] = [];
  let units = 0, total = 0, courses = 0, seq = 0;
  const short = base.panelId.split("-").slice(-1)[0]; // e.g. P03
  const add = (piece: CrossSection, row: number, textAt: Pt, size: number) => {
    const pb = piece.bounds();
    // Split strips longer than MAX_LEN at even intervals.
    const len = pb.max[0] - pb.min[0];
    const n = Math.max(1, Math.ceil(len / MAX_LEN));
    for (let k = 0; k < n; k++) {
      const part = n === 1 ? piece : piece.intersect(rect(wasm, pb.min[0] + (len * k) / n, pb.min[1] - 1, pb.min[0] + (len * (k + 1)) / n, pb.max[1] + 1));
      if (part.isEmpty() || part.area() < 2) continue;
      const qb = part.bounds();
      seq++;
      const tag = `${short} R${String(row).padStart(2, "0")}${String.fromCharCode(96 + Math.min(26, strips.filter((s) => s.label.includes(` R${String(row).padStart(2, "0")}`)).length + 1))}`;
      total += qb.max[0] - qb.min[0];
      strips.push({
        panelId: `${base.panelId}-C${String(seq).padStart(3, "0")}`, partId: base.partId,
        label: `${base.label} — ${kind} ${tag}`, materialKey: strip.materialKey, thicknessMm: strip.t, method: strip.method,
        cut: part, engrave: [], score: [],
        // Label sits in the overlap zone, so it is hidden by the next course once glued.
        text: [{ at: [(qb.min[0] + qb.max[0]) / 2, textAt[1]], text: tag, size }],
        place: null, notes: [], cladding: "none",
      });
    }
  };

  if (kind === "boardbatten") {
    const e = SPEC.boardbatten.e * scale;
    for (let u = u0, i = 1; u < u1 - 0.5; u += e, i++) {
      const band = region.intersect(rect(wasm, u, v0 - 1, Math.min(u + e - 0.15, u1), v1 + 1));
      for (const piece of band.decompose()) if (piece.area() > 2) { add(piece, i, [0, (piece.bounds().min[1] + piece.bounds().max[1]) / 2], 1.2); units++; }
      if (u > u0) guides.push([[u, v0], [u, v1]]);
      courses++;
    }
    // Battens over every joint.
    for (let u = u0 + e, i = 1; u < u1 - 0.5; u += e, i++) {
      const band = region.intersect(rect(wasm, u - 0.7, v0 - 1, u + 0.7, v1 + 1));
      for (const piece of band.decompose()) if (piece.area() > 1) { add(piece, 100 + i, [0, (piece.bounds().min[1] + piece.bounds().max[1]) / 2], 0.6); }
    }
  } else {
    const sp = SPEC[kind as "clapboard" | "shingle" | "fishscale"];
    const e = sp.e * scale, H = sp.H * scale, W = sp.W * scale;
    for (let v = v0, row = 1; v < v1 - 0.4; v += e, row++) {
      let band = region.intersect(rect(wasm, u0 - 1, v, u1 + 1, Math.min(v + H, v1 + 1)));
      if (band.isEmpty()) continue;
      courses++;
      if (v > v0) guides.push([[u0, v], [u1, v]]);
      const off = row % 2 === 0 ? W / 2 : 0;
      if (kind === "shingle") {
        // Slits between tiles, from the bottom edge up 85 % of the exposure.
        const slits: CrossSection[] = [];
        for (let u = u0 + off + W; u < u1; u += W) slits.push(rect(wasm, u - 0.25, v - 1, u + 0.25, v + e * 0.85));
        if (slits.length) band = band.subtract(wasm.CrossSection.union(slits));
      }
      if (kind === "fishscale") {
        // Scalloped bottom edge: round tabs of radius W/2.
        const R = W / 2;
        const scallops: CrossSection[] = [rect(wasm, u0 - 1, v + R, u1 + 1, v + H)];
        for (let u = u0 + off + R; u < u1 + R; u += W) scallops.push(wasm.CrossSection.circle(R, 16).translate([u, v + R]));
        band = band.intersect(wasm.CrossSection.union(scallops));
      }
      for (const piece of band.decompose()) {
        if (piece.area() < 2) continue;
        const pb = piece.bounds();
        units += W ? Math.max(1, Math.round((pb.max[0] - pb.min[0]) / W)) : 1;
        add(piece, row, [0, Math.min(pb.max[1] - 0.4, v + e + (H - e) / 2)], Math.min(1.2, (H - e) * 0.7));
      }
    }
  }

  // Guide lines on the base panel: where each course's bottom edge goes.
  const inside = region.offset(-0.8, "Miter", 2).toPolygons().map((q) => q.map((p) => [p[0], p[1]] as Pt));
  const newBase: Panel = { ...base, engrave: [...base.engrave, ...clipLines(guides, inside, 0.4, true)], cladding: "none" };
  const spec = SPEC[kind as keyof typeof SPEC];
  return {
    base: newBase,
    strips,
    count: {
      panelId: base.panelId, partId: base.partId, label: base.label, kind, courses, pieces: strips.length, units,
      totalLengthMm: Math.round(total), exposureMm: +(spec.e * scale).toFixed(2), stripHeightMm: +(spec.H * scale).toFixed(2), materialKey: strip.materialKey,
    },
  };
}
