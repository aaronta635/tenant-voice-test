"""The marketplace shows a provider only while its owner's account is ACTIVE and open (tracker R18, assumption #14).

Public profiles already list only those members. Here the marketplace does
too: its lists, search and category counts leave a suspended, deactivated,
pending or closed account's provider out, and its page and the page's
reviews, services, hours and portfolio answer 404, by id or slug. Nobody
can book or save it. The provider's own workspace still reads it.
"""

import pytest

from app.services import public_profiles, service_providers
from tests.factories import NOW, make_availability
from tests.factories_bookings import person, service, uid, web_rows
from tests.factories_provider_core import category_row, provider_profile, review_row

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
PAT, OTHER, TINA, FIX = uid("pat"), uid("olga"), uid("tina"), uid("fix-tap")
HIDING = [{"status": "SUSPENDED"}, {"status": "DEACTIVATED"}, {"status": "PENDING_VERIFICATION"}, {"deleted_at": NOW}]


@pytest.fixture(autouse=True)
def fresh_scans(monkeypatch):
    monkeypatch.setattr(public_profiles, "_scans", {})
    monkeypatch.setattr(public_profiles, "SCAN_TTL_SECONDS", 0)


@pytest.fixture
def db(strict_schema):
    strict_schema.seed("service_categories", [category_row("tradie")], schema="web")
    strict_schema.seed("users", [
        person(PAT, "Pat Plumber", "SERVICE_PROVIDER"),
        person(OTHER, "Olga Other", "SERVICE_PROVIDER"),
        person(TINA, "Tina Tenant"),
    ])
    strict_schema.seed("service_provider_profiles", [
        provider_profile(PAT, "Pat's Plumbing", slug="pats-plumbing"),
        provider_profile(OTHER, "Other Co", slug="other-co"),
    ])
    strict_schema.seed("mobile_provider_services", [service(FIX, PAT, "Fix a tap", price=150)])
    strict_schema.seed("reviews", [review_row(uid("review"), PAT, TINA, 5, body="Quick and tidy")])
    strict_schema.seed("provider_availability", [make_availability(PAT, 1, id=uid("hours"))], schema="web")
    strict_schema.seed("provider_portfolio", [
        {"id": uid("photo"), "provider_id": PAT, "image_url": "https://example.test/tap.jpg", "title": "Tap"},
    ], schema="web")
    return strict_schema


def hide(db, over):
    """Pat's account as an admin (or the mobile app) left it."""
    next(row for row in db.tables["users"] if row["id"] == PAT).update(over)


def listed(client, **params):
    response = client.get(f"{API}/providers", params=params)
    assert response.status_code == 200, response.text
    return [provider["id"] for provider in response.json()]


@pytest.mark.parametrize("over", HIDING)
def test_lists_search_and_counts_leave_out_a_provider_whose_account_is_not_active(client, db, over):
    # Best rated first: Pat has a five-star review.
    assert listed(client) == [PAT, OTHER]
    assert listed(client, search="plumbing") == [PAT]
    tradies = client.get(f"{API}/categories").json()[0]
    assert (tradies["provider_count"], tradies["from_price"]) == (2, 150)

    hide(db, over)

    assert listed(client) == [OTHER]
    assert listed(client, search="plumbing") == []
    assert listed(client, category="tradie") == [OTHER]
    tradies = client.get(f"{API}/categories").json()[0]
    assert (tradies["category"], tradies["provider_count"], tradies["from_price"]) == ("tradie", 1, None)
    # The profile search agrees.
    found = client.get(f"{API}/public/profiles", params={"role": "provider"}).json()
    assert [item["id"] for item in found["items"]] == [OTHER]


@pytest.mark.parametrize("path", ["", "/reviews", "/services", "/availability", "/portfolio", "/busy-times"])
@pytest.mark.parametrize("ref", [PAT, "pats-plumbing"])
def test_its_pages_answer_404_by_id_or_slug(client, db, path, ref):
    assert client.get(f"{API}/providers/{ref}{path}").status_code == 200

    hide(db, {"status": "SUSPENDED"})

    assert client.get(f"{API}/providers/{ref}{path}").status_code == 404
    assert client.get(f"{API}/public/profiles/{PAT}").status_code == 404


def test_nobody_books_or_saves_it(client, db, as_profile):
    hide(db, {"status": "SUSPENDED"})
    as_profile(TINA, "tenant")

    request = {"provider_id": PAT, "service_id": FIX, "scheduled_date": "2031-03-04", "scheduled_time": "10:00:00"}
    booked = client.post(f"{API}/bookings", json=request)
    saved = client.post(f"{API}/me/saved-providers", json={"provider_id": "pats-plumbing"})

    assert (booked.status_code, booked.json()["detail"]) == (404, "Service provider not found")
    assert saved.status_code == 404
    assert not web_rows(db, "bookings") and not web_rows(db, "saved_providers")


def test_its_own_workspace_still_reads_it(client, db):
    hide(db, {"status": "SUSPENDED"})

    assert service_providers.get_provider_by_profile_id(PAT)["business_name"] == "Pat's Plumbing"
    # An id still resolves for unsaving, published or not.
    assert service_providers.provider_id_for("pats-plumbing") == PAT
