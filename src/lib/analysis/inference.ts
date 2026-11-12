// Hidden-side inference: PARTART's own, deterministic rules for the parts of a building a photo cannot show.
//
// No model, no API call. Every suggestion names the rule that made it, the evidence it used (which visible parts),
// and is checked geometrically before it is offered: a proposed window must sit on a real face of its wall and must
// not be buried under another volume (a wing, a turret, the main roof). The user accepts or rejects each one;
// accepted parts get provenance "inferred" so they stay distinguishable from what was actually seen.

import type { ComponentSpec, Primitive, Vec3 } from "../geometry/types";
import { isDoor } from "../geometry/types";
import { nextPartId } from "../design/partIds";

export type Face = "front" | "back" | "left" | "right";
export type RuleKey = "mirror-face" | "fill-face" | "back-door";

export interface Suggestion {
  /** Stable for the same model: rule + parent + target face. Used to accept or dismiss. */
  id: string;
  rule: RuleKey;
  title: string;
  /** Why the rule fired, in terms of the visible evidence. */
  reason: string;
  parentPartId: string;
  face: Face;
  /** Visible parts the suggestion was derived from. */
  evidence: string[];
  confidence: number;
  /** Proposed parts (part ids are provisional until accepted). */
  components: ComponentSpec[];
  /** Candidates that were dropped by the geometric checks, with the reason. */
  rejected: string[];
}

export const RULES: Record<RuleKey, { label: string; explain: string }> = {
  "mirror-face": {
    label: "Mirror the opposite side",
    explain: "A wall or gable end that the photo does not show, whose opposite side has windows or gable trim, gets the same layout mirrored. Houses are usually built with matching window rows on opposite walls.",
  },
  "fill-face": {
    label: "Continue the window rows",
    explain: "A blank side wall between walls that have windows gets windows of the same size on the same floors, evenly spaced. Floor heights and window size are measured from the visible windows of that wall.",
  },
  "back-door": {
    label: "Back door",
    explain: "A main house body with a front door and no other door gets a back door of the same size on the opposite wall.",
  },
};

// ---------------------------------------------------------------- geometry helpers

const VOLUME_TYPES = new Set(["box", "gable", "hip", "wedge", "ngon", "pyramid", "cylinder", "ellipsoid"]);
const NON_VOLUME_ROLES = new Set(["opening", "ornament", "railing", "stairs", "joint", "detail"]);
const MOUNTED = (c: ComponentSpec) => c.role === "opening" || (c.primitive.type === "ornament" && c.primitive.kind === "gablefan");
const rad = (d: number) => (d * Math.PI) / 180;

function rotXYZ(v: Vec3, r: Vec3): Vec3 {
  // Rotation applied X, then Y, then Z (matches the kernel).
  let [x, y, z] = v;
  const [ax, ay, az] = r.map(rad);
  [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
  [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
  [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
  return [x, y, z];
}
function unrotXYZ(v: Vec3, r: Vec3): Vec3 {
  let [x, y, z] = v;
  const [ax, ay, az] = r.map((d) => -rad(d));
  [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
  [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
  [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
  return [x, y, z];
}
const toLocal = (c: ComponentSpec, p: Vec3): Vec3 => unrotXYZ([p[0] - c.position[0], p[1] - c.position[1], p[2] - c.position[2]], c.rotation);
const toWorld = (c: ComponentSpec, p: Vec3): Vec3 => {
  const r = rotXYZ(p, c.rotation);
  return [r[0] + c.position[0], r[1] + c.position[1], r[2] + c.position[2]];
};

/** Exact point-in-solid for the analytic primitives, in the primitive's local frame (centred on X/Y, z from 0). */
export function insideLocal(p: Primitive, [x, y, z]: Vec3): boolean {
  const e = 1e-6;
  if (z < -e) return false;
  switch (p.type) {
    case "box":
      return Math.abs(x) <= p.w / 2 && Math.abs(y) <= p.d / 2 && z <= p.h;
    case "gable":
      return z <= p.h && Math.abs(x) <= p.w / 2 && Math.abs(y) <= (p.d / 2) * (1 - z / p.h);
    case "hip": {
      if (z > p.h) return false;
      const t = z / p.h, m = Math.min(p.w, p.d) / 2;
      return Math.abs(x) <= p.w / 2 - m * t && Math.abs(y) <= p.d / 2 - m * t;
    }
    case "wedge":
      return Math.abs(x) <= p.w / 2 && Math.abs(y) <= p.d / 2 && z <= p.h * (0.5 - y / p.d);
    case "ngon": {
      // Inside the regular n-gon (flat face toward -Y): distance to every edge line ≤ apothem.
      if (z > p.h) return false;
      const ap = p.r * Math.cos(Math.PI / p.n);
      for (let i = 0; i < p.n; i++) {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / p.n;
        if (x * Math.cos(a) + y * Math.sin(a) > ap) return false;
      }
      return true;
    }
    case "pyramid": {
      if (z > p.h) return false;
      const ap = p.r * Math.cos(Math.PI / p.n) * (1 - z / p.h);
      for (let i = 0; i < p.n; i++) {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / p.n;
        if (x * Math.cos(a) + y * Math.sin(a) > ap) return false;
      }
      return true;
    }
    case "cylinder": {
      if (z > p.h) return false;
      const r = p.r + ((p.rTop ?? p.r) - p.r) * (z / p.h);
      return x * x + y * y <= r * r;
    }
    case "ellipsoid": {
      const cz = p.h / 2;
      return (x / (p.w / 2)) ** 2 + (y / (p.d / 2)) ** 2 + ((z - cz) / cz) ** 2 <= 1;
    }
    default:
      return false;
  }
}

const insideWorld = (c: ComponentSpec, p: Vec3) => insideLocal(c.primitive, toLocal(c, p));

interface FaceFrame {
  face: Face;
  /** Outward normal and along-face direction, in the parent's local frame (horizontal). */
  n: [number, number];
  u: [number, number];
  /** Distance of the face plane from the parent's local origin, and half-length along u. */
  offset: number;
  half: number;
}

function facesOf(p: Primitive): FaceFrame[] {
  if (p.type === "box") return [
    { face: "front", n: [0, -1], u: [1, 0], offset: p.d / 2, half: p.w / 2 },
    { face: "back", n: [0, 1], u: [-1, 0], offset: p.d / 2, half: p.w / 2 },
    { face: "left", n: [-1, 0], u: [0, -1], offset: p.w / 2, half: p.d / 2 },
    { face: "right", n: [1, 0], u: [0, 1], offset: p.w / 2, half: p.d / 2 },
  ];
  // Gable: the two triangular ends are the only vertical faces (ridge along local X).
  if (p.type === "gable") return [
    { face: "left", n: [-1, 0], u: [0, -1], offset: p.w / 2, half: p.d / 2 },
    { face: "right", n: [1, 0], u: [0, 1], offset: p.w / 2, half: p.d / 2 },
  ];
  return [];
}
const OPPOSITE: Record<Face, Face> = { front: "back", back: "front", left: "right", right: "left" };

/** Which face of `parent` a mounted child sits on (by its outward normal and plane), or null. */
function faceOfChild(parent: ComponentSpec, child: ComponentSpec): FaceFrame | null {
  if (parent.rotation[0] || parent.rotation[1] || child.rotation[0] || child.rotation[1]) return null;
  // Mounted parts face local -Y; rotate that into world, then into the parent's frame.
  const nw = rotXYZ([0, -1, 0], child.rotation);
  const nl = unrotXYZ(nw, parent.rotation);
  const loc = toLocal(parent, child.position);
  for (const f of facesOf(parent.primitive)) {
    // Either orientation counts: a part on the plane of a face belongs to that face even if it was modelled facing in.
    if (Math.abs(nl[0] * f.n[0] + nl[1] * f.n[1]) < 0.9) continue;
    const plane = loc[0] * f.n[0] + loc[1] * f.n[1];
    if (Math.abs(plane - f.offset) <= 3) return f;
  }
  return null;
}

/** Place a mounted part on a face: `s` along the face, `z` = bottom height (parent-local). */
function placeOnFace(parent: ComponentSpec, f: FaceFrame, s: number, z: number): { position: Vec3; rotation: Vec3 } {
  const local: Vec3 = [f.n[0] * f.offset + f.u[0] * s, f.n[1] * f.offset + f.u[1] * s, z];
  // Rotation that turns local -Y into the face normal, plus the parent's own turn.
  const faceRot = (Math.atan2(f.n[1], f.n[0]) * 180) / Math.PI + 90;
  return { position: toWorld(parent, local), rotation: [0, 0, norm(faceRot + parent.rotation[2])] };
}
const norm = (a: number) => { let r = ((a % 360) + 360) % 360; if (r > 180) r -= 360; return Math.round(r * 100) / 100; };

/** Coordinates of a mounted child on its face: along-face s and bottom z, parent-local. */
function coordsOnFace(parent: ComponentSpec, f: FaceFrame, child: ComponentSpec) {
  const loc = toLocal(parent, child.position);
  return { s: loc[0] * f.u[0] + loc[1] * f.u[1], z: loc[2] };
}

const CORNER_MM = 5;
/** The photo is taken from the front (-Y in project space): a face pointing that way was seen, so nothing is invented on it. */
function facesCamera(parent: ComponentSpec, f: FaceFrame) {
  const n = rotXYZ([f.n[0], f.n[1], 0], parent.rotation);
  return n[1] < -0.7;
}
const isFan = (c: ComponentSpec) => c.primitive.type === "ornament" && c.primitive.kind === "gablefan";

const sizeWH = (p: Primitive): [number, number] => ("w" in p && "h" in p ? [p.w, p.h] : [10, 10]);

/**
 * Geometric acceptance of a candidate on a face: points just inside the wall must be inside the parent (so the part
 * lies on the face, including under a gable's slopes), and points just outside must not be inside any other volume.
 */
function checkCandidate(parent: ComponentSpec, f: FaceFrame, s: number, z: number, w: number, h: number, others: ComponentSpec[], triangular = false): string | null {
  if (facesCamera(parent, f)) return "is on the photographed (front) side, which the photo shows as it is";
  // Keep clear of the wall's corners, where the finger joints are.
  if (parent.primitive.type === "box" && Math.abs(s) + w / 2 > f.half - CORNER_MM) return `is closer than ${CORNER_MM} mm to the wall's corner joints`;
  const pts: [number, number][] = triangular
    ? [[s, z + h / 2], [s - w / 2 + 1, z + 1], [s + w / 2 - 1, z + 1]]
    : [[s, z + h / 2], [s - w / 2 + 1, z + 1], [s + w / 2 - 1, z + 1], [s - w / 2 + 1, z + h - 1], [s + w / 2 - 1, z + h - 1]];
  for (const [ss, zz] of pts) {
    const at = (d: number): Vec3 => [f.n[0] * (f.offset + d) + f.u[0] * ss, f.n[1] * (f.offset + d) + f.u[1] * ss, zz];
    if (!insideLocal(parent.primitive, at(-1.5))) return "does not fit on the face";
    const out = toWorld(parent, at(1.5));
    const hit = others.find((o) => insideWorld(o, out));
    if (hit) return `would be hidden inside ${hit.partId} (${hit.name})`;
  }
  return null;
}

// ---------------------------------------------------------------- rules

export function inferHiddenSides(comps: ComponentSpec[], dismissed: string[] = []): Suggestion[] {
  const live = comps.filter((c) => !c.hidden);
  const volumes = live.filter((c) => VOLUME_TYPES.has(c.primitive.type) && !NON_VOLUME_ROLES.has(c.role));
  const ids = live.map((c) => c.partId);
  const takeId = (role: string) => { const id = nextPartId(ids, role); ids.push(id); return id; };
  const out: Suggestion[] = [];

  for (const parent of volumes) {
    const faces = facesOf(parent.primitive);
    if (!faces.length) continue;
    const others = volumes.filter((v) => v.partId !== parent.partId);
    const children = live.filter((c) => c.parentPartId === parent.partId && MOUNTED(c));
    const onFace = new Map<Face, ComponentSpec[]>(faces.map((f) => [f.face, []]));
    for (const c of children) { const f = faceOfChild(parent, c); if (f) onFace.get(f.face)!.push(c); }
    const frame = (face: Face) => faces.find((f) => f.face === face)!;

    // Rule 1 — mirror a populated face onto its empty opposite.
    for (const f of faces) {
      const src = onFace.get(f.face)!.filter((c) => !isDoor(c));
      const dst = frame(OPPOSITE[f.face]);
      // Only into a face with nothing on it: a face the photo showed (even partly) is never overwritten.
      if (!dst || !src.length || onFace.get(dst.face)!.length) continue;
      const id = `mirror-face:${parent.partId}:${dst.face}`;
      if (dismissed.includes(id)) continue;
      const made: ComponentSpec[] = [], rejected: string[] = [];
      for (const c of src) {
        const { s, z } = coordsOnFace(parent, f, c);
        const [w, h] = sizeWH(c.primitive);
        // Mirror through the plane between the two faces: the same position seen from the other side is -s.
        const why = checkCandidate(parent, dst, -s, z, w, h, others, isFan(c));
        if (why) { rejected.push(`${c.name} copy ${why}`); continue; }
        const role = c.role;
        made.push({ ...c, partId: takeId(role), name: `${c.name} (${dst.face}, inferred)`, ...placeOnFace(parent, dst, -s, z), provenance: "inferred", confidence: 0.55 });
      }
      if (made.length) out.push({
        id, rule: "mirror-face", parentPartId: parent.partId, face: dst.face, evidence: src.map((c) => c.partId), confidence: 0.55, components: made, rejected,
        title: `${parent.name}: ${made.length} part${made.length > 1 ? "s" : ""} on the ${dst.face} side`,
        reason: `The ${f.face} side of ${parent.partId} shows ${src.length} window/trim part${src.length > 1 ? "s" : ""} (${src.map((c) => c.partId).join(", ")}); the ${dst.face} side is not visible and has none, so the same layout is mirrored.`,
      });
    }

    // Rule 2 — continue window rows onto a blank side wall (only box walls with windows on an adjacent face).
    if (parent.primitive.type === "box") {
      const own = children.filter((c) => c.role === "opening" && !isDoor(c) && faceOfChild(parent, c));
      // A main body with no windows of its own (e.g. hidden behind a bay and porch) borrows the house's window size and
      // floor heights from the windows the photo does show elsewhere — at lower confidence.
      const borrowed = !own.length && (parent.role === "shell" || parent.role === "structure");
      const windows = own.length ? own : borrowed
        ? live.filter((c) => c.role === "opening" && !isDoor(c) && c.primitive.type === "box" && c.position[2] >= parent.position[2] && c.position[2] < parent.position[2] + sizeWH(parent.primitive)[1])
        : [];
      if (windows.length) {
        const proto = mostCommon(windows);
        const [w, h] = sizeWH(proto.primitive);
        const conf = borrowed ? 0.3 : 0.4;
        const floors = clusterFloors(windows.map((c) => c.position[2] - parent.position[2]), h);
        for (const f of faces) {
          if (onFace.get(f.face)!.length || onFace.get(OPPOSITE[f.face])!.length) continue; // mirror rule handles those
          const id = `fill-face:${parent.partId}:${f.face}`;
          if (dismissed.includes(id)) continue;
          const len = 2 * f.half;
          const n = Math.max(1, Math.floor(len / (w * 2.4)));
          const made: ComponentSpec[] = [], rejected: string[] = [];
          for (const z of floors) for (let i = 0; i < n; i++) {
            const s = (i - (n - 1) / 2) * (len / n);
            const why = checkCandidate(parent, f, s, z, w, h, others);
            if (why) { rejected.push(`window at ${Math.round(s)} mm, floor ${floors.indexOf(z) + 1} ${why}`); continue; }
            made.push({ ...proto, partId: takeId("opening"), name: `${f.face[0].toUpperCase()}${f.face.slice(1)} window ${made.length + 1} (inferred)`, ...placeOnFace(parent, f, s, z), provenance: "inferred", confidence: conf });
          }
          if (made.length) out.push({
            id, rule: "fill-face", parentPartId: parent.partId, face: f.face, evidence: windows.map((c) => c.partId), confidence: conf, components: made, rejected,
            title: `${parent.name}: ${made.length} window${made.length > 1 ? "s" : ""} on the blank ${f.face} wall`,
            reason: `${borrowed ? `${parent.partId} shows no windows of its own; the house` : parent.partId} has ${windows.length} visible window${windows.length > 1 ? "s" : ""} of ${w}×${h} mm on ${floors.length} floor${floors.length > 1 ? "s" : ""}; the ${f.face} wall (${Math.round(len)} mm) is not visible, so ${n} per floor are spaced evenly.`,
          });
        }
      }
    }

    // Rule 3 — back door for a main body with exactly one door.
    if (parent.primitive.type === "box" && (parent.role === "shell" || parent.role === "structure")) {
      const doors = children.filter((c) => isDoor(c));
      if (doors.length === 1) {
        const d = doors[0];
        const f = faceOfChild(parent, d);
        const dst = f && frame(OPPOSITE[f.face]);
        const id = dst ? `back-door:${parent.partId}:${dst.face}` : "";
        if (f && dst && !dismissed.includes(id)) {
          const { s, z } = coordsOnFace(parent, f, d);
          const [w, h] = sizeWH(d.primitive);
          const why = checkCandidate(parent, dst, -s, z, w, h, others);
          if (!why) out.push({
            id, rule: "back-door", parentPartId: parent.partId, face: dst.face, evidence: [d.partId], confidence: 0.35, rejected: [],
            components: [{ ...d, partId: takeId("opening"), name: "Back door (inferred)", ...placeOnFace(parent, dst, -s, z), provenance: "inferred", confidence: 0.35 }],
            title: `${parent.name}: back door`,
            reason: `${d.partId} is the only door of ${parent.partId}; a door of the same size is placed opposite it on the ${dst.face} side.`,
          });
        }
      }
    }
  }
  // A back door and a mirrored window must not land on top of each other.
  return dropOverlaps(out);
}

/** Sill heights grouped into floors: windows whose bottoms are within half a window height share a floor. */
function clusterFloors(zs: number[], h: number): number[] {
  const out: number[][] = [];
  for (const z of [...zs].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && z - last[0] < h / 2) last.push(z); else out.push([z]);
  }
  return out.map((g) => Math.round(g[0]));
}

function mostCommon(cs: ComponentSpec[]): ComponentSpec {
  const key = (c: ComponentSpec) => JSON.stringify(sizeWH(c.primitive));
  const count = new Map<string, number>();
  for (const c of cs) count.set(key(c), (count.get(key(c)) ?? 0) + 1);
  return [...cs].sort((a, b) => count.get(key(b))! - count.get(key(a))!)[0];
}

function dropOverlaps(list: Suggestion[]): Suggestion[] {
  const rects = (s: Suggestion) => s.components.map((c) => { const [w, h] = sizeWH(c.primitive); return { x: c.position[0], y: c.position[1], z: c.position[2], w, h, r: c.rotation[2] }; });
  const hit = (a: ReturnType<typeof rects>[number], b: typeof a) =>
    Math.abs(a.r - b.r) < 1 && Math.hypot(a.x - b.x, a.y - b.y) < (a.w + b.w) / 2 && a.z < b.z + b.h && b.z < a.z + a.h;
  return list.filter((s, i) => !(s.rule === "back-door" && list.some((o, j) => j !== i && o.rule !== "back-door" && rects(o).some((r) => rects(s).some((q) => hit(q, r))))));
}

/** Turn accepted suggestions into final components with unique part ids against the current model. */
export function acceptSuggestions(comps: ComponentSpec[], all: Suggestion[], acceptIds: string[]): { added: ComponentSpec[]; notes: Map<string, string> } {
  const ids = comps.map((c) => c.partId);
  const added: ComponentSpec[] = [];
  const notes = new Map<string, string>();
  for (const s of all.filter((x) => acceptIds.includes(x.id))) {
    for (const c of s.components) {
      const partId = nextPartId(ids, c.role);
      ids.push(partId);
      added.push({ ...c, partId });
      notes.set(partId, `Inferred by rule "${RULES[s.rule].label}" from ${s.evidence.join(", ")}. ${s.reason}`);
    }
  }
  return { added, notes };
}
