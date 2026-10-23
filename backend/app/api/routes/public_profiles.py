from typing import Literal

from fastapi import APIRouter, Query

from app.schemas.public_profiles import PublicProfileDetailOut, PublicProfilePageOut
from app.services import public_profiles as public_profiles_service

# Browsing before sign-in (R22). No route here reads the caller: signed in or
# not, everyone gets the same public fields.
router = APIRouter(tags=["public-profiles"])


@router.get("/public/profiles", response_model=PublicProfilePageOut)
def search_public_profiles(
    role: Literal["all", "tenant", "landlord", "provider"] = "all",
    q: str | None = None,
    location: str | None = None,
    # Capped at MAX_LIMIT rather than refused: the page says which limit it used.
    limit: int = Query(public_profiles_service.DEFAULT_LIMIT, ge=1),
    offset: int = Query(0, ge=0),
):
    return public_profiles_service.search(role=role, q=q, location=location, limit=limit, offset=offset)


@router.get("/public/profiles/{user_id}", response_model=PublicProfileDetailOut)
def read_public_profile(user_id: str):
    return public_profiles_service.get_public_profile(user_id)
