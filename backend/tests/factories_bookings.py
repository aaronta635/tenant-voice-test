"""Rows for the bookings, ledger and provider dashboard tests on the shared schema (strict_schema).

Every id is a uuid and every row has the NOT NULL columns its table has no
default for, so strict seeds take it. People are users rows, and a provider
is also a service_provider_profiles row keyed by the same id. A service is a
mobile_provider_services row; bookings, invoices, transactions and weekly
hours are web rows: seed them with schema="web".
"""

import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from tests.factories import NOW
from tests.factories_provider_core import provider_profile, provider_user, service_row

SYDNEY = ZoneInfo("Australia/Sydney")


def uid(name: str) -> str:
    """A stable uuid for a readable test name."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"tenantvoice:bookings-tests:{name}"))


def person(id: str, full_name: str, primary_role: str = "TENANT", **over) -> dict:
    """A users row with its own email."""
    return provider_user(id, full_name, primary_role=primary_role, **over)


def seed_provider(db, provider_id: str, business_name: str | None = "Whitlock Property",
                  full_name: str = "Amelia Whitlock", verified: bool = True, **profile) -> str:
    """A provider's users row and its service_provider_profiles row (published unless told); returns its id.

    Verified unless told, as confirming and starting a booking need (services/gates.py).
    """
    status = "APPROVED" if verified else "PENDING"
    db.seed("users", [person(provider_id, full_name, "SERVICE_PROVIDER", verification_status=status)])
    row = provider_profile(provider_id, business_name=business_name, **profile)
    db.seed("service_provider_profiles", [{**row, "verification_status": status}])
    return provider_id


def service(id: str, provider_id: str, title: str = "Rental appraisal", price=99, minutes: int | None = 60,
            live: bool = True, **over) -> dict:
    """A mobile_provider_services row; minutes=None leaves the duration empty, as an unset mobile row has it."""
    return service_row(id, provider_id, title=title, price=price, live=live,
                       duration=f"{minutes} minutes" if minutes else "", **over)


def hours(provider_id: str, day: int, start: str = "00:00:00", end: str = "23:59:59", **over) -> dict:
    """A web.provider_availability window; day_of_week counts from Sunday (0). Its id is the column default."""
    return {"provider_id": provider_id, "day_of_week": day, "start_time": start, "end_time": end,
            "is_available": True, **over}


def open_week(provider_id: str) -> list[dict]:
    """Windows covering every day from midnight to 23:59:59."""
    return [hours(provider_id, day) for day in range(7)]


def booking(id: str, client_id: str, provider_id: str, status: str = "new_enquiry", **over) -> dict:
    """A web.bookings row."""
    return {"id": id, "client_id": client_id, "provider_id": provider_id, "status": status,
            "created_at": NOW, "updated_at": NOW, **over}


def invoice(id: str, provider_id: str, booking_id: str | None = None, number: str = "INV-1", amount=99,
            status: str = "issued", **over) -> dict:
    """A web.invoices row."""
    return {"id": id, "provider_id": provider_id, "booking_id": booking_id, "number": number, "amount": amount,
            "status": status, "created_at": NOW, **over}


def transaction(id: str, provider_id: str, type: str, amount, booking_id: str | None = None,
                created_at: str = NOW, **over) -> dict:
    """A web.transactions row."""
    return {"id": id, "provider_id": provider_id, "booking_id": booking_id, "type": type, "amount": amount,
            "description": type.replace("_", " ").title(), "created_at": created_at, **over}


def web_rows(db, table: str, **match) -> list[dict]:
    """The rows of a web table that have every given value."""
    stored = db.schema_tables.get("web", {}).get(table, [])
    return [row for row in stored if all(row.get(k) == v for k, v in match.items())]


def rows(db, table: str, **match) -> list[dict]:
    """The rows of a public table that have every given value."""
    return [row for row in db.tables.get(table, []) if all(row.get(k) == v for k, v in match.items())]


def freeze_clock(monkeypatch, module, moment: datetime) -> list[datetime]:
    """Make module's datetime.now() read a Sydney moment; set the list's item to move the clock."""
    now = [moment if moment.tzinfo else moment.replace(tzinfo=SYDNEY)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return now[0].astimezone(tz) if tz else now[0].replace(tzinfo=None)

    monkeypatch.setattr(module, "datetime", Clock)
    return now
