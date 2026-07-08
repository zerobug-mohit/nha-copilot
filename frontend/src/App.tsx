import { useState } from "react";
import ChatWindow from "./components/ChatWindow";
import Login from "./components/Login";

interface Auth {
  token: string;
  role: string;
  username: string;
}

export default function App() {
  // Session persists within the browser tab only (prototype scope).
  const [auth, setAuth] = useState<Auth | null>(() => {
    const raw = sessionStorage.getItem("nha_auth");
    return raw ? (JSON.parse(raw) as Auth) : null;
  });

  function handleLogin(token: string, role: string, username: string) {
    const a = { token, role, username };
    sessionStorage.setItem("nha_auth", JSON.stringify(a));
    setAuth(a);
  }

  function handleLogout() {
    sessionStorage.removeItem("nha_auth");
    setAuth(null);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        {auth ? (
          <ChatWindow
            token={auth.token}
            role={auth.role}
            username={auth.username}
            onLogout={handleLogout}
          />
        ) : (
          <Login onLogin={handleLogin} />
        )}
      </div>
      <footer className="border-t border-line bg-surface px-4 py-1.5 text-center text-[11px] text-ink-faint">
        For support, contact the developer at{" "}
        <a href="mailto:mchaurasiya@wjcf.in" className="font-medium text-brand hover:underline">
          mchaurasiya@wjcf.in
        </a>
      </footer>
    </div>
  );
}
