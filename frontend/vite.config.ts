import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In production the app is served from https://<user>.github.io/nha-copilot/,
// so the base path must match the repo name. In dev it stays at "/".
export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/nha-copilot/" : "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Dev only: proxy API calls to the local FastAPI backend.
      "/auth": "http://localhost:8000",
      "/chat": "http://localhost:8000",
      "/query-log": "http://localhost:8000",
      "/report": "http://localhost:8000",
      "/explorer": "http://localhost:8000",
      "/pdfchat": "http://localhost:8000",
      "/health": "http://localhost:8000",
    },
  },
}));
