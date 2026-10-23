"""Public provider routes resolve a shared provider by id or slug, and only while it is live.

Regression cover for the shared-schema adapter: the public reviews route used
to raise NameError, shared providers got 404 on every public sub-route, and
the services, availability and portfolio routes read tables the shared
database lacks.
"""

import pytest

from tests.factories import make_availability
from tests.factories_provider_core import provider_user, review_row, seed_provider, service_row

pytestmark = pytest.mark.usefixtures("strict_schema")

SHARED = "70000000-0000-4000-8000-000000000001"
HIDDEN = "70000000-0000-4000-8000-000000000002"
CLIENT = "c0000000-0000-4000-8000-000000000001"
API = "/api/v1/providers"


@pytest.fixture
def providers(strict_schema):
    seed_provider(strict_schema, SHARED, business_name="Shared Co", slug="shared-co", category="cleaner")
    seed_provider(strict_schema, HIDDEN, business_name="Hidden Pro", slug="hidden-pro", published=False)
    strict_schema.seed("users", [provider_user(CLIENT, "Client", primary_role="TENANT")])
    strict_schema.seed("reviews", [
        review_row("b0000000-0000-4000-8000-000000000001", SHARED, CLIENT, 4, body="Good"),
        review_row("b0000000-0000-4000-8000-000000000002", HIDDEN, CLIENT, 3, body="Private"),
    ])
    strict_schema.seed("mobile_provider_services", [
        service_row("e0000000-0000-4000-8000-000000000001", SHARED),
        service_row("e0000000-0000-4000-8000-000000000002", SHARED, live=False),
        service_row("e0000000-0000-4000-8000-000000000003", HIDDEN),
    ])
    strict_schema.seed("provider_availability", [
        make_availability(SHARED, 1, id="f0000000-0000-4000-8000-000000000001"),
        make_availability(HIDDEN, 2, id="f0000000-0000-4000-8000-000000000002"),
    ], schema="web")
    strict_schema.seed("provider_portfolio", [
        {"id": "f1000000-0000-4000-8000-000000000001", "provider_id": SHARED, "image_url": "https://example.test/a.jpg",
         "title": "Kitchen", "sort_order": 2},
        {"id": "f1000000-0000-4000-8000-000000000002", "provider_id": SHARED, "image_url": "https://example.test/b.jpg",
         "title": "Bathroom", "sort_order": 1},
        {"id": "f1000000-0000-4000-8000-000000000003", "provider_id": HIDDEN, "image_url": "https://example.test/c.jpg"},
    ], schema="web")


@pytest.mark.parametrize("ref", [SHARED, "shared-co"])
def test_public_sub_routes_resolve_a_shared_provider(client, providers, ref):
    assert [review["id"] for review in client.get(f"{API}/{ref}/reviews").json()] == [
        "b0000000-0000-4000-8000-000000000001",
    ]
    assert [service["id"] for service in client.get(f"{API}/{ref}/services").json()] == [
        "e0000000-0000-4000-8000-000000000001",
    ]
    assert [window["day_of_week"] for window in client.get(f"{API}/{ref}/availability").json()] == [1]
    assert [item["title"] for item in client.get(f"{API}/{ref}/portfolio").json()] == ["Bathroom", "Kitchen"]
    assert client.get(f"{API}/{ref}").json()["id"] == SHARED


def test_a_providers_review_count_is_the_reviews_its_page_lists(client, strict_schema, providers):
    # Hidden and archived reviews are moderators' decisions: neither counted nor listed.
    strict_schema.seed("reviews", [
        review_row(f"b0000000-0000-4000-8000-00000000001{n}", SHARED, CLIENT, rating, status=status)
        for n, (rating, status) in enumerate([(2, "FLAGGED"), (1, "HIDDEN"), (1, "ARCHIVED")])
    ])

    page = client.get(f"{API}/shared-co").json()
    listed = client.get(f"{API}/shared-co/reviews").json()

    assert sorted(review["id"] for review in listed) == [
        "b0000000-0000-4000-8000-000000000001", "b0000000-0000-4000-8000-000000000010",
    ]
    assert (page["review_count"], page["rating_avg"]) == (len(listed), 3.0)


@pytest.mark.parametrize("path", ["", "/reviews", "/services", "/availability", "/portfolio", "/busy-times"])
@pytest.mark.parametrize("ref", [HIDDEN, "hidden-pro"])
def test_an_unpublished_provider_stays_private_by_any_reference(client, providers, path, ref):
    assert client.get(f"{API}/{ref}{path}").status_code == 404
