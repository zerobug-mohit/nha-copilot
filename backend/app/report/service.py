"""Weekly report data service.

Runs a fixed set of read-only aggregate queries over the claims (TMS) table for a
date range and returns a structured report payload (KPIs + breakdowns + an
LLM-written executive summary). Deterministic SQL — no LLM in the query path.
"""
from __future__ import annotations

import decimal
import json
import logging
from datetime import date

from app.config import get_settings
from app.db.bigquery_client import get_bigquery_client
from app.semantic.synonyms import SPECIALTY_NAMES

logger = logging.getLogger(__name__)


def _num(x) -> float:
    if x is None:
        return 0.0
    if isinstance(x, decimal.Decimal):
        return float(x)
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def _clean(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        o = {}
        for k, v in r.items():
            o[k] = float(v) if isinstance(v, decimal.Decimal) else v
        out.append(o)
    return out


def _rows(bq, sql: str) -> list[dict]:
    res = bq.run_select(sql)
    if not res.ok:
        logger.warning("Report query failed: %s", res.error)
        return []
    return _clean(res.rows)


def build_weekly_report(start: date, end: date, llm=None) -> dict:
    """Build the weekly report for [start, end) using admission_dt (claims)."""
    s = get_settings()
    bq = get_bigquery_client()
    T = s.table_ref("tms")
    where = (
        f"admission_dt >= DATE('{start.isoformat()}') "
        f"AND admission_dt < DATE('{end.isoformat()}')"
    )
    paid = "IF(case_status = 'Claim Paid', amount_claim_paid, 0)"

    kpi_rows = _rows(
        bq,
        f"""
        SELECT
          COUNT(*) AS total_claims,
          COUNT(DISTINCT member_id) AS unique_patients,
          COUNTIF(case_status = 'Claim Paid') AS paid_claims,
          COUNTIF(case_status LIKE '%Rejected%') AS rejected_claims,
          COUNTIF(case_status NOT LIKE '%Rejected%' AND case_status <> 'Claim Paid') AS pending_claims,
          SUM({paid}) AS total_paid,
          COUNT(DISTINCT patient_state_code) AS states_covered,
          COUNT(DISTINCT hospital_code) AS hospitals_active
        FROM {T} WHERE {where}
        """,
    )
    k = kpi_rows[0] if kpi_rows else {}
    total_claims = int(_num(k.get("total_claims")))
    paid_claims = int(_num(k.get("paid_claims")))
    total_paid = _num(k.get("total_paid"))
    kpis = {
        "total_claims": total_claims,
        "unique_patients": int(_num(k.get("unique_patients"))),
        "paid_claims": paid_claims,
        "pending_claims": int(_num(k.get("pending_claims"))),
        "rejected_claims": int(_num(k.get("rejected_claims"))),
        "total_paid": round(total_paid, 2),
        "avg_paid_per_claim": round(total_paid / paid_claims, 2) if paid_claims else 0,
        "paid_rate": round(paid_claims / total_claims * 100, 1) if total_claims else 0,
        "states_covered": int(_num(k.get("states_covered"))),
        "hospitals_active": int(_num(k.get("hospitals_active"))),
    }

    by_state = _rows(
        bq,
        f"""SELECT patient_state_name AS state, COUNT(*) AS claims, SUM({paid}) AS paid
            FROM {T} WHERE {where} GROUP BY state ORDER BY claims DESC LIMIT 10""",
    )
    by_specialty = _rows(
        bq,
        f"""SELECT speciality_code AS specialty, COUNT(*) AS claims, SUM({paid}) AS paid
            FROM {T} WHERE {where} GROUP BY specialty ORDER BY claims DESC LIMIT 8""",
    )
    for r in by_specialty:
        r["specialty_name"] = SPECIALTY_NAMES.get(str(r.get("specialty")), str(r.get("specialty")))
    by_status = _rows(
        bq,
        f"""SELECT CASE WHEN case_status='Claim Paid' THEN 'Paid'
                        WHEN case_status LIKE '%Rejected%' THEN 'Rejected'
                        ELSE 'Pending' END AS payment_state,
                   COUNT(*) AS claims
            FROM {T} WHERE {where} GROUP BY payment_state""",
    )
    by_hospital_type = _rows(
        bq,
        f"""SELECT hospital_type, COUNT(*) AS claims, SUM({paid}) AS paid
            FROM {T} WHERE {where} GROUP BY hospital_type""",
    )

    report = {
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "kpis": kpis,
        "by_state": by_state,
        "by_specialty": by_specialty,
        "by_status": by_status,
        "by_hospital_type": by_hospital_type,
        "analysis": None,
    }
    if llm and total_claims > 0:
        report["analysis"] = _weekly_analysis(llm, report)
    return report


_REPORT_SYSTEM = (
    "You are a senior analyst writing the executive summary of a WEEKLY report for "
    "India's PM-JAY scheme. You are given the week's aggregate numbers. Return JSON: "
    '{"summary": string, "insights": string[], "trends": string[]}. '
    "summary = 2-3 sentences a health official can read at a glance. insights = 3-5 "
    "concise, number-backed bullets (top states/specialties, paid vs pending vs "
    "rejected, government vs private, concentration). trends only if evident. Base "
    "everything strictly on the numbers; do not invent. Write in English."
)


def _weekly_analysis(llm, report: dict) -> dict | None:
    try:
        payload = {
            "period": report["period"],
            "kpis": report["kpis"],
            "top_states": report["by_state"][:5],
            "top_specialties": report["by_specialty"][:5],
            "by_status": report["by_status"],
            "by_hospital_type": report["by_hospital_type"],
        }
        out = llm.generate_json(_REPORT_SYSTEM, json.dumps(payload, default=str))
    except Exception:  # noqa: BLE001
        logger.warning("Weekly analysis failed", exc_info=True)
        return None
    summary = str(out.get("summary") or "").strip()
    insights = [str(x).strip() for x in (out.get("insights") or []) if str(x).strip()][:6]
    trends = [str(x).strip() for x in (out.get("trends") or []) if str(x).strip()][:4]
    if not summary and not insights:
        return None
    return {"summary": summary, "insights": insights, "trends": trends}
