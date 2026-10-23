from typing import Literal

from fastapi import APIRouter, Depends, status

from app.core.deps import CurrentProfile, get_current_profile
from app.schemas.bookings import BookingCreate, BookingOut, BookingStatusUpdate
from app.services import bookings as bookings_service
from app.services import service_providers as service_providers_service

router = APIRouter(prefix="/bookings", tags=["bookings"])


def _my_provider_id(current: CurrentProfile) -> str | None:
    provider = service_providers_service.get_provider_by_profile_id(current.id)
    return provider["id"] if provider else None


@router.post("", response_model=BookingOut, status_code=status.HTTP_201_CREATED)
def create_booking(payload: BookingCreate, current: CurrentProfile = Depends(get_current_profile)):
    return bookings_service.create_booking(current.id, payload.model_dump(mode="json"))


@router.get("", response_model=list[BookingOut])
def list_bookings(status: str | None = None, scope: Literal["client"] | None = None, current: CurrentProfile = Depends(get_current_profile)):
    provider_id = None if scope == "client" else _my_provider_id(current)
    return bookings_service.list_bookings(current.id, provider_id, status)


@router.get("/{booking_id}", response_model=BookingOut)
def get_booking(booking_id: str, current: CurrentProfile = Depends(get_current_profile)):
    provider_id = _my_provider_id(current)
    booking = bookings_service.get_booking(booking_id)
    bookings_service.assert_participant(booking, current.id, provider_id)
    return bookings_service.decorate([booking], viewer_id=current.id)[0]


@router.patch("/{booking_id}", response_model=BookingOut)
def update_booking(
    booking_id: str, payload: BookingStatusUpdate, current: CurrentProfile = Depends(get_current_profile)
):
    provider_id = _my_provider_id(current)
    return bookings_service.update_booking(booking_id, current.id, provider_id, payload.model_dump(mode="json"))
