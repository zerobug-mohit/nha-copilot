"""Explorer: proactively surface interesting trends/patterns.

A (stronger) model proposes diverse, non-obvious analytical questions; each is run
through the normal NL-to-SQL pipeline to produce a chart + insight card. Results
are cached per role so the tab loads instantly after the first generation.
"""
from __future__ import annotations

import datetime as _dt
import decimal
import logging

from app.nl_to_sql.client import get_explorer_llm
from app.nl_to_sql.pipeline import run_turn

logger = logging.getLogger(__name__)

_CACHE: dict[str, dict] = {}
_TTL_SECONDS = 6 * 3600

_PROPOSE_SYSTEM = (
    "You are a data-exploration assistant for India's PM-JAY (Ayushman Bharat) "
    "claims & beneficiary analytics. Propose diverse, insightful, NON-OBVIOUS "
    "analytical questions a health official would find worth investigating — each "
    "answerable by a single aggregate query over claims/beneficiary data. Cover "
    "different angles across the set: specialties, geography (states/districts), "
    "government vs private hospitals, payment status & rejections, turnaround "
    "times, patient demographics (gender/age band), out-of-district care, and "
    "high-cost concentration. Prefer questions that reveal concentration, "
    "imbalance, outliers, bottlenecks or gaps. Avoid anything needing data outside "
    "claims/beneficiaries (no budgets, no data before FY2025-26). Keep each "
    "question concrete and self-contained. Return JSON: "
    '{"insights":[{"title":"short catchy title","question":"natural-language '
    'question to ask the analytics tool","why":"one line on why it matters"}]}'
)


def _jsonable(obj):
    if isinstance(obj, list):
        return [_jsonable(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (_dt.date, _dt.datetime)):
        return obj.isoformat()
    if isinstance(obj, decimal.Decimal):
        return float(obj)
    return obj


def _propose(n: int) -> list[dict]:
    llm = get_explorer_llm()
    try:
        out = llm.generate_json(_PROPOSE_SYSTEM, f"Propose {n} questions.")
    except Exception:  # noqa: BLE001
        logger.warning("Explorer proposal failed", exc_info=True)
        return []
    items = out.get("insights") or out.get("questions") or []
    result = []
    for it in items:
        if isinstance(it, dict) and str(it.get("question") or "").strip():
            result.append(
                {
                    "title": str(it.get("title") or "").strip() or "Insight",
                    "question": str(it["question"]).strip(),
                    "why": str(it.get("why") or "").strip(),
                }
            )
    return result


def generate_insights(role: str, want: int = 6, force: bool = False) -> dict:
    now = _dt.datetime.now(_dt.timezone.utc)
    cached = _CACHE.get(role)
    if cached and not force:
        age = (now - _dt.datetime.fromisoformat(cached["generated_at"])).total_seconds()
        if age < _TTL_SECONDS:
            return cached

    proposals = _propose(want + 4)
    cards: list[dict] = []
    for pr in proposals:
        if len(cards) >= want:
            break
        try:
            res = run_turn(pr["question"], role=role)
        except Exception:  # noqa: BLE001
            logger.warning("Explorer run failed for %r", pr["question"], exc_info=True)
            continue
        if res.action != "answer" or not res.rows:
            continue
        analysis = res.analysis or {}
        cards.append(
            {
                "title": pr["title"],
                "question": pr["question"],
                "why": pr["why"],
                "summary": analysis.get("summary") or res.answer or "",
                "insights": analysis.get("insights") or [],
                "chart": res.chart,
                "columns": res.columns,
                "rows": _jsonable(res.rows),
                "sql": res.sql,
            }
        )

    payload = {"generated_at": now.isoformat(), "insights": cards}
    if cards:
        _CACHE[role] = payload
    return payload
