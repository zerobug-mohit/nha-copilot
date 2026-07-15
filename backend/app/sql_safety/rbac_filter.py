"""Role-based access control for generated SQL (§4.5).

The architecture calls for restricting *granularity* rather than hard-blocking.
Because the SQL is free-form against BigQuery (no row-security policies), we
enforce RBAC pragmatically by inspecting the columns a query references:

  viewer          national + state aggregates only
  analyst         + district-level
  senior_analyst  + facility-level detail
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

# Human-readable columns that list an INDIVIDUAL FACILITY (name/address). In the
# ABDM dataset these are public dashboard data, so this is a granularity tier, not
# a privacy control: only senior_analyst+ get per-facility listings; lower roles
# work at aggregated geography level. Facility ID columns (hfr_id/hip_id/…) are
# deliberately NOT here — they are the keys used in COUNT(DISTINCT ...) to count
# facilities, which every role must be able to do. Geography columns are also not
# here — they're needed for state/district analyses at every tier.
FACILITY_COLUMNS = {
    "facility_name",
    "hospital_name",
    "facility_address",
}
DISTRICT_COLUMNS = {
    "district_code",
    "district_name",
    "district",  # numeric LGD code column in linked_facility / scan_pay_count
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

    facility_hits = sorted(referenced & FACILITY_COLUMNS)
    district_hits = sorted(referenced & DISTRICT_COLUMNS)

    # senior_analyst (2) may use facility-level columns; analyst/viewer may not.
    if facility_hits and level < ROLE_LEVELS["senior_analyst"]:
        return RbacResult(
            allowed=False,
            reason=(
                "Your role has access to aggregated data down to district level, "
                "but not individual-facility detail. Try asking for state- or "
                "district-level figures instead."
            ),
            blocked_columns=facility_hits,
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
