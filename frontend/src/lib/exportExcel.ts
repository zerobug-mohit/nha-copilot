import { columnTotals, formatTotal } from "./totals";

// Brand palette (ARGB for ExcelJS, no leading #).
const TEAL = "FF0F7C8B";
const TEAL_LIGHT = "FFE8F3F5";
const INK = "FF233139";
const MUTED = "FF6A7B83";
const LINE = "FFE2E7EA";
const FONT = "Trebuchet MS";

function timestamp(): string {
  const d = new Date();
  return d.toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function download(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(s: string): string {
  return (s || "result").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "result";
}

export async function exportToExcel(opts: {
  title?: string;
  columns: string[];
  rows: Record<string, unknown>[];
  query?: string;
  labelFor?: (col: string, value: unknown) => string; // optional friendly labels
}) {
  const { title = "Result", columns, rows, query, labelFor } = opts;
  const ExcelJS: any = await import("exceljs");
  const Workbook = ExcelJS.Workbook || ExcelJS.default?.Workbook;
  const wb = new Workbook();
  wb.creator = "NHA SHA Analytical Co-pilot";
  const ws = wb.addWorksheet("Result", { views: [{ state: "frozen", ySplit: 2 }] });

  const nCols = columns.length;
  const lastCol = String.fromCharCode(64 + Math.min(nCols, 26)); // A.. for merges

  // Title row
  ws.mergeCells(`A1:${lastCol}1`);
  const titleCell = ws.getCell("A1");
  titleCell.value = title;
  titleCell.font = { name: FONT, size: 14, bold: true, color: { argb: INK } };
  ws.getRow(1).height = 22;

  // Header row (row 2)
  const header = ws.getRow(2);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c;
    cell.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    cell.alignment = { vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: LINE } } };
  });
  header.height = 18;

  // Data rows
  rows.forEach((r, ri) => {
    const row = ws.getRow(3 + ri);
    columns.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      const raw = r[c];
      const num = typeof raw === "number" ? raw : null;
      cell.value = num !== null ? num : labelFor ? labelFor(c, raw) : raw == null ? "" : String(raw);
      cell.font = { name: FONT, color: { argb: INK } };
      if (num !== null) cell.numFmt = "#,##0.##";
      if (ri % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_LIGHT } };
    });
  });

  // Totals row
  const totals = columnTotals(columns, rows);
  if (rows.length > 1 && Object.values(totals).some((v) => v !== null)) {
    const trow = ws.getRow(3 + rows.length);
    columns.forEach((c, ci) => {
      const cell = trow.getCell(ci + 1);
      const t = totals[c];
      cell.value = t !== null ? t : ci === 0 ? "Total" : "";
      cell.font = { name: FONT, bold: true, color: { argb: INK } };
      if (t !== null) cell.numFmt = "#,##0.##";
      cell.border = { top: { style: "medium", color: { argb: TEAL } } };
    });
  }

  // Column widths
  columns.forEach((c, i) => {
    let w = Math.max(c.length + 2, 12);
    for (const r of rows.slice(0, 80)) {
      const v = r[c];
      if (v != null) w = Math.max(w, Math.min(String(v).length + 2, 40));
    }
    ws.getColumn(i + 1).width = w;
  });

  // Footnote (a couple of blank rows below, merged)
  const foot = 3 + rows.length + 2;
  const notes = [
    query ? `Query: ${query}` : null,
    `Generated: ${timestamp()}`,
    "Source: NHA SHA Analytical Co-pilot — synthetic PM-JAY data. Verify before use.",
  ].filter(Boolean) as string[];
  notes.forEach((text, i) => {
    const r = foot + i;
    ws.mergeCells(`A${r}:${lastCol}${r}`);
    const cell = ws.getCell(`A${r}`);
    cell.value = text;
    cell.font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } };
    cell.alignment = { wrapText: true };
  });

  const buf = await wb.xlsx.writeBuffer();
  download(buf, `${slug(title)}.xlsx`);
}
