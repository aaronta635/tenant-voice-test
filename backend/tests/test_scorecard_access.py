"""Who may do what with a scorecard request (R43), by direct API calls as each role.

Only its tenant and the owner or agent asked read a request; anyone else,
staff included, gets 404 for it, as for an id that does not exist. Only the
tenant asks, cancels and shows it on their profile; only the owner asked
answers it. A role that never may (a provider, an admin, the other side) is
refused with 403 before any request is looked up.
"""

import pytest
from fastapi import HTTPException

from app.services import scorecards
from tests.factories_scorecards import (
    ADMIN, AGENT, ANSWERS, HOME, OTHER_TENANT, OWNER, PROVIDER, STRANGER, TENANT, notices, requests, seed_rentals,
)

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
MINE = f"{API}/me/scorecard-requests"
UNKNOWN = "e9000000-0000-4000-8000-000000000001"
ROLES = {
    TENANT: "tenant", OTHER_TENANT: "tenant", OWNER: "landlord", AGENT: "landlord", STRANGER: "landlord",
    PROVIDER: "service_provider", ADMIN: "admin",
}


@pytest.fixture
def pending(client, strict_schema, as_profile):
    """Tanya's request to Olivia about the Harbour Street home, still waiting."""
    seed_rentals(strict_schema)
    _as(as_profile, TENANT)
    response = client.post(MINE, json={"owner_user_id": OWNER, "property_id": HOME})
    assert response.status_code == 201, response.text
    return response.json()["id"]


@pytest.fixture
def completed(client, pending, as_profile):
    _as(as_profile, OWNER)
    assert client.post(f"{API}/scorecard-requests/{pending}/submit", json={"answers": ANSWERS}).status_code == 200
    return pending


def _as(as_profile, user_id):
    return as_profile(id=user_id, role=ROLES[user_id])


@pytest.mark.parametrize("user_id, code", [
    (TENANT, 200), (OWNER, 200), (AGENT, 404), (STRANGER, 404), (OTHER_TENANT, 404), (PROVIDER, 404), (ADMIN, 404),
])
def test_only_the_tenant_and_the_owner_asked_read_a_request(client, pending, as_profile, user_id, code):
    _as(as_profile, user_id)

    response = client.get(f"{API}/scorecard-requests/{pending}")

    assert response.status_code == code, response.text
    if code == 404:
        # The same answer as for an id that does not exist.
        assert response.json() == client.get(f"{API}/scorecard-requests/{UNKNOWN}").json()
        assert client.get(f"{API}/scorecard-requests/not-a-uuid").json() == response.json()


def test_admins_never_read_a_scorecard_or_a_declines_reason_in_the_activity_log(client, pending, as_profile):
    _as(as_profile, OWNER)
    submitted = client.post(f"{API}/scorecard-requests/{pending}/submit",
                            json={"answers": ANSWERS, "comment": "Always on time."})
    assert submitted.status_code == 200 and submitted.json()["average"] == 4.57
    _as(as_profile, TENANT)
    asked = client.post(MINE, json={"owner_user_id": AGENT, "property_id": HOME}).json()["id"]
    _as(as_profile, AGENT)
    reason = "I only managed the building for a month."
    assert client.post(f"{API}/scorecard-requests/{asked}/decline", json={"reason": reason}).status_code == 200
    as_profile(id=ADMIN, role="admin", raw={"id": ADMIN, "role": "admin", "status": "ACTIVE"})

    response = client.get(f"{API}/admin/activity", params={"log": "web", "entity_type": "scorecard_request"})

    assert response.status_code == 200, response.text
    details = {item["action"]: item["details"] for item in response.json()["items"]}
    assert details["scorecard.completed"] == {"tenant_id": TENANT, "property_id": HOME}
    assert details["scorecard.declined"] == {"tenant_id": TENANT, "property_id": HOME}
    assert reason not in response.text and "4.57" not in response.text and "Always on time" not in response.text


def test_signed_out_callers_reach_nothing(client, pending):
    client.app.dependency_overrides.clear()  # the fixture asked as Tanya

    for method, path in (("get", MINE), ("get", f"{MINE}/recipients"), ("post", MINE),
                         ("get", f"{API}/scorecard-requests/{pending}"),
                         ("post", f"{API}/scorecard-requests/{pending}/submit"),
                         ("post", f"{API}/scorecard-requests/{pending}/decline"),
                         ("post", f"{API}/scorecard-requests/{pending}/cancel"),
                         ("patch", f"{API}/scorecard-requests/{pending}")):
        assert getattr(client, method)(path).status_code == 401, (method, path)


@pytest.mark.parametrize("user_id, code", [
    (TENANT, 200), (OWNER, 200), (AGENT, 200), (PROVIDER, 403), (ADMIN, 403),
])
def test_tenants_list_what_they_sent_and_owners_what_they_received(client, pending, as_profile, user_id, code):
    _as(as_profile, user_id)

    response = client.get(MINE)

    assert response.status_code == code
    if code == 200:
        assert [row["id"] for row in response.json()] == ([pending] if user_id in (TENANT, OWNER) else [])


@pytest.mark.parametrize("user_id", [OWNER, PROVIDER, ADMIN])
def test_only_a_tenant_asks_or_sees_whom_to_ask(client, strict_schema, pending, as_profile, user_id):
    _as(as_profile, user_id)

    assert client.get(f"{MINE}/recipients").status_code == 403
    assert client.post(MINE, json={"owner_user_id": OWNER, "property_id": HOME}).status_code == 403
    assert len(requests(strict_schema)) == 1


@pytest.mark.parametrize("action, body", [("submit", {"answers": ANSWERS}), ("decline", {"reason": "No."})])
@pytest.mark.parametrize("user_id, code", [
    (TENANT, 403), (OTHER_TENANT, 403), (PROVIDER, 403), (ADMIN, 403), (AGENT, 404), (STRANGER, 404),
])
def test_only_the_owner_asked_answers(client, strict_schema, pending, as_profile, action, body, user_id, code):
    _as(as_profile, user_id)

    response = client.post(f"{API}/scorecard-requests/{pending}/{action}", json=body)

    assert response.status_code == code, response.text
    [row] = requests(strict_schema)
    assert (row["status"], row["answers"], row["decided_reason"]) == ("PENDING", None, None)
    assert notices(strict_schema, TENANT) == []


@pytest.mark.parametrize("user_id, code", [
    (OWNER, 403), (AGENT, 403), (PROVIDER, 403), (ADMIN, 403), (OTHER_TENANT, 404),
])
def test_only_the_tenant_who_asked_cancels(client, strict_schema, pending, as_profile, user_id, code):
    _as(as_profile, user_id)

    assert client.post(f"{API}/scorecard-requests/{pending}/cancel").status_code == code
    assert requests(strict_schema)[0]["status"] == "PENDING"


@pytest.mark.parametrize("user_id, code", [
    (OWNER, 403), (AGENT, 403), (PROVIDER, 403), (ADMIN, 403), (OTHER_TENANT, 404),
])
def test_only_the_tenant_shows_a_scorecard_on_their_profile(
    client, strict_schema, completed, as_profile, user_id, code,
):
    _as(as_profile, user_id)

    response = client.patch(f"{API}/scorecard-requests/{completed}", json={"visible_on_profile": True})

    assert response.status_code == code
    assert requests(strict_schema)[0]["visible_on_profile"] is False
    _as(as_profile, TENANT)
    assert client.patch(f"{API}/scorecard-requests/{completed}", json={"visible_on_profile": True}).status_code == 200


def test_the_owner_asked_and_the_tenant_who_asked_may_act(client, strict_schema, pending, as_profile):
    _as(as_profile, OWNER)
    assert client.post(f"{API}/scorecard-requests/{pending}/decline", json={}).status_code == 200
    _as(as_profile, TENANT)
    # The owner who declined is asked again only later (test_scorecards); the home's agent now.
    again = client.post(MINE, json={"owner_user_id": AGENT, "property_id": HOME}).json()["id"]
    assert client.post(f"{API}/scorecard-requests/{again}/cancel").status_code == 200
    assert [row["status"] for row in requests(strict_schema)] == ["DECLINED", "CANCELLED"]


def test_the_service_refuses_the_other_party_too(pending):
    # Behind the routes' role checks: the tenant never answers, and the owner never cancels or shows it.
    refused = []
    for call in (lambda: scorecards.submit(pending, TENANT, ANSWERS, None),
                 lambda: scorecards.decline(pending, TENANT, None),
                 lambda: scorecards.cancel(pending, OWNER),
                 lambda: scorecards.set_visibility(pending, OWNER, True)):
        with pytest.raises(HTTPException) as caught:
            call()
        refused.append(caught.value.status_code)

    assert refused == [403, 403, 403, 403]
