from app.sql_safety.rbac_filter import check_rbac

FAC = "`p.d.health_facility_registry`"


def _sql(cols, group=None):
    g = f" GROUP BY {group}" if group else ""
    return f"SELECT {cols} FROM {FAC}{g}"


def test_viewer_blocked_on_district():
    r = check_rbac(_sql("district_name, COUNT(*) c", "district_name"), "viewer")
    assert not r.allowed


def test_viewer_allowed_state_level():
    r = check_rbac(_sql("state_code, COUNT(*) c", "state_code"), "viewer")
    assert r.allowed


def test_analyst_allowed_district():
    r = check_rbac(_sql("district_code, COUNT(*) c", "district_code"), "analyst")
    assert r.allowed


def test_analyst_blocked_on_facility_listing():
    r = check_rbac(_sql("facility_name, COUNT(*) c", "facility_name"), "analyst")
    assert not r.allowed


def test_analyst_allowed_facility_count_by_id():
    # COUNT(DISTINCT hfr_id) is the standard facility count — allowed at every tier.
    r = check_rbac(_sql("state_code, COUNT(DISTINCT hfr_id) AS n", "state_code"), "analyst")
    assert r.allowed


def test_senior_allowed_facility():
    r = check_rbac(_sql("facility_name, registered_count", None), "senior_analyst")
    assert r.allowed


def test_admin_allowed_everything():
    r = check_rbac(_sql("facility_name, hfr_id, district_name"), "admin")
    assert r.allowed


def test_viewer_blocked_on_numeric_district_column():
    # `district` (numeric LGD code column in linked_facility / scan_pay_count)
    r = check_rbac(
        "SELECT district, COUNT(*) c FROM `p.d.scan_pay_count` GROUP BY district",
        "viewer",
    )
    assert not r.allowed
