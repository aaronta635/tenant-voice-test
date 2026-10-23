from datetime import date, datetime, time

from fastapi import HTTPException
from pydantic import ValidationError
from app.schemas.provider_availability import AvailabilityCreate
from app.core.supabase import web_table
from app.services import _common

# A web-only table: web.provider_availability, keyed by the provider's users.id.
TABLE = "provider_availability"
ORDER = ("day_of_week", "start_time")


def list_my_availability(provider_id: str) -> list[dict]:
    return _common.list_owned(TABLE, provider_id, order_by=ORDER, web=True)


def create_availability(provider_id: str, payload: dict) -> dict:
    validated = AvailabilityCreate.model_validate(payload).model_dump()
    return _common.create_owned(TABLE, provider_id, validated, web=True)


def update_availability(availability_id: str, provider_id: str, payload: dict) -> dict:
    existing = _common.get_owned(TABLE, availability_id, provider_id, web=True)
    merged = {**existing, **{k: v for k, v in payload.items() if v is not None}}
    try:
        AvailabilityCreate.model_validate(merged)
    except ValidationError as exc:
        raise HTTPException(422, "Choose valid start/end times; end must be after start") from exc
    return _common.update_owned(TABLE, availability_id, provider_id, payload, web=True)


def delete_availability(availability_id: str, provider_id: str) -> None:
    _common.delete_owned(TABLE, availability_id, provider_id, web=True)


def list_public_availability(provider_id: str) -> list[dict]:
    query = web_table(TABLE).select("*").eq("provider_id", provider_id)
    for column in ORDER:
        query = query.order(column)
    return query.execute().data or []


def _open_windows(provider_id: str, day: date) -> list[dict]:
    """The provider's open weekly windows on day's weekday; day_of_week counts from Sunday (0)."""
    day_of_week = (day.weekday() + 1) % 7
    return [
        window
        for window in list_public_availability(provider_id)
        if window["day_of_week"] == day_of_week and window.get("is_available")
    ]


def is_open_on(provider_id: str, day: date) -> bool:
    """Whether the provider works on day's weekday at all, for a date booked without a time."""
    return bool(_open_windows(provider_id, day))


def is_available_for(provider_id: str, start: datetime, end: datetime) -> bool:
    """Whether one of the provider's open weekly windows holds the whole job.

    Times are Sydney wall-clock times.
    """
    for window in _open_windows(provider_id, start.date()):
        opens = datetime.combine(start.date(), time.fromisoformat(str(window["start_time"])))
        closes = datetime.combine(start.date(), time.fromisoformat(str(window["end_time"])))
        if opens <= start and end <= closes:
            return True
    return False
