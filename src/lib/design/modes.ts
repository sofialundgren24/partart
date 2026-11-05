// "Make it your way" — design modes. Each mode is a rule set that assigns a manufacturing method + material to
// every component (with a stated reason). The user can then override any single component.

import type { ComponentSpec } from "../geometry/types";
import { isDoor, primitiveSize } from "../geometry/types";
import type { Method } from "../materials/catalog";

export type ModeKey = "realistic" | "woodwork" | "acrylic" | "stylized" | "mixed" | "papercraft" | "cardboard" | "sculptural" | "flatpack" | "collectible";

export interface DesignControls {
  detail: number; // 0..1 — components smaller than (1 - detail) × 12 % of the object are omitted
  difficulty: "easy" | "medium" | "hard"; // easy = butt joints / fewer parts
  targetSizeMm: number | null; // overrides project target size for this design
  palette: "reference" | "bold" | "natural" | "mono";
  finish: "raw" | "painted" | "oiled" | "polished";
}

export const DEFAULT_CONTROLS: DesignControls = { detail: 0.8, difficulty: "medium", targetSizeMm: null, palette: "reference", finish: "raw" };

export interface ModeDef {
  key: ModeKey;
  name: string;
  fruit: "orange" | "apple" | "strawberry" | "pear" | "tomato" | "lemon";
  blurb: string;
  equipment: string[];
}

export const MODES: ModeDef[] = [
  { key: "realistic", name: "Realistic", fruit: "tomato", blurb: "Faithful 3D-printed reproduction with separate parts for painting.", equipment: ["FDM or resin 3D printer"] },
  { key: "woodwork", name: "Woodwork", fruit: "pear", blurb: "Laser-cut birch plywood with finger joints, clear acrylic windows, layered round parts.", equipment: ["Laser cutter (≥10 W diode or CO₂)"] },
  { key: "acrylic", name: "Acrylic", fruit: "strawberry", blurb: "Coloured and clear cast acrylic panels, glowing windows.", equipment: ["CO₂ laser recommended (diode lasers can't cut clear acrylic)"] },
  { key: "stylized", name: "Stylized", fruit: "orange", blurb: "Simplified, bold, fewer pieces — small details dropped, graphic colours.", equipment: ["FDM 3D printer"] },
  { key: "mixed", name: "Mixed media", fruit: "apple", blurb: "Each part made the best way: sheet walls, printed curves and details, clear windows.", equipment: ["Laser cutter", "FDM 3D printer"] },
  { key: "papercraft", name: "Papercraft", fruit: "lemon", blurb: "Printable fold nets with glue tabs — needs only a printer, knife and glue.", equipment: ["Paper printer", "Craft knife, ruler, cutting mat"] },
  { key: "cardboard", name: "Cardboard", fruit: "orange", blurb: "Layered and slotted cardboard, cut by laser or by hand.", equipment: ["Craft knife or laser cutter"] },
  { key: "sculptural", name: "Sculptural", fruit: "tomato", blurb: "Printed structure + hand-sculpted polymer-clay organic forms.", equipment: ["FDM 3D printer", "Oven for polymer clay", "Sculpting tools"] },
  { key: "flatpack", name: "Flat-pack", fruit: "pear", blurb: "MDF sheet parts that slot together, minimal tools.", equipment: ["Laser cutter"] },
  { key: "collectible", name: "Collectible", fruit: "strawberry", blurb: "Display-quality print with a plinth and a curated palette.", equipment: ["FDM or resin 3D printer"] },
];

export interface AssignmentProposal {
  partId: string;
  method: Method;
  materialKey: string;
  colorHex: string | null;
  reason: string;
}

const BOLD = ["#e8553f", "#f29b38", "#f2c94c", "#7a9a5b", "#e86a92", "#4b2c4f"];
const NATURAL = ["#d9b98a", "#b88d62", "#8f8a80", "#c9a06b", "#a3876a"];

const isFlatish = (c: ComponentSpec) => c.primitive.type === "box" || c.primitive.type === "gable" || c.primitive.type === "wedge";
const isRound = (c: ComponentSpec) => c.primitive.type === "cylinder" || c.primitive.type === "ellipsoid";
const isOrganic = (c: ComponentSpec) => ["head", "torso", "limb", "hand", "foot"].includes(c.role) || c.primitive.type === "ellipsoid";

export function proposeAssignments(mode: ModeKey, comps: ComponentSpec[], controls: DesignControls): AssignmentProposal[] {
  const maxDim = Math.max(1, ...comps.map((c) => Math.max(...primitiveSize(c.primitive))));
  const threshold = (1 - controls.detail) * 0.12 * maxDim;
  return comps.map((c, i) => {
    const size = Math.max(...primitiveSize(c.primitive));
    const small = size < threshold && c.role !== "opening" && c.role !== "base";
    const paint = (fallback: string | null) =>
      controls.palette === "bold" ? BOLD[i % BOLD.length] : controls.palette === "natural" ? NATURAL[i % NATURAL.length] : controls.palette === "mono" ? "#e9e4da" : fallback;
    const P = (method: Method, materialKey: string, reason: string, color: string | null = c.colorHex): AssignmentProposal => ({
      partId: c.partId, method, materialKey, colorHex: paint(color), reason,
    });
    if (small) return P("omit", "pla", `Omitted at detail level ${Math.round(controls.detail * 100)} % (largest dimension ${size.toFixed(0)} mm).`);
    if (c.primitive.type === "mesh") return P("print", "pla", "Imported scan meshes can only be 3D printed.");
    switch (mode) {
      case "realistic":
        return P("print", c.role === "opening" ? "petg" : "pla", c.role === "opening" ? "Printed frame; glaze with clear film or acrylic offcut." : "Printed for full detail.");
      case "collectible":
        return P("print", c.role === "detail" || c.role === "head" || c.role === "hand" ? "pla-silk" : "pla", "Display-quality print; fine details in silk PLA (or resin if you have one).");
      case "stylized":
        return P("print", "pla", "Printed in a flat, bold colour.", BOLD[i % BOLD.length]);
      case "woodwork":
        if (isDoor(c)) return P("laser", "plywood-3", "Plywood door leaf set behind the doorway.", "#b88d62");
        if (c.role === "opening") return P("laser", "acrylic-clear-2", "Clear acrylic pane behind a cut-out opening.", "#cfe8f0");
        return P("laser", "plywood-3", isRound(c) ? "Round form built from stacked plywood slices." : "Flat panels with finger joints.", "#d9b98a");
      case "flatpack":
        if (c.role === "opening") return P("laser", "mdf-3", "Flat frame glued over the opening.", "#b88d62");
        return P("laser", "mdf-3", isRound(c) ? "Stacked slices on a dowel." : "Slot-together MDF panels.", "#b88d62");
      case "acrylic":
        if (isDoor(c)) return P("laser", "acrylic-color-3", "Coloured acrylic door leaf.", c.colorHex);
        if (c.role === "opening") return P("laser", "acrylic-frost-3", "Frosted acrylic pane — diffuses light.", "#e8eef0");
        return P("laser", "acrylic-color-3", "Coloured acrylic panels.", c.colorHex);
      case "papercraft":
        return P("paper", "cardstock-250", c.role === "opening" ? "Paper frame around a cut-out window." : "Fold net with glue tabs.", c.colorHex);
      case "cardboard":
        return P("cardboard", c.primitive.type === "box" && size < 60 ? "greyboard-2" : "cardboard-3", isRound(c) ? "Stacked cardboard slices." : "Tab-and-slot cardboard panels.", "#c49a6c");
      case "sculptural":
        if (isOrganic(c)) return P("manual", "polymer-clay", "Hand-sculpted in polymer clay (use the printed proxy as a size reference/armature).", c.colorHex);
        return P("print", "pla", "Printed structure / base.");
      case "mixed": {
        if (isDoor(c)) return P("print", "pla", "Printed door leaf — room for panel and handle detail.", c.colorHex);
        if (c.role === "opening") return P("laser", "acrylic-clear-2", "Clear acrylic for real transparency.", "#cfe8f0");
        if (c.role === "roof") return P("print", "pla", "Roof printed so tile/shingle texture and pitch come out cleanly.", c.colorHex);
        if (c.role === "wheel" || c.role === "axle") return P("print", "pla", "Round, precise parts → 3D print.");
        if (isOrganic(c) || c.role === "detail" || c.role === "accessory") return P("print", "pla", "Curved or small detail → 3D print.");
        if (isFlatish(c) && size > 40) return P("laser", "plywood-3", "Large flat surfaces → laser-cut plywood (fast, cheap, rigid).", "#d9b98a");
        return P("print", "pla", "Small or complex → 3D print.");
      }
    }
  });
}

/** Extra parts a mode adds to the design (not part of the reference), e.g. a display plinth. */
export function modeExtras(mode: ModeKey, comps: ComponentSpec[]): ComponentSpec[] {
  if (mode !== "collectible") return [];
  if (comps.some((c) => c.role === "base")) return [];
  const maxW = Math.max(40, ...comps.map((c) => Math.max(primitiveSize(c.primitive)[0], primitiveSize(c.primitive)[1])));
  return [{
    partId: "C-PLINTH-01", name: "Display plinth", role: "base", parentPartId: null,
    primitive: { type: "cylinder", r: maxW * 0.65, rTop: maxW * 0.6, h: 12 }, position: [0, 0, -12], rotation: [0, 0, 0],
    colorHex: "#4b2c4f", provenance: "user", confidence: 1,
  }];
}
