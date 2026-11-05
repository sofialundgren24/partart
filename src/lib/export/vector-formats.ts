// SVG / DXF / PDF writers for sheet layouts.
// Colour convention (works as layer mapping in LightBurn and xTool Creative Space; verify in your software):
//   CUT     #FF0000  red    — cut through
//   ENGRAVE #0000FF  blue   — line engrave / mark (labels, alignment marks)
//   SCORE   #00A000  green  — low-power score (laser) or fold line (paper)

import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import type { SheetLayout } from "../manufacture/nest";
import type { Poly } from "../manufacture/panels";

const COL = { CUT: "#FF0000", ENGRAVE: "#0000FF", SCORE: "#00A000" };

function pathD(poly: Poly, closed: boolean) {
  return poly.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(3)} ${p[1].toFixed(3)}`).join(" ") + (closed ? " Z" : "");
}

function escXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sheetSvg(layout: SheetLayout, sheetIndex: number, opts: { title: string; forPrint?: boolean }): string {
  const s = layout.sheets[sheetIndex];
  const W = layout.sheetW, H = layout.sheetH;
  const sw = opts.forPrint ? 0.3 : 0.01; // hairline for lasers; visible weight for paper printing
  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">`);
  out.push(`<title>${escXml(opts.title)}</title>`);
  out.push(`<desc>PARTART sheet ${sheetIndex + 1}/${layout.sheets.length} — ${escXml(layout.materialKey)} ${layout.thicknessMm} mm — kerf compensation ${layout.kerfMm} mm applied — units mm</desc>`);
  out.push(`<g id="CUT" fill="none" stroke="${COL.CUT}" stroke-width="${sw}">`);
  for (const p of s.placed) {
    out.push(`<path data-panel="${p.panel.panelId}" d="${p.cut.map((c) => pathD(c, true)).join(" ")}"/>`);
  }
  out.push(`</g>`);
  out.push(`<g id="SCORE" fill="none" stroke="${COL.SCORE}" stroke-width="${sw}"${opts.forPrint ? ` stroke-dasharray="2 1.5"` : ""}>`);
  for (const p of s.placed) for (const l of p.score) out.push(`<path d="${pathD(l, false)}"/>`);
  out.push(`</g>`);
  out.push(`<g id="ENGRAVE" fill="none" stroke="${COL.ENGRAVE}" stroke-width="${sw}">`);
  for (const p of s.placed) {
    for (const l of p.engrave) out.push(`<path d="${pathD(l, false)}"/>`);
    for (const t of p.text)
      out.push(`<text x="${t.at[0].toFixed(2)}" y="${t.at[1].toFixed(2)}" font-family="Arial, Helvetica, sans-serif" font-size="${t.size}" text-anchor="middle" fill="${COL.ENGRAVE}" stroke="none">${escXml(t.text)}</text>`);
  }
  out.push(`</g>`);
  out.push(`</svg>`);
  return out.join("\n");
}

/** DXF R12 (AC1009), millimetres. Closed POLYLINEs on layer CUT, open ones on ENGRAVE/SCORE, labels as TEXT. */
export function sheetDxf(layout: SheetLayout, sheetIndex: number): string {
  const s = layout.sheets[sheetIndex];
  const H = layout.sheetH;
  const L: string[] = [];
  const g = (code: number, v: string | number) => L.push(String(code), String(v));
  g(0, "SECTION"); g(2, "HEADER");
  g(9, "$ACADVER"); g(1, "AC1009");
  g(9, "$INSUNITS"); g(70, 4);
  g(9, "$EXTMIN"); g(10, 0); g(20, 0); g(30, 0);
  g(9, "$EXTMAX"); g(10, layout.sheetW); g(20, H); g(30, 0);
  g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "TABLES");
  g(0, "TABLE"); g(2, "LAYER"); g(70, 3);
  for (const [name, color] of [["CUT", 1], ["ENGRAVE", 5], ["SCORE", 3]] as const) {
    g(0, "LAYER"); g(2, name); g(70, 0); g(62, color); g(6, "CONTINUOUS");
  }
  g(0, "ENDTAB"); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "ENTITIES");
  const poly = (pts: Poly, layer: string, closed: boolean) => {
    g(0, "POLYLINE"); g(8, layer); g(66, 1); g(70, closed ? 1 : 0); g(10, 0); g(20, 0); g(30, 0);
    for (const p of pts) { g(0, "VERTEX"); g(8, layer); g(10, p[0].toFixed(4)); g(20, (H - p[1]).toFixed(4)); g(30, 0); }
    g(0, "SEQEND"); g(8, layer);
  };
  for (const p of s.placed) {
    for (const c of p.cut) poly(c, "CUT", true);
    for (const l of p.engrave) poly(l, "ENGRAVE", false);
    for (const l of p.score) poly(l, "SCORE", false);
    for (const t of p.text) {
      g(0, "TEXT"); g(8, "ENGRAVE"); g(10, t.at[0].toFixed(3)); g(20, (H - t.at[1]).toFixed(3)); g(30, 0); g(40, t.size); g(1, t.text);
      g(72, 1); g(11, t.at[0].toFixed(3)); g(21, (H - t.at[1]).toFixed(3)); g(31, 0);
    }
  }
  g(0, "ENDSEC"); g(0, "EOF");
  return L.join("\r\n") + "\r\n";
}

const MM = 72 / 25.4;

/**
 * PDF of all sheets. Paper/cardboard templates are drawn at 1:1 on pages of the sheet size (print at 100 %,
 * a 50 mm calibration bar is included). Laser layouts are drawn scaled to fit A4 landscape as a reference sheet.
 */
export async function layoutsPdf(layouts: SheetLayout[], title: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setProducer("PARTART");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const layout of layouts) {
    for (const s of layout.sheets) {
      const oneToOne = layout.method !== "laser";
      const pageW = oneToOne ? layout.sheetW * MM : 842, pageH = oneToOne ? layout.sheetH * MM : 595;
      const page = pdf.addPage([pageW, pageH]);
      const margin = oneToOne ? 0 : 40;
      const scale = oneToOne ? MM : Math.min((pageW - 2 * margin) / layout.sheetW, (pageH - 2 * margin - 30) / layout.sheetH);
      const ox = margin, oy = pageH - margin - (oneToOne ? 0 : 30);
      const X = (x: number) => ox + x * scale, Y = (y: number) => oy - y * scale;
      const header = `${title} — ${layout.materialKey} ${layout.thicknessMm} mm — sheet ${s.index + 1}/${layout.sheets.length}${oneToOne ? " — PRINT AT 100% (no fit-to-page)" : ` — scale 1:${(MM / scale).toFixed(2)} (reference only; cut from the SVG/DXF)`}`;
      page.drawText(header, { x: oneToOne ? 8 : margin, y: pageH - (oneToOne ? 12 : 28), size: 8, font, color: rgb(0.2, 0.2, 0.2) });
      if (!oneToOne) page.drawRectangle({ x: X(0), y: Y(layout.sheetH), width: layout.sheetW * scale, height: layout.sheetH * scale, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
      const line = (pg: PDFPage, pts: Poly, closed: boolean, color: [number, number, number], dash?: number[]) => {
        const seq = closed ? [...pts, pts[0]] : pts;
        for (let i = 0; i + 1 < seq.length; i++)
          pg.drawLine({ start: { x: X(seq[i][0]), y: Y(seq[i][1]) }, end: { x: X(seq[i + 1][0]), y: Y(seq[i + 1][1]) }, thickness: 0.4, color: rgb(...color), dashArray: dash });
      };
      for (const p of s.placed) {
        for (const c of p.cut) line(page, c, true, [0.85, 0.1, 0.1]);
        for (const l of p.score) line(page, l, false, [0, 0.55, 0], [3, 2]);
        for (const l of p.engrave) line(page, l, false, [0.1, 0.1, 0.85]);
        for (const t of p.text) page.drawText(t.text, { x: X(t.at[0]) - (t.text.length * t.size * scale * 0.25), y: Y(t.at[1]), size: Math.max(4, t.size * scale), font, color: rgb(0.1, 0.1, 0.85) });
      }
      if (oneToOne) {
        page.drawLine({ start: { x: 10 * MM, y: 8 * MM }, end: { x: 60 * MM, y: 8 * MM }, thickness: 1, color: rgb(0, 0, 0) });
        page.drawText("50 mm — measure to check print scale", { x: 10 * MM, y: 10 * MM, size: 6, font });
      }
    }
  }
  return Buffer.from(await pdf.save());
}
