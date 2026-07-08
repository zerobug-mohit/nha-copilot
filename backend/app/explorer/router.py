"""Explorer endpoint — proactive insight cards."""
from fastapi import APIRouter, Depends

from app.auth.jwt import CurrentUser, get_current_user
from app.explorer.service import generate_insights

router = APIRouter(prefix="/explorer", tags=["explorer"])


@router.get("")
def explorer(force: bool = False, _: CurrentUser = Depends(get_current_user)):
    return generate_insights(_.role, force=force)
