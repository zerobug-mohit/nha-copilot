import { useMemo, useState } from "react";
import { lazy, Suspense } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const StateMap = lazy(() => import("./StateMap"));
import type { ChartSpec } from "../api";
import { exportToExcel } from "../lib/exportExcel";
import { exportChartToPptx } from "../lib/exportPptx";
import { columnTotals, formatTotal } from "../lib/totals";

const BRAND = "#0f7c8b";
const CATEGORICAL = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"];
const AXIS = "#6a7b83";
const GRID = "#e2e7ea";
const OTHER = "Other";

// Readability caps.
const MAX_SERIES = 6;      // grouped series beyond this = unreadable -> don't pivot
const MAX_CATS_BAR = 14;   // categories in a bar chart; rest folds into "Other"
const MAX_CATS_PIE = 6;    // slices in a pie; rest folds into "Other"
const H_BAR_THRESHOLD = 8; // switch to horizontal bars beyond this many categories

type ChartType = "bar" | "line" | "area" | "pie" | "map";
type View = "chart" | "table";

const SPECIALTY: Record<string, string> = {
  BM: "Burns Management", ER: "Emergency Room", MC: "Cardiology", MG: "General Medicine",
  MM: "Mental Disorders", MN: "Neo-natal Care", MO: "Medical Oncology", MR: "Radiation Oncology",
  SB: "Orthopedics", SC: "Surgical Oncology", SE: "Ophthalmology", SG: "General Surgery",
  SL: "ENT", SM: "Oral & Maxillofacial", SN: "Neurosurgery", SO: "Obstetrics & Gynaecology",
  SP: "Plastic & Reconstructive", SS: "Pediatric Surgery", ST: "Polytrauma", SU: "Urology",
  SV: "CTVS", MD: "Dermatology", SD: "Dental",
};
const COLUMN_MAPS: Record<string, Record<string, string>> = {
  hospital_type: { P: "Private", G: "Government" }, tms_hospital_type: { P: "Private", G: "Government" },
  rural_urban_flag: { U: "Urban", R: "Rural" }, gender: { M: "Male", F: "Female" },
  tms_gender: { M: "Male", F: "Female" }, admission_type: { E: "Emergency", P: "Planned" },
  tms_admission_type: { E: "Emergency", P: "Planned" }, discharge_type: { N: "Normal", D: "Death" },
  tms_discharge_type: { N: "Normal", D: "Death" }, new_member_flag: { Y: "Yes", N: "No" },
};
const VALUE_SETS: { sig: string[]; keys: string[]; map: Record<string, string> }[] = [
  { sig: ["U", "R"], keys: ["U", "R"], map: { U: "Urban", R: "Rural" } },
  { sig: ["M", "F"], keys: ["M", "F"], map: { M: "Male", F: "Female" } },
  { sig: ["G"], keys: ["G", "P"], map: { G: "Government", P: "Private" } },
  { sig: ["E"], keys: ["E", "P"], map: { E: "Emergency", P: "Planned" } },
  { sig: ["D"], keys: ["N", "D"], map: { N: "Normal", D: "Death" } },
  { sig: ["Y"], keys: ["Y", "N"], map: { Y: "Yes", N: "No" } },
];

function makeLabeler(col: string, values: unknown[]): (v: unknown) => string {
  const cl = (col || "").toLowerCase();
  if (cl.includes("special")) return (v) => (v === OTHER ? OTHER : SPECIALTY[String(v)] ?? String(v ?? "—"));
  if (COLUMN_MAPS[cl]) { const m = COLUMN_MAPS[cl]; return (v) => (v === OTHER ? OTHER : m[String(v)] ?? String(v ?? "—")); }
  const set = new Set(values.filter((v) => v != null && v !== "").map(String));
  for (const vs of VALUE_SETS) {
    if (set.size > 0 && [...set].every((x) => vs.keys.includes(x)) && vs.sig.some((k) => set.has(k))) {
      const m = vs.map; return (v) => (v === OTHER ? OTHER : m[String(v)] ?? String(v ?? "—"));
    }
  }
  return (v) => (v === OTHER ? OTHER : SPECIALTY[String(v)] ?? String(v ?? "—"));
}
const pretty = (s: string) => { const t = String(s).replace(/_/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
function compact(n: number) {
  const a = Math.abs(n);
  if (a >= 1e7) return (n / 1e7).toFixed(1).replace(/\.0$/, "") + "Cr";
  if (a >= 1e5) return (n / 1e5).toFixed(1).replace(/\.0$/, "") + "L";
  if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}
function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return null;
}
const timeLike = (c: string) => /(^|_)(date|month|year|day|week|quarter|period|time|dt|admission|dob)/i.test(c || "");

function CustomTooltip({ active, payload, label, fmt }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded border border-line bg-surface px-3 py-2 text-[12px] shadow-pop">
      <div className="mb-1 font-semibold text-ink">{fmt(label ?? payload[0]?.name)}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey ?? p.name} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
          <span className="text-ink-muted">{p.name}:</span>
          <span className="font-medium tabular-nums text-ink">
            {typeof p.value === "number" ? p.value.toLocaleString() : String(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ChartView({
  spec, rows, columns, query, onDrill,
}: {
  spec: ChartSpec;
  rows: Record<string, unknown>[];
  columns?: string[];
  query?: string;
  onDrill?: (value: string, dimension: string) => void;
}) {
  const cols = columns && columns.length ? columns : [spec.x, ...spec.series];

  const numericCols = useMemo(
    () => cols.filter((c) => rows.length > 0 && rows.every((r) => { const v = r[c]; return v == null || v === "" || toNum(v) !== null; }) && rows.some((r) => toNum(r[c]) !== null)),
    [cols, rows]
  );
  const groupKey = cols.find((c) => c !== spec.x && !numericCols.includes(c)) || null;
  const valueKey = spec.series.find((s) => numericCols.includes(s)) || numericCols.find((c) => c !== spec.x) || spec.series[0];
  const groupDistinct = useMemo(() => (groupKey ? new Set(rows.map((r) => String(r[groupKey] ?? "—"))).size : 0), [groupKey, rows]);
  // Pivot into grouped series ONLY when the 2nd dimension is small enough to read.
  const isPivot = !!groupKey && !!valueKey && numericCols.includes(valueKey) && groupDistinct >= 2 && groupDistinct <= MAX_SERIES;
  const tooManyGroups = !!groupKey && !!valueKey && groupDistinct > MAX_SERIES;

  const labelers = useMemo(() => {
    const m: Record<string, (v: unknown) => string> = {};
    for (const c of cols) if (!numericCols.includes(c)) m[c] = makeLabeler(c, rows.map((r) => r[c]));
    return m;
  }, [cols, rows, numericCols]);
  const labelFor = (col: string, v: unknown) => (labelers[col] ? labelers[col](v) : v == null || v === "" ? "—" : String(v));
  const fl = (v: unknown) => labelFor(spec.x, v);
  const gl = (v: unknown) => (groupKey ? labelFor(groupKey, v) : String(v));

  // Measure selector only for genuine multi-measure (no grouping) with mixed scales.
  const scalesComparable = useMemo(() => {
    if (groupKey || spec.series.length < 2) return true;
    const maxes = spec.series.map((s) => Math.max(0, ...rows.map((r) => Math.abs(toNum(r[s]) || 0))));
    const hi = Math.max(...maxes); const lo = Math.min(...maxes.filter((m) => m > 0));
    return lo > 0 && hi / lo <= 25;
  }, [rows, spec.series, groupKey]);
  const [measure, setMeasure] = useState<string>(spec.series.length < 2 || scalesComparable ? "all" : spec.series[0]);
  const activeSeries = isPivot ? [valueKey!] : groupKey ? [valueKey!] : measure === "all" ? spec.series : [measure];

  const xIsTime = timeLike(spec.x);

  // ---- Build clean chartData + series (sort by value desc unless time; cap + Other) ----
  const { chartData, plotSeries, folded } = useMemo(() => {
    const capBar = MAX_CATS_BAR;
    if (isPivot && groupKey && valueKey) {
      const groups = [...new Set(rows.map((r) => String(r[groupKey] ?? "—")))].slice(0, MAX_SERIES);
      const byCat = new Map<string, Record<string, number>>();
      for (const r of rows) {
        const cat = String(r[spec.x] ?? "—"); const g = String(r[groupKey] ?? "—");
        if (!byCat.has(cat)) byCat.set(cat, {});
        byCat.get(cat)![g] = (byCat.get(cat)![g] || 0) + (toNum(r[valueKey]) || 0);
      }
      let out = [...byCat.entries()].map(([cat, gv]) => {
        const o: Record<string, unknown> = { [spec.x]: cat };
        let tot = 0; for (const g of groups) { o[g] = gv[g] || 0; tot += (gv[g] || 0); }
        o.__t = tot; return o;
      });
      if (!xIsTime) out.sort((a, b) => (b.__t as number) - (a.__t as number));
      const fold = out.length > capBar;
      out = out.slice(0, capBar);
      return { chartData: out, plotSeries: groups.map((g) => ({ key: g, name: gl(g) })), folded: fold ? rows.length : 0 };
    }
    // single dimension (or too-many-groups -> aggregate value across the group)
    const keys = activeSeries;
    const agg = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const cat = String(r[spec.x] ?? "—");
      if (!agg.has(cat)) agg.set(cat, {});
      for (const k of keys) agg.get(cat)![k] = (agg.get(cat)![k] || 0) + (toNum(r[k]) || 0);
    }
    let out = [...agg.entries()].map(([cat, kv]) => {
      const o: Record<string, unknown> = { [spec.x]: cat };
      let tot = 0; for (const k of keys) { o[k] = kv[k] || 0; tot += (kv[k] || 0); }
      o.__t = tot; return o;
    });
    if (!xIsTime) out.sort((a, b) => (b.__t as number) - (a.__t as number));
    let foldedCount = 0;
    if (out.length > capBar) {
      const head = out.slice(0, capBar - 1);
      const tail = out.slice(capBar - 1);
      foldedCount = tail.length;
      const other: Record<string, unknown> = { [spec.x]: OTHER };
      for (const k of keys) other[k] = tail.reduce((s, r) => s + (Number(r[k]) || 0), 0);
      out = [...head, other];
    }
    return { chartData: out, plotSeries: keys.map((s) => ({ key: s, name: pretty(s) })), folded: foldedCount };
  }, [rows, spec, isPivot, groupKey, valueKey, activeSeries, xIsTime]); // eslint-disable-line

  const multi = plotSeries.length > 1;

  // State-level geography → offer a choropleth map (single measure only).
  const isStateGeo = /state/i.test(spec.x) && !/status/i.test(spec.x) && !multi && !isPivot && !tooManyGroups;
  const geoData = useMemo(() => {
    if (!isStateGeo) return [];
    const key = valueKey || spec.series[0];
    const m = new Map<string, number>();
    for (const r of rows) { const s = String(r[spec.x] ?? ""); if (s) m.set(s, (m.get(s) || 0) + (toNum(r[key]) || 0)); }
    return [...m.entries()].map(([name, value]) => ({ name, value }));
  }, [rows, spec, valueKey, isStateGeo]);

  // ---- Which chart types make sense for THIS data ----
  const catCount = chartData.length;
  const allowed: ChartType[] = [];
  if (isStateGeo) allowed.push("map");
  allowed.push("bar");
  if (xIsTime) allowed.push("line");
  if (!multi && catCount <= MAX_CATS_PIE + 1) allowed.push("pie"); // +1 to allow with an Other slice
  const wanted = (spec.type === "area" ? "line" : spec.type) as ChartType;
  const [type, setType] = useState<ChartType>(
    isStateGeo ? "map" : allowed.includes(wanted) ? wanted : xIsTime ? "line" : "bar"
  );
  const chartType = allowed.includes(type) ? type : allowed[0];

  const [view, setView] = useState<View>("chart");

  const colorFor = (i: number) => (multi ? CATEGORICAL[i % CATEGORICAL.length] : BRAND);
  const drillable = !!(spec.drilldown && onDrill);
  const handleDrill = (p: any) => {
    if (!drillable || !p) return;
    const val = p[spec.x] ?? p.name ?? p.payload?.[spec.x];
    if (val != null && val !== OTHER) onDrill!(fl(val), spec.drilldown!);
  };

  // Horizontal bars when many/long categories (single-series only).
  const longLabels = chartData.some((d) => fl(d[spec.x]).length > 10);
  const horizontal = chartType === "bar" && !multi && (catCount > H_BAR_THRESHOLD || longLabels);
  const chartHeight = horizontal ? Math.max(240, catCount * 26 + 40) : 300;

  const pieData = chartData.map((d) => ({ [spec.x]: d[spec.x], __v: plotSeries.reduce((s, ps) => s + (Number(d[ps.key]) || 0), 0) }));

  const tableColumns = isPivot ? [spec.x, groupKey!, valueKey!] : tooManyGroups ? [spec.x, groupKey!, valueKey!] : [spec.x, ...spec.series];
  const cellFmt = (col: string, val: unknown) => {
    if (val == null || val === "") return "—";
    if (numericCols.includes(col)) { const n = toNum(val); return n !== null ? n.toLocaleString() : String(val); }
    return labelFor(col, val);
  };

  const exportPpt = () => exportChartToPptx({
    title: spec.title || "Result", type: chartType === "map" ? "bar" : chartType,
    categories: chartData.map((d) => fl(d[spec.x])),
    series: plotSeries.map((ps) => ({ name: ps.name, values: chartData.map((d) => Number(d[ps.key]) || 0) })),
    query,
  });
  const exportXlsx = () => exportToExcel({ title: spec.title || "Result", columns: tableColumns, rows, query, labelFor: (c, v) => cellFmt(c, v) });

  const xAxisProps: any = {
    dataKey: spec.x, tick: { fontSize: 11, fill: AXIS }, tickFormatter: fl,
    interval: 0, angle: 0, textAnchor: "middle", height: 30, tickMargin: 8, minTickGap: 0,
  };

  // Direct value labels when there aren't too many single-series bars.
  const showLabels = !multi && catCount <= 16;
  const renderSeries = (kind: "bar" | "line" | "area") =>
    plotSeries.map((ps, i) =>
      kind === "line" ? (
        <Line key={ps.key} name={ps.name} type="monotone" dataKey={ps.key} stroke={colorFor(i)} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
      ) : kind === "area" ? (
        <Area key={ps.key} name={ps.name} type="monotone" dataKey={ps.key} stroke={colorFor(i)} fill={colorFor(i)} fillOpacity={0.15} strokeWidth={2} />
      ) : (
        <Bar key={ps.key} name={ps.name} dataKey={ps.key} fill={colorFor(i)} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={horizontal ? 22 : 64}
          onClick={(e: any) => handleDrill(e?.payload ?? e)} cursor={drillable ? "pointer" : "default"}>
          {!multi && chartData.map((_, idx) => <Cell key={idx} fill={BRAND} />)}
          {showLabels && (
            <LabelList dataKey={ps.key} position={horizontal ? "right" : "top"}
              formatter={(v: any) => compact(Number(v))} style={{ fontSize: 10, fill: AXIS }} />
          )}
        </Bar>
      )
    );

  return (
    <figure className="mt-3 rounded-lg border border-line bg-surface p-3">
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink">{spec.title || "Result"}</span>
        <div className="flex items-center gap-1">
          <div className="flex overflow-hidden rounded border border-line">
            {(["chart", "table"] as View[]).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-2 py-0.5 text-[11px] capitalize transition ${view === v ? "bg-ink text-white" : "bg-surface text-ink-muted hover:bg-surface-alt"}`}>{v}</button>
            ))}
          </div>
          {view === "chart" && allowed.length > 1 && (
            <div className="ml-1 flex overflow-hidden rounded border border-line">
              {allowed.map((t) => (
                <button key={t} onClick={() => setType(t)}
                  className={`px-2 py-0.5 text-[11px] capitalize transition ${chartType === t ? "bg-brand text-white" : "bg-surface text-ink-muted hover:bg-brand-light"}`}>{t}</button>
              ))}
            </div>
          )}
          <button onClick={exportPpt} title="Editable PowerPoint slide" className="rounded border border-line px-2 py-0.5 text-[11px] font-medium text-ink-muted transition hover:border-brand hover:text-brand">PPT</button>
          <button onClick={exportXlsx} title="Data as Excel" className="rounded border border-line px-2 py-0.5 text-[11px] font-medium text-ink-muted transition hover:border-brand hover:text-brand">Excel</button>
        </div>
      </figcaption>

      {!groupKey && spec.series.length > 1 && view === "chart" && chartType !== "pie" && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-ink-faint">Measure:</span>
          {scalesComparable && <MeasureBtn active={measure === "all"} onClick={() => setMeasure("all")}>All</MeasureBtn>}
          {spec.series.map((s) => <MeasureBtn key={s} active={measure === s} onClick={() => setMeasure(s)}>{pretty(s)}</MeasureBtn>)}
        </div>
      )}

      {view === "table" ? (
        <MiniTable columns={tableColumns} rows={rows} fmt={cellFmt} />
      ) : chartType === "map" ? (
        <Suspense fallback={<div className="flex h-[360px] items-center justify-center text-sm text-ink-faint">Loading map…</div>}>
          <StateMap data={geoData} valueName={plotSeries[0]?.name || "Value"} onStateClick={drillable ? (name) => onDrill!(name, spec.drilldown!) : undefined} />
        </Suspense>
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          {chartType === "pie" ? (
            <PieChart>
              <Tooltip content={(p: any) => <CustomTooltip {...p} fmt={fl} />} />
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v: any) => fl(v)} />
              <Pie data={pieData} dataKey="__v" nameKey={spec.x} cx="50%" cy="50%" outerRadius={95} innerRadius={45} paddingAngle={2}
                onClick={(e: any) => handleDrill(e?.payload ?? e)} cursor={drillable ? "pointer" : "default"}>
                {pieData.map((_, i) => <Cell key={i} fill={CATEGORICAL[i % CATEGORICAL.length]} stroke="#fff" strokeWidth={2} />)}
              </Pie>
            </PieChart>
          ) : chartType === "line" ? (
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis {...xAxisProps} /><YAxis tick={{ fontSize: 11, fill: AXIS }} tickFormatter={compact} width={46} />
              <Tooltip content={(p: any) => <CustomTooltip {...p} fmt={fl} />} />
              {multi && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {renderSeries("line")}
            </LineChart>
          ) : horizontal ? (
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }} barCategoryGap="20%">
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: AXIS }} tickFormatter={compact} />
              <YAxis type="category" dataKey={spec.x} tick={{ fontSize: 11, fill: AXIS }} tickFormatter={fl} width={130} interval={0} />
              <Tooltip content={(p: any) => <CustomTooltip {...p} fmt={fl} />} cursor={{ fill: "rgba(15,124,139,0.06)" }} />
              {multi && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {renderSeries("bar")}
            </BarChart>
          ) : (
            <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }} barCategoryGap="22%">
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis {...xAxisProps} /><YAxis tick={{ fontSize: 11, fill: AXIS }} tickFormatter={compact} width={46} />
              <Tooltip content={(p: any) => <CustomTooltip {...p} fmt={fl} />} cursor={{ fill: "rgba(15,124,139,0.06)" }} />
              {multi && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {renderSeries("bar")}
            </BarChart>
          )}
        </ResponsiveContainer>
      )}

      <div className="mt-1 space-y-0.5 text-center">
        {isPivot && chartType !== "pie" && <p className="text-[11px] text-ink-faint">Grouped by {pretty(groupKey!)}.</p>}
        {tooManyGroups && <p className="text-[11px] text-ink-faint">{pretty(groupKey!)} has {groupDistinct} values — showing totals by {pretty(spec.x)}; use Table for the full breakdown.</p>}
        {folded > 0 && !isPivot && <p className="text-[11px] text-ink-faint">Top {MAX_CATS_BAR - 1} shown; the rest grouped as “Other”. Use Table for all.</p>}
        {drillable && view === "chart" && <p className="text-[11px] text-ink-faint">Tip: click a {chartType === "pie" ? "slice" : "bar"} to drill into {pretty(spec.drilldown!)}.</p>}
      </div>
    </figure>
  );
}

function MeasureBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${active ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink-muted hover:border-brand"}`}>{children}</button>
  );
}

function MiniTable({ columns, rows, fmt }: { columns: string[]; rows: Record<string, unknown>[]; fmt: (col: string, val: unknown) => string }) {
  const totals = columnTotals(columns, rows);
  const showTotals = rows.length > 1 && Object.values(totals).some((v) => v !== null);
  return (
    <div className="max-h-72 overflow-auto rounded border border-line">
      <table className="min-w-full text-[12px]">
        <thead className="sticky top-0 bg-surface-alt">
          <tr>{columns.map((c) => <th key={c} className="border-b border-line px-3 py-1.5 text-left font-semibold text-ink-muted">{pretty(c)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((r, i) => (
            <tr key={i} className="border-b border-line/60 last:border-0">
              {columns.map((c) => <td key={c} className="px-3 py-1 tabular-nums text-ink">{fmt(c, r[c])}</td>)}
            </tr>
          ))}
        </tbody>
        {showTotals && (
          <tfoot><tr className="border-t-2 border-line-strong bg-surface-alt font-semibold">
            {columns.map((c, i) => <td key={c} className="px-3 py-1 tabular-nums text-ink">{totals[c] !== null ? formatTotal(totals[c] as number) : i === 0 ? "Total" : ""}</td>)}
          </tr></tfoot>
        )}
      </table>
    </div>
  );
}
