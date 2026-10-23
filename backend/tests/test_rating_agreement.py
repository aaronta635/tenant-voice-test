"""One rating wherever a profile appears (tracker R23).

A provider's marketplace card and page, the public profile search and page,
and the signed-in profile search must give the same average and count, from
the same reviews, and the same verified badge. Before this, the public
profiles counted PUBLISHED reviews only while the marketplace also counts
FLAGGED ones, and the signed-in search (the Search profiles and
Recommendations pages) sent no rating at all, so the rating a member saw on
a card was gone in those lists.
"""

import pytest

from app.services import public_profiles, service_providers
from tests.factories_messaging import person
from tests.factories_provider_core import provider_profile, provider_user, review_row
from tests.schema_variants import max_rows  # noqa: F401 (fixture)

pytestmark = pytest.mark.usefixtures("strict_schema")

PROVIDER = "71000000-0000-4000-8000-000000000001"
LANDLORD = "72000000-0000-4000-8000-000000000001"
VIEWER = "73000000-0000-4000-8000-000000000001"
REVIEWER = "74000000-0000-4000-8000-000000000001"
SLUG = "harbour-plumbing"
API = "/api/v1"


@pytest.fixture(autouse=True)
def fresh_scans(monkeypatch):
    """Each public search reads the fake again: the scan cache outlives a test."""
    monkeypatch.setattr(public_profiles, "_scans", {})
    monkeypatch.setattr(public_profiles, "SCAN_TTL_SECONDS", 0)


def review_id(number: int) -> str:
    return f"b7000000-0000-4000-8000-{number:012d}"


@pytest.fixture
def members(strict_schema, as_profile):
    strict_schema.seed("users", [
        provider_user(PROVIDER, "Hana Harbour", location="Newtown", state="NSW", verification_status="APPROVED"),
        person(LANDLORD, "LANDLORD", "Lena Landlord", location="Glebe"),
        person(VIEWER, "TENANT", "Vic Viewer"),
        person(REVIEWER, "TENANT", "Rae Reviewer"),
    ])
    strict_schema.seed("service_provider_profiles", [
        provider_profile(PROVIDER, business_name="Harbour Plumbing", slug=SLUG),
    ])
    # Published and flagged reviews count; hidden and archived ones never do.
    strict_schema.seed("reviews", [
        review_row(review_id(number), about, REVIEWER, rating, status=status)
        for number, (about, rating, status) in enumerate([
            (PROVIDER, 5, "PUBLISHED"), (PROVIDER, 4, "PUBLISHED"), (PROVIDER, 3, "FLAGGED"),
            (PROVIDER, 1, "HIDDEN"), (PROVIDER, 1, "ARCHIVED"),
            (LANDLORD, 5, "PUBLISHED"), (LANDLORD, 2, "FLAGGED"), (LANDLORD, 1, "HIDDEN"),
        ])
    ])
    as_profile(id=VIEWER, role="tenant")
    return strict_schema


def _get(client, path, **params):
    response = client.get(f"{API}{path}", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _rating(item: dict) -> tuple:
    return item["rating_avg"], item["review_count"]


def test_the_rating_counts_the_same_review_statuses_everywhere():
    assert public_profiles.RATED_STATUSES == service_providers.COUNTED_REVIEW_STATUSES == ["PUBLISHED", "FLAGGED"]


def test_a_providers_card_page_and_searches_agree(client, members):
    [card] = [item for item in _get(client, "/providers") if item["id"] == PROVIDER]
    page = _get(client, f"/providers/{SLUG}")
    listed = _get(client, f"/providers/{SLUG}/reviews")
    [search_card] = _get(client, "/public/profiles", role="provider")["items"]
    profile = _get(client, f"/public/profiles/{PROVIDER}")
    [network_card] = [item for item in _get(client, "/profiles/search") if item["id"] == PROVIDER]

    assert _rating(card) == _rating(page) == (4.0, 3) == (4.0, len(listed))
    assert _rating(search_card) == _rating(profile) == _rating(network_card) == (4.0, 3)
    assert len(profile["reviews"]) == 3
    assert search_card["verified"] is profile["verified"] is network_card["verified"] is True


def test_a_landlords_cards_and_profile_agree(client, members):
    [search_card] = _get(client, "/public/profiles", role="landlord")["items"]
    profile = _get(client, f"/public/profiles/{LANDLORD}")
    [network_card] = [item for item in _get(client, "/profiles/search") if item["id"] == LANDLORD]

    assert _rating(search_card) == _rating(profile) == _rating(network_card) == (3.5, 2)
    assert [review["rating"] for review in profile["reviews"]] == [5, 2]
    assert search_card["verified"] is network_card["verified"] is False


def test_a_member_without_reviews_has_no_rating_in_the_network_search(client, members):
    [card] = [item for item in _get(client, "/profiles/search") if item["id"] == REVIEWER]

    assert (card["rating_avg"], card["review_count"], card["verified"]) == (None, 0, False)


def test_trust_of_reads_every_review_when_postgrest_answers_fewer_rows_than_asked(strict_schema, max_rows):
    # max_rows answers each select with one row: a count must not stop at the first page.
    strict_schema.seed("users", [{**person(LANDLORD, "LANDLORD", "Lena Landlord"), "verification_status": "APPROVED"}])
    strict_schema.seed("reviews", [review_row(review_id(number), LANDLORD, REVIEWER, 4) for number in range(5)])

    assert public_profiles.trust_of([LANDLORD, "not-a-user", LANDLORD]) == {
        LANDLORD: {"rating_avg": 4.0, "review_count": 5, "verified": True},
    }
