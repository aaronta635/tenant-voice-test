from fastapi import APIRouter, Depends, Query, status

from app.core.deps import CurrentProfile, require_role
from app.schemas.properties import PropertyCreate, PropertyOut, PropertyUpdate
from app.services import properties as properties_service

router = APIRouter(tags=["properties"])


@router.get("/me/properties", response_model=list[PropertyOut])
def list_my_properties(
    status: str | None = None, current: CurrentProfile = Depends(require_role("landlord"))
):
    return properties_service.list_my_properties(current.id, status)


@router.post("/me/properties", response_model=PropertyOut, status_code=status.HTTP_201_CREATED)
def create_my_property(payload: PropertyCreate, current: CurrentProfile = Depends(require_role("landlord"))):
    return properties_service.create_property(current.id, payload.model_dump(mode="json"))


@router.get("/me/properties/{property_id}", response_model=PropertyOut)
def get_my_property(property_id: str, current: CurrentProfile = Depends(require_role("landlord"))):
    return properties_service.get_my_property(property_id, current.id)


@router.patch("/me/properties/{property_id}", response_model=PropertyOut)
def update_my_property(
    property_id: str,
    payload: PropertyUpdate,
    current: CurrentProfile = Depends(require_role("landlord")),
):
    return properties_service.update_property(property_id, current.id, payload.model_dump(mode="json"))


@router.delete("/me/properties/{property_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_property(property_id: str, current: CurrentProfile = Depends(require_role("landlord"))):
    properties_service.delete_property(property_id, current.id)


@router.get("/properties", response_model=list[PropertyOut])
def list_properties(
    location: str | None = None,
    property_type: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    bedrooms: int | None = None,
    sort: str = Query("newest", pattern="^(newest|price_asc|price_desc)$"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    return properties_service.list_public_properties(
        location=location,
        property_type=property_type,
        min_price=min_price,
        max_price=max_price,
        bedrooms=bedrooms,
        sort=sort,
        limit=limit,
        offset=offset,
    )


# Declared before /properties/{property_id} so the literal path wins the match.
@router.get("/properties/amenities", response_model=list[str])
def list_amenities():
    return properties_service.list_amenities()


@router.get("/properties/{property_id}", response_model=PropertyOut)
def get_property(property_id: str):
    return properties_service.get_public_property(property_id)
