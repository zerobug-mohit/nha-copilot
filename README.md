# NHA SHA Analytical Co-pilot (Prototype)

A web-based **natural-language → SQL** chat co-pilot for NHA / SHA / HAAU
officials to query PM-JAY **claims (TMS)** and **beneficiary (BIS)** data in
plain English. Built to the v0.3 architecture (`../nha_query_tool_architecture.md`),
adapted for **Google BigQuery** as the data layer and **OpenAI** as the LLM.

```
Browser (React) ──HTTPS──▶ FastAPI backend ──read-only SQL──▶ BigQuery
                              │  auth / RBAC
                              │  NL-to-SQL (CLAUDE.md + OpenAI)
                              │  SQL safety (SELECT-only, PII, sqlglot)
                              │  semantic (LGD geography, time, HBP synonyms)
                              └  query log (SQLite)
```

## Safety model (three independent layers)
1. **System prompt** (`backend/CLAUDE.md`) — instructs the LLM to emit only `SELECT`.
2. **SQL validation** (`sql_safety/validator.py`) — parses with sqlglot, rejects
   any non-SELECT / multi-statement / PII-column query before execution.
3. **IAM read-only** — the BigQuery service account is granted only
   `bigquery.dataViewer` + `bigquery.jobUser`, so the database itself refuses writes.

RBAC (`viewer` / `analyst` / `senior_analyst` / `admin`) restricts query
*granularity* (state → district → hospital) via column inspection.

## Prerequisites
- Python 3.11+ and Node 18+ (verified on Python 3.13 / Node 24).
- A BigQuery dataset holding the two tables (`claim_paid_excel_t`,
  `t_bis_beneficiary_dtl`) and a service-account JSON key with read-only access.
- An OpenAI API key.

## Setup

### Backend
```bash
cd backend
cp .env.example .env          # then fill in GCP project/dataset, key path, OpenAI key, JWT secret
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt   # Windows
# smoke-test BigQuery connectivity + read-only enforcement:
./.venv/Scripts/python.exe scripts/smoke_bq.py
# run the API:
./run.ps1                     # or: uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173 (proxies /auth, /chat to :8000)
```

## Prototype users
`viewer` / `analyst` / `senior` / `admin`, password = `<username>123`
(e.g. `analyst` / `analyst123`). Change these in `backend/app/auth/users.py`.

## Endpoints
| Endpoint | Method | Notes |
|---|---|---|
| `/auth/login` | POST | issues JWT |
| `/chat/message` | POST | main chat turn (rate-limited 60/min) |
| `/chat/session/{id}` | GET | session history |
| `/query-log` | GET | admin only |
| `/health` | GET | liveness |

## Tests
```bash
cd backend && ./.venv/Scripts/python.exe -m pytest -q
```
Covers SQL safety, RBAC, geography/time/synonym resolution, and the NL-to-SQL
pipeline's deterministic short-circuits (ambiguous district, brownfield-state
claims) with a faked LLM/BigQuery.

## Data model — single merged table
The co-pilot queries **one denormalised table**, `BIS_TMS_Sample_Merged`, created
by `scripts/create_merged_table.sql` (run once in the BigQuery Console; the app's
service account is read-only and cannot create it). It is
**BIS `LEFT JOIN` TMS on `TMS.member_id = BIS.card_no`**:
- one row per beneficiary-claim; every registered beneficiary appears,
- claim columns are **`tms_`-prefixed** and **`NULL`** when the beneficiary has no
  claim (household members + all 7 brownfield states),
- a beneficiary with N claims appears in N rows.

To (re)create or rescope it, edit `scripts/create_merged_table.sql` and set
`BQ_MERGED_TABLE` in `.env`.

## Key domain rules encoded in `backend/CLAUDE.md`
- Registered beneficiaries → `COUNT(DISTINCT card_no)` (rows repeat per claim).
- Claims/cases → filter `tms_case_id IS NOT NULL`; patients-with-claims →
  `COUNT(DISTINCT card_no)` (repeat-visit dialysis/chemo/ECT rows).
- Amount paid → `tms_amount_claim_paid`.
- Brownfield states have registrations but **no claims** → claims questions return
  a scoped *no-data* answer (not zero); registration questions are valid.
- Preserved source quirks: `MAHARASTRA` spelling, `RAJASTHAN`/`Rajasthan` casing,
  relation-code gaps, `enrl_status` vs `enrol_status`.
- PII columns (incl. `tms_patient_name`, `aadhaar_no`, …) are never selectable.

## Out of scope (per architecture §12)
Push/digest (Pulse), anomaly detection (Sentinel), Hospital Empanelment (HEM),
file export, cross-session memory, live NHA API integration.
