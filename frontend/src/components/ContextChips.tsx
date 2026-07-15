export default function ContextChips({ chips }: { chips: Record<string, string> }) {
  const entries = Object.entries(chips).filter(([, v]) => v);
  if (entries.length === 0) return null;
  const label: Record<string, string> = {
    geography: "Location",
    period: "Period",
  };
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => (
        <span
          key={k}
          className="inline-flex items-center gap-1 rounded-full border border-brand/20 bg-brand-light px-2.5 py-0.5 text-[11px] font-medium text-brand-dark"
        >
          <span className="text-ink-faint">{label[k] ?? k}:</span> {v}
        </span>
      ))}
    </div>
  );
}
