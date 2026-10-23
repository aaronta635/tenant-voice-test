"""Tenant scorecards (tracker R43) on the strict shared schema and web.scorecard_requests.

A tenant asks the owner or agent of a home they rent or rented (a lease
that took effect, or an application the owner approved) for a scorecard;
the owner rates the seven items from 1 to 5, or declines; the tenant may
cancel while it waits, and chooses whether a completed one counts on their
public profile. Each step tells the other party. tests/factories_scorecards.py
has the people and homes; test_scorecard_access.py has who may do what.
"""

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.schemas.scorecards import ITEMS, ScorecardAnswers
from app.services import scorecards
from tests.factories_scorecards import (
    AGENT, ANSWERS, APPROVED_APPLICATION, HOME, LEASE, LEASE_APPLICATION, LEASE_LISTING, LEASED_HOME, NOW, OTHER_HOME,
    OTHER_LISTING, OTHER_TENANT, OWNER, STRANGER, TENANT, application, home, lease, listing, notices, requests,
    seed_rentals, user,
)

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
MINE = f"{API}/me/scorecard-requests"
RECIPIENTS = f"{MINE}/recipients"
PUBLIC = f"{API}/public/profiles"
UNKNOWN = "e9000000-0000-4000-8000-000000000001"


@pytest.fixture
def rentals(strict_schema):
    seed_rentals(strict_schema)
    return strict_schema


def _as_tenant(as_profile, tenant_id=TENANT):
    return as_profile(id=tenant_id, role="tenant", full_name="Tanya Tenant")


def _as_owner(as_profile, owner_id=OWNER):
    return as_profile(id=owner_id, role="landlord", full_name="Olivia Owner")


def _ask(client, as_profile, owner_id=OWNER, property_id=HOME) -> dict:
    _as_tenant(as_profile)
    response = client.post(MINE, json={"owner_user_id": owner_id, "property_id": property_id})
    assert response.status_code == 201, response.text
    return response.json()


def _submit(client, as_profile, request_id, answers=ANSWERS, comment="Always on time and easy to deal with.",
            owner_id=OWNER):
    _as_owner(as_profile, owner_id)
    return client.post(f"{API}/scorecard-requests/{request_id}/submit", json={"answers": answers, "comment": comment})


def _row(db, request_id) -> dict:
    return next(row for row in requests(db) if row["id"] == request_id)


def _audit(db) -> list[str]:
    return [row["action"] for row in db.schema_tables.get("web", {}).get("audit_log", [])]


def _days_ago(days: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def _recipient(client, owner_id=OWNER, property_id=HOME) -> dict:
    return {(r["owner_id"], r["property_id"]): r for r in client.get(RECIPIENTS).json()}[(owner_id, property_id)]


# ---------------------------------------------------------------------------
# Who may be asked
# ---------------------------------------------------------------------------
def test_a_tenant_may_ask_the_owner_and_agent_of_an_approved_application_and_the_owner_of_a_lease(
    client, rentals, as_profile,
):
    _as_tenant(as_profile)

    response = client.get(RECIPIENTS)

    assert response.status_code == 200, response.text
    assert [(r["owner_id"], r["property_id"], r["source"]) for r in response.json()] == [
        (AGENT, HOME, "application"), (OWNER, HOME, "application"), (OWNER, LEASED_HOME, "agreement"),
    ]
    agent, owner, leased = response.json()
    assert (agent["owner_name"], agent["owner_role_label"]) == ("Avery Agent", "Agent")
    assert (owner["owner_name"], owner["owner_role_label"]) == ("Olivia Owner", "Landlord")
    assert (leased["property_label"], leased["suburb"], leased["state"]) == ("7 Beach Road", "Thirroul", "NSW")
    assert {r["pending_request_id"] for r in response.json()} == {None}


def test_without_a_lease_or_an_approved_application_nobody_can_be_asked(client, rentals, as_profile):
    # Theo applied to Sam's home and was not approved; Tanya never rented Sam's home either.
    rentals.seed("rental_applications", [application("e6000000-0000-4000-8000-000000000009", OTHER_LISTING,
                                                     OTHER_TENANT, status="SUBMITTED")])
    _as_tenant(as_profile, OTHER_TENANT)

    assert client.get(RECIPIENTS).json() == []
    for owner_id, property_id in ((STRANGER, OTHER_HOME), (OWNER, HOME), (OWNER, LEASED_HOME)):
        response = client.post(MINE, json={"owner_user_id": owner_id, "property_id": property_id})
        assert (response.status_code, response.json()["detail"]) == (403, scorecards.NOT_ELIGIBLE)
    _as_tenant(as_profile)
    for owner_id, property_id in ((STRANGER, OTHER_HOME), (OWNER, OTHER_HOME), (STRANGER, HOME), (OWNER, UNKNOWN),
                                  (UNKNOWN, HOME), (TENANT, HOME)):
        response = client.post(MINE, json={"owner_user_id": owner_id, "property_id": property_id})
        assert (response.status_code, response.json()["detail"]) == (403, scorecards.NOT_ELIGIBLE), (
            owner_id, property_id,
        )
    assert requests(rentals) == []
    assert all(notices(rentals, person) == [] for person in (OWNER, AGENT, STRANGER))


def test_ids_that_are_not_uuids_are_refused(client, rentals, as_profile):
    _as_tenant(as_profile)

    for body in ({"owner_user_id": "olivia", "property_id": HOME}, {"owner_user_id": OWNER},
                 {"owner_user_id": OWNER, "property_id": HOME, "status": "COMPLETED"}):
        assert client.post(MINE, json=body).status_code == 422, body
    assert requests(rentals) == []


@pytest.mark.parametrize("over, counts", [
    ({}, True),
    ({"status": "ACTIVE", "activated_at": None}, True),  # current, with no activation time
    ({"status": "DRAFT", "activated_at": None}, False),  # never took effect
    ({"status": "CANCELLED", "activated_at": None}, False),
])
def test_a_lease_counts_once_it_took_effect(client, strict_schema, as_profile, over, counts):
    strict_schema.seed("users", [user(TENANT, "Tanya Tenant"), user(OWNER, "Olivia Owner", "LANDLORD")])
    strict_schema.seed("properties", [home(LEASED_HOME, OWNER, "7 Beach Road", "Thirroul")])
    strict_schema.seed("listings", [listing(LEASE_LISTING, LEASED_HOME, OWNER)])
    strict_schema.seed("rental_applications", [application(LEASE_APPLICATION, LEASE_LISTING, TENANT, status="EXPIRED")])
    # rent_agreement_active_requires_activation keeps an ACTIVE lease without activated_at out today; one from
    # before it is put on the stored row after a seed the CHECK accepts.
    seeded = {key: value for key, value in over.items() if not (key == "activated_at" and over.get("status") == "ACTIVE")}
    strict_schema.seed("rent_agreements", [lease(LEASE, LEASE_APPLICATION, LEASE_LISTING, TENANT, OWNER, **seeded)])
    strict_schema.tables["rent_agreements"][0].update(over)
    _as_tenant(as_profile)

    assert bool(client.get(RECIPIENTS).json()) is counts
    response = client.post(MINE, json={"owner_user_id": OWNER, "property_id": LEASED_HOME})
    assert response.status_code == (201 if counts else 403)


@pytest.mark.parametrize("over", [{"status": "SUSPENDED"}, {"status": "DEACTIVATED"}, {"deleted_at": NOW},
                                  {"primary_role": "ADMIN"}, {"primary_role": "TENANT"}])
def test_a_closed_account_or_one_that_is_not_an_owner_is_never_asked(client, rentals, as_profile, over):
    rentals.tables["users"][:] = [{**row, **over} if row["id"] == OWNER else row for row in rentals.tables["users"]]
    _as_tenant(as_profile)

    assert [r["owner_id"] for r in client.get(RECIPIENTS).json()] == [AGENT]
    response = client.post(MINE, json={"owner_user_id": OWNER, "property_id": LEASED_HOME})
    assert response.status_code == 403
    assert requests(rentals) == []


def test_an_owner_whose_name_is_an_email_is_named_as_a_member(client, rentals, as_profile):
    rentals.tables["users"][:] = [{**row, "full_name": "olivia@private.example"} if row["id"] == OWNER else row
                                  for row in rentals.tables["users"]]
    _as_tenant(as_profile)

    names = {r["owner_id"]: r["owner_name"] for r in client.get(RECIPIENTS).json()}

    assert names == {AGENT: "Avery Agent", OWNER: scorecards.FALLBACK_NAME}
    assert "olivia@private.example" not in client.get(RECIPIENTS).text


# ---------------------------------------------------------------------------
# Asking
# ---------------------------------------------------------------------------
def test_a_request_waits_for_the_owner_who_is_told(client, rentals, as_profile):
    created = _ask(client, as_profile)

    assert (created["status"], created["tenant_id"], created["owner_id"], created["property_id"]) == (
        "pending", TENANT, OWNER, HOME,
    )
    assert (created["tenant_name"], created["owner_name"], created["property_label"]) == (
        "Tanya Tenant", "Olivia Owner", "1 Harbour Street",
    )
    assert (created["answers"], created["average"], created["comment"], created["decided_at"]) == ([], None, None, None)
    [row] = requests(rentals)
    assert (row["status"], row["application_id"], row["agreement_id"], row["visible_on_profile"]) == (
        "PENDING", APPROVED_APPLICATION, None, False,
    )
    [notice] = notices(rentals, OWNER)
    assert (notice["title"], notice["link"], notice["category"]) == (
        "Scorecard request from Tanya Tenant", "/owner/scorecard", "social",
    )
    assert notice["body"] == "Tanya Tenant asked you to complete a tenant scorecard for 1 Harbour Street."
    assert notices(rentals, AGENT) == [] and notices(rentals, TENANT) == []
    assert "scorecard.requested" in _audit(rentals)


def test_a_request_about_a_lease_names_the_lease(client, rentals, as_profile):
    _ask(client, as_profile, OWNER, LEASED_HOME)

    [row] = requests(rentals)
    assert (row["agreement_id"], row["application_id"], row["property_id"]) == (LEASE, None, LEASED_HOME)


def test_one_request_waits_per_owner_and_home(client, rentals, as_profile):
    first = _ask(client, as_profile)

    # The pending index refuses the second, as it would one sent at the same moment.
    again = client.post(MINE, json={"owner_user_id": OWNER, "property_id": HOME})
    assert (again.status_code, again.json()["detail"]) == (409, scorecards.ALREADY_PENDING)
    assert len(requests(rentals)) == 1 and len(notices(rentals, OWNER)) == 1
    pending = {(r["owner_id"], r["property_id"]): r["pending_request_id"] for r in client.get(RECIPIENTS).json()}
    assert pending == {(AGENT, HOME): None, (OWNER, HOME): first["id"], (OWNER, LEASED_HOME): None}
    # The agent of the same home, and the owner for another home, are other requests.
    _ask(client, as_profile, AGENT, HOME)
    _ask(client, as_profile, OWNER, LEASED_HOME)
    assert len(requests(rentals)) == 3 and len(notices(rentals, OWNER)) == 2


def test_a_tenant_may_ask_again_once_the_wait_after_a_decline_or_a_cancel_is_over(client, rentals, as_profile):
    first = _ask(client, as_profile)
    _as_owner(as_profile)
    assert client.post(f"{API}/scorecard-requests/{first['id']}/decline", json={}).status_code == 200
    # Two days past the wait: it ends at the start of a day in Sydney, which can be up to 25 hours on.
    _row(rentals, first["id"])["decided_at"] = _days_ago(32)

    second = _ask(client, as_profile)
    assert client.post(f"{API}/scorecard-requests/{second['id']}/cancel").status_code == 200
    _row(rentals, second["id"])["decided_at"] = _days_ago(9)
    third = _ask(client, as_profile)

    assert [row["status"] for row in requests(rentals)] == ["DECLINED", "CANCELLED", "PENDING"]
    assert third["id"] not in (first["id"], second["id"])


@pytest.mark.parametrize("answer, days, told", [
    ("decline", 30, "They declined your last request for this home. You can ask them again from "),
    ("cancel", 7, "You cancelled your last request for this home. You can ask them again from "),
])
def test_after_a_decline_or_a_cancel_the_tenant_waits_to_ask_that_owner_again(
    client, rentals, as_profile, answer, days, told,
):
    created = _ask(client, as_profile)
    (_as_owner if answer == "decline" else _as_tenant)(as_profile)
    assert client.post(f"{API}/scorecard-requests/{created['id']}/{answer}", json={}).status_code == 200
    _as_tenant(as_profile)
    notified = len(notices(rentals, OWNER))

    again = client.post(MINE, json={"owner_user_id": OWNER, "property_id": HOME})

    assert again.status_code == 409 and again.json()["detail"].startswith(told), again.text
    assert len(requests(rentals)) == 1 and len(notices(rentals, OWNER)) == notified
    assert _recipient(client)["ask_again_from"] is not None
    # A day short of the wait it still holds; the others of that home and owner were never asked.
    _row(rentals, created["id"])["decided_at"] = _days_ago(days - 1)
    assert client.post(MINE, json={"owner_user_id": OWNER, "property_id": HOME}).status_code == 409
    _ask(client, as_profile, AGENT, HOME)
    _ask(client, as_profile, OWNER, LEASED_HOME)
    _row(rentals, created["id"])["decided_at"] = _days_ago(days + 2)
    assert _recipient(client)["ask_again_from"] is None
    _ask(client, as_profile)


@pytest.mark.parametrize("answer, days", [("decline", 30), ("cancel", 7)])
def test_the_day_a_tenant_is_told_they_may_ask_again_is_the_first_day_they_can(
    client, rentals, as_profile, monkeypatch, answer, days,
):
    created = _ask(client, as_profile)
    (_as_owner if answer == "decline" else _as_tenant)(as_profile)
    assert client.post(f"{API}/scorecard-requests/{created['id']}/{answer}", json={}).status_code == 200
    # Answered the wait less a minute before 10 am on 23 October in Sydney: it is over that morning.
    morning = datetime(2026, 10, 23, 10, 0, tzinfo=scorecards.SYDNEY)
    _row(rentals, created["id"])["decided_at"] = (morning - timedelta(days=days, minutes=-1)).isoformat()
    _as_tenant(as_profile)

    for moment in (morning, datetime(2026, 10, 23, 23, 59, tzinfo=scorecards.SYDNEY)):
        monkeypatch.setattr(scorecards, "_moment", lambda moment=moment: moment)
        again = client.post(MINE, json={"owner_user_id": OWNER, "property_id": HOME})
        assert again.status_code == 409 and again.json()["detail"].endswith("ask them again from 24 October 2026.")
        told = datetime.fromisoformat(_recipient(client)["ask_again_from"])
        assert told == datetime(2026, 10, 24, tzinfo=scorecards.SYDNEY)

    monkeypatch.setattr(scorecards, "_moment", lambda: datetime(2026, 10, 24, 0, 0, tzinfo=scorecards.SYDNEY))
    _ask(client, as_profile)


def test_asking_and_cancelling_over_and_over_reaches_the_owner_once(client, rentals, as_profile):
    for _ in range(5):
        _as_tenant(as_profile)
        response = client.post(MINE, json={"owner_user_id": OWNER, "property_id": HOME})
        if response.status_code == 201:
            assert client.post(f"{API}/scorecard-requests/{response.json()['id']}/cancel").status_code == 200

    assert [row["status"] for row in requests(rentals)] == ["CANCELLED"]
    assert [notice["title"] for notice in notices(rentals, OWNER)] == [
        "Scorecard request from Tanya Tenant", "Scorecard request cancelled",
    ]


def test_an_owner_completes_one_scorecard_per_home(client, rentals, as_profile):
    done = _completed(client, as_profile)
    _as_tenant(as_profile)

    again = client.post(MINE, json={"owner_user_id": OWNER, "property_id": HOME})

    assert (again.status_code, again.json()["detail"]) == (409, scorecards.ALREADY_COMPLETED)
    assert len(requests(rentals)) == 1 and len(notices(rentals, OWNER)) == 1
    assert (_recipient(client)["completed_request_id"], _recipient(client)["ask_again_from"]) == (done["id"], None)
    # The home's agent, and the owner about another home, are other scorecards.
    _ask(client, as_profile, AGENT, HOME)
    _ask(client, as_profile, OWNER, LEASED_HOME)


# ---------------------------------------------------------------------------
# Answering
# ---------------------------------------------------------------------------
def test_the_owner_submits_the_seven_ratings_and_the_tenant_reads_them(client, rentals, as_profile):
    created = _ask(client, as_profile)

    response = _submit(client, as_profile, created["id"])

    assert response.status_code == 200, response.text
    done = response.json()
    assert (done["status"], done["average"], done["comment"]) == (
        "completed", 4.57, "Always on time and easy to deal with.",
    )
    assert [(answer["key"], answer["rating"]) for answer in done["answers"]] == list(ANSWERS.items())
    assert done["answers"][0]["label"] == "Paid rent on time"
    assert done["answers"][-1]["label"] == "Would you rent to this tenant again?"
    # Whether it shows on the tenant's profile is the tenant's choice, not the owner's to read.
    assert done["decided_at"] is not None and done["visible_on_profile"] is None
    row = _row(rentals, created["id"])
    assert (row["status"], row["answers"], row["completed_at"] is not None) == ("COMPLETED", ANSWERS, True)
    [notice] = notices(rentals, TENANT)
    assert (notice["title"], notice["link"]) == ("Your scorecard is ready", "/tenant/dashboard#scorecards")
    assert notice["body"] == "Olivia Owner completed your tenant scorecard for 1 Harbour Street: 4.6 out of 5."
    # Both of them read the same result.
    _as_tenant(as_profile)
    as_tenant = client.get(f"{API}/scorecard-requests/{created['id']}").json()
    assert as_tenant == {**done, "visible_on_profile": False}
    assert client.get(MINE).json() == [as_tenant]
    _as_owner(as_profile)
    assert client.get(MINE).json() == [done]
    assert "scorecard.completed" in _audit(rentals)


def test_a_submitted_scorecard_is_final(client, rentals, as_profile):
    created = _ask(client, as_profile)
    assert _submit(client, as_profile, created["id"]).status_code == 200

    again = _submit(client, as_profile, created["id"], answers={**ANSWERS, "paid_rent_on_time": 1})
    decline = client.post(f"{API}/scorecard-requests/{created['id']}/decline", json={"reason": "Changed my mind"})
    _as_tenant(as_profile)
    cancel = client.post(f"{API}/scorecard-requests/{created['id']}/cancel")

    for response in (again, decline, cancel):
        assert (response.status_code, response.json()["detail"]) == (409, scorecards.ANSWERED["COMPLETED"])
    assert _row(rentals, created["id"])["answers"] == ANSWERS
    assert len(notices(rentals, TENANT)) == 1


@pytest.mark.parametrize("answers, comment", [
    ({key: value for key, value in ANSWERS.items() if key != "would_rent_again"}, None),  # six of the seven
    ({**ANSWERS, "kept_a_pet": 5}, None),  # an item the scorecard does not ask
    ({**ANSWERS, "paid_rent_on_time": 0}, None),
    ({**ANSWERS, "paid_rent_on_time": 6}, None),
    ({**ANSWERS, "paid_rent_on_time": "5"}, None),
    ({**ANSWERS, "paid_rent_on_time": 4.5}, None),
    ({**ANSWERS, "paid_rent_on_time": True}, None),
    ({**ANSWERS, "paid_rent_on_time": None}, None),
    ({}, None),
    (ANSWERS, "x" * 1001),
])
def test_a_scorecard_needs_a_rating_from_1_to_5_for_each_of_the_seven_items(
    client, rentals, as_profile, answers, comment,
):
    created = _ask(client, as_profile)

    response = _submit(client, as_profile, created["id"], answers=answers, comment=comment)

    assert response.status_code == 422, response.text
    assert _row(rentals, created["id"])["status"] == "PENDING"
    assert notices(rentals, TENANT) == []


def test_the_comment_is_optional_and_trimmed(client, rentals, as_profile):
    first, second = _ask(client, as_profile), _ask(client, as_profile, OWNER, LEASED_HOME)

    assert _submit(client, as_profile, first["id"], comment=None).json()["comment"] is None
    trimmed = _submit(client, as_profile, second["id"], comment="   Lovely tenant.  ").json()
    assert trimmed["comment"] == "Lovely tenant."
    assert _submit(client, as_profile, _ask(client, as_profile, AGENT, HOME)["id"], comment="  ", owner_id=AGENT
                   ).json()["comment"] is None


def test_the_owner_declines_with_a_reason_the_tenant_reads(client, rentals, as_profile):
    created = _ask(client, as_profile)
    _as_owner(as_profile)

    response = client.post(f"{API}/scorecard-requests/{created['id']}/decline",
                           json={"reason": "  I only managed the building, not your lease. "})

    assert response.status_code == 200, response.text
    declined = response.json()
    assert (declined["status"], declined["reason"], declined["answers"]) == (
        "declined", "I only managed the building, not your lease.", [],
    )
    assert declined["decided_at"] is not None
    assert _row(rentals, created["id"])["decided_reason"] == "I only managed the building, not your lease."
    [notice] = notices(rentals, TENANT)
    assert (notice["title"], notice["link"]) == ("Scorecard request declined", "/tenant/dashboard#scorecards")
    assert notice["body"] == ("Olivia Owner declined your request for a scorecard for 1 Harbour Street. "
                              "Their reason: I only managed the building, not your lease.")
    later = _submit(client, as_profile, created["id"])
    assert (later.status_code, later.json()["detail"]) == (409, scorecards.ANSWERED["DECLINED"])
    assert client.post(f"{API}/scorecard-requests/{created['id']}/decline",
                       json={"reason": "x" * 501}).status_code == 422


@pytest.mark.parametrize("answer", ["decline", "cancel", "submit"])
def test_a_decision_keeps_its_time_when_the_application_behind_it_goes(client, rentals, as_profile, answer):
    created = _ask(client, as_profile)
    if answer == "submit":
        decided = _submit(client, as_profile, created["id"]).json()
    else:
        (_as_owner if answer == "decline" else _as_tenant)(as_profile)
        decided = client.post(f"{API}/scorecard-requests/{created['id']}/{answer}", json={}).json()

    # Another app removes the approved application: the key is set to null, which moves updated_at on.
    rentals.table("rental_applications").delete().eq("id", APPROVED_APPLICATION).execute()

    row = _row(rentals, created["id"])
    assert row["application_id"] is None and row["updated_at"] != row["decided_at"]
    _as_tenant(as_profile)
    assert client.get(f"{API}/scorecard-requests/{created['id']}").json()["decided_at"] == decided["decided_at"]


def test_a_decline_without_a_reason_says_so_plainly(client, rentals, as_profile):
    created = _ask(client, as_profile)
    _as_owner(as_profile)

    declined = client.post(f"{API}/scorecard-requests/{created['id']}/decline", json={"reason": " "}).json()

    assert declined["reason"] is None
    assert notices(rentals, TENANT)[0]["body"] == (
        "Olivia Owner declined your request for a scorecard for 1 Harbour Street."
    )


def test_the_tenant_cancels_a_waiting_request_and_the_owner_is_told(client, rentals, as_profile):
    created = _ask(client, as_profile)

    response = client.post(f"{API}/scorecard-requests/{created['id']}/cancel")

    assert response.status_code == 200, response.text
    assert (response.json()["status"], response.json()["decided_at"] is not None) == ("cancelled", True)
    assert _row(rentals, created["id"])["status"] == "CANCELLED"
    request_notice, cancel_notice = notices(rentals, OWNER)
    assert (cancel_notice["title"], cancel_notice["link"]) == ("Scorecard request cancelled", "/owner/scorecard")
    assert cancel_notice["body"] == ("Tanya Tenant cancelled their request for a scorecard for 1 Harbour Street. "
                                     "There is nothing to complete.")
    later = _submit(client, as_profile, created["id"])
    assert (later.status_code, later.json()["detail"]) == (409, scorecards.ANSWERED["CANCELLED"])
    _as_tenant(as_profile)
    again = client.post(f"{API}/scorecard-requests/{created['id']}/cancel")
    assert (again.status_code, again.json()["detail"]) == (409, scorecards.ANSWERED["CANCELLED"])
    assert "scorecard.cancelled" in _audit(rentals)


def test_an_answer_that_crosses_a_cancellation_is_refused(client, rentals, as_profile, monkeypatch):
    created = _ask(client, as_profile)
    stale = dict(_row(rentals, created["id"]))
    # The tenant cancels after the owner's page read the request, before their answer lands.
    assert client.post(f"{API}/scorecard-requests/{created['id']}/cancel").status_code == 200
    monkeypatch.setattr(scorecards, "_owner_row", lambda request_id, owner_id: stale)

    response = _submit(client, as_profile, created["id"])

    assert (response.status_code, response.json()["detail"]) == (409, scorecards.ANSWERED["CANCELLED"])
    assert _row(rentals, created["id"])["answers"] is None
    assert notices(rentals, TENANT) == []


def test_the_notices_follow_each_persons_review_switch(client, rentals, as_profile):
    rentals.tables["users"][:] = [
        {**row, "metadata": {"notification_preferences": {"review": False}}} if row["id"] in (OWNER, TENANT) else row
        for row in rentals.tables["users"]
    ]
    created = _ask(client, as_profile)

    assert _submit(client, as_profile, created["id"]).status_code == 200
    assert notices(rentals, OWNER) == [] and notices(rentals, TENANT) == []


# ---------------------------------------------------------------------------
# Lists
# ---------------------------------------------------------------------------
def test_each_side_lists_its_own_requests_newest_first(client, rentals, as_profile):
    harbour = _ask(client, as_profile)
    beach = _ask(client, as_profile, OWNER, LEASED_HOME)
    for_agent = _ask(client, as_profile, AGENT, HOME)
    for row, at in zip(requests(rentals), ("2026-03-01T00:00:00+00:00", "2026-03-02T00:00:00+00:00",
                                           "2026-03-03T00:00:00+00:00")):
        row["requested_at"] = at

    _as_tenant(as_profile)
    assert [r["id"] for r in client.get(MINE).json()] == [for_agent["id"], beach["id"], harbour["id"]]
    _as_owner(as_profile)
    assert [r["id"] for r in client.get(MINE).json()] == [beach["id"], harbour["id"]]
    _as_owner(as_profile, AGENT)
    assert [r["id"] for r in client.get(MINE).json()] == [for_agent["id"]]
    _as_owner(as_profile, STRANGER)
    assert client.get(MINE).json() == []
    _as_tenant(as_profile, OTHER_TENANT)
    assert client.get(MINE).json() == []


# ---------------------------------------------------------------------------
# The public profile
# ---------------------------------------------------------------------------
def _completed(client, as_profile, owner_id=OWNER, property_id=HOME, answers=ANSWERS) -> dict:
    created = _ask(client, as_profile, owner_id, property_id)
    response = _submit(client, as_profile, created["id"], answers=answers, owner_id=owner_id)
    assert response.status_code == 200, response.text
    return response.json()


def _show(client, as_profile, request_id, visible=True):
    _as_tenant(as_profile)
    return client.patch(f"{API}/scorecard-requests/{request_id}", json={"visible_on_profile": visible})


def test_a_completed_scorecard_shows_on_the_public_profile_only_once_the_tenant_allows_it(client, rentals, as_profile):
    done = _completed(client, as_profile)
    assert client.get(f"{PUBLIC}/{TENANT}").json()["scorecard"] is None

    shown = _show(client, as_profile, done["id"])

    assert shown.status_code == 200, shown.text
    assert shown.json()["visible_on_profile"] is True and _row(rentals, done["id"])["visible_on_profile"] is True
    assert client.get(f"{PUBLIC}/{TENANT}").json()["scorecard"] == {"average": 4.57, "count": 1}
    _as_owner(as_profile)
    assert client.get(f"{API}/scorecard-requests/{done['id']}").json()["visible_on_profile"] is None
    assert client.get(MINE).json()[0]["visible_on_profile"] is None
    assert _show(client, as_profile, done["id"], visible=False).json()["visible_on_profile"] is False
    assert client.get(f"{PUBLIC}/{TENANT}").json()["scorecard"] is None
    assert "scorecard.visibility_changed" in _audit(rentals)


def test_the_profile_averages_only_the_completed_scorecards_the_tenant_shows(client, rentals, as_profile):
    five = _completed(client, as_profile, answers={key: 5 for key in ANSWERS})
    four = _completed(client, as_profile, OWNER, LEASED_HOME, answers={key: 4 for key in ANSWERS})
    hidden = _completed(client, as_profile, AGENT, HOME, answers={key: 1 for key in ANSWERS})
    for request_id in (five["id"], four["id"]):
        assert _show(client, as_profile, request_id).status_code == 200
    # A request still waiting counts for nothing, whatever its row says (as another app might leave one).
    rentals.seed("scorecard_requests", [{
        **_row(rentals, five["id"]), "id": "e8000000-0000-4000-8000-000000000009", "status": "PENDING",
        "answers": None, "completed_at": None, "decided_at": None, "visible_on_profile": True,
    }], schema="web")

    profile = client.get(f"{PUBLIC}/{TENANT}").json()

    assert profile["scorecard"] == {"average": 4.5, "count": 2}
    assert _row(rentals, hidden["id"])["visible_on_profile"] is False


def test_an_owner_counts_once_per_home_on_the_profile(client, rentals, as_profile):
    done = _completed(client, as_profile, answers={key: 5 for key in ANSWERS})
    assert _show(client, as_profile, done["id"]).status_code == 200
    # An older scorecard about the same tenancy, as another app might have left one: the newest counts.
    rentals.seed("scorecard_requests", [{
        **_row(rentals, done["id"]), "id": "e8000000-0000-4000-8000-000000000008",
        "answers": {key: 1 for key in ANSWERS}, "completed_at": "2025-06-01T00:00:00+00:00",
    }], schema="web")

    assert client.get(f"{PUBLIC}/{TENANT}").json()["scorecard"] == {"average": 5.0, "count": 1}


def test_a_tenant_who_does_not_share_their_score_shows_no_scorecard(client, rentals, as_profile):
    done = _completed(client, as_profile)
    assert _show(client, as_profile, done["id"]).status_code == 200
    rentals.tables["users"][:] = [
        {**row, "metadata": {"privacy": {"share_score": False}}} if row["id"] == TENANT else row
        for row in rentals.tables["users"]
    ]

    assert client.get(f"{PUBLIC}/{TENANT}").json()["scorecard"] is None


def test_the_public_profile_shows_no_owner_rating_or_comment(client, rentals, as_profile):
    done = _completed(client, as_profile)
    _show(client, as_profile, done["id"])

    text = client.get(f"{PUBLIC}/{TENANT}").text

    for secret in ("Olivia", OWNER, "Always on time", "paid_rent_on_time", "answers", "Harbour Street", done["id"]):
        assert secret not in text
    # Nor do the search cards, or a landlord's profile, carry a scorecard.
    assert all("scorecard" not in card for card in client.get(PUBLIC).json()["items"])
    assert client.get(f"{PUBLIC}/{OWNER}").json()["scorecard"] is None


def test_only_a_completed_scorecard_can_go_on_the_profile(client, rentals, as_profile):
    waiting = _ask(client, as_profile)
    declined = _ask(client, as_profile, AGENT, HOME)
    _as_owner(as_profile, AGENT)
    client.post(f"{API}/scorecard-requests/{declined['id']}/decline", json={})

    for request_id in (waiting["id"], declined["id"]):
        response = _show(client, as_profile, request_id)
        assert (response.status_code, response.json()["detail"]) == (409, scorecards.NOT_COMPLETED)
    assert {row["visible_on_profile"] for row in requests(rentals)} == {False}
    not_a_switch = client.patch(f"{API}/scorecard-requests/{waiting['id']}", json={"visible_on_profile": "yes"})
    assert not_a_switch.status_code == 422


def test_a_stored_answer_the_web_cannot_read_is_left_out_of_the_average(rentals):
    stored = {**ANSWERS, "paid_rent_on_time": "5", "kept_a_pet": 1, "would_rent_again": 9}

    answers, average = scorecards.answers_of(stored)

    assert [answer["key"] for answer in answers] == [
        "looked_after_property", "communicated_respectfully", "followed_lease_conditions",
        "cooperated_with_inspections", "left_property_in_good_condition",
    ]
    assert average == round(22 / 5, 2)
    assert scorecards.answers_of(None) == ([], None) and scorecards.answers_of({}) == ([], None)


def test_the_items_are_the_ones_docs_shared_db_lists_in_their_order():
    # The web's form reads the same list (frontend/app/lib/scorecards.ts), checked against the doc too.
    doc = " ".join((Path(__file__).resolve().parents[2] / "docs" / "shared-db.md").read_text(encoding="utf-8").split())
    listed = re.search(r"The seven items, in their order, are (.+?) \(", doc).group(1)

    assert re.findall(r"`(\w+)`", listed) == [key for key, _ in ITEMS] == list(ScorecardAnswers.model_fields)
    assert len(ITEMS) == 7 and ITEMS[-1][1] == "Would you rent to this tenant again?"
