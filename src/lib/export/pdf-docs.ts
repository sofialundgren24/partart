// PDF documents: assembly guide (with rendered diagrams of the real geometry) and simple text reports.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { project, type RenderItem } from "./render";

const INK = rgb(0.18, 0.12, 0.2);
const TOMATO = rgb(0.91, 0.33, 0.25);

/** Replace characters the standard WinAnsi fonts cannot encode. */
export function safe(s: string): string {
  return s
    .replace(/[×]/g, "x").replace(/[−–—]/g, "-").replace(/[≈]/g, "~").replace(/[≥]/g, ">=").replace(/[≤]/g, "<=")
    .replace(/[²]/g, "2").replace(/[₂]/g, "2").replace(/[→]/g, "->").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[°]/g, " deg").replace(/[Ø]/g, "D").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(public pdf: PDFDocument, public font: PDFFont, public bold: PDFFont, public title: string) {}
  newPage() {
    this.page = this.pdf.addPage([595, 842]);
    this.y = 800;
    this.page.drawText(safe(this.title), { x: 40, y: 815, size: 8, font: this.font, color: rgb(0.5, 0.45, 0.5) });
  }
  ensure(h: number) { if (this.y - h < 40) this.newPage(); }
  h1(t: string) { this.ensure(40); this.page.drawText(safe(t), { x: 40, y: this.y - 22, size: 20, font: this.bold, color: INK }); this.y -= 34; }
  h2(t: string) { this.ensure(28); this.page.drawText(safe(t), { x: 40, y: this.y - 14, size: 13, font: this.bold, color: TOMATO }); this.y -= 22; }
  p(t: string, size = 10, indent = 0) {
    const words = safe(t).split(/\s+/);
    let line = "";
    const maxW = 515 - indent;
    const flush = () => { this.ensure(size + 4); this.page.drawText(line, { x: 40 + indent, y: this.y - size, size, font: this.font, color: INK }); this.y -= size + 4; line = ""; };
    for (const w of words) {
      const next = line ? line + " " + w : w;
      if (this.font.widthOfTextAtSize(next, size) > maxW) flush();
      line = line ? line + " " + w : w;
    }
    if (line) flush();
  }
  bullet(t: string) { this.p("- " + t, 10, 8); }
  gap(h = 8) { this.y -= h; }
  drawRender(items: RenderItem[], h = 260) {
    this.ensure(h + 10);
    const { tris, bounds } = project(items);
    const bw = bounds.maxX - bounds.minX || 1, bh = bounds.maxY - bounds.minY || 1;
    const s = Math.min(515 / bw, h / bh);
    const ox = 40 + (515 - bw * s) / 2 - bounds.minX * s;
    const top = this.y;
    for (const t of tris) {
      const d = t.pts.map((p, i) => `${i ? "L" : "M"}${(p[0] * s + ox - 40).toFixed(1)} ${((p[1] - bounds.minY) * s).toFixed(1)}`).join(" ") + " Z";
      const c = hex(t.fill);
      this.page.drawSvgPath(d, { x: 40, y: top, color: rgb(c[0], c[1], c[2]), opacity: t.opacity, borderColor: t.stroke ? TOMATO : undefined, borderWidth: t.stroke ? 0.4 : 0 });
    }
    this.y -= bh * s + 10;
  }
}

function hex(h: string): [number, number, number] {
  const x = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255) as [number, number, number];
}

export interface GuideStep {
  index: number;
  title: string;
  partIds: string[];
  instructions: string[];
  tools: string[];
  adhesives: string[];
  warnings: string[];
}

export interface PartRow { partId: string; name: string; method: string; material: string; files: string[]; size: string }

export async function assemblyGuidePdf(opts: {
  title: string;
  readiness: string;
  parts: PartRow[];
  steps: GuideStep[];
  renderItems: RenderItem[]; // assembled, one per partId (low-poly)
  exploded: RenderItem[];
  finalChecks: string[];
}): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(safe(opts.title + " - assembly guide"));
  const w = new Writer(pdf, await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold), opts.title);
  w.newPage();
  w.h1(opts.title);
  w.p(`PARTART assembly guide. Manufacturing readiness: ${opts.readiness.replace(/_/g, " ")}.`);
  w.p("Diagrams are rendered from the generated manufacturing geometry (simplified shading). Part IDs match the file names, sheet labels and the 3D viewer.", 8);
  w.gap();
  w.drawRender(opts.renderItems, 300);
  w.newPage();
  w.h2("1. Parts list");
  for (const r of opts.parts) w.p(`${r.partId}  ${r.name}  |  ${r.method} / ${r.material}  |  ${r.size}  |  ${r.files.join(", ") || "instructions only"}`, 8);
  w.newPage();
  w.h2("2. Exploded view");
  w.drawRender(opts.exploded, 520);
  for (const s of opts.steps) {
    w.newPage();
    w.h2(`Step ${s.index}: ${s.title}`);
    const done = new Set(opts.steps.filter((x) => x.index < s.index).flatMap((x) => x.partIds));
    const now = new Set(s.partIds);
    w.drawRender(
      opts.renderItems.filter((r) => done.has(r.id) || now.has(r.id)).map((r) => ({ ...r, style: now.has(r.id) ? "highlight" : "ghost" })),
      260,
    );
    w.p(`Parts: ${s.partIds.join(", ")}`, 9);
    w.gap(4);
    s.instructions.forEach((i) => w.bullet(i));
    w.gap(4);
    w.p(`Tools: ${s.tools.join(", ") || "-"}`, 9);
    w.p(`Adhesive: ${s.adhesives.join(", ")}`, 9);
    s.warnings.filter(Boolean).forEach((x) => w.p(`! ${x}`, 9));
    w.p("Time: not estimated (depends on glue cure times and experience).", 8);
  }
  w.newPage();
  w.h2("Final inspection");
  opts.finalChecks.forEach((c) => w.bullet(c));
  return Buffer.from(await pdf.save());
}

export async function textPdf(title: string, sections: { heading: string; lines: string[] }[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(safe(title));
  const w = new Writer(pdf, await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold), title);
  w.newPage();
  w.h1(title);
  for (const s of sections) {
    w.h2(s.heading);
    s.lines.forEach((l) => w.p(l, 9));
    w.gap(6);
  }
  return Buffer.from(await pdf.save());
}
