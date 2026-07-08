import type { WeeklyReport } from "../api";

// Editable PowerPoint weekly report in the app's design language.

const BRAND = "0F7C8B";
const BRAND_DARK = "0A5B66";
const BRAND_LIGHT = "E8F3F5";
const INK = "233139";
const MUTED = "6A7B83";
const GREEN = "2F9E44";
const RED = "A52C2C";
const CATEGORICAL = ["2A78D6", "1BAF7A", "EDA100", "008300", "4A3AA7", "E34948", "E87BA4", "EB6834"];
const STATUS_COLORS: Record<string, string> = {
  Paid: "2F9E44", Pending: "B08400", "Preauth Rejected": "E06A2C", "Claim Rejected": "A52C2C", Rejected: "A52C2C",
};
const FONT = "Trebuchet MS";

const fmtDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
function periodLabel(start: string, end: string) {
  const last = new Date(end + "T00:00:00");
  last.setDate(last.getDate() - 1);
  return `${fmtDate(start)} – ${fmtDate(last.toISOString().slice(0, 10))}`;
}
function inr(n: number) {
  const a = Math.abs(n);
  if (a >= 1e7) return "₹" + (n / 1e7).toFixed(2).replace(/\.00$/, "") + " Cr";
  if (a >= 1e5) return "₹" + (n / 1e5).toFixed(2).replace(/\.00$/, "") + " L";
  if (a >= 1e3) return "₹" + (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
const num = (n: number) => Math.round(n).toLocaleString("en-IN");
const nowStr = () => new Date().toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export async function buildWeeklyReport(report: WeeklyReport) {
  const mod: any = await import("pptxgenjs");
  const P = mod.default || mod;
  const p = new P();
  p.defineLayout({ name: "W", width: 13.333, height: 7.5 });
  p.layout = "W";
  const W = 13.333;
  const label = periodLabel(report.period.start, report.period.end);

  const footer = (s: any) =>
    s.addText(`Generated ${nowStr()}  •  NHA SHA Analytical Co-pilot — synthetic PM-JAY data. Verify before use.`,
      { x: 0.5, y: 7.08, w: 12.3, h: 0.32, fontFace: FONT, fontSize: 8, italic: true, color: MUTED });
  const heading = (s: any, t: string, sub?: string) => {
    s.addText(t, { x: 0.5, y: 0.3, w: 9.5, h: 0.55, fontFace: FONT, fontSize: 21, bold: true, color: INK });
    if (sub) s.addText(sub, { x: 0.5, y: 0.82, w: 9.5, h: 0.3, fontFace: FONT, fontSize: 11, color: MUTED });
    s.addShape(p.ShapeType.rect, { x: 0.5, y: sub ? 1.14 : 0.92, w: 1.8, h: 0.045, fill: { color: BRAND } });
    s.addText(label, { x: 9.5, y: 0.35, w: 3.3, h: 0.4, align: "right", fontFace: FONT, fontSize: 11, color: BRAND_DARK });
  };
  const tile = (s: any, x: number, y: number, w: number, h: number, value: string, lbl: string, delta?: { pct: number | null; up?: boolean }) => {
    s.addShape(p.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.08, fill: { color: BRAND_LIGHT }, line: { color: BRAND, width: 0.5 } });
    s.addText(value, { x: x + 0.18, y: y + 0.14, w: w - 0.36, h: 0.55, fontFace: FONT, fontSize: 23, bold: true, color: BRAND_DARK });
    s.addText(lbl, { x: x + 0.18, y: y + 0.74, w: w - 0.36, h: 0.35, fontFace: FONT, fontSize: 11, color: MUTED });
    if (delta && delta.pct !== null && delta.pct !== undefined) {
      const up = delta.up ?? delta.pct >= 0;
      s.addText(`${up ? "▲" : "▼"} ${Math.abs(delta.pct)}% vs last wk`,
        { x: x + w - 1.9, y: y + 0.16, w: 1.7, h: 0.3, align: "right", fontFace: FONT, fontSize: 9, color: up ? GREEN : RED });
    }
  };
  const bar = (s: any, o: any) =>
    s.addChart(p.ChartType.bar, [{ name: o.name || "Value", labels: o.labels, values: o.values }], {
      x: o.x, y: o.y, w: o.w, h: o.h, barDir: o.dir || "col", chartColors: [o.color || BRAND],
      showLegend: false, showTitle: !!o.title, title: o.title, titleFontFace: FONT, titleFontSize: 12, titleColor: INK,
      catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT, catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, dataLabelFontFace: FONT,
    });
  const pie = (s: any, o: any) =>
    s.addChart(p.ChartType.pie, [{ name: o.name || "Value", labels: o.labels, values: o.values }], {
      x: o.x, y: o.y, w: o.w, h: o.h, showLegend: true, legendPos: "b", legendFontFace: FONT, legendFontSize: 10,
      showTitle: !!o.title, title: o.title, titleFontFace: FONT, titleFontSize: 12, titleColor: INK,
      showPercent: true, dataLabelFontFace: FONT, dataLabelColor: "FFFFFF", chartColors: o.colors || CATEGORICAL,
    });
  const table = (s: any, header: string[], rows: string[][], o: any) => {
    const head = header.map((t) => ({ text: t, options: { bold: true, color: "FFFFFF", fill: { color: BRAND }, fontFace: FONT, fontSize: 10 } }));
    const body = rows.map((r) => r.map((c) => ({ text: c, options: { color: INK, fontFace: FONT, fontSize: 10 } })));
    s.addTable([head, ...body], { x: o.x, y: o.y, w: o.w, colW: o.colW, border: { type: "solid", color: "E2E7EA", pt: 0.5 }, valign: "middle" });
  };
  const genderName = (g: string) => (g === "M" ? "Male" : g === "F" ? "Female" : g);
  const hospName = (h: string) => (h === "P" ? "Private" : h === "G" ? "Government" : h);

  // ---------- 1. Title ----------
  const s1 = p.addSlide();
  s1.background = { color: BRAND };
  s1.addShape(p.ShapeType.rect, { x: 0, y: 4.4, w: W, h: 3.1, fill: { color: "FFFFFF" } });
  s1.addText("NHA", { x: 0.6, y: 0.6, w: 2, h: 0.7, fontFace: FONT, fontSize: 22, bold: true, color: "FFFFFF" });
  s1.addText("PM-JAY Weekly Report", { x: 0.6, y: 2.0, w: 12, h: 1, fontFace: FONT, fontSize: 40, bold: true, color: "FFFFFF" });
  s1.addText(`Week of ${label}`, { x: 0.6, y: 3.1, w: 12, h: 0.7, fontFace: FONT, fontSize: 22, color: BRAND_LIGHT });
  s1.addText("SHA Analytical Co-pilot", { x: 0.6, y: 5.0, w: 12, h: 0.6, fontFace: FONT, fontSize: 18, bold: true, color: BRAND_DARK });
  s1.addText(`Generated ${nowStr()}`, { x: 0.6, y: 5.6, w: 12, h: 0.5, fontFace: FONT, fontSize: 12, color: MUTED });
  s1.addText("Synthetic PM-JAY data — prototype. Figures are illustrative.", { x: 0.6, y: 6.6, w: 12, h: 0.4, fontFace: FONT, fontSize: 10, italic: true, color: MUTED });

  // ---------- 2. Executive summary + headline KPIs ----------
  const s2 = p.addSlide(); s2.background = { color: "FFFFFF" };
  heading(s2, "Executive summary");
  const k = report.kpis;
  const tiles: [string, string, any?][] = [
    [num(k.total_claims), "Total claims", { pct: k.wow.claims.pct }],
    [num(k.unique_patients), "Unique patients", { pct: k.wow.patients.pct }],
    [inr(k.total_paid), "Amount paid", { pct: k.wow.paid.pct }],
    [`${k.paid_rate}%`, "Paid rate"],
    [inr(k.avg_paid_per_claim), "Avg paid / claim"],
    [num(k.hospitals_active), "Active hospitals"],
  ];
  const tw = 3.9, th = 1.2;
  tiles.forEach((t, i) => tile(s2, 0.5 + (i % 3) * (tw + 0.2), 1.35 + Math.floor(i / 3) * (th + 0.2), tw, th, t[0], t[1], t[2]));
  if (report.analysis?.summary)
    s2.addText([{ text: "Summary  ", options: { bold: true, color: BRAND_DARK } }, { text: report.analysis.summary, options: { color: INK } }],
      { x: 0.5, y: 4.2, w: 12.3, h: 1.1, fontFace: FONT, fontSize: 13, valign: "top", fill: { color: "F4F6F7" }, line: { color: "E2E7EA", width: 0.5 } });
  if (report.analysis?.insights?.length)
    s2.addText(report.analysis.insights.map((t) => ({ text: t, options: { bullet: { code: "2022" }, color: INK, breakLine: true } })),
      { x: 0.5, y: 5.45, w: 12.3, h: 1.5, fontFace: FONT, fontSize: 11, valign: "top" });
  footer(s2);

  // ---------- 3. Claims volume & utilization ----------
  const s3 = p.addSlide(); s3.background = { color: "FFFFFF" };
  heading(s3, "Claims volume & utilization", "By gender, age band and specialty");
  if (report.by_gender.length) bar(s3, { x: 0.5, y: 1.4, w: 3.9, h: 4.6, title: "Claims by gender", labels: report.by_gender.map((r) => genderName(r.gender)), values: report.by_gender.map((r) => r.claims) });
  if (report.by_age.length) bar(s3, { x: 4.6, y: 1.4, w: 3.9, h: 4.6, title: "Claims by age band", color: CATEGORICAL[0], labels: report.by_age.map((r) => r.age_band), values: report.by_age.map((r) => r.claims) });
  if (report.by_specialty.length)
    table(s3, ["Specialty", "Claims", "Paid (₹)"], report.by_specialty.slice(0, 8).map((r) => [r.specialty_name || r.specialty, num(r.claims), inr(r.paid)]), { x: 8.7, y: 1.4, w: 4.1, colW: [2.0, 0.9, 1.2] });
  footer(s3);

  // ---------- 4. Financial exposure ----------
  const s4 = p.addSlide(); s4.background = { color: "FFFFFF" };
  heading(s4, "Financial exposure", "Approved vs paid, and pending payout backlog");
  const f = report.financial;
  const ftiles: [string, string][] = [
    [inr(f.total_paid), "Total paid"],
    [inr(f.total_approved), "Total approved"],
    [inr(f.approved_unpaid_amount), "Approved but unpaid"],
    [num(f.approved_unpaid_count), "Claims awaiting payout"],
  ];
  ftiles.forEach((t, i) => tile(s4, 0.5 + i * 3.1, 1.5, 2.9, 1.3, t[0], t[1]));
  if (report.by_state.length)
    table(s4, ["State", "Claims", "Paid (₹)"], report.by_state.slice(0, 9).map((r) => [r.state, num(r.claims), inr(r.paid)]), { x: 0.5, y: 3.2, w: 6.2, colW: [3.0, 1.4, 1.8] });
  if (report.by_state.length)
    bar(s4, { x: 7.0, y: 3.2, w: 5.8, h: 3.4, title: "Amount paid by state (₹)", color: CATEGORICAL[1], labels: report.by_state.slice(0, 8).map((r) => r.state), values: report.by_state.slice(0, 8).map((r) => r.paid) });
  footer(s4);

  // ---------- 5. Turnaround time ----------
  const s5 = p.addSlide(); s5.background = { color: "FFFFFF" };
  heading(s5, "Turnaround time by stage", "Median and 90th percentile (hours) — extremes hide in the average");
  if (report.tat.length) {
    s5.addChart(p.ChartType.bar,
      [{ name: "Median", labels: report.tat.map((r) => r.stage), values: report.tat.map((r) => Math.round(r.median)) },
       { name: "90th pctile", labels: report.tat.map((r) => r.stage), values: report.tat.map((r) => Math.round(r.p90)) }],
      { x: 0.5, y: 1.5, w: 7.6, h: 5.0, barDir: "col", chartColors: [BRAND, CATEGORICAL[2]], showLegend: true, legendPos: "b", legendFontFace: FONT, catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT });
    table(s5, ["Stage", "Median (h)", "P90 (h)"], report.tat.map((r) => [r.stage, num(r.median), num(r.p90)]), { x: 8.4, y: 1.6, w: 4.4, colW: [1.6, 1.4, 1.4] });
  }
  footer(s5);

  // ---------- 6. Rejections & pending by stage ----------
  const s6 = p.addSlide(); s6.background = { color: "FFFFFF" };
  heading(s6, "Rejections & pending queue", "Where claims sit in the CPD → ACO → SHA workflow");
  if (report.by_status.length)
    pie(s6, { x: 0.5, y: 1.4, w: 5.6, h: 4.6, title: "Claims by status", labels: report.by_status.map((r) => r.status), values: report.by_status.map((r) => r.claims), colors: report.by_status.map((r) => STATUS_COLORS[r.status] || CATEGORICAL[0]) });
  if (report.pending_by_stage.length)
    bar(s6, { x: 6.5, y: 1.4, w: 6.3, h: 4.6, dir: "bar", title: "Pending claims by workflow stage", color: "B08400", labels: report.pending_by_stage.map((r) => r.stage), values: report.pending_by_stage.map((r) => r.claims) });
  else s6.addText("No pending claims in this week.", { x: 6.5, y: 3, w: 6, h: 0.5, fontFace: FONT, fontSize: 13, color: MUTED });
  footer(s6);

  // ---------- 7. Hospital mix & portability ----------
  const s7 = p.addSlide(); s7.background = { color: "FFFFFF" };
  heading(s7, "Facility mix & portability", "Government vs private, and out-of-district care");
  if (report.by_hospital_type.length)
    bar(s7, { x: 0.5, y: 1.4, w: 6.0, h: 4.6, title: "Claims by facility type", labels: report.by_hospital_type.map((r) => hospName(r.hospital_type)), values: report.by_hospital_type.map((r) => r.claims) });
  if (report.portability.length)
    pie(s7, { x: 6.9, y: 1.4, w: 5.9, h: 4.6, title: "Where patients were treated", labels: report.portability.map((r) => r.portability), values: report.portability.map((r) => r.claims), colors: [GREEN, CATEGORICAL[2], RED] });
  footer(s7);

  // ---------- 8. BIS registration progress ----------
  const s8 = p.addSlide(); s8.background = { color: "FFFFFF" };
  heading(s8, "Beneficiary registration (BIS)", "Onboarding pipeline, tracked separately from claims");
  tile(s8, 0.5, 1.5, 3.9, 1.3, num(report.bis.new_enrollments), "New enrollments this week");
  tile(s8, 4.6, 1.5, 3.9, 1.3, num(report.bis.total_registered), "Cumulative registered");
  if (report.bis.card_status.length)
    pie(s8, { x: 0.5, y: 3.2, w: 6.0, h: 3.4, title: "Card status mix", labels: report.bis.card_status.map((r) => r.card_status), values: report.bis.card_status.map((r) => r.count) });
  if (report.analysis?.trends?.length)
    s8.addText([{ text: "Week-over-week\n", options: { bold: true, color: BRAND_DARK, fontSize: 13 } },
      ...report.analysis.trends.map((t) => ({ text: t, options: { bullet: { code: "2022" }, color: INK, breakLine: true, fontSize: 11 } }))],
      { x: 7.0, y: 3.2, w: 5.8, h: 3.3, fontFace: FONT, valign: "top" });
  footer(s8);

  await p.writeFile({ fileName: `PMJAY-weekly-report-${report.period.start}.pptx` });
}
