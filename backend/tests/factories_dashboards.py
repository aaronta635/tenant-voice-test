"""Shared-schema rows for the dashboard tests: leases, rent, inspections, likes, views and complaints.

Each row has every NOT NULL column the shared database has no default for,
and only values its CHECK constraints allow (output/shared-catalog/constraints.md),
so strict_schema seeds store it as the database would.
"""

from datetime import date, timedelta

from app.services import listing_views
from tests.factories_rental import NOW, OWNER, TENANT, new_id

FUTURE = "2099-01-05T00:00:00+00:00"
PAST = "2000-01-05T00:00:00+00:00"


def agreement_row(listing_id: str, tenant: str = TENANT, owner: str = OWNER, status: str = "ACTIVE", **over) -> dict:
    """A rent agreement; an ACTIVE one was activated (rent_agreement_active_requires_activation)."""
    row = {
        "id": new_id(), "application_id": new_id(), "listing_id": listing_id, "tenant_user_id": tenant,
        "owner_user_id": owner, "rent_amount": 650, "rent_frequency": "WEEKLY", "start_date": "2026-01-10",
        "first_due_date": "2026-01-10", "status": status,
    }
    if status == "ACTIVE":
        row["activated_at"] = NOW
    row.update(over)
    return row


def charge_row(agreement_id: str, due: str, amount: float = 650, status: str = "ISSUED", **over) -> dict:
    """A week's rent charge, due on its first day."""
    start = date.fromisoformat(due)
    return {"id": new_id(), "agreement_id": agreement_id, "period_start": due,
            "period_end": (start + timedelta(days=7)).isoformat(), "due_date": due, "amount_due": amount,
            "status": status, **over}


def payment_row(charge_id: str, amount: float, status: str = "SUCCEEDED", verified: bool = True, **over) -> dict:
    """A payment; a successful or refunded one is verified (successful_payment_requires_verification)."""
    return {"id": new_id(), "charge_id": charge_id, "amount": amount, "status": status,
            "verified_at": NOW if verified else None, **over}


def slot_row(listing_id: str, starts_at: str = FUTURE, owner: str = OWNER, status: str = "booked", **over) -> dict:
    return {"id": new_id(), "owner_id": owner, "listing_id": listing_id, "starts_at": starts_at,
            "duration_minutes": 30, "status": status, **over}


def booking_row(slot: dict, tenant: str = TENANT, status: str = "accepted", **over) -> dict:
    return {"id": new_id(), "slot_id": slot["id"], "owner_id": slot["owner_id"], "tenant_id": tenant,
            "listing_id": slot["listing_id"], "status": status, **over}


def seed_booking(db, listing_id: str, starts_at: str = FUTURE, status: str = "accepted", tenant: str = TENANT,
                 slot_status: str = "booked") -> dict:
    """An open-home slot of the listing and one tenant's booking of it; returns the booking."""
    slot = slot_row(listing_id, starts_at, status=slot_status)
    booking = booking_row(slot, tenant, status)
    db.seed("mobile_inspection_slots", [slot])
    db.seed("mobile_inspection_bookings", [booking])
    return booking


def inspection_row(listing_id: str, scheduled_at: str = FUTURE, status: str = "Scheduled",
                   kind: str = "Routine inspection", owner: str = OWNER, **over) -> dict:
    return {"id": new_id(), "owner_user_id": owner, "listing_id": listing_id, "inspection_type": kind,
            "scheduled_at": scheduled_at, "status": status, "status_history": [], **over}


def favourite_row(listing_id: str, user: str = TENANT, **over) -> dict:
    return {"id": new_id(), "user_id": user, "listing_id": listing_id, **over}


def view_rows(listing_id: str, day: str, count: int) -> list[dict]:
    """count views of a listing on a Sydney day, as the beacon stores them (web.listing_views)."""
    salt = "0" * 64  # any day's salt: the counts read only the listing and the day
    return [{"listing_id": listing_id, "viewed_on": day,
             "visitor_hash": listing_views.visitor_hash(salt, listing_id, date.fromisoformat(day), f"visitor:{index:020d}")}
            for index in range(count)]


def complaint_row(reporter: str = TENANT, status: str = "OPEN", **over) -> dict:
    return {"id": new_id(), "reporter_user_id": reporter, "category": "SAFETY", "description": "Broken lock",
            "status": status, "metadata": {"subject": "Lock"}, **over}


def work_order_row(complaint_id: str, tenant: str = TENANT, status: str = "OPEN", **over) -> dict:
    return {"id": new_id(), "complaint_id": complaint_id, "tenant_user_id": tenant, "status": status,
            "updated_at": NOW, **over}
