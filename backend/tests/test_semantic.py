from datetime import date

from app.semantic.geography import get_geography
from app.semantic.time_resolver import get_time_resolver


def test_aurangabad_is_ambiguous():
    r = get_geography().resolve("Aurangabad")
    assert r.status == "ambiguous"
    assert "which did you mean" in (r.message or "").lower()


def test_state_resolves_to_lgd_code():
    r = get_geography().resolve("Bihar")
    assert r.status == "resolved"
    assert r.resolved is not None
    assert r.resolved.state_code == 10  # Bihar LGD code


def test_alias_orissa_to_odisha():
    r = get_geography().resolve("Orissa")
    assert r.status == "resolved"
    assert "odisha" in r.resolved.name.lower()


def test_detect_finds_state_in_sentence():
    hits = get_geography().detect("How many facilities are registered in Gujarat?")
    names = {m.name for r in hits for m in r.matches}
    assert any("gujarat" in n.lower() for n in names)


def test_quarter_range_and_window_flag():
    tr = get_time_resolver().resolve("Q2 2023-24", today=date(2026, 7, 6))
    assert tr.start == date(2023, 7, 1)
    assert tr.end == date(2023, 10, 1)
    assert tr.outside_data_window  # 2023 is before the ABDM data window


def test_2026_year_in_window():
    tr = get_time_resolver().resolve("in 2026", today=date(2026, 7, 6))
    assert tr.start == date(2026, 1, 1)
    assert not tr.outside_data_window


def test_last_month_resolves():
    tr = get_time_resolver().resolve("last month", today=date(2026, 6, 15))
    assert tr.status == "resolved"
    assert tr.start == date(2026, 5, 1)
    assert tr.end == date(2026, 6, 1)
