from app.sql_safety.validator import validate_sql

FAC = "`p.d.health_facility_registry`"


def test_accepts_plain_select():
    assert validate_sql(f"SELECT COUNT(DISTINCT hfr_id) AS n FROM {FAC}").ok


def test_accepts_with_cte():
    sql = (
        f"WITH x AS (SELECT hfr_id, facility_ownership FROM {FAC}) "
        "SELECT facility_ownership, COUNT(DISTINCT hfr_id) AS n FROM x GROUP BY facility_ownership"
    )
    assert validate_sql(sql).ok


def test_rejects_delete():
    assert not validate_sql(f"DELETE FROM {FAC}").ok


def test_rejects_drop():
    assert not validate_sql(f"DROP TABLE {FAC}").ok


def test_rejects_update():
    assert not validate_sql(f"UPDATE {FAC} SET registered_count = 0").ok


def test_rejects_multi_statement():
    assert not validate_sql("SELECT 1; DROP TABLE t").ok


def test_rejects_abha_address_pii():
    r = validate_sql("SELECT abha_address FROM `p.d.scan_pay_count`")
    assert not r.ok
    assert "abha_address" in r.pii_hit


def test_rejects_abha_address_alias():
    r = validate_sql("SELECT abha_address AS a FROM `p.d.scan_pay_count`")
    assert not r.ok
    assert "abha_address" in r.pii_hit


def test_allows_facility_identity():
    # Facility name/id/address are PUBLIC in the ABDM dataset — must be allowed.
    assert validate_sql(
        f"SELECT facility_name, hfr_id, facility_address FROM {FAC} LIMIT 10"
    ).ok


def test_allows_payment_amount_aggregate():
    assert validate_sql(
        "SELECT payment_status, SUM(payment_amount) AS amt "
        "FROM `p.d.scan_pay_count` GROUP BY payment_status"
    ).ok
