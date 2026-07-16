# Self-Hosting Guide — NHA Analytics Co-Pilot

A complete, step-by-step guide for the **NHA / internal IT team** to run the
whole application on your own infrastructure — no GitHub Pages, no dependency on
the original author. Follow it top to bottom.

You do **not** need to know React or Python. Where a real value is needed (a
hostname, a password, a key), it is written like `<this>` — replace it.

---

## Table of contents

1. [How it fits together](#1-how-it-fits-together)
2. [Before you start (prerequisites & network)](#2-before-you-start)
3. [Get the code](#3-get-the-code)
4. [Set up the BACKEND](#4-set-up-the-backend)
5. [Run the backend as a service](#5-run-the-backend-as-a-service)
6. [Put the backend behind HTTPS](#6-put-the-backend-behind-https)
7. [Build the FRONTEND](#7-build-the-frontend)
8. [Serve the frontend (nginx / IIS / Docker)](#8-serve-the-frontend)
9. [Wire the two together (CORS)](#9-wire-the-two-together-cors)
10. [Verify end to end](#10-verify-end-to-end)
11. [Troubleshooting](#11-troubleshooting)
12. [Updating later](#12-updating-later)
13. [Deployment checklist](#13-deployment-checklist)

---

## 1. How it fits together

Two independent pieces:

| Piece | What it is | What it needs to RUN |
|-------|-----------|----------------------|
| **Backend** (`backend/`) | A Python (FastAPI) API. Handles login, turns questions into SQL, runs read-only queries on BigQuery, calls OpenAI. | Python 3.11+, **outbound internet** to BigQuery + OpenAI. Listens on port **8000**. |
| **Frontend** (`frontend/`) | The web page users open. Compiles to plain HTML/JS/CSS. | Any static web server (nginx / IIS / Apache / Docker). **No Node.js at runtime.** |

Request flow:

```
User's browser ──► Frontend (static files) ──► Backend API (:8000) ──► BigQuery / OpenAI
```

The frontend only needs to know **one thing** about the backend: its URL. You
choose that URL and set it when you build the frontend (Step 7).

You can run both pieces on **one machine/domain** (simplest — recommended) or on
**separate hosts**. Both are covered.

---

## 2. Before you start

**Machines / OS** — Linux (Ubuntu/Debian) or Windows Server both work. Steps
give commands for both.

**Software**

| Tool | Where | Version |
|------|-------|---------|
| Git | build machine | any recent |
| Python + pip | backend host | **3.11+** (tested on 3.13) |
| Node.js + npm | build machine only (to build the frontend) | **20+** |
| A web server | frontend host | nginx, IIS, or Docker |
| Tesseract OCR *(optional)* | backend host | only if using "Chat with PDFs" on scanned PDFs |

**Accounts / secrets you must have ready**

- A **Google Cloud service account JSON key** with read-only BigQuery access
  (roles `BigQuery Data Viewer` + `BigQuery Job User`) on the project that holds
  the 9 ABDM tables. (See Step 4.2 for how to create it.)
- An **OpenAI API key**.

> **Network gotcha (important for internal/govt networks):** the backend must be
> able to make **outbound HTTPS** calls to `*.googleapis.com` (BigQuery) and
> `api.openai.com` (OpenAI). If your network is locked down, ask the network team
> to allow these, or configure an outbound proxy (set `HTTPS_PROXY` in the
> backend's environment). Without this, queries will time out.

---

## 3. Get the code

On the build machine:

```bash
git clone <your-internal-copy-of-this-repo> nha-copilot
cd nha-copilot
```

The two folders that matter are `backend/` and `frontend/`.

---

## 4. Set up the BACKEND

### 4.1 Install Python dependencies

**Linux**
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

**Windows (PowerShell)**
```powershell
cd backend
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt
```

### 4.2 Get BigQuery credentials (service account key)

1. In the **Google Cloud Console** → *IAM & Admin → Service Accounts* → **Create
   service account** (name it e.g. `nha-copilot-reader`).
2. Grant it exactly two roles: **BigQuery Data Viewer** and **BigQuery Job User**
   (read-only — this is a hard safety layer; the DB itself refuses writes).
3. Open the service account → **Keys → Add key → Create new key → JSON**.
   A `.json` file downloads.
4. Copy that file onto the backend host somewhere safe, e.g.
   `/etc/nha-copilot/service-account.json` (Linux) or
   `C:\nha-copilot\service-account.json` (Windows). Keep it readable only by the
   service account that runs the backend.

> On a **GCP VM** you can skip the key file entirely: attach the service account
> to the VM and leave `GOOGLE_APPLICATION_CREDENTIALS` unset — the SDK uses the
> VM's identity automatically.

### 4.3 Configure the backend environment

```bash
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env
```

Open `backend/.env` and set at least these:

```ini
# --- BigQuery ---
GCP_PROJECT=<your-gcp-project-id>
BQ_DATASET=<your-bigquery-dataset>
GOOGLE_APPLICATION_CREDENTIALS=/etc/nha-copilot/service-account.json

# --- OpenAI ---
OPENAI_API_KEY=sk-<your-openai-key>
OPENAI_MODEL=gpt-4.1

# --- Auth ---
# Generate a long random secret (see command below).
JWT_SECRET=<paste-a-long-random-string>
JWT_EXPIRE_MINUTES=480
# Real login accounts. Format: user:password:role  (separate multiple with ';')
# roles: viewer | analyst | senior_analyst | admin
APP_USERS=admin:<StrongPassword1>:admin;analyst:<StrongPassword2>:analyst

# --- CORS: the frontend's origin (fill in after Step 8; no trailing slash) ---
CORS_ORIGINS=https://copilot.nha.internal
```

Generate a JWT secret:
```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

- The **table names** default to the standard ABDM names (see `app/config.py`).
  Only set the `BQ_*_TABLE` overrides in `.env` if your loaded tables are named
  differently.
- If you leave `APP_USERS` unset, insecure prototype accounts are used
  (`analyst`/`analyst123` etc.) — **always set `APP_USERS` for real use.**
- Reference data (`lgd_master.xlsx`) is bundled in `backend/reference/`, so no
  extra download is needed.

### 4.4 (Optional) "Chat with PDFs"

Skip unless you use this feature.
- Put PDFs in `backend/pdfs/` and set `PDF_SOURCE=local` (default).
- For **scanned/image** PDFs, install the **Tesseract OCR** binary on the host
  (`sudo apt-get install tesseract-ocr` on Debian/Ubuntu; on Windows install it
  and set `TESSERACT_CMD` to `tesseract.exe`'s path).

### 4.5 Smoke-test the connection

Confirm BigQuery credentials and read-only enforcement work before going further:

```bash
# Linux (venv active):
python scripts/smoke_bq.py
# Windows:
./.venv/Scripts/python.exe scripts/smoke_bq.py
```

You can also run the test suite: `pytest -q`.

### 4.6 Start it (foreground, to confirm it runs)

```bash
# Linux:
uvicorn app.main:app --host 0.0.0.0 --port 8000
# Windows:
./.venv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

In another terminal, check health:
```bash
curl http://127.0.0.1:8000/health      # -> {"status":"ok"}
```

Stop it with `Ctrl+C` once you see `ok` — the next step makes it run permanently.

---

## 5. Run the backend as a service

So it starts on boot and restarts on failure.

### Linux (systemd)

A unit file is provided at [`deploy/nha-copilot.service`](nha-copilot.service).
Adjust its `WorkingDirectory`, `User`, and `EnvironmentFile` to your paths, then:

```bash
sudo cp deploy/nha-copilot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nha-copilot
sudo systemctl status nha-copilot        # should be "active (running)"
```

For production, the service runs uvicorn **without** `--reload` and with
`--workers 2` (already set in the unit file).

### Windows (as a service)

Use **NSSM** (Non-Sucking Service Manager) or Task Scheduler. With NSSM:

```powershell
nssm install NHACopilot "C:\nha-copilot\backend\.venv\Scripts\python.exe" ^
  "-m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2"
nssm set NHACopilot AppDirectory "C:\nha-copilot\backend"
nssm start NHACopilot
```

---

## 6. Put the backend behind HTTPS

Browsers block a secure (HTTPS) page from calling an insecure (HTTP) API, so the
backend needs HTTPS in production. Two common ways:

- **Same host as the frontend (recommended):** let the frontend's web server
  (nginx — see Step 8, Layout A) both serve the page **and** reverse-proxy the
  API paths to `127.0.0.1:8000`. Then everything is one HTTPS origin and there's
  no separate backend URL to secure or to allow in CORS.
- **Separate backend host:** put nginx or Caddy in front of uvicorn with a TLS
  certificate for your backend hostname (e.g. `https://copilot-api.nha.internal`).
  Your internal CA or Let's Encrypt can issue the certificate. The included
  [`deploy/Caddyfile`](Caddyfile) does auto-HTTPS if you have a public hostname.

Either way, note the backend's final base URL — you'll need it in Step 7 (unless
you used the same-origin layout, in which case it's empty).

---

## 7. Build the FRONTEND

Decide two values first:

**(a) `VITE_API_BASE` — where the backend lives.**
- Same domain as the frontend (nginx Layout A): leave **empty**.
- Different host: the full HTTPS URL, e.g. `https://copilot-api.nha.internal`
  (no trailing slash).

**(b) `VITE_BASE` — the URL path the app is served from.**
- Domain root — `https://copilot.nha.internal/` → `/`
- Subpath — `https://portal.nha.internal/copilot/` → `/copilot/` (keep both slashes).

Then build (on the build machine, needs Node 20+):

```bash
cd frontend
cp .env.example .env       # Windows: Copy-Item .env.example .env
# edit .env — set VITE_API_BASE and VITE_BASE per above
npm ci
npm run build
```

The output is **`frontend/dist/`** — that folder (containing `index.html` and
`assets/`) is what you deploy. Nothing else from `frontend/` is needed at runtime.

> Changed `.env` later? Re-run `npm run build` and redeploy `dist/`. The values
> are baked in at build time.

---

## 8. Serve the frontend

Pick **one** option.

### Option A — nginx (Linux) — recommended

Serves the page **and** forwards API calls to the backend, so it's all one origin
(no CORS to worry about).

1. Copy the contents of `frontend/dist/` to the server, e.g. `/var/www/nha-copilot`.
2. Copy [`deploy/nginx.conf.example`](nginx.conf.example) to
   `/etc/nginx/conf.d/nha-copilot.conf`; edit `server_name` and `root`. Use
   **Layout A** (same host) or **Layout B** (separate backend) inside that file.
3. Apply: `sudo nginx -t && sudo systemctl reload nginx`
4. For Layout A, build the frontend (Step 7) with `VITE_API_BASE` **empty** and
   `VITE_BASE=/`.

### Option B — IIS (Windows)

1. Build (Step 7) with a **separate backend URL**:
   `VITE_API_BASE=https://copilot-api.nha.internal`, `VITE_BASE=/`.
2. Copy everything inside `frontend/dist/` into your IIS site's physical folder.
3. Copy [`deploy/web.config`](web.config) into that same folder.
4. In **IIS Manager**, point a site (or application) at that folder and browse.
5. Add the frontend origin to the backend's `CORS_ORIGINS` (Step 9).

### Option C — Docker (any OS with Docker)

Builds and serves in one container via [`deploy/Dockerfile.frontend`](Dockerfile.frontend).
From the repo root:

```bash
docker build -f deploy/Dockerfile.frontend \
  --build-arg VITE_API_BASE=https://copilot-api.nha.internal \
  --build-arg VITE_BASE=/ \
  -t nha-copilot-frontend .

docker run -d --name nha-copilot-frontend -p 8080:80 nha-copilot-frontend
```

App is then at `http://<host>:8080/`. Put your own TLS/reverse proxy in front for HTTPS.

---

## 9. Wire the two together (CORS)

If frontend and backend are on **different origins**, the backend must allow the
frontend's origin or the browser silently blocks every request (login "hangs").

In `backend/.env`, set (comma-separated, **no trailing slash**):

```ini
CORS_ORIGINS=https://copilot.nha.internal
```

Then restart the backend (`sudo systemctl restart nha-copilot`, or restart the
Windows service). If you used nginx **Layout A** (same origin), the default CORS
is fine — there's no cross-origin call.

---

## 10. Verify end to end

1. Open the frontend URL in a browser.
2. You should see the **login screen** (not a blank page).
3. Log in with an account from `APP_USERS`.
4. Ask a question (e.g. *"How many facilities are registered in Bihar?"*) and
   confirm a real answer comes back.

If any step fails, see below.

---

## 11. Troubleshooting

| Symptom | Most likely cause | Fix |
|---------|-------------------|-----|
| **Blank white page**; browser console shows 404s for `/assets/...` | `VITE_BASE` doesn't match the serving path | Set `VITE_BASE` to `/` (root) or `/subpath/`, rebuild, redeploy |
| **Login spins / "Network error"**; console shows a **CORS** error | Frontend origin not in backend `CORS_ORIGINS` | Add the exact origin (no trailing slash), restart backend |
| **Mixed content** error in console | HTTPS page calling an HTTP backend | Serve the backend over HTTPS (Step 6) |
| Login fails with 4xx | Wrong `VITE_API_BASE`, or backend unreachable | Check `VITE_API_BASE` (no trailing slash); `curl` the backend `/health` |
| Questions **time out** / no answer | Backend can't reach OpenAI or BigQuery | Allow outbound HTTPS to `api.openai.com` + `*.googleapis.com`, or set `HTTPS_PROXY` (Step 2) |
| Backend won't start; BigQuery auth error | Bad/missing service-account key | Check `GOOGLE_APPLICATION_CREDENTIALS` path + the two IAM roles (Step 4.2) |
| "No data" for a state | Only Bihar & Andhra Pradesh have activity data loaded | Expected — the model answers honestly for other states |
| Page shows old backend after a change | `.env` changed but not rebuilt | Re-run `npm run build`, redeploy `dist/` |

---

## 12. Updating later

- **Frontend:** `git pull` → `cd frontend && npm ci && npm run build` → redeploy
  `dist/` (or rebuild the Docker image).
- **Backend:** `git pull` → reinstall deps if `requirements.txt` changed
  (`pip install -r requirements.txt`) → restart the service.

---

## 13. Deployment checklist

- [ ] Backend deps installed; `smoke_bq.py` passes
- [ ] `backend/.env` has real `GCP_PROJECT`, `BQ_DATASET`, credentials, `OPENAI_API_KEY`
- [ ] Strong `JWT_SECRET` and real `APP_USERS` set (not the prototype defaults)
- [ ] Backend running as a service; `/health` returns `ok`
- [ ] Backend reachable over **HTTPS**
- [ ] Outbound access to OpenAI + BigQuery confirmed
- [ ] Frontend built with correct `VITE_API_BASE` + `VITE_BASE`
- [ ] `dist/` deployed to the web server
- [ ] `CORS_ORIGINS` matches the frontend origin (if split hosts)
- [ ] End-to-end login + query works in a browser

---

### File reference

| File | Purpose |
|------|---------|
| `frontend/.env.example` | Template for the two frontend build settings |
| `backend/.env.example` | Template for all backend settings |
| `deploy/nginx.conf.example` | Ready-to-edit nginx config (same-host or split) |
| `deploy/web.config` | Ready-to-drop IIS config |
| `deploy/Dockerfile.frontend` | Optional one-container build+serve for the frontend |
| `deploy/nha-copilot.service` | systemd unit for the backend |
| `deploy/Caddyfile` | Optional auto-HTTPS reverse proxy for the backend |
| `deploy/README.md` | Reference GCP-VM + GitHub Pages walkthrough |
