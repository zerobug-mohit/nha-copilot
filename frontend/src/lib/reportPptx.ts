import type { WeeklyReport } from "../api";

// Build a 5-slide editable PowerPoint weekly report in the app's design language.

const BRAND = "0F7C8B";
const BRAND_DARK = "0A5B66";
const BRAND_LIGHT = "E8F3F5";
const INK = "233139";
const MUTED = "6A7B83";
const CATEGORICAL = ["2A78D6", "1BAF7A", "EDA100", "008300", "4A3AA7", "E34948", "E87BA4", "EB6834"];
const STATUS_COLORS: Record<string, string> = { Paid: "2F9E44", Pending: "B08400", Rejected: "A52C2C" };
const FONT = "Trebuchet MS";

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
function periodLabel(start: string, end: string): string {
  // end is exclusive -> last day is end-1
  const last = new Date(end + "T00:00:00");
  last.setDate(last.getDate() - 1);
  return `${fmtDate(start)} – ${last.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}`;
}
function inr(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e7) return "₹" + (n / 1e7).toFixed(2).replace(/\.00$/, "") + " Cr";
  if (a >= 1e5) return "₹" + (n / 1e5).toFixed(2).replace(/\.00$/, "") + " L";
  if (a >= 1e3) return "₹" + (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
function num(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}
function nowStr(): string {
  return new Date().toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export async function buildWeeklyReport(report: WeeklyReport) {
  const mod: any = await import("pptxgenjs");
  const Pptx = mod.default || mod;
  const p = new Pptx();
  p.defineLayout({ name: "W", width: 13.333, height: 7.5 });
  p.layout = "W";
  const W = 13.333;
  const label = periodLabel(report.period.start, report.period.end);

  const footer = (slide: any) =>
    slide.addText(
      `Generated ${nowStr()}  •  NHA SHA Analytical Co-pilot — synthetic PM-JAY data. Verify before use.`,
      { x: 0.5, y: 7.05, w: 12.3, h: 0.35, fontFace: FONT, fontSize: 8, italic: true, color: MUTED }
    );
  const heading = (slide: any, text: string) => {
    slide.addText(text, { x: 0.5, y: 0.35, w: 12.3, h: 0.6, fontFace: FONT, fontSize: 22, bold: true, color: INK });
    slide.addShape(p.ShapeType.rect, { x: 0.5, y: 1.0, w: 2.0, h: 0.05, fill: { color: BRAND } });
  };

  // ---------- Slide 1: Title ----------
  const s1 = p.addSlide();
  s1.background = { color: BRAND };
  s1.addShape(p.ShapeType.rect, { x: 0, y: 4.4, w: W, h: 3.1, fill: { color: "FFFFFF" } });
  s1.addText("NHA", { x: 0.6, y: 0.6, w: 2, h: 0.7, fontFace: FONT, fontSize: 22, bold: true, color: "FFFFFF" });
  s1.addText("PM-JAY Weekly Report", { x: 0.6, y: 2.1, w: 12, h: 1, fontFace: FONT, fontSize: 40, bold: true, color: "FFFFFF" });
  s1.addText(`Week of ${label}`, { x: 0.6, y: 3.2, w: 12, h: 0.7, fontFace: FONT, fontSize: 22, color: BRAND_LIGHT });
  s1.addText("SHA Analytical Co-pilot", { x: 0.6, y: 5.1, w: 12, h: 0.6, fontFace: FONT, fontSize: 18, bold: true, color: BRAND_DARK });
  s1.addText(`Generated ${nowStr()}`, { x: 0.6, y: 5.7, w: 12, h: 0.5, fontFace: FONT, fontSize: 12, color: MUTED });
  s1.addText("Synthetic PM-JAY data — prototype. Figures are illustrative.", { x: 0.6, y: 6.6, w: 12, h: 0.4, fontFace: FONT, fontSize: 10, italic: true, color: MUTED });

  // ---------- Slide 2: KPIs + summary ----------
  const s2 = p.addSlide();
  s2.background = { color: "FFFFFF" };
  heading(s2, `Key metrics — ${label}`);
  const k = report.kpis;
  const tiles: { label: string; value: string }[] = [
    { label: "Total claims", value: num(k.total_claims) },
    { label: "Unique patients", value: num(k.unique_patients) },
    { label: "Total amount paid", value: inr(k.total_paid) },
    { label: "Paid rate", value: `${k.paid_rate}%` },
    { label: "Avg paid / claim", value: inr(k.avg_paid_per_claim) },
    { label: "Active hospitals", value: num(k.hospitals_active) },
  ];
  const tw = 3.9, th = 1.35, gx = 0.5, gy = 1.35, padx = 0.2, pady = 0.25;
  tiles.forEach((t, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = gx + col * (tw + padx), y = gy + row * (th + pady);
    s2.addShape(p.ShapeType.roundRect, { x, y, w: tw, h: th, rectRadius: 0.08, fill: { color: BRAND_LIGHT }, line: { color: BRAND, width: 0.5 } });
    s2.addText(t.value, { x: x + 0.2, y: y + 0.15, w: tw - 0.4, h: 0.6, fontFace: FONT, fontSize: 26, bold: true, color: BRAND_DARK });
    s2.addText(t.label, { x: x + 0.2, y: y + 0.8, w: tw - 0.4, h: 0.4, fontFace: FONT, fontSize: 12, color: MUTED });
  });
  const summary = report.analysis?.summary || "";
  if (summary) {
    s2.addText([{ text: "Summary  ", options: { bold: true, color: BRAND_DARK } }, { text: summary, options: { color: INK } }], {
      x: 0.5, y: 4.9, w: 12.3, h: 1.6, fontFace: FONT, fontSize: 13, valign: "top",
      fill: { color: "F4F6F7" }, line: { color: "E2E7EA", width: 0.5 },
    });
  }
  footer(s2);

  // ---------- Slide 3: Claims by state ----------
  const s3 = p.addSlide();
  s3.background = { color: "FFFFFF" };
  heading(s3, "Claims by state");
  if (report.by_state.length) {
    s3.addChart(p.ChartType.bar, [{ name: "Claims", labels: report.by_state.map((r) => r.state), values: report.by_state.map((r) => r.claims) }], {
      x: 0.5, y: 1.3, w: 7.6, h: 5.2, barDir: "col", chartColors: [BRAND], showLegend: false, showTitle: false,
      catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT, catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, dataLabelFontFace: FONT,
    });
    const trows = [
      [th_("State"), th_("Claims"), th_("Paid (₹)")],
      ...report.by_state.slice(0, 8).map((r) => [td_(r.state), td_(num(r.claims)), td_(inr(r.paid))]),
    ];
    s3.addTable(trows, { x: 8.4, y: 1.3, w: 4.4, colW: [2.0, 1.1, 1.3], fontFace: FONT, fontSize: 10, border: { type: "solid", color: "E2E7EA", pt: 0.5 } });
  } else {
    s3.addText("No claims in this week.", { x: 0.5, y: 3, w: 12, h: 1, fontFace: FONT, fontSize: 16, color: MUTED });
  }
  footer(s3);

  // ---------- Slide 4: Top specialties ----------
  const s4 = p.addSlide();
  s4.background = { color: "FFFFFF" };
  heading(s4, "Top specialties");
  if (report.by_specialty.length) {
    const labels = report.by_specialty.map((r) => r.specialty_name || r.specialty);
    s4.addChart(p.ChartType.bar, [{ name: "Claims", labels, values: report.by_specialty.map((r) => r.claims) }], {
      x: 0.5, y: 1.3, w: 6.1, h: 5.2, barDir: "bar", chartColors: [BRAND], showLegend: false, showTitle: false,
      catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT, catAxisLabelFontSize: 9, valAxisLabelFontSize: 9,
    });
    s4.addChart(p.ChartType.bar, [{ name: "Amount paid", labels, values: report.by_specialty.map((r) => r.paid) }], {
      x: 6.9, y: 1.3, w: 6.0, h: 5.2, barDir: "bar", chartColors: [CATEGORICAL[1]], showLegend: false, showTitle: true, title: "Amount paid (₹)",
      titleFontFace: FONT, titleFontSize: 11, catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT, catAxisLabelFontSize: 9, valAxisLabelFontSize: 9,
    });
    s4.addText("Claims by specialty (left) and amount paid (right).", { x: 0.5, y: 6.55, w: 12, h: 0.3, fontFace: FONT, fontSize: 10, italic: true, color: MUTED });
  } else {
    s4.addText("No claims in this week.", { x: 0.5, y: 3, w: 12, h: 1, fontFace: FONT, fontSize: 16, color: MUTED });
  }
  footer(s4);

  // ---------- Slide 5: Payment status + facility + insights ----------
  const s5 = p.addSlide();
  s5.background = { color: "FFFFFF" };
  heading(s5, "Payment status & facility mix");
  if (report.by_status.length) {
    s5.addChart(p.ChartType.pie, [{ name: "Status", labels: report.by_status.map((r) => r.payment_state), values: report.by_status.map((r) => r.claims) }], {
      x: 0.5, y: 1.3, w: 5.6, h: 4.4, showLegend: true, legendPos: "b", legendFontFace: FONT, showTitle: true, title: "Claims by payment status", titleFontFace: FONT, titleFontSize: 12,
      showPercent: true, dataLabelFontFace: FONT, chartColors: report.by_status.map((r) => STATUS_COLORS[r.payment_state] || CATEGORICAL[0]),
    });
  }
  if (report.by_hospital_type.length) {
    const hlabels = report.by_hospital_type.map((r) => (r.hospital_type === "P" ? "Private" : r.hospital_type === "G" ? "Government" : r.hospital_type));
    s5.addChart(p.ChartType.bar, [{ name: "Claims", labels: hlabels, values: report.by_hospital_type.map((r) => r.claims) }], {
      x: 6.5, y: 1.3, w: 6.3, h: 4.4, barDir: "col", chartColors: [BRAND], showLegend: false, showTitle: true, title: "Claims by facility type", titleFontFace: FONT, titleFontSize: 12,
      catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT,
    });
  }
  const insights = report.analysis?.insights || [];
  if (insights.length) {
    s5.addText(
      insights.map((t) => ({ text: t, options: { bullet: { code: "2022" }, color: INK, breakLine: true } })),
      { x: 0.5, y: 5.85, w: 12.3, h: 1.0, fontFace: FONT, fontSize: 11, valign: "top" }
    );
  }
  footer(s5);

  const fileName = `PMJAY-weekly-report-${report.period.start}.pptx`;
  await p.writeFile({ fileName });
}

function th_(t: string) {
  return { text: t, options: { bold: true, color: "FFFFFF", fill: { color: BRAND }, fontFace: FONT, fontSize: 10 } };
}
function td_(t: string) {
  return { text: t, options: { color: INK, fontFace: FONT, fontSize: 10 } };
}
