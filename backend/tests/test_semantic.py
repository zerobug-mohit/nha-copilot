from datetime import date

from app.semantic.geography import get_geography
from app.semantic.synonyms import get_synonyms
from app.semantic.time_resolver import get_time_resolver


def test_aurangabad_is_ambiguous():
    r = get_geography().resolve("Aurangabad")
    assert r.status == "ambiguous"
    assert "which did you mean" in (r.message or "").lower()


def test_maharashtra_spelling_in_data():
    r = get_geography().resolve("Maharashtra")
    assert r.status == "resolved"
    m = r.resolved
    assert m.is_brownfield
    assert m.name_in_data == "MAHARASTRA"


def test_karnataka_is_brownfield():
    r = get_geography().resolve("Karnataka")
    assert r.resolved.is_brownfield


def test_gujarat_not_brownfield():
    r = get_geography().resolve("Gujarat")
    assert r.resolved is not None
    assert not r.resolved.is_brownfield


def test_alias_orissa_to_odisha():
    r = get_geography().resolve("Orissa")
    assert r.status == "resolved"
    assert "odisha" in r.resolved.name.lower()


def test_detect_finds_state_in_sentence():
    hits = get_geography().detect("How many claims were paid in Gujarat last year?")
    names = {m.name for r in hits for m in r.matches}
    assert any("gujarat" in n.lower() for n in names)


def test_quarter_range_and_window_flag():
    tr = get_time_resolver().resolve("Q2 2023-24", today=date(2026, 7, 6))
    assert tr.start == date(2023, 7, 1)
    assert tr.end == date(2023, 10, 1)
    assert tr.outside_tms_window  # 2023 is outside FY2025-26


def test_fy_2025_26_in_window():
    tr = get_time_resolver().resolve("FY2025-26", today=date(2026, 7, 6))
    assert tr.start == date(2025, 4, 1)
    assert not tr.outside_tms_window


def test_synonym_cancer():
    matches = get_synonyms().match("show me cancer cases")
    codes = {c for m in matches for c in m.codes}
    assert {"MO", "MR", "SC"} <= codes


def test_synonym_whole_word_no_false_positive():
    # 'ear' in 'year', 'ent' in 'government' must NOT match ENT.
    assert get_synonyms().match("claims for full year 2025 in government hospitals") == []
    assert get_synonyms().match("treatment for each patient") == []


def test_synonym_ent_whole_word_matches():
    codes = {c for m in get_synonyms().match("show me ENT cases") for c in m.codes}
    assert "SL" in codes
