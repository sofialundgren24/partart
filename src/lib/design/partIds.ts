const CODES: Record<string, string> = {
  base: "BASE", structure: "STRUCT", shell: "BODY", roof: "ROOF", opening: "WIN", detail: "DET", joint: "JOINT",
  wheel: "WHEEL", axle: "AXLE", head: "HEAD", torso: "TORSO", limb: "LIMB", hand: "HAND", foot: "FOOT", accessory: "ACC", imported: "SCAN",
  ornament: "ORN", column: "POST", railing: "RAIL", stairs: "STAIR", chimney: "CHIM",
};

export function nextPartId(existing: string[], role: string): string {
  const code = CODES[role] ?? "PART";
  let n = 1;
  const set = new Set(existing);
  while (set.has(`C-${code}-${String(n).padStart(2, "0")}`)) n++;
  return `C-${code}-${String(n).padStart(2, "0")}`;
}
