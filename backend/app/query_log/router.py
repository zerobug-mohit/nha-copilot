"""Admin-only query log endpoint (§5)."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth.jwt import CurrentUser, require_admin
from app.query_log.logger import fetch_logs

router = APIRouter(tags=["admin"])


@router.get("/query-log")
def query_log(limit: int = 200, _: CurrentUser = Depends(require_admin)):
    return {"logs": fetch_logs(limit=limit)}
