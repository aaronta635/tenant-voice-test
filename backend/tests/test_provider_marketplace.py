"""The public marketplace lists and opens the shared database's providers.

Regression cover for the shared-schema adapter: the list ignored location,
min_rating and sort, and category URL slugs matched nothing. Cards carried no
owner location. Slugs could repeat or be missed past the first page of rows,
and a slug shaped like a uuid reached a uuid column. Providers tied on the
sort came back in a different order per request, so offset pages repeated
some and skipped others. The categories lived in a table the shared database
lacks, so every list and profile request failed with 500.
"""

import pytest

from tests.factories_provider_core import (
    category_row, provider_user, review_row, seed_provider, service_row,
)
from tests.schema_variants import max_rows  # noqa: F401 (fixture)

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1/providers"
HIGH = "70000000-0000-4000-8000-0000000000c1"
NEW = "70000000-0000-4000-8000-0000000000c2"
DRAFT = "70000000-0000-4000-8000-0000000000c3"
RATED = "70000000-0000-4000-8000-0000000000c4"
CLIENT = "c0000000-0000-4000-8000-0000000000c1"


@pytest.fixture
def marketplace(strict_schema):
    strict_schema.seed("service_categories", [
        category_row("co_host_inspector"), category_row("real_estate_agent"), category_row("tradie"),
    ], schema="web")
    seed_provider(strict_schema, HIGH, "Hana High", location="Newtown", state="NSW", postcode="2042",
                  business_name="Harbour Inspections", slug="harbour-inspections", category="co_host_inspector",
                  created_at="2026-03-01T00:00:00+00:00")
    seed_provider(strict_schema, NEW, "Ned New", location="Parramatta", state="NSW", postcode="2150",
                  business_name="Western Agents", slug="western-agents", category="real_estate_agent",
                  created_at="2026-06-01T00:00:00+00:00")
    seed_provider(strict_schema, DRAFT, "Dora Draft", location="Newtown", business_name="Draft Co", slug="draft-co",
                  category="co_host_inspector", published=False, created_at="2026-07-01T00:00:00+00:00")
    seed_provider(strict_schema, RATED, "Rita Rated", location="Marrickville", state="NSW", postcode="2204",
                  business_name="Rated Plumbing", slug="rated-plumbing", created_at="2026-01-01T00:00:00+00:00")
    strict_schema.seed("users", [provider_user(CLIENT, "Client", primary_role="TENANT")])
    strict_schema.seed("reviews", [
        *(review_row(f"b0000000-0000-4000-8000-00000000000{i}", HIGH, CLIENT, 5) for i in range(2)),
        *(review_row(f"b0000000-0000-4000-8000-00000000001{i}", RATED, CLIENT, rating) for i, rating in
          enumerate([5, 4, 4, 4, 4])),
    ])
    strict_schema.seed("mobile_provider_services", [
        service_row("e0000000-0000-4000-8000-0000000000c1", HIGH),
        service_row("e0000000-0000-4000-8000-0000000000c2", RATED),
    ])
    return strict_schema


def _ids(response):
    assert response.status_code == 200, response.text
    return [provider["id"] for provider in response.json()]


def test_providers_are_listed_with_their_owners_public_details(client, marketplace):
    cards = {card["id"]: card for card in client.get(API).json()}
    assert set(cards) == {HIGH, NEW, RATED}  # the draft stays private
    assert cards[HIGH]["profiles"] == {
        "full_name": "Hana High", "avatar_url": None, "location": "Newtown", "state": "NSW", "postcode": "2042",
        "phone": None,  # the owner's phone number is not public
    }
    assert cards[HIGH]["category_name"] == "Co Host Inspector"
    assert client.get(f"{API}/draft-co").status_code == 404


def test_location_matches_the_owners_suburb_state_or_postcode(client, marketplace):
    assert _ids(client.get(API, params={"location": "2042"})) == [HIGH]
    assert _ids(client.get(API, params={"location": "marrickville"})) == [RATED]
    assert _ids(client.get(API, params={"location": "Zzyzx"})) == []


@pytest.mark.parametrize("category", ["co-host-inspector", "co_host_inspector"])
def test_category_accepts_the_url_slug_or_the_code(client, marketplace, category):
    assert _ids(client.get(API, params={"category": category})) == [HIGH]


def test_an_unknown_category_lists_nobody(client, marketplace):
    assert _ids(client.get(API, params={"category": "astronaut"})) == []


def test_rating_filter_sort_and_paging(client, marketplace):
    assert _ids(client.get(API, params={"min_rating": 4.5})) == [HIGH]
    assert _ids(client.get(API)) == [HIGH, RATED, NEW]  # 5.0, 4.2, unrated
    assert _ids(client.get(API, params={"sort": "reviews"})) == [RATED, HIGH, NEW]
    assert _ids(client.get(API, params={"sort": "newest"})) == [NEW, HIGH, RATED]
    assert _ids(client.get(API, params={"limit": 1, "offset": 1})) == [RATED]


@pytest.mark.parametrize("sort", ["rating", "reviews", "newest"])
def test_offset_pages_over_tied_providers_list_each_provider_once(client, strict_schema, sort):
    # Unreviewed providers all rate 0 and these were created together, so every
    # sort ties. Postgres returns tied rows in no fixed order: here each request
    # reads the table in the opposite order to the request before.
    ids = [f"50000000-0000-4000-8000-0000000000e{n}" for n in range(6)]
    top = "50000000-0000-4000-8000-0000000000e9"  # rated, reviewed and newest
    for n, user in enumerate(ids):
        seed_provider(strict_schema, user, slug=f"provider-{n}")
    seed_provider(strict_schema, top, slug="provider-top", created_at="2026-02-01T00:00:00+00:00")
    strict_schema.seed("users", [provider_user(CLIENT, primary_role="TENANT")])
    strict_schema.seed("reviews", [review_row("b0000000-0000-4000-8000-0000000000e1", top, CLIENT, 5)])
    listed = []
    for offset in (0, 2, 4, 6):
        strict_schema.tables["service_provider_profiles"].reverse()
        listed += _ids(client.get(API, params={"sort": sort, "limit": 2, "offset": offset}))
    assert listed == [top] + sorted(ids)


def test_search_matches_the_business_name_tagline_and_bio(client, marketplace):
    assert _ids(client.get(API, params={"search": "harbour"})) == [HIGH]
    assert _ids(client.get(API, params={"search": "PLUMBING"})) == [RATED]
    row = next(row for row in marketplace.tables["service_provider_profiles"] if row["user_id"] == NEW)
    row["metadata"]["bio"] = "Leasing and sales in Western Sydney."
    assert _ids(client.get(API, params={"search": "leasing"})) == [NEW]
    assert _ids(client.get(API, params={"search": "a,b)(%"})) == []  # never reaches the filter as syntax


def test_a_stale_metadata_name_is_not_searched(client, marketplace):
    # The mobile app renames a business in company_name and leaves the web's metadata copy.
    row = next(row for row in marketplace.tables["service_provider_profiles"] if row["user_id"] == HIGH)
    row["metadata"]["business_name"] = "Old Name Pty"
    assert _ids(client.get(API, params={"search": "old name"})) == []


def test_providers_with_the_same_name_get_distinct_slugs(client, strict_schema, as_profile, marketplace):
    others = ["70000000-0000-4000-8000-0000000000d1", "70000000-0000-4000-8000-0000000000d2"]
    strict_schema.seed("users", [provider_user(user) for user in others])
    slugs = []
    for user, name in zip(others, ["Harbour Inspections", "Harbour Inspections"]):
        as_profile(id=user, role="service_provider")
        slugs.append(client.post("/api/v1/me/provider", json={"category": "tradie", "business_name": name}).json()["slug"])
    assert slugs == ["harbour-inspections-2", "harbour-inspections-3"]
    assert client.get(f"{API}/harbour-inspections").json()["id"] == HIGH


def test_slugs_are_matched_by_the_database_not_by_reading_every_row(client, strict_schema, as_profile, marketplace,
                                                                    max_rows):
    # Only the first row fits in a capped response; a later one must still
    # open by slug and keep its slug when a namesake signs up.
    assert client.get(f"{API}/western-agents").json()["id"] == NEW
    user = "70000000-0000-4000-8000-0000000000d3"
    strict_schema.seed("users", [provider_user(user)])
    as_profile(id=user, role="service_provider")
    created = client.post("/api/v1/me/provider", json={"category": "tradie", "business_name": "Western Agents"})
    assert created.json()["slug"] == "western-agents-2"


@pytest.mark.parametrize("ref", ["harbour-inspections", HIGH, "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"])
def test_a_slug_never_reaches_a_uuid_column(client, marketplace, ref):
    # Strict mode fails a non-uuid sent to a uuid column with 22P02 (a 400).
    expected = 404 if ref.startswith("zzz") else 200
    for path in ("", "/services", "/reviews", "/availability", "/portfolio"):
        assert client.get(f"{API}/{ref}{path}").status_code == expected, path
    assert client.get(API, params={"location": "NSW", "category": "co-host-inspector"}).status_code == 200


def test_the_listing_reads_every_provider_when_max_rows_is_below_the_page_size(client, strict_schema, max_rows):
    # Every response holds one row, below _common.PAGE_SIZE: a short page is not the last one.
    ids = [f"50000000-0000-4000-8000-0000000000e{n}" for n in range(3)]
    for n, user in enumerate(ids):
        seed_provider(strict_schema, user, slug=f"capped-{n}")
    assert sorted(_ids(client.get(API, params={"limit": 100}))) == ids


def test_the_listing_reads_every_page_of_providers(client, strict_schema, monkeypatch):
    # PostgREST caps a select at max-rows (_common.PAGE_SIZE): a provider past
    # the first page must still be listed and counted.
    from app.services import _common

    monkeypatch.setattr(_common, "PAGE_SIZE", 2)
    ids = [f"50000000-0000-4000-8000-0000000000f{n}" for n in range(5)]
    for n, user in enumerate(ids):
        seed_provider(strict_schema, user, slug=f"paged-{n}")
    assert sorted(_ids(client.get(API, params={"limit": 100}))) == ids
    assert _ids(client.get(API, params={"sort": "newest", "limit": 1, "offset": 4})) == [ids[4]]
