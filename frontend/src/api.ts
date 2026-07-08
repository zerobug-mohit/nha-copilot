// Typed client for the FastAPI backend.
//
// In dev, VITE_API_BASE is unset -> relative URLs go through the Vite proxy.
// In production (GitHub Pages), set VITE_API_BASE to the backend's HTTPS URL.
const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
const url = (path: string) => `${API_BASE}${path}`;

export interface LoginResponse {
  access_token: string;
  token_type: string;
  role: string;
  username: string;
}

export interface ChartSpec {
  type: "bar" | "line" | "area" | "pie";
  x: string;
  series: string[];
  title?: string;
  drilldown?: string;
}

export interface ChatResponse {
  session_id: string;
  action: "answer" | "clarify" | "out_of_scope" | "error";
  answer?: string | null;
  message?: string | null;
  sql?: string | null;
  columns: string[];
  rows: Record<string, unknown>[];
  chart?: ChartSpec | null;
  context_chips: Record<string, string>;
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const body = new URLSearchParams({ username, password });
  const res = await fetch(url("/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("Invalid username or password");
  return res.json();
}

export async function sendMessage(
  token: string,
  message: string,
  sessionId: string | null
): Promise<ChatResponse> {
  const res = await fetch(url("/chat/message"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message, session_id: sessionId }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Request failed (${res.status}): ${detail}`);
  }
  return res.json();
}
