"""Weekly report data service.

Runs a fixed set of read-only aggregate queries over the claims (TMS) and
beneficiary (BIS) tables for a date range and returns a structured report payload
covering: claims volume & utilization (with week-over-week change), financial
exposure (approved vs paid), turnaround times (median & P90), rejection/pending
by workflow stage, government/private mix, out-of-district portability, and BIS
registration progress. Deterministic SQL — the LLM only writes the summary.
"""
from __future__ import annotations

import decimal
import json
import logging
from datetime import date, timedelta

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
        out.append({k: (float(v) if isinstance(v, decimal.Decimal) else v) for k, v in r.items()})
    return out


def _rows(bq, sql: str) -> list[dict]:
    res = bq.run_select(sql)
    if not res.ok:
        logger.warning("Report query failed: %s", res.error)
        return []
    return _clean(res.rows)


PAID = "IF(case_status = 'Claim Paid', amount_claim_paid, 0)"


def _basics(bq, T: str, where: str) -> dict:
    r = _rows(
        bq,
        f"""SELECT COUNT(*) AS claims, COUNT(DISTINCT member_id) AS patients,
                   SUM({PAID}) AS paid
            FROM {T} WHERE {where}""",
    )
    k = r[0] if r else {}
    return {
        "claims": int(_num(k.get("claims"))),
        "patients": int(_num(k.get("patients"))),
        "paid": _num(k.get("paid")),
    }


def _delta(cur: float, prev: float) -> dict:
    change = cur - prev
    pct = (change / prev * 100) if prev else None
    return {"prev": round(prev, 2), "change": round(change, 2), "pct": round(pct, 1) if pct is not None else None}


def build_weekly_report(start: date, end: date, llm=None) -> dict:
    s = get_settings()
    bq = get_bigquery_client()
    T = s.table_ref("tms")
    B = s.table_ref("bis")
    where = f"admission_dt >= DATE('{start.isoformat()}') AND admission_dt < DATE('{end.isoformat()}')"
    prev_start = start - (end - start)
    prev_where = f"admission_dt >= DATE('{prev_start.isoformat()}') AND admission_dt < DATE('{start.isoformat()}')"

    # ---- KPIs + week-over-week ----
    kpi = (_rows(bq, f"""
        SELECT COUNT(*) AS total_claims, COUNT(DISTINCT member_id) AS unique_patients,
               COUNTIF(case_status = 'Claim Paid') AS paid_claims,
               COUNTIF(case_status LIKE '%Rejected%') AS rejected_claims,
               COUNTIF(case_status NOT LIKE '%Rejected%' AND case_status <> 'Claim Paid') AS pending_claims,
               SUM({PAID}) AS total_paid,
               COUNT(DISTINCT patient_state_code) AS states_covered,
               COUNT(DISTINCT hospital_code) AS hospitals_active
        FROM {T} WHERE {where}""") or [{}])[0]
    total_claims = int(_num(kpi.get("total_claims")))
    paid_claims = int(_num(kpi.get("paid_claims")))
    total_paid = _num(kpi.get("total_paid"))
    prev = _basics(bq, T, prev_where)
    kpis = {
        "total_claims": total_claims,
        "unique_patients": int(_num(kpi.get("unique_patients"))),
        "paid_claims": paid_claims,
        "pending_claims": int(_num(kpi.get("pending_claims"))),
        "rejected_claims": int(_num(kpi.get("rejected_claims"))),
        "total_paid": round(total_paid, 2),
        "avg_paid_per_claim": round(total_paid / paid_claims, 2) if paid_claims else 0,
        "paid_rate": round(paid_claims / total_claims * 100, 1) if total_claims else 0,
        "states_covered": int(_num(kpi.get("states_covered"))),
        "hospitals_active": int(_num(kpi.get("hospitals_active"))),
        "wow": {
            "claims": _delta(total_claims, prev["claims"]),
            "patients": _delta(int(_num(kpi.get("unique_patients"))), prev["patients"]),
            "paid": _delta(total_paid, prev["paid"]),
        },
    }

    # ---- 1. Volume & utilization: gender, age band, specialty ----
    by_gender = _rows(bq, f"""SELECT gender, COUNT(*) AS claims, COUNT(DISTINCT member_id) AS patients
        FROM {T} WHERE {where} GROUP BY gender ORDER BY claims DESC""")
    by_age = _rows(bq, f"""SELECT CASE
             WHEN age < 18 THEN '0-17' WHEN age <= 30 THEN '18-30'
             WHEN age <= 45 THEN '31-45' WHEN age <= 60 THEN '46-60'
             ELSE '60+' END AS age_band, COUNT(*) AS claims
        FROM {T} WHERE {where} GROUP BY age_band
        ORDER BY CASE age_band WHEN '0-17' THEN 1 WHEN '18-30' THEN 2 WHEN '31-45' THEN 3 WHEN '46-60' THEN 4 ELSE 5 END""")
    by_specialty = _rows(bq, f"""SELECT speciality_code AS specialty, COUNT(*) AS claims, SUM({PAID}) AS paid
        FROM {T} WHERE {where} GROUP BY specialty ORDER BY claims DESC LIMIT 8""")
    for r in by_specialty:
        r["specialty_name"] = SPECIALTY_NAMES.get(str(r.get("specialty")), str(r.get("specialty")))
    by_state = _rows(bq, f"""SELECT patient_state_name AS state, COUNT(*) AS claims, SUM({PAID}) AS paid
        FROM {T} WHERE {where} GROUP BY state ORDER BY claims DESC LIMIT 10""")

    # ---- 2. Financial exposure: approved vs paid ----
    fin = (_rows(bq, f"""SELECT
             SUM({PAID}) AS total_paid,
             SUM(amount_claim_approved) AS total_approved,
             SUM(IF(case_status <> 'Claim Paid' AND case_status NOT LIKE '%Rejected%', amount_claim_approved, 0)) AS approved_unpaid_amount,
             COUNTIF(case_status <> 'Claim Paid' AND case_status NOT LIKE '%Rejected%' AND amount_claim_approved > 0) AS approved_unpaid_count
        FROM {T} WHERE {where}""") or [{}])[0]
    financial = {
        "total_paid": round(_num(fin.get("total_paid")), 2),
        "total_approved": round(_num(fin.get("total_approved")), 2),
        "approved_unpaid_amount": round(_num(fin.get("approved_unpaid_amount")), 2),
        "approved_unpaid_count": int(_num(fin.get("approved_unpaid_count"))),
        "avg_paid_per_claim": kpis["avg_paid_per_claim"],
    }

    # ---- 3. TAT (hours): median (P50) & P90 per stage ----
    tat_row = (_rows(bq, f"""SELECT
          APPROX_QUANTILES(preauth_tat, 100)[OFFSET(50)] AS preauth_p50,
          APPROX_QUANTILES(preauth_tat, 100)[OFFSET(90)] AS preauth_p90,
          APPROX_QUANTILES(claim_tat, 100)[OFFSET(50)] AS claim_p50,
          APPROX_QUANTILES(claim_tat, 100)[OFFSET(90)] AS claim_p90,
          APPROX_QUANTILES(payment_tat, 100)[OFFSET(50)] AS payment_p50,
          APPROX_QUANTILES(payment_tat, 100)[OFFSET(90)] AS payment_p90
        FROM {T} WHERE {where}""") or [{}])[0]
    tat = [
        {"stage": "Preauth", "median": _num(tat_row.get("preauth_p50")), "p90": _num(tat_row.get("preauth_p90"))},
        {"stage": "Claim", "median": _num(tat_row.get("claim_p50")), "p90": _num(tat_row.get("claim_p90"))},
        {"stage": "Payment", "median": _num(tat_row.get("payment_p50")), "p90": _num(tat_row.get("payment_p90"))},
    ]

    # ---- 4. Rejection / pending by workflow stage ----
    by_status = _rows(bq, f"""SELECT CASE
             WHEN case_status = 'Claim Paid' THEN 'Paid'
             WHEN case_status = 'Preauth Rejected' THEN 'Preauth Rejected'
             WHEN case_status LIKE '%Rejected%' THEN 'Claim Rejected'
             ELSE 'Pending' END AS status, COUNT(*) AS claims
        FROM {T} WHERE {where} GROUP BY status""")
    pending_by_stage = _rows(bq, f"""SELECT current_workflow_role AS stage, COUNT(*) AS claims
        FROM {T} WHERE {where} AND case_status NOT LIKE '%Rejected%' AND case_status <> 'Claim Paid'
              AND current_workflow_role IS NOT NULL AND current_workflow_role <> ''
        GROUP BY stage ORDER BY claims DESC LIMIT 8""")

    # ---- 5. Hospital type mix ----
    by_hospital_type = _rows(bq, f"""SELECT hospital_type, COUNT(*) AS claims, SUM({PAID}) AS paid
        FROM {T} WHERE {where} GROUP BY hospital_type""")

    # ---- 6. Portability: in-district / out-of-district (same state) / out-of-state ----
    portability = _rows(bq, f"""SELECT CASE
             WHEN patient_district_code = hospital_district_cd THEN 'In-district'
             WHEN patient_state_code = hospital_state_cd THEN 'Out-of-district (same state)'
             ELSE 'Out-of-state' END AS portability, COUNT(*) AS claims
        FROM {T} WHERE {where} GROUP BY portability""")

    # ---- 7. BIS registration progress ----
    bis_new = (_rows(bq, f"""SELECT COUNT(*) AS new_enrollments
        FROM {B} WHERE enrol_date >= DATE('{start.isoformat()}') AND enrol_date < DATE('{end.isoformat()}')""") or [{}])[0]
    bis_total = (_rows(bq, f"SELECT COUNT(DISTINCT card_no) AS total FROM {B}") or [{}])[0]
    card_status = _rows(bq, f"""SELECT card_status, COUNT(*) AS count FROM {B}
        WHERE card_status IS NOT NULL GROUP BY card_status ORDER BY count DESC LIMIT 6""")
    bis = {
        "new_enrollments": int(_num(bis_new.get("new_enrollments"))),
        "total_registered": int(_num(bis_total.get("total"))),
        "card_status": card_status,
    }

    report = {
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "kpis": kpis,
        "by_gender": by_gender,
        "by_age": by_age,
        "by_specialty": by_specialty,
        "by_state": by_state,
        "financial": financial,
        "tat": tat,
        "by_status": by_status,
        "pending_by_stage": pending_by_stage,
        "by_hospital_type": by_hospital_type,
        "portability": portability,
        "bis": bis,
        "analysis": None,
    }
    if llm and total_claims > 0:
        report["analysis"] = _weekly_analysis(llm, report)
    return report


_REPORT_SYSTEM = (
    "You are a senior analyst writing the executive summary of a WEEKLY report for "
    "India's PM-JAY scheme, for HAAU/NHA officials. You are given the week's "
    "aggregate numbers (with week-over-week change, financials, turnaround times, "
    "rejection/pending by stage, government/private mix, out-of-district care, and "
    "registration progress). Return JSON: "
    '{"summary": string, "insights": string[], "trends": string[]}. '
    "summary = 2-3 sentences a busy official reads first. insights = 4-6 concise, "
    "number-backed bullets that FLAG what needs attention (spikes/drops vs last "
    "week, rising TAT or its worst stage, growing pending queue at a workflow "
    "stage, rejection rate, approved-but-unpaid backlog, private-vs-government "
    "drift, high out-of-state care). trends = week-over-week movements. Base "
    "everything strictly on the numbers; never invent. Write in English."
)


def _weekly_analysis(llm, report: dict) -> dict | None:
    try:
        payload = {k: report[k] for k in (
            "period", "kpis", "financial", "tat", "by_status", "pending_by_stage",
            "by_hospital_type", "portability", "bis",
        )}
        payload["top_states"] = report["by_state"][:5]
        payload["top_specialties"] = report["by_specialty"][:5]
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
