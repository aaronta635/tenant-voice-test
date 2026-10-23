"""The review report queue (tracker R40; handover package 7 step 5, package 8 step 3).

A review waits for a decision while it is FLAGGED or holds a report
(media_urls.reports, kept by mobile_report_review from either app) newer
than its last decision. Hiding it takes it out of every public list;
keeping or restoring it publishes it. Each decision goes through
mobile_admin_moderate_review, run as the admin, and clears the reports;
the review stays, each decision keeps the reports it closed and names its
admin and reason in both audit logs, the reviewer is told of each change
to their review, and the people whose report was decided are told the
outcome.

mobile_admin_moderate_review, as it stands, raises P0002 on every call that
passes its checks (tests/fake_rpcs/fa_reviews.py), so the web applies the
same update itself; the `fixed` fixture runs the function as it will work
once mended.
"""

import json

import pytest

from app.services import admin_moderation
from tests import fake_rpcs
from tests.factories_admin import audit_entry, bearer, named_trail, shared_trail
from tests.factories_identity import users_row
from tests.factories_reviews_complaints import review, seed_rental
from tests.fake_rpcs import fa_reviews
from tests.fake_supabase import api_error

pytestmark = pytest.mark.usefixtures("strict_schema")

ADMIN = "a4000000-0000-4000-8000-000000000001"
MIA = "b4000000-0000-4000-8000-000000000001"
NOAH = "b4000000-0000-4000-8000-000000000002"
OWNER = "b4000000-0000-4000-8000-000000000003"
PROPERTY = "c4000000-0000-4000-8000-000000000001"
LISTING = "c4000000-0000-4000-8000-000000000002"
# A reviewer reviews a property once (reviews_property_id_reviewer_user_id_key): their other review is of this one.
STUDIO = "c4000000-0000-4000-8000-000000000003"
STUDIO_LISTING = "c4000000-0000-4000-8000-000000000004"
REPORTED = "d4000000-0000-4000-8000-000000000001"
FLAGGED = "d4000000-0000-4000-8000-000000000002"
QUIET = "d4000000-0000-4000-8000-000000000003"
HIDDEN = "d4000000-0000-4000-8000-000000000004"

API = "/api/v1/admin/reviews"


def at(day: int) -> str:
    """A December day, before the fake's clock (2026-01-01) dates what the tests do."""
    return f"2025-12-{day:02d}T00:00:00+00:00"


def report(user_id, reason="misleading", details=None, reported_at=at(7)) -> dict:
    """A report as mobile_report_review keeps it in media_urls.reports."""
    return {"userId": user_id, "reason": reason, "reportedAt": reported_at, **({"details": details} if details else {})}


@pytest.fixture
def db(strict_schema):
    strict_schema.seed("users", [
        users_row(MIA, "mia@example.test", full_name="Mia Tenant"),
        users_row(NOAH, "noah@example.test", full_name="Noah Tenant"),
        users_row(OWNER, "oliver@example.test", "LANDLORD", full_name="Oliver Grant"),
    ])
    seed_rental(strict_schema, OWNER, PROPERTY, LISTING, title="Harbour flat")
    seed_rental(strict_schema, OWNER, STUDIO, STUDIO_LISTING, title="Garden studio")
    strict_schema.seed("reviews", [
        # The owner reported Mia's review.
        review(REPORTED, MIA, OWNER, 1, property_id=PROPERTY, body="The owner is a crook.", created_at=at(2),
               media_urls={"photos": [f"{MIA}/front.png"], "reports": [report(OWNER, "offensive", "Defamatory.")],
                           "mobile": {"ratings": {"costValue": 1}, "maintenanceOrEvictionIssue": True}}),
        review(FLAGGED, NOAH, OWNER, 2, property_id=PROPERTY, body="Mould everywhere.", status="FLAGGED",
               created_at=at(3), updated_at=at(4)),
        review(QUIET, NOAH, OWNER, 5, property_id=STUDIO, body="Great place.", created_at=at(5),
               media_urls={"reports": []}),
        review(HIDDEN, MIA, OWNER, 1, property_id=STUDIO, body="Spam spam spam.", status="HIDDEN",
               created_at=at(1), updated_at=at(6), media_urls={"reports": [report(NOAH, "spam")]}),
    ])
    strict_schema.storage.objects[("review-photos", f"{MIA}/front.png")] = b"\x89PNG"
    return strict_schema


@pytest.fixture
def admin(client, db):
    return bearer(db, ADMIN, "ada@example.test", "ADMIN", full_name="Ada Admin")


@pytest.fixture
def fixed(monkeypatch):
    """mobile_admin_moderate_review as it works once its FOUND check is mended."""
    monkeypatch.setattr(fa_reviews, "MODERATION_FOUND_AFTER_EXECUTE", True)


def queue(client, admin, view="reported") -> dict:
    response = client.get(API, params={"view": view}, headers=admin)
    assert response.status_code == 200, response.text
    return response.json()


def decide(client, admin, review_id, action, reason="Breaks the review rules.", **extra):
    return client.post(f"{API}/{review_id}/moderation", json={"action": action, "reason": reason, **extra},
                       headers=admin)


def row_of(db, review_id) -> dict:
    return next(row for row in db.tables["reviews"] if row["id"] == review_id)


def status_of(db, review_id) -> str:
    return row_of(db, review_id)["status"]


def notices(db, user_id) -> list[tuple[str, str]]:
    return [(n["title"], n["body"]) for n in db.tables.get("notifications", []) if n["user_id"] == user_id]


def public_bodies(client) -> set[str]:
    on_listing = {r["comment"] for r in client.get(f"/api/v1/properties/{LISTING}/reviews").json()}
    profile = client.get(f"/api/v1/public/profiles/{OWNER}").json()
    on_profile = {r["body"] for r in profile["reviews"]}
    # The listing shows published reviews; the profile those and the reported ones, marked.
    assert on_listing <= on_profile
    return on_profile


def moderation_calls(db) -> list[tuple[dict, str | None]]:
    return [(params, caller) for (name, params), (_, caller) in zip(db.rpc_calls, db.rpc_callers)
            if name == "mobile_admin_moderate_review"]


def test_the_queue_lists_the_reviews_waiting_for_a_decision(client, db, admin):
    body = queue(client, admin)

    assert [item["id"] for item in body["items"]] == [REPORTED, FLAGGED]
    assert (body["total"], body["counts"]) == (2, {"reported": 2, "hidden": 1})
    reported = body["items"][0]
    assert (reported["status"], reported["body"], reported["open_reports"], reported["property_title"]) == (
        "PUBLISHED", "The owner is a crook.", 1, "Harbour flat")
    assert reported["reviewer"] == {"id": MIA, "full_name": "Mia Tenant", "role": "tenant"}
    [shown] = reported["reports"]
    assert (shown["reporter"]["full_name"], shown["reason"], shown["details"], shown["open"]) == (
        "Oliver Grant", "offensive", "Defamatory.", True)
    # Admins see what visitors never do: the private answer, and the photos through short-lived links.
    assert reported["details"]["maintenance_or_eviction_issue"] is True
    assert reported["ratings"] == {"costValue": 1}
    assert reported["photo_count"] == 1 and reported["photos"][0]["expires_in"] == 600
    # Reported with no report kept: FLAGGED.
    assert (body["items"][1]["status"], body["items"][1]["reports"]) == ("FLAGGED", [])
    assert [item["id"] for item in queue(client, admin, "hidden")["items"]] == [HIDDEN]


def test_hiding_a_review_takes_it_out_of_public_results_and_keeps_the_evidence(client, db, admin):
    assert "The owner is a crook." in public_bodies(client)

    response = decide(client, admin, REPORTED, "hide", "  Personal attack on the owner. ", expected_status="PUBLISHED")

    assert response.status_code == 200, response.text
    assert (response.json()["status"], response.json()["open_reports"]) == ("HIDDEN", 0)
    # Asked of the shared function, as the admin.
    [(params, caller)] = moderation_calls(db)
    assert params == {"p_review_id": REPORTED, "p_action": "HIDE"}
    assert caller == db.tokens[admin["Authorization"].removeprefix("Bearer ")]
    row = row_of(db, REPORTED)
    assert (row["status"], row["media_urls"]["reports"]) == ("HIDDEN", [])
    assert "The owner is a crook." not in public_bodies(client)
    assert client.get(f"/api/v1/public/profiles/{OWNER}").json()["review_count"] == 2
    # The evidence stays: the review, and the reports the decision closed.
    assert (row["body"], row["rating"], row["reviewer_user_id"]) == ("The owner is a crook.", 1, MIA)
    assert row["media_urls"]["photos"] == [f"{MIA}/front.png"]
    [entry] = shared_trail(db, "review.moderated")
    assert (entry["actor_user_id"], entry["entity_type"], entry["entity_id"]) == (ADMIN, "review", REPORTED)
    assert entry["summary"] == "Hid Mia Tenant's review of Harbour flat: Personal attack on the owner."
    assert {key: entry["metadata"][key] for key in ("decision", "from_status", "to_status", "reason", "reports")} == {
        "decision": "hidden", "from_status": "PUBLISHED", "to_status": "HIDDEN",
        "reason": "Personal attack on the owner.", "reports": 1}
    assert entry["metadata"]["decided_reports"] == [report(OWNER, "offensive", "Defamatory.")]
    assert [(e["actor_id"], e["action"], e["metadata"]["reason"]) for e in named_trail(db)] == [
        (ADMIN, "review.moderated", "Personal attack on the owner.")]
    hidden = queue(client, admin, "hidden")
    assert [item["id"] for item in hidden["items"]] == [REPORTED, HIDDEN]
    kept = hidden["items"][0]
    assert [(r["details"], r["open"]) for r in kept["reports"]] == [("Defamatory.", False)]
    assert [(d["decision"], d["reason"], d["actor"]["full_name"]) for d in kept["decisions"]] == [
        ("hidden", "Personal attack on the owner.", "Ada Admin")]
    assert hidden["counts"] == {"reported": 1, "hidden": 2}
    # The reviewer is told why; the reporter what became of it.
    assert notices(db, MIA) == [("Your review was hidden", "A TenantVoice admin hid your review of Harbour flat. "
                                                           "Reason: Personal attack on the owner.")]
    assert notices(db, OWNER) == [("We checked a review you reported", "A TenantVoice admin hid it.")]


def test_once_the_function_is_mended_its_own_update_stands(client, db, admin, fixed):
    response = decide(client, admin, REPORTED, "hide", "Personal attack.")

    assert response.status_code == 200, response.text
    row = row_of(db, REPORTED)
    assert (row["status"], row["media_urls"]["reports"]) == ("HIDDEN", [])
    # Its log entry, and the web's with the reason.
    [logged] = shared_trail(db, "MODERATE_REVIEW")
    assert (logged["actor_user_id"], logged["entity_id"], logged["metadata"]) == (
        ADMIN, REPORTED, {"action": "HIDE", "status": "HIDDEN"})
    [entry] = shared_trail(db, "review.moderated")
    assert entry["metadata"]["decided_reports"] == [report(OWNER, "offensive", "Defamatory.")]
    assert [item["id"] for item in queue(client, admin)["items"]] == [FLAGGED]


@pytest.mark.parametrize("code, message, status_code", [
    ("42501", "You need admin privileges to access this page.", 403),
    ("22023", "Unsupported moderation action.", 422),
])
def test_a_decision_the_function_refuses_changes_nothing(client, db, admin, monkeypatch, code, message, status_code):
    def refuse(ctx, params):
        raise api_error(code, message)

    fake_rpcs.handler("mobile_admin_moderate_review")  # registers every stand-in first
    monkeypatch.setitem(fake_rpcs._STAND_INS, "mobile_admin_moderate_review", refuse)

    response = decide(client, admin, REPORTED, "hide")

    assert (response.status_code, response.json()["detail"]) == (status_code, message)
    assert status_of(db, REPORTED) == "PUBLISHED" and len(row_of(db, REPORTED)["media_urls"]["reports"]) == 1
    assert not shared_trail(db, "review.moderated") and not db.tables.get("notifications")


def test_a_providers_review_in_the_queue_carries_no_property_details(client, db, admin):
    provider = "b4000000-0000-4000-8000-000000000004"
    db.seed("users", [users_row(provider, "pat@example.test", "SERVICE_PROVIDER", full_name="Pat Plumbing")])
    about = "d4000000-0000-4000-8000-000000000005"
    db.seed("reviews", [review(about, MIA, provider, 1, body="Never turned up.", status="FLAGGED", created_at=at(8))])

    [item] = [item for item in queue(client, admin)["items"] if item["id"] == about]

    assert (item["details"], item["ratings"], item["property_id"]) == (None, {}, None)
    # A property review keeps its details.
    [reported] = [item for item in queue(client, admin)["items"] if item["id"] == REPORTED]
    assert reported["details"]["maintenance_or_eviction_issue"] is True


@pytest.mark.parametrize("full_name", [None, "private.provider@example.test", "0400 123 456"])
def test_the_reviewers_notice_never_names_the_member_by_their_email_or_phone(client, db, admin, full_name):
    provider = "b4000000-0000-4000-8000-000000000004"
    db.seed("users", [users_row(provider, "private.provider@example.test", "SERVICE_PROVIDER", full_name=full_name)])
    about = "d4000000-0000-4000-8000-000000000005"
    db.seed("reviews", [review(about, MIA, provider, 1, body="Never turned up.", status="FLAGGED", created_at=at(8))])

    assert decide(client, admin, about, "hide", reason="Abusive.").status_code == 200

    [(title, body)] = notices(db, MIA)
    assert (title, body) == ("Your review was hidden", "A TenantVoice admin hid your review of a TenantVoice member. "
                                                        "Reason: Abusive.")
    # The admin log may still say who it was.
    [entry] = shared_trail(db, "review.moderated")
    assert (full_name or "private.provider@example.test") in entry["summary"]


def test_restoring_a_hidden_review_publishes_it_again(client, db, admin):
    assert decide(client, admin, REPORTED, "hide").status_code == 200

    response = decide(client, admin, REPORTED, "restore", "Upheld on appeal.", expected_status="HIDDEN")

    assert response.status_code == 200, response.text
    assert [params["p_action"] for params, _ in moderation_calls(db)] == ["HIDE", "APPROVE"]
    assert status_of(db, REPORTED) == "PUBLISHED"
    assert "The owner is a crook." in public_bodies(client)
    assert [(d["decision"], d["from_status"], d["to_status"]) for d in response.json()["decisions"]] == [
        ("restored", "HIDDEN", "PUBLISHED"), ("hidden", "PUBLISHED", "HIDDEN")]
    assert notices(db, MIA)[-1] == (
        "Your review is visible again", "A TenantVoice admin restored your review of Harbour flat. "
                                        "Reason: Upheld on appeal.")
    # The report was decided by the first decision: its reporter hears once.
    assert len(notices(db, OWNER)) == 1
    assert REPORTED not in [item["id"] for item in queue(client, admin)["items"]]


def test_keeping_a_reported_review_closes_its_reports(client, db, admin):
    kept = decide(client, admin, REPORTED, "restore", "Fair comment.")
    flagged = decide(client, admin, FLAGGED, "restore", "The photos show mould.", expected_status="FLAGGED")

    assert kept.status_code == 200 and flagged.status_code == 200, (kept.text, flagged.text)
    assert [params["p_action"] for params, _ in moderation_calls(db)] == ["DISMISS", "DISMISS"]
    assert (status_of(db, REPORTED), status_of(db, FLAGGED)) == ("PUBLISHED", "PUBLISHED")
    assert row_of(db, REPORTED)["media_urls"]["reports"] == []
    assert [e["metadata"]["decision"] for e in shared_trail(db, "review.moderated")] == ["kept", "kept"]
    assert queue(client, admin)["items"] == []
    # Mia's review did not change, so she hears nothing; Noah's stops showing as reported.
    assert notices(db, MIA) == []
    assert notices(db, NOAH) == [(
        "Your review stays published",
        "A TenantVoice admin checked a report about your review of Harbour flat and kept it. "
        "Reason: The photos show mould.")]
    assert notices(db, OWNER) == [("We checked a review you reported", "A TenantVoice admin kept it published.")]
    profile = client.get(f"/api/v1/public/profiles/{OWNER}").json()
    assert not any(r["reported"] for r in profile["reviews"])


def test_keeping_a_review_another_admin_just_hid_records_nothing(client, db, admin, monkeypatch):
    # Read while published, hidden by another admin before this decision's write.
    seen = json.loads(json.dumps(row_of(db, REPORTED)))
    monkeypatch.setattr(admin_moderation, "_review_row", lambda review_id: seen)
    row_of(db, REPORTED)["status"] = "HIDDEN"

    response = decide(client, admin, REPORTED, "restore", "Fair comment.")

    assert response.status_code == 409
    assert status_of(db, REPORTED) == "HIDDEN"
    assert shared_trail(db, "review.moderated") == []
    assert notices(db, OWNER) == notices(db, MIA) == []


def test_a_report_after_a_decision_puts_the_review_back_in_the_queue(client, db, admin):
    decide(client, admin, REPORTED, "restore", "Fair comment.")
    row_of(db, REPORTED)["media_urls"]["reports"] = [report(NOAH, "spam", reported_at="2026-12-01T00:00:00+00:00")]

    item = queue(client, admin)["items"][0]
    assert (item["id"], item["open_reports"]) == (REPORTED, 1)
    assert [(r["reason"], r["open"]) for r in item["reports"]] == [("spam", True), ("offensive", False)]


def test_a_report_older_than_the_last_decision_was_decided_by_it(client, db, admin):
    # The web's decisions before mobile_admin_moderate_review left reports in place.
    db.seed("mobile_admin_audit_entries", [
        audit_entry("e4000000-0000-4000-8000-000000000001", ADMIN, "review.moderated", "review", REPORTED,
                    created_at=at(9), metadata={"source": "web", "decision": "kept", "reason": "Fair comment."}),
    ])

    assert [item["id"] for item in queue(client, admin)["items"]] == [FLAGGED]
    assert decide(client, admin, REPORTED, "restore", "Fine").status_code == 409


@pytest.mark.parametrize("review_id, payload, code", [
    (REPORTED, {"action": "hide", "reason": "   "}, 422),
    (REPORTED, {"action": "hide", "reason": "Rude", "expected_status": "FLAGGED"}, 409),
    (HIDDEN, {"action": "hide", "reason": "Rude"}, 409),
    (QUIET, {"action": "restore", "reason": "Fine"}, 409),
    (REPORTED, {"action": "delete", "reason": "Rude"}, 422),
    ("d4000000-0000-4000-8000-000000000099", {"action": "hide", "reason": "Rude"}, 404),
    ("not-a-review", {"action": "hide", "reason": "Rude"}, 404),
])
def test_a_decision_needs_a_reason_and_a_review_in_the_state_the_admin_saw(client, db, admin, review_id, payload,
                                                                           code):
    response = client.post(f"{API}/{review_id}/moderation", json=payload, headers=admin)

    assert response.status_code == code, response.text
    assert [status_of(db, review_id) for review_id in (REPORTED, FLAGGED, QUIET, HIDDEN)] == [
        "PUBLISHED", "FLAGGED", "PUBLISHED", "HIDDEN"]
    assert not shared_trail(db, "review.moderated") and not db.tables.get("notifications")
    assert moderation_calls(db) == []


def test_the_reason_is_required(client, db, admin):
    response = client.post(f"{API}/{REPORTED}/moderation", json={"action": "hide"}, headers=admin)

    assert response.status_code == 422
    assert response.json()["detail"][0]["msg"] == "Give a reason. It is kept with the decision."
