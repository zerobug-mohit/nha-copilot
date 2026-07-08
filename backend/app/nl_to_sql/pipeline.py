"""The per-turn NL-to-SQL orchestration pipeline (§4.3).

1. Geography / period / specialty resolution (semantic layer)
2. Deterministic short-circuits (ambiguous district, brownfield claims) -> clarify/out-of-scope
3. Context injection + LLM SQL generation
4. SQL safety validation (SELECT-only, PII)
5. RBAC granularity check
6. Read-only execution against BigQuery
7. Response formatting

No automatic retry on execution error: catch, log, return a safe failure message.
"""
from __future__ import annotations

import logging
from dataclasses import asdict, dataclass, field
from datetime import date
from typing import Any

from app.db.bigquery_client import get_bigquery_client
from app.nl_to_sql.client import get_llm_client
from app.nl_to_sql.prompt_builder import build_user_prompt, load_system_prompt
from app.semantic.geography import get_geography
from app.semantic.synonyms import get_synonyms
from app.semantic.time_resolver import get_time_resolver
from app.sql_safety.rbac_filter import check_rbac
from app.sql_safety.validator import validate_sql

logger = logging.getLogger(__name__)

FAILURE_MESSAGE = (
    "I was unable to answer that question. This has been logged for review. "
    "You could try rephrasing, or ask for a broader aggregate which I can "
    "answer reliably."
)

_CLAIM_INTENT = (
    "claim", "claims", "paid", "payment", "treatment", "treated", "admission",
    "admitted", "procedure", "surgery", "discharge", "preauth", "hospitalis",
    "hospitaliz", "tat", "case", "cases",
)
_BENEFICIARY_INTENT = (
    "beneficiar", "registered", "registration", "enrol", "enroll", "card",
    "aadhaar", "abha", "household", "family", "member",
)


@dataclass
class TurnResult:
    action: str  # "answer" | "clarify" | "out_of_scope" | "error"
    answer: str | None = None
    message: str | None = None
    sql: str | None = None
    columns: list[str] = field(default_factory=list)
    rows: list[dict[str, Any]] = field(default_factory=list)
    context_chips: dict[str, Any] = field(default_factory=dict)
    chart: dict[str, Any] | None = None
    resolved: dict[str, Any] = field(default_factory=dict)
    # internal, for logging
    execution_status: str = "n/a"
    error_message: str | None = None


def _has_intent(text: str, terms: tuple[str, ...]) -> bool:
    t = text.lower()
    return any(term in t for term in terms)


def resolve_entities(question: str, today: date | None = None) -> dict[str, Any]:
    geo = get_geography()
    time_r = get_time_resolver()
    syn = get_synonyms()

    geo_hits = geo.detect(question)
    time_res = time_r.resolve(question, today=today)
    spec_hits = syn.match(question)

    resolved: dict[str, Any] = {
        "geography": [
            {
                "level": m.level,
                "lgd_code": m.lgd_code,
                "name": m.name,
                "state_code": m.state_code,
                "state_name": m.state_name,
                "is_brownfield": m.is_brownfield,
                "name_in_data": m.name_in_data,
                "status": r.status,
                "clarify": r.message,
            }
            for r in geo_hits
            for m in (r.matches or [None])
            if m is not None
        ],
        "ambiguous_geography": [
            r.message for r in geo_hits if r.status == "ambiguous"
        ],
        "period": None,
        "specialties": [
            {"phrase": s.phrase, "codes": s.codes, "names": s.names} for s in spec_hits
        ],
    }
    if time_res.status == "resolved":
        resolved["period"] = {
            "start": time_res.start.isoformat(),
            "end": time_res.end.isoformat(),
            "label": time_res.label,
            "outside_tms_window": time_res.outside_tms_window,
            "note": time_res.note,
        }
    return resolved


def run_turn(
    question: str,
    role: str,
    session_context: dict | None = None,
    today: date | None = None,
) -> TurnResult:
    resolved = resolve_entities(question, today=today)

    # ---- Step 2: deterministic short-circuits (semantic layer decisions) ----
    if resolved["ambiguous_geography"]:
        return TurnResult(
            action="clarify",
            message=resolved["ambiguous_geography"][0],
            resolved=resolved,
        )

    claim_intent = _has_intent(question, _CLAIM_INTENT)
    beneficiary_intent = _has_intent(question, _BENEFICIARY_INTENT)
    brownfield = [g for g in resolved["geography"] if g.get("is_brownfield")]
    if brownfield and claim_intent and not beneficiary_intent:
        names = ", ".join(sorted({g["state_name"] or g["name"] for g in brownfield}))
        return TurnResult(
            action="out_of_scope",
            message=(
                f"Claims data is not available for {names} in this system. These "
                "states run their own SHA trust-model claims systems outside this "
                "prototype's scope, so a claims figure here would be misleading "
                "(it is not zero — it is simply not present). I can answer "
                "registered-beneficiary questions for these states, or claims for "
                "the states that do report here."
            ),
            resolved=resolved,
        )

    # ---- Step 3: LLM SQL generation ----
    system_prompt = load_system_prompt()
    user_prompt = build_user_prompt(question, role, session_context, resolved)
    llm = get_llm_client()
    try:
        gen = llm.generate_json(system_prompt, user_prompt)
    except Exception as exc:  # noqa: BLE001
        logger.exception("LLM generation failed")
        return TurnResult(
            action="error", message=FAILURE_MESSAGE, error_message=str(exc),
            resolved=resolved,
        )

    action = gen.get("action", "sql")
    chips = _build_chips(resolved, session_context)

    if action == "clarify":
        return TurnResult(action="clarify", message=gen.get("message"),
                          resolved=resolved, context_chips=chips)
    if action == "out_of_scope":
        return TurnResult(action="out_of_scope", message=gen.get("message"),
                          resolved=resolved, context_chips=chips)

    sql = (gen.get("sql") or "").strip()
    answer_template = gen.get("answer_template") or ""
    if not sql:
        return TurnResult(action="out_of_scope",
                          message=gen.get("message") or "I couldn't form a query for that.",
                          resolved=resolved, context_chips=chips)

    # ---- Step 4: SQL safety ----
    v = validate_sql(sql)
    if not v.ok:
        logger.warning("SQL rejected by validator: %s", v.reason)
        return TurnResult(
            action="error", message=FAILURE_MESSAGE, sql=sql,
            execution_status="rejected", error_message=v.reason,
            resolved=resolved, context_chips=chips,
        )

    # ---- Step 5: RBAC ----
    rbac = check_rbac(sql, role)
    if not rbac.allowed:
        return TurnResult(
            action="out_of_scope", message=rbac.reason, sql=None,
            execution_status="rbac_blocked",
            error_message=f"blocked columns: {rbac.blocked_columns}",
            resolved=resolved, context_chips=chips,
        )

    # ---- Step 6: execution ----
    bq = get_bigquery_client()
    result = bq.run_select(sql)
    if not result.ok:
        logger.warning("Execution error: %s", result.error)
        return TurnResult(
            action="error", message=FAILURE_MESSAGE, sql=sql,
            execution_status="error", error_message=result.error,
            resolved=resolved, context_chips=chips,
        )

    # ---- Step 7: formatting ----
    answer = _format_answer(answer_template, result.columns, result.rows)
    chart = _sanitize_chart(gen.get("chart"), result.columns, result.rows)
    return TurnResult(
        action="answer",
        answer=answer,
        sql=sql,
        columns=result.columns,
        rows=result.rows,
        chart=chart,
        execution_status="success",
        resolved=resolved,
        context_chips=chips,
    )


def _build_chips(resolved: dict, session_context: dict | None) -> dict:
    chips: dict[str, Any] = {}
    geos = resolved.get("geography") or []
    if geos:
        chips["geography"] = geos[0]["name"]
    elif session_context and session_context.get("state_name"):
        chips["geography"] = session_context["state_name"]
    period = resolved.get("period")
    if period:
        chips["period"] = period["label"]
    elif session_context and session_context.get("period_label"):
        chips["period"] = session_context["period_label"]
    if resolved.get("specialties"):
        chips["specialty"] = ", ".join(
            n for s in resolved["specialties"] for n in s["names"]
        )
    return chips


def _sanitize_chart(
    chart: Any, columns: list[str], rows: list[dict]
) -> dict[str, Any] | None:
    """Validate the LLM's chart suggestion against the real result set.

    Returns a clean spec {type, x, series[], title, drilldown?} or None if the
    result isn't chartable (scalar, <2 rows, unknown columns, no numeric series).
    """
    if not isinstance(chart, dict) or len(rows) < 2:
        return None
    ctype = str(chart.get("type", "")).lower()
    if ctype not in ("bar", "line", "area", "pie"):
        return None
    colset = set(columns)
    x = chart.get("x")
    if x not in colset:
        return None
    series = [s for s in (chart.get("series") or []) if s in colset and s != x]
    if not series:
        # fall back to any numeric column that isn't x
        series = [
            c
            for c in columns
            if c != x and any(isinstance(r.get(c), (int, float)) for r in rows)
        ]
    if not series:
        return None
    spec = {
        "type": ctype,
        "x": x,
        "series": series[:6],  # soft cap per the categorical series ladder
        "title": str(chart.get("title") or "").strip(),
    }
    drill = chart.get("drilldown")
    if isinstance(drill, str) and drill.strip().lower() not in ("", "none", "null", "na", "n/a"):
        spec["drilldown"] = drill.strip()
    return spec


def _format_answer(template: str, columns: list[str], rows: list[dict]) -> str:
    """Produce a concise plain-language answer.

    For a single scalar result we substitute the value inline; otherwise we
    summarise row/column counts and let the table carry the detail.
    """
    # Keep the answer in the LLM's language (English/Hindi/Hinglish); the table or
    # chart carries the row/column detail, so we don't append English summaries.
    template = (template or "").strip()
    if not rows:
        return template or "No matching records were found."
    if len(rows) == 1 and len(columns) == 1:
        val = rows[0][columns[0]]
        base = template or f"{columns[0]}: {val}"
        return base if str(val) in base else f"{base} ({columns[0]} = {val})"
    return template or f"{len(rows)} rows returned."
