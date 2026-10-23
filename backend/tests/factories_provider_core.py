"""Rows of the provider tables as the shared database holds them (migration plan §3 a8, b1, b2, c1, c2).

Each row has every NOT NULL column its table has no default for, so strict
seeds accept it (tests/fake_supabase.py, StrictSchema). A provider is a
service_provider_profiles row keyed by its owner's users.id, which is also
the provider id. Web rows (categories, availability, bookings) are seeded
with schema="web".
"""

import uuid

from app.services.maps_provider_core import SERVICE_DRAFT_STATUS, SERVICE_LIVE_STATUS, WEB_TO_DOC_TYPE
from tests import web_schema
from tests.factories import NOW

REVIEW_STATUS = {"pending": "PENDING", "verified": "APPROVED", "rejected": "REJECTED"}


def provider_user(id, full_name="Test Provider", location=None, state=None, postcode=None, **over) -> dict:
    """The users row of a service provider; their area is in metadata."""
    area = {"location": location, "state": state, "postcode": postcode}
    row = {
        "id": id,
        "email": f"{id}@example.test",
        "full_name": full_name,
        "primary_role": "SERVICE_PROVIDER",
        "phone": None,
        "avatar_url": None,
        "metadata": {key: value for key, value in area.items() if value is not None},
        "created_at": NOW,
        "updated_at": NOW,
    }
    row.update(over)
    return row


def provider_profile(
    user_id, business_name="Test Trades Co", category="tradie", slug=None, published=True, created_at=NOW, **meta
) -> dict:
    """A service_provider_profiles row as the web writes it: the shared codes, the web's fields in metadata.

    The web category is metadata.category; service_categories holds its
    codes (maps_provider_core.WEB_CATEGORY_CODES).
    """
    from app.services.maps_provider_core import category_codes

    return {
        "user_id": user_id,
        "company_name": business_name,
        "service_categories": category_codes(category),
        "pricing_summary": meta.get("tagline"),
        "verification_status": "PENDING",
        "metadata": {"slug": slug or user_id, "is_published": published,
                     **({"category": category} if category else {}), **meta},
        "created_at": created_at,
        "updated_at": NOW,
    }


def jwt_for(db, user_id: str) -> str:
    """A bearer token for a seeded users row: an RPC on it runs as that row (current_app_user_id).

    For as_profile(access_token=...), where a route calls a shared function
    as the caller (user_client).
    """
    auth_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"tenantvoice:auth:{user_id}"))
    for row in db.tables.get("users", []):
        if row["id"] == user_id:
            row["auth_user_id"] = auth_id
    token = f"jwt-{user_id}"
    db.tokens[token] = auth_id
    return token


def seed_provider(db, user_id, full_name="Test Provider", location=None, state=None, postcode=None, **profile) -> str:
    """Seed a provider's users row and profile row; returns the provider id (the user id)."""
    db.seed("users", [provider_user(user_id, full_name, location, state, postcode)])
    db.seed("service_provider_profiles", [provider_profile(user_id, **profile)])
    return user_id


def service_row(id, provider_id, title="Standard job", price=150, live=True, **over) -> dict:
    """A mobile_provider_services row."""
    row = {
        "id": id,
        "provider_user_id": provider_id,
        "title": title,
        "description": "A standard job.",
        "pricing_type": "flat",
        "price": price,
        "duration": "60 minutes",
        "inclusions": [],
        "exclusions": [],
        "service_area": "Inner West",
        "category": "GENERAL",
        "status": SERVICE_LIVE_STATUS if live else SERVICE_DRAFT_STATUS,
        "created_at": NOW,
        "updated_at": NOW,
    }
    row.update(over)
    return row


def credential_row(id, user_id, web_type="id", status="verified", file_url="https://example.test/doc.pdf", **over) -> dict:
    """A profile_documents row as the web saves a credential."""
    row = {
        "id": id,
        "user_id": user_id,
        "document_type": WEB_TO_DOC_TYPE[web_type],
        "file_url": file_url,
        "metadata": {"web_type": web_type, "label": web_type.upper()},
        "review_status": REVIEW_STATUS[status],
        "is_verified": status == "verified",
        "verified_at": NOW if status == "verified" else None,
        "submitted_at": NOW,
        "created_at": NOW,
        "updated_at": NOW,
    }
    row.update(over)
    return row


def review_row(id, reviewed_user_id, reviewer_user_id, rating, status="PUBLISHED", **over) -> dict:
    """A reviews row about a provider; shared reviews have no booking or provider column."""
    row = {
        "id": id,
        "reviewer_user_id": reviewer_user_id,
        "reviewed_user_id": reviewed_user_id,
        "property_id": None,
        "rating": rating,
        "landlord_rating": rating,
        "status": status,
        "created_at": NOW,
        "updated_at": NOW,
    }
    row.update(over)
    return row


def category_row(category, name=None, slug=None, sort_order=1, **over) -> dict:
    """A web.service_categories row."""
    row = {
        "category": category,
        "slug": slug or category.replace("_", "-"),
        "name": name or category.replace("_", " ").title(),
        "description": f"{category} services",
        "sort_order": sort_order,
        "is_active": True,
    }
    row.update(over)
    return row


def booking_row(id, provider_id, client_id, status="completed", service_id=None, **over) -> dict:
    """A web.bookings row."""
    row = {"id": id, "provider_id": provider_id, "client_id": client_id, "status": status, "service_id": service_id}
    row.update(over)
    return row


def catalogue_rows(table: str) -> list[dict]:
    """The rows supabase/shared/0002_web_seed.sql adds to a web catalogue table."""
    sql = web_schema.WEB_SEED_SQL.read_text(encoding="utf-8")
    return [row for insert in web_schema.parse_inserts(sql, tables={table}) for row in insert.rows]
