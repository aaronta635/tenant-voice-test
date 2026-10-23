"""Inspection times, bookings and records (tracker R13; services/inspections.py).

property_id in a path is the listing's id. Anyone sees a listed home's open
times; tenants book them and see their bookings; owners publish and cancel
times, decide bookings and keep inspection records. The mobile functions
check ownership and state again on every call.
"""

from fastapi import APIRouter, Depends, status

from app.core.deps import CurrentProfile, require_role
from app.schemas.inspections import (
    InspectionAttendeeOut,
    InspectionBookingCreate,
    InspectionBookingOut,
    InspectionDecision,
    InspectionHomeOut,
    InspectionRecordIn,
    InspectionRecordOut,
    InspectionRecordStatusIn,
    InspectionSlotOut,
    InspectionSlotsCreate,
    OwnerInspectionsOut,
)
from app.services import inspections as inspections_service

router = APIRouter(tags=["inspections"])

tenant = require_role("tenant")
owner = require_role("landlord")


# --------------------------------------------------------------------------- Anyone
@router.get("/properties/{property_id}/inspections", response_model=list[InspectionSlotOut])
def list_open_times(property_id: str):
    return inspections_service.public_open_slots(property_id)


# --------------------------------------------------------------------------- Tenants
@router.get("/properties/{property_id}/inspection-slots", response_model=list[InspectionSlotOut])
def bookable_times(property_id: str, current: CurrentProfile = Depends(tenant)):
    return inspections_service.open_slots(current.access_token, property_id)


@router.post("/inspection-slots/{slot_id}/bookings", response_model=InspectionBookingOut,
             status_code=status.HTTP_201_CREATED)
def book_time(slot_id: str, payload: InspectionBookingCreate, current: CurrentProfile = Depends(tenant)):
    return inspections_service.book(current.access_token, slot_id, payload.note)


@router.get("/me/inspection-bookings", response_model=list[InspectionBookingOut])
def my_bookings(current: CurrentProfile = Depends(tenant)):
    return inspections_service.my_bookings(current.access_token)


@router.get("/me/inspection-homes", response_model=list[InspectionHomeOut])
def homes_with_times(current: CurrentProfile = Depends(tenant)):
    return inspections_service.tenant_homes(current.access_token)


# --------------------------------------------------------------------------- Owners: times
@router.get("/me/inspections", response_model=OwnerInspectionsOut)
def owner_inspections(property_id: str | None = None, current: CurrentProfile = Depends(owner)):
    return inspections_service.owner_overview(current.access_token, property_id)


@router.post("/me/properties/{property_id}/inspection-slots", response_model=list[InspectionSlotOut],
             status_code=status.HTTP_201_CREATED)
def publish_times(property_id: str, payload: InspectionSlotsCreate, current: CurrentProfile = Depends(owner)):
    return inspections_service.create_slots(current.access_token, property_id, payload.starts_at,
                                            payload.duration_minutes)


@router.post("/inspection-slots/{slot_id}/cancel", response_model=InspectionSlotOut)
def cancel_time(slot_id: str, current: CurrentProfile = Depends(owner)):
    return inspections_service.cancel_slot(current.access_token, current.id, slot_id)


@router.post("/inspection-bookings/{booking_id}/decision", response_model=InspectionBookingOut)
def decide_booking(booking_id: str, payload: InspectionDecision, current: CurrentProfile = Depends(owner)):
    return inspections_service.decide(current.access_token, current.id, booking_id, payload.decision)


# --------------------------------------------------------------------------- Records
@router.get("/me/inspection-records", response_model=list[InspectionRecordOut])
def inspection_records(property_id: str | None = None,
                       current: CurrentProfile = Depends(require_role("landlord", "tenant"))):
    """An owner's records, or for a tenant the ones they are invited to."""
    if current.role == "tenant":
        records = inspections_service.attendee_records(current.id)
        return [record for record in records if property_id is None or record["property_id"] == property_id]
    return inspections_service.owner_records(current.access_token, property_id)


@router.get("/me/properties/{property_id}/inspection-attendees", response_model=list[InspectionAttendeeOut])
def record_attendees(property_id: str, current: CurrentProfile = Depends(owner)):
    return inspections_service.attendees(current.access_token, property_id)


@router.post("/me/properties/{property_id}/inspection-records", response_model=InspectionRecordOut,
             status_code=status.HTTP_201_CREATED)
def create_record(property_id: str, payload: InspectionRecordIn, current: CurrentProfile = Depends(owner)):
    return inspections_service.create_record(current.access_token, property_id, payload.model_dump())


@router.put("/inspection-records/{inspection_id}", response_model=InspectionRecordOut)
def update_record(inspection_id: str, payload: InspectionRecordIn, current: CurrentProfile = Depends(owner)):
    return inspections_service.update_record(current.access_token, inspection_id, payload.model_dump())


@router.post("/inspection-records/{inspection_id}/status", response_model=InspectionRecordOut)
def set_record_status(inspection_id: str, payload: InspectionRecordStatusIn,
                      current: CurrentProfile = Depends(owner)):
    return inspections_service.set_record_status(current.access_token, inspection_id, payload.status, payload.note)
