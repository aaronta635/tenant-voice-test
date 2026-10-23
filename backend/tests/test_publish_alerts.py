"""Match alerts from the listing publish path (R34, R36), by an owner's requests on the strict fake.

Each request that publishes a listing (a create, or a move to PUBLISHED)
asks services/matching.py once, after its answer, to alert the tenants it is
a strong match for. Nothing else does: an edit, a pause, a page load or a
refresh asks nothing, and a listing published again alerts nobody twice.
"""

import pytest
from pydantic import SecretStr

from app.core.config import settings
from app.services import matching
from tests.factories_identity import account
from tests.factories_matching import MEI, OLIVIA, alert_rows, tenant_profile, uid, user_row

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
ZOE = uid("zoe")
WANTS = {"budget_max": 650, "locations": ["Newtown"], "bedrooms_min": 2}
HOME = {
    "title": "Harbour flat", "address": "1 Harbour Street", "suburb": "Newtown", "state": "NSW", "postcode": "2042",
    "property_type": "Apartment", "bedrooms": 2, "bathrooms": 1, "price": 620,
}
TITLE = "A new home matches your preferences"


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    matching.clear_caches()
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr(""))
    yield
    matching.clear_caches()


@pytest.fixture
def olivia(strict_schema) -> dict:
    """A verified owner's headers, and Mei and Zoe, two tenants a Newtown 2-bedroom under $650 fits."""
    token = account(strict_schema, OLIVIA, "olivia@example.test", "LANDLORD", full_name="Olivia Owner",
                    verification_status="APPROVED")
    strict_schema.seed("users", [user_row(MEI, "Mei Lin"), user_row(ZOE, "Zoe Tenant")])
    strict_schema.seed("tenant_profiles", [tenant_profile(MEI, **WANTS), tenant_profile(ZOE, **WANTS)])
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def asked(monkeypatch) -> list[str]:
    """The listings the publish path asked matching about, in order; the alerts still go."""
    calls: list[str] = []
    send = matching.alert_matches_for_listing

    def spy(listing_id: str) -> int:
        calls.append(listing_id)
        return send(listing_id)

    monkeypatch.setattr(matching, "alert_matches_for_listing", spy)
    return calls


def alerts(db) -> list[tuple[str, str]]:
    return sorted((row["user_id"], row["link"]) for row in db.tables.get("notifications", []) if row["title"] == TITLE)


def test_publishing_a_new_listing_alerts_each_matching_tenant_once(client, strict_schema, olivia, asked):
    created = client.post(f"{API}/me/properties", headers=olivia, json=HOME)

    assert created.status_code == 201, created.text
    listing_id = created.json()["id"]
    assert asked == [listing_id]
    assert alerts(strict_schema) == sorted([
        (MEI, f"/matches/property/{listing_id}"), (ZOE, f"/matches/property/{listing_id}"),
    ])
    assert [row["entity_id"] for row in alert_rows(strict_schema, MEI)] == [listing_id]


def test_a_second_publish_or_a_refresh_sends_nothing_new(client, strict_schema, olivia, asked, as_profile):
    listing_id = client.post(f"{API}/me/properties", headers=olivia, json=HOME).json()["id"]
    first = alerts(strict_schema)

    # Taken down and published again, and reopened after applications closed: asked each time, nobody told twice.
    for change in ("paused", "published", "applications_closed", "published"):
        response = client.patch(f"{API}/me/properties/{listing_id}", headers=olivia, json={"listing_status": change})
        assert response.status_code == 200, response.text
    # The owner's pages, the listing page and the tenant's matches, loaded again.
    assert client.get(f"{API}/me/properties", headers=olivia).status_code == 200
    assert client.get(f"{API}/me/properties/{listing_id}", headers=olivia).status_code == 200
    assert client.get(f"{API}/properties/{listing_id}").status_code == 200
    assert client.get(f"{API}/properties").status_code == 200
    as_profile(id=MEI, role="tenant")
    assert client.get(f"{API}/me/matches/properties").status_code == 200

    assert asked == [listing_id] * 3
    assert alerts(strict_schema) == first
    assert len(alert_rows(strict_schema, MEI)) == len(alert_rows(strict_schema, ZOE)) == 1


def test_only_a_request_that_publishes_asks(client, strict_schema, olivia, asked):
    kept = client.post(f"{API}/me/properties", headers=olivia, json={**HOME, "status": "off_market"})
    assert kept.status_code == 201, kept.text
    listing_id = kept.json()["id"]

    # Edits of a listing kept off the market, and of a published one, publish nothing.
    client.patch(f"{API}/me/properties/{listing_id}", headers=olivia, json={"title": "Harbour flat, renovated"})
    assert (asked, alerts(strict_schema)) == ([], [])
    published = client.patch(f"{API}/me/properties/{listing_id}", headers=olivia, json={"status": "available"})
    assert published.status_code == 200, published.text
    client.patch(f"{API}/me/properties/{listing_id}", headers=olivia, json={"price": 610, "description": "Sunny."})

    assert asked == [listing_id]
    assert [user for user, _ in alerts(strict_schema)] == sorted([MEI, ZOE])


def test_a_publish_the_gate_refuses_alerts_nobody(client, strict_schema, olivia, asked):
    next(row for row in strict_schema.tables["users"] if row["id"] == OLIVIA)["verification_status"] = "PENDING"

    assert client.post(f"{API}/me/properties", headers=olivia, json=HOME).status_code == 403

    assert (asked, alerts(strict_schema), alert_rows(strict_schema)) == ([], [], [])


def test_a_failure_in_the_alerts_never_fails_the_publish(client, strict_schema, olivia, monkeypatch):
    def broken(db):
        raise RuntimeError("tenant scan failed")

    monkeypatch.setattr(matching, "_tenants", broken)

    created = client.post(f"{API}/me/properties", headers=olivia, json=HOME)

    assert created.status_code == 201, created.text
    assert next(row for row in strict_schema.tables["listings"] if row["id"] == created.json()["id"])["status"] == "PUBLISHED"
    assert alerts(strict_schema) == []
