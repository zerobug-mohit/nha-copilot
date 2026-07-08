import { useState } from "react";

export default function SqlViewer({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mt-3 border-t border-line pt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs font-medium text-brand transition hover:text-brand-dark"
      >
        <span className="text-[10px]">{open ? "▼" : "▶"}</span>
        View query used to generate this insight
      </button>
      {open && (
        <div className="relative mt-2">
          <button
            onClick={copy}
            className="absolute right-2 top-2 rounded border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] text-slate-200 transition hover:bg-white/20"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <pre className="overflow-x-auto rounded bg-ink p-3 pr-16 text-[12px] leading-relaxed text-teal-100">
            <code className="font-mono">{sql}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
