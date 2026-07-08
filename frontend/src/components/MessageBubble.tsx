import type { ChatResponse } from "../api";
import Avatar from "./Avatar";
import ChartView from "./ChartView";
import ContextChips from "./ContextChips";
import ResultTable from "./ResultTable";
import SqlViewer from "./SqlViewer";

export interface ChatMessage {
  sender: "user" | "assistant";
  text: string;
  data?: ChatResponse;
}

export default function MessageBubble({
  msg,
  index,
  onDrill,
  isEditing = false,
  editingText = "",
  onStartEdit,
  onEditChange,
  onSubmitEdit,
  onCancelEdit,
}: {
  msg: ChatMessage;
  index: number;
  onDrill?: (value: string, dimension: string) => void;
  isEditing?: boolean;
  editingText?: string;
  onStartEdit?: (index: number) => void;
  onEditChange?: (text: string) => void;
  onSubmitEdit?: () => void;
  onCancelEdit?: () => void;
}) {
  const isUser = msg.sender === "user";
  const data = msg.data;

  if (isUser) {
    // Inline edit mode
    if (isEditing) {
      return (
        <div className="flex justify-end animate-in">
          <div className="w-full max-w-[80%]">
            <textarea
              autoFocus
              rows={2}
              value={editingText}
              onChange={(e) => onEditChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmitEdit?.();
                } else if (e.key === "Escape") {
                  onCancelEdit?.();
                }
              }}
              className="w-full resize-none rounded-lg border border-brand bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-brand/20"
            />
            <div className="mt-1 flex justify-end gap-2">
              <button
                onClick={onCancelEdit}
                className="rounded-full border border-line px-3 py-1 text-[12px] text-ink-muted hover:bg-surface-alt"
              >
                Cancel
              </button>
              <button
                onClick={onSubmitEdit}
                disabled={!editingText.trim()}
                className="rounded-full bg-brand px-3 py-1 text-[12px] font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      );
    }
    // Normal user bubble with hover "edit" affordance
    return (
      <div className="group flex items-center justify-end gap-1.5 animate-in">
        {onStartEdit && (
          <button
            onClick={() => onStartEdit(index)}
            title="Edit & resend"
            aria-label="Edit message"
            className="opacity-0 transition group-hover:opacity-100 text-ink-faint hover:text-brand"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
        )}
        <div className="max-w-[80%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-brand px-4 py-2 text-sm text-white shadow-soft">
          {msg.text}
        </div>
      </div>
    );
  }

  const action = data?.action;
  const tone =
    action === "error"
      ? "border-danger-border bg-danger-bg"
      : action === "out_of_scope" || action === "clarify"
      ? "border-gold-border bg-gold-bg"
      : "border-line bg-surface";

  const badge =
    action === "error"
      ? { label: "Could not answer", cls: "bg-danger/10 text-danger" }
      : action === "clarify"
      ? { label: "Needs clarification", cls: "bg-gold/10 text-gold" }
      : action === "out_of_scope"
      ? { label: "Out of scope", cls: "bg-gold/10 text-gold" }
      : null;

  return (
    <div className="flex justify-start gap-2 animate-in">
      <Avatar />
      <div className={`w-full max-w-[85%] rounded-lg rounded-tl-sm border px-4 py-3 shadow-soft ${tone}`}>
        {data?.context_chips && <ContextChips chips={data.context_chips} />}
        {badge && (
          <span className={`mb-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.cls}`}>
            {badge.label}
          </span>
        )}
        <div className="whitespace-pre-wrap text-sm text-ink">{msg.text}</div>
        {data?.chart && data.rows && data.rows.length > 1 ? (
          <ChartView spec={data.chart} rows={data.rows} columns={data.columns} onDrill={onDrill} />
        ) : (
          data?.columns && data.rows && data.rows.length > 0 && (
            <ResultTable columns={data.columns} rows={data.rows} />
          )
        )}
        {data?.sql && <SqlViewer sql={data.sql} />}
      </div>
    </div>
  );
}
