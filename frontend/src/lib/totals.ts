// Compute per-column totals for a result set.
//
// Only sums columns that are genuine additive measures. Columns whose name looks
// like an identifier, code, year, flag, or a rate/percentage/average are NOT
// summed (a sum of averages or of LGD codes is meaningless) — those return null.

const NON_SUMMABLE =
  /(^id$|_id$|^id_|_cd$|_code$|code$|pincode|_flag$|flag$|year|_yr$|\bavg\b|average|mean|median|\brate\b|ratio|percent|pct|share|%|lat|lon|longitude|latitude)/i;

function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return null;
}

/** Returns a total per column (number) or null when the column isn't summable. */
export function columnTotals(
  columns: string[],
  rows: Record<string, unknown>[]
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const c of columns) {
    if (NON_SUMMABLE.test(c)) {
      out[c] = null;
      continue;
    }
    let sum = 0;
    let hasNum = false;
    let ok = true;
    for (const r of rows) {
      const v = r[c];
      if (v === null || v === undefined || v === "") continue;
      const n = toNum(v);
      if (n === null) {
        ok = false;
        break;
      }
      sum += n;
      hasNum = true;
    }
    out[c] = ok && hasNum ? sum : null;
  }
  return out;
}

/** Format a number for display: whole numbers plain, decimals capped to 2 dp,
 * with thousands separators. Used for table cells, tooltips, and totals so no
 * raw float like 22.366906474… ever reaches the UI. */
export function fmtNum(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString()
    : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Format a total for display (alias of fmtNum, kept for call sites). */
export const formatTotal = fmtNum;
