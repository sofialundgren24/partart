// Analysis providers. Both return the same normalised structure so the rest of the pipeline does not care which
// one ran. The Claude provider proposes component structure + primitive dimensions (never mesh vertices); a
// deterministic geometry kernel builds the actual solids.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { templateFor } from "./templates";
import type { Primitive, Vec3 } from "../geometry/types";

export interface AnalysisInput {
  images: { mime: string; data: Buffer; view: string; note: string }[];
  description: string;
  intent: string;
  categoryHint: string;
  /** Template the user picked; used only by the offline template provider. */
  templateKey?: string | null;
  realSizeMm: number | null;
  targetSizeMm: number | null;
}

export interface AnalysedComponent {
  partId: string;
  name: string;
  role: string;
  parentPartId: string | null;
  primitive: Primitive;
  position: Vec3;
  rotation: Vec3;
  colorHex: string;
  provenance: "observed" | "inferred" | "assumed" | "template" | "user";
  confidence: number;
  notes: string;
}

export interface Findings {
  objectName: string;
  observed: string[];
  inferred: string[];
  assumptions: string[];
  uncertainties: { partIds: string[]; issue: string; impact: string }[];
  requestedViews: { view: string; reason: string }[];
  requestedMeasurements: { what: string; why: string }[];
  symmetry: string;
  repeated: string[];
  materialsObserved: string[];
  manufacturingIdeas: string[];
  scaleBasis: string;
}

export interface AnalysisResult {
  provider: "claude-vision" | "template";
  model: string | null;
  category: string;
  summary: string;
  components: AnalysedComponent[];
  relationships: { from: string; to: string; type: string }[];
  findings: Findings;
  raw: unknown;
}

export interface AnalysisProvider {
  id: string;
  available(): boolean;
  analyse(input: AnalysisInput): Promise<AnalysisResult>;
}

// ---------------- template provider (offline) ----------------

export const templateProvider: AnalysisProvider = {
  id: "template",
  available: () => true,
  async analyse(input) {
    const t = templateFor(input.categoryHint, input.templateKey);
    return {
      provider: "template",
      model: null,
      category: input.categoryHint,
      summary: `Template "${t.label}" — a generic starting structure for this category. It is NOT derived from your photo: edit parts, sizes and positions in Analyze to match your reference.`,
      components: t.components.map((c) => ({ ...c, provenance: "template", confidence: 0.3, notes: "" })),
      relationships: [],
      findings: {
        objectName: t.label,
        observed: [],
        inferred: [],
        assumptions: ["No image analysis was run (no ANTHROPIC_API_KEY configured). All geometry comes from a category template."],
        uncertainties: [{ partIds: [], issue: "Every dimension is a template default.", impact: "The finished object will not match your reference until you edit the components." }],
        requestedViews: [],
        requestedMeasurements: [{ what: "Overall height, width and depth of the real object", why: "Sets the scale and proportions." }],
        symmetry: "Template is mirror-symmetric about X.",
        repeated: [],
        materialsObserved: [],
        manufacturingIdeas: [],
        scaleBasis: input.targetSizeMm ? `Scaled to your target size of ${input.targetSizeMm} mm.` : "Template default size.",
      },
      raw: null,
    };
  },
};

// ---------------- Claude vision provider ----------------

const PrimitiveOut = z.object({
  type: z.enum(["box", "gable", "hip", "wedge", "ngon", "pyramid", "stairs", "railing", "ornament", "cylinder", "ellipsoid"]),
  w: z.number().describe("size along local X in mm (box, gable = ridge length, hip, wedge, stairs, railing, ornament, ellipsoid); 0 if unused"),
  d: z.number().describe("size along local Y in mm (gable = span across the ridge; railing/ornament = thickness); 0 if unused"),
  h: z.number().describe("height along Z in mm"),
  r: z.number().describe("cylinder bottom radius, or circumradius of ngon/pyramid, in mm; 0 if unused"),
  rTop: z.number().describe("cylinder top radius (equal to r for straight); 0 if unused"),
  n: z.number().describe("number of sides for ngon/pyramid (turret = 6 or 8); 0 if unused"),
  steps: z.number().describe("number of steps for stairs; 0 if unused"),
  arch: z.enum(["none", "round", "pointed"]).describe("opening top shape (role opening only)"),
  gridCols: z.number().describe("window muntin columns (1 = none)"),
  gridRows: z.number().describe("window muntin rows (1 = none)"),
  cladding: z.enum(["none", "clapboard", "shingle", "fishscale", "stone", "brick", "boardbatten"]).describe("surface pattern on walls/roofs"),
  ornamentKind: z.enum(["none", "bracket", "spandrel", "gablefan", "cresting", "finial"]).describe("for type ornament"),
});

const ComponentOut = z.object({
  partId: z.string().describe("Persistent ID like C-ROOF-01, C-WIN-03: 'C-' + short uppercase role code + '-' + two digits"),
  name: z.string(),
  role: z.enum(["base", "structure", "shell", "roof", "opening", "detail", "joint", "wheel", "axle", "head", "torso", "limb", "hand", "foot", "accessory", "column", "railing", "stairs", "ornament", "chimney"]),
  parentPartId: z.string().nullable(),
  primitive: PrimitiveOut,
  position: z.array(z.number()).describe("[x, y, z] mm of the primitive's base centre. Z up, origin at the centre of the object's base, -Y is the front."),
  rotation: z.array(z.number()).describe("[rx, ry, rz] degrees, applied X then Y then Z"),
  colorHex: z.string().describe("#rrggbb dominant colour seen in the photo"),
  provenance: z.enum(["observed", "inferred", "assumed"]).describe("observed = directly visible; inferred = deduced from visible evidence (e.g. symmetry, hidden back); assumed = guessed"),
  confidence: z.number().describe("0..1 confidence in this component's shape and size"),
  notes: z.string(),
});

const AnalysisOut = z.object({
  objectName: z.string(),
  category: z.enum(["architecture", "vehicles", "figurines", "furniture", "toys", "sculptures", "home", "decorative", "other"]),
  summary: z.string(),
  realSizeEstimateMm: z.number().describe("Estimated largest dimension of the REAL object in mm, or 0 if unknowable"),
  scaleBasis: z.string().describe("How the real size was estimated (e.g. door height ≈ 2 m)"),
  components: z.array(ComponentOut),
  relationships: z.array(z.object({ from: z.string(), to: z.string(), type: z.enum(["sits_on", "attached_to", "inserts_into", "mirrors", "hinged_to"]) })),
  symmetry: z.string(),
  repeated: z.array(z.string()),
  observed: z.array(z.string()),
  inferred: z.array(z.string()),
  assumptions: z.array(z.string()),
  uncertainties: z.array(z.object({ partIds: z.array(z.string()), issue: z.string(), impact: z.string() })),
  requestedViews: z.array(z.object({ view: z.string(), reason: z.string() })),
  requestedMeasurements: z.array(z.object({ what: z.string(), why: z.string() })),
  materialsObserved: z.array(z.string()),
  manufacturingIdeas: z.array(z.string()),
});
type AnalysisOutT = z.infer<typeof AnalysisOut>;

const SYSTEM = `You are the object-analysis stage of PARTART, a tool that turns a photo of a physical object into a buildable model kit.
Decompose the object into a hierarchy of physical components that a maker could build separately, and approximate each with ONE primitive:
box, gable (triangular prism, ridge along local X, span d), hip (hip roof), wedge (shed/ramp, high at -Y), ngon (n-sided tower, flat face to -Y), pyramid (n-sided spire), stairs (rising to +Y), railing (flat balustrade in the XZ plane), ornament (flat gingerbread trim in the XZ plane: bracket, spandrel/frieze, gablefan, cresting; or a turned finial), cylinder/cone, ellipsoid.
For buildings think like an architectural model maker: separate volumes for the main block, wings, bays and towers (shell role), each roof plane system as its own roof component (cross gables are gables rotated [0,0,90]; turret spires are pyramids), porch roof, posts (column), railings, steps, chimneys, the foundation (base, stone cladding), and decorative trim. Give each wall/roof its cladding (clapboard, shingle, fishscale, stone, brick, boardbatten). Overlapping volumes are fine: the earlier/ancestor part keeps its shape and later parts are trimmed to it automatically, so list main volumes first.
Rules:
- Work in millimetres in a shared coordinate system: Z up, origin at the centre of the object's base, the object's front faces -Y. Position = base centre of the primitive (primitives rest on their local z = 0 and are centred on X/Y).
- Give dimensions for the REAL object (estimate its real size from cues such as doors, people, wheels); PARTART rescales to the user's target size.
- Be honest about evidence: mark each component observed / inferred / assumed and give a confidence. Never claim exactness from a single view.
- Openings (windows, doors) are role "opening": thin boxes (d ≈ 3) with arch (none/round/pointed) and muntin grid, positioned on the OUTER face of their parent (wall box, tower face or gable end), parented to it. Rotation rz turns local -Y to face outward: 0 = front (-Y), 90 = right (+X), -90 = left (-X), 180 = back, ±45 etc. for tower faces.
- Include repeated elements individually (each window, post and railing its own component) up to about 70 components; summarise further repetition in "repeated".
- Parents must be listed components or null. Part IDs must be unique.
- List what is genuinely uncertain, and which additional photo views or measurements would materially improve the result. Do not request views that would not change the model.`;

function client() {
  // Deliberately do NOT inherit ANTHROPIC_BASE_URL from the shell: only PARTART_ANTHROPIC_BASE_URL can override.
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.PARTART_ANTHROPIC_BASE_URL || "https://api.anthropic.com" });
}

export const claudeProvider: AnalysisProvider = {
  id: "claude-vision",
  available: () => !!process.env.ANTHROPIC_API_KEY,
  async analyse(input) {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    input.images.slice(0, 8).forEach((img, i) => {
      content.push({ type: "text", text: `Reference image ${i + 1} — view: ${img.view}${img.note ? ` — note: ${img.note}` : ""}` });
      content.push({ type: "image", source: { type: "base64", media_type: img.mime as "image/jpeg", data: img.data.toString("base64") } });
    });
    content.push({
      type: "text",
      text: [
        `User description: ${input.description || "(none)"}`,
        `What the user wants to make: ${input.intent || "(not specified)"}`,
        `Category hint: ${input.categoryHint}`,
        input.realSizeMm ? `User-provided real-world size (largest dimension): ${input.realSizeMm} mm — treat as a measurement.` : "Real-world size not provided.",
        input.targetSizeMm ? `Desired finished size (largest dimension): ${input.targetSizeMm} mm.` : "",
        "Analyse the object and return the structured component breakdown.",
      ].join("\n"),
    });
    const resp = await client().beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      system: SYSTEM,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format: zodOutputFormat(AnalysisOut) },
      messages: [{ role: "user", content }],
    });
    if (resp.stop_reason === "refusal") throw new Error("The analysis model declined this image. Try a different photo or use template mode.");
    if (resp.stop_reason === "max_tokens") throw new Error("Analysis was cut off (too many components). Try a simpler reference or fewer images.");
    const out = resp.parsed_output as AnalysisOutT | null;
    if (!out) throw new Error("Analysis returned no parseable result.");
    return normaliseClaude(out, resp.model);
  },
};

function normaliseClaude(out: AnalysisOutT, model: string): AnalysisResult {
  const seen = new Set<string>();
  const comps: AnalysedComponent[] = [];
  for (const c of out.components) {
    let id = c.partId.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (!id.startsWith("C-")) id = `C-${id}`;
    while (seen.has(id)) id = id.replace(/(\d+)$/, (n) => String(Number(n) + 1).padStart(2, "0"));
    seen.add(id);
    const p = c.primitive;
    const pos = (c.position.length === 3 ? c.position : [0, 0, 0]) as Vec3;
    const rot = (c.rotation.length === 3 ? c.rotation : [0, 0, 0]) as Vec3;
    const pos1 = (v: number, f = 1) => (Number.isFinite(v) && v > 0 ? v : f);
    const clad = p.cladding !== "none" ? { cladding: p.cladding } : {};
    const int = (v: number, lo: number, hi: number, f: number) => (Number.isFinite(v) && v >= lo ? Math.min(hi, Math.round(v)) : f);
    let prim: Primitive;
    switch (p.type) {
      case "cylinder": prim = { type: "cylinder", r: pos1(p.r, 5), rTop: p.rTop > 0 && Math.abs(p.rTop - p.r) > 1e-3 ? p.rTop : undefined, h: pos1(p.h) }; break;
      case "ngon": case "pyramid": prim = { type: p.type, n: int(p.n, 3, 24, 8), r: pos1(p.r, pos1(p.w, 20) / 2), h: pos1(p.h), ...clad }; break;
      case "stairs": prim = { type: "stairs", w: pos1(p.w), d: pos1(p.d), h: pos1(p.h), steps: int(p.steps, 1, 40, 3) }; break;
      case "railing": prim = { type: "railing", w: pos1(p.w), h: pos1(p.h), d: pos1(p.d, 2) }; break;
      case "ornament": prim = { type: "ornament", kind: p.ornamentKind === "none" ? "bracket" : p.ornamentKind, w: pos1(p.w), h: pos1(p.h), d: pos1(p.d, 1.5) }; break;
      case "box": prim = {
        type: "box", w: pos1(p.w), d: pos1(p.d), h: pos1(p.h), ...clad,
        ...(c.role === "opening" && p.arch !== "none" ? { arch: p.arch } : {}),
        ...(c.role === "opening" && (p.gridCols > 1 || p.gridRows > 1) ? { grid: [int(p.gridCols, 1, 8, 1), int(p.gridRows, 1, 8, 1)] as [number, number] } : {}),
      }; break;
      case "ellipsoid": prim = { type: "ellipsoid", w: pos1(p.w), d: pos1(p.d), h: pos1(p.h) }; break;
      default: prim = { type: p.type, w: pos1(p.w), d: pos1(p.d), h: pos1(p.h), ...clad };
    }
    comps.push({
      partId: id, name: c.name, role: c.role, parentPartId: c.parentPartId, primitive: prim, position: pos, rotation: rot,
      colorHex: /^#[0-9a-fA-F]{6}$/.test(c.colorHex) ? c.colorHex.toLowerCase() : "#d8c7a8",
      provenance: c.provenance, confidence: Math.max(0, Math.min(1, c.confidence)), notes: c.notes,
    });
  }
  // Drop dangling parents.
  const ids = new Set(comps.map((c) => c.partId));
  comps.forEach((c) => { if (c.parentPartId && (!ids.has(c.parentPartId) || c.parentPartId === c.partId)) c.parentPartId = null; });
  return {
    provider: "claude-vision",
    model,
    category: out.category,
    summary: out.summary,
    components: comps,
    relationships: out.relationships.filter((r) => ids.has(r.from) && ids.has(r.to)),
    findings: {
      objectName: out.objectName, observed: out.observed, inferred: out.inferred, assumptions: out.assumptions,
      uncertainties: out.uncertainties, requestedViews: out.requestedViews, requestedMeasurements: out.requestedMeasurements,
      symmetry: out.symmetry, repeated: out.repeated, materialsObserved: out.materialsObserved, manufacturingIdeas: out.manufacturingIdeas,
      scaleBasis: out.scaleBasis + (out.realSizeEstimateMm ? ` (real object ≈ ${Math.round(out.realSizeEstimateMm)} mm)` : ""),
    },
    raw: out,
  };
}

export function pickProvider(): AnalysisProvider {
  return claudeProvider.available() ? claudeProvider : templateProvider;
}
