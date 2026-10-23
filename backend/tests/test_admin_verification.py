"""The admin verification queue and decisions (tracker R17), on the shared functions.

Admins see documents grouped by account per role tab, each with a link for
a few minutes, beside the documents the mobile app keeps in
users.metadata.mobile.verificationDocuments (read-only). They approve or
reject a document as they saw it, through review_profile_document: of two
admins the second gets 409 and overwrites nothing, and the function records
the review event, sets the account and notifies the person. A PENDING
account is decided through review_user_verification.
"""

import pytest

from app.services import documents
from tests import fake_rpcs
from tests.factories import NOW
from tests.factories_documents import BUCKET, PDF, document_row, stored_file
from tests.factories_identity import account, users_row
from tests.factories_provider_core import seed_provider
from tests.fake_supabase import api_error

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1/admin"
ADMIN = "a1000000-0000-4000-8000-000000000001"
OTHER_ADMIN = "a1000000-0000-4000-8000-000000000002"
TIA = "b2000000-0000-4000-8000-000000000001"
OLI = "b2000000-0000-4000-8000-000000000002"
LEO = "b2000000-0000-4000-8000-000000000003"
AGNES = "b2000000-0000-4000-8000-000000000004"
PAT = "b2000000-0000-4000-8000-000000000005"
TOM = "b2000000-0000-4000-8000-000000000006"
GONE = "b2000000-0000-4000-8000-000000000007"
OFFICER = "b2000000-0000-4000-8000-000000000008"
DOC = "d2000000-0000-4000-8000-000000000001"


def doc_id(n: int) -> str:
    return f"d2000000-0000-4000-8000-{n:012d}"


def at(month: int, day: int = 1) -> str:
    return f"2026-{month:02d}-{day:02d}T00:00:00+00:00"


@pytest.fixture
def db(strict_schema):
    strict_schema.seed("users", [
        users_row(TIA, "tia@example.test", full_name="Tia Tenant"),
        users_row(OLI, "oli@example.test", full_name="Oli Other"),
        users_row(LEO, "leo@example.test", "LANDLORD", full_name="Leo Landlord"),
        users_row(AGNES, "agnes@example.test", "AGENT", full_name="Agnes Agent"),
        users_row(GONE, "gone@example.test", full_name="Gone Away", deleted_at=NOW),
    ])
    seed_provider(strict_schema, PAT, "Pat Provider", category="cleaner")
    seed_provider(strict_schema, TOM, "Tom Tradie", category="tradie")
    return strict_schema


@pytest.fixture
def admin(client, db):
    return {"Authorization": f"Bearer {account(db, ADMIN, 'ada@example.test', 'ADMIN', full_name='Ada Admin')}"}


@pytest.fixture
def other_admin(client, db):
    return {"Authorization": f"Bearer {account(db, OTHER_ADMIN, 'otto@example.test', 'ADMIN', full_name='Otto Admin')}"}


def seed_document(db, id, user_id, document_type="PASSPORT", status="pending", name="Passport.pdf", **over):
    """A document whose file the web stored, in its own upload directory."""
    path = stored_file(db, user_id, name, id.replace("-", ""))
    db.seed("profile_documents", [document_row(id, user_id, document_type, status, file_url=path, **over)])
    return path


def approved_rest_of_tenant(db, user_id=TIA):
    """A tenant's licence and Medicare card, approved: their passport completes what verification needs."""
    seed_document(db, doc_id(21), user_id, "DRIVERS_LICENCE", "verified", name="Licence.pdf", verified_by_user_id=ADMIN)
    seed_document(db, doc_id(22), user_id, "MEDICARE_CARD", "verified", name="Medicare.pdf", verified_by_user_id=ADMIN)


def row(db, document_id=DOC):
    return next(item for item in db.tables["profile_documents"] if item["id"] == document_id)


def user(db, user_id):
    return next(item for item in db.tables["users"] if item["id"] == user_id)


def provider_profile(db, user_id):
    return next(item for item in db.tables["service_provider_profiles"] if item["user_id"] == user_id)


def account_token(db, user_id) -> str:
    """Sign a seeded users row in: an auth user linked to it."""
    email = user(db, user_id)["email"]
    token = db.add_auth_user(email, "password123")
    user(db, user_id)["auth_user_id"] = db.tokens[token]
    return token


def events(db):
    return db.tables.get("profile_document_review_events", [])


def notices(db):
    return db.tables.get("notifications", [])


def named_trail(db, action=None):
    trail = [entry for entry in db.schema_tables.get("web", {}).get("audit_log", []) if ":" not in entry["action"]]
    return [entry for entry in trail if action is None or entry["action"] == action]


def admin_entries(db):
    return db.tables.get("mobile_admin_audit_entries", [])


def decide(client, headers, document_id=DOC, decision="APPROVED", reason=None, version=NOW):
    body = {"decision": decision, "expected_updated_at": version}
    if reason is not None:
        body["reason"] = reason
    return client.post(f"{API}/documents/{document_id}/decision", json=body, headers=headers)


def decide_account(client, headers, user_id, decision, reason=None):
    body = {"decision": decision} if reason is None else {"decision": decision, "reason": reason}
    return client.post(f"{API}/users/{user_id}/verification", json=body, headers=headers)


def ids(response):
    assert response.status_code == 200, response.text
    return [item["user_id"] for item in response.json()["items"]]


def mobile_documents(db, user_id, sent_at=None, **saved):
    """The mobile app's verification documents of an account (users.metadata.mobile)."""
    mobile = {"verificationDocuments": saved}
    if sent_at:
        mobile["verificationDocumentsUpdatedAt"] = sent_at
    user(db, user_id)["metadata"] = {**(user(db, user_id).get("metadata") or {}), "mobile": mobile}


# ---------------------------------------------------------------------------
# The queue
# ---------------------------------------------------------------------------
def test_the_queue_groups_waiting_documents_by_account_oldest_submission_first(client, admin, db):
    seed_document(db, doc_id(1), TIA, submitted_at=at(2))
    seed_document(db, doc_id(2), TIA, "UTILITY_BILL", name="Bill.pdf", submitted_at=at(3))
    seed_document(db, doc_id(3), TIA, "BANK_STATEMENT", "verified", name="Bank.pdf")
    seed_document(db, doc_id(4), OLI, "DRIVERS_LICENCE", name="Licence.pdf", submitted_at=at(1, 15))
    seed_document(db, doc_id(5), LEO, "GOVERNMENT_PHOTO_ID", submitted_at=at(1, 10))
    seed_document(db, doc_id(6), GONE, submitted_at=at(1, 2))  # a closed account
    db.seed("users", [users_row(OFFICER, "olga@example.test", "REGULATOR", full_name="Olga Officer")])
    seed_document(db, doc_id(7), OFFICER, submitted_at=at(1, 3))  # staff are not verified here

    response = client.get(f"{API}/verification", headers=admin)

    assert ids(response) == [OLI, TIA]
    body = response.json()
    assert (body["role"], body["status"], body["total"], body["limit"], body["offset"]) == (
        "tenant", "PENDING", 2, 20, 0)
    assert body["counts"] == {"tenant": 2, "landlord": 1, "provider": 0}
    assert body["mobile_unavailable"] is False
    tia = body["items"][1]
    assert (tia["full_name"], tia["email"], tia["role"], tia["primary_role"]) == (
        "Tia Tenant", "tia@example.test", "tenant", "TENANT")
    assert tia["account"] == {
        "status": "pending", "rejection_reason": None, "approved_at": None, "account_rejected": False}
    # Only the documents in review; the requirements read every document.
    assert [(item["id"], item["label"], item["status"]) for item in tia["documents"]] == [
        (doc_id(1), "Passport", "pending"), (doc_id(2), "Utility bill", "pending")]
    assert [(item["key"], item["status"]) for item in tia["requirements"]] == [
        ("passport", "pending"), ("drivers_licence", "missing"), ("medicare_card", "missing")]
    # review_user_verification decides a PENDING account.
    assert (tia["can_approve"], tia["approval_note"], tia["mobile_documents"]) == (True, None, [])
    assert tia["documents"][0]["updated_at"].startswith("2026-01-01T00:00:00")
    assert tia["documents"][0]["submitted_at"].startswith("2026-02-01")


def test_each_document_comes_with_a_link_for_five_minutes_and_handing_them_out_is_audited(client, admin, db):
    path = seed_document(db, DOC, TIA)
    db.seed("profile_documents", [document_row(doc_id(9), TIA, "OTHER", file_url="")])  # no file: no link

    response = client.get(f"{API}/verification", headers=admin)

    assert response.headers["cache-control"] == "no-store"
    linked = {item["id"]: item["link"] for item in response.json()["items"][0]["documents"]}
    assert linked[doc_id(9)] is None
    assert linked[DOC]["expires_in"] == documents.LINK_TTL == 300
    assert f"/storage/v1/object/sign/{BUCKET}/" in linked[DOC]["url"]
    assert db.storage.signatures == [(BUCKET, path, 300)]
    [entry] = named_trail(db, "document.links_signed")
    assert (entry["actor_id"], entry["entity_type"], entry["metadata"]) == (
        ADMIN, "profile_document", {"document_ids": [DOC], "expires_in": 300})


def test_landlords_and_providers_have_their_own_tabs_and_agents_are_not_listed(client, admin, db):
    seed_document(db, doc_id(1), AGNES, "PROPERTY_MANAGEMENT_AUTHORITY", name="Authority.pdf", submitted_at=at(2))
    seed_document(db, doc_id(2), LEO, "GOVERNMENT_PHOTO_ID", submitted_at=at(3))
    seed_document(db, doc_id(3), TOM, "TRADE_LICENCE", name="Licence.pdf", submitted_at=at(4))

    # review_profile_document and review_user_verification review no agent.
    landlords = client.get(f"{API}/verification", params={"role": "landlord"}, headers=admin)
    assert ids(landlords) == [LEO]
    assert landlords.json()["counts"] == {"tenant": 0, "landlord": 1, "provider": 1}
    providers = client.get(f"{API}/verification", params={"role": "provider"}, headers=admin)
    assert ids(providers) == [TOM]
    assert [item["key"] for item in providers.json()["items"][0]["requirements"]] == [
        "photo_id", "trade_licence", "public_liability"]
    assert ids(client.get(f"{API}/verification", headers=admin)) == []
    assert client.get(f"{API}/verification/{AGNES}", headers=admin).status_code == 404
    assert client.get(f"{API}/verification", params={"role": "admin"}, headers=admin).status_code == 422


def test_decided_documents_list_the_newest_decision_first(client, admin, db):
    seed_document(db, doc_id(1), TIA, "PASSPORT", "rejected", updated_at=at(3))
    seed_document(db, doc_id(2), OLI, "PASSPORT", "rejected", updated_at=at(5))
    seed_document(db, doc_id(3), OLI, "DRIVERS_LICENCE", "verified", name="Licence.pdf")

    rejected = client.get(f"{API}/verification", params={"status": "REJECTED"}, headers=admin)

    assert ids(rejected) == [OLI, TIA]
    assert rejected.json()["items"][1]["documents"][0]["rejection_reason"] == "The photo is blurred."
    assert ids(client.get(f"{API}/verification", params={"status": "APPROVED"}, headers=admin)) == [OLI]
    assert client.get(f"{API}/verification", params={"status": "LOST"}, headers=admin).status_code == 422


def test_the_queue_pages_by_account(client, admin, db):
    for n, user_id in enumerate((TIA, OLI), start=1):
        seed_document(db, doc_id(n), user_id, submitted_at=at(n))

    page = client.get(f"{API}/verification", params={"limit": 1, "offset": 1}, headers=admin)

    assert ids(page) == [OLI]
    assert page.json()["total"] == 2
    assert client.get(f"{API}/verification", params={"limit": 51}, headers=admin).status_code == 422


def test_one_account_reads_again_as_the_queue_shows_it(client, admin, db):
    seed_document(db, DOC, TIA)

    response = client.get(f"{API}/verification/{TIA}", headers=admin)

    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()["documents"]] == [DOC]
    assert decide(client, admin).status_code == 200
    # Nothing left to review: the account is still there, with no documents in that status.
    assert client.get(f"{API}/verification/{TIA}", headers=admin).json()["documents"] == []
    approved = client.get(f"{API}/verification/{TIA}", params={"status": "APPROVED"}, headers=admin).json()
    assert [item["id"] for item in approved["documents"]] == [DOC]
    for other in (GONE, OTHER_ADMIN, "f" * 8 + "-0000-4000-8000-000000000000"):
        assert client.get(f"{API}/verification/{other}", headers=admin).status_code == 404


# ---------------------------------------------------------------------------
# The mobile app's documents
# ---------------------------------------------------------------------------
def test_the_mobile_apps_documents_show_read_only_with_links_from_their_storage_path(client, admin, db):
    passport = f"{TIA}/passport.jpg"
    db.storage.objects[(BUCKET, passport)] = b"\xff\xd8\xff"
    mobile_documents(
        db, TIA, at(3),
        passport={"name": "Passport", "storagePath": passport, "mimeType": "image/jpeg", "uploadedAt": at(3)},
        # Someone else's folder is never signed for this account, nor a link the app saved.
        police_check={"storagePath": f"{OLI}/check.pdf"},
        selfie={"url": "https://elsewhere.example.test/selfie.jpg"},
        note="not a document",
    )

    response = client.get(f"{API}/verification", headers=admin)

    [item] = response.json()["items"]
    assert (item["user_id"], item["documents"]) == (TIA, [])
    shown = {document["key"]: document for document in item["mobile_documents"]}
    assert list(shown) == ["passport", "police_check", "selfie"]
    assert shown["police_check"]["name"] == "Police Check"
    assert (shown["passport"]["mime_type"], shown["passport"]["uploaded_at"], shown["passport"]["has_file"]) == (
        "image/jpeg", at(3), True)
    assert shown["passport"]["link"]["expires_in"] == 300
    assert f"/storage/v1/object/sign/{BUCKET}/" in shown["passport"]["link"]["url"]
    assert [(document["link"], document["has_file"]) for document in (shown["police_check"], shown["selfie"])] == [
        (None, True), (None, True)]
    assert db.storage.signatures == [(BUCKET, passport, 300)]
    [entry] = named_trail(db, "document.links_signed")
    assert entry["metadata"] == {"document_ids": [], "expires_in": 300,
                                 "mobile_documents": [{"user_id": TIA, "key": "passport"}]}


def test_an_account_with_mobile_documents_waits_in_review_from_when_they_were_sent(client, admin, db):
    seed_document(db, doc_id(1), OLI, submitted_at=at(2))
    mobile_documents(db, TIA, at(1), licence={"name": "Licence", "storagePath": f"{TIA}/licence.jpg"})
    # The mobile queue leaves out approved and staff accounts.
    mobile_documents(db, PAT, at(1), insurance={"storagePath": f"{PAT}/insurance.pdf"})
    user(db, PAT)["verification_status"] = "APPROVED"

    pending = client.get(f"{API}/verification", headers=admin)

    assert ids(pending) == [TIA, OLI]
    assert pending.json()["counts"] == {"tenant": 2, "landlord": 0, "provider": 0}
    # Mobile documents carry no review, so the decided tabs list the website's only.
    assert ids(client.get(f"{API}/verification", params={"status": "APPROVED"}, headers=admin)) == []
    one = client.get(f"{API}/verification/{TIA}", headers=admin).json()
    assert [document["key"] for document in one["mobile_documents"]] == ["licence"]


def test_a_rejected_account_with_only_mobile_documents_does_not_wait_in_review(client, admin, db):
    # mobile_admin_verification_queue lists rejected accounts too, but no decision is left to take on one.
    mobile_documents(db, TIA, at(1), licence={"name": "Licence", "storagePath": f"{TIA}/licence.jpg"})
    user(db, TIA)["verification_status"] = "REJECTED"

    pending = client.get(f"{API}/verification", headers=admin)

    assert ids(pending) == []
    assert pending.json()["counts"] == {"tenant": 0, "landlord": 0, "provider": 0}


def test_the_queue_still_lists_the_websites_documents_when_the_mobile_queue_fails(client, admin, db, monkeypatch):
    seed_document(db, DOC, TIA)

    def unavailable(ctx, params):
        raise api_error("57014", "canceling statement due to statement timeout")

    monkeypatch.setitem(fake_rpcs._STAND_INS, "mobile_admin_verification_queue", unavailable)

    response = client.get(f"{API}/verification", headers=admin)

    assert ids(response) == [TIA]
    assert response.json()["mobile_unavailable"] is True


def test_the_mobile_queue_runs_as_the_signed_in_admin(client, admin, db):
    client.get(f"{API}/verification", headers=admin)

    [caller] = [auth_id for name, auth_id in db.rpc_callers if name == "mobile_admin_verification_queue"]
    assert caller == user(db, ADMIN)["auth_user_id"]


# ---------------------------------------------------------------------------
# Document decisions
# ---------------------------------------------------------------------------
def test_an_approval_verifies_the_document_records_a_review_event_and_tells_the_person(client, admin, db):
    seed_document(db, DOC, TIA)
    approved_rest_of_tenant(db)

    response = decide(client, admin)

    assert response.status_code == 200, response.text
    decided = row(db)
    assert (decided["review_status"], decided["is_verified"]) == ("APPROVED", True)
    assert (decided["verified_by_user_id"], decided["rejection_reason"]) == (ADMIN, None)
    assert decided["verified_at"] and decided["updated_at"] > NOW
    assert decided["metadata"]["reviewStatus"] == "APPROVED"
    [event] = events(db)
    assert {key: event[key] for key in (
        "document_id", "subject_user_id", "reviewer_user_id", "subject_role", "document_type", "review_status",
        "rejection_reason", "reviewer_email", "reviewer_name", "subject_email", "subject_name",
    )} == {
        "document_id": DOC, "subject_user_id": TIA, "reviewer_user_id": ADMIN, "subject_role": "TENANT",
        "document_type": "PASSPORT", "review_status": "APPROVED", "rejection_reason": None,
        "reviewer_email": "ada@example.test", "reviewer_name": "Ada Admin",
        "subject_email": "tia@example.test", "subject_name": "Tia Tenant",
    }
    assert event["reviewed_at"] == decided["verified_at"]
    # The last of the three documents a tenant needs: the function approves the account, naming the admin.
    account_row = user(db, TIA)
    assert (account_row["verification_status"], account_row["approved_by_user_id"]) == ("APPROVED", ADMIN)
    assert account_row["approved_at"] and account_row["rejection_reason"] is None
    # The function's one notice, nothing more from the web.
    [notice] = notices(db)
    assert (notice["user_id"], notice["category"], notice["title"], notice["body"]) == (
        TIA, "system", "Verification document reviewed", "Your Passport was approved.")
    body = response.json()
    assert (body["document"]["status"], body["document"]["id"]) == ("verified", DOC)
    assert body["account"]["status"] == "verified"
    [entry] = named_trail(db, "document.reviewed")
    assert (entry["actor_id"], entry["entity_id"], entry["metadata"]) == (ADMIN, DOC, {
        "user_id": TIA, "document_type": "PASSPORT", "decision": "APPROVED", "reason": None,
        "account_status": "APPROVED",
    })


def test_an_approval_short_of_every_required_document_keeps_the_account_in_review(client, admin, db):
    seed_document(db, DOC, TIA)

    assert decide(client, admin).json()["account"]["status"] == "pending"
    assert user(db, TIA)["verification_status"] == "PENDING"


@pytest.mark.parametrize("reason", [None, "", "   "])
def test_a_rejection_without_a_reason_is_refused_and_changes_nothing(client, admin, db, reason):
    seed_document(db, DOC, TIA)
    before = dict(row(db))

    response = decide(client, admin, decision="REJECTED", reason=reason)

    assert response.status_code == 422
    assert "Give a reason for rejecting this document." in str(response.json()["detail"])
    assert row(db) == before
    assert events(db) == [] and notices(db) == []
    assert user(db, TIA)["verification_status"] == "PENDING"


def test_a_rejection_keeps_its_reason_rejects_the_account_and_tells_the_person_why(client, admin, db):
    seed_document(db, DOC, TIA, "DRIVERS_LICENCE", name="Licence.pdf")

    response = decide(client, admin, decision="REJECTED", reason="  Only the front   is shown ")

    assert response.status_code == 200, response.text
    decided = row(db)
    assert (decided["review_status"], decided["is_verified"]) == ("REJECTED", False)
    assert decided["rejection_reason"] == "Only the front is shown"
    # review_profile_document records who decided, a rejection too.
    assert decided["verified_by_user_id"] == ADMIN
    [event] = events(db)
    assert (event["review_status"], event["rejection_reason"], event["document_type"]) == (
        "REJECTED", "Only the front is shown", "DRIVERS_LICENCE")
    account_row = user(db, TIA)
    assert (account_row["verification_status"], account_row["rejection_reason"]) == (
        "REJECTED", "Only the front is shown")
    [notice] = notices(db)
    assert (notice["title"], notice["body"]) == (
        "Verification document reviewed", "Your Drivers Licence was rejected: Only the front is shown")
    assert response.json()["account"] == {
        "status": "rejected", "rejection_reason": "Only the front is shown", "approved_at": None,
        "account_rejected": False,
    }
    # The person sees the decision and its reason, with Replace.
    as_owner = {"Authorization": f"Bearer {account_token(db, TIA)}"}
    listed = client.get("/api/v1/me/documents", headers=as_owner).json()
    assert [(item["status"], item["rejection_reason"]) for item in listed["documents"]] == [
        ("rejected", "Only the front is shown")]
    assert listed["account"]["status"] == "rejected"


def test_two_admins_on_one_pending_version_the_second_gets_409_and_overwrites_nothing(
    client, admin, other_admin, db,
):
    seed_document(db, DOC, TIA)

    first = decide(client, admin, decision="APPROVED")
    second = decide(client, other_admin, decision="REJECTED", reason="Looks edited")

    assert first.status_code == 200
    assert (second.status_code, second.json()["detail"]) == (409, "Document has already been reviewed")
    decided = row(db)
    assert (decided["review_status"], decided["verified_by_user_id"], decided["rejection_reason"]) == (
        "APPROVED", ADMIN, None)
    assert [event["reviewer_user_id"] for event in events(db)] == [ADMIN]
    assert len(notices(db)) == 1
    assert len(named_trail(db, "document.reviewed")) == 1


def test_a_decision_made_between_reading_and_writing_is_never_overwritten(client, admin, db, monkeypatch):
    """Another admin approves after this one's checks and before the function runs: it finds no PENDING row."""
    seed_document(db, DOC, TIA)
    from app.services import account_verification

    read_account = account_verification.account

    def _decided_meanwhile(user_id):
        if user_id == TIA and row(db)["review_status"] == "PENDING":
            row(db).update(review_status="APPROVED", is_verified=True, verified_by_user_id=OTHER_ADMIN,
                           updated_at=at(6))
        return read_account(user_id)

    monkeypatch.setattr(account_verification, "account", _decided_meanwhile)

    response = decide(client, admin, decision="REJECTED", reason="Looks edited")

    assert response.status_code == 409
    assert (row(db)["review_status"], row(db)["verified_by_user_id"], row(db)["rejection_reason"]) == (
        "APPROVED", OTHER_ADMIN, None)
    assert events(db) == [] and notices(db) == []


def test_a_decision_on_a_version_the_admin_did_not_see_is_refused(client, admin, db):
    seed_document(db, DOC, TIA, updated_at=at(3))
    before = dict(row(db))

    stale = decide(client, admin, version=at(2))

    assert stale.status_code == 409
    assert "Reload it to see the latest version" in stale.json()["detail"]
    assert row(db) == before and events(db) == [] and notices(db) == []
    # The same instant in another notation is the same version.
    assert decide(client, admin, version="2026-03-01T00:00:00Z").status_code == 200


def test_a_document_given_a_new_file_while_the_admin_looked_is_refused(client, admin, db):
    seed_document(db, DOC, TIA)
    # The person replaces the file (documents.replace_file): a new version, back in review.
    newer = stored_file(db, TIA, "Passport 2027.pdf", "c" * 32)
    row(db).update(file_url=newer, updated_at=at(4), submitted_at=at(4))

    response = decide(client, admin)

    assert response.status_code == 409
    assert (row(db)["review_status"], row(db)["file_url"]) == ("PENDING", newer)
    assert events(db) == [] and notices(db) == []


@pytest.mark.parametrize("status", ["verified", "rejected"])
def test_a_document_already_decided_is_not_decided_again(client, admin, db, status):
    seed_document(db, DOC, TIA, status=status)
    before = dict(row(db))

    response = decide(client, admin, decision="REJECTED", reason="Second look")

    assert (response.status_code, response.json()["detail"]) == (409, "Document has already been reviewed")
    assert row(db) == before and events(db) == []


def test_nobody_decides_their_own_document(client, admin, db):
    seed_document(db, DOC, ADMIN)

    response = decide(client, admin)

    assert (response.status_code, response.json()["detail"]) == (403, "You can't review your own documents.")
    assert row(db)["review_status"] == "PENDING" and events(db) == []


def test_an_unknown_document_is_404(client, admin):
    assert decide(client, admin, document_id=doc_id(99)).status_code == 404


def test_the_functions_refusal_is_passed_on(client, admin, db):
    """An agent's document: review_profile_document reviews tenants, landlords and providers only."""
    seed_document(db, DOC, AGNES, "GOVERNMENT_PHOTO_ID")
    before = dict(row(db))

    response = decide(client, admin)

    assert (response.status_code, response.json()["detail"]) == (422, "User role is not reviewable")
    assert row(db) == before and events(db) == [] and notices(db) == []


@pytest.mark.parametrize("provider", [PAT, TOM], ids=["cleaner", "tradie"])
def test_a_provider_is_verified_once_its_photo_id_trade_licence_and_insurance_are_approved(
    client, admin, db, provider,
):
    seed_document(db, doc_id(1), provider, "GOVERNMENT_PHOTO_ID", "verified", name="ID.pdf")
    seed_document(db, doc_id(2), provider, "PUBLIC_LIABILITY_INSURANCE", name="Insurance.pdf")
    seed_document(db, doc_id(3), provider, "TRADE_LICENCE", name="Licence.pdf")

    assert decide(client, admin, document_id=doc_id(2)).status_code == 200
    assert user(db, provider)["verification_status"] == "PENDING"
    assert decide(client, admin, document_id=doc_id(3)).status_code == 200

    assert user(db, provider)["verification_status"] == "APPROVED"
    assert provider_profile(db, provider)["verification_status"] == "APPROVED"


def test_an_approved_account_stays_approved_whatever_a_later_decision_is(client, admin, db):
    seed_document(db, DOC, TIA, "UTILITY_BILL", name="Bill.pdf")
    user(db, TIA).update(verification_status="APPROVED", approved_by_user_id=OTHER_ADMIN, approved_at=at(2))

    assert decide(client, admin, decision="REJECTED", reason="Not in your name").status_code == 200

    account_row = user(db, TIA)
    assert (account_row["verification_status"], account_row["approved_at"]) == ("APPROVED", at(2))


# ---------------------------------------------------------------------------
# Account decisions
# ---------------------------------------------------------------------------
def test_a_pending_account_is_approved_through_review_user_verification_and_recorded(client, admin, db):
    seed_document(db, doc_id(1), LEO, "GOVERNMENT_PHOTO_ID", "verified")

    response = decide_account(client, admin, LEO, "APPROVED")

    assert response.status_code == 200, response.text
    account_row = user(db, LEO)
    assert (account_row["verification_status"], account_row["approved_by_user_id"]) == ("APPROVED", ADMIN)
    assert account_row["approved_at"]
    [call] = [params for name, params in db.rpc_calls if name == "review_user_verification"]
    assert {key: call[key] for key in ("p_user_id", "p_reviewer_id", "p_status", "p_rejection_reason")} == {
        "p_user_id": LEO, "p_reviewer_id": ADMIN, "p_status": "APPROVED", "p_rejection_reason": None}
    [entry] = admin_entries(db)
    assert (entry["actor_user_id"], entry["action"], entry["entity_type"], entry["entity_id"]) == (
        ADMIN, "user.verification_decided", "user", LEO)
    assert entry["summary"] == "Approved the verification of Leo Landlord (landlord)"
    assert entry["metadata"] == {
        "source": "web", "from_status": "PENDING", "to_status": "APPROVED", "reason": None, "target_role": "landlord",
    }
    [trail] = named_trail(db, "user.verification_decided")
    assert trail["metadata"] == {key: value for key, value in entry["metadata"].items() if key != "source"}
    [notice] = notices(db)
    assert (notice["title"], notice["body"]) == (
        "Account verification updated", "Your TenantVoice account verification was approved.")
    assert response.json()["verification"]["status"] == "verified"
    # A decided account is not decided again, and nothing more is recorded.
    again = decide_account(client, admin, LEO, "APPROVED")
    assert (again.status_code, again.json()["detail"]) == (409, "Verification request already reviewed")
    assert len(admin_entries(db)) == 1 and len(notices(db)) == 1


@pytest.mark.parametrize("reason", [None, "", "  "])
def test_rejecting_an_account_needs_a_reason(client, admin, db, reason):
    response = decide_account(client, admin, TIA, "REJECTED", reason)

    assert response.status_code == 422
    assert "Give a reason for rejecting this account." in str(response.json()["detail"])
    assert user(db, TIA)["verification_status"] == "PENDING" and admin_entries(db) == []


LONG_REASON = ("The scan cuts off the expiry date and the signature, and the photo is too dark to compare "
               "with the selfie you sent. ") * 4


def test_an_account_rejection_holds_until_a_required_document_is_replaced(client, admin, db):
    seed_document(db, DOC, TIA, "PASSPORT", "verified", verified_by_user_id=ADMIN)
    approved_rest_of_tenant(db)

    response = decide_account(client, admin, TIA, "REJECTED", LONG_REASON)

    assert response.status_code == 200, response.text
    account_row = user(db, TIA)
    assert (account_row["verification_status"], account_row["rejection_reason"]) == ("REJECTED", LONG_REASON.strip())
    assert response.json()["verification"] == {
        "status": "rejected", "rejection_reason": LONG_REASON.strip(), "approved_at": None, "account_rejected": True,
    }
    [entry] = admin_entries(db)
    assert entry["metadata"]["from_status"] == "PENDING" and entry["metadata"]["to_status"] == "REJECTED"
    [notice] = notices(db)
    assert notice["body"] == f"Your TenantVoice account verification was rejected: {LONG_REASON.strip()}"
    shown = client.get(f"{API}/verification/{TIA}", params={"status": "APPROVED"}, headers=admin).json()
    assert (shown["can_approve"], shown["approval_note"]) == (
        False, "It can be decided again once its owner replaces or deletes a document its verification needs.")

    tenant = {"Authorization": f"Bearer {account_token(db, TIA)}"}
    # A document the verification does not require leaves it as it is.
    statement = client.post("/api/v1/me/documents", data={"document_type": "BANK_STATEMENT"},
                            files={"file": ("Bank.pdf", PDF, "application/pdf")}, headers=tenant)
    assert statement.status_code == 201, statement.text
    assert user(db, TIA)["verification_status"] == "REJECTED"
    assert client.get("/api/v1/me/documents", headers=tenant).json()["account"]["account_rejected"] is True
    # It is decided, so the function decides it again only once it is back in review.
    assert decide_account(client, admin, TIA, "APPROVED").status_code == 409

    # A new passport file puts it back in review (the web's reset).
    replaced = client.put(
        f"/api/v1/me/documents/{DOC}/file", files={"file": ("Passport 2.pdf", PDF, "application/pdf")}, headers=tenant,
    )
    assert replaced.status_code == 200, replaced.text
    account_row = user(db, TIA)
    assert (account_row["verification_status"], account_row["rejection_reason"]) == ("PENDING", None)
    # Approving the new file completes what verification needs, which approves the account.
    assert decide(client, admin, DOC, "APPROVED", version=row(db)["updated_at"]).status_code == 200
    account_row = user(db, TIA)
    assert (account_row["verification_status"], account_row["approved_by_user_id"]) == ("APPROVED", ADMIN)


def test_any_document_decision_sets_a_rejected_account_from_its_documents_again(client, admin, db):
    """review_profile_document approves an account whose required documents are all approved."""
    seed_document(db, DOC, TIA, "PASSPORT", "verified")
    approved_rest_of_tenant(db)
    assert decide_account(client, admin, TIA, "REJECTED", "Checking a report").status_code == 200
    seed_document(db, doc_id(9), TIA, "BANK_STATEMENT", name="Bank.pdf")

    assert decide(client, admin, doc_id(9), "APPROVED").status_code == 200

    assert user(db, TIA)["verification_status"] == "APPROVED"


def test_a_rejected_new_document_keeps_a_rejected_account_rejected(client, admin, db):
    seed_document(db, DOC, TIA, "PASSPORT", "verified", verified_by_user_id=ADMIN)
    assert decide_account(client, admin, TIA, "REJECTED", "The identity looks forged").status_code == 200
    tenant = {"Authorization": f"Bearer {account_token(db, TIA)}"}
    uploaded = client.post("/api/v1/me/documents", data={"document_type": "DRIVERS_LICENCE"},
                           files={"file": ("Licence.pdf", PDF, "application/pdf")}, headers=tenant)
    new_id = uploaded.json()["id"]
    assert user(db, TIA)["verification_status"] == "REJECTED"  # a type it had not: no reset

    response = decide(client, admin, new_id, "REJECTED", "The licence has expired",
                      version=row(db, new_id)["updated_at"])

    assert response.status_code == 200, response.text
    account_row = user(db, TIA)
    assert (account_row["verification_status"], account_row["rejection_reason"], account_row["approved_at"]) == (
        "REJECTED", "The licence has expired", None)


def test_a_provider_is_approved_only_with_a_service_area_and_categories(client, admin, db):
    queue = client.get(f"{API}/verification/{PAT}", headers=admin).json()
    assert (queue["can_approve"], queue["approval_note"]) == (
        False, "Approving a provider needs a service area and categories on its profile.")

    refused = decide_account(client, admin, PAT, "APPROVED")

    assert (refused.status_code, refused.json()["detail"]) == (
        422, "Worker service area and categories are required before approval")
    assert user(db, PAT)["verification_status"] == "PENDING" and admin_entries(db) == []
    provider_profile(db, PAT)["service_area"] = "Inner West"
    assert client.get(f"{API}/verification/{PAT}", headers=admin).json()["can_approve"] is True
    assert decide_account(client, admin, PAT, "APPROVED").status_code == 200
    assert (user(db, PAT)["verification_status"], provider_profile(db, PAT)["verification_status"]) == (
        "APPROVED", "APPROVED")


def test_a_providers_profile_follows_an_account_rejection(client, admin, db):
    assert decide_account(client, admin, TOM, "REJECTED", "Insurance lapsed").status_code == 200

    assert (user(db, TOM)["verification_status"], provider_profile(db, TOM)["verification_status"]) == (
        "REJECTED", "REJECTED")


def test_an_agents_account_is_not_reviewable(client, admin, db):
    response = decide_account(client, admin, AGNES, "APPROVED")

    assert (response.status_code, response.json()["detail"]) == (422, "User role is not reviewable")
    assert user(db, AGNES)["verification_status"] == "PENDING"


@pytest.mark.parametrize("user_id, code, detail", [
    (ADMIN, 403, "You can't decide the verification of your own account."),
    (OTHER_ADMIN, 403, "Staff accounts are not verified from the admin console."),
    (GONE, 409, "This account has been closed."),
])
def test_account_decisions_refuse_own_staff_and_closed_accounts(client, admin, other_admin, db, user_id, code, detail):
    before = dict(user(db, user_id))

    response = decide_account(client, admin, user_id, "REJECTED", "Testing the rules")

    assert (response.status_code, response.json()["detail"]) == (code, detail)
    assert user(db, user_id) == before
    assert admin_entries(db) == [] and notices(db) == []
