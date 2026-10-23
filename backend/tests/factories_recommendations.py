"""Rows for the provider recommendation tests on the shared schema.

The member directory is public.users: a member's suburb, state and postcode
are in metadata, and their web role comes from primary_role. A provider's
services are mobile_provider_services rows, listed in the order of their
created_at. Every id is a uuid, so strict seeds take the rows.
"""

import uuid
from datetime import datetime, timedelta, timezone

from app.services.shared_map import db_role, flatten_user
from tests.factories import NOW
from tests.factories_provider_core import service_row

# Before the strict fake's clock, one minute apart per place in the list.
_LISTED_FROM = datetime(2025, 12, 1, tzinfo=timezone.utc)


def uid(name: str) -> str:
    """A stable uuid for a readable test name."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"tenantvoice:recommendation-tests:{name}"))


def member(id: str, role: str = "tenant", full_name: str = "Test User", location=None, state=None, postcode=None,
           *, metadata: dict | None = None, **over) -> dict:
    """A users row of the directory; role is the web role ("agent" for an agent)."""
    area = {"location": location, "state": state, "postcode": postcode}
    row = {
        "id": id,
        "email": f"{id}@example.test",
        "full_name": full_name,
        "primary_role": db_role(role),
        "phone": None,
        "avatar_url": None,
        "metadata": {**{key: value for key, value in area.items() if value is not None}, **(metadata or {})},
        "created_at": NOW,
        "updated_at": NOW,
    }
    row.update(over)
    return row


def offering(id: str, provider_id: str, title: str, service_area: str, place: int, **over) -> dict:
    """A mobile_provider_services row that comes place-th in its provider's list."""
    listed = (_LISTED_FROM + timedelta(minutes=place)).isoformat()
    return service_row(id, provider_id, title=title, service_area=service_area, created_at=listed, **over)


def signed_in(as_profile, user: dict):
    """Run requests as this users row; CurrentProfile.raw holds what deps.get_current_profile puts there."""
    flat = flatten_user(user)
    return as_profile(id=user["id"], role=flat["role"], full_name=flat["full_name"], raw={**user, **flat})


def users(db) -> dict[str, dict]:
    """The stored users rows by id, to change in place."""
    return {row["id"]: row for row in db.tables.get("users", [])}
