import { describe, it, expect } from "vitest";
import {
  resolveChart, analyze, buildChartData, allowedTypes, defaultType,
  compact, toNum, timeLike, makeLabeler, pretty,
  MAX_CATS_BAR, MAX_CATS_PIE, OTHER, type ChartSpecLike, type Row,
} from "./chartEngine";

const rows = (...r: Row[]) => r;

// ---------------------------------------------------------------------------
// Representative queries — the "core" cases the tool must always get right.
// ---------------------------------------------------------------------------

describe("single-measure ranking (claims by state)", () => {
  const spec: ChartSpecLike = { type: "bar", x: "state", series: ["claim_count"], drilldown: "district" };
  const data = rows(
    { state: "UTTAR PRADESH", claim_count: 62 },
    { state: "GUJARAT", claim_count: 138 },
  );
  const r = resolveChart(spec, data);

  it("chooses a bar chart, offers bar+pie only (no line for non-time)", () => {
    expect(r.chartType).toBe("bar");
    expect(r.allowed).toEqual(["bar", "pie"]);
  });
  it("sorts categories by value descending", () => {
    expect(r.chartData.map((d) => d.state)).toEqual(["GUJARAT", "UTTAR PRADESH"]);
    expect(r.chartData.map((d) => d.claim_count)).toEqual([138, 62]);
  });
  it("keeps values exact (no axis/domain padding in the data)", () => {
    const maxVal = Math.max(...r.chartData.map((d) => d.claim_count as number));
    expect(maxVal).toBe(138); // never 149.04… — the engine never scales values
  });
  it("goes horizontal because a label is long (UTTAR PRADESH)", () => {
    expect(r.layout.horizontal).toBe(true);
    expect(r.layout.showLabels).toBe(true);
  });
});

describe("small categorical breakdown (rural vs urban)", () => {
  const spec: ChartSpecLike = { type: "bar", x: "rural_urban_flag", series: ["claim_count"] };
  const data = rows(
    { rural_urban_flag: "R", claim_count: 140 },
    { rural_urban_flag: "U", claim_count: 60 },
  );
  const r = resolveChart(spec, data);

  it("stays a vertical bar (few short labels) with value labels", () => {
    expect(r.chartType).toBe("bar");
    expect(r.layout.horizontal).toBe(false);
    expect(r.layout.showLabels).toBe(true);
  });
  it("humanizes coded values on the axis", () => {
    expect(r.analysis.fl("R")).toBe("Rural");
    expect(r.analysis.fl("U")).toBe("Urban");
  });
});

describe("time series (monthly amount paid)", () => {
  const spec: ChartSpecLike = { type: "line", x: "month", series: ["amount_paid"] };
  const data = rows(
    { month: "2025-04", amount_paid: 300 },
    { month: "2025-05", amount_paid: 100 },
    { month: "2025-06", amount_paid: 500 },
  );
  const r = resolveChart(spec, data);

  it("chooses a line chart and offers line (not pie)", () => {
    expect(r.chartType).toBe("line");
    expect(r.allowed).toContain("line");
    expect(r.allowed).not.toContain("pie");
  });
  it("preserves chronological order (does NOT sort by value)", () => {
    expect(r.chartData.map((d) => d.month)).toEqual(["2025-04", "2025-05", "2025-06"]);
  });
});

describe("grouped two-dimension (state × hospital_type)", () => {
  const spec: ChartSpecLike = { type: "bar", x: "state", series: ["claim_count"] };
  const cols = ["state", "hospital_type", "claim_count"];
  const data = rows(
    { state: "GUJARAT", hospital_type: "G", claim_count: 40 },
    { state: "GUJARAT", hospital_type: "P", claim_count: 60 },
    { state: "BIHAR", hospital_type: "G", claim_count: 30 },
    { state: "BIHAR", hospital_type: "P", claim_count: 20 },
  );
  const r = resolveChart(spec, data, cols);

  it("pivots into a small number of readable series", () => {
    expect(r.analysis.isPivot).toBe(true);
    expect(r.multi).toBe(true);
    expect(r.plotSeries.map((p) => p.name)).toEqual(["Government", "Private"]);
  });
  it("offers only bar for a grouped chart (no pie, no direct labels)", () => {
    expect(r.allowed).toEqual(["bar"]);
    expect(r.layout.showLabels).toBe(false);
    expect(r.layout.horizontal).toBe(false);
  });
  it("aggregates each cell correctly", () => {
    const guj = r.chartData.find((d) => d.state === "GUJARAT")!;
    expect(guj.G).toBe(40);
    expect(guj.P).toBe(60);
  });
});

describe("part-to-whole (case status → pie)", () => {
  const spec: ChartSpecLike = { type: "pie", x: "case_status", series: ["cnt"] };
  const data = rows(
    { case_status: "Paid", cnt: 70 },
    { case_status: "Pending", cnt: 20 },
    { case_status: "Rejected", cnt: 10 },
  );
  const r = resolveChart(spec, data);
  it("honours the pie request for a small part-to-whole set", () => {
    expect(r.chartType).toBe("pie");
    expect(r.allowed).toContain("pie");
  });
});

describe("pie requested but too many slices → falls back to bar", () => {
  const spec: ChartSpecLike = { type: "pie", x: "district", series: ["cnt"] };
  const data = Array.from({ length: 10 }, (_, i) => ({ district: `D${i}`, cnt: i + 1 }));
  const r = resolveChart(spec, data);
  it("does not offer pie for >7 categories and falls back", () => {
    expect(r.allowed).not.toContain("pie");
    expect(r.chartType).toBe("bar");
  });
});

describe("top-N with tail folded into Other (high-cardinality single dim)", () => {
  const spec: ChartSpecLike = { type: "bar", x: "district", series: ["cnt"] };
  const data = Array.from({ length: 20 }, (_, i) => ({ district: `D${i + 1}`, cnt: i + 1 }));
  const r = resolveChart(spec, data);

  it("caps at MAX_CATS_BAR and reports how many were folded", () => {
    expect(r.catCount).toBe(MAX_CATS_BAR);
    expect(r.folded).toBe(20 - (MAX_CATS_BAR - 1));
  });
  it("adds a final Other bucket equal to the sum of the tail", () => {
    const last = r.chartData[r.chartData.length - 1];
    expect(last.district).toBe(OTHER);
    // tail = the 7 smallest of 1..20 = 1..7 → 28
    expect(last.cnt).toBe(28);
  });
  it("goes horizontal for many categories", () => {
    expect(r.layout.horizontal).toBe(true);
  });
});

describe("high-cardinality 2nd dimension → aggregate, don't explode", () => {
  const spec: ChartSpecLike = { type: "bar", x: "state", series: ["cnt"] };
  const cols = ["state", "district", "cnt"];
  const data: Row[] = [];
  for (const s of ["GUJARAT", "BIHAR"]) for (let d = 0; d < 8; d++) data.push({ state: s, district: `${s}-D${d}`, cnt: 10 });
  const r = resolveChart(spec, data, cols);

  it("detects too-many-groups and does not pivot", () => {
    expect(r.analysis.tooManyGroups).toBe(true);
    expect(r.analysis.isPivot).toBe(false);
  });
  it("collapses to a single-series total per primary category", () => {
    expect(r.plotSeries).toHaveLength(1);
    const guj = r.chartData.find((d) => d.state === "GUJARAT")!;
    expect(guj.cnt).toBe(80); // 8 districts × 10
  });
});

// ---------------------------------------------------------------------------
// Chart-type selection rules in isolation
// ---------------------------------------------------------------------------

describe("allowedTypes / defaultType rules", () => {
  const nonTime = analyze({ x: "state", series: ["v"] }, rows({ state: "A", v: 1 }, { state: "B", v: 2 }));
  const time = analyze({ x: "month", series: ["v"] }, rows({ month: "1", v: 1 }));

  it("single non-time small set → bar + pie", () => {
    expect(allowedTypes(nonTime, false, 3)).toEqual(["bar", "pie"]);
  });
  it("time series → bar + line, never pie", () => {
    expect(allowedTypes(time, false, 12)).toEqual(["bar", "line"]);
  });
  it("multi-series → bar only", () => {
    expect(allowedTypes(nonTime, true, 3)).toEqual(["bar"]);
  });
  it("large single set → bar only (no pie past the cap)", () => {
    expect(allowedTypes(nonTime, false, MAX_CATS_PIE + 2)).toEqual(["bar"]);
  });
  it("area collapses to line; unavailable request falls back", () => {
    expect(defaultType({ x: "month", series: ["v"], type: "area" }, time, ["bar", "line"])).toBe("line");
    expect(defaultType({ x: "state", series: ["v"], type: "pie" }, nonTime, ["bar"])).toBe("bar");
  });
});

// ---------------------------------------------------------------------------
// Multi-measure scale handling
// ---------------------------------------------------------------------------

describe("multi-measure scale handling", () => {
  it("comparable scales → default to plotting all series together", () => {
    const spec: ChartSpecLike = { x: "month", series: ["preauth", "paid"] };
    const data = rows({ month: "1", preauth: 100, paid: 90 }, { month: "2", preauth: 120, paid: 110 });
    const a = analyze(spec, data);
    expect(a.scalesComparable).toBe(true);
    expect(a.defaultMeasure).toBe("all");
    expect(resolveChart(spec, data).multi).toBe(true);
  });
  it("wildly different scales → default to a single measure (not a squashed chart)", () => {
    const spec: ChartSpecLike = { x: "month", series: ["claims", "amount"] };
    const data = rows({ month: "1", claims: 100, amount: 5_000_000 }, { month: "2", claims: 120, amount: 6_000_000 });
    const a = analyze(spec, data);
    expect(a.scalesComparable).toBe(false);
    expect(a.defaultMeasure).toBe("claims");
    expect(resolveChart(spec, data).multi).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Formatting & value humanization (labels)
// ---------------------------------------------------------------------------

describe("compact number formatting (currency in Cr/L/k)", () => {
  it("formats magnitudes without floating-point garbage", () => {
    expect(compact(138)).toBe("138");
    expect(compact(0)).toBe("0");
    expect(compact(1500)).toBe("1.5k");
    expect(compact(250000)).toBe("2.5L");
    expect(compact(14_904_000)).toBe("1.5Cr");
    expect(compact(20_000_000)).toBe("2Cr"); // trailing .0 stripped
  });
});

describe("value humanization by column / value-set", () => {
  it("maps specialty codes", () => {
    const f = makeLabeler("speciality_code", ["MC", "SG"]);
    expect(f("MC")).toBe("Cardiology");
    expect(f("SG")).toBe("General Surgery");
  });
  it("maps gender and preserves Other", () => {
    const f = makeLabeler("gender", ["M", "F"]);
    expect(f("M")).toBe("Male");
    expect(f(OTHER)).toBe(OTHER);
  });
  it("infers Rural/Urban from the value set even without a known column name", () => {
    const f = makeLabeler("flag_x", ["R", "U"]);
    expect(f("R")).toBe("Rural");
    expect(f("U")).toBe("Urban");
  });
  it("pretty-prints snake_case column names", () => {
    expect(pretty("claim_count")).toBe("Claim count");
  });
});

// ---------------------------------------------------------------------------
// Robustness / edge cases
// ---------------------------------------------------------------------------

describe("robustness", () => {
  it("treats numeric strings as numbers", () => {
    expect(toNum("138")).toBe(138);
    expect(toNum("")).toBeNull();
    expect(toNum("abc")).toBeNull();
    const a = analyze({ x: "state", series: ["cnt"] }, rows({ state: "A", cnt: "138" }, { state: "B", cnt: "62" }));
    expect(a.numericCols).toContain("cnt");
  });
  it("recognizes time-like column names", () => {
    expect(timeLike("month")).toBe(true);
    expect(timeLike("admission_dt")).toBe(true);
    expect(timeLike("state")).toBe(false);
  });
  it("handles a single-row scalar result cleanly", () => {
    const r = resolveChart({ x: "metric", series: ["value"] }, rows({ metric: "Total claims", value: 586872 }));
    expect(r.catCount).toBe(1);
    expect(r.chartType).toBe("bar");
    expect(r.layout.showLabels).toBe(true);
  });
  it("does not crash on empty rows", () => {
    const r = resolveChart({ x: "state", series: ["cnt"] }, []);
    expect(r.chartData).toEqual([]);
    expect(r.chartType).toBe("bar");
  });
  it("sums duplicate categories in a single dimension", () => {
    const { chartData } = buildChartData(
      { x: "state", series: ["cnt"] },
      rows({ state: "A", cnt: 10 }, { state: "A", cnt: 5 }, { state: "B", cnt: 3 }),
      analyze({ x: "state", series: ["cnt"] }, rows({ state: "A", cnt: 10 })),
      "all"
    );
    const a = chartData.find((d) => d.state === "A")!;
    expect(a.cnt).toBe(15);
  });
});
