import { useState } from "react";
import { fetchWeeklyReport } from "../api";
import { buildWeeklyReport } from "../lib/reportPptx";

const WINDOW_MIN = "2026-01-01";
const WINDOW_MAX = "2026-07-10";

function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function mondayOf(iso: string): Date {
  const d = new Date(iso + "T00:00:00");
  const diff = (d.getDay() + 6) % 7; // 0=Mon
  d.setDate(d.getDate() - diff);
  return d;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function human(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export default function WeeklyReport({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("2026-06-01");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const monday = mondayOf(pick);
  const sunday = addDays(monday, 6);
  const start = fmtISO(monday);
  const endExclusive = fmtISO(addDays(monday, 7));

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const report = await fetchWeeklyReport(token, start, endExclusive);
      const k = report.kpis;
      const activity = k
        ? k.abha_created + k.records_linked + k.scan_share_txns + k.scan_pay_txns + k.facilities_verified
        : 0;
      if (!k || activity === 0) {
        setError("No ABDM activity found for this week. Pick a week within Jan–Jul 2026.");
        return;
      }
      await buildWeeklyReport(report);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-medium text-ink-muted transition hover:border-brand hover:text-brand"
        title="Download a weekly PowerPoint report"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        Weekly report
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-line bg-surface p-4 shadow-pop">
            <h3 className="text-sm font-semibold text-ink">Weekly report</h3>
            <p className="mt-0.5 text-[11px] text-ink-muted">
              Pick any day; the report covers that Mon–Sun week.
            </p>
            <label className="mt-3 block text-[11px] font-medium text-ink-muted">Week containing</label>
            <input
              type="date"
              value={pick}
              min={WINDOW_MIN}
              max={WINDOW_MAX}
              onChange={(e) => setPick(e.target.value)}
              className="mt-1 w-full rounded border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <div className="mt-2 rounded bg-brand-light px-2 py-1.5 text-[12px] text-brand-dark">
              {human(monday)} – {human(sunday)}
            </div>
            <p className="mt-1 text-[10px] text-ink-faint">Data available: Jan – Jul 2026 (Scan & Share / linking from Apr 2026).</p>
            {error && <div className="mt-2 rounded border border-danger-border bg-danger-bg px-2 py-1 text-[11px] text-danger">{error}</div>}
            <button
              onClick={generate}
              disabled={busy}
              className="mt-3 w-full rounded bg-brand py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
            >
              {busy ? "Building report…" : "Download PPT"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
