"""Rows for the tenant matching and match alert tests (services/matching.py) on the shared schema.

A tenant's preferences are their tenant_profiles row and its metadata's
rental_preferences; a home is a properties row with its PUBLISHED listing,
published a day before the real clock by default, since matching reads the
real time. Every id is a uuid and every row carries the NOT NULL columns its
table has no default for, so strict seeds take them.
"""

import uuid
from datetime import datetime, timedelta, timezone

from tests.factories import NOW


def uid(name: str) -> str:
    """A stable uuid for a readable test name."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"tenantvoice:matching-tests:{name}"))


MEI = uid("mei")
THEO = uid("theo")
OLIVIA = uid("olivia")
SAM = uid("sam")


def user_row(id: str, full_name: str, primary_role: str = "TENANT", **over) -> dict:
    return {
        "id": id,
        "email": f"{id}@example.test",
        "full_name": full_name,
        "primary_role": primary_role,
        "status": "ACTIVE",
        "metadata": {},
        "created_at": NOW,
        "updated_at": NOW,
        **over,
    }


def tenant_profile(user_id: str, *, budget_max=None, locations=None, has_pets=False, move_in=None,
                   essentials=None, **preferences) -> dict:
    """A tenant_profiles row; preferences go to metadata.rental_preferences (bedrooms_min, ...)."""
    wanted = dict(preferences)
    if essentials is not None:
        wanted["essentials"] = essentials
    return {
        "user_id": user_id,
        "budget_max": budget_max,
        "preferred_locations": locations,
        "has_pets": has_pets,
        "move_in_date": move_in,
        "metadata": {"rental_preferences": wanted} if wanted else None,
        "updated_at": NOW,
    }


def days_ago(days: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def in_days(days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).date().isoformat()


def seed_home(db, owner: str, name: str, *, rent: float = 600, suburb: str = "Newtown", state: str = "NSW",
              postcode: str = "2042", bedrooms: int | None = 2, bathrooms: int | None = 1, parking: int | None = 1,
              pets: bool = True, available_from: str | None = None, listed_days_ago: float = 1,
              property_type: str = "APARTMENT", status: str = "PUBLISHED") -> str:
    """A property of owner's and its listing; returns the listing id (the web's property id)."""
    property_id, listing_id = uid(f"property-{name}"), uid(f"listing-{name}")
    db.seed("properties", [{
        "id": property_id, "owner_user_id": owner, "address_line_1": f"{len(name)} Private Street",
        "suburb": suburb, "state": state, "postcode": postcode, "property_type": property_type,
        "bedrooms": bedrooms, "bathrooms": bathrooms, "parking_spaces": parking, "pet_friendly": pets,
        "updated_at": NOW,
    }])
    listed = days_ago(listed_days_ago)
    db.seed("listings", [{
        "id": listing_id, "property_id": property_id, "created_by_user_id": owner, "title": name,
        "weekly_rent": rent, "available_from": available_from, "status": status,
        "published_at": listed if status == "PUBLISHED" else None, "created_at": listed, "updated_at": NOW,
    }])
    return listing_id


def review_of(db, about: str, rating: int, name: str, status: str = "PUBLISHED") -> None:
    """A review about a member (reviewed_user_id), by the reviewer the test seeds as SAM."""
    db.seed("reviews", [{
        "id": uid(f"review-{name}"), "reviewer_user_id": SAM, "reviewed_user_id": about, "rating": rating,
        "landlord_rating": rating, "status": status, "updated_at": NOW,
    }])


def alert_rows(db, tenant_id: str | None = None) -> list[dict]:
    return [row for row in db.tables.get("recommendations", [])
            if (row.get("payload") or {}).get("kind") == "alert"
            and (tenant_id is None or row["target_user_id"] == tenant_id)]


def match_rows(db, tenant_id: str | None = None, recommendation_type: str = "PROPERTY") -> list[dict]:
    return [row for row in db.tables.get("recommendations", [])
            if (row.get("payload") or {}).get("kind") == "match" and row["recommendation_type"] == recommendation_type
            and (tenant_id is None or row["target_user_id"] == tenant_id)]
