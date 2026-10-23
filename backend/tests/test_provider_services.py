"""A provider's services as the shared mobile_provider_services rows (migration plan §3 b1).

The web writes them only through mobile_create_provider_service,
mobile_update_provider_service and mobile_delete_provider_service, run as the
provider (their JWT), so both apps keep one set of rules: the status is
active, draft or archived, the price type flat, hourly or from, the category
one of the eight shared codes, and an active service needs a description and
a price above 0. The form's fields map onto the function's keys and back:
inclusions are a JSON list, the duration is text, is_active is the status.
The table has no sort order or cancellation policy, so services keep their
creation order and the policy is kept on the provider's profile.
"""

import pytest

from app.services import provider_services as service
from tests.factories import NOW
from tests.factories_provider_core import booking_row, jwt_for, provider_user, seed_provider, service_row

pytestmark = pytest.mark.usefixtures("strict_schema")

PROVIDER = "a0000000-0000-4000-8000-000000000001"
OTHER = "a0000000-0000-4000-8000-000000000002"
CLIENT = "c0000000-0000-4000-8000-000000000001"
FIRST = "e0000000-0000-4000-8000-000000000001"
SECOND = "e0000000-0000-4000-8000-000000000002"
FOREIGN = "e0000000-0000-4000-8000-000000000003"
API = "/api/v1"
GUTTERS = {"title": "Gutter clean", "price": 120, "description": "Both levels, downpipes flushed."}


@pytest.fixture
def providers(strict_schema):
    seed_provider(strict_schema, PROVIDER, business_name="Amelia Plumbing")
    seed_provider(strict_schema, OTHER, business_name="Other Co")
    strict_schema.seed("users", [provider_user(CLIENT, primary_role="TENANT")])
    return strict_schema


@pytest.fixture
def amelia(providers, as_profile):
    """Requests as the provider, with the token their shared functions run on."""
    return as_profile(id=PROVIDER, role="service_provider", access_token=jwt_for(providers, PROVIDER))


def _stored(db, service_id):
    return next(row for row in db.tables["mobile_provider_services"] if row["id"] == service_id)


def test_list_my_services_keeps_creation_order_and_counts_bookings(providers):
    providers.seed("mobile_provider_services", [
        service_row(SECOND, PROVIDER, created_at="2026-02-01T00:00:00+00:00"),
        service_row(FIRST, PROVIDER, created_at="2026-01-01T00:00:00+00:00", live=False),
        service_row(FOREIGN, OTHER),
    ])
    providers.seed("bookings", [
        booking_row("f0000000-0000-4000-8000-000000000001", PROVIDER, CLIENT, service_id=SECOND),
        booking_row("f0000000-0000-4000-8000-000000000002", PROVIDER, CLIENT, service_id=SECOND, status="new_enquiry"),
        booking_row("f0000000-0000-4000-8000-000000000003", OTHER, CLIENT, service_id=FOREIGN),
    ], schema="web")

    rows = service.list_my_services(PROVIDER)

    assert [(row["id"], row["sort_order"], row["is_active"]) for row in rows] == [(FIRST, 1, False), (SECOND, 2, True)]
    assert {row["id"]: row["booking_count"] for row in rows} == {FIRST: 0, SECOND: 2}


def test_a_new_service_is_created_by_the_shared_function_as_the_provider(client, providers, amelia):
    response = client.post(f"{API}/me/services", json={
        **GUTTERS, "pricing_type": "hourly", "duration_minutes": 90, "category": "LEAK",
        "inclusions": "Ladder work\n\nDownpipes \nLadder work", "service_area": "  Inner West ",
    })

    assert response.status_code == 201, response.text
    created = response.json()
    assert providers.rpc_callers[-1] == ("mobile_create_provider_service", providers.tokens[amelia.access_token])
    row = _stored(providers, created["id"])
    assert (row["provider_user_id"], row["status"], row["category"], row["pricing_type"]) == (
        PROVIDER, "active", "LEAK", "hourly",
    )
    # The function cleans the lists (mobile_service_clean_list) and trims the text.
    assert (row["duration"], row["inclusions"], row["exclusions"], row["service_area"]) == (
        "90 minutes", ["Ladder work", "Downpipes"], [], "Inner West",
    )
    assert created == {**created, "provider_id": PROVIDER, "duration_minutes": 90, "inclusions": "Ladder work\nDownpipes",
                       "exclusions": None, "category": "LEAK", "is_active": True, "sort_order": 1, "booking_count": 0}


def test_a_draft_needs_only_a_title_and_takes_the_general_category(client, providers, amelia):
    created = client.post(f"{API}/me/services", json={"title": "Gutter clean", "price": 0, "is_active": False}).json()

    row = _stored(providers, created["id"])
    assert (row["status"], row["category"], row["price"], row["description"]) == ("draft", "GENERAL", 0, "")
    assert (row["inclusions"], row["exclusions"]) == ([], [])
    assert created["is_active"] is False


@pytest.mark.parametrize("payload, message", [
    ({"title": "Gutter clean", "price": 120}, "Add a description before making the service active."),
    ({**GUTTERS, "price": 0}, "Add a price before making the service active."),
])
def test_an_active_service_needs_a_description_and_a_price(client, providers, amelia, payload, message):
    response = client.post(f"{API}/me/services", json=payload)

    assert (response.status_code, response.json()["detail"]) == (422, message)
    assert providers.tables.get("mobile_provider_services", []) == []


def test_a_provider_keeps_at_most_fifty_services(client, providers, amelia):
    providers.seed("mobile_provider_services", [
        service_row(f"e1000000-0000-4000-8000-{index:012d}", PROVIDER, live=index % 2 == 0) for index in range(50)
    ] + [service_row(FOREIGN, PROVIDER, status="archived")])

    response = client.post(f"{API}/me/services", json=GUTTERS)

    assert (response.status_code, response.json()["detail"]) == (
        422, "You can have at most 50 services. Remove one first.",
    )
    client.delete(f"{API}/me/services/e1000000-0000-4000-8000-000000000001")
    assert client.post(f"{API}/me/services", json=GUTTERS).status_code == 201


def test_the_cancellation_policy_is_kept_on_the_providers_profile(client, providers, amelia):
    created = client.post(f"{API}/me/services", json={
        **GUTTERS, "cancellation_policy": "Free up to 24 hours before.",
    }).json()

    profile = next(r for r in providers.tables["service_provider_profiles"] if r["user_id"] == PROVIDER)
    assert profile["metadata"]["service_extras"] == {created["id"]: {"cancellation_policy": "Free up to 24 hours before."}}
    assert profile["metadata"]["slug"] == PROVIDER  # the rest of the profile is kept
    assert created["cancellation_policy"] == "Free up to 24 hours before."
    assert client.get(f"{API}/providers/{PROVIDER}/services").json()[0]["cancellation_policy"] == (
        "Free up to 24 hours before."
    )

    client.delete(f"{API}/me/services/{created['id']}")
    profile = next(r for r in providers.tables["service_provider_profiles"] if r["user_id"] == PROVIDER)
    assert profile["metadata"]["service_extras"] == {}


def test_the_service_form_clears_fields_it_sends_as_null(client, providers, amelia):
    created = client.post(f"{API}/me/services", json={
        **GUTTERS, "duration_minutes": 60, "inclusions": "Ladder work", "service_area": "Inner West",
        "cancellation_policy": "24 hours", "is_active": False,
    }).json()

    cleared = client.patch(f"{API}/me/services/{created['id']}", json={
        "title": "Gutter clean", "price": 120, "description": None, "duration_minutes": None, "inclusions": None,
        "service_area": None, "cancellation_policy": None, "is_active": False,
    })

    assert cleared.status_code == 200, cleared.text
    body = cleared.json()
    for field in ("description", "duration_minutes", "inclusions", "service_area", "cancellation_policy"):
        assert body[field] is None, field
    row = _stored(providers, created["id"])
    assert (row["description"], row["duration"], row["inclusions"], row["service_area"]) == ("", "", [], "")
    assert row["updated_at"] != created["updated_at"]


def test_a_partial_update_keeps_the_other_fields(client, providers, amelia):
    # The services page switches a service off with {"is_active": false} alone.
    providers.seed("mobile_provider_services", [service_row(FIRST, PROVIDER, inclusions=["Travel"], category="HVAC")])

    paused = client.patch(f"{API}/me/services/{FIRST}", json={"is_active": False}).json()

    assert (paused["is_active"], paused["inclusions"], paused["description"], paused["category"]) == (
        False, "Travel", "A standard job.", "HVAC",
    )
    assert _stored(providers, FIRST)["status"] == "draft"
    assert _stored(providers, FIRST)["updated_at"] != NOW


def test_switching_on_a_service_without_a_description_is_refused(client, providers, amelia):
    providers.seed("mobile_provider_services", [service_row(FIRST, PROVIDER, live=False, description="")])

    refused = client.patch(f"{API}/me/services/{FIRST}", json={"is_active": True})

    assert (refused.status_code, refused.json()["detail"]) == (422, "Add a description before making the service active.")
    assert _stored(providers, FIRST)["status"] == "draft"


def test_a_provider_cannot_touch_another_providers_service(client, providers, as_profile):
    providers.seed("mobile_provider_services", [service_row(FIRST, PROVIDER)])
    as_profile(id=OTHER, role="service_provider", access_token=jwt_for(providers, OTHER))

    for response in (
        client.patch(f"{API}/me/services/{FIRST}", json={"price": 1}),
        client.patch(f"{API}/me/services/{FIRST}", json={"cancellation_policy": "Mine now"}),
        client.delete(f"{API}/me/services/{FIRST}"),
        client.patch(f"{API}/me/services/not-a-uuid", json={"price": 1}),
    ):
        assert response.status_code == 404, response.text
    assert (_stored(providers, FIRST)["price"], _stored(providers, FIRST)["status"]) == (150, "active")
    other = next(r for r in providers.tables["service_provider_profiles"] if r["user_id"] == OTHER)
    assert "service_extras" not in other["metadata"]


def test_removing_a_service_archives_it_and_keeps_its_bookings(client, providers, amelia):
    providers.seed("mobile_provider_services", [service_row(FIRST, PROVIDER)])
    providers.seed("bookings", [booking_row("f0000000-0000-4000-8000-000000000001", PROVIDER, CLIENT,
                                            status="completed", service_id=FIRST)], schema="web")

    removed = client.delete(f"{API}/me/services/{FIRST}")

    assert removed.status_code == 204, removed.text
    assert _stored(providers, FIRST)["status"] == "archived"
    assert client.get(f"{API}/me/services").json() == []
    assert client.get(f"{API}/providers/{PROVIDER}/services").json() == []
    # A booking, invoice or review still names the service it was for.
    assert service.services_by_id([FIRST])[FIRST]["title"] == "Standard job"
    # An archived service is gone for the provider too.
    assert client.patch(f"{API}/me/services/{FIRST}", json={"price": 10}).status_code == 404
    assert client.delete(f"{API}/me/services/{FIRST}").status_code == 404


def test_only_a_service_provider_manages_services(client, providers, as_profile):
    as_profile(id=CLIENT, role="tenant", access_token=jwt_for(providers, CLIENT))

    assert client.post(f"{API}/me/services", json=GUTTERS).status_code == 403
    assert providers.tables.get("mobile_provider_services", []) == []


def test_a_closed_account_cannot_change_its_services(client, providers, amelia):
    # The functions run as current_app_user_id(), which only an ACTIVE account has.
    providers.seed("mobile_provider_services", [service_row(FIRST, PROVIDER)])
    next(row for row in providers.tables["users"] if row["id"] == PROVIDER)["status"] = "SUSPENDED"

    refused = client.patch(f"{API}/me/services/{FIRST}", json={"price": 99})

    assert (refused.status_code, refused.json()["detail"]) == (403, "Please sign in first.")
    assert _stored(providers, FIRST)["price"] == 150


def test_list_public_services_only_live(providers):
    providers.seed("mobile_provider_services", [
        service_row(FIRST, PROVIDER), service_row(SECOND, PROVIDER, live=False), service_row(FOREIGN, OTHER),
    ])
    assert [row["id"] for row in service.list_public_services(PROVIDER)] == [FIRST]


def test_new_services_are_listed_after_existing_ones(client, providers, amelia):
    providers.seed("mobile_provider_services", [service_row(FIRST, PROVIDER, created_at="2026-01-01T00:00:00+00:00")])

    created = client.post(f"{API}/me/services", json={**GUTTERS, "sort_order": 0}).json()

    assert created["sort_order"] == 2
    assert [row["id"] for row in service.list_my_services(PROVIDER)] == [FIRST, created["id"]]


def test_a_service_the_mobile_app_wrote_reads_in_the_web_shape(providers):
    providers.seed("mobile_provider_services", [service_row(
        FIRST, PROVIDER, duration="1.5 hours", inclusions=["Travel", "Report"], exclusions=["Parts"],
        description="", service_area="", price=0, category="APPLIANCE",
    )])

    [row] = service.list_my_services(PROVIDER)

    assert (row["duration_minutes"], row["inclusions"], row["exclusions"], row["category"]) == (
        90, "Travel\nReport", "Parts", "APPLIANCE",
    )
    assert (row["description"], row["service_area"], row["price"], row["cancellation_policy"]) == (None, None, 0.0, None)


def test_services_by_id_name_any_providers_service(providers):
    providers.seed("mobile_provider_services", [service_row(FIRST, PROVIDER, title="Gutter clean", live=False),
                                                service_row(FOREIGN, OTHER, title="Bond clean", status="archived")])
    found = service.services_by_id([FIRST, FOREIGN, FIRST])
    assert {key: value["title"] for key, value in found.items()} == {FIRST: "Gutter clean", FOREIGN: "Bond clean"}


@pytest.mark.parametrize(
    "payload",
    [
        {"title": "Gutter clean", "price": -10},
        {"title": "Gutter clean", "price": 100_001},
        {"title": " ", "price": 50},
        {"title": "G" * 81, "price": 50},
        {"title": "Gutter clean", "price": 50, "description": "x" * 1001},
        {"title": "Gutter clean", "price": 50, "service_area": "x" * 201},
        {"title": "Gutter clean", "price": 50, "pricing_type": "per_square_metre"},
        {"title": "Gutter clean", "price": 50, "category": "plumbing"},
        {"title": "Gutter clean", "price": 50, "duration_minutes": 2},
    ],
)
def test_service_payload_validation(payload):
    from pydantic import ValidationError

    from app.schemas.provider_services import ProviderServiceCreate

    with pytest.raises(ValidationError):
        ProviderServiceCreate(**payload)
