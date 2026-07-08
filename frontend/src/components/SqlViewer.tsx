import { useState } from "react";

// Light SQL pretty-printer: break before major clauses and indent, so the query
// reads top-to-bottom and wraps within the panel (no horizontal scrolling).
function formatSql(sql: string): string {
  let s = (sql || "").replace(/\s+/g, " ").trim().replace(/\s*;\s*$/, "");
  // Newline before top-level clauses (word-boundary, case-insensitive).
  const clauses = [
    "FROM", "LEFT JOIN", "RIGHT JOIN", "INNER JOIN", "FULL JOIN", "JOIN",
    "WHERE", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "UNION ALL", "UNION",
  ];
  for (const kw of clauses) {
    const re = new RegExp("\\s+" + kw.replace(/ /g, "\\s+") + "\\b", "gi");
    s = s.replace(re, "\n" + kw + " ");
  }
  // Indent boolean continuations inside WHERE/ON a little.
  s = s.replace(/\s+\b(AND|OR)\b\s+/gi, "\n  $1 ");
  return s.trim();
}

export default function SqlViewer({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const pretty = formatSql(sql);

  async function copy() {
    await navigator.clipboard.writeText(pretty);
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
          <pre className="whitespace-pre-wrap break-words rounded bg-ink p-3 pr-16 text-[12px] leading-relaxed text-teal-100">
            <code className="font-mono">{pretty}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
