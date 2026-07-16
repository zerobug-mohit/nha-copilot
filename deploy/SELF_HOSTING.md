# Hosting the NHA Co-pilot on your own infrastructure

This guide is for the **NHA / internal IT team**. It explains, step by step, how
to take this repository and run the application entirely on your own servers —
no GitHub Pages and no dependency on the original author.

You do **not** need to know React or Python to follow this. Where a real value
is needed (a hostname, a password), it is written like `<this>`.

---

## 1. How the application is put together

There are two independent pieces:

| Piece | What it is | What it needs to RUN |
|-------|-----------|----------------------|
| **Frontend** (`frontend/`) | The web page users open in their browser. It compiles down to plain HTML/JS/CSS files. | Any static web server (nginx, IIS, Apache, or a Docker container). **No Node.js at runtime.** |
| **Backend** (`backend/`) | A Python (FastAPI) API. It talks to BigQuery + OpenAI and answers the frontend's requests. | Python 3.11+, network access to BigQuery and OpenAI. |

The browser flow is:

```
User's browser  ──►  Frontend (static files)  ──►  Backend API  ──►  BigQuery / OpenAI
```

The frontend needs to know **one thing about the backend: its URL.** That URL is
chosen by you and set at build time (explained below).

You can host both pieces on the **same machine/domain** (simplest — recommended)
or on **separate hosts**. Both layouts are covered.

---

## 2. What you need before you start

- This repository, cloned onto a build machine:
  ```bash
  git clone <your-internal-copy-of-this-repo>
  cd nha-copilot
  ```
- **Node.js 20+** and **npm** on the machine where you will *build* the frontend
  (needed only to build; not needed on the server that *serves* it).
- A web server to host the built files (nginx / IIS / Docker).
- The **backend already running and reachable** (see Section 6), or its planned URL.

---

## 3. Decide two values first

Everything hinges on these two build-time settings. Get them right and the app
just works; get them wrong and you get a blank page or a login that hangs.

**(a) `VITE_API_BASE` — where the backend lives.**
- Backend on the **same domain** as the frontend (recommended, using nginx to
  forward API paths): leave this **empty**.
- Backend on a **different** host/URL: set the full HTTPS URL, e.g.
  `https://copilot-api.nha.internal` (no trailing slash).

**(b) `VITE_BASE` — the URL path the app is served from.**
- Served at the **domain root** — `https://copilot.nha.internal/` → set `/`
- Served under a **subpath** — `https://portal.nha.internal/copilot/` → set `/copilot/`
  (keep both slashes).

---

## 4. Configure and build the frontend

From the repository root:

```bash
cd frontend

# 1. Create your config from the template
cp .env.example .env
#    (Windows PowerShell:  Copy-Item .env.example .env)

# 2. Edit .env and set the two values from Section 3, e.g.
#      VITE_API_BASE=
#      VITE_BASE=/

# 3. Install dependencies (first time only)
npm ci

# 4. Build
npm run build
```

The result is the folder **`frontend/dist/`**. That folder — and only that
folder — is what you deploy. It contains `index.html` and an `assets/` folder.

> Changed a value in `.env` later? Just run `npm run build` again and redeploy
> `dist/`. The values are baked in at build time.

---

## 5. Host the built files — pick ONE option

### Option A — nginx (Linux) — recommended

Best when the frontend and backend share one machine, because nginx can serve
the page **and** forward API calls to the backend, so everything is one origin
(no CORS to configure).

1. Copy the contents of `frontend/dist/` to the server, e.g. `/var/www/nha-copilot`.
2. Copy [`deploy/nginx.conf.example`](nginx.conf.example) to
   `/etc/nginx/conf.d/nha-copilot.conf`, then edit `server_name` and `root`.
   Use **Layout A** in that file for same-host, **Layout B** for a separate backend.
3. Apply:
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```
4. For same-host, build with `VITE_API_BASE` **empty** and `VITE_BASE=/`.

### Option B — IIS (Windows)

1. Build with a **separate backend URL** (simplest on IIS):
   `VITE_API_BASE=https://copilot-api.nha.internal` and `VITE_BASE=/`.
2. Copy everything inside `frontend/dist/` into your IIS site's physical folder.
3. Copy [`deploy/web.config`](web.config) into that same folder.
4. In **IIS Manager**, point a site (or application) at that folder and browse.
5. Add the frontend's origin to the backend's CORS list (see Section 7).

### Option C — Docker (any OS with Docker)

Builds and serves in one container using the included
[`deploy/Dockerfile.frontend`](Dockerfile.frontend). From the repo root:

```bash
docker build -f deploy/Dockerfile.frontend \
  --build-arg VITE_API_BASE=https://copilot-api.nha.internal \
  --build-arg VITE_BASE=/ \
  -t nha-copilot-frontend .

docker run -d --name nha-copilot-frontend -p 8080:80 nha-copilot-frontend
```

The app is then at `http://<host>:8080/`. Put your own TLS/reverse proxy in front
for HTTPS.

---

## 6. Host the backend (if you're also moving it internally)

The full backend setup — VM, Python service, HTTPS — is documented in
[`deploy/README.md`](README.md). The short version:

1. Install Python 3.11+ and the dependencies: `pip install -r backend/requirements.txt`.
2. Copy `backend/.env.example` to `backend/.env` and fill in:
   - `GCP_PROJECT`, `BQ_DATASET` (your BigQuery project/dataset),
   - `OPENAI_API_KEY`, `OPENAI_MODEL`,
   - `JWT_SECRET` (a long random string), `APP_USERS` (login accounts),
   - `CORS_ORIGINS` (see Section 7).
3. Provide BigQuery credentials (a service account with **BigQuery Data Viewer**
   + **Job User**). On GCP VMs the attached service account is used automatically;
   elsewhere set `GOOGLE_CREDENTIALS_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`.
4. Run it: `uvicorn app.main:app --host 0.0.0.0 --port 8000` (or use the
   `deploy/nha-copilot.service` systemd unit for auto-start).
5. Confirm: `curl http://127.0.0.1:8000/health` → `{"status":"ok"}`.

Put the backend behind HTTPS (nginx or Caddy) for production — browsers block a
secure page from calling an insecure API.

---

## 7. The one thing that trips everyone up: CORS

If the frontend and backend are on **different origins**, the backend must
explicitly allow the frontend's origin, or the browser silently blocks every
request and login appears to "hang".

In `backend/.env`, set `CORS_ORIGINS` to your frontend's origin (comma-separated
for more than one, **no trailing slash**):

```
CORS_ORIGINS=https://copilot.nha.internal
```

Then restart the backend. If you used nginx **Layout A** (same origin), you can
leave CORS at its default — there's no cross-origin call to allow.

---

## 8. Verify end to end

1. Open the frontend URL in a browser.
2. It should load the login screen (not a blank page).
3. Log in with an account from `APP_USERS`.
4. Ask a question and confirm a result comes back.

---

## 9. Troubleshooting

| Symptom | Most likely cause | Fix |
|---------|-------------------|-----|
| **Blank white page**, console shows 404s for `/assets/...` | `VITE_BASE` doesn't match the serving path | Set `VITE_BASE` to `/` (root) or `/subpath/`, rebuild, redeploy |
| **Login spins / "Network error"**, browser console shows a CORS error | Frontend origin not in backend `CORS_ORIGINS` | Add the exact origin (no trailing slash), restart backend |
| Login fails with 4xx | Wrong `VITE_API_BASE`, or backend unreachable | Check `VITE_API_BASE` (no trailing slash); `curl` the backend `/health` |
| Mixed-content error in console | HTTPS page calling an HTTP backend | Serve the backend over HTTPS too |
| Page loads but says wrong/old backend | `.env` changed but not rebuilt | Re-run `npm run build`, redeploy `dist/` |

---

## 10. Updating later

- **Frontend:** `git pull`, then `cd frontend && npm ci && npm run build`, and
  redeploy `dist/` (or rebuild the Docker image).
- **Backend:** `git pull`, reinstall deps if `requirements.txt` changed, restart
  the service.

---

### File reference

| File | Purpose |
|------|---------|
| `frontend/.env.example` | Template for the two build settings |
| `deploy/nginx.conf.example` | Ready-to-edit nginx config (same-host or split) |
| `deploy/web.config` | Ready-to-drop IIS config |
| `deploy/Dockerfile.frontend` | Optional one-container build+serve |
| `deploy/README.md` | Full backend (VM) deployment guide |
| `deploy/env.example` | Backend environment template (VM layout) |
