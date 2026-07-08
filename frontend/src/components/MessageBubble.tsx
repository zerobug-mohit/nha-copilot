import type { ChatResponse } from "../api";
import Avatar from "./Avatar";
import ContextChips from "./ContextChips";
import ResultTable from "./ResultTable";
import SqlViewer from "./SqlViewer";

export interface ChatMessage {
  sender: "user" | "assistant";
  text: string;
  data?: ChatResponse;
}

export default function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.sender === "user";
  const data = msg.data;

  if (isUser) {
    return (
      <div className="flex justify-end animate-in">
        <div className="max-w-[80%] rounded-lg rounded-br-sm bg-brand px-4 py-2 text-sm text-white shadow-soft">
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
        {data?.columns && data.rows && data.rows.length > 0 && (
          <ResultTable columns={data.columns} rows={data.rows} />
        )}
        {data?.sql && <SqlViewer sql={data.sql} />}
      </div>
    </div>
  );
}
