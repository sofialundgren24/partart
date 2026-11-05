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
    const t = templateFor(input.categoryHint);
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
  type: z.enum(["box", "gable", "wedge", "cylinder", "ellipsoid"]),
  w: z.number().describe("box/gable/wedge/ellipsoid: size along X in mm; 0 for cylinder"),
  d: z.number().describe("size along Y in mm; 0 for cylinder"),
  h: z.number().describe("height along Z in mm"),
  r: z.number().describe("cylinder bottom radius in mm; 0 otherwise"),
  rTop: z.number().describe("cylinder top radius in mm (equal to r for a straight cylinder); 0 otherwise"),
});

const ComponentOut = z.object({
  partId: z.string().describe("Persistent ID like C-ROOF-01, C-WIN-03: 'C-' + short uppercase role code + '-' + two digits"),
  name: z.string(),
  role: z.enum(["base", "structure", "shell", "roof", "opening", "detail", "joint", "wheel", "axle", "head", "torso", "limb", "hand", "foot", "accessory"]),
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
Decompose the object into a hierarchy of physical components that a maker could build separately, and approximate each with ONE primitive (box, gable = triangular prism with ridge along X, wedge = ramp, cylinder/cone, ellipsoid).
Rules:
- Work in millimetres in a shared coordinate system: Z up, origin at the centre of the object's base, the object's front faces -Y. Position = base centre of the primitive (primitives rest on their local z = 0 and are centred on X/Y).
- Give dimensions for the REAL object (estimate its real size from cues such as doors, people, wheels); PARTART rescales to the user's target size.
- Be honest about evidence: mark each component observed / inferred / assumed and give a confidence. Never claim exactness from a single view.
- Openings (windows, doors) are role "opening": thin boxes (d ≈ 3) positioned on the outer face of their parent wall, parented to it, with rotation [0,0,90] for openings on side (±X) walls.
- Include repeated elements individually (each window its own component) up to about 40 components; summarise further repetition in "repeated".
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
    let prim: Primitive;
    if (p.type === "cylinder") prim = { type: "cylinder", r: pos1(p.r, 5), rTop: p.rTop > 0 && Math.abs(p.rTop - p.r) > 1e-3 ? p.rTop : undefined, h: pos1(p.h) };
    else prim = { type: p.type, w: pos1(p.w), d: pos1(p.d), h: pos1(p.h) };
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
