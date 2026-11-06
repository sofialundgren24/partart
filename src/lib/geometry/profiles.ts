// 2D profiles shared by every pipeline (solid preview, 3D print, laser, paper), so an arched window, a railing
// or a bracket has exactly the same outline whether it is printed or cut.
// Profiles live in an (a, b) plane: a = width (local X, centred), b = height (local Z, base at 0).

import type { ManifoldToplevel, Mat4, SimplePolygon } from "manifold-3d";
import type { CrossSection, Manifold } from "./kernel";
import type { OrnamentKind } from "./types";

type Pt = [number, number];

export function cs(wasm: ManifoldToplevel, polys: Pt[][]): CrossSection {
  return wasm.CrossSection.ofPolygons(polys as unknown as SimplePolygon[], "NonZero");
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 24): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** Vertices of a regular n-gon with circumradius r and one flat face towards -Y (counter-clockwise). */
export function ngonPoints(n: number, r: number): Pt[] {
  return Array.from({ length: n }, (_, k) => {
    const a = -Math.PI / 2 - Math.PI / n + (2 * Math.PI * k) / n;
    return [r * Math.cos(a), r * Math.sin(a)] as Pt;
  });
}

/** Outline of a window/door opening: rectangle, round (semicircular) or pointed (equilateral gothic) arch. */
export function openingOutline(w: number, h: number, arch: string | undefined): Pt[] {
  const x0 = -w / 2, x1 = w / 2;
  if (arch === "round" && h > w / 2) {
    const spring = h - w / 2;
    return [[x0, 0], [x1, 0], [x1, spring], ...arc(0, spring, w / 2, 0, Math.PI, 28).slice(1, -1), [x0, spring]];
  }
  if (arch === "pointed" && h > w * 0.87) {
    const spring = h - w * Math.sqrt(3) / 2;
    const right = arc(x0, spring, w, 0, Math.PI / 3, 14); // from the right springing point up to the apex
    const left = arc(x1, spring, w, (2 * Math.PI) / 3, Math.PI, 14);
    return [[x0, 0], [x1, 0], ...right, ...left.slice(1)];
  }
  return [[x0, 0], [x1, 0], [x1, h], [x0, h]];
}

export function openingSection(wasm: ManifoldToplevel, w: number, h: number, arch?: string) {
  return cs(wasm, [openingOutline(w, h, arch)]);
}

/** Window/door frame: border ring around the opening plus muntin bars inside the aperture. */
export function frameSection(wasm: ManifoldToplevel, w: number, h: number, arch: string | undefined, border: number, lip: number, grid?: [number, number]) {
  const hole = openingSection(wasm, w, h, arch);
  const outer = hole.offset(border, "Round", 2, 24);
  const aperture = hole.offset(-lip, "Round", 2, 24);
  let frame = outer.subtract(aperture);
  if (grid && (grid[0] > 1 || grid[1] > 1)) {
    const bar = Math.max(1, Math.min(w, h) * 0.06);
    const bars: Pt[][] = [];
    for (let i = 1; i < grid[0]; i++) { const x = -w / 2 + (w * i) / grid[0]; bars.push([[x - bar / 2, -1], [x + bar / 2, -1], [x + bar / 2, h + 1], [x - bar / 2, h + 1]]); }
    for (let j = 1; j < grid[1]; j++) { const z = (h * j) / grid[1]; bars.push([[-w / 2 - 1, z - bar / 2], [w / 2 + 1, z - bar / 2], [w / 2 + 1, z + bar / 2], [-w / 2 - 1, z + bar / 2]]); }
    frame = frame.add(cs(wasm, bars).intersect(aperture.offset(0.3)));
  }
  return frame;
}

/** Balustrade: top and bottom rail with balusters (real fretwork, one piece). */
export function railingSection(wasm: ManifoldToplevel, w: number, h: number) {
  const rail = Math.max(1.5, h * 0.12);
  const target = Math.max(3.5, h * 0.22);
  const n = Math.max(1, Math.round((w - 2 * rail) / target));
  const pitch = (w - 2 * rail) / n;
  const gap = pitch * 0.6;
  const holes: Pt[][] = [];
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + rail + pitch * (i + 0.5);
    if (gap < 0.8 || h - 2 * rail < 2) break;
    holes.push([[cx - gap / 2, rail], [cx + gap / 2, rail], [cx + gap / 2, h - rail], [cx - gap / 2, h - rail]]);
  }
  return cs(wasm, [[[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]]]).subtract(cs(wasm, holes.length ? holes : [[[0, 0], [0.001, 0], [0, 0.001]]]));
}

/** Gingerbread trim. All flat kinds are single laser-cuttable pieces. */
export function ornamentSection(wasm: ManifoldToplevel, kind: OrnamentKind, w: number, h: number): CrossSection {
  const C = wasm.CrossSection;
  switch (kind) {
    case "bracket": {
      // Right-angle bracket (wall on the left edge, eave on the top edge), curved underside and a round piercing.
      const curve: Pt[] = Array.from({ length: 19 }, (_, i) => {
        const a = Math.PI / 2 + (Math.PI / 2) * ((i + 1) / 20);
        return [w / 2 + w * Math.cos(a), 0.82 * h * Math.sin(a)];
      });
      const outline: Pt[] = [[-w / 2, h], [w / 2, h], [w / 2, h * 0.82], ...curve, [-w / 2, 0]];
      const pierce = C.circle(Math.min(w, h) * 0.13, 24).translate([-w / 2 + w * 0.3, h * 0.68]);
      return cs(wasm, [outline]).subtract(pierce);
    }
    case "spandrel": {
      // Porch frieze: band with a row of round piercings and scalloped lower edge.
      const band = cs(wasm, [[[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]]]);
      const n = Math.max(2, Math.round(w / (h * 1.2)));
      const pitch = w / n;
      const cuts: CrossSection[] = [];
      for (let i = 0; i < n; i++) {
        const cx = -w / 2 + pitch * (i + 0.5);
        cuts.push(C.circle(Math.min(pitch, h) * 0.22, 20).translate([cx, h * 0.6]));
        cuts.push(C.circle(pitch * 0.42, 24).scale([1, Math.min(1, (h * 0.35) / (pitch * 0.42))]).translate([cx, 0]));
      }
      return band.subtract(C.union(cuts));
    }
    case "gablefan": {
      // Triangular gable ornament (king post + sunburst piercings) matching a gable of width w and height h.
      const tri = cs(wasm, [[[-w / 2, 0], [w / 2, 0], [0, h]]]);
      const inner = tri.offset(-Math.max(1.2, h * 0.08), "Miter", 2);
      const post = cs(wasm, [[[-Math.max(0.8, w * 0.02), 0], [Math.max(0.8, w * 0.02), 0], [Math.max(0.8, w * 0.02), h], [-Math.max(0.8, w * 0.02), h]]]);
      const rays: CrossSection[] = [];
      for (let k = 1; k < 6; k++) {
        const a = (Math.PI * k) / 6;
        const len = h;
        const t = Math.max(0.6, w * 0.012);
        rays.push(cs(wasm, [[[-t, 0], [t, 0], [t, len], [-t, len]]]).rotate(90 - (a * 180) / Math.PI));
      }
      const hub = C.circle(Math.max(1.5, h * 0.12), 24);
      return tri.subtract(inner).add(inner.offset(0.3, "Miter", 2).intersect(C.union([post, hub, ...rays])));
    }
    case "cresting": {
      // Roof-ridge cresting: rail with a row of spear points.
      const rail = Math.max(1, h * 0.3);
      const n = Math.max(2, Math.round(w / (h * 0.8)));
      const pitch = w / n;
      const spikes: Pt[][] = Array.from({ length: n }, (_, i) => {
        const cx = -w / 2 + pitch * (i + 0.5);
        return [[cx - pitch * 0.18, rail - 0.1], [cx + pitch * 0.18, rail - 0.1], [cx, h]] as Pt[];
      });
      return cs(wasm, [[[-w / 2, 0], [w / 2, 0], [w / 2, rail], [-w / 2, rail]], ...spikes]);
    }
    case "finial": {
      // Flat silhouette of a turned finial (used for laser cross-slotted finials and for revolving).
      return cs(wasm, [finialHalf(w, h).concat(finialHalf(w, h).map(([x, y]) => [-x, y] as Pt).reverse())]);
    }
  }
}

/** Right half of a finial silhouette (x ≥ 0), from the base up. */
export function finialHalf(w: number, h: number): Pt[] {
  const r = w / 2;
  return [[0.001, 0], [r * 0.9, 0], [r * 0.9, h * 0.08], [r * 0.5, h * 0.12], [r * 0.55, h * 0.3], [r, h * 0.42], [r * 0.95, h * 0.5], [r * 0.35, h * 0.58], [r * 0.25, h * 0.75], [r * 0.45, h * 0.82], [r * 0.15, h * 0.9], [0.001, h]];
}

/** Extrude an (a, b) profile into a slab of thickness d centred on local Y: a → X, b → Z. */
export function extrudeXZ(wasm: ManifoldToplevel, section: CrossSection, d: number): Manifold {
  const m: Mat4 = [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, -d / 2, 0, 1];
  return wasm.Manifold.extrude(section, d).transform(m);
}

export function stairsSolid(wasm: ManifoldToplevel, w: number, d: number, h: number, steps: number): Manifold {
  const parts: Manifold[] = [];
  for (let i = 0; i < steps; i++) {
    const y0 = -d / 2 + (d * i) / steps;
    const sh = (h * (i + 1)) / steps;
    parts.push(wasm.Manifold.cube([w, d / 2 - y0, sh], false).translate([-w / 2, y0, 0]));
  }
  return wasm.Manifold.union(parts);
}
