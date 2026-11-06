// Sheet-material pipeline: component → flat panels with joints, openings, labels and 3D placement.
// Supported decompositions (each is exact for its primitive family, not a visual approximation):
//   box       → finger-jointed walls + floor (+ lid) with tab-and-slot connections, or stacked plates when thin
//   gable     → two inset gable ends + two roof slopes with engraved alignment lines
//   wedge     → two side triangles + slope + back
//   cylinder/cone/ellipsoid → stacked layered slices with a central alignment-dowel hole
//   opening   → clear pane (transparent sheet) or flat frame (opaque sheet)
// Paper/cardboard nets: box → cross net with glue tabs; gable → strip net; cylinder → wrap + discs; others → layered.

import type { ManifoldToplevel, Mat4, SimplePolygon } from "manifold-3d";
import type { CrossSection, Manifold } from "../geometry/kernel";
import { toLocal } from "../geometry/transform";
import { isDoor, primitiveSize, type Cladding, type ComponentSpec, type OrnamentKind, type Vec3 } from "../geometry/types";
import { finialHalf, frameSection, ngonPoints, openingSection, ornamentSection, railingSection } from "../geometry/profiles";
import { material } from "../materials/catalog";
import type { ResolvedPart } from "./resolve";
import { FRAME } from "./print";

export type Pt = [number, number];
export type Poly = Pt[];

export interface Panel {
  panelId: string; // e.g. C-WALL-01-P03 — engraved on the part
  partId: string;
  label: string;
  materialKey: string;
  thicknessMm: number;
  method: "laser" | "paper" | "cardboard";
  /** Cut geometry before kerf compensation (outer contours + holes). */
  cut: CrossSection;
  engrave: Poly[]; // open polylines
  score: Poly[]; // fold lines (paper/cardboard)
  text: { at: Pt; text: string; size: number }[];
  /** Panel-plane → component-local placement: origin + u, v axes + thickness direction. Null for nets (folded). */
  place: { origin: Vec3; u: Vec3; v: Vec3; w: Vec3 } | null;
  notes: string[];
  /** Surface pattern engraved on the outer (+w, top-of-sheet) face, added after trimming. */
  cladding?: Cladding;
}

export interface PanelResult {
  panels: Panel[];
  notes: string[];
  warnings: string[];
}

export interface PanelContext {
  wasm: ManifoldToplevel;
  /** Child openings of a part (with their own resolved method/material). */
  openingsOf: (partId: string) => ResolvedPart[];
  /** false = butt joints everywhere ("easy" difficulty / hand cutting). */
  fingers?: boolean;
  /** Sheet used for window frames that accompany glazed panes (null = no frame). */
  frameMaterial?: { key: string; t: number } | null;
  /** Sheet/wall thickness of a part (used to seat panes behind their wall). */
  parentThickness?: (partId: string) => number;
}

const OVERLAP = 3; // pane overlap beyond the wall opening on each side (mm)

export function rect(x0: number, y0: number, x1: number, y1: number): Poly {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

function cs(wasm: ManifoldToplevel, polys: Poly[]): CrossSection {
  return wasm.CrossSection.ofPolygons(polys as unknown as SimplePolygon[], "NonZero");
}

function oddCount(len: number, target: number) {
  let n = Math.max(3, Math.floor(len / target));
  if (n % 2 === 0) n -= 1;
  return Math.max(3, n);
}

let panelSeq = 0;
function pid(partId: string) {
  panelSeq++;
  return `${partId}-P${String(panelSeq).padStart(2, "0")}`;
}

export function panelsFor(ctx: PanelContext, part: ResolvedPart): PanelResult {
  panelSeq = 0;
  const c = part.comp;
  const mat = material(part.materialKey);
  const t = mat.thicknessMm ?? 3;
  const method = (part.method === "laser" || part.method === "paper" || part.method === "cardboard" ? part.method : "laser") as Panel["method"];
  const p = c.primitive;

  if (c.role === "opening" && p.type === "box") return openingPanels(ctx, part, t, method);
  if (method === "paper" && (p.type === "box" || p.type === "gable" || p.type === "cylinder" || p.type === "ngon" || p.type === "pyramid")) return paperNet(ctx, part, t);

  const size = primitiveSize(p);
  const clad = "cladding" in p ? p.cladding : undefined;
  let r: PanelResult;
  switch (p.type) {
    case "box": {
      if (Math.min(...size) < 3 * t || Math.min(p.w, p.d) < 6 * t) r = layeredBox(ctx, part, t, method);
      else r = boxPanels(ctx, part, t, method, method === "laser" && ctx.fingers !== false);
      break;
    }
    case "gable": r = gablePanels(ctx, part, t, method); break;
    case "wedge": r = wedgePanels(ctx, part, t, method); break;
    case "hip": {
      const rr = Math.abs(p.w - p.d) / 2;
      const c0: Vec3 = [-p.w / 2, -p.d / 2, 0], c1: Vec3 = [p.w / 2, -p.d / 2, 0], c2: Vec3 = [p.w / 2, p.d / 2, 0], c3: Vec3 = [-p.w / 2, p.d / 2, 0];
      const faces: Vec3[][] = p.w >= p.d
        ? [[c0, c1, [rr, 0, p.h], [-rr, 0, p.h]], [c1, c2, [rr, 0, p.h]], [c2, c3, [-rr, 0, p.h], [rr, 0, p.h]], [c3, c0, [-rr, 0, p.h]]]
        : [[c0, c1, [0, -rr, p.h]], [c1, c2, [0, rr, p.h], [0, -rr, p.h]], [c2, c3, [0, rr, p.h]], [c3, c0, [0, -rr, p.h], [0, rr, p.h]]];
      r = facePanels(ctx, part, t, method, faces, ["front slope", "right hip", "back slope", "left hip"]);
      r.notes.push("Hip roof: the four slopes meet at hips — sand a bevel on the meeting edges or cover them with thin hip strips.");
      break;
    }
    case "pyramid": {
      const P = ngonPoints(p.n, p.r);
      const faces: Vec3[][] = P.map((a, k) => [[a[0], a[1], 0], [P[(k + 1) % p.n][0], P[(k + 1) % p.n][1], 0], [0, 0, p.h]] as Vec3[]);
      r = facePanels(ctx, part, t, method, faces, P.map((_, k) => `face ${k + 1}/${p.n}`));
      const pitch = (Math.atan2(p.h, p.r * Math.cos(Math.PI / p.n)) * 180) / Math.PI;
      r.notes.push(`${p.n}-sided spire (pitch ${pitch.toFixed(0)}°): tape the triangles edge to edge on the outside, fold into shape and glue from inside; sand a small bevel where they meet.`);
      break;
    }
    case "ngon": r = ngonPanels(ctx, part, t, method); break;
    case "stairs": r = stairsPanels(ctx, part, t, method); break;
    case "railing":
      r = flatPiece(ctx, part, t, method, railingSection(ctx.wasm, p.w, p.h), "railing");
      r.notes.push("One-piece fretwork railing: glue it between the posts with the bottom rail on the floor.");
      break;
    case "ornament":
      r = p.kind === "finial" ? finialPanels(ctx, part, t, method) : flatPiece(ctx, part, t, method, ornamentSection(ctx.wasm, p.kind as OrnamentKind, p.w, p.h), p.kind);
      break;
    case "cylinder":
    case "ellipsoid":
      r = layeredRound(ctx, part, t, method); break;
    case "mesh":
      return { panels: [], notes: [], warnings: [`${c.partId}: imported meshes cannot be converted to flat sheet parts yet — assign 3D printing instead.`] };
  }
  if (clad && clad !== "none") for (const pn of r.panels) if (pn.cladding === undefined) pn.cladding = clad;
  return r;
}

// ---------------- box: finger-jointed walls + floor ----------------

function boxPanels(ctx: PanelContext, part: ResolvedPart, t: number, method: Panel["method"], fingers: boolean): PanelResult {
  const { wasm } = ctx;
  const c = part.comp;
  const p = c.primitive as { w: number; d: number; h: number };
  const { w, d, h } = p;
  const closedTop = c.role !== "shell"; // shells are open at the top (roof sits on them)
  const hw = h - t - (closedTop ? t : 0); // wall height between floor and lid
  const notes: string[] = [];
  const warnings: string[] = [];
  const nF = oddCount(hw, Math.max(2 * t, 8));
  const seg = hw / nF;
  const tabW = (span: number) => Math.min(15, Math.max(4, span / 5));

  // Corner notches: front/back keep even segments in the corner zones, sides keep odd segments.
  const cornerNotches = (len: number, keepEven: boolean): Poly[] => {
    if (!fingers) return keepEven ? [] : [rect(0, 0, t, hw), rect(len - t, 0, len, hw)];
    const out: Poly[] = [];
    for (let i = 0; i < nF; i++) {
      const isEven = i % 2 === 0;
      if (isEven === keepEven) continue;
      out.push(rect(-0.01, i * seg, t, (i + 1) * seg), rect(len - t, i * seg, len + 0.01, (i + 1) * seg));
    }
    return out;
  };
  // Tabs along bottom (and top) edges, avoiding the corner zones.
  const edgeTabs = (len: number): { polys: Poly[]; centres: number[]; width: number } => {
    const tw = tabW(len - 2 * t);
    const centres = [t + (len - 2 * t) * 0.25, t + (len - 2 * t) * 0.75];
    const polys: Poly[] = [];
    for (const cx of centres) {
      polys.push(rect(cx - tw / 2, -t, cx + tw / 2, 0.01));
      if (closedTop) polys.push(rect(cx - tw / 2, hw - 0.01, cx + tw / 2, hw + t));
    }
    return { polys, centres, width: tw };
  };

  type WallDef = { name: string; len: number; keepEven: boolean; origin: Vec3; u: Vec3; w: Vec3; face: "front" | "back" | "left" | "right" };
  const walls: WallDef[] = [
    // Outer face is +w (the face that is up on the sheet), so engraved cladding ends up outside.
    { name: "front wall", len: w, keepEven: true, origin: [-w / 2, -d / 2 + t, t], u: [1, 0, 0], w: [0, -1, 0], face: "front" },
    { name: "back wall", len: w, keepEven: true, origin: [-w / 2, d / 2 - t, t], u: [1, 0, 0], w: [0, 1, 0], face: "back" },
    { name: "left wall", len: d, keepEven: false, origin: [-w / 2 + t, -d / 2, t], u: [0, 1, 0], w: [-1, 0, 0], face: "left" },
    { name: "right wall", len: d, keepEven: false, origin: [w / 2 - t, -d / 2, t], u: [0, 1, 0], w: [1, 0, 0], face: "right" },
  ];
  const panels: Panel[] = [];
  const floorSlots: Poly[] = [];
  for (const wd of walls) {
    let body = cs(wasm, [rect(0, 0, wd.len, hw)]);
    const notches = cornerNotches(wd.len, wd.keepEven);
    if (notches.length) body = body.subtract(cs(wasm, notches));
    const tabs = edgeTabs(wd.len);
    body = body.add(cs(wasm, tabs.polys));
    // Matching slots in the floor/lid (in floor coordinates: origin at (-w/2, -d/2)).
    for (const cx of tabs.centres) {
      const half = tabs.width / 2;
      if (wd.face === "front") floorSlots.push(rect(cx - half, 0, cx + half, t));
      if (wd.face === "back") floorSlots.push(rect(cx - half, d - t, cx + half, d));
      if (wd.face === "left") floorSlots.push(rect(0, cx - half, t, cx + half));
      if (wd.face === "right") floorSlots.push(rect(w - t, cx - half, w, cx + half));
    }
    // Openings are cut later in 3D (works for arches and for any parent shape).
    panels.push({
      panelId: pid(c.partId),
      partId: c.partId,
      label: `${c.name} — ${wd.name}`,
      materialKey: part.materialKey,
      thicknessMm: t,
      method,
      cut: body,
      engrave: [],
      score: [],
      text: [{ at: [wd.len / 2, hw * 0.12 + 2], text: "", size: 3 }],
      place: { origin: wd.origin, u: wd.u, v: [0, 0, 1], w: wd.w },
      notes: [],
    });
  }
  const plate = (name: string, z: number): Panel => {
    let body = cs(wasm, [rect(0, 0, w, d)]);
    body = body.subtract(cs(wasm, floorSlots));
    return {
      panelId: pid(c.partId),
      partId: c.partId,
      label: `${c.name} — ${name}`,
      materialKey: part.materialKey,
      thicknessMm: t,
      method,
      cut: body,
      // Alignment marks: inner outline of the walls.
      engrave: [[[t, t], [w - t, t], [w - t, d - t], [t, d - t], [t, t]]],
      score: [],
      text: [{ at: [w / 2, d / 2], text: "", size: 3 }],
      place: { origin: [-w / 2, -d / 2, z], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] },
      notes: [],
      cladding: "none",
    };
  };
  panels.push(plate("floor", 0));
  if (closedTop) panels.push(plate("lid", h - t));
  for (const pnl of panels) pnl.text[0].text = pnl.panelId;
  notes.push(
    fingers
      ? `Finger joints: ${nF} fingers of ${seg.toFixed(1)} mm per corner, sized for ${t} mm stock. Wall tabs drop into open slots in the floor${closedTop ? " and lid" : ""}.`
      : `Butt-jointed corners (hand-cut friendly); wall tabs locate in the floor slots.`,
  );
  if (hw < 2 * t) warnings.push(`${c.partId}: walls are only ${hw.toFixed(1)} mm tall — consider layered plates.`);
  return { panels, notes, warnings };
}

/** Rectangle (in wall-panel coordinates) for an opening on a given face of a box, or null if it is on another face. */
function openingOnFace(box: ComponentSpec, op: ComponentSpec, face: "front" | "back" | "left" | "right", t: number): Poly | null {
  const p = box.primitive as { w: number; d: number; h: number };
  const o = op.primitive as { w: number; h: number };
  const centre = toLocal(op.position, box.rotation, box.position); // base-centre of the opening in box space
  const dist = {
    front: Math.abs(centre[1] + p.d / 2),
    back: Math.abs(centre[1] - p.d / 2),
    left: Math.abs(centre[0] + p.w / 2),
    right: Math.abs(centre[0] - p.w / 2),
  };
  const nearest = (Object.keys(dist) as (keyof typeof dist)[]).reduce((a, b) => (dist[a] <= dist[b] ? a : b));
  if (nearest !== face) return null;
  const along = face === "front" || face === "back" ? centre[0] + p.w / 2 : centre[1] + p.d / 2;
  const z0 = centre[2] - t; // panel v = 0 sits on top of the floor
  return rect(along - o.w / 2, z0, along + o.w / 2, z0 + o.h);
}

// ---------------- openings ----------------

function openingPanels(ctx: PanelContext, part: ResolvedPart, t: number, method: Panel["method"]): PanelResult {
  const { wasm } = ctx;
  const c = part.comp;
  const p = c.primitive as { w: number; d: number; h: number; arch?: string; grid?: [number, number] };
  const mat = material(part.materialKey);
  const door = isDoor(c);
  if (mat.transparent || door) {
    // Pane / door leaf: the opening outline grown by the overlap, glued behind the wall (local +Y is inside).
    const leaf = openingSection(wasm, p.w, p.h, p.arch).offset(OVERLAP, "Round", 2, 24);
    const engrave: Poly[] = [];
    if (door) {
      // Raised-panel lines on the leaf (two panels), engraved on the visible face.
      const iw = p.w * 0.34, x1 = -p.w * 0.06, x0 = -p.w * 0.4;
      for (const [y0, y1] of [[p.h * 0.1, p.h * 0.42], [p.h * 0.5, p.h * 0.85]])
        for (const xo of [x0, x1 + p.w * 0.12]) engrave.push([[xo, y0], [xo + iw, y0], [xo + iw, y1], [xo, y1], [xo, y0]]);
    }
    return {
      panels: [{
        panelId: pid(c.partId), partId: c.partId, label: `${c.name} — ${door ? "door leaf" : "pane"}`, materialKey: part.materialKey, thicknessMm: t, method,
        cut: leaf, engrave, score: [], text: [{ at: [0, -OVERLAP + 1.5], text: c.partId, size: 1.6 }],
        // Visible face (+w) looks out through the opening (-Y).
        place: { origin: [0, (c.parentPartId && ctx.parentThickness ? ctx.parentThickness(c.parentPartId) : 3) + t, 0], u: [1, 0, 0], v: [0, 0, 1], w: [0, -1, 0] },
        notes: [`${door ? "Door leaf" : "Pane"} ${p.arch && p.arch !== "none" ? `(${p.arch} arch) ` : ""}glued behind the ${p.w.toFixed(1)} × ${p.h.toFixed(1)} mm opening, ${OVERLAP} mm overlap all round.`],
        cladding: "none",
      }, ...(!door && ctx.frameMaterial ? [{
        panelId: pid(c.partId), partId: c.partId, label: `${c.name} — frame`, materialKey: ctx.frameMaterial.key, thicknessMm: ctx.frameMaterial.t, method,
        cut: frameSection(wasm, p.w, p.h, p.arch, FRAME.border, FRAME.lip, p.grid), engrave: [], score: [], text: [],
        place: { origin: [0, 0, 0] as Vec3, u: [1, 0, 0] as Vec3, v: [0, 0, 1] as Vec3, w: [0, -1, 0] as Vec3 },
        notes: ["Frame glued on the outside face around the opening (paint it before gluing)."], cladding: "none" as Cladding,
      }] : [])],
      notes: [], warnings: [],
    };
  }
  const body = frameSection(wasm, p.w, p.h, p.arch, FRAME.border, FRAME.lip, p.grid);
  return {
    panels: [{
      panelId: pid(c.partId), partId: c.partId, label: `${c.name} — frame`, materialKey: part.materialKey, thicknessMm: t, method,
      cut: body, engrave: [], score: [], text: [],
      place: { origin: [0, -p.d / 2, 0], u: [1, 0, 0], v: [0, 0, 1], w: [0, -1, 0] },
      notes: [`Frame${p.grid ? ` with ${p.grid[0]}×${p.grid[1]} muntins` : ""} glued over the opening from outside; overlaps the hole by ${FRAME.lip} mm.`],
      cladding: "none",
    }],
    notes: [], warnings: [],
  };
}

// ---------------- polyhedral faces (hip roofs, spires) ----------------

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot3(a: Vec3, b: Vec3) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross3(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function unit(a: Vec3): Vec3 { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

/**
 * One flat panel per outer face. Each face is given counter-clockwise as seen from outside, starting with its
 * bottom edge, so u runs left→right along the eave and v points up the slope. The outer face (+w) lies on the
 * modelled surface.
 */
function facePanels(ctx: PanelContext, part: ResolvedPart, t: number, method: Panel["method"], faces: Vec3[][], names: string[]): PanelResult {
  const c = part.comp;
  const panels: Panel[] = [];
  faces.forEach((f, i) => {
    const u = unit(sub(f[1], f[0]));
    const n = unit(cross3(sub(f[1], f[0]), sub(f[f.length - 1], f[0])));
    const v = cross3(n, u);
    const poly: Poly = f.map((pt) => { const d = sub(pt, f[0]); return [dot3(d, u), dot3(d, v)] as Pt; });
    const origin: Vec3 = [f[0][0] - n[0] * t, f[0][1] - n[1] * t, f[0][2] - n[2] * t];
    const id = pid(c.partId);
    const b = { x: poly.reduce((s, q) => s + q[0], 0) / poly.length, y: poly.reduce((s, q) => s + q[1], 0) / poly.length };
    panels.push({
      panelId: id, partId: c.partId, label: `${c.name} — ${names[i] ?? `face ${i + 1}`}`, materialKey: part.materialKey, thicknessMm: t, method,
      cut: cs(ctx.wasm, [poly]), engrave: [], score: [], text: [{ at: [b.x, b.y * 0.6], text: id, size: 2.5 }],
      place: { origin, u, v, w: n }, notes: [],
    });
  });
  return { panels, notes: [], warnings: [] };
}

// ---------------- n-gon towers ----------------

function ngonPanels(ctx: PanelContext, part: ResolvedPart, t: number, method: Panel["method"]): PanelResult {
  const { wasm } = ctx;
  const c = part.comp;
  const p = c.primitive as { n: number; r: number; h: number };
  const P = ngonPoints(p.n, p.r);
  const side = 2 * p.r * Math.sin(Math.PI / p.n);
  const closedTop = c.role !== "shell";
  const hw = p.h - t - (closedTop ? t : 0);
  const tw = Math.min(12, Math.max(3, side / 4));
  const panels: Panel[] = [];
  const slots: Poly[] = [];
  for (let k = 0; k < p.n; k++) {
    const a = P[k], b2 = P[(k + 1) % p.n];
    const u = unit([b2[0] - a[0], b2[1] - a[1], 0]);
    const n: Vec3 = [u[1], -u[0], 0]; // outward (polygon is CCW)
    let body = cs(wasm, [rect(0, 0, side, hw)]);
    const tabs: Poly[] = [rect(side / 2 - tw / 2, -t, side / 2 + tw / 2, 0.01)];
    if (closedTop) tabs.push(rect(side / 2 - tw / 2, hw - 0.01, side / 2 + tw / 2, hw + t));
    body = body.add(cs(wasm, tabs));
    // Slot in the base/top plate under this wall's tab.
    const mx = (a[0] + b2[0]) / 2 - n[0] * (t / 2), my = (a[1] + b2[1]) / 2 - n[1] * (t / 2);
    const hx = (u[0] * tw) / 2, hy = (u[1] * tw) / 2, nx = (n[0] * t) / 2, ny = (n[1] * t) / 2;
    slots.push([[mx - hx - nx, my - hy - ny], [mx + hx - nx, my + hy - ny], [mx + hx + nx, my + hy + ny], [mx - hx + nx, my - hy + ny]]);
    const id = pid(c.partId);
    panels.push({
      panelId: id, partId: c.partId, label: `${c.name} — wall ${k + 1}/${p.n}`, materialKey: part.materialKey, thicknessMm: t, method,
      cut: body, engrave: [], score: [], text: [{ at: [side / 2, Math.min(hw * 0.1 + 2, hw / 2)], text: id, size: Math.min(3, side / 8) }],
      place: { origin: [a[0] - n[0] * t, a[1] - n[1] * t, t], u, v: [0, 0, 1], w: n }, notes: [],
    });
  }
  const plate = (name: string, z: number): Panel => ({
    panelId: pid(c.partId), partId: c.partId, label: `${c.name} — ${name}`, materialKey: part.materialKey, thicknessMm: t, method,
    cut: cs(wasm, [P]).subtract(cs(wasm, slots)), engrave: [], score: [], text: [{ at: [0, 0], text: "", size: 3 }],
    place: { origin: [0, 0, z], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, notes: [], cladding: "none",
  });
  panels.push(plate("base plate", 0));
  if (closedTop) panels.push(plate("top plate", p.h - t));
  panels.forEach((pn) => { if (!pn.text[0].text) pn.text[0].text = pn.panelId; });
  const bevel = 180 / p.n;
  return {
    panels,
    notes: [`${p.n}-sided tower: each wall's tab drops into the base plate. Sand a ${bevel.toFixed(1)}° bevel on both vertical edges of every wall so neighbours meet cleanly (or fill the outside V-joints with filler).`],
    warnings: side < 4 * t ? [`${c.partId}: tower faces are only ${side.toFixed(1)} mm wide for ${t} mm stock — consider printing it.`] : [],
  };
}

// ---------------- stairs, flat pieces, finials ----------------

function stairsPanels(ctx: PanelContext, part: ResolvedPart, t: number, method: Panel["method"]): PanelResult {
  const c = part.comp;
  const p = c.primitive as { w: number; d: number; h: number; steps: number };
  const layers = Math.max(1, Math.round(p.h / t));
  const panels: Panel[] = [];
  for (let j = 0; j < layers; j++) {
    const z = (j + 0.5) * (p.h / layers);
    const i = Math.min(p.steps - 1, Math.floor((z * p.steps) / p.h));
    const y0 = -p.d / 2 + (p.d * i) / p.steps;
    const depth = p.d / 2 - y0;
    const id = pid(c.partId);
    panels.push({
      panelId: id, partId: c.partId, label: `${c.name} — layer ${j + 1}/${layers}`, materialKey: part.materialKey, thicknessMm: t, method,
      cut: cs(ctx.wasm, [rect(0, 0, p.w, depth)]), engrave: [], score: [], text: [{ at: [p.w / 2, depth / 2], text: id, size: Math.min(3, depth / 3) }],
      place: { origin: [-p.w / 2, y0, j * t], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] }, notes: [], cladding: "none",
    });
  }
  return { panels, notes: [`Stairs: ${layers} stacked layers of ${t} mm forming ${p.steps} steps — glue from the bottom up, keeping the back edges flush.`], warnings: [] };
}

function flatPiece(ctx: PanelContext, part: ResolvedPart, t: number, method: Panel["method"], section: CrossSection, what: string): PanelResult {
  const c = part.comp;
  const b = section.bounds();
  const id = pid(c.partId);
  return {
    panels: [{
      panelId: id, partId: c.partId, label: `${c.name} — ${what}`, materialKey: part.materialKey, thicknessMm: t, method,
      cut: section, engrave: [], score: [], text: [{ at: [(b.min[0] + b.max[0]) / 2, b.min[1] + 0.6], text: id, size: 1.4 }],
      place: { origin: [0, t / 2, 0], u: [1, 0, 0], v: [0, 0, 1], w: [0, -1, 0] }, notes: [], cladding: "none",
    }],
    notes: [], warnings: [],
  };
}

function finialPanels(ctx: PanelContext, part: ResolvedPart, t: number, method: Panel["method"]): PanelResult {
  // Two identical silhouettes with half-height slots, slid together at 90° — a classic flat-pack finial.
  const { wasm } = ctx;
  const c = part.comp;
  const p = c.primitive as { w: number; h: number };
  const half = finialHalf(p.w, p.h);
  const sil = cs(wasm, [half.concat(half.map(([x, y]) => [-x, y] as Pt).reverse())]);
  const slotTop = sil.subtract(cs(wasm, [rect(-t / 2, p.h / 2, t / 2, p.h + 1)]));
  const slotBottom = sil.subtract(cs(wasm, [rect(-t / 2, -1, t / 2, p.h / 2)]));
  const mk = (cut: CrossSection, name: string, u: Vec3, w: Vec3): Panel => ({
    panelId: pid(c.partId), partId: c.partId, label: `${c.name} — ${name}`, materialKey: part.materialKey, thicknessMm: t, method,
    cut, engrave: [], score: [], text: [], place: { origin: [-w[0] * t / 2, -w[1] * t / 2, 0], u, v: [0, 0, 1], w }, notes: [], cladding: "none",
  });
  return {
    panels: [mk(slotTop, "finial A (slot from top)", [1, 0, 0], [0, 1, 0]), mk(slotBottom, "finial B (slot from bottom)", [0, 1, 0], [-1, 0, 0])],
    notes: ["Finial: slide A down onto B through the slots to make a cross-shaped finial; glue."],
    warnings: [],
  };
}

// ---------------- layered constructions ----------------

function layeredBox(ctx: PanelContext, part: ResolvedPart, t: number, method: Panel["method"]): PanelResult {
  const { wasm } = ctx;
  const c = part.comp;
  const p = c.primitive as { w: number; d: number; h: number };
  const size: Vec3 = [p.w, p.d, p.h];
  const axis = size.indexOf(Math.min(...size));
  const n = Math.max(1, Math.round(size[axis] / t));
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  const panels: Panel[] = [];
  for (let i = 0; i < n; i++) {
    const origin: Vec3 = [-p.w / 2, -p.d / 2, 0];
    origin[axis] += i * t;
    const U: Vec3 = [0, 0, 0]; U[u] = 1;
    const V: Vec3 = [0, 0, 0]; V[v] = 1;
    const Wd: Vec3 = [0, 0, 0]; Wd[axis] = 1;
    const id = pid(c.partId);
    panels.push({
      panelId: id, partId: c.partId, label: `${c.name} — layer ${i + 1}/${n}`, materialKey: part.materialKey, thicknessMm: t, method,
      cut: cs(wasm, [rect(0, 0, size[u], size[v])]), engrave: [], score: [],
      text: [{ at: [size[u] / 2, size[v] / 2], text: id, size: Math.min(3, size[v] / 3) }],
      place: { origin, u: U, v: V, w: Wd }, notes: [],
    });
  }
  const notes = [`${n} stacked layer(s) of ${t} mm (${(n * t).toFixed(1)} mm vs. ${size[axis].toFixed(1)} mm modelled).`];
  return { panels, notes, warnings: [] };
}

function layeredRound(ctx: PanelContext, part: ResolvedPart, t: number, method: Panel["method"]): PanelResult {
  const { wasm } = ctx;
  const c = part.comp;
  const p = c.primitive;
  const h = p.h;
  const n = Math.max(1, Math.round(h / t));
  const panels: Panel[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < n; i++) {
    const zMid = ((i + 0.5) * h) / n;
    let rx: number, ry: number;
    if (p.type === "cylinder") {
      const r = p.r + ((p.rTop ?? p.r) - p.r) * (zMid / h);
      rx = ry = r;
    } else {
      const e = p as { w: number; d: number; h: number };
      const k = Math.sqrt(Math.max(0, 1 - Math.pow((zMid - h / 2) / (h / 2), 2)));
      rx = (e.w / 2) * k;
      ry = (e.d / 2) * k;
    }
    if (rx < 1 || ry < 1) continue;
    const segs = 96;
    const outline: Poly = [];
    for (let s = 0; s < segs; s++) {
      const a = (2 * Math.PI * s) / segs;
      outline.push([rx + rx * Math.cos(a), ry + ry * Math.sin(a)]);
    }
    let body = cs(wasm, [outline]);
    const dowel = Math.min(rx, ry) > 6;
    if (dowel) {
      const hole: Poly = [];
      for (let s = 0; s < 24; s++) {
        const a = (-2 * Math.PI * s) / 24;
        hole.push([rx + 1.5 * Math.cos(a), ry + 1.5 * Math.sin(a)]);
      }
      body = body.subtract(cs(wasm, [hole]));
    }
    const id = pid(c.partId);
    panels.push({
      panelId: id, partId: c.partId, label: `${c.name} — slice ${i + 1}/${n}`, materialKey: part.materialKey, thicknessMm: t, method,
      cut: body,
      engrave: dowel ? [] : [[[rx - 1, ry], [rx + 1, ry]], [[rx, ry - 1], [rx, ry + 1]]],
      score: [],
      text: rx > 8 ? [{ at: [rx, ry + Math.min(ry * 0.5, 6)], text: id, size: Math.min(3, ry / 4) }] : [],
      place: { origin: [-rx, -ry, i * t], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1] },
      notes: [],
    });
  }
  if (panels.length < 2) warnings.push(`${c.partId}: only ${panels.length} slice(s) — this part is thinner than about two sheet thicknesses; consider 3D printing it.`);
  return {
    panels,
    notes: [`Layered construction: ${panels.length} slices of ${t} mm stacked on a 3 mm dowel through the centre holes (stack height ${(n * t).toFixed(1)} mm vs ${h.toFixed(1)} mm modelled). Sand the stepped edge for a smooth profile.`],
    warnings,
  };
}

// ---------------- gable and wedge ----------------

function gablePanels(ctx: PanelContext, part: ResolvedPart, t: number, method: Panel["method"]): PanelResult {
  const { wasm } = ctx;
  const c = part.comp;
  const { w, d, h } = c.primitive as { w: number; d: number; h: number };
  const alpha = Math.atan2(h, d / 2);
  const s = Math.hypot(d / 2, h);
  const inset = t / Math.sin(alpha);
  const apex = h - t / Math.cos(alpha);
  const panels: Panel[] = [];
  const warnings: string[] = [];
  if (apex <= t || d / 2 - inset <= t) warnings.push(`${c.partId}: roof is too shallow/small for ${t} mm sheet gables — consider printing it.`);
  const roofClad = (c.primitive as { cladding?: Cladding }).cladding;
  const endClad: Cladding = roofClad && roofClad !== "none" ? "fishscale" : "none";
  for (const [name, x, wx] of [["gable end A", -w / 2 + t, -1], ["gable end B", w / 2 - t, 1]] as const) {
    const id = pid(c.partId);
    const tri: Poly = [[inset, 0], [d - inset, 0], [d / 2, apex]];
    panels.push({
      panelId: id, partId: c.partId, label: `${c.name} — ${name}`, materialKey: part.materialKey, thicknessMm: t, method,
      cut: cs(wasm, [tri]), engrave: [], score: [], text: [{ at: [d / 2, apex * 0.3], text: id, size: 3 }],
      place: { origin: [x, -d / 2, 0], u: [0, 1, 0], v: [0, 0, 1], w: [wx, 0, 0] }, notes: [], cladding: endClad,
    });
  }
  // Roof slopes: outer face on the modelled roof surface. Engraved lines mark where the gable ends meet (underside).
  const ca = Math.cos(alpha), sa = Math.sin(alpha);
  const slopes: [string, Vec3, Vec3, Vec3][] = [
    ["roof slope front", [-w / 2, -d / 2, 0], [0, ca, sa], [0, sa, -ca]],
    ["roof slope back", [-w / 2, d / 2, 0], [0, -ca, sa], [0, -sa, -ca]],
  ];
  for (const [name, eave, up, inward] of slopes) {
    const id = pid(c.partId);
    // Outer face (+w) lies on the roof plane: start t inside and extrude outwards.
    const back = name.includes("back");
    const origin: Vec3 = [back ? w / 2 : -w / 2, eave[1] + inward[1] * t, eave[2] + inward[2] * t];
    panels.push({
      panelId: id, partId: c.partId, label: `${c.name} — ${name}`, materialKey: part.materialKey, thicknessMm: t, method,
      cut: cs(wasm, [rect(0, 0, w, s)]),
      engrave: [],
      score: [],
      text: [{ at: [w / 2, s / 2], text: id, size: 3 }],
      place: { origin, u: back ? [-1, 0, 0] : [1, 0, 0], v: up, w: inward.map((x) => -x) as Vec3 },
      notes: [],
    });
  }
  return {
    panels,
    notes: [
      `Roof pitch ${(alpha * 180 / Math.PI).toFixed(1)}°. The two slopes meet at the ridge with a ${t} mm step — sand a bevel of ${(90 - alpha * 180 / Math.PI).toFixed(0)}° on the ridge edges or cover the joint with a ridge strip.`,
      `The gable ends sit ${t} mm in from each end of the slopes.`,
    ],
    warnings,
  };
}

function wedgePanels(ctx: PanelContext, part: ResolvedPart, t: number, method: Panel["method"]): PanelResult {
  const { wasm } = ctx;
  const c = part.comp;
  const { w, d, h } = c.primitive as { w: number; d: number; h: number };
  const s = Math.hypot(d, h);
  const panels: Panel[] = [];
  for (const [name, x] of [["side A", -w / 2], ["side B", w / 2 - t]] as const) {
    const id = pid(c.partId);
    panels.push({
      panelId: id, partId: c.partId, label: `${c.name} — ${name}`, materialKey: part.materialKey, thicknessMm: t, method,
      cut: cs(wasm, [[[0, 0], [d, 0], [0, h]]]), engrave: [], score: [], text: [{ at: [d * 0.25, h * 0.25], text: id, size: 2.5 }],
      place: { origin: [x, -d / 2, 0], u: [0, 1, 0], v: [0, 0, 1], w: [1, 0, 0] }, notes: [],
    });
  }
  const back = pid(c.partId);
  panels.push({
    panelId: back, partId: c.partId, label: `${c.name} — back`, materialKey: part.materialKey, thicknessMm: t, method,
    cut: cs(wasm, [rect(0, 0, w - 2 * t, h)]), engrave: [], score: [], text: [{ at: [(w - 2 * t) / 2, h / 2], text: back, size: 3 }],
    place: { origin: [-w / 2 + t, -d / 2, 0], u: [1, 0, 0], v: [0, 0, 1], w: [0, 1, 0] }, notes: [],
  });
  const top = pid(c.partId);
  const a = Math.atan2(h, d);
  panels.push({
    panelId: top, partId: c.partId, label: `${c.name} — slope`, materialKey: part.materialKey, thicknessMm: t, method,
    cut: cs(wasm, [rect(0, 0, w, s)]), engrave: [], score: [], text: [{ at: [w / 2, s / 2], text: top, size: 3 }],
    place: { origin: [-w / 2, -d / 2 - Math.sin(a) * t, h - Math.cos(a) * t], u: [1, 0, 0], v: [0, Math.cos(a), -Math.sin(a)], w: [0, Math.sin(a), Math.cos(a)] },
    notes: [],
  });
  return { panels, notes: ["Butt-glued wedge: sides, back, then the slope on top."], warnings: [] };
}

// ---------------- paper nets ----------------

const PAGE = { w: 297 - 12, h: 210 - 12 }; // A4 landscape minus margins
function fitsPage(b: { min: number[]; max: number[] }) {
  const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1];
  return (w <= PAGE.w && h <= PAGE.h) || (h <= PAGE.w && w <= PAGE.h);
}

function tab(a: Pt, b: Pt, depth: number, outward: 1 | -1): Poly {
  // Trapezoid glue tab on segment a→b, on the side given by outward (relative to the segment's left normal).
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const nx = (-dy / len) * outward, ny = (dx / len) * outward;
  const inset = Math.min(depth, len / 4);
  const ux = dx / len, uy = dy / len;
  return [a, b, [b[0] + nx * depth - ux * inset, b[1] + ny * depth - uy * inset], [a[0] + nx * depth + ux * inset, a[1] + ny * depth + uy * inset]];
}

function paperNet(ctx: PanelContext, part: ResolvedPart, t: number): PanelResult {
  const { wasm } = ctx;
  const c = part.comp;
  const p = c.primitive;
  const G = 7; // glue tab depth
  const panels: Panel[] = [];
  const mk = (label: string, polys: Poly[], score: Poly[], holes: Poly[] = []): Panel => {
    let body = cs(wasm, polys);
    if (holes.length) body = body.subtract(cs(wasm, holes));
    const id = pid(c.partId);
    const b = body.bounds();
    return {
      panelId: id, partId: c.partId, label: `${c.name} — ${label}`, materialKey: part.materialKey, thicknessMm: t, method: "paper",
      cut: body, engrave: [], score, text: [{ at: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2], text: id, size: 3 }],
      place: null, notes: [],
    };
  };
  if (p.type === "box") {
    const { w, d, h } = p;
    // Cross net: floor in the middle (x∈[0,w], y∈[h, h+d]); front below, back above, sides left/right, top above back.
    const y0 = h, y1 = h + d;
    const faces: Poly[] = [
      rect(0, y0, w, y1), // floor
      rect(0, 0, w, y0), // front
      rect(0, y1, w, y1 + h), // back
      rect(-h, y0, 0, y1), // left
      rect(w, y0, w + h, y1), // right
      rect(0, y1 + h, w, y1 + h + d), // top
    ];
    const tabs: Poly[] = [
      tab([0, 0], [0, y0], G, 1), tab([w, y0], [w, 0], G, 1), // front sides
      tab([0, y1], [0, y1 + h], G, -1), tab([w, y1 + h], [w, y1], G, -1), // back sides
      tab([0, y1 + h + d], [0, y1 + h], G, 1), tab([w, y1 + h], [w, y1 + h + d], G, 1), tab([w, y1 + h + d], [0, y1 + h + d], G, 1), // top
    ];
    const score: Poly[] = [
      [[0, y0], [w, y0]], [[0, y1], [w, y1]], [[0, y0], [0, y1]], [[w, y0], [w, y1]], [[0, y1 + h], [w, y1 + h]],
      [[0, 0], [0, y0]], [[w, 0], [w, y0]], [[0, y1], [0, y1 + h]], [[w, y1], [w, y1 + h]], [[0, y1 + h], [0, y1 + h + d]], [[w, y1 + h], [w, y1 + h + d]], [[0, y1 + h + d], [w, y1 + h + d]],
    ];
    // Openings → holes in the net faces.
    const holes: Poly[] = [];
    for (const o of ctx.openingsOf(c.partId)) {
      for (const face of ["front", "back", "left", "right"] as const) {
        const r = openingOnFace(c, o.comp, face, 0);
        if (!r) continue;
        const [[u0, v0], , [u1, v1]] = r;
        if (face === "front") holes.push(rect(u0, y0 - v1, u1, y0 - v0));
        if (face === "back") holes.push(rect(u0, y1 + v0, u1, y1 + v1));
        if (face === "left") holes.push(rect(-v1, y0 + u0, -v0, y0 + u1));
        if (face === "right") holes.push(rect(w + v0, y0 + u0, w + v1, y0 + u1));
      }
    }
    const net = mk("fold net", [...faces, ...tabs], score, holes);
    const nb = net.cut.bounds();
    if (fitsPage(nb)) {
      panels.push(net);
      return { panels, notes: ["Cross-shaped fold net: score every green line, fold away from you, glue the tabs inside."], warnings: [] };
    }
    // Net is larger than a page: split into separate faces, each with its own glue tabs.
    panelSeq = 0;
    const faceDefs: [string, number, number, Poly[]][] = [
      ["floor", w, d, []],
      ["front", w, h, [tab([0, 0], [0, h], G, 1), tab([w, h], [w, 0], G, 1), tab([w, 0], [0, 0], G, 1)]],
      ["back", w, h, [tab([0, 0], [0, h], G, 1), tab([w, h], [w, 0], G, 1), tab([w, 0], [0, 0], G, 1)]],
      ["left", d, h, [tab([d, 0], [0, 0], G, 1)]],
      ["right", d, h, [tab([d, 0], [0, 0], G, 1)]],
      ["top", w, d, []],
    ];
    const warnings: string[] = [];
    for (const [name, fw, fh, tabs2] of faceDefs) {
      const fHoles: Poly[] = [];
      if (name !== "floor" && name !== "top")
        for (const o of ctx.openingsOf(c.partId)) {
          const r = openingOnFace(c, o.comp, name as "front", 0);
          if (r) fHoles.push(r);
        }
      const score2: Poly[] = tabs2.map((tb) => [tb[0], tb[1]]);
      const pnl = mk(name, [rect(0, 0, fw, fh), ...tabs2], score2, fHoles);
      if (!fitsPage(pnl.cut.bounds())) warnings.push(`${c.partId} ${name}: ${fw.toFixed(0)} × ${fh.toFixed(0)} mm is larger than an A4 page — scale the design down or print on A3.`);
      panels.push(pnl);
    }
    return { panels, notes: ["Separate faces (the full net is larger than one page): score the tab lines, glue tabs behind the neighbouring faces."], warnings };
  }
  if (p.type === "gable") {
    const { w, d, h } = p;
    const s = Math.hypot(d / 2, h);
    const strip: Poly[] = [rect(0, 0, w, s), rect(0, s, w, 2 * s)];
    const tri = (x0: number, sign: 1 | -1): Poly => [[x0, 0], [x0, 2 * s], [x0 + sign * h, s]];
    // Triangles attached to the ends of the strip (each spans both slopes), glue tabs on the long edges.
    const polys = [...strip, tri(0, -1), tri(w, 1), tab([w, 0], [0, 0], G, -1)];
    const score: Poly[] = [[[0, s], [w, s]], [[0, 0], [0, 2 * s]], [[w, 0], [w, 2 * s]], [[0, 0], [w, 0]]];
    const net = mk("roof net", polys, score);
    if (fitsPage(net.cut.bounds())) {
      panels.push(net);
      return { panels, notes: ["Roof strip folds at the ridge; triangular ends fold down and are glued to the walls."], warnings: [] };
    }
    panelSeq = 0;
    panels.push(mk("slope A", [rect(0, 0, w, s), tab([w, s], [0, s], G, 1)], [[[0, s], [w, s]]]));
    panels.push(mk("slope B", [rect(0, 0, w, s)], []));
    const endTri = (): Poly => [[0, 0], [d, 0], [d / 2, h]];
    panels.push(mk("gable end A", [endTri(), tab([d / 2, h], [0, 0], G, 1), tab([d, 0], [d / 2, h], G, 1)], [[[0, 0], [d / 2, h]], [[d / 2, h], [d, 0]]]));
    panels.push(mk("gable end B", [endTri(), tab([d / 2, h], [0, 0], G, 1), tab([d, 0], [d / 2, h], G, 1)], [[[0, 0], [d / 2, h]], [[d / 2, h], [d, 0]]]));
    const warnings = panels.filter((x) => !fitsPage(x.cut.bounds())).map((x) => `${x.label} is larger than an A4 page — scale down or print on A3.`);
    return { panels, notes: ["Roof in four pieces (too large for one page): glue slope A's ridge tab under slope B, then glue the gable ends in with their tabs."], warnings };
  }
  if (p.type === "cylinder" && (p.rTop === undefined || Math.abs(p.rTop - p.r) < 0.01)) {
    const C = 2 * Math.PI * p.r;
    const teeth: Poly[] = [];
    const n = Math.max(8, Math.round(C / 8));
    for (let i = 0; i < n; i++) {
      const x0 = (C * i) / n, x1 = (C * (i + 1)) / n;
      teeth.push([[x0, 0], [x1, 0], [(x0 + x1) / 2, -G * 0.7]]);
      teeth.push([[x0, p.h], [(x0 + x1) / 2, p.h + G * 0.7], [x1, p.h]]);
    }
    panels.push(mk("wrap", [rect(0, 0, C, p.h), tab([C, 0], [C, p.h], G, 1), ...teeth], [[[0, 0], [C, 0]], [[0, p.h], [C, p.h]], [[C, 0], [C, p.h]]]));
    const disc = (): Poly => Array.from({ length: 64 }, (_, i) => [p.r + p.r * Math.cos((2 * Math.PI * i) / 64), p.r + p.r * Math.sin((2 * Math.PI * i) / 64)] as Pt);
    panels.push(mk("top disc", [disc()], []));
    panels.push(mk("bottom disc", [disc()], []));
    return { panels, notes: ["Roll the wrap into a tube, glue the side tab, fold the teeth inwards and glue the discs onto them."], warnings: [] };
  }
  if (p.type === "ngon") {
    const side = 2 * p.r * Math.sin(Math.PI / p.n);
    const strip: Poly[] = Array.from({ length: p.n }, (_, k) => rect(k * side, 0, (k + 1) * side, p.h));
    const score: Poly[] = Array.from({ length: p.n - 1 }, (_, k) => [[(k + 1) * side, 0], [(k + 1) * side, p.h]] as Poly);
    panels.push(mk("tower wrap", [...strip, tab([p.n * side, 0], [p.n * side, p.h], G, 1)], [...score, [[p.n * side, 0], [p.n * side, p.h]]]));
    const P = ngonPoints(p.n, p.r);
    panels.push(mk("tower base", [P.map(([x, y]) => [x + p.r, y + p.r] as Pt)], []));
    const warnings = panels.filter((x) => !fitsPage(x.cut.bounds())).map((x) => `${x.label} is larger than an A4 page — scale down or print on A3.`);
    return { panels, notes: ["Fold the tower wrap along every score line, glue the side tab, then glue the base inside."], warnings };
  }
  if (p.type === "pyramid") {
    const side = 2 * p.r * Math.sin(Math.PI / p.n);
    const slant = Math.hypot(p.h, p.r * Math.cos(Math.PI / p.n));
    const L = Math.hypot(slant, side / 2); // apex to corner
    const ang = 2 * Math.asin(side / 2 / L);
    const fan: Poly[] = [];
    const score: Poly[] = [];
    for (let k = 0; k < p.n; k++) {
      const a0 = k * ang, a1 = (k + 1) * ang;
      fan.push([[0, 0], [L * Math.cos(a0), L * Math.sin(a0)], [L * Math.cos(a1), L * Math.sin(a1)]]);
      if (k > 0) score.push([[0, 0], [L * Math.cos(a0), L * Math.sin(a0)]]);
    }
    const end = p.n * ang;
    fan.push(tab([L * Math.cos(end), L * Math.sin(end)], [0, 0], G * 0.7, 1));
    panels.push(mk("spire fan", fan, score));
    return { panels, notes: ["Roll the fan into a cone along the score lines and glue the tab inside."], warnings: [] };
  }
  // Fallback: layered card slices (works for any round/organic primitive).
  if (p.type === "cylinder" || p.type === "ellipsoid") return layeredRound(ctx, part, t, "paper");
  return panelsFor(ctx, { ...part, method: "cardboard" });
}

// ---------------- 3D placement of panels (for the assembled sheet preview and fit checks) ----------------

export function panelSolid(wasm: ManifoldToplevel, panel: Panel, comp: ComponentSpec): Manifold | null {
  if (!panel.place) return null;
  const slab = wasm.Manifold.extrude(panel.cut, panel.thicknessMm);
  const { origin: o, u, v, w } = panel.place;
  const m: Mat4 = [u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, w[0], w[1], w[2], 0, o[0], o[1], o[2], 1];
  let s = slab.transform(m);
  // Openings' local frame is relative to the opening component itself.
  if (comp.rotation.some((x) => x !== 0)) s = s.rotate(comp.rotation);
  return s.translate(comp.position);
}

// ---------------- 3D trimming: where volumes meet, panels take the real outline ----------------

/** Panel slab in panel-local coordinates → project space (inverse of `toLocalSlab`). */
function placeMatrix(pl: NonNullable<Panel["place"]>): Mat4 {
  const { origin: o, u, v, w } = pl;
  return [u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, w[0], w[1], w[2], 0, o[0], o[1], o[2], 1];
}

function toLocalSlab(m: Manifold, pl: NonNullable<Panel["place"]>, comp: ComponentSpec): Manifold {
  let s = m.translate([-comp.position[0], -comp.position[1], -comp.position[2]]);
  const [rx, ry, rz] = comp.rotation;
  if (rz) s = s.rotate([0, 0, -rz]);
  if (ry) s = s.rotate([0, -ry, 0]);
  if (rx) s = s.rotate([-rx, 0, 0]);
  const { origin: o, u, v, w } = pl;
  // Orthonormal basis: inverse = transpose.
  const inv: Mat4 = [u[0], v[0], w[0], 0, u[1], v[1], w[1], 0, u[2], v[2], w[2], 0, -dot3(u, o), -dot3(v, o), -dot3(w, o), 1];
  return s.transform(inv);
}

/**
 * Subtract `cutters` (project-space solids: window holes, and volumes of parts that take precedence) from every
 * placed panel, then read the new 2D outline back from the trimmed slab. Panels that vanish are dropped.
 */
export function trimPanels(wasm: ManifoldToplevel, panels: Panel[], comp: ComponentSpec, cutters: Manifold[]): { panels: Panel[]; trimmed: number; removed: number } {
  if (!cutters.length) return { panels, trimmed: 0, removed: 0 };
  const cutter = wasm.Manifold.union(cutters);
  const cb = cutter.boundingBox();
  const out: Panel[] = [];
  let trimmed = 0, removed = 0;
  for (const pn of panels) {
    const solid = panelSolid(wasm, pn, comp);
    if (!solid) { out.push(pn); continue; }
    const b = solid.boundingBox();
    if ([0, 1, 2].some((k) => b.max[k] <= cb.min[k] || cb.max[k] <= b.min[k])) { out.push(pn); continue; }
    const before = solid.volume();
    const cut = solid.subtract(cutter);
    const after = cut.volume();
    if (after > before * 0.999) { out.push(pn); continue; }
    if (after < before * 0.03) { removed++; continue; }
    const local = toLocalSlab(cut, pn.place!, comp);
    let section = local.slice(pn.thicknessMm / 2);
    // Drop slivers (anything narrower than ~1.2 mm cannot be cut or glued meaningfully).
    section = section.offset(-0.6, "Miter", 2).offset(0.6, "Miter", 2);
    if (section.isEmpty() || section.area() < 4) { removed++; continue; }
    trimmed++;
    out.push({ ...pn, cut: section });
  }
  return { panels: out, trimmed, removed };
}

// ---------------- cladding engraving (outer face) ----------------

function insidePolys(polys: Pt[][], x: number, y: number) {
  let inside = false;
  for (const poly of polys)
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}

/** Keep the parts of each polyline that lie inside the region (sampled every `step` mm). */
function clipLines(lines: Poly[], region: Pt[][], step = 0.4, straight = false): Poly[] {
  const out: Poly[] = [];
  for (const line of lines) {
    let run: Poly = [];
    const flush = () => {
      if (run.length >= 2) out.push(straight ? [run[0], run[run.length - 1]] : run);
      run = [];
    };
    for (let i = 0; i + 1 < line.length; i++) {
      const [x0, y0] = line[i], [x1, y1] = line[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let k = i === 0 ? 0 : 1; k <= n; k++) {
        const x = x0 + ((x1 - x0) * k) / n, y = y0 + ((y1 - y0) * k) / n;
        if (insidePolys(region, x, y)) run.push([x, y]);
        else flush();
      }
    }
    flush();
  }
  return out;
}

function hash(i: number, j: number) {
  const x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Engraving lines for a surface pattern over a bounding box (u right, v up). */
export function claddingLines(kind: Cladding, b: { min: number[]; max: number[] }): { lines: Poly[]; straight: boolean } {
  const [x0, y0] = b.min, [x1, y1] = b.max;
  const lines: Poly[] = [];
  switch (kind) {
    case "clapboard":
      for (let y = y0 + 3; y < y1; y += 3) lines.push([[x0, y], [x1, y]]);
      return { lines, straight: true };
    case "boardbatten":
      for (let x = x0 + 4; x < x1; x += 4) lines.push([[x, y0], [x, y1]]);
      return { lines, straight: true };
    case "shingle": {
      const row = 3.2, wd = 4;
      for (let j = 0, y = y0 + row; y < y1; j++, y += row) {
        lines.push([[x0, y], [x1, y]]);
        const off = (j % 2) * wd / 2;
        for (let x = x0 + off; x < x1; x += wd) lines.push([[x, y - row], [x, y]]);
      }
      return { lines, straight: true };
    }
    case "brick": {
      const row = 2.4, wd = 5;
      for (let j = 0, y = y0 + row; y < y1; j++, y += row) {
        lines.push([[x0, y], [x1, y]]);
        for (let x = x0 + (j % 2) * wd / 2; x < x1; x += wd) lines.push([[x, y - row], [x, y]]);
      }
      return { lines, straight: true };
    }
    case "stone": {
      // Irregular coursed stone: course heights and joint positions jittered deterministically.
      let y = y0, j = 0;
      while (y < y1) {
        const hgt = 3.5 + hash(j, 7) * 2.5;
        const yn = y + hgt;
        lines.push([[x0, yn], [x1, yn]]);
        let x = x0 + hash(j, 3) * 4;
        let i = 0;
        while (x < x1) { lines.push([[x, y], [x, yn]]); x += 4.5 + hash(j, i++) * 5; }
        y = yn; j++;
      }
      return { lines, straight: true };
    }
    case "fishscale": {
      const r = 1.8, row = 2.6;
      for (let j = 0, y = y0 + row; y < y1 + row; j++, y += row) {
        const off = (j % 2) * r;
        for (let cx = x0 - r + off; cx < x1 + r; cx += 2 * r) {
          const arc: Poly = [];
          for (let k = 0; k <= 10; k++) { const a = Math.PI + (Math.PI * k) / 10; arc.push([cx + r * Math.cos(a), y + r * Math.sin(a)]); }
          lines.push(arc);
        }
      }
      return { lines, straight: false };
    }
    default:
      return { lines: [], straight: true };
  }
}

/** Add the panel's cladding pattern as engrave lines, clipped 0.8 mm inside its final outline and holes. */
export function applyCladding(panel: Panel): Panel {
  if (!panel.cladding || panel.cladding === "none") return panel;
  const region = panel.cut.offset(-0.8, "Miter", 2).toPolygons().map((q) => q.map((v) => [v[0], v[1]] as Pt));
  if (!region.length) return panel;
  const { lines, straight } = claddingLines(panel.cladding, panel.cut.bounds() as unknown as { min: number[]; max: number[] });
  return { ...panel, engrave: [...panel.engrave, ...clipLines(lines, region, 0.4, straight)] };
}
