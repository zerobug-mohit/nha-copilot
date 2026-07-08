import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartSpec } from "../api";
import { exportToExcel } from "../lib/exportExcel";
import { exportChartToPptx } from "../lib/exportPptx";
import { columnTotals, formatTotal } from "../lib/totals";

const BRAND = "#0f7c8b";
const CATEGORICAL = [
  "#2a78d6", "#1baf7a", "#eda100", "#008300",
  "#4a3aa7", "#e34948", "#e87ba4", "#eb6834",
];
const AXIS = "#6a7b83";
const GRID = "#e2e7ea";

type ChartType = "bar" | "line" | "area" | "pie";
type View = "chart" | "table";

const SPECIALTY: Record<string, string> = {
  BM: "Burns Management", ER: "Emergency Room", MC: "Cardiology",
  MG: "General Medicine", MM: "Mental Disorders", MN: "Neo-natal Care",
  MO: "Medical Oncology", MR: "Radiation Oncology", SB: "Orthopedics",
  SC: "Surgical Oncology", SE: "Ophthalmology", SG: "General Surgery",
  SL: "ENT", SM: "Oral & Maxillofacial", SN: "Neurosurgery",
  SO: "Obstetrics & Gynaecology", SP: "Plastic & Reconstructive",
  SS: "Pediatric Surgery", ST: "Polytrauma", SU: "Urology", SV: "CTVS",
  MD: "Dermatology", SD: "Dental",
};
const COLUMN_MAPS: Record<string, Record<string, string>> = {
  hospital_type: { P: "Private", G: "Government" },
  tms_hospital_type: { P: "Private", G: "Government" },
  rural_urban_flag: { U: "Urban", R: "Rural" },
  gender: { M: "Male", F: "Female" },
  tms_gender: { M: "Male", F: "Female" },
  admission_type: { E: "Emergency", P: "Planned" },
  tms_admission_type: { E: "Emergency", P: "Planned" },
  discharge_type: { N: "Normal", D: "Death" },
  tms_discharge_type: { N: "Normal", D: "Death" },
  new_member_flag: { Y: "Yes", N: "No" },
};

// Value-set inference for when a column is aliased (so column-name mapping fails).
// `sig` = distinguishing key(s) that must be present, so an ambiguous lone value
// like "P" (Private vs Planned) is not mis-mapped.
const VALUE_SETS: { sig: string[]; keys: string[]; map: Record<string, string> }[] = [
  { sig: ["U", "R"], keys: ["U", "R"], map: { U: "Urban", R: "Rural" } },
  { sig: ["M", "F"], keys: ["M", "F"], map: { M: "Male", F: "Female" } },
  { sig: ["G"], keys: ["G", "P"], map: { G: "Government", P: "Private" } },
  { sig: ["E"], keys: ["E", "P"], map: { E: "Emergency", P: "Planned" } },
  { sig: ["D"], keys: ["N", "D"], map: { N: "Normal", D: "Death" } },
  { sig: ["Y"], keys: ["Y", "N"], map: { Y: "Yes", N: "No" } },
];

/** Build a value->label function for a column, using its name first, then the set
 *  of its actual values (handles SQL aliases), falling back to specialty codes. */
function makeLabeler(col: string, values: unknown[]): (v: unknown) => string {
  const cl = (col || "").toLowerCase();
  if (cl.includes("special")) return (v) => SPECIALTY[String(v)] ?? String(v ?? "—");
  if (COLUMN_MAPS[cl]) {
    const m = COLUMN_MAPS[cl];
    return (v) => m[String(v)] ?? String(v ?? "—");
  }
  const set = new Set(values.filter((v) => v != null && v !== "").map(String));
  for (const vs of VALUE_SETS) {
    const allIn = [...set].every((x) => vs.keys.includes(x));
    const hasSig = vs.sig.some((k) => set.has(k));
    if (set.size > 0 && allIn && hasSig) {
      const m = vs.map;
      return (v) => m[String(v)] ?? String(v ?? "—");
    }
  }
  return (v) => SPECIALTY[String(v)] ?? String(v ?? "—");
}

function fullLabel(col: string, v: unknown): string {
  const s = String(v ?? "—");
  const cl = (col || "").toLowerCase();
  if (cl.includes("special")) return SPECIALTY[s] ?? s;
  const m = COLUMN_MAPS[cl];
  return (m && m[s]) || s;
}
const pretty = (s: string): string => {
  const t = String(s).replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
function compact(n: number): string {
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

function CustomTooltip({ active, payload, label, fmt }: any) {
  if (!active || !payload || !payload.length) return null;
  const title = fmt(label ?? payload[0]?.name);
  return (
    <div className="rounded border border-line bg-surface px-3 py-2 text-[12px] shadow-pop">
      <div className="mb-1 font-semibold text-ink">{title}</div>
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
  spec,
  rows,
  columns,
  query,
  onDrill,
}: {
  spec: ChartSpec;
  rows: Record<string, unknown>[];
  columns?: string[];
  query?: string;
  onDrill?: (value: string, dimension: string) => void;
}) {
  const [view, setView] = useState<View>("chart");
  const [type, setType] = useState<ChartType>(spec.type);

  const cols = columns && columns.length ? columns : [spec.x, ...spec.series];

  // Numeric columns (checked over all rows).
  const numericCols = useMemo(
    () =>
      cols.filter(
        (c) =>
          rows.length > 0 &&
          rows.every((r) => {
            const v = r[c];
            return v == null || v === "" || toNum(v) !== null;
          }) &&
          rows.some((r) => toNum(r[c]) !== null)
      ),
    [cols, rows]
  );

  // A second categorical dimension (besides spec.x) means the result is a
  // two-dimension breakdown -> pivot it into grouped series.
  const groupKey = cols.find((c) => c !== spec.x && !numericCols.includes(c)) || null;
  const valueKey =
    spec.series.find((s) => numericCols.includes(s)) ||
    numericCols.find((c) => c !== spec.x) ||
    spec.series[0];
  const isPivot = !!groupKey && !!valueKey && numericCols.includes(valueKey);

  // Per-column value->label functions (name-based, then value-set inference for
  // aliased columns). Used for the x-axis, legend, tooltips, table and exports.
  const labelers = useMemo(() => {
    const m: Record<string, (v: unknown) => string> = {};
    for (const c of cols) {
      if (!numericCols.includes(c)) m[c] = makeLabeler(c, rows.map((r) => r[c]));
    }
    return m;
  }, [cols, rows, numericCols]);
  const labelFor = (col: string, v: unknown) =>
    labelers[col] ? labelers[col](v) : v == null || v === "" ? "—" : String(v);
  const fl = (v: unknown) => labelFor(spec.x, v);
  const gl = (v: unknown) => (groupKey ? labelFor(groupKey, v) : String(v));

  // Measure selector (non-pivot, multiple numeric measures with mixed scales).
  const scalesComparable = useMemo(() => {
    if (isPivot || spec.series.length < 2) return true;
    const maxes = spec.series.map((s) => Math.max(0, ...rows.map((r) => Math.abs(toNum(r[s]) || 0))));
    const hi = Math.max(...maxes);
    const lo = Math.min(...maxes.filter((m) => m > 0));
    return lo > 0 && hi / lo <= 25;
  }, [rows, spec.series, isPivot]);
  const [measure, setMeasure] = useState<string>(
    spec.series.length < 2 || scalesComparable ? "all" : spec.series[0]
  );
  const activeSeries = isPivot ? [valueKey!] : measure === "all" ? spec.series : [measure];

  // Build chartData + the series to plot, for either mode.
  const { chartData, plotSeries } = useMemo(() => {
    if (isPivot && groupKey && valueKey) {
      const cats = [...new Set(rows.map((r) => String(r[spec.x] ?? "—")))];
      const groups = [...new Set(rows.map((r) => String(r[groupKey] ?? "—")))];
      const out = cats.map((cat) => {
        const o: Record<string, unknown> = { [spec.x]: cat };
        for (const g of groups) {
          const m = rows.find(
            (r) => String(r[spec.x] ?? "—") === cat && String(r[groupKey] ?? "—") === g
          );
          o[g] = m ? toNum(m[valueKey]) ?? 0 : 0;
        }
        return o;
      });
      return {
        chartData: out.slice(0, 30),
        plotSeries: groups.map((g) => ({ key: g, name: gl(g) })),
      };
    }
    const cleaned = rows.map((r) => {
      const o: Record<string, unknown> = { [spec.x]: String(r[spec.x] ?? "—") };
      for (const s of activeSeries) o[s] = toNum(r[s]) ?? 0;
      return o;
    });
    return {
      chartData: cleaned.slice(0, type === "pie" ? 8 : 30),
      plotSeries: activeSeries.map((s) => ({ key: s, name: pretty(s) })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, spec, isPivot, groupKey, valueKey, type, measure]);

  const multi = plotSeries.length > 1;
  const colorFor = (i: number) => (multi ? CATEGORICAL[i % CATEGORICAL.length] : BRAND);

  const drillable = !!(spec.drilldown && onDrill);
  const handleDrill = (payload: any) => {
    if (drillable && payload) {
      const val = payload[spec.x] ?? payload.name ?? payload.payload?.[spec.x];
      if (val != null) onDrill!(fl(val), spec.drilldown!);
    }
  };

  // Pie: one value per category (sum across groups in pivot mode).
  const pieData = chartData.map((d) => ({
    [spec.x]: d[spec.x],
    __v: plotSeries.reduce((s, ps) => s + (Number(d[ps.key]) || 0), 0),
  }));

  // Table columns/rows.
  const tableColumns = isPivot ? [spec.x, groupKey!, valueKey!] : [spec.x, ...spec.series];
  const cellFmt = (col: string, val: unknown) => {
    if (val == null || val === "") return "—";
    if (numericCols.includes(col)) {
      const n = toNum(val);
      return n !== null ? n.toLocaleString() : String(val);
    }
    return labelFor(col, val);
  };

  const exportPpt = () =>
    exportChartToPptx({
      title: spec.title || "Result",
      type,
      categories: chartData.map((d) => fl(d[spec.x])),
      series: plotSeries.map((ps) => ({
        name: ps.name,
        values: chartData.map((d) => Number(d[ps.key]) || 0),
      })),
      query,
    });
  const exportXlsx = () =>
    exportToExcel({
      title: spec.title || "Result",
      columns: tableColumns,
      rows,
      query,
      labelFor: (col, val) => cellFmt(col, val),
    });

  // Axis labels: full when there's room; always horizontal; truncate very long.
  const useFullAxis = chartData.length <= 6;
  const axisText = (v: unknown) => {
    const t = useFullAxis ? fl(v) : String(v ?? "—");
    return t.length > 16 ? t.slice(0, 15) + "…" : t;
  };
  const xAxisProps = {
    dataKey: spec.x,
    tick: { fontSize: 11, fill: AXIS },
    tickFormatter: axisText,
    interval: 0 as const,
    angle: 0,
    textAnchor: "middle" as const,
    height: 30,
    tickMargin: 8,
    minTickGap: 0,
  };

  const renderSeries = (kind: "bar" | "line" | "area") =>
    plotSeries.map((ps, i) =>
      kind === "line" ? (
        <Line key={ps.key} name={ps.name} type="monotone" dataKey={ps.key} stroke={colorFor(i)} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
      ) : kind === "area" ? (
        <Area key={ps.key} name={ps.name} type="monotone" dataKey={ps.key} stroke={colorFor(i)} fill={colorFor(i)} fillOpacity={0.15} strokeWidth={2} />
      ) : (
        <Bar key={ps.key} name={ps.name} dataKey={ps.key} fill={colorFor(i)} radius={[4, 4, 0, 0]} maxBarSize={64}
          onClick={(e: any) => handleDrill(e?.payload ?? e)} cursor={drillable ? "pointer" : "default"}>
          {!multi && chartData.map((_, idx) => <Cell key={idx} fill={BRAND} />)}
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
                className={`px-2 py-0.5 text-[11px] capitalize transition ${view === v ? "bg-ink text-white" : "bg-surface text-ink-muted hover:bg-surface-alt"}`}>
                {v}
              </button>
            ))}
          </div>
          {view === "chart" && (
            <div className="ml-1 flex overflow-hidden rounded border border-line">
              {(["bar", "line", "pie"] as ChartType[]).map((t) => (
                <button key={t} onClick={() => setType(t)}
                  className={`px-2 py-0.5 text-[11px] capitalize transition ${type === t ? "bg-brand text-white" : "bg-surface text-ink-muted hover:bg-brand-light"}`}>
                  {t}
                </button>
              ))}
            </div>
          )}
          <button onClick={exportPpt} title="Download as an editable PowerPoint slide"
            className="rounded border border-line px-2 py-0.5 text-[11px] font-medium text-ink-muted transition hover:border-brand hover:text-brand">
            PPT
          </button>
          <button onClick={exportXlsx} title="Download the data as Excel"
            className="rounded border border-line px-2 py-0.5 text-[11px] font-medium text-ink-muted transition hover:border-brand hover:text-brand">
            Excel
          </button>
        </div>
      </figcaption>

      {!isPivot && spec.series.length > 1 && view === "chart" && type !== "pie" && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-ink-faint">Measure:</span>
          {scalesComparable && (
            <MeasureBtn active={measure === "all"} onClick={() => setMeasure("all")}>All</MeasureBtn>
          )}
          {spec.series.map((s) => (
            <MeasureBtn key={s} active={measure === s} onClick={() => setMeasure(s)}>{pretty(s)}</MeasureBtn>
          ))}
          {!scalesComparable && measure === spec.series[0] && (
            <span className="text-[10px] text-ink-faint">(different scales — shown one at a time)</span>
          )}
        </div>
      )}

      {view === "table" ? (
        <MiniTable columns={tableColumns} rows={rows} fmt={cellFmt} />
      ) : (
        <ResponsiveContainer width="100%" height={288}>
          {type === "pie" ? (
            <PieChart>
              <Tooltip content={(p: any) => <CustomTooltip {...p} fmt={fl} />} />
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v: any) => fl(v)} />
              <Pie data={pieData} dataKey="__v" nameKey={spec.x} cx="50%" cy="50%" outerRadius={95} innerRadius={45} paddingAngle={2}
                onClick={(e: any) => handleDrill(e?.payload ?? e)} cursor={drillable ? "pointer" : "default"}>
                {pieData.map((_, i) => (
                  <Cell key={i} fill={CATEGORICAL[i % CATEGORICAL.length]} stroke="#fff" strokeWidth={2} />
                ))}
              </Pie>
            </PieChart>
          ) : type === "line" ? (
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis {...xAxisProps} />
              <YAxis tick={{ fontSize: 11, fill: AXIS }} tickFormatter={compact} width={46} />
              <Tooltip content={(p: any) => <CustomTooltip {...p} fmt={fl} />} />
              {multi && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {renderSeries("line")}
            </LineChart>
          ) : type === "area" ? (
            <AreaChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis {...xAxisProps} />
              <YAxis tick={{ fontSize: 11, fill: AXIS }} tickFormatter={compact} width={46} />
              <Tooltip content={(p: any) => <CustomTooltip {...p} fmt={fl} />} />
              {multi && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {renderSeries("area")}
            </AreaChart>
          ) : (
            <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }} barCategoryGap="22%">
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis {...xAxisProps} />
              <YAxis tick={{ fontSize: 11, fill: AXIS }} tickFormatter={compact} width={46} />
              <Tooltip content={(p: any) => <CustomTooltip {...p} fmt={fl} />} cursor={{ fill: "rgba(15,124,139,0.06)" }} />
              {multi && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {renderSeries("bar")}
            </BarChart>
          )}
        </ResponsiveContainer>
      )}

      {isPivot && view === "chart" && type !== "pie" && (
        <p className="mt-1 text-center text-[11px] text-ink-faint">
          Grouped by {pretty(groupKey!)}.
        </p>
      )}
      {drillable && view === "chart" && (
        <p className="mt-1.5 text-center text-[11px] text-ink-faint">
          Tip: click a {type === "pie" ? "slice" : "bar"} to drill into {pretty(spec.drilldown!)}.
        </p>
      )}
    </figure>
  );
}

function MeasureBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${active ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink-muted hover:border-brand"}`}>
      {children}
    </button>
  );
}

function MiniTable({ columns, rows, fmt }: { columns: string[]; rows: Record<string, unknown>[]; fmt: (col: string, val: unknown) => string }) {
  const totals = columnTotals(columns, rows);
  const showTotals = rows.length > 1 && Object.values(totals).some((v) => v !== null);
  return (
    <div className="max-h-72 overflow-auto rounded border border-line">
      <table className="min-w-full text-[12px]">
        <thead className="sticky top-0 bg-surface-alt">
          <tr>
            {columns.map((c) => (
              <th key={c} className="border-b border-line px-3 py-1.5 text-left font-semibold text-ink-muted">{pretty(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((r, i) => (
            <tr key={i} className="border-b border-line/60 last:border-0">
              {columns.map((c) => (
                <td key={c} className="px-3 py-1 tabular-nums text-ink">{fmt(c, r[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {showTotals && (
          <tfoot>
            <tr className="border-t-2 border-line-strong bg-surface-alt font-semibold">
              {columns.map((c, i) => (
                <td key={c} className="px-3 py-1 tabular-nums text-ink">
                  {totals[c] !== null ? formatTotal(totals[c] as number) : i === 0 ? "Total" : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
