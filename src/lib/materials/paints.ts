// Generic hobby-paint palette (colour names, not brands or products — no prices or links are implied).
// Each part's colour from the analysis is matched to the nearest paint so the catalogue can say
// "paint C-ROOF-01 Slate grey".

export interface Paint { key: string; name: string; hex: string }

export const PAINTS: Paint[] = [
  { key: "chalk-white", name: "Chalk white", hex: "#f4f1ea" },
  { key: "warm-white", name: "Warm white", hex: "#efe6d2" },
  { key: "light-grey", name: "Light grey", hex: "#c9ccd0" },
  { key: "dove-grey", name: "Dove grey", hex: "#a3a6aa" },
  { key: "stone-grey", name: "Stone grey", hex: "#8a8a86" },
  { key: "slate-grey", name: "Slate grey", hex: "#5b6168" },
  { key: "charcoal", name: "Charcoal", hex: "#33363a" },
  { key: "graphite", name: "Graphite", hex: "#4a4b4e" },
  { key: "pewter", name: "Pewter grey", hex: "#6f7378" },
  { key: "umber", name: "Dark umber", hex: "#4b3f38" },
  { key: "black", name: "Black", hex: "#1d1d1d" },
  { key: "cream", name: "Cream", hex: "#e9d8b8" },
  { key: "sand", name: "Sand", hex: "#d8c39a" },
  { key: "ochre", name: "Ochre", hex: "#c99a3c" },
  { key: "gold", name: "Antique gold", hex: "#c9a24a" },
  { key: "butter", name: "Butter yellow", hex: "#f2d36b" },
  { key: "orange", name: "Orange", hex: "#e07b39" },
  { key: "terracotta", name: "Terracotta", hex: "#b5523b" },
  { key: "brick-red", name: "Brick red", hex: "#8e3b2e" },
  { key: "burgundy", name: "Burgundy", hex: "#6b2430" },
  { key: "dusty-pink", name: "Dusty pink", hex: "#e8a0b4" },
  { key: "plum", name: "Plum", hex: "#4b2c4f" },
  { key: "navy", name: "Navy", hex: "#2c3e5a" },
  { key: "sky", name: "Sky blue", hex: "#a9d1e0" },
  { key: "sage", name: "Sage green", hex: "#9aa98a" },
  { key: "moss", name: "Moss green", hex: "#6d7a4a" },
  { key: "forest", name: "Forest green", hex: "#3f5b3a" },
  { key: "tan", name: "Tan", hex: "#b88d62" },
  { key: "walnut", name: "Walnut brown", hex: "#6b3e2e" },
];

function rgb(hex: string) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** Nearest paint by a perceptually weighted RGB distance ("redmean"). */
export function nearestPaint(hex: string): Paint {
  const [r1, g1, b1] = rgb(hex);
  let best = PAINTS[0], bd = Infinity;
  for (const p of PAINTS) {
    const [r2, g2, b2] = rgb(p.hex);
    const rm = (r1 + r2) / 2;
    const d = (2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
