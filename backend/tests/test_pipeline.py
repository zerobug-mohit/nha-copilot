from datetime import date

import app.nl_to_sql.pipeline as pipeline
from app.db.bigquery_client import QueryResult
from app.nl_to_sql.client import LLMClient, set_llm_client


class FakeLLM(LLMClient):
    def __init__(self, response):
        self.response = response
        self.last_system = None
        self.last_user = None

    def generate_json(self, system_prompt, user_prompt):
        self.last_system = system_prompt
        self.last_user = user_prompt
        return self.response


def test_ambiguous_district_short_circuits_before_llm():
    # Should not need the LLM at all.
    set_llm_client(FakeLLM({"action": "sql", "sql": "SELECT 1"}))
    r = pipeline.run_turn("Show me facilities in Aurangabad", role="analyst")
    assert r.action == "clarify"
    assert "aurangabad" in (r.message or "").lower()


def test_ambiguous_district_offers_options():
    set_llm_client(FakeLLM({"action": "sql", "sql": "SELECT 1"}))
    r = pipeline.run_turn("facilities in Aurangabad", role="analyst")
    assert r.action == "clarify"
    assert len(r.options) >= 2  # the alternative districts


def test_full_success_path(monkeypatch):
    set_llm_client(
        FakeLLM(
            {
                "action": "sql",
                "sql": "SELECT COUNT(DISTINCT hfr_id) AS facilities "
                "FROM `p.d.health_facility_registry` WHERE state_code=10",
                "answer_template": "Facilities registered in Bihar.",
            }
        )
    )
    fake_bq = type(
        "BQ", (), {"run_select": lambda self, sql: QueryResult(columns=["facilities"], rows=[{"facilities": 1000}], row_count=1)}
    )()
    monkeypatch.setattr(pipeline, "get_bigquery_client", lambda: fake_bq)
    r = pipeline.run_turn(
        "How many facilities are registered in Bihar?",
        role="analyst",
        today=date(2026, 7, 6),
    )
    assert r.action == "answer"
    assert r.sql and "COUNT(DISTINCT hfr_id)" in r.sql
    assert r.context_chips.get("geography", "").lower().startswith("bihar")


def test_llm_clarify_passes_options_through():
    set_llm_client(
        FakeLLM(
            {
                "action": "clarify",
                "message": "By which measure?",
                "options": ["Registration count", "Scan & Share volume"],
            }
        )
    )
    r = pipeline.run_turn("show me the top facilities", role="analyst")
    assert r.action == "clarify"
    assert r.options == ["Registration count", "Scan & Share volume"]


def test_analyze_results_parses():
    fake = FakeLLM({"summary": "Bihar leads.", "insights": ["A", "B"], "trends": []})
    out = pipeline.analyze_results("q", ["state", "n"], [{"state": "BR", "n": 5}, {"state": "AP", "n": 3}], fake)
    assert out["summary"] == "Bihar leads."
    assert out["insights"] == ["A", "B"]
    assert out["trends"] == []


def test_analyze_results_none_on_empty():
    fake = FakeLLM({"foo": "bar"})  # no summary/insights
    assert pipeline.analyze_results("q", ["c"], [{"c": 1}], fake) is None


def test_pii_sql_is_rejected(monkeypatch):
    set_llm_client(
        FakeLLM(
            {
                "action": "sql",
                "sql": "SELECT abha_address FROM `p.d.scan_pay_count` LIMIT 5",
                "answer_template": "addresses",
            }
        )
    )
    r = pipeline.run_turn("List patient ABHA addresses", role="admin")
    assert r.action == "error"
    assert r.execution_status == "rejected"
