"""Marketplace categories: the web.service_categories catalogue with live totals."""

from fastapi import HTTPException
import pytest

from app.services import categories as service
from app.services import service_providers
from tests.factories_provider_core import catalogue_rows, category_row, seed_provider, service_row

pytestmark = pytest.mark.usefixtures("strict_schema")

WEB_TRADIE = "a0000000-0000-4000-8000-000000000001"
SECOND_TRADIE = "a0000000-0000-4000-8000-000000000002"
DRAFT_TRADIE = "a0000000-0000-4000-8000-000000000003"
MOBILE_CLEANER = "a0000000-0000-4000-8000-000000000004"
UNCATEGORISED = "a0000000-0000-4000-8000-000000000005"


def service_id(n: int) -> str:
    return f"e0000000-0000-4000-8000-{n:012d}"


def seed(db):
    db.seed("service_categories", [
        category_row("tradie", sort_order=2),
        category_row("cleaner", sort_order=1),
        category_row("accountant", is_active=False),
    ], schema="web")
    seed_provider(db, WEB_TRADIE, slug="web-tradie")
    seed_provider(db, SECOND_TRADIE, slug="second-tradie")
    seed_provider(db, DRAFT_TRADIE, slug="draft-tradie", published=False)
    seed_provider(db, MOBILE_CLEANER, category="cleaner")
    seed_provider(db, UNCATEGORISED, category=None)
    # A row without the web's metadata: written before the shared codes, its category is the web's.
    legacy = next(row for row in db.tables["service_provider_profiles"] if row["user_id"] == MOBILE_CLEANER)
    legacy.update(metadata=None, service_categories=["cleaner"])
    db.seed("mobile_provider_services", [
        service_row(service_id(1), WEB_TRADIE, price=200),
        service_row(service_id(2), SECOND_TRADIE, price=80),
        service_row(service_id(3), SECOND_TRADIE, price=5, live=False),  # a draft sets no price
        service_row(service_id(4), DRAFT_TRADIE, price=10),  # nor does an unpublished provider
        service_row(service_id(5), MOBILE_CLEANER, price=0),  # a mobile service with no price yet
        service_row(service_id(6), MOBILE_CLEANER, price=120),
    ])


def test_list_categories_orders_and_hides_inactive(strict_schema):
    seed(strict_schema)
    assert [row["category"] for row in service.list_categories()] == ["cleaner", "tradie"]


def test_list_categories_aggregates_counts_and_from_price(strict_schema):
    seed(strict_schema)
    rows = {row["category"]: row for row in service.list_categories()}

    assert (rows["tradie"]["provider_count"], rows["tradie"]["from_price"]) == (2, 80)
    # The mobile row has no publish flag and is listed; the draft is not.
    assert (rows["cleaner"]["provider_count"], rows["cleaner"]["from_price"]) == (1, 120)


def test_category_counts_match_the_providers_each_category_lists(strict_schema):
    seed(strict_schema)
    for row in service.list_categories():
        listed = service_providers.list_public_providers(category=row["slug"], limit=100)
        assert row["provider_count"] == len(listed), row["category"]


def test_category_routes_total_the_listed_providers(client, strict_schema):
    # The landing page, /categories and each category page load these first
    # and show an error card if either fails.
    seed(strict_schema)
    expected = {"cleaner": (1, 120), "tradie": (2, 80)}

    listed = client.get("/api/v1/categories")
    assert listed.status_code == 200, listed.text
    assert {row["slug"]: (row["provider_count"], row["from_price"]) for row in listed.json()} == expected
    for slug, totals in expected.items():
        page = client.get(f"/api/v1/categories/{slug}")
        assert page.status_code == 200, page.text
        assert (page.json()["provider_count"], page.json()["from_price"]) == totals
    assert client.get("/api/v1/categories/accountant").status_code == 404  # inactive


def test_get_category_by_slug(strict_schema):
    seed(strict_schema)
    assert service.get_category("tradie")["category"] == "tradie"
    with pytest.raises(HTTPException) as exc:
        service.get_category("no-such-slug")
    assert exc.value.status_code == 404


def test_code_for_reads_a_slug_or_a_code(strict_schema):
    strict_schema.seed("service_categories", [category_row("real_estate_agent")], schema="web")
    assert service.code_for("real-estate-agent") == "real_estate_agent"
    assert service.code_for("real_estate_agent") == "real_estate_agent"
    assert service.code_for("unknown") is None
    assert service.code_for(None) is None


def test_the_seeded_catalogue_is_listed_in_order(client, strict_schema):
    strict_schema.seed("service_categories", catalogue_rows("service_categories"), schema="web")
    listed = client.get("/api/v1/categories").json()
    assert [row["slug"] for row in listed][:3] == ["co-host-inspector", "real-estate-agent", "real-estate-accountant"]
    assert len(listed) == 9 and listed[0]["badge"] == "NEW"
