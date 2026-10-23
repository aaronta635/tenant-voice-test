from fastapi import APIRouter, BackgroundTasks, Depends, File, Query, UploadFile, status

from app.core.deps import CurrentProfile, get_optional_profile, require_role
from app.schemas.properties import (
    ListingLikeOut,
    OwnerPropertyOut,
    PropertyCreate,
    PropertyUpdate,
    PublicPropertyOut,
)
from app.schemas.uploads import UploadOut
from app.services import matching
from app.services import properties as properties_service

router = APIRouter(tags=["properties"])


def _match_alerts(background_tasks: BackgroundTasks):
    """Tell the tenants a listing this request publishes is a strong match for, once the answer is sent.

    matching.alert_matches_for_listing never raises and alerts a tenant about a
    listing at most once, however often the listing is published.
    """
    return lambda listing_id: background_tasks.add_task(matching.alert_matches_for_listing, listing_id)


@router.get("/me/properties", response_model=list[OwnerPropertyOut])
def list_my_properties(
    status: str | None = None, current: CurrentProfile = Depends(require_role("landlord"))
):
    return properties_service.list_my_properties(current.id, status)


@router.post("/me/properties", response_model=OwnerPropertyOut, status_code=status.HTTP_201_CREATED)
def create_my_property(
    payload: PropertyCreate, background_tasks: BackgroundTasks,
    current: CurrentProfile = Depends(require_role("landlord")),
):
    return properties_service.create_property(
        current.id, payload.model_dump(mode="json"), on_publish=_match_alerts(background_tasks)
    )


@router.get("/me/properties/{property_id}", response_model=OwnerPropertyOut)
def get_my_property(property_id: str, current: CurrentProfile = Depends(require_role("landlord"))):
    return properties_service.get_my_property(property_id, current.id)


@router.patch("/me/properties/{property_id}", response_model=OwnerPropertyOut)
def update_my_property(
    property_id: str,
    payload: PropertyUpdate,
    background_tasks: BackgroundTasks,
    current: CurrentProfile = Depends(require_role("landlord")),
):
    """Only the fields sent change; a null clears an optional one."""
    return properties_service.update_property(
        property_id, current.id, payload.model_dump(mode="json", exclude_unset=True),
        on_publish=_match_alerts(background_tasks),
    )


@router.delete("/me/properties/{property_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_property(property_id: str, current: CurrentProfile = Depends(require_role("landlord"))):
    """As the mobile app deletes: the property's owner only, and never a listing with a tenancy (409)."""
    properties_service.delete_property(property_id, current.id)


@router.post("/me/properties/{property_id}/photos", response_model=UploadOut)
def upload_my_property_photo(
    property_id: str,
    file: UploadFile = File(...),
    current: CurrentProfile = Depends(require_role("landlord")),
):
    """A photo for a listing that exists, stored in its property's folder; its url goes in photo_urls."""
    return properties_service.upload_photo(property_id, current.id, file)


@router.get("/properties", response_model=list[PublicPropertyOut])
def list_properties(
    location: str | None = None,
    property_type: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    bedrooms: int | None = None,
    sort: str = Query("newest", pattern="^(newest|price_asc|price_desc)$"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    viewer: CurrentProfile | None = Depends(get_optional_profile),
):
    """Signed out, each listing's address is its suburb, state and postcode only."""
    return properties_service.list_public_properties(
        location=location,
        property_type=property_type,
        min_price=min_price,
        max_price=max_price,
        bedrooms=bedrooms,
        sort=sort,
        limit=limit,
        offset=offset,
        viewer=viewer,
    )


# Declared before /properties/{property_id} so the literal path wins the match.
@router.get("/properties/amenities", response_model=list[str])
def list_amenities():
    return properties_service.list_amenities()


@router.get("/properties/{property_id}", response_model=PublicPropertyOut)
def get_property(property_id: str, viewer: CurrentProfile | None = Depends(get_optional_profile)):
    """The listing page. Signed out, it holds no street address; nobody's contact details are in it."""
    return properties_service.get_public_property(property_id, viewer)


@router.put("/properties/{property_id}/like", response_model=ListingLikeOut)
def like_property(property_id: str, current: CurrentProfile = Depends(require_role("tenant"))):
    return properties_service.like_listing(property_id, current.id)


@router.delete("/properties/{property_id}/like", response_model=ListingLikeOut)
def unlike_property(property_id: str, current: CurrentProfile = Depends(require_role("tenant"))):
    return properties_service.unlike_listing(property_id, current.id)
