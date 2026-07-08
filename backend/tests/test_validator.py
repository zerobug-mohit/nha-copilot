from app.sql_safety.validator import validate_sql


def test_accepts_plain_select():
    r = validate_sql("SELECT COUNT(*) AS n FROM `p.d.claim_paid_excel_t`")
    assert r.ok


def test_accepts_with_cte():
    sql = (
        "WITH x AS (SELECT member_id FROM `p.d.claim_paid_excel_t`) "
        "SELECT COUNT(DISTINCT member_id) AS patients FROM x"
    )
    assert validate_sql(sql).ok


def test_rejects_delete():
    assert not validate_sql("DELETE FROM `p.d.claim_paid_excel_t`").ok


def test_rejects_drop():
    assert not validate_sql("DROP TABLE `p.d.claim_paid_excel_t`").ok


def test_rejects_update():
    assert not validate_sql(
        "UPDATE `p.d.claim_paid_excel_t` SET age = 0"
    ).ok


def test_rejects_multi_statement():
    r = validate_sql("SELECT 1; DROP TABLE t")
    assert not r.ok


def test_rejects_pii_column():
    r = validate_sql("SELECT patient_name FROM `p.d.claim_paid_excel_t`")
    assert not r.ok
    assert "patient_name" in r.pii_hit


def test_rejects_pii_alias():
    r = validate_sql(
        "SELECT aadhaar_no AS a FROM `p.d.t_bis_beneficiary_dtl`"
    )
    assert not r.ok
    assert "aadhaar_no" in r.pii_hit


def test_allows_year_of_birth_not_pii():
    assert validate_sql(
        "SELECT year_of_birth, COUNT(*) c FROM `p.d.t_bis_beneficiary_dtl` "
        "GROUP BY year_of_birth"
    ).ok


def test_rejects_merged_tms_pii():
    r = validate_sql("SELECT tms_patient_name FROM `p.d.BIS_TMS_Sample_Merged`")
    assert not r.ok
    assert "tms_patient_name" in r.pii_hit


def test_allows_merged_claim_aggregate():
    assert validate_sql(
        "SELECT COUNT(DISTINCT card_no) AS patients FROM `p.d.BIS_TMS_Sample_Merged` "
        "WHERE tms_case_id IS NOT NULL"
    ).ok
