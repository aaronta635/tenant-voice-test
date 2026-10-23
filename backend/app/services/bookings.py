"""Marketplace bookings, kept in web.bookings on the shared database (migration plan §3 c3).

A booking is between a client and a provider, both users.id: a provider's id
is its owner's users.id (service_provider_profiles.user_id). Its service is a
mobile_provider_services row, its thread the shared conversation that
conversation_id names (conversations.marketplace_thread opens it) and its
review the shared reviews row that review_id names. Every change is guarded
on the status it was checked against, and the ledger (ledger.py) writes the
invoice and the payment rows that follow the status.
"""

import logging
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client, web_table
from app.services import _common, conversations, gates, ledger, notifications, provider_availability, provider_services
from app.services import service_providers as service_providers_service
from app.services.maps_bookings import (
    DEFAULT_MINUTES, booking_price, booking_threads, new_booking, review_ratings, service_minutes,
)
from app.services.maps_messaging import is_uuid
from app.services.shared_map import flatten_user

logger = logging.getLogger(__name__)
LOCAL_TZ = ZoneInfo("Australia/Sydney")

# In the web schema: query it with web_table(TABLE).
TABLE = "bookings"
# What bookings, the finance table and printed invoices show of a person (a users row).
PEOPLE_FIELDS = "id, full_name, avatar_url, phone, primary_role, metadata"

ALLOWED_TRANSITIONS = {
    "new_enquiry": {"confirmed", "declined", "cancelled"},
    "confirmed": {"in_progress", "cancelled"},
    "in_progress": {"completed", "cancelled"},
    "completed": set(),
    "declined": set(),
    "cancelled": set(),
}


def people_by_id(ids) -> dict[str, dict]:
    """People by users.id, as shared_map.flatten_user() fields.

    Someone with no users row (a deleted account) is left out.
    """
    wanted = [person_id for person_id in dict.fromkeys(ids) if is_uuid(person_id)]
    rows = _common.select_in(
        lambda: get_supabase_client().table("users").select(PEOPLE_FIELDS).order("id"), "id", wanted
    )
    return {row["id"]: flatten_user(row) for row in rows}


def _review_ratings(review_ids) -> dict[str, int]:
    rows = _common.select_in(
        lambda: get_supabase_client().table("reviews").select("id, rating, landlord_rating, status").order("id"),
        "id",
        [review_id for review_id in review_ids if review_id],
    )
    return review_ratings(rows)


def _threads(bookings: list[dict], viewer_id: str | None) -> dict[str, str]:
    """Each booking's thread, by booking id (maps_bookings.booking_threads).

    A booking without conversation_id may still have a thread opened for it
    from the booking card, which names it only in its metadata. The viewer is
    the booking's client or provider, so that thread is one of the viewer's
    DIRECT threads, the type a marketplace thread has.
    """
    unlinked = [booking for booking in bookings if not booking.get("conversation_id")]
    threads: list[dict] = []
    if unlinked and is_uuid(viewer_id):
        rows = _common.select_all(
            lambda: get_supabase_client()
            .table(conversations.PARTICIPANTS)
            .select("id, conversations!inner(id, metadata, created_at, conversation_participants(user_id))")
            .eq("user_id", viewer_id)
            .eq("conversations.conversation_type", "DIRECT")
            .order("id")
        )
        threads = [row["conversations"] for row in rows]
    return booking_threads(bookings, threads)


def decorate(bookings: list[dict], viewer_id: str | None = None) -> list[dict]:
    """web.bookings rows as BookingOut, as viewer_id sees them: names, service, review stars and thread.

    The bookings table only stores foreign keys; every screen that lists
    bookings needs human-readable labels, so they are resolved here in batch
    rather than being invented in the UI. unread_count is the viewer's
    unread messages in the booking's thread, by the inbox's rule.
    """
    if not bookings:
        return []
    provider_ids = {booking["provider_id"] for booking in bookings}
    providers = conversations.providers_by_id(provider_ids)
    people = people_by_id([booking["client_id"] for booking in bookings] + list(provider_ids))
    services = provider_services.services_by_id({b["service_id"] for b in bookings if b.get("service_id")})
    ratings = _review_ratings({booking.get("review_id") for booking in bookings})
    threads = _threads(bookings, viewer_id)
    unread = {}
    if threads and is_uuid(viewer_id):
        unread = conversations.unread_counts(viewer_id, list(set(threads.values())))

    for booking in bookings:
        client = people.get(booking["client_id"]) or {}
        owner = people.get(booking["provider_id"]) or {}
        booking["client_name"] = client.get("full_name") or None
        booking["client_avatar_url"] = client.get("avatar_url")
        # A provider is shown by its business name, else by its owner's own.
        booking["provider_name"] = (providers.get(booking["provider_id"]) or {}).get("business_name") or (
            owner.get("full_name") or None
        )
        booking["service_title"] = (services.get(booking.get("service_id")) or {}).get("title")
        booking["review_rating"] = ratings.get(booking.get("review_id"))
        booking["conversation_id"] = threads.get(booking["id"])
        booking["unread_count"] = unread.get(booking["conversation_id"], 0)
    return bookings


def _bookable_service(provider_id: str, service_id: str | None) -> dict | None:
    """The live service of the provider that a request names (None for none); 404 for any other."""
    if not service_id:
        return None
    service = provider_services.services_by_id([service_id]).get(service_id) if is_uuid(service_id) else None
    if not service or service["provider_id"] != provider_id or not service["is_active"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found for this provider")
    return service


def create_booking(client_id: str, payload: dict) -> dict:
    # An id or a slug; 404 unless the provider is live, as for its public page.
    provider_id = service_providers_service.require_published(payload["provider_id"])
    if provider_id == client_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot book your own service")

    service = _bookable_service(provider_id, payload.get("service_id"))
    day, at = payload.get("scheduled_date"), payload.get("scheduled_time")
    _assert_not_past(day, at)
    _assert_within_hours(provider_id, day, at, payload.get("service_id"))
    _assert_slot_free(provider_id, day, at, service_id=payload.get("service_id"))

    row = new_booking(client_id, provider_id, payload, booking_price(service))
    created = web_table(TABLE).insert(row).execute().data
    booking = decorate(created, viewer_id=client_id)[0]

    notifications.notify(
        provider_id,
        "booking",
        f"New enquiry from {booking.get('client_name') or 'a client'}",
        _summary(booking),
        "/dashboard/bookings",
    )
    return booking


def get_booking(booking_id: str) -> dict:
    # id is a uuid column: anything else is no booking, not a 22P02.
    rows = web_table(TABLE).select("*").eq("id", booking_id).limit(1).execute().data if is_uuid(booking_id) else []
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    return rows[0]


def assert_participant(booking: dict, profile_id: str, provider_id: str | None) -> None:
    is_client = booking["client_id"] == profile_id
    is_provider = provider_id is not None and booking["provider_id"] == provider_id
    if not (is_client or is_provider):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this booking")


def list_bookings(profile_id: str, provider_id: str | None, status_filter: str | None) -> list[dict]:
    """The bookings someone made, and as a provider the jobs booked with them too, newest first."""

    def build():
        query = web_table(TABLE).select("*")
        if provider_id:
            # Both are the caller's own users.id, never request input.
            query = query.or_(f"client_id.eq.{profile_id},provider_id.eq.{provider_id}")
        else:
            query = query.eq("client_id", profile_id)
        if status_filter:
            query = query.eq("status", status_filter)
        return query.order("created_at", desc=True).order("id")

    return decorate(_common.select_all(build), viewer_id=profile_id)


def attach_review(booking_id: str, review_id: str) -> bool:
    """Link a booking to its review (a shared reviews row); False if it already has one."""
    return bool(
        web_table(TABLE).update({"review_id": review_id}).eq("id", booking_id).is_("review_id", "null").execute().data
    )


# Who can move a booking, and the copy the other party is notified with.
STATUS_NOTICE = {
    "confirmed": "{actor} accepted your booking",
    "declined": "{actor} declined your booking request",
    "in_progress": "{actor} has started your job",
    "completed": "{actor} marked your job as done",
    "cancelled": "{actor} cancelled the booking",
}
RESCHEDULABLE = {"new_enquiry", "confirmed"}
CLOSED = {"completed", "declined", "cancelled"}
SLOT_TAKEN_BY = ("confirmed", "in_progress")


def update_booking(
    booking_id: str, profile_id: str, provider_id: str | None, payload: dict
) -> dict:
    booking = get_booking(booking_id)
    assert_participant(booking, profile_id, provider_id)

    is_provider = provider_id is not None and booking["provider_id"] == provider_id
    update_payload = {k: v for k, v in payload.items() if v is not None}
    if update_payload and booking["status"] in CLOSED:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This booking is closed and can no longer be changed")

    new_status = update_payload.get("status")
    if new_status in {"in_progress", "completed"}:
        day = booking.get("scheduled_date")
        if not day:
            raise HTTPException(400, "Set a booking date before starting this job")
        scheduled = datetime.combine(date.fromisoformat(str(day)[:10]), time.fromisoformat(str(booking.get("scheduled_time") or "00:00:00")), tzinfo=LOCAL_TZ)
        if scheduled > datetime.now(LOCAL_TZ):
            raise HTTPException(400, "This job cannot start or finish before its scheduled time")
    if new_status:
        allowed = ALLOWED_TRANSITIONS.get(booking["status"], set())
        if new_status not in allowed:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Cannot transition booking from {booking['status']} to {new_status}",
            )
        if new_status == "confirmed" and not is_provider:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the provider can confirm a booking")
        if new_status == "in_progress" and not is_provider:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the provider can start a booking")
        if new_status in ("confirmed", "in_progress"):
            # Accepting a booking, and starting one, is new work: only a
            # verified provider with an active account takes it (R18). A
            # suspended one may still finish a job in progress (assumption #14).
            gates.require_verified(profile_id, "accept_booking")
        if new_status == "completed" and not is_provider:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the provider can complete a booking")
        if new_status == "declined" and not is_provider:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the provider can decline a booking")
        if new_status == "cancelled" and booking["status"] == "in_progress" and not is_provider:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "The job has started; message the provider to stop it"
            )

    if "completion_report" in update_payload and not is_provider:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the provider can set a completion report")

    rescheduled = _schedule_changed(booking, update_payload)
    if rescheduled:
        if booking["status"] not in RESCHEDULABLE or (new_status and new_status not in RESCHEDULABLE):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Only open enquiries and confirmed bookings can be rescheduled",
            )
        if not is_provider and booking["status"] != "new_enquiry":
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Ask the provider to suggest a new time for a confirmed booking",
            )
        when = (
            update_payload.get("scheduled_date", booking.get("scheduled_date")),
            update_payload.get("scheduled_time", booking.get("scheduled_time")),
        )
        _assert_not_past(*when)
        if not is_provider:
            # Clients pick from the published hours; a provider may agree any time.
            _assert_within_hours(booking["provider_id"], *when, booking.get("service_id"))

    if not update_payload:
        return decorate([booking], viewer_id=profile_id)[0]

    # Accepting or moving a job onto the calendar must not double-book a slot.
    if new_status == "confirmed" or (rescheduled and booking["status"] == "confirmed"):
        _assert_slot_free(
            booking["provider_id"],
            update_payload.get("scheduled_date", booking.get("scheduled_date")),
            update_payload.get("scheduled_time", booking.get("scheduled_time")),
            exclude_id=booking_id,
            service_id=booking.get("service_id"),
        )

    # Guard on the status we validated against: if someone else moved the
    # booking in the meantime (accept vs cancel), this write matches nothing.
    # updated_at is the web schema's trigger's to move.
    result = (
        web_table(TABLE)
        .update(update_payload)
        .eq("id", booking_id)
        .eq("status", booking["status"])
        .execute()
    )
    if not result.data:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This booking was just updated by someone else. Refresh and try again."
        )
    # Only the request whose guarded write matched records the payment, so a
    # lost race or a second "Mark done" never adds another one.
    if new_status == "completed":
        _record_completion_or_reopen(booking, update_payload)
    updated = decorate(result.data, viewer_id=profile_id)[0]

    try:
        if new_status == "confirmed":
            ledger.issue_invoice(updated)
        elif new_status in ("declined", "cancelled"):
            ledger.void_open_invoice(booking)
    except Exception as exc:
        logger.error("invoice update failed for booking %s: %s", booking_id, exc)

    _notify_counterpart(updated, is_provider, new_status, rescheduled)
    return updated


def _record_completion_or_reopen(booking: dict, update_payload: dict) -> None:
    """Write a finished job's ledger rows; if that fails, reopen the job and re-raise.

    A completed booking is closed, so without reopening it the payment could
    never be retried. The ledger is idempotent per booking, so the retry does
    not double anything that was already written.
    """
    try:
        ledger.record_completion(booking)
    except Exception:
        logger.warning("ledger write failed for booking %s; reopening it", booking["id"])
        web_table(TABLE).update(
            {field: booking.get(field) for field in update_payload}
        ).eq("id", booking["id"]).eq("status", "completed").execute()
        raise


def _durations(service_ids) -> dict[str, int]:
    """How long each service takes, in minutes, by id (maps_bookings.service_minutes)."""
    services = provider_services.services_by_id([service_id for service_id in service_ids if service_id])
    return {service_id: service_minutes(service) for service_id, service in services.items()}


def _occupied_bookings(provider_id: str) -> list[dict]:
    return _common.select_all(
        lambda: web_table(TABLE)
        .select("id, service_id, scheduled_date, scheduled_time")
        .eq("provider_id", provider_id)
        .in_("status", list(SLOT_TAKEN_BY))
        .order("id")
    )


def _interval(row: dict, durations: dict[str, int]):
    if not row.get("scheduled_date") or not row.get("scheduled_time"):
        return None
    clock = time.fromisoformat(str(row["scheduled_time"]))
    if clock.tzinfo is not None:
        raise HTTPException(400, "Use Sydney local time without a timezone offset")
    start = datetime.combine(date.fromisoformat(str(row["scheduled_date"])[:10]), clock)
    return start, start + timedelta(minutes=durations.get(row.get("service_id"), DEFAULT_MINUTES))


def public_busy_times(provider_id: str) -> list[dict]:
    """Only aggregate occupied times are public; no booking IDs or client data."""
    today = datetime.now(LOCAL_TZ).date()
    occupied = _occupied_bookings(provider_id)
    durations = _durations({row.get("service_id") for row in occupied})
    intervals = []
    for row in occupied:
        span = _interval(row, durations)
        if not span:
            continue
        start, end = span
        # Public slots have minute precision. Round outward so a job ending at
        # 11:00:30 never advertises 11:00 as free while the server rejects it.
        start = start.replace(second=0, microsecond=0)
        if end.second or end.microsecond:
            end = end.replace(second=0, microsecond=0) + timedelta(minutes=1)
        if end.date() < today or start.date() > today + timedelta(days=90):
            continue
        while start < end:
            midnight = datetime.combine(start.date() + timedelta(days=1), time.min)
            stop = min(end, midnight)
            intervals.append({"date": start.date().isoformat(), "start_time": start.strftime("%H:%M"),
                              "end_time": "24:00" if stop == midnight else stop.strftime("%H:%M")})
            start = stop
    return intervals


# What the provider pages show of a provider's bookings.
def completed_job_count(provider_id: str) -> int:
    """How many jobs the provider has completed, for the public profile."""
    result = (
        web_table(TABLE).select("id", count="exact", head=True)
        .eq("provider_id", provider_id).eq("status", "completed").execute()
    )
    return result.count or 0


def booking_counts(service_ids: list[str]) -> dict[str, int]:
    """How many bookings each service has had, by service id."""
    counts: dict[str, int] = {}
    rows = _common.select_in(lambda: web_table(TABLE).select("id, service_id").order("id"), "service_id", service_ids)
    for row in rows:
        counts[row["service_id"]] = counts.get(row["service_id"], 0) + 1
    return counts


def has_bookings(service_id: str) -> bool:
    """Whether any booking, open or closed, names the service."""
    return bool(web_table(TABLE).select("id").eq("service_id", service_id).limit(1).execute().data)


def _assert_slot_free(provider_id: str, day, at, exclude_id: str | None = None, service_id: str | None = None) -> None:
    if not day or not at:
        return
    occupied = [row for row in _occupied_bookings(provider_id) if row["id"] != exclude_id]
    durations = _durations({row.get("service_id") for row in occupied} | {service_id})
    candidate = _interval({"scheduled_date": day, "scheduled_time": at, "service_id": service_id}, durations)
    for row in occupied:
        span = _interval(row, durations)
        if candidate and span and candidate[0] < span[1] and span[0] < candidate[1]:
            raise HTTPException(409, "That time overlaps another booking. Choose another time.")


def _assert_within_hours(provider_id: str, day, at, service_id: str | None) -> None:
    """400 unless the whole job, at its service's length, fits the provider's weekly hours.

    A date sent without a time must still fall on a day the provider works.
    """
    if not day:
        return
    if at:
        start, end = _interval({"scheduled_date": day, "scheduled_time": at, "service_id": service_id},
                               _durations({service_id}))
        within = provider_availability.is_available_for(provider_id, start, end)
    else:
        within = provider_availability.is_open_on(provider_id, date.fromisoformat(str(day)[:10]))
    if not within:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "That time is outside the provider's available hours. Choose another time."
        )


def _assert_not_past(value, at=None) -> None:
    if not value:
        return
    now = datetime.now(LOCAL_TZ)
    day = date.fromisoformat(str(value)[:10])
    if day < now.date():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a date that is not in the past")
    if at:
        clock = time.fromisoformat(str(at))
        if clock.tzinfo is not None:
            raise HTTPException(400, "Use Sydney local time without a timezone offset")
        scheduled = datetime.combine(day, clock, tzinfo=LOCAL_TZ)
        if scheduled < now:
            raise HTTPException(400, "Choose a date and time that are not in the past")


def _schedule_changed(booking: dict, update_payload: dict) -> bool:
    changed = False
    for field in ("scheduled_date", "scheduled_time"):
        if field in update_payload and str(update_payload[field]) != str(booking.get(field) or ""):
            changed = True
    return changed


def _when(booking: dict) -> str | None:
    day, at = booking.get("scheduled_date"), booking.get("scheduled_time")
    if not day:
        return None
    parsed = date.fromisoformat(str(day)[:10])
    label = f"{parsed.strftime('%a')} {parsed.day} {parsed.strftime('%b')}"
    if at:
        moment = time.fromisoformat(str(at))
        hour = moment.hour % 12 or 12
        label += f" at {hour}:{moment.minute:02d} {'am' if moment.hour < 12 else 'pm'}"
    return label


def _summary(booking: dict) -> str:
    return " · ".join(
        part
        for part in (booking.get("service_title"), booking.get("property_suburb"), _when(booking))
        if part
    )


def _booking_thread(booking: dict) -> str:
    """The booking's thread id, opening it if nobody has messaged about the booking yet.

    The thread is the client and provider's marketplace thread for this
    booking (conversations.marketplace_thread), which a thread opened from the
    booking card already is. Its id is kept in web.bookings.conversation_id,
    unless the booking links one already.
    """
    thread_id = booking.get("conversation_id") or conversations.marketplace_thread(
        booking["client_id"],
        booking["provider_id"],
        booking_id=booking["id"],
        subject=booking.get("service_title"),
        created_by=booking["provider_id"],
    )["id"]
    web_table(TABLE).update({"conversation_id": thread_id}).eq("id", booking["id"]).is_(
        "conversation_id", "null"
    ).execute()
    booking["conversation_id"] = thread_id
    return thread_id


def _notify_counterpart(
    booking: dict, actor_is_provider: bool, new_status: str | None, rescheduled: bool
) -> None:
    """Tell the other party what changed. Never raises."""
    try:
        # A provider is notified on its own account: its id is its owner's users.id.
        client = notifications.profile_summary(booking["client_id"])
        if actor_is_provider:
            recipient, actor = booking["client_id"], booking.get("provider_name") or "Your provider"
        else:
            recipient, actor = booking["provider_id"], booking.get("client_name") or "Your client"

        if rescheduled:
            when = _when(booking) or "a new time"
            if actor_is_provider:
                thread_id = _booking_thread(booking)
                conversations.post_message(
                    thread_id,
                    booking["provider_id"],
                    f"I've rescheduled {booking.get('service_title') or 'your booking'}: "
                    f"{when}. This updates the booking time; reply here if you need help.",
                )
                link = notifications.messages_href(client.get("role"), thread_id)
                notifications.notify(recipient, "booking", f"{actor} rescheduled your booking", _summary(booking), link)
            else:
                notifications.notify(
                    recipient, "booking", f"{actor} changed the requested time", _summary(booking), "/dashboard/bookings"
                )

        if new_status in STATUS_NOTICE:
            link = (
                notifications.messages_href(client.get("role"), booking.get("conversation_id"))
                if actor_is_provider
                else "/dashboard/bookings"
            )
            notifications.notify(
                recipient, "booking", STATUS_NOTICE[new_status].format(actor=actor), _summary(booking), link
            )
    except Exception as exc:
        logger.error("booking notification failed for %s: %s", booking.get("id"), exc)
