// Assembly sequence: parents before children, siblings with the same role grouped into one step.
// Adhesives and tools are chosen from the actual materials meeting at each joint.

import { material, type MaterialDef } from "../materials/catalog";
import { isDoor } from "../geometry/types";
import type { ResolvedPart } from "./resolve";

export interface AssemblyStepDef {
  index: number;
  title: string;
  partIds: string[];
  attachTo: string | null;
  instructions: string[];
  tools: string[];
  adhesives: string[];
  warnings: string[];
}

export function adhesiveFor(a: MaterialDef, b: MaterialDef | null): { glue: string; note: string } {
  const kinds = [a.kind, b?.kind ?? a.kind].sort().join("+");
  const transparent = a.transparent || b?.transparent;
  if (transparent) return { glue: "Clear canopy/contact glue (e.g. canopy glue or clear UV-cure adhesive)", note: "Avoid cyanoacrylate near clear acrylic — its vapour fogs ('blooms') the surface." };
  if (kinds === "sheet+sheet" && a.key.startsWith("acrylic") && b?.key.startsWith("acrylic")) return { glue: "Acrylic solvent cement", note: "Solvent cements are hazardous — ventilate, gloves, follow the label." };
  if (kinds === "sheet+sheet") return { glue: "PVA wood glue", note: "Clamp or tape joints for 20–30 min." };
  if (kinds.includes("paper")) return { glue: "PVA craft glue or glue stick", note: "Use very little glue so the card does not warp." };
  if (kinds.includes("clay")) return { glue: "Two-part epoxy or gel cyanoacrylate", note: "Bake polymer-clay parts before gluing." };
  if (kinds === "filament+filament" || kinds === "filament+resin" || kinds === "resin+resin") return { glue: "Gel cyanoacrylate (superglue)", note: "Scuff mating faces with 240-grit for a stronger bond." };
  return { glue: "Two-part 5-minute epoxy or gel cyanoacrylate", note: "Mixed-material joint: scuff both faces first." };
}

function toolsFor(method: string): string[] {
  switch (method) {
    case "print": return ["Flush cutters (support removal)", "Needle files / 240-grit sandpaper"];
    case "laser": return ["Masking tape or small clamps", "180-grit sandpaper"];
    case "paper": return ["Craft knife", "Metal ruler", "Bone folder or empty ballpoint (scoring)"];
    case "cardboard": return ["Craft knife", "Metal ruler", "Cutting mat"];
    case "manual": return ["Sculpting tools", "Oven (per clay brand)"];
    default: return [];
  }
}

/** How to make the part itself from its pieces (only for multi-piece constructions). */
function buildInstruction(child: ResolvedPart): string | null {
  const c = child.comp;
  if (c.role === "opening") return null;
  switch (child.method) {
    case "laser":
    case "cardboard":
      return c.primitive.type === "box"
        ? `Build ${c.partId} from its panels (${c.partId}-P01…): dry-fit the walls at the corners, drop the wall tabs into the floor slots, check it is square, then glue all joints.`
        : c.primitive.type === "gable" || c.primitive.type === "wedge"
          ? `Build ${c.partId}: stand the end pieces up, then glue the sloped panels onto them following the engraved alignment lines.`
          : `Build ${c.partId}: stack the slices in label order on a 3 mm dowel through the centre holes, gluing each layer; sand the stepped edge smooth.`;
    case "paper": return `Build ${c.partId}: score all fold lines, cut it out, fold and glue the tabs inside.`;
    case "manual": return `Sculpt ${c.partId} (${c.name}) to the dimensions in the parts list.`;
    default: return `Remove supports from ${c.partId} and clean up the contact faces.`;
  }
}

function joinInstruction(child: ResolvedPart, parent: ResolvedPart | null): string {
  const c = child.comp;
  const build = buildInstruction(child);
  if (!parent) return build ?? `Prepare ${c.partId}.`;
  const p = parent.comp;
  let attach: string;
  if (c.role === "opening") {
    const m = material(child.materialKey);
    attach = m.transparent
      ? `Glue the pane ${c.partId} behind its opening in ${p.partId} from the inside; remove the protective film from the visible face only after gluing.`
      : isDoor(c)
        ? `Glue the door leaf ${c.partId} behind the doorway in ${p.partId}, raised panels facing out.`
        : `Glue the frame ${c.partId} over its opening in ${p.partId} from the outside, centred on the hole.`;
  } else if (c.role === "roof") attach = `Set ${c.partId} (${c.name}) onto the top of ${p.partId}, check the overhang is even on all sides, then glue along the wall tops.`;
  else if (c.role === "wheel") attach = `Slide ${c.partId} onto its axle ${p.partId}; leave it free to spin — glue only a stop or cap at the outer end.`;
  else if (c.role === "axle") attach = `Pass axle ${c.partId} through/under ${p.partId} at the marked position.`;
  else attach = `Attach ${c.partId} (${c.name}) to ${p.partId} at its marked position.`;
  return build && child.method !== "print" ? `${build} Then: ${attach}` : attach;
}

export function assemblySequence(roots: ResolvedPart[]): AssemblyStepDef[] {
  const steps: AssemblyStepDef[] = [];
  const parentOf = new Map<string, ResolvedPart | null>();
  const visit = (n: ResolvedPart, parent: ResolvedPart | null) => { parentOf.set(n.comp.partId, parent); n.children.forEach((ch) => visit(ch, n)); };
  roots.forEach((r) => visit(r, null));

  const add = (group: ResolvedPart[], parent: ResolvedPart | null) => {
    const live = group.filter((g) => g.method !== "omit");
    if (!live.length) return;
    const first = live[0];
    const a = material(first.materialKey);
    const b = parent ? material(parent.materialKey) : null;
    const adh = adhesiveFor(a, b);
    const title = live.length > 1
      ? `${roleTitle(first.comp.role)} ×${live.length}${parent ? ` → ${parent.comp.name}` : ""}`
      : `${first.comp.name}${parent ? ` → ${parent.comp.name}` : ""}`;
    const warnings: string[] = [adh.note];
    if (first.comp.role === "roof") warnings.push("Let the walls cure fully before loading them with the roof.");
    steps.push({
      index: steps.length + 1,
      title,
      partIds: live.map((g) => g.comp.partId),
      attachTo: parent?.comp.partId ?? null,
      instructions: live.map((g) => joinInstruction(g, parent)),
      tools: Array.from(new Set(live.flatMap((g) => toolsFor(g.method)))),
      adhesives: [adh.glue],
      warnings,
    });
  };

  // Breadth-first so that structure goes together before details.
  let level: { node: ResolvedPart; parent: ResolvedPart | null }[] = roots.map((r) => ({ node: r, parent: null }));
  while (level.length) {
    const byKey = new Map<string, { nodes: ResolvedPart[]; parent: ResolvedPart | null }>();
    for (const { node, parent } of level) {
      const key = `${parent?.comp.partId ?? "root"}|${node.comp.role}|${node.method}|${node.materialKey}`;
      if (!byKey.has(key)) byKey.set(key, { nodes: [], parent });
      byKey.get(key)!.nodes.push(node);
    }
    for (const { nodes, parent } of byKey.values()) {
      if (parent === null) nodes.forEach((n) => add([n], null));
      else add(nodes, parent);
    }
    level = level.flatMap(({ node }) => node.children.map((ch) => ({ node: ch, parent: node })));
  }
  return steps;
}

function roleTitle(role: string) {
  const map: Record<string, string> = { opening: "Windows & doors", wheel: "Wheels", limb: "Limbs", detail: "Details", hand: "Hands", foot: "Feet", axle: "Axles" };
  return map[role] ?? role[0].toUpperCase() + role.slice(1);
}
