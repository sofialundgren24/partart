// Supplier directory. Every entry was found via web search on the date in `verified`; links point to the store
// or category page that appeared in the results — NOT to a guaranteed in-stock product, and no prices are stored.
// Add regions by adding entries; a region with no entries shows "source locally" instead of invented shops.

export interface SupplierRef {
  name: string;
  url: string;
  categories: string[];
  verified: string; // ISO date the listing was seen
  note: string;
}

const SE: SupplierRef[] = [
  { name: "Kjell & Company", url: "https://www.kjell.com/se/produkter/el-verktyg/3d-skrivare/filament", categories: ["filament"], verified: "2026-11-05", note: "Swedish chain; stocks Addnorth (made in Sweden) PLA 1.75 mm, 1 kg. Click & collect in stores." },
  { name: "3DJake (Sweden)", url: "https://www.3djake.se/", categories: ["filament", "resin"], verified: "2026-11-05", note: "Large filament range (Polymaker, nice essentials …)." },
  { name: "Verkkokauppa.com (sv)", url: "https://www.verkkokauppa.com/sv/catalog/filaments/filament", categories: ["filament"], verified: "2026-11-05", note: "Swedish-language store with PLA/PETG/ABS; check delivery to Sweden." },
  { name: "xTool EU — Swedish store", url: "https://www.xtool.eu/sv/collections/shop-all", categories: ["wood", "acrylic"], verified: "2026-11-05", note: "Laser-ready 3 mm plywood and cast acrylic sheets sized for xTool machines. Listings note size/thickness tolerances — measure." },
  { name: "Bauhaus (Sweden)", url: "https://www.bauhaus.se/hobbyskiva-akryl-klar-3x1000x1250mm", categories: ["acrylic"], verified: "2026-11-05", note: "Clear hobby acrylic in large stock sizes (e.g. 3 × 1000 × 1250 mm). Listing is Riacryl XT — 'XT' usually means extruded, which cuts less cleanly than cast; check before buying." },
];

const DIRECTORY: Record<string, SupplierRef[]> = { SE };

export const REGIONS = [
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },
  { code: "FI", name: "Finland" },
  { code: "DE", name: "Germany" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
];

export function suppliersFor(region: string, category: string): SupplierRef[] {
  return (DIRECTORY[region] ?? []).filter((s) => s.categories.includes(category));
}

export function hasDirectory(region: string) {
  return (DIRECTORY[region] ?? []).length > 0;
}
