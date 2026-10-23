from fastapi import APIRouter, Depends

from app.core.deps import CurrentProfile, require_role
from app.schemas.matching import EssentialsUpdate, LandlordMatchesOut, PropertyMatchesOut
from app.services import matching as service

# The caller's own matches only: no route takes another tenant's id.
router = APIRouter(prefix="/me/matches", tags=["matching"])


@router.get("/properties", response_model=PropertyMatchesOut)
def property_matches(current: CurrentProfile = Depends(require_role("tenant"))):
    return service.get_property_matches(current)


@router.post("/properties/refine", response_model=PropertyMatchesOut)
def refine_property_matches(current: CurrentProfile = Depends(require_role("tenant"))):
    """Ask the model to re-order the matches; the rule order comes back whenever it cannot."""
    return service.refine_property_matches(current)


@router.get("/landlords", response_model=LandlordMatchesOut)
def landlord_matches(current: CurrentProfile = Depends(require_role("tenant"))):
    return service.get_landlord_matches(current)


@router.put("/essentials", response_model=PropertyMatchesOut)
def save_essentials(payload: EssentialsUpdate, current: CurrentProfile = Depends(require_role("tenant"))):
    """Mark which preferences are musts; answers the matches they leave."""
    return service.save_essentials(current, payload.essentials)
