"""Weekly report endpoint."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException

from app.auth.jwt import CurrentUser, get_current_user
from app.nl_to_sql.client import get_llm_client
from app.report.service import build_weekly_report

router = APIRouter(prefix="/report", tags=["report"])


@router.get("/weekly")
def weekly(start: str, end: str, _: CurrentUser = Depends(get_current_user)):
    """Weekly report for [start, end) (ISO dates; end exclusive)."""
    try:
        s = date.fromisoformat(start)
        e = date.fromisoformat(end)
    except ValueError:
        raise HTTPException(status_code=400, detail="Dates must be YYYY-MM-DD")
    if e <= s or (e - s).days > 31:
        raise HTTPException(status_code=400, detail="Invalid date range")
    return build_weekly_report(s, e, get_llm_client())
