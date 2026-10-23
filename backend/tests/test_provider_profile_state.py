"""What a provider's own profile reports and stores on the shared service_provider_profiles.

Regression cover for the shared-schema adapter, which reported every shared
profile as published, 50% complete, unrated and (without a category) a
tradie; ignored category, tagline, pause and clearing edits; answered 409 to
the onboarding of a provider whose row sign-up had made; and could not go
live or reach 100% because services and credentials lived in tables the
shared database lacks.
"""

import pytest

from tests.factories import NOW
from tests.factories_identity import verify
from tests.factories_provider_core import credential_row, jwt_for, provider_user, review_row, service_row

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
NINA = "70000000-0000-4000-8000-0000000000b1"
CLIENT = "c0000000-0000-4000-8000-0000000000b1"
SERVICE = "e0000000-0000-4000-8000-0000000000b1"


@pytest.fixture
def signed_up(strict_schema, as_profile):
    """A provider straight after registration: the users row and the empty,
    unpublished service_provider_profiles row sign-up makes with it."""
    strict_schema.seed("users", [provider_user(NINA, "Nina New"), provider_user(CLIENT, "Client", primary_role="TENANT")])
    strict_schema.seed("service_provider_profiles", [
        {"user_id": NINA, "verification_status": "PENDING", "metadata": {"is_published": False}, "updated_at": NOW},
    ])
    as_profile(id=NINA, role="service_provider", access_token=jwt_for(strict_schema, NINA))
    return strict_schema


def _row(db):
    return next(row for row in db.tables["service_provider_profiles"] if row["user_id"] == NINA)


def _live_service(db):
    db.seed("mobile_provider_services", [service_row(SERVICE, NINA)])


def test_a_new_provider_is_unpublished_and_has_no_category_yet(client, signed_up):
    mine = client.get(f"{API}/me/provider").json()
    assert mine["category"] is None  # onboarding opens at step 1, not "Tradies"
    assert mine["is_published"] is False
    assert mine["profile_completion"] < 50
    assert client.get(f"{API}/providers").json() == []
    assert client.get(f"{API}/providers/{NINA}").status_code == 404


def test_onboarding_fills_in_the_row_sign_up_made(client, signed_up):
    created = client.post(f"{API}/me/provider", json={"category": "cleaner", "business_name": "Nina Cleans"})

    assert created.status_code == 201, created.text  # not 409: the row already exists
    assert (created.json()["category"], created.json()["slug"], created.json()["is_published"]) == (
        "cleaner", "nina-cleans", False,
    )
    assert len(signed_up.tables["service_provider_profiles"]) == 1
    assert (_row(signed_up)["service_categories"], _row(signed_up)["metadata"]["category"]) == (["GENERAL"], "cleaner")


def test_a_profile_created_in_onboarding_starts_unpublished(client, strict_schema, as_profile):
    strict_schema.seed("users", [provider_user(NINA)])
    as_profile(id=NINA, role="service_provider")
    created = client.post(f"{API}/me/provider", json={"category": "cleaner", "business_name": "Cara Cleans"})
    assert created.status_code == 201, created.text
    assert created.json()["is_published"] is False
    assert client.get(f"{API}/providers").json() == []


def test_a_provider_the_mobile_app_created_stays_listed(client, strict_schema):
    """The mobile app writes service_provider_profiles rows without the web's publish flag."""
    strict_schema.seed("users", [provider_user(NINA, "Mo Bile")])
    strict_schema.seed("service_provider_profiles", [{
        "user_id": NINA, "company_name": "Mobile Cleans", "service_categories": ["cleaner"],
        "verification_status": "PENDING", "metadata": None, "updated_at": NOW,
    }])
    assert [p["id"] for p in client.get(f"{API}/providers").json()] == [NINA]
    assert client.get(f"{API}/providers/{NINA}").status_code == 200


def test_publishing_needs_a_live_service_and_pausing_takes_the_profile_down(client, signed_up):
    client.patch(f"{API}/me/provider", json={"category": "cleaner", "business_name": "Nina Cleans"})
    verify(signed_up, NINA)  # going live needs a verified provider (services/gates.py)
    signed_up.seed("mobile_provider_services", [service_row(SERVICE, NINA, live=False)])
    refused = client.patch(f"{API}/me/provider", json={"is_published": True})
    assert refused.status_code == 400  # a draft service is not enough

    client.patch(f"{API}/me/services/{SERVICE}", json={"is_active": True})
    published = client.patch(f"{API}/me/provider", json={"is_published": True, "is_online": True})
    assert published.status_code == 200
    assert (published.json()["is_published"], published.json()["is_online"]) == (True, True)
    assert [p["id"] for p in client.get(f"{API}/providers").json()] == [NINA]
    assert client.get(f"{API}/providers/nina-cleans").status_code == 200

    paused = client.patch(f"{API}/me/provider", json={"is_published": False})
    assert paused.json()["is_published"] is False
    assert client.get(f"{API}/me/provider").json()["is_published"] is False
    assert client.get(f"{API}/providers").json() == []
    for path in ("", "/services", "/reviews", "/availability", "/portfolio"):
        assert client.get(f"{API}/providers/{NINA}{path}").status_code == 404


def test_category_and_tagline_edits_replace_the_values_set_at_creation(client, signed_up):
    client.post(f"{API}/me/provider", json={"category": "cleaner", "tagline": "Spotless homes"})

    edited = client.patch(f"{API}/me/provider", json={"category": "co_host_inspector", "tagline": "Bond-back reports"})
    assert (edited.json()["category"], edited.json()["tagline"]) == ("co_host_inspector", "Bond-back reports")
    mine = client.get(f"{API}/me/provider").json()
    assert (mine["category"], mine["tagline"]) == ("co_host_inspector", "Bond-back reports")
    row = _row(signed_up)
    assert (row["service_categories"], row["metadata"]["category"], row["pricing_summary"]) == (
        ["GENERAL"], "co_host_inspector", "Bond-back reports",
    )
    assert row["updated_at"] != NOW


def test_completion_follows_the_profile_services_and_documents(client, signed_up):
    def completion():
        return client.get(f"{API}/me/provider").json()["profile_completion"]

    start = completion()
    client.patch(f"{API}/me/provider", json={
        "category": "cleaner", "business_name": "Nina Cleans", "bio": "Ten years of bond cleans.",
        "headline": "Bond cleans", "service_radius_km": 15,
    })
    details = completion()
    _live_service(signed_up)
    signed_up.seed("profile_documents", [credential_row("d0000000-0000-4000-8000-0000000000b1", NINA, "abn",
                                                        status="pending", file_url="")])
    evidence = completion()
    verify(signed_up, NINA)  # going live needs a verified provider (services/gates.py)
    client.patch(f"{API}/me/provider", json={"is_published": True})
    assert start < details < evidence < completion() == 100


def test_ratings_come_from_the_published_and_flagged_reviews(client, signed_up):
    client.patch(f"{API}/me/provider", json={"category": "cleaner", "business_name": "Nina Cleans"})
    _live_service(signed_up)
    verify(signed_up, NINA)  # going live needs a verified provider (services/gates.py)
    client.patch(f"{API}/me/provider", json={"is_published": True})
    signed_up.seed("reviews", [
        review_row(f"b0000000-0000-4000-8000-0000000000b{i}", NINA, CLIENT, rating, status=status)
        for i, (rating, status) in enumerate([(5, "PUBLISHED"), (5, "PUBLISHED"), (4, "FLAGGED"), (1, "HIDDEN"),
                                              (1, "ARCHIVED")])
    ])

    mine = client.get(f"{API}/me/provider").json()
    card = client.get(f"{API}/providers").json()[0]
    profile = client.get(f"{API}/providers/{NINA}").json()
    for summary in (mine, card, profile):
        assert (summary["rating_avg"], summary["review_count"]) == (4.67, 3)


def test_null_clears_a_profile_field_but_not_a_required_one(client, signed_up):
    client.patch(f"{API}/me/provider", json={
        "category": "cleaner", "business_name": "Nina Cleans", "website": "https://old.example",
        "tagline": "Old tagline", "headline": "Old headline", "bio": "Old bio text", "availability_note": "Weekdays",
    })
    cleared = client.patch(f"{API}/me/provider", json={
        "website": None, "tagline": None, "headline": None, "bio": None, "availability_note": None, "category": None,
    })
    assert cleared.status_code == 200
    mine = client.get(f"{API}/me/provider").json()
    for field in ("website", "tagline", "headline", "bio", "availability_note"):
        assert cleared.json()[field] is None and mine[field] is None
    assert mine["category"] == "cleaner"
    assert mine["business_name"] == "Nina Cleans"


def test_a_provider_without_a_row_gets_404_then_onboards(client, strict_schema, as_profile):
    strict_schema.seed("users", [provider_user(NINA)])
    as_profile(id=NINA, role="service_provider")

    assert client.get(f"{API}/me/provider").status_code == 404  # "Start onboarding", not a 500
    assert client.post(f"{API}/me/provider", json={"category": "cleaner"}).status_code == 201
    # Naming the business replaces the placeholder slug.
    named = client.patch(f"{API}/me/provider", json={"business_name": "Shared Only Co"})
    assert named.status_code == 200
    assert named.json()["slug"] == "shared-only-co"
    assert client.get(f"{API}/me/provider").json()["business_name"] == "Shared Only Co"


def test_naming_a_signed_up_provider_gives_it_a_slug(client, signed_up):
    named = client.patch(f"{API}/me/provider", json={"category": "cleaner", "business_name": "Nina Cleans"})
    assert named.json()["slug"] == "nina-cleans"
    assert _row(signed_up)["metadata"]["slug"] == "nina-cleans"
