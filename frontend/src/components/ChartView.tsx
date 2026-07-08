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
import { columnTotals, formatTotal } from "../lib/totals";

// Brand hue for single-series (magnitude encoded by position, not color).
const BRAND = "#0f7c8b";
// Validated categorical palette (dataviz skill): worst adjacent CVD ΔE 24.2.
const CATEGORICAL = [
  "#2a78d6", "#1baf7a", "#eda100", "#008300",
  "#4a3aa7", "#e34948", "#e87ba4", "#eb6834",
];
const AXIS = "#6a7b83";
const GRID = "#e2e7ea";

type ChartType = "bar" | "line" | "area" | "pie";
type View = "chart" | "table";

// HBP specialty codes -> names (short codes stay on a crowded axis; full on hover).
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
// Coded flags are column-specific: "P" = Private (hospital) but Planned (admission).
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

/** Full, human-readable label for a value in a given column. */
function fullLabel(col: string, v: unknown): string {
  const s = String(v ?? "—");
  const cl = (col || "").toLowerCase();
  if (cl.includes("special")) return SPECIALTY[s] ?? s;
  const m = COLUMN_MAPS[cl];
  return (m && m[s]) || s;
}
/** Column name -> readable series label: total_paid_amount -> "Total paid amount". */
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
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return null;
}

function CustomTooltip({ active, payload, label, fmt }: any) {
  if (!active || !payload || !payload.length) return null;
  const title = fmt(label ?? payload[0]?.name); // pie has no `label`
  return (
    <div className="rounded border border-line bg-surface px-3 py-2 text-[12px] shadow-pop">
      <div className="mb-1 font-semibold text-ink">{title}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey ?? p.name} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
          <span className="text-ink-muted">{pretty(String(p.dataKey ?? p.name))}:</span>
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
  onDrill,
}: {
  spec: ChartSpec;
  rows: Record<string, unknown>[];
  columns?: string[];
  onDrill?: (value: string, dimension: string) => void;
}) {
  const [view, setView] = useState<View>("chart");
  const [type, setType] = useState<ChartType>(spec.type);

  const data = useMemo(() => {
    const cleaned = rows.map((r) => {
      const o: Record<string, unknown> = { [spec.x]: String(r[spec.x] ?? "—") };
      for (const s of spec.series) o[s] = toNum(r[s]) ?? 0;
      return o;
    });
    return cleaned.slice(0, type === "pie" ? 8 : 30);
  }, [rows, spec, type]);

  const scalesComparable = useMemo(() => {
    if (spec.series.length < 2) return true;
    const maxes = spec.series.map((s) => Math.max(0, ...data.map((d) => Math.abs(Number(d[s]) || 0))));
    const hi = Math.max(...maxes);
    const lo = Math.min(...maxes.filter((m) => m > 0));
    return lo > 0 && hi / lo <= 25;
  }, [data, spec.series]);

  const [measure, setMeasure] = useState<string>(
    spec.series.length < 2 || scalesComparable ? "all" : spec.series[0]
  );
  const active = measure === "all" ? spec.series : [measure];
  const multi = active.length > 1;
  const colorFor = (i: number) => (multi ? CATEGORICAL[i % CATEGORICAL.length] : BRAND);

  const fl = (v: unknown) => fullLabel(spec.x, v);
  const drillable = !!(spec.drilldown && onDrill);
  const handleDrill = (payload: any) => {
    if (drillable && payload) {
      const val = payload[spec.x] ?? payload.name ?? payload.payload?.[spec.x];
      if (val != null) onDrill!(fl(val), spec.drilldown!);
    }
  };

  // Axis labels: full when there's room (≤6 categories), short code when crowded.
  // Always horizontal (never tilted); truncate an unusually long label — the full
  // text still appears on hover.
  const useFullAxis = data.length <= 6;
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

  return (
    <figure className="mt-3 rounded-lg border border-line bg-surface p-3">
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink">{spec.title || "Result"}</span>
        <div className="flex items-center gap-1">
          {view === "chart" && (
            <div className="mr-1 flex overflow-hidden rounded border border-line">
              {(["bar", "line", "pie"] as ChartType[]).map((t) => (
                <button key={t} onClick={() => setType(t)}
                  className={`px-2 py-0.5 text-[11px] capitalize transition ${type === t ? "bg-brand text-white" : "bg-surface text-ink-muted hover:bg-brand-light"}`}>
                  {t}
                </button>
              ))}
            </div>
          )}
          <div className="flex overflow-hidden rounded border border-line">
            {(["chart", "table"] as View[]).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-2 py-0.5 text-[11px] capitalize transition ${view === v ? "bg-ink text-white" : "bg-surface text-ink-muted hover:bg-surface-alt"}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </figcaption>

      {spec.series.length > 1 && view === "chart" && type !== "pie" && (
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
        <MiniTable columns={[spec.x, ...spec.series]} rows={data} xKey={spec.x} fmt={fl} />
      ) : (
        <ResponsiveContainer width="100%" height={288}>
          {type === "pie" ? (
            <PieChart>
              <Tooltip content={(p: any) => <CustomTooltip {...p} fmt={fl} />} />
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v: any) => fl(v)} />
              <Pie data={data} dataKey={active[0]} nameKey={spec.x} cx="50%" cy="50%" outerRadius={95} innerRadius={45} paddingAngle={2}
                onClick={(e: any) => handleDrill(e?.payload ?? e)} cursor={drillable ? "pointer" : "default"}>
                {data.map((_, i) => (
                  <Cell key={i} fill={CATEGORICAL[i % CATEGORICAL.length]} stroke="#fff" strokeWidth={2} />
                ))}
              </Pie>
            </PieChart>
          ) : type === "line" ? (
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis {...xAxisProps} />
              <YAxis tick={{ fontSize: 11, fill: AXIS }} tickFormatter={compact} width={46} />
              <Tooltip content={(p: any) => <CustomTooltip {...p} fmt={fl} />} />
              {multi && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {active.map((s, i) => (
                <Line key={s} name={pretty(s)} type="monotone" dataKey={s} stroke={colorFor(i)} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              ))}
            </LineChart>
          ) : type === "area" ? (
            <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis {...xAxisProps} />
              <YAxis tick={{ fontSize: 11, fill: AXIS }} tickFormatter={compact} width={46} />
              <Tooltip content={(p: any) => <CustomTooltip {...p} fmt={fl} />} />
              {multi && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {active.map((s, i) => (
                <Area key={s} name={pretty(s)} type="monotone" dataKey={s} stroke={colorFor(i)} fill={colorFor(i)} fillOpacity={0.15} strokeWidth={2} />
              ))}
            </AreaChart>
          ) : (
            <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }} barCategoryGap="22%">
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis {...xAxisProps} />
              <YAxis tick={{ fontSize: 11, fill: AXIS }} tickFormatter={compact} width={46} />
              <Tooltip content={(p: any) => <CustomTooltip {...p} fmt={fl} />} cursor={{ fill: "rgba(15,124,139,0.06)" }} />
              {multi && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {active.map((s, i) => (
                <Bar key={s} name={pretty(s)} dataKey={s} fill={colorFor(i)} radius={[4, 4, 0, 0]} maxBarSize={64}
                  onClick={(e: any) => handleDrill(e?.payload ?? e)} cursor={drillable ? "pointer" : "default"}>
                  {!multi && data.map((_, idx) => <Cell key={idx} fill={BRAND} />)}
                </Bar>
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
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

function MiniTable({ columns, rows, xKey, fmt }: { columns: string[]; rows: Record<string, unknown>[]; xKey: string; fmt: (v: unknown) => string }) {
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
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line/60 last:border-0">
              {columns.map((c) => (
                <td key={c} className="px-3 py-1 tabular-nums text-ink">
                  {c === xKey ? fmt(r[c]) : typeof r[c] === "number" ? (r[c] as number).toLocaleString() : String(r[c] ?? "—")}
                </td>
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
