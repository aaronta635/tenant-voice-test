"""Shared-schema rows for the rental tests: people, properties, listings, photos and applications.

Each row has every NOT NULL column the shared database has no default for,
so strict_schema seeds store it as the database would.
"""

import uuid

from app.db import schema
from app.services import uploads
from tests import fake_supabase

NOW = "2026-01-01T00:00:00+00:00"

OWNER = "c1111111-1111-4111-8111-111111111111"
MANAGER = "c2222222-2222-4222-8222-222222222222"
TENANT = "c3333333-3333-4333-8333-333333333333"
OTHER_TENANT = "c4444444-4444-4444-8444-444444444444"
STRANGER = "c5555555-5555-4555-8555-555555555555"

PEOPLE = {
    OWNER: ("Olivia Owner", "LANDLORD"),
    MANAGER: ("Avery Agent", "AGENT"),
    TENANT: ("Tanya Tenant", "TENANT"),
    OTHER_TENANT: ("Theo Tenant", "TENANT"),
    STRANGER: ("Sam Stranger", "LANDLORD"),
}


def new_id() -> str:
    return str(uuid.uuid4())


def user_row(id: str, full_name: str = "Test User", primary_role: str = "TENANT", **over) -> dict:
    return {"id": id, "email": f"{id}@example.test", "full_name": full_name, "primary_role": primary_role,
            "updated_at": NOW, **over}


def token_for(user_id: str) -> str:
    """The bearer token seed_people gives a person, for as_profile(access_token=...).

    A user_client() RPC runs as the person whose token it carries
    (current_app_user_id()), so a test of one passes this token.
    """
    return f"jwt-{user_id}"


def seed_people(db, verified: bool = True) -> None:
    """Everyone in PEOPLE; verified unless told, as applying and publishing need (services/gates.py).

    Each signs in with token_for(their id): their auth user id is their users.id.
    """
    status = "APPROVED" if verified else "PENDING"
    db.seed("users", [user_row(id, name, role, verification_status=status, auth_user_id=id)
                      for id, (name, role) in PEOPLE.items()])
    for id in PEOPLE:
        db.tokens[token_for(id)] = id


def property_row(owner: str = OWNER, **over) -> dict:
    return {"id": new_id(), "owner_user_id": owner, "address_line_1": "1 Harbour Street", "suburb": "Wollongong",
            "state": "NSW", "postcode": "2500", "property_type": "APARTMENT", "bedrooms": 2, "bathrooms": 1,
            "parking_spaces": 1, "updated_at": NOW, **over}


def listing_row(property_id: str, created_by: str = OWNER, status: str = "PUBLISHED", **over) -> dict:
    return {"id": new_id(), "property_id": property_id, "created_by_user_id": created_by, "title": "Harbour flat",
            "weekly_rent": 650, "status": status, "created_at": NOW, "updated_at": NOW, **over}


def seed_listing(db, owner: str = OWNER, status: str = "PUBLISHED", listing: dict | None = None,
                 prop: dict | None = None) -> tuple[str, str]:
    """A property of owner's and its listing; returns (listing id, property id)."""
    prop_row = property_row(owner, **(prop or {}))
    listing_values = listing_row(prop_row["id"], owner, status, **(listing or {}))
    db.seed("properties", [prop_row])
    db.seed("listings", [listing_values])
    return listing_values["id"], prop_row["id"]


def media_row(property_id: str, url: str, sort_order: int = 0, is_cover: bool = False, **over) -> dict:
    return {"id": new_id(), "property_id": property_id, "media_url": url, "media_type": "image",
            "sort_order": sort_order, "is_cover": is_cover, **over}


def application_row(listing_id: str, applicant: str = TENANT, status: str = "SUBMITTED", **over) -> dict:
    return {"id": new_id(), "listing_id": listing_id, "applicant_user_id": applicant, "status": status,
            "offer_weekly_rent": 650, "updated_at": NOW, **over}


def review_row(property_id: str, rating: int, status: str = "PUBLISHED", **over) -> dict:
    return {"id": new_id(), "property_id": property_id, "reviewer_user_id": TENANT, "reviewed_user_id": OWNER,
            "rating": rating, "landlord_rating": rating, "status": status, "updated_at": NOW, **over}


def photo_link(owner: str = OWNER, name: str = "front.jpg") -> str:
    """The public link /uploads/property-image gives a photo the owner uploaded."""
    return uploads.public_url(uploads.PROPERTY_IMAGES_BUCKET, f"{uploads.property_image_folder(owner)}/{name}")


def support_embedded_or(monkeypatch) -> None:
    """Let the fake take or_(..., reference_table=...), which it lacks.

    PostgREST applies such a filter (properties.or=(...)) to the embedded
    rows, and an !inner embed then drops each parent row whose embedded row
    fails it. The fake's or_ filters the parent table only, so this files
    the filter under one of the embedded table's columns, where the strict
    fake checks and applies embedded filters, after checking every column
    it names.
    """
    original_or = fake_supabase.FakeTableQuery.or_
    original_predicate = fake_supabase._predicate

    def or_(self, conditions, reference_table=None):
        if reference_table is None:
            return original_or(self, conditions)
        leaves = fake_supabase._logic_leaves(conditions)
        for column, op, _value in leaves:
            if op not in ("eq", "ilike"):
                raise AssertionError(f"the fake's or_ evaluates eq and ilike only, not {op}")
            if not schema.has_column(reference_table, column):
                raise fake_supabase._api_error("42703", f"column {reference_table}.{column} does not exist")
        return self._filter("embedded_or", f"{reference_table}.{leaves[0][0]}", conditions)

    def predicate(op, column, value):
        if op != "embedded_or":
            return original_predicate(op, column, value)
        checks = [fake_supabase._logic_term(term) for term in fake_supabase._split_terms(value)]
        return lambda row: any(check(row) for check in checks)

    monkeypatch.setattr(fake_supabase.FakeTableQuery, "or_", or_)
    monkeypatch.setattr(fake_supabase, "_predicate", predicate)
