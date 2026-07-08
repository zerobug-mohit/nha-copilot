import { useState } from "react";
import { login } from "../api";

export default function Login({
  onLogin,
}: {
  onLogin: (token: string, role: string, username: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await login(username, password);
      onLogin(res.access_token, res.role, res.username);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm animate-in">
        {/* Brand mark */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-brand text-lg font-bold text-white shadow-pop">
            NHA
          </div>
          <h1 className="text-xl font-semibold text-ink">SHA Analytical Co-pilot</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Ask PM-JAY claims &amp; beneficiary data in plain English.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-lg border border-line bg-surface p-6 shadow-soft"
        >
          <label className="mb-1 block text-sm font-medium text-ink">Username</label>
          <input
            className="mb-4 w-full rounded border border-line-strong bg-surface px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
          <label className="mb-1 block text-sm font-medium text-ink">Password</label>
          <input
            type="password"
            className="mb-5 w-full rounded border border-line-strong bg-surface px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <div className="mb-4 rounded border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded bg-brand py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-dark disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
