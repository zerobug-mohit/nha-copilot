"""BigQuery connectivity + read-only smoke test.

Run after populating .env:
    ./.venv/Scripts/python.exe scripts/smoke_bq.py

Confirms the service account can read both tables, prints expected magnitudes,
and verifies that a write statement is rejected (safety layer 3).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402
from app.db.bigquery_client import get_bigquery_client  # noqa: E402

settings = get_settings()
bq = get_bigquery_client()
tms = settings.table_ref("tms")
bis = settings.table_ref("bis")
merged = settings.table_ref("merged")


def show(label: str, sql: str) -> None:
    res = bq.run_select(sql)
    if res.ok:
        print(f"[OK] {label}: {res.rows}  (bytes={res.bytes_processed})")
    else:
        print(f"[FAIL] {label}: {res.error}")


print(f"Project={settings.gcp_project} Dataset={settings.bq_dataset}")
print("\n-- source tables --")
show("TMS total rows", f"SELECT COUNT(*) AS n FROM {tms}")
show("TMS unique patients", f"SELECT COUNT(DISTINCT member_id) AS patients FROM {tms}")
show("BIS total rows", f"SELECT COUNT(*) AS n FROM {bis}")
show(
    "Brownfield check (should be ~0 TMS rows for Maharashtra)",
    f"SELECT COUNT(*) AS n FROM {tms} WHERE UPPER(patient_state_name)='MAHARASTRA'",
)

print("\n-- merged table (what the app queries) --")
show("Merged total rows", f"SELECT COUNT(*) AS n FROM {merged}")
show(
    "Merged distinct beneficiaries",
    f"SELECT COUNT(DISTINCT card_no) AS beneficiaries FROM {merged}",
)
show(
    "Merged rows WITH a claim",
    f"SELECT COUNT(*) AS n FROM {merged} WHERE tms_case_id IS NOT NULL",
)
show(
    "Merged Maharashtra beneficiaries have NO claims (paid should be NULL/0)",
    f"SELECT COUNT(*) AS beneficiaries, "
    f"COUNTIF(tms_case_id IS NOT NULL) AS with_claim "
    f"FROM {merged} WHERE UPPER(state_name)='MAHARASTRA'",
)

# Read-only proof: a write must be refused by IAM even if it reaches BigQuery.
print("\nAttempting a DELETE (must be refused by IAM/read-only role)...")
res = bq.run_select(f"DELETE FROM {tms} WHERE 1=0")
print("  ->", "REFUSED as expected" if not res.ok else "!!! UNEXPECTEDLY ALLOWED")
