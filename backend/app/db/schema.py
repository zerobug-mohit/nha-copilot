"""Live schema introspection.

Fetches the ACTUAL column names + types of the ABDM tables from BigQuery
INFORMATION_SCHEMA at startup and formats them for injection into the system
prompt. This keeps the LLM's type knowledge correct regardless of how the tables
were typed on load. Ground truth beats a hand-maintained schema.
"""
from __future__ import annotations

import logging

from app.config import get_settings

logger = logging.getLogger(__name__)

_cache: dict[str, list[tuple[str, str]]] | None = None


# table_map key -> the ### heading used in the prompt block.
_TABLE_LABELS = {
    "facility_registry": "Facility registry",
    "professionals_registry": "Professionals registry (HPR)",
    "top_indicators": "ABHA top indicators",
    "linked_trend": "Health-record linking trend",
    "linked_facility": "Facility-bridge links",
    "scan_share": "Scan & Share",
    "scan_pay": "Scan & Pay",
    "state_district_master": "State/district master",
    "bridge_integrator": "Bridge / integrator detail",
}


def load_schemas(force: bool = False) -> dict[str, list[tuple[str, str]]]:
    """Fetch (column, type) lists for every ABDM table. Cached. Safe to call
    anytime; returns {} if BigQuery is unreachable (e.g. offline unit tests)."""
    global _cache
    if _cache is not None and not force:
        return _cache

    from app.db.bigquery_client import get_bigquery_client

    s = get_settings()
    bq = get_bigquery_client()
    out: dict[str, list[tuple[str, str]]] = {}
    for key, table in s.table_map.items():
        sql = (
            f"SELECT column_name, data_type "
            f"FROM `{s.gcp_project}.{s.bq_dataset}`.INFORMATION_SCHEMA.COLUMNS "
            f"WHERE table_name = '{table}' ORDER BY ordinal_position"
        )
        res = bq.run_select(sql)
        if res.ok and res.rows:
            out[key] = [(r["column_name"], r["data_type"]) for r in res.rows]
        else:
            logger.warning("Schema fetch failed for %s: %s", table, res.error)
    _cache = out
    return out


def get_schema_text() -> str:
    """Authoritative-types block for the system prompt. Empty string if not
    loaded (so offline tests build a prompt without hitting BigQuery)."""
    if not _cache:
        return ""
    s = get_settings()
    lines = [
        "",
        "---",
        "## AUTHORITATIVE COLUMN TYPES (override any type stated above)",
        "These are the real BigQuery types. Honour them exactly:",
        "- Compare STRING flags (e.g. active = 't') with quoted strings.",
        "- Filter DATE columns with DATE('YYYY-MM-DD'); wrap DATETIME columns "
        "with DATE(col) for day-level comparisons.",
        "- INT64/NUMERIC/FLOAT64 are numeric; STRING needs quotes.",
        "",
    ]
    for key, table in s.table_map.items():
        if key in _cache:
            label = _TABLE_LABELS.get(key, key)
            cols = ", ".join(f"{c} {t}" for c, t in _cache[key])
            lines.append(f"### {label} — `{s.table_ref(key)}`")
            lines.append(cols)
            lines.append("")
    return "\n".join(lines)
