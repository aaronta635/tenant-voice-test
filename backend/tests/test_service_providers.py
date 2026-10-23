"""Marketplace business logic on the shared tables: publishing rules, search,
the review summary and the derived fields (_decorate) the provider cards render."""

from fastapi import HTTPException
import pytest

from app.services import service_providers as service
from tests.factories import NOW
from tests.factories_provider_core import (
    booking_row, category_row, credential_row, provider_user, review_row, seed_provider, service_row,
)

pytestmark = pytest.mark.usefixtures("strict_schema")

AMELIA = "a0000000-0000-4000-8000-000000000001"
DANIEL = "a0000000-0000-4000-8000-000000000002"
HIDDEN = "a0000000-0000-4000-8000-000000000003"
CLIENT = "c0000000-0000-4000-8000-000000000001"


def seed_marketplace(db):
    db.seed("service_categories", [category_row("tradie"), category_row("cleaner")], schema="web")
    seed_provider(db, AMELIA, "Amelia", location="Newtown", state="NSW", postcode="2042",
                  business_name="Amelia Plumbing", slug="amelia-plumbing", category="tradie")
    seed_provider(db, DANIEL, "Daniel", location="Marrickville", state="NSW", postcode="2204",
                  business_name="Daniel Cleans", slug="daniel-cleans", category="cleaner")
    seed_provider(db, HIDDEN, "Hidden", business_name="Hidden Co", slug="hidden-co", published=False)
    db.seed("users", [provider_user(CLIENT, "Client", primary_role="TENANT")])
    db.seed("reviews", [
        review_row("b0000000-0000-4000-8000-000000000001", AMELIA, CLIENT, 5),
        review_row("b0000000-0000-4000-8000-000000000002", AMELIA, CLIENT, 4),
        review_row("b0000000-0000-4000-8000-000000000003", DANIEL, CLIENT, 4),
    ])


def test_looks_like_uuid():
    assert service._looks_like_uuid("123e4567-e89b-12d3-a456-426614174000")
    assert not service._looks_like_uuid("amelia-plumbing")
    assert not service._looks_like_uuid("a-b-c-d-e")


def test_create_provider_fills_in_the_row_sign_up_made(strict_schema):
    # Sign-up (profiles.ensure_user_for_auth) leaves an empty, unpublished row.
    strict_schema.seed("users", [provider_user(AMELIA)])
    strict_schema.seed("service_provider_profiles", [
        {"user_id": AMELIA, "verification_status": "PENDING", "metadata": {"is_published": False}, "updated_at": NOW},
    ])

    created = service.create_provider(AMELIA, {"category": "tradie", "business_name": "Amelia Plumbing"})

    assert (created["category"], created["business_name"], created["slug"]) == ("tradie", "Amelia Plumbing", "amelia-plumbing")
    assert created["is_published"] is False
    [row] = strict_schema.tables["service_provider_profiles"]
    # The shared codes a tradie covers (update_own_profile and assign_maintenance_work_order read
    # them), and the web category beside them in metadata.
    assert (row["company_name"], row["metadata"]["category"]) == ("Amelia Plumbing", "tradie")
    assert row["service_categories"] == [
        "PLUMBING", "ELECTRICAL", "HVAC", "APPLIANCE", "LOCKS_SECURITY", "LEAK", "SAFETY", "GENERAL",
    ]
    assert row["updated_at"] != NOW


def test_create_provider_inserts_a_stamped_row_for_an_account_without_one(strict_schema):
    strict_schema.seed("users", [provider_user(AMELIA)])

    created = service.create_provider(AMELIA, {"category": "cleaner", "tagline": "Spotless homes"})

    [row] = strict_schema.tables["service_provider_profiles"]
    assert row["updated_at"] and row["service_area"] is None  # the tagline is not a service area
    assert (row["pricing_summary"], row["metadata"]["is_published"]) == ("Spotless homes", False)
    assert created["slug"] == "provider-a0000000"


def test_update_provider_unknown_id_is_404():
    with pytest.raises(HTTPException) as exc:
        service.update_provider("f0000000-0000-4000-8000-000000000000", {"tagline": "hi"})
    assert exc.value.status_code == 404


def test_an_edit_stamps_updated_at(strict_schema):
    seed_marketplace(strict_schema)

    edited = service.update_provider(AMELIA, {"bio": "Licensed plumber."})

    assert edited["bio"] == "Licensed plumber."
    row = next(row for row in strict_schema.tables["service_provider_profiles"] if row["user_id"] == AMELIA)
    assert row["updated_at"] != NOW and row["metadata"]["slug"] == "amelia-plumbing"


def test_list_public_providers_excludes_unpublished(strict_schema):
    seed_marketplace(strict_schema)
    assert {row["id"] for row in service.list_public_providers()} == {AMELIA, DANIEL}


def test_list_public_providers_sorts_by_rating_by_default(strict_schema):
    seed_marketplace(strict_schema)
    rows = service.list_public_providers()
    assert [(row["id"], row["rating_avg"], row["review_count"]) for row in rows] == [(AMELIA, 4.5, 2), (DANIEL, 4.0, 1)]


def test_hidden_and_archived_reviews_leave_the_rating(strict_schema):
    seed_marketplace(strict_schema)
    strict_schema.seed("reviews", [
        review_row("b0000000-0000-4000-8000-000000000004", DANIEL, CLIENT, 1, status="HIDDEN"),
        review_row("b0000000-0000-4000-8000-000000000005", DANIEL, CLIENT, 1, status="ARCHIVED"),
        review_row("b0000000-0000-4000-8000-000000000006", DANIEL, CLIENT, 2, status="FLAGGED"),
    ])
    daniel = service.get_public_provider("daniel-cleans")
    assert (daniel["rating_avg"], daniel["review_count"]) == (3.0, 2)


def test_list_public_providers_search_matches_business_name(strict_schema):
    seed_marketplace(strict_schema)
    assert [row["business_name"] for row in service.list_public_providers(search="plumb")] == ["Amelia Plumbing"]


def test_list_public_providers_filters_by_location_on_profile(strict_schema):
    seed_marketplace(strict_schema)
    assert [row["id"] for row in service.list_public_providers(location="marrickville")] == [DANIEL]


def test_list_public_providers_min_rating(strict_schema):
    seed_marketplace(strict_schema)
    assert [row["id"] for row in service.list_public_providers(min_rating=4.5)] == [AMELIA]


def test_decorate_derives_card_fields(strict_schema):
    """Verification badges, from-price, unit label, category name/slug and
    service count are all resolved from data, never hard-coded."""
    seed_marketplace(strict_schema)
    strict_schema.seed("profile_documents", [
        credential_row("d0000000-0000-4000-8000-000000000001", AMELIA, "insurance"),
        credential_row("d0000000-0000-4000-8000-000000000002", AMELIA, "id"),
        credential_row("d0000000-0000-4000-8000-000000000003", AMELIA, "licence", status="pending"),  # no badge
    ])
    strict_schema.seed("mobile_provider_services", [
        service_row("e0000000-0000-4000-8000-000000000001", AMELIA, price=250),
        service_row("e0000000-0000-4000-8000-000000000002", AMELIA, price=99, pricing_type="hourly"),
        service_row("e0000000-0000-4000-8000-000000000003", AMELIA, price=10, live=False),
        service_row("e0000000-0000-4000-8000-000000000004", AMELIA, price=0),  # a mobile service with no price yet
    ])

    row = next(r for r in service.list_public_providers() if r["id"] == AMELIA)
    assert row["verifications"] == ["ID", "Insured"]
    assert row["from_price"] == 99  # cheapest priced *live* service
    assert row["price_unit"] == "per hour"
    assert (row["category_name"], row["category_slug"]) == ("Tradie", "tradie")
    assert row["service_count"] == 3  # drafts don't count
    assert row["profiles"] == {"full_name": "Amelia", "avatar_url": None, "location": "Newtown", "state": "NSW",
                               "postcode": "2042"}


def test_get_public_provider_by_slug_and_uuid(strict_schema):
    seed_marketplace(strict_schema)
    assert service.get_public_provider("amelia-plumbing")["id"] == AMELIA
    assert service.get_public_provider(AMELIA)["business_name"] == "Amelia Plumbing"


def test_get_public_provider_hides_unpublished(strict_schema):
    seed_marketplace(strict_schema)
    for reference in ("hidden-co", HIDDEN):
        with pytest.raises(HTTPException) as exc:
            service.get_public_provider(reference)
        assert exc.value.status_code == 404


def test_completed_jobs_count_the_providers_completed_bookings(strict_schema):
    seed_marketplace(strict_schema)
    strict_schema.seed("bookings", [
        booking_row("f0000000-0000-4000-8000-000000000001", AMELIA, CLIENT),
        booking_row("f0000000-0000-4000-8000-000000000002", AMELIA, CLIENT),
        booking_row("f0000000-0000-4000-8000-000000000003", AMELIA, CLIENT, status="new_enquiry"),
        booking_row("f0000000-0000-4000-8000-000000000004", AMELIA, CLIENT, status="cancelled"),
        booking_row("f0000000-0000-4000-8000-000000000005", DANIEL, CLIENT),
    ], schema="web")
    assert service.get_public_provider("amelia-plumbing")["completed_jobs"] == 2


def test_a_mobile_providers_category_reads_as_a_web_code(strict_schema):
    seed_marketplace(strict_schema)
    row = next(r for r in strict_schema.tables["service_provider_profiles"] if r["user_id"] == DANIEL)
    row["metadata"].pop("category")  # the mobile app writes the codes alone
    row["service_categories"] = ["Real-Estate Agent"]  # a row the web wrote before the shared codes
    assert service.get_public_provider(DANIEL)["category"] == "real_estate_agent"
    row["service_categories"] = ["GENERAL"]
    assert service.get_public_provider(DANIEL)["category"] == "other"
    row["service_categories"] = ["GENERAL", "LOCKS_SECURITY"]
    assert service.get_public_provider(DANIEL)["category"] == "tradie"
    # The web category in metadata wins over the codes it was saved with.
    row["metadata"]["category"] = "cleaner"
    assert service.get_public_provider(DANIEL)["category"] == "cleaner"


@pytest.mark.parametrize("category, codes", [
    ("tradie", ["PLUMBING", "ELECTRICAL", "HVAC", "APPLIANCE", "LOCKS_SECURITY", "LEAK", "SAFETY", "GENERAL"]),
    ("property_manager", ["GENERAL", "LEAK", "SAFETY"]),
    ("cleaner", ["GENERAL"]),
    ("photographer", ["GENERAL"]),
])
def test_a_category_change_writes_the_shared_codes_and_keeps_the_web_label(strict_schema, category, codes):
    strict_schema.seed("users", [provider_user(AMELIA)])
    service.create_provider(AMELIA, {"category": "other", "business_name": "Amelia Plumbing"})

    updated = service.update_provider(AMELIA, {"category": category})

    [row] = strict_schema.tables["service_provider_profiles"]
    assert (row["service_categories"], row["metadata"]["category"], updated["category"]) == (codes, category, category)


def test_every_web_category_asks_for_a_trade_licence_and_a_change_keeps_the_review(strict_schema):
    from app.services import verification_rules

    strict_schema.seed("users", [provider_user(AMELIA)])
    service.create_provider(AMELIA, {"category": "real_estate_agent"})
    # An agent's codes are GENERAL alone, and review_profile_document still asks every provider for a
    # trade licence, whatever the category.
    assert "TRADE_LICENCE" in verification_rules.counted_types("SERVICE_PROVIDER")
    [user] = strict_schema.tables["users"]
    before = {key: user.get(key) for key in ("verification_status", "approved_by_user_id", "approved_at")}

    service.update_provider(AMELIA, {"category": "photographer"})

    # Same codes, and the account's verification is left as it was.
    assert strict_schema.tables["service_provider_profiles"][0]["service_categories"] == ["GENERAL"]
    [user] = strict_schema.tables["users"]
    assert {key: user.get(key) for key in before} == before


def test_only_a_web_category_is_saved(client, strict_schema, as_profile):
    strict_schema.seed("users", [provider_user(AMELIA)])
    as_profile(id=AMELIA, role="service_provider")

    assert client.post("/api/v1/me/provider", json={"category": "PLUMBING"}).status_code == 422
    assert client.post("/api/v1/me/provider", json={"category": "tradie"}).status_code == 201
    assert client.patch("/api/v1/me/provider", json={"category": "plumber"}).status_code == 422
    assert strict_schema.tables["service_provider_profiles"][0]["metadata"]["category"] == "tradie"
