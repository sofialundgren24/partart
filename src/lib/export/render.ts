// Tiny isometric renderer (painter's algorithm, flat Lambert shading) used for PDF assembly diagrams and
// SVG previews. It renders the real generated geometry; no illustration is faked.

import type { MeshData, Vec3 } from "../geometry/types";

export interface RenderItem {
  id: string;
  mesh: MeshData;
  color: string;
  offset?: Vec3; // exploded-view displacement
  style?: "normal" | "ghost" | "highlight";
  /** Paint downward-facing faces steeper than 45° (excluding the bed contact) in a warning colour. */
  overhangs?: boolean;
}

export interface Tri2D {
  pts: [number, number][];
  fill: string;
  opacity: number;
  stroke?: string;
  depth: number;
  id: string;
}

export type ViewDir = "top" | "bottom";
function camera(view: ViewDir) {
  const CAM: Vec3 = norm(view === "top" ? [1.1, -1.4, 1.0] : [1.1, -1.4, -0.9]); // front-right, from above or below
  const RIGHT: Vec3 = norm(cross([0, 0, 1], CAM).map((x) => -x) as Vec3);
  const UP: Vec3 = cross(CAM, RIGHT).map((x) => -x) as Vec3;
  return { CAM, RIGHT, UP };
}
const LIGHT: Vec3 = norm([0.4, -0.6, 1]);

function norm(v: Vec3): Vec3 { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a: Vec3, b: Vec3) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function shade(hex: string, k: number) {
  const h = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, "0")).join("");
}

export function project(items: RenderItem[], view: ViewDir = "top"): { tris: Tri2D[]; bounds: { minX: number; minY: number; maxX: number; maxY: number } } {
  const { CAM, RIGHT, UP } = camera(view);
  const tris: Tri2D[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of items) {
    const P = it.mesh.positions, I = it.mesh.indices;
    const off = it.offset ?? [0, 0, 0];
    let minZ = Infinity;
    if (it.overhangs) for (let i = 2; i < P.length; i += 3) minZ = Math.min(minZ, P[i]);
    for (let t = 0; t < I.length; t += 3) {
      const v = [I[t], I[t + 1], I[t + 2]].map((i) => [P[i * 3] + off[0], P[i * 3 + 1] + off[1], P[i * 3 + 2] + off[2]] as Vec3);
      const n = norm(cross([v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]]));
      if (dot(n, CAM) <= 0) continue; // back face
      const lam = 0.55 + 0.45 * Math.max(0, dot(n, LIGHT));
      const pts = v.map((p) => [dot(p, RIGHT), -dot(p, UP)] as [number, number]);
      for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      const ghost = it.style === "ghost";
      const over = it.overhangs && n[2] < -0.7071 && Math.max(v[0][2], v[1][2], v[2][2]) - off[2] - minZ > 0.05;
      tris.push({
        pts,
        fill: ghost ? "#d9d4cc" : shade(over ? "#ff3b6b" : it.color, lam),
        opacity: ghost ? 0.35 : 1,
        stroke: it.style === "highlight" ? "#e8553f" : undefined,
        depth: (dot(v[0], CAM) + dot(v[1], CAM) + dot(v[2], CAM)) / 3,
        id: it.id,
      });
    }
  }
  tris.sort((a, b) => a.depth - b.depth);
  return { tris, bounds: { minX, minY, maxX, maxY } };
}

export function renderSvg(items: RenderItem[], width = 640, height = 480, view: ViewDir = "top"): string {
  const { tris, bounds } = project(items, view);
  const bw = bounds.maxX - bounds.minX || 1, bh = bounds.maxY - bounds.minY || 1;
  const s = Math.min((width - 40) / bw, (height - 40) / bh);
  const ox = (width - bw * s) / 2 - bounds.minX * s, oy = (height - bh * s) / 2 - bounds.minY * s;
  const parts = tris.map((t) => {
    const d = t.pts.map((p, i) => `${i ? "L" : "M"}${(p[0] * s + ox).toFixed(1)} ${(p[1] * s + oy).toFixed(1)}`).join("") + "Z";
    return `<path d="${d}" fill="${t.fill}" fill-opacity="${t.opacity}" stroke="${t.stroke ?? t.fill}" stroke-width="${t.stroke ? 0.6 : 0.3}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${parts.join("")}</svg>`;
}

/** Explode offsets: push each item away from the assembly centre along the vector to its own centre. */
export function explodeOffsets(items: { id: string; mesh: MeshData }[], factor = 0.6): Map<string, Vec3> {
  const centre = (m: MeshData): Vec3 => {
    const c: Vec3 = [0, 0, 0];
    const n = m.positions.length / 3 || 1;
    for (let i = 0; i < m.positions.length; i += 3) { c[0] += m.positions[i]; c[1] += m.positions[i + 1]; c[2] += m.positions[i + 2]; }
    return [c[0] / n, c[1] / n, c[2] / n];
  };
  const cs = items.map((it) => ({ id: it.id, c: centre(it.mesh) }));
  const all: Vec3 = [0, 0, 0];
  cs.forEach(({ c }) => { all[0] += c[0] / cs.length; all[1] += c[1] / cs.length; all[2] += c[2] / cs.length; });
  const out = new Map<string, Vec3>();
  for (const { id, c } of cs) out.set(id, [(c[0] - all[0]) * factor, (c[1] - all[1]) * factor, (c[2] - all[2]) * factor]);
  return out;
}
