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
  options?: string[];
  questions?: { question: string; options: string[] }[];
  analysis?: { summary?: string; insights?: string[]; trends?: string[] } | null;
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

interface Delta {
  prev: number;
  change: number;
  pct: number | null;
}
export interface WeeklyReport {
  period: { start: string; end: string };
  kpis: {
    total_claims: number;
    unique_patients: number;
    paid_claims: number;
    pending_claims: number;
    rejected_claims: number;
    total_paid: number;
    avg_paid_per_claim: number;
    paid_rate: number;
    states_covered: number;
    hospitals_active: number;
    wow: { claims: Delta; patients: Delta; paid: Delta };
  };
  by_gender: { gender: string; claims: number; patients: number }[];
  by_age: { age_band: string; claims: number }[];
  by_specialty: { specialty: string; specialty_name?: string; claims: number; paid: number }[];
  by_state: { state: string; claims: number; paid: number }[];
  financial: {
    total_paid: number;
    total_approved: number;
    approved_unpaid_amount: number;
    approved_unpaid_count: number;
    avg_paid_per_claim: number;
  };
  tat: { stage: string; median: number; p90: number }[];
  by_status: { status: string; claims: number }[];
  pending_by_stage: { stage: string; claims: number }[];
  by_hospital_type: { hospital_type: string; claims: number; paid: number }[];
  portability: { portability: string; claims: number }[];
  bis: {
    new_enrollments: number;
    total_registered: number;
    card_status: { card_status: string; count: number }[];
  };
  analysis: { summary?: string; insights?: string[]; trends?: string[] } | null;
}

export async function fetchWeeklyReport(
  token: string,
  start: string,
  end: string
): Promise<WeeklyReport> {
  const res = await fetch(url(`/report/weekly?start=${start}&end=${end}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Report failed (${res.status}): ${await res.text()}`);
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
