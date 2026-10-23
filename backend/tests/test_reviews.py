"""Reviews on the shared schema: listed, answered and reported.

Regression cover for the shared-schema port: hidden and archived reviews
were listed; a reply never moved updated_at or told the reviewer; and
reporting a review wrote to an audit table the shared database lacks, so
every report answered 503 and never reached the mobile app's moderators.
A report now goes through mobile_report_review alone, which keeps it in
media_urls.reports. Only the party a review is about (or staff) reports
from their reviews page (PATCH /flag), whose answer names the reviewer.
Writing a property review is tests/test_property_reviews.py.
"""

import logging

import pytest
from postgrest.exceptions import APIError

from app.services import notifications, reviews
from tests.factories_reviews_complaints import NOW, provider_profile, review, seed_rental, user
from tests.fake_supabase import FakeRpcQuery, FakeTableQuery

pytestmark = pytest.mark.usefixtures("strict_schema")

TENANT = "c0000000-0000-4000-8000-000000000001"
NEIGHBOUR = "c0000000-0000-4000-8000-000000000002"
FORMER_TENANT = "c0000000-0000-4000-8000-000000000003"
LANDLORD = "d0000000-0000-4000-8000-000000000001"
AGENT = "d0000000-0000-4000-8000-000000000004"
ADMIN = "d0000000-0000-4000-8000-000000000002"
OFFICER = "d0000000-0000-4000-8000-000000000003"
PROVIDER = "a0000000-0000-4000-8000-000000000003"
RIVAL = "a0000000-0000-4000-8000-000000000002"
PROPERTY = "b0000000-0000-4000-8000-000000000001"
LISTING = "b0000000-0000-4000-8000-000000000002"
PROPERTY_REVIEW = "f0000000-0000-4000-8000-000000000001"
REPORTED_PROPERTY_REVIEW = "f0000000-0000-4000-8000-000000000002"
ARCHIVED_REVIEW = "f0000000-0000-4000-8000-000000000003"
PROVIDER_REVIEW = "f0000000-0000-4000-8000-000000000004"
REPORTED_PROVIDER_REVIEW = "f0000000-0000-4000-8000-000000000005"
HIDDEN_REVIEW = "f0000000-0000-4000-8000-000000000006"
EARLIER, LATER = "2025-12-01T00:00:00+00:00", "2026-02-01T00:00:00+00:00"
API = "/api/v1"


@pytest.fixture
def people(strict_schema):
    """A landlord's flat (listed by their agent) and a cleaning provider, with reviews in each status."""
    strict_schema.seed("users", [
        user(TENANT, "Jonathan Hayes", metadata={"location": "Newtown"}),
        user(NEIGHBOUR, "Nina Neighbour"),
        user(FORMER_TENANT, "Fay Former"),
        user(LANDLORD, "Olivia Owner", "LANDLORD"),
        user(AGENT, "Alex Agent", "AGENT"),
        user(PROVIDER, "Priya Shah", "SERVICE_PROVIDER"),
        user(RIVAL, "Sam Rival", "SERVICE_PROVIDER"),
        user(ADMIN, "Ada Admin", "ADMIN"),
        user(OFFICER, "Omar Officer", "REGULATOR"),
    ])
    # Each signs in with jwt-<id>: the shared functions take the caller from it.
    for row in strict_schema.tables["users"]:
        row["auth_user_id"] = row["id"]
        strict_schema.tokens[token(row["id"])] = row["id"]
    seed_rental(strict_schema, LANDLORD, PROPERTY, LISTING, created_by=AGENT)
    strict_schema.seed("service_provider_profiles", [
        provider_profile(PROVIDER, "Shah Cleaning", metadata={"slug": "shah-cleaning", "is_published": True}),
    ])
    strict_schema.seed("reviews", [
        review(PROPERTY_REVIEW, TENANT, LANDLORD, 4, property_id=PROPERTY, title="Property review",
               body="Responsive landlord."),
        review(REPORTED_PROPERTY_REVIEW, NEIGHBOUR, LANDLORD, 1, property_id=PROPERTY, body="Never again.",
               status="FLAGGED", created_at=EARLIER),
        # One review per reviewer and property (reviews_property_id_reviewer_user_id_key).
        review(ARCHIVED_REVIEW, FORMER_TENANT, LANDLORD, 2, property_id=PROPERTY, body="Old tenancy.",
               status="ARCHIVED"),
        review(PROVIDER_REVIEW, TENANT, PROVIDER, 5, title="End-of-lease clean", body="Spotless end-of-lease clean.",
               created_at=LATER),
        review(REPORTED_PROVIDER_REVIEW, NEIGHBOUR, PROVIDER, 1, body="Rude.", status="FLAGGED"),
        review(HIDDEN_REVIEW, TENANT, PROVIDER, 1, body="Taken down.", status="HIDDEN"),
    ])
    return strict_schema


@pytest.fixture
def notices(monkeypatch):
    """The notifications the code sends, as notify() is called."""
    sent = []
    monkeypatch.setattr(notifications, "notify", lambda *args: sent.append(args))
    return sent


def token(user_id: str) -> str:
    return f"jwt-{user_id}"


def _stored(db, review_id) -> dict:
    return next(row for row in db.tables["reviews"] if row["id"] == review_id)


def _ids(response) -> list[str]:
    assert response.status_code == 200, response.text
    return [r["id"] for r in response.json()]


def test_a_property_is_reviewed_with_the_review_form_only(client, as_profile, people):
    # A score and a comment are not a property review: mobile_submit_review asks for all eight ratings.
    as_profile(id=TENANT, role="tenant", access_token=token(TENANT))

    response = client.post(f"{API}/reviews", json={"property_id": LISTING, "rating": 4, "comment": "Good view."})

    assert response.status_code == 422
    assert len(people.tables["reviews"]) == 6 and people.rpc_calls == []


def test_a_propertys_public_reviews_name_no_reviewer(client, people):
    next(row for row in people.tables["reviews"] if row["id"] == PROPERTY_REVIEW)["is_verified_interaction"] = True
    response = client.get(f"{API}/properties/{LISTING}/reviews")

    assert response.status_code == 200, response.text
    [shown] = response.json()
    assert shown["client_name"] == "Verified tenant"
    assert shown["client_avatar_url"] is None
    assert {"client_id", "booking_id"}.isdisjoint(shown)
    reviewer = next(row for row in people.tables["users"] if row["id"] == TENANT)
    assert reviewer["full_name"] not in response.text and TENANT not in response.text
    # Without a verified tenancy the reviewer is a tenant, still unnamed.
    next(row for row in people.tables["reviews"] if row["id"] == PROPERTY_REVIEW)["is_verified_interaction"] = False
    assert client.get(f"{API}/properties/{LISTING}/reviews").json()[0]["client_name"] == "Tenant"


def test_a_propertys_public_list_shows_its_published_reviews(client, people):
    # What the listing's review counts count: reported, archived and hidden ones are left out.
    assert _ids(client.get(f"{API}/properties/{LISTING}/reviews")) == [PROPERTY_REVIEW]
    assert _ids(client.get(f"{API}/properties/{PROPERTY}/reviews")) == [PROPERTY_REVIEW]


@pytest.mark.parametrize("user_id, role, listed", [
    (LANDLORD, "landlord", [(PROPERTY_REVIEW, False), (REPORTED_PROPERTY_REVIEW, True)]),
    (PROVIDER, "service_provider", [(PROVIDER_REVIEW, False), (REPORTED_PROVIDER_REVIEW, True)]),
    (TENANT, "tenant", [(PROVIDER_REVIEW, False), (PROPERTY_REVIEW, False)]),  # the ones they wrote
])
def test_my_reviews_leave_out_what_moderators_took_down(client, as_profile, people, user_id, role, listed):
    as_profile(id=user_id, role=role)
    response = client.get(f"{API}/me/reviews")
    assert response.status_code == 200, response.text
    assert [(r["id"], r["is_flagged"]) for r in response.json()] == listed


def test_a_providers_public_reviews_are_the_ones_left_up(client, people):
    response = client.get(f"{API}/providers/shah-cleaning/reviews")
    assert _ids(response) == [PROVIDER_REVIEW, REPORTED_PROVIDER_REVIEW]
    first = response.json()[0]
    assert (first["comment"], first["service_title"], first["client_name"]) == (
        "Spotless end-of-lease clean.", "End-of-lease clean", "Tenant",
    )
    assert "client_id" not in first and "is_flagged" not in first


@pytest.mark.parametrize("stored_name", ["Jonathan Hayes", "tina.tenant@example.test", "0412 345 678"])
def test_a_providers_public_reviews_name_no_reviewer(client, people, stored_name):
    # Some accounts keep their email or phone as their name; signed out, nobody reads any of it.
    reviewer = next(row for row in people.tables["users"] if row["id"] == TENANT)
    reviewer.update(full_name=stored_name, avatar_url="https://example.test/jonathan.jpg")
    _stored(people, PROVIDER_REVIEW)["is_verified_interaction"] = True
    people.seed("reviews", [review("f0000000-0000-4000-8000-000000000007", LANDLORD, PROVIDER, 4, body="On time.")])

    response = client.get(f"{API}/providers/shah-cleaning/reviews")

    assert response.status_code == 200, response.text
    shown = {r["id"]: r for r in response.json()}
    # By role alone, as on a public profile: "Verified" after a booking.
    assert shown[PROVIDER_REVIEW]["client_name"] == "Verified tenant"
    assert shown[REPORTED_PROVIDER_REVIEW]["client_name"] == "Tenant"
    assert shown["f0000000-0000-4000-8000-000000000007"]["client_name"] == "Landlord"
    assert all((r["client_avatar_url"], r["location"]) == (None, None) for r in shown.values())
    for private in (stored_name, "Jonathan", "Nina Neighbour", "Olivia Owner", "Newtown", "jonathan.jpg", TENANT,
                    NEIGHBOUR, LANDLORD):
        assert private not in response.text


@pytest.mark.parametrize("user_id, role, review_id, title, link", [
    (PROVIDER, "service_provider", PROVIDER_REVIEW, "Shah Cleaning replied to your review", "/providers/shah-cleaning"),
])
def test_the_reviewed_party_replies_and_the_reviewer_is_told(
    client, as_profile, people, notices, user_id, role, review_id, title, link
):
    # A landlord answers a property review through reply_to_listing_review (test_property_reviews.py).
    as_profile(id=user_id, role=role)

    reply = client.patch(f"{API}/reviews/{review_id}/reply", json={"provider_reply": "Thank you!"})

    assert reply.status_code == 200, reply.text
    assert reply.json()["provider_reply"] == "Thank you!" and reply.json()["replied_at"]
    stored = _stored(people, review_id)
    assert stored["landlord_reply"] == "Thank you!"
    assert stored["updated_at"] == stored["landlord_replied_at"] != NOW
    assert notices == [(TENANT, "review", title, "Thank you!", link)]
    [listed] = [r for r in client.get(f"{API}/me/reviews").json() if r["id"] == review_id]
    assert listed["provider_reply"] == "Thank you!"


@pytest.mark.parametrize("user_id, role, review_id", [
    (RIVAL, "service_provider", PROVIDER_REVIEW),
    (PROVIDER, "service_provider", PROPERTY_REVIEW),
    (LANDLORD, "landlord", PROVIDER_REVIEW),
])
def test_nobody_else_can_reply(client, as_profile, people, notices, user_id, role, review_id):
    as_profile(id=user_id, role=role)
    assert client.patch(f"{API}/reviews/{review_id}/reply", json={"provider_reply": "Hi"}).status_code == 403
    assert _stored(people, review_id)["landlord_reply"] is None and notices == []


@pytest.mark.parametrize("action, payload", [("reply", {"provider_reply": "Hi"}), ("flag", None)])
def test_a_review_taken_down_cannot_be_answered_or_reported(client, as_profile, people, notices, action, payload):
    as_profile(id=PROVIDER, role="service_provider")
    assert client.patch(f"{API}/reviews/{HIDDEN_REVIEW}/{action}", json=payload).status_code == 404
    assert _stored(people, HIDDEN_REVIEW)["landlord_reply"] is None
    assert people.rpc_calls == [] and notices == []


@pytest.mark.parametrize("user_id, role, review_id", [
    (LANDLORD, "landlord", PROPERTY_REVIEW),
    (PROVIDER, "service_provider", PROVIDER_REVIEW),
    (ADMIN, "admin", PROVIDER_REVIEW),
    (OFFICER, "officer", PROPERTY_REVIEW),
])
def test_a_report_goes_to_moderation_and_reads_back_as_reported(client, as_profile, people, user_id, role, review_id):
    as_profile(id=user_id, role=role, access_token=token(user_id))

    response = client.patch(f"{API}/reviews/{review_id}/flag")

    assert response.status_code == 200, response.text
    assert response.json()["is_flagged"] is True
    # The mobile moderation RPC runs as the reporter and keeps the report; the status stays the moderators'.
    assert people.rpc_calls == [("mobile_report_review", {
        "p_review_id": review_id, "p_reason": reviews.REPORT_REASON, "p_details": reviews.REPORT_DETAILS,
    })]
    assert people.rpc_callers == [("mobile_report_review", user_id)]
    stored = _stored(people, review_id)
    assert stored["status"] == "PUBLISHED"
    [report] = stored["media_urls"]["reports"]
    assert (report["userId"], report["reason"], report["details"]) == (
        user_id, reviews.REPORT_REASON, reviews.REPORT_DETAILS)
    assert not people.tables.get("mobile_admin_audit_entries")
    # The function told the admins.
    assert [n["title"] for n in people.tables["notifications"] if n["user_id"] == ADMIN] == ["Review reported"]
    if role in ("landlord", "service_provider"):
        flagged = {r["id"]: r["is_flagged"] for r in client.get(f"{API}/me/reviews").json()}
        assert flagged[review_id] is True


@pytest.mark.parametrize("user_id, role, review_id", [
    (TENANT, "tenant", PROVIDER_REVIEW),  # the reviewer
    (RIVAL, "service_provider", PROVIDER_REVIEW),
    (PROVIDER, "service_provider", PROPERTY_REVIEW),
])
def test_only_the_reviewed_party_or_staff_can_report(client, as_profile, people, user_id, role, review_id):
    as_profile(id=user_id, role=role)
    assert client.patch(f"{API}/reviews/{review_id}/flag").status_code == 403
    assert people.rpc_calls == [] and not people.tables.get("mobile_admin_audit_entries")


def test_a_review_already_reported_is_not_reported_again(client, as_profile, people):
    as_profile(id=PROVIDER, role="service_provider", access_token=token(PROVIDER))
    for review_id in (PROVIDER_REVIEW, PROVIDER_REVIEW, REPORTED_PROVIDER_REVIEW):  # flagged in the mobile app
        response = client.patch(f"{API}/reviews/{review_id}/flag")
        assert response.status_code == 200, response.text
        assert response.json()["is_flagged"] is True
    assert [params["p_review_id"] for _, params in people.rpc_calls] == [PROVIDER_REVIEW]
    assert len(_stored(people, PROVIDER_REVIEW)["media_urls"]["reports"]) == 1


def test_a_report_moderation_refused_is_an_error_and_records_nothing(client, as_profile, people, monkeypatch):
    refused = APIError({"code": "P0001", "message": "You cannot report this review"})
    monkeypatch.setattr(people, "rpc", lambda name, params=None: FakeRpcQuery(error=refused))
    as_profile(id=PROVIDER, role="service_provider", access_token=token(PROVIDER))

    assert client.patch(f"{API}/reviews/{PROVIDER_REVIEW}/flag").status_code == 500
    assert _stored(people, PROVIDER_REVIEW)["media_urls"] is None
    flagged = {r["id"]: r["is_flagged"] for r in client.get(f"{API}/me/reviews").json()}
    assert flagged[PROVIDER_REVIEW] is False


@pytest.fixture
def decision_reads(monkeypatch):
    """Reads of the decisions on reports; set error to make each one fail with that code."""
    execute = FakeTableQuery.execute
    reads: list = []
    state = {"error": None}

    def _execute(query):
        if query._name == reviews.DECISIONS_TABLE and query._op == "select":
            reads.append(query)
            if state["error"]:
                raise APIError({"code": state["error"], "message": "decision read failed"})
        return execute(query)

    monkeypatch.setattr(FakeTableQuery, "execute", _execute)
    return reads, state


def _report(db, review_id, reporter, reported_at) -> None:
    _stored(db, review_id)["media_urls"] = {"reports": [
        {"userId": reporter, "reason": "spam", "reportedAt": reported_at}]}


def test_the_public_review_list_never_reads_reports(client, people, decision_reads):
    reads, state = decision_reads
    state["error"] = "57014"  # statement timeout
    _report(people, PROVIDER_REVIEW, RIVAL, LATER)
    assert _ids(client.get(f"{API}/providers/shah-cleaning/reviews")) == [PROVIDER_REVIEW, REPORTED_PROVIDER_REVIEW]
    assert reads == []


def test_a_report_decided_by_an_admin_no_longer_flags_the_review(client, as_profile, people):
    # A decision before the web cleared reports left this one in place; the decision after it settles it.
    _report(people, PROVIDER_REVIEW, RIVAL, EARLIER)
    people.seed("mobile_admin_audit_entries", [{
        "id": "e0000000-0000-4000-8000-000000000001", "actor_user_id": ADMIN, "action": "review.moderated",
        "entity_type": "review", "entity_id": PROVIDER_REVIEW, "summary": "Kept", "metadata": {"decision": "kept"},
        "created_at": "2026-01-15T00:00:00+00:00",
    }])
    as_profile(id=PROVIDER, role="service_provider")

    flagged = {r["id"]: r["is_flagged"] for r in client.get(f"{API}/me/reviews").json()}
    assert flagged[PROVIDER_REVIEW] is False

    _report(people, PROVIDER_REVIEW, RIVAL, LATER)
    flagged = {r["id"]: r["is_flagged"] for r in client.get(f"{API}/me/reviews").json()}
    assert flagged[PROVIDER_REVIEW] is True


def test_a_failed_decision_read_lists_every_report_as_waiting(client, as_profile, people, decision_reads, caplog):
    reads, state = decision_reads
    _report(people, PROVIDER_REVIEW, RIVAL, EARLIER)
    as_profile(id=PROVIDER, role="service_provider")
    state["error"] = "57014"

    with caplog.at_level(logging.WARNING, logger="app.services.reviews"):
        listed = client.get(f"{API}/me/reviews")

    assert listed.status_code == 200, listed.text
    assert [(r["id"], r["is_flagged"]) for r in listed.json()] == [(PROVIDER_REVIEW, True), (REPORTED_PROVIDER_REVIEW, True)]
    assert "could not read review decisions" in caplog.text
    assert len(reads) == 1
