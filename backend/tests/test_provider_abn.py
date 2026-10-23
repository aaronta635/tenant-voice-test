"""A provider's ABN (tracker assumption #5): optional, checked with the ABR's checksum.

It is kept in service_provider_profiles.metadata.abn, grouped as the ABR
prints it, and shown on the provider's own profile page, their public page
and their invoices. Only the provider writes it, through PATCH or POST
/me/provider; a number that fails the check is refused and nothing changes.
"""

import pytest

from app.services.maps_provider_core import abn_is_valid, stored_abn
from tests.factories import NOW
from tests.factories_provider_core import category_row, provider_user, seed_provider, service_row

pytestmark = pytest.mark.usefixtures("strict_schema")

NINA = "a3000000-0000-4000-8000-000000000001"
OTHER = "a3000000-0000-4000-8000-000000000002"
TENANT = "a3000000-0000-4000-8000-000000000003"
API = "/api/v1/me/provider"


@pytest.fixture
def nina(strict_schema, as_profile):
    strict_schema.seed("service_categories", [category_row("cleaner")], schema="web")
    seed_provider(strict_schema, NINA, "Nina New", business_name="Nina Cleans", slug="nina-cleans",
                  category="cleaner", mobile_rating_note="kept by the mobile app")
    strict_schema.seed("mobile_provider_services", [service_row("a3000000-0000-4000-8000-0000000000a1", NINA)])
    as_profile(id=NINA, role="service_provider")
    return strict_schema


def _metadata(db, user_id=NINA) -> dict:
    return next(row for row in db.tables["service_provider_profiles"] if row["user_id"] == user_id)["metadata"]


@pytest.mark.parametrize("abn", ["51 824 753 556", "48 123 123 124", "88 000 014 675", "53 004 085 616"])
def test_published_abns_pass_the_check(abn):
    assert abn_is_valid(abn.replace(" ", ""))


@pytest.mark.parametrize("digits", [
    "51824753557",   # one digit off
    "12345678901",   # eleven digits, wrong check digits
    "5182475355",    # ten digits
    "518247535560",  # twelve digits
    "01824753556",   # check digits never start with 0
    "5182475355a",
    "５１８２４７５３５５６",  # full-width digits are not ASCII
])
def test_anything_else_fails_it(digits):
    assert not abn_is_valid(digits)


def test_an_abn_is_kept_grouped_as_the_abr_prints_it():
    assert stored_abn("51824753556") == stored_abn(" 51 824 753 556 ") == "51 824 753 556"
    assert stored_abn("") is None and stored_abn(None) is None
    with pytest.raises(ValueError):
        stored_abn("51-824-753-556")


def test_the_provider_saves_an_abn_that_shows_on_their_pages(client, nina):
    response = client.patch(API, json={"abn": "51824753556"})

    assert response.status_code == 200, response.text
    assert response.json()["abn"] == "51 824 753 556"
    meta = _metadata(nina)
    assert meta["abn"] == "51 824 753 556"
    # The rest of the metadata, the mobile app's keys included, stays.
    assert (meta["mobile_rating_note"], meta["slug"]) == ("kept by the mobile app", "nina-cleans")
    assert client.get(API).json()["abn"] == "51 824 753 556"
    assert client.get("/api/v1/providers/nina-cleans").json()["abn"] == "51 824 753 556"


@pytest.mark.parametrize("abn", ["51 824 753 557", "12345678901", "ABN pending", "5182475355"])
def test_an_abn_that_fails_the_check_is_refused_and_nothing_changes(client, nina, abn):
    before = _metadata(nina)

    response = client.patch(API, json={"abn": abn, "bio": "A new bio that must not save either."})

    assert response.status_code == 422
    assert "ABN is not valid" in response.json()["detail"]
    assert _metadata(nina) == before


def test_a_null_or_blank_abn_clears_it(client, nina):
    client.patch(API, json={"abn": "51 824 753 556"})

    assert client.patch(API, json={"abn": None}).json()["abn"] is None
    client.patch(API, json={"abn": "51 824 753 556"})
    assert client.patch(API, json={"abn": "   "}).json()["abn"] is None


def test_an_abn_another_app_stored_never_blocks_an_unrelated_edit(client, nina):
    rows = nina.tables["service_provider_profiles"]
    rows[0]["metadata"] = {**rows[0]["metadata"], "abn": "PENDING-ABN"}

    response = client.patch(API, json={"bio": "Bond cleans across the Inner West."})

    assert response.status_code == 200, response.text
    assert _metadata(nina)["abn"] == "PENDING-ABN"


def test_onboarding_checks_the_abn_too(client, strict_schema, as_profile):
    strict_schema.seed("users", [provider_user(OTHER, "Omar Other")])
    as_profile(id=OTHER, role="service_provider")

    refused = client.post(API, json={"category": "cleaner", "abn": "51 824 753 557"})
    created = client.post(API, json={"category": "cleaner", "abn": "51824753556"})

    assert refused.status_code == 422
    assert created.status_code == 201, created.text
    assert _metadata(strict_schema, OTHER)["abn"] == "51 824 753 556"


def test_only_a_provider_writes_an_abn(client, nina, as_profile):
    nina.seed("users", [provider_user(TENANT, "Tina Tenant", primary_role="TENANT", updated_at=NOW)])
    as_profile(id=TENANT, role="tenant")

    assert client.patch(API, json={"abn": "51 824 753 556"}).status_code == 403
    assert "abn" not in _metadata(nina)
