// Material catalogue. Physical properties only — no prices (prices are never invented; see materials/suppliers.ts).

export type Method = "print" | "laser" | "paper" | "cardboard" | "manual" | "omit";

export interface MaterialDef {
  key: string;
  name: string;
  kind: "filament" | "resin" | "sheet" | "paper" | "fabric" | "clay" | "finish" | "wood" | "metal";
  methods: Method[];
  thicknessMm?: number; // nominal sheet thickness — real stock varies, measure it
  densityGcm3?: number;
  colorHex: string;
  transparent?: boolean;
  notes: string;
}

export const MATERIALS: MaterialDef[] = [
  { key: "pla", name: "PLA filament 1.75 mm", kind: "filament", methods: ["print"], densityGcm3: 1.24, colorHex: "#e9e4da", notes: "Easiest to print. Softens around 55 °C — keep out of hot cars and windows." },
  { key: "petg", name: "PETG filament 1.75 mm", kind: "filament", methods: ["print"], densityGcm3: 1.27, colorHex: "#cfe3e6", notes: "Tougher and more heat resistant than PLA; strings more." },
  { key: "pla-silk", name: "Silk PLA 1.75 mm", kind: "filament", methods: ["print"], densityGcm3: 1.24, colorHex: "#d9b46a", notes: "Glossy decorative finish, slightly weaker layer adhesion." },
  { key: "resin-std", name: "Standard photopolymer resin", kind: "resin", methods: ["print"], densityGcm3: 1.1, colorHex: "#b9b3a9", notes: "MSLA printers only. Wear gloves; wash and post-cure. Use for very fine collectible detail." },
  { key: "plywood-3", name: "Birch plywood 3 mm", kind: "sheet", methods: ["laser"], thicknessMm: 3, colorHex: "#d9b98a", notes: "Laser-grade (interior glue) birch ply. Thickness often measures 2.8–3.2 mm — measure and update the profile." },
  { key: "plywood-4", name: "Birch plywood 4 mm", kind: "sheet", methods: ["laser"], thicknessMm: 4, colorHex: "#d4b07c", notes: "Stiffer panels for larger builds." },
  { key: "mdf-3", name: "MDF 3 mm", kind: "sheet", methods: ["laser"], thicknessMm: 3, colorHex: "#b88d62", notes: "Very flat and cheap, paints well, dark cut edges. Cutting produces fine dust — ventilate." },
  { key: "acrylic-clear-2", name: "Clear cast acrylic 2 mm", kind: "sheet", methods: ["laser"], thicknessMm: 2, colorHex: "#cfe8f0", transparent: true, notes: "Use CAST acrylic for laser cutting (clean polished edge). Keep the protective film on while cutting." },
  { key: "acrylic-frost-3", name: "Frosted acrylic 3 mm", kind: "sheet", methods: ["laser"], thicknessMm: 3, colorHex: "#e8eef0", transparent: true, notes: "Diffuses light — good for lit windows." },
  { key: "acrylic-color-3", name: "Coloured acrylic 3 mm", kind: "sheet", methods: ["laser"], thicknessMm: 3, colorHex: "#e8553f", notes: "Opaque or tinted cast acrylic." },
  { key: "cardboard-3", name: "Corrugated cardboard 3 mm", kind: "sheet", methods: ["laser", "cardboard"], thicknessMm: 3, colorHex: "#c49a6c", notes: "Laser-cuttable at low power with air assist; never leave unattended (fire risk). Can also be cut by hand." },
  { key: "greyboard-2", name: "Greyboard 2 mm", kind: "sheet", methods: ["laser", "cardboard"], thicknessMm: 2, colorHex: "#9a968e", notes: "Dense bookbinding board, cuts cleanly by hand with a craft knife." },
  { key: "cardstock-250", name: "Cardstock 250 g/m²", kind: "paper", methods: ["paper"], thicknessMm: 0.3, colorHex: "#f3ead8", notes: "Prints on most inkjet/laser printers (check max paper weight). Score folds before folding." },
  { key: "paper-160", name: "Paper 160 g/m²", kind: "paper", methods: ["paper"], thicknessMm: 0.2, colorHex: "#faf5ea", notes: "Thinner, easier to fold small details." },
  { key: "polymer-clay", name: "Polymer clay", kind: "clay", methods: ["manual"], colorHex: "#d98c6a", notes: "Oven-cured per the brand's instructions. Can be sculpted over a printed armature." },
  { key: "fabric-cotton", name: "Thin cotton fabric", kind: "fabric", methods: ["manual"], colorHex: "#efe3d0", notes: "Curtains, clothing. Seal edges with fray check or diluted PVA." },
  { key: "dowel-birch", name: "Round birch dowel", kind: "wood", methods: ["manual"], densityGcm3: 0.65, colorHex: "#d9b98a", notes: "Turned-look posts and columns: cut to length, sand, paint. Choose the diameter in the parts list." },
  { key: "brass-rod", name: "Brass rod / tube", kind: "metal", methods: ["manual"], densityGcm3: 8.5, colorHex: "#c9a24a", notes: "Thin posts, finial spikes, railings and axles. Cut with a razor saw or rotary tool; glue with epoxy." },
  { key: "brass-sheet-05", name: "Brass sheet 0.5 mm", kind: "metal", methods: ["manual"], thicknessMm: 0.5, densityGcm3: 8.5, colorHex: "#d4af5a", notes: "Hand-cut flashing, cresting or hardware. Not for diode/CO₂ lasers (metal needs a fibre laser)." },
  { key: "paint-acrylic", name: "Acrylic paint", kind: "finish", methods: ["manual"], colorHex: "#c0392b", notes: "Hand-painted details." },
];

export function material(key: string): MaterialDef {
  const m = MATERIALS.find((x) => x.key === key);
  if (!m) throw new Error(`Unknown material ${key}`);
  return m;
}

export function defaultMaterialFor(method: Method): string {
  switch (method) {
    case "print": return "pla";
    case "laser": return "plywood-3";
    case "paper": return "cardstock-250";
    case "cardboard": return "cardboard-3";
    case "manual": return "polymer-clay";
    case "omit": return "pla";
  }
}
