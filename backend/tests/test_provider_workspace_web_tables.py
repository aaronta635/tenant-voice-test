"""The provider workspace's web-only tables: portfolio, saved providers and plans (web schema).

Before the port each of these read a public table the shared database lacks
and answered 500 (migration plan §1.2).
"""

import pytest

from tests.factories_provider_core import catalogue_rows, provider_user, seed_provider

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
PROVIDER = "70000000-0000-4000-8000-000000000001"
HIDDEN = "70000000-0000-4000-8000-000000000002"
OWNER = "c0000000-0000-4000-8000-000000000001"


@pytest.fixture
def people(strict_schema):
    seed_provider(strict_schema, PROVIDER, slug="harbour-inspections")
    seed_provider(strict_schema, HIDDEN, slug="hidden-co", published=False)
    strict_schema.seed("users", [provider_user(OWNER, "Olivia Owner", primary_role="LANDLORD")])
    return strict_schema


def _web(db, table):
    return db.schema_tables.get("web", {}).get(table, [])


# -- portfolio ----------------------------------------------------------------
def test_portfolio_items_are_kept_in_web_provider_portfolio(client, people, as_profile):
    as_profile(id=PROVIDER, role="service_provider")
    first = client.post(f"{API}/me/portfolio", json={"image_url": "https://example.test/a.jpg", "title": "Deck",
                                                      "sort_order": 2})
    second = client.post(f"{API}/me/portfolio", json={"image_url": "https://example.test/b.jpg", "sort_order": 1})
    assert first.status_code == second.status_code == 201, first.text

    assert [item["id"] for item in client.get(f"{API}/me/portfolio").json()] == [second.json()["id"], first.json()["id"]]
    edited = client.patch(f"{API}/me/portfolio/{first.json()['id']}", json={"title": "Timber deck"})
    assert (edited.json()["title"], edited.json()["image_url"]) == ("Timber deck", "https://example.test/a.jpg")
    assert len(client.get(f"{API}/providers/harbour-inspections/portfolio").json()) == 2

    assert client.delete(f"{API}/me/portfolio/{second.json()['id']}").status_code == 204
    assert [row["provider_id"] for row in _web(people, "provider_portfolio")] == [PROVIDER]


def test_another_providers_portfolio_item_is_out_of_reach(client, people, as_profile):
    people.seed("provider_portfolio", [{"id": "f1000000-0000-4000-8000-000000000001", "provider_id": HIDDEN,
                                        "image_url": "https://example.test/c.jpg"}], schema="web")
    as_profile(id=PROVIDER, role="service_provider")
    item = "f1000000-0000-4000-8000-000000000001"
    assert client.patch(f"{API}/me/portfolio/{item}", json={"title": "Mine"}).status_code == 404
    assert client.delete(f"{API}/me/portfolio/{item}").status_code == 404


# -- saved providers ------------------------------------------------------------
def test_a_member_saves_a_live_provider_by_slug_and_unsaves_it(client, people, as_profile):
    as_profile(id=OWNER, role="landlord")

    saved = client.post(f"{API}/me/saved-providers", json={"provider_id": "harbour-inspections"})

    assert saved.status_code == 201, saved.text
    assert (saved.json()["user_id"], saved.json()["provider_id"]) == (OWNER, PROVIDER)
    assert [row["provider_id"] for row in client.get(f"{API}/me/saved-providers").json()] == [PROVIDER]
    assert client.post(f"{API}/me/saved-providers", json={"provider_id": PROVIDER}).status_code == 409
    assert client.delete(f"{API}/me/saved-providers/{PROVIDER}").status_code == 204
    assert client.delete(f"{API}/me/saved-providers/{PROVIDER}").status_code == 404
    assert _web(people, "saved_providers") == []


def test_a_provider_saved_by_slug_is_unsaved_by_slug_even_once_offline(client, people, as_profile):
    as_profile(id=OWNER, role="landlord")
    assert client.post(f"{API}/me/saved-providers", json={"provider_id": "harbour-inspections"}).status_code == 201
    # The provider pauses their profile afterwards.
    next(row for row in people.tables["service_provider_profiles"] if row["user_id"] == PROVIDER)["metadata"][
        "is_published"] = False

    assert client.delete(f"{API}/me/saved-providers/harbour-inspections").status_code == 204
    assert _web(people, "saved_providers") == []
    for unknown in ("no-such-provider", "70000000-0000-4000-8000-0000000000ff"):
        assert client.delete(f"{API}/me/saved-providers/{unknown}").status_code == 404


def test_an_unpublished_provider_cannot_be_saved(client, people, as_profile):
    as_profile(id=OWNER, role="landlord")
    assert client.post(f"{API}/me/saved-providers", json={"provider_id": HIDDEN}).status_code == 404
    assert _web(people, "saved_providers") == []


# -- plans and subscriptions ----------------------------------------------------
@pytest.fixture
def plans(people):
    people.seed("subscription_plans", catalogue_rows("subscription_plans"), schema="web")
    return {plan["code"]: plan for plan in _web(people, "subscription_plans")}


def test_plans_are_listed_by_audience_with_the_current_one(client, people, plans, as_profile):
    from app.core.deps import get_optional_profile
    from app.main import app

    owner = as_profile(id=OWNER, role="landlord")
    app.dependency_overrides[get_optional_profile] = lambda: owner  # the plans page reads the caller if signed in
    landlord = client.get(f"{API}/subscription-plans", params={"audience": "landlord"}).json()
    assert [plan["code"] for plan in landlord] == ["owner_basic", "owner_professional", "owner_premium"]
    assert not any(plan["is_current"] for plan in landlord)

    chosen = client.put(f"{API}/me/subscription", json={"plan_id": plans["owner_professional"]["id"]})

    assert chosen.status_code == 200, chosen.text
    assert (chosen.json()["status"], chosen.json()["plan"]["code"]) == ("active", "owner_professional")
    current = [plan["code"] for plan in client.get(f"{API}/subscription-plans").json() if plan["is_current"]]
    assert current == ["owner_professional"]


def test_changing_and_cancelling_a_plan_keeps_one_subscription_row(client, people, plans, as_profile):
    as_profile(id=OWNER, role="landlord")
    client.put(f"{API}/me/subscription", json={"plan_id": plans["owner_basic"]["id"]})
    changed = client.put(f"{API}/me/subscription", json={"plan_id": plans["owner_premium"]["id"]})
    assert changed.json()["plan"]["code"] == "owner_premium"

    cancelled = client.delete(f"{API}/me/subscription")

    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
    [row] = _web(people, "user_subscriptions")
    assert (row["user_id"], row["status"]) == (OWNER, "cancelled")
    assert client.get(f"{API}/me/subscription").json()["plan"]["code"] == "owner_premium"


def test_no_subscription_and_an_unknown_plan(client, people, plans, as_profile):
    as_profile(id=OWNER, role="landlord")
    assert client.get(f"{API}/me/subscription").json() is None
    assert client.delete(f"{API}/me/subscription").status_code == 404
    assert client.put(f"{API}/me/subscription", json={"plan_id": "f0000000-0000-4000-8000-000000000000"}).status_code == 404
