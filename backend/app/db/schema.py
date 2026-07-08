"""Live schema introspection.

Fetches the ACTUAL column names + types of the three tables from BigQuery
INFORMATION_SCHEMA at startup and formats them for injection into the system
prompt. This keeps the LLM's type knowledge correct regardless of how the tables
were typed (CSV autodetect on the samples types some flags as BOOL and some
dates as DATE; production tables may differ again). Ground truth beats a
hand-maintained schema.
"""
from __future__ import annotations

import logging

from app.config import get_settings

logger = logging.getLogger(__name__)

_cache: dict[str, list[tuple[str, str]]] | None = None


def load_schemas(force: bool = False) -> dict[str, list[tuple[str, str]]]:
    """Fetch (column, type) lists for TMS and BIS. Cached. Safe to call anytime;
    returns {} if BigQuery is unreachable (e.g. offline unit tests)."""
    global _cache
    if _cache is not None and not force:
        return _cache

    from app.db.bigquery_client import get_bigquery_client

    s = get_settings()
    bq = get_bigquery_client()
    out: dict[str, list[tuple[str, str]]] = {}
    for key, table in (("TMS", s.bq_tms_table), ("BIS", s.bq_bis_table)):
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
        "- Compare BOOL columns with TRUE/FALSE — never with 'Y'/'N'.",
        "- Filter DATE columns with DATE('YYYY-MM-DD'); TIMESTAMP columns with TIMESTAMP('YYYY-MM-DD').",
        "- INT64/FLOAT64 are numeric; STRING needs quotes.",
        f"- The merged table `{s.table_ref('merged')}` has every BIS column below "
        "(same name/type) plus every TMS column below prefixed `tms_` (same type).",
        "",
    ]
    for key in ("TMS", "BIS"):
        if key in _cache:
            cols = ", ".join(f"{c} {t}" for c, t in _cache[key])
            lines.append(f"### {key} — `{s.table_ref(key.lower())}`")
            lines.append(cols)
            lines.append("")
    return "\n".join(lines)
