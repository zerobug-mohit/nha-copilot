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
    r = pipeline.run_turn("Show me claims in Aurangabad", role="analyst")
    assert r.action == "clarify"
    assert "aurangabad" in (r.message or "").lower()


def test_brownfield_claims_out_of_scope():
    set_llm_client(FakeLLM({"action": "sql", "sql": "SELECT 1"}))
    r = pipeline.run_turn("How many claims were paid in Maharashtra?", role="viewer")
    assert r.action == "out_of_scope"
    assert "not available" in (r.message or "").lower()


def test_brownfield_beneficiary_is_allowed(monkeypatch):
    # Registration question for a brownfield state must NOT be blocked.
    set_llm_client(
        FakeLLM(
            {
                "action": "sql",
                "sql": "SELECT COUNT(*) AS n FROM `p.d.t_bis_beneficiary_dtl` "
                "WHERE UPPER(state_name)='MAHARASTRA'",
                "answer_template": "Registered beneficiaries in Maharashtra.",
            }
        )
    )
    fake_bq = type(
        "BQ", (), {"run_select": lambda self, sql: QueryResult(columns=["n"], rows=[{"n": 42}], row_count=1)}
    )()
    monkeypatch.setattr(pipeline, "get_bigquery_client", lambda: fake_bq)
    r = pipeline.run_turn("How many registered beneficiaries in Maharashtra?", role="analyst")
    assert r.action == "answer"
    assert r.rows == [{"n": 42}]


def test_full_success_path(monkeypatch):
    set_llm_client(
        FakeLLM(
            {
                "action": "sql",
                "sql": "SELECT COUNT(DISTINCT member_id) AS patients "
                "FROM `p.d.claim_paid_excel_t` WHERE patient_state_code=24",
                "answer_template": "Unique patients in Gujarat.",
            }
        )
    )
    fake_bq = type(
        "BQ", (), {"run_select": lambda self, sql: QueryResult(columns=["patients"], rows=[{"patients": 1000}], row_count=1)}
    )()
    monkeypatch.setattr(pipeline, "get_bigquery_client", lambda: fake_bq)
    r = pipeline.run_turn(
        "How many patients were treated in Gujarat in FY2025-26?",
        role="analyst",
        today=date(2026, 7, 6),
    )
    assert r.action == "answer"
    assert r.sql and "COUNT(DISTINCT member_id)" in r.sql
    assert r.context_chips.get("geography", "").lower().startswith("gujarat")


def test_llm_clarify_passes_options_through():
    set_llm_client(
        FakeLLM(
            {
                "action": "clarify",
                "message": "Do you want cases or amount paid?",
                "options": ["Number of cases", "Total amount paid"],
            }
        )
    )
    r = pipeline.run_turn("show me the top hospitals", role="analyst")
    assert r.action == "clarify"
    assert r.options == ["Number of cases", "Total amount paid"]


def test_ambiguous_district_offers_options():
    set_llm_client(FakeLLM({"action": "sql", "sql": "SELECT 1"}))
    r = pipeline.run_turn("claims in Aurangabad", role="analyst")
    assert r.action == "clarify"
    assert len(r.options) >= 2  # the alternative districts


def test_pii_sql_is_rejected(monkeypatch):
    set_llm_client(
        FakeLLM(
            {
                "action": "sql",
                "sql": "SELECT patient_name FROM `p.d.claim_paid_excel_t` LIMIT 5",
                "answer_template": "names",
            }
        )
    )
    r = pipeline.run_turn("List patient names in Gujarat", role="admin")
    assert r.action == "error"
    assert r.execution_status == "rejected"
