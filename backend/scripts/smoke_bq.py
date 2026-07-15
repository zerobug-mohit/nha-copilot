"""BigQuery connectivity + read-only smoke test (ABDM).

Run after populating .env:
    ./.venv/Scripts/python.exe scripts/smoke_bq.py

Confirms the service account can read every ABDM table, prints expected
magnitudes, and verifies that a write statement is rejected (safety layer 3).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402
from app.db.bigquery_client import get_bigquery_client  # noqa: E402

settings = get_settings()
bq = get_bigquery_client()


def show(label: str, sql: str) -> None:
    res = bq.run_select(sql)
    if res.ok:
        print(f"[OK] {label}: {res.rows}  (bytes={res.bytes_processed})")
    else:
        print(f"[FAIL] {label}: {res.error}")


print(f"Project={settings.gcp_project} Dataset={settings.bq_dataset}")

print("\n-- row counts per table --")
for key in settings.table_map:
    show(key, f"SELECT COUNT(*) AS n FROM {settings.table_ref(key)}")

print("\n-- key activity metrics --")
show("Distinct facilities", f"SELECT COUNT(DISTINCT hfr_id) AS facilities FROM {settings.table_ref('facility_registry')}")
show("Facilities by ownership", f"SELECT facility_ownership, COUNT(DISTINCT hfr_id) n FROM {settings.table_ref('facility_registry')} GROUP BY facility_ownership")
show("Total Scan & Share txns", f"SELECT SUM(counts) AS txns FROM {settings.table_ref('scan_share')}")
show("Active facility-bridge links", f"SELECT COUNTIF(active='t') AS active_links FROM {settings.table_ref('linked_facility')}")
show("Bridge status mix", f"SELECT status, COUNT(*) n FROM {settings.table_ref('bridge_integrator')} GROUP BY status")

# ID-join sanity: hfr_id in scan_pay should match facility_registry (per §10).
show(
    "hfr_id join coverage (scan_pay -> facility_registry)",
    f"""SELECT COUNT(*) AS scan_pay_rows,
        COUNTIF(f.hfr_id IS NOT NULL) AS matched
        FROM {settings.table_ref('scan_pay')} sp
        LEFT JOIN {settings.table_ref('facility_registry')} f ON sp.hfr_id = f.hfr_id""",
)

# Read-only proof: a write must be refused by IAM even if it reaches BigQuery.
print("\nAttempting a DELETE (must be refused by IAM/read-only role)...")
res = bq.run_select(f"DELETE FROM {settings.table_ref('facility_registry')} WHERE 1=0")
print("  ->", "REFUSED as expected" if not res.ok else "!!! UNEXPECTEDLY ALLOWED")
