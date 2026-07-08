from app.sql_safety.rbac_filter import check_rbac

TMS = "`p.d.claim_paid_excel_t`"


def _sql(cols, group=None):
    g = f" GROUP BY {group}" if group else ""
    return f"SELECT {cols} FROM {TMS}{g}"


def test_viewer_blocked_on_district():
    r = check_rbac(_sql("patient_district_name, COUNT(*) c", "patient_district_name"), "viewer")
    assert not r.allowed


def test_viewer_allowed_state_level():
    r = check_rbac(_sql("patient_state_name, COUNT(*) c", "patient_state_name"), "viewer")
    assert r.allowed


def test_analyst_allowed_district():
    r = check_rbac(_sql("patient_district_name, COUNT(*) c", "patient_district_name"), "analyst")
    assert r.allowed


def test_analyst_blocked_on_hospital():
    r = check_rbac(_sql("hospital_name, COUNT(*) c", "hospital_name"), "analyst")
    assert not r.allowed


def test_senior_allowed_hospital():
    r = check_rbac(_sql("hospital_name, COUNT(*) c", "hospital_name"), "senior_analyst")
    assert r.allowed


def test_admin_allowed_everything():
    r = check_rbac(_sql("hospital_code, patient_district_name"), "admin")
    assert r.allowed


# --- merged-table schema (tms_-prefixed claim columns) ---
MERGED = "`p.d.BIS_TMS_Sample_Merged`"


def test_analyst_blocked_on_merged_hospital():
    r = check_rbac(
        f"SELECT tms_hospital_name, COUNT(*) c FROM {MERGED} GROUP BY tms_hospital_name",
        "analyst",
    )
    assert not r.allowed


def test_viewer_blocked_on_merged_district():
    r = check_rbac(
        f"SELECT dist_name, COUNT(DISTINCT card_no) n FROM {MERGED} GROUP BY dist_name",
        "viewer",
    )
    assert not r.allowed


def test_viewer_allowed_merged_state():
    r = check_rbac(
        f"SELECT state_name, COUNT(DISTINCT card_no) n FROM {MERGED} GROUP BY state_name",
        "viewer",
    )
    assert r.allowed
