from fastapi import APIRouter, Depends

from app.core.deps import CurrentProfile, get_current_profile
from app.schemas.account_standing import AccountStandingOut
from app.services import gates

router = APIRouter(prefix="/me/standing", tags=["gates"])


@router.get("", response_model=AccountStandingOut)
def read_my_standing(current: CurrentProfile = Depends(get_current_profile)):
    """The caller's own account as the gates read it now: approved, or pending, rejected, suspended..."""
    return {"state": gates.standing(current.id).state}
