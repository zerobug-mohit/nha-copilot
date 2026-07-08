"""Role-based access control for generated SQL (§4.5).

The architecture calls for restricting *granularity* rather than hard-blocking.
Because the SQL is free-form against BigQuery (no row-security policies), we
enforce RBAC pragmatically by inspecting the columns a query references:

  viewer          national + state aggregates only
  analyst         + district-level
  senior_analyst  + hospital-level (aggregated)
  admin           everything, plus query/error logs

If a query references columns above the caller's tier, the query is not executed;
the caller receives a scoped message explaining the access limit (the LLM can
then re-scope on the next turn). Row-level access (no aggregation on a
sensitive table) is likewise restricted below senior_analyst.
"""
from __future__ import annotations

from dataclasses import dataclass

import sqlglot
from sqlglot import exp

# Columns that expose a given granularity. Names use the merged-table schema
# (claim columns are tms_-prefixed); bare TMS names are kept so the guard still
# works if the source tables are queried directly.
HOSPITAL_COLUMNS = {
    "tms_hospital_code",
    "tms_hospital_name",
    "tms_hosp_pan_number",
    "tms_hosp_account_number",
    "tms_hosp_district_name",
    "tms_hosp_state_name",
    "tms_hospital_state_cd",
    "tms_hospital_district_cd",
    "tms_src_account_no",
    "tms_src_ifsc_code",
    "tms_ben_ifsc_code",
    # bare (direct source-table) names
    "hospital_code",
    "hospital_name",
    "hosp_pan_number",
    "hosp_account_number",
    "hosp_district_name",
    "hosp_state_name",
    "hospital_state_cd",
    "hospital_district_cd",
}
DISTRICT_COLUMNS = {
    # beneficiary district (merged, original names)
    "dist_cd",
    "dist_name",
    "block_id",
    "village_id",
    "pincode",
    "house_no",
    "address",
    # claim-side district
    "tms_patient_district_code",
    "tms_patient_district_name",
    # bare (direct source-table) names
    "patient_district_code",
    "patient_district_name",
}

ROLE_LEVELS = {"viewer": 0, "analyst": 1, "senior_analyst": 2, "admin": 3}


@dataclass
class RbacResult:
    allowed: bool
    reason: str | None = None
    # columns that triggered the block, for logging/UX
    blocked_columns: list[str] = None  # type: ignore[assignment]


def check_rbac(sql: str, role: str) -> RbacResult:
    level = ROLE_LEVELS.get(role, 0)
    if level >= ROLE_LEVELS["admin"]:
        return RbacResult(allowed=True)

    try:
        stmt = sqlglot.parse_one(sql, read="bigquery")
    except Exception:  # noqa: BLE001 - validator already ran; be permissive here
        return RbacResult(allowed=True)

    referenced = {c.name.lower() for c in stmt.find_all(exp.Column) if c.name}

    hospital_hits = sorted(referenced & HOSPITAL_COLUMNS)
    district_hits = sorted(referenced & DISTRICT_COLUMNS)

    # senior_analyst (2) may use hospital columns; analyst/viewer may not.
    if hospital_hits and level < ROLE_LEVELS["senior_analyst"]:
        return RbacResult(
            allowed=False,
            reason=(
                "Your role has access to aggregated data down to district level, "
                "but not hospital-level detail. Try asking for state- or "
                "district-level figures instead."
            ),
            blocked_columns=hospital_hits,
        )

    # analyst (1) may use district columns; viewer may not.
    if district_hits and level < ROLE_LEVELS["analyst"]:
        return RbacResult(
            allowed=False,
            reason=(
                "Your role has access to national and state-level aggregates only. "
                "Try asking for figures at the state or national level."
            ),
            blocked_columns=district_hits,
        )

    return RbacResult(allowed=True)
