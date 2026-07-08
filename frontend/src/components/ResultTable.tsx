import { columnTotals, formatTotal } from "../lib/totals";

export default function ResultTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
}) {
  if (!rows || rows.length === 0) return null;
  const totals = columnTotals(columns, rows);
  const showTotals = rows.length > 1 && Object.values(totals).some((v) => v !== null);
  return (
    <div className="mt-3 overflow-x-auto rounded border border-line">
      <table className="min-w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-surface-alt">
            {columns.map((c) => (
              <th
                key={c}
                className="whitespace-nowrap border-b border-line px-3 py-2 text-left font-semibold text-ink-muted"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((row, i) => (
            <tr key={i} className="border-b border-line/60 last:border-0 hover:bg-brand-light/40">
              {columns.map((c) => (
                <td key={c} className="whitespace-nowrap px-3 py-1.5 tabular-nums text-ink">
                  {formatCell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {showTotals && (
          <tfoot>
            <tr className="border-t-2 border-line-strong bg-surface-alt font-semibold">
              {columns.map((c, i) => (
                <td key={c} className="whitespace-nowrap px-3 py-1.5 tabular-nums text-ink">
                  {totals[c] !== null ? formatTotal(totals[c] as number) : i === 0 ? "Total" : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      {rows.length > 100 && (
        <div className="bg-surface-alt px-3 py-1 text-[11px] text-ink-faint">
          Showing first 100 of {rows.length} rows. (Total covers all {rows.length}.)
        </div>
      )}
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}
