"""The admin console's accounts (tracker R16): the list, one account, and status changes.

A status change is a stamped update of users.status, recorded with its actor,
reason and from/to in the web's audit_log and in the shared
mobile_admin_audit_entries. It is refused for the admin's own account and
for other staff, needs a reason unless the account becomes active, and never
overwrites a change another admin made meanwhile.
"""

import pytest

from app.services import admin_users, documents
from tests.factories import NOW
from tests.factories_documents import BUCKET, document_row, stored_file
from tests.factories_identity import account, like_escapes, users_row, verify  # noqa: F401 (fixture)
from tests.factories_provider_core import provider_profile

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1/admin"
ADMIN = "a1000000-0000-4000-8000-000000000001"
OTHER_ADMIN = "a1000000-0000-4000-8000-000000000002"
OFFICER = "a1000000-0000-4000-8000-000000000003"
MIA = "b1000000-0000-4000-8000-000000000001"
LEO = "b1000000-0000-4000-8000-000000000002"
PAT = "b1000000-0000-4000-8000-000000000003"
AGNES = "b1000000-0000-4000-8000-000000000004"
GONE = "b1000000-0000-4000-8000-000000000005"
SAM = "b1000000-0000-4000-8000-000000000006"
DOC = "d1000000-0000-4000-8000-000000000001"
MOBILE_DOC = "d1000000-0000-4000-8000-000000000002"


def created(n: int) -> str:
    return f"2026-0{n}-01T00:00:00+00:00"


@pytest.fixture
def db(strict_schema):
    strict_schema.seed("users", [
        users_row(OTHER_ADMIN, "otto@example.test", "ADMIN", full_name="Otto Admin", created_at=created(1)),
        users_row(OFFICER, "olga@example.test", "REGULATOR", full_name="Olga Officer", created_at=created(1)),
        users_row(MIA, "mia_b@example.test", full_name="Mia Member", created_at=created(2)),
        users_row(LEO, "leo@example.test", "LANDLORD", full_name="Leo 100% Landlord", created_at=created(3)),
        users_row(PAT, "pat@example.test", "SERVICE_PROVIDER", full_name="Pat Provider", status="SUSPENDED",
                  created_at=created(4)),
        users_row(AGNES, "agnes@example.test", "AGENT", full_name="Agnes Agent", created_at=created(5)),
        users_row(GONE, "gone@example.test", full_name="Gone Away", deleted_at=NOW, created_at=created(6)),
        users_row(SAM, "sam@example.test", full_name="Sam Staffer", created_at=created(7)),
    ])
    strict_schema.seed("user_role_assignments", [
        {"id": "c1000000-0000-4000-8000-000000000001", "user_id": SAM, "role": "TENANT", "is_primary": True},
        {"id": "c1000000-0000-4000-8000-000000000002", "user_id": SAM, "role": "ADMIN", "is_primary": False},
    ])
    return strict_schema


@pytest.fixture
def admin(client, db):
    """The signed-in admin's headers; their account is the newest."""
    token = account(db, ADMIN, "ada@example.test", "ADMIN", full_name="Ada Admin", created_at=created(8))
    return {"Authorization": f"Bearer {token}"}


def user(db, user_id):
    return next(row for row in db.tables["users"] if row["id"] == user_id)


def named_trail(db):
    """The web audit_log's named entries, leaving out AuditMiddleware's per-request ones."""
    return [entry for entry in db.schema_tables.get("web", {}).get("audit_log", []) if ":" not in entry["action"]]


def admin_entries(db):
    return db.tables.get("mobile_admin_audit_entries", [])


def change(client, headers, user_id, status, reason=None):
    body = {"status": status} if reason is None else {"status": status, "reason": reason}
    return client.post(f"{API}/users/{user_id}/status", json=body, headers=headers)


# ---------------------------------------------------------------------------
# The list
# ---------------------------------------------------------------------------
def ids(response):
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


def test_the_list_shows_open_accounts_newest_first(client, admin):
    response = client.get(f"{API}/users", headers=admin)

    assert ids(response) == [ADMIN, SAM, AGNES, PAT, LEO, MIA, OTHER_ADMIN, OFFICER]
    body = response.json()
    assert (body["total"], body["limit"], body["offset"]) == (8, 25, 0)
    pat = next(item for item in body["items"] if item["id"] == PAT)
    assert (pat["role"], pat["primary_role"], pat["status"], pat["full_name"]) == (
        "service_provider", "SERVICE_PROVIDER", "SUSPENDED", "Pat Provider")


def test_the_list_filters_by_role_and_status(client, admin):
    assert ids(client.get(f"{API}/users", params={"role": "landlord"}, headers=admin)) == [AGNES, LEO]
    assert ids(client.get(f"{API}/users", params={"role": "officer"}, headers=admin)) == [OFFICER]
    assert ids(client.get(f"{API}/users", params={"status": "SUSPENDED"}, headers=admin)) == [PAT]
    assert ids(client.get(f"{API}/users", params={"role": "tenant", "status": "ACTIVE"}, headers=admin)) == [SAM, MIA]
    assert client.get(f"{API}/users", params={"role": "superuser"}, headers=admin).status_code == 422


def test_the_list_pages_with_the_total_that_match(client, admin):
    page = client.get(f"{API}/users", params={"limit": 3, "offset": 3}, headers=admin)

    assert ids(page) == [PAT, LEO, MIA]
    assert page.json()["total"] == 8
    assert client.get(f"{API}/users", params={"limit": 101}, headers=admin).status_code == 422


def test_the_search_finds_names_and_emails(client, admin, like_escapes):
    assert ids(client.get(f"{API}/users", params={"q": "member"}, headers=admin)) == [MIA]
    assert ids(client.get(f"{API}/users", params={"q": "LEO@EXAMPLE"}, headers=admin)) == [LEO]


def test_the_searchs_own_wildcards_match_only_themselves(client, admin, like_escapes):
    # % and _ are escaped: "100%" is that text, not "100" and anything.
    assert ids(client.get(f"{API}/users", params={"q": "100%"}, headers=admin)) == [LEO]
    assert ids(client.get(f"{API}/users", params={"q": "mia_b"}, headers=admin)) == [MIA]
    assert ids(client.get(f"{API}/users", params={"q": "_"}, headers=admin)) == [MIA]
    # Filter syntax cannot open another condition.
    response = client.get(f"{API}/users", params={"q": "x,status.eq.ACTIVE"}, headers=admin)
    assert ids(response) == []


@pytest.mark.parametrize("text, pattern", [
    ("Mia", "%Mia%"),
    ("100%", "%100\\%%"),
    ("mia_b", "%mia\\_b%"),
    ("  a,b(c)*d  ", "%a b c d%"),
    ("back\\slash", "%back slash%"),
    ("',:\"", None),
    ("", None),
    (None, None),
])
def test_the_search_pattern_escapes_like_and_strips_filter_syntax(text, pattern):
    assert admin_users.contains_pattern(text) == pattern


def test_the_list_counts_each_accounts_documents_in_review(client, admin, db):
    db.seed("profile_documents", [
        document_row(DOC, MIA),
        document_row(MOBILE_DOC, MIA, "UTILITY_BILL", status="verified"),
    ])

    items = {item["id"]: item["pending_documents"] for item in client.get(f"{API}/users", headers=admin).json()["items"]}

    assert (items[MIA], items[LEO]) == (1, 0)


# ---------------------------------------------------------------------------
# One account
# ---------------------------------------------------------------------------
def test_an_account_shows_its_roles_documents_and_whether_its_status_can_change(client, admin, db):
    db.seed("profile_documents", [
        document_row(DOC, MIA, file_url=stored_file(db, MIA)),
        document_row(MOBILE_DOC, MIA, "BIRTH_CERTIFICATE", file_url=f"{MIA}/mobile.pdf",
                     submitted_at="2025-12-01T00:00:00+00:00"),
    ])

    response = client.get(f"{API}/users/{MIA}", headers=admin)

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["id"], body["email"], body["role"], body["status"], body["status_locked"]) == (
        MIA, "mia_b@example.test", "tenant", "ACTIVE", None)
    assert body["pending_documents"] == 2
    # An admin sees every document, the mobile app's too, and can open each one.
    assert [(doc["id"], doc["label"], doc["can_open"]) for doc in body["documents"]] == [
        (DOC, "Passport", True), (MOBILE_DOC, "Birth certificate", True)]
    assert body["status_history"] == []


@pytest.mark.parametrize("user_id, locked", [
    (ADMIN, admin_users.SELF),
    (OTHER_ADMIN, admin_users.STAFF),
    (OFFICER, admin_users.STAFF),
    (SAM, admin_users.STAFF),  # staff by a role assignment
    (GONE, admin_users.CLOSED),
])
def test_an_account_says_why_its_status_cannot_change_here(client, admin, user_id, locked):
    body = client.get(f"{API}/users/{user_id}", headers=admin).json()
    assert body["status_locked"] == locked


def test_an_unknown_account_is_404(client, admin):
    assert client.get(f"{API}/users/{'f' * 8}-0000-4000-8000-000000000000", headers=admin).status_code == 404


# ---------------------------------------------------------------------------
# Status changes
# ---------------------------------------------------------------------------
def test_a_status_change_persists_and_is_recorded_in_both_logs(client, admin, db):
    response = change(client, admin, MIA, "SUSPENDED", "  Repeated   harassment reports ")

    assert response.status_code == 200, response.text
    row = user(db, MIA)
    assert row["status"] == "SUSPENDED" and row["updated_at"] > NOW
    [trail] = named_trail(db)
    assert (trail["actor_id"], trail["action"], trail["entity_type"], trail["entity_id"]) == (
        ADMIN, "user.status_changed", "user", MIA)
    assert trail["metadata"] == {
        "from_status": "ACTIVE", "to_status": "SUSPENDED", "reason": "Repeated harassment reports",
        "target_role": "tenant",
    }
    [entry] = admin_entries(db)
    assert (entry["actor_user_id"], entry["action"], entry["entity_type"], entry["entity_id"]) == (
        ADMIN, "user.status_changed", "user", MIA)
    assert entry["summary"] == "Suspended Mia Member (tenant): Repeated harassment reports"
    assert entry["metadata"] == {"source": "web", **trail["metadata"]}
    assert entry["created_at"]
    body = response.json()
    assert body["status"] == "SUSPENDED"
    assert [(item["from_status"], item["to_status"], item["reason"], item["actor_name"])
            for item in body["status_history"]] == [("ACTIVE", "SUSPENDED", "Repeated harassment reports", "Ada Admin")]
    # Nobody else's account changed.
    assert [row["id"] for row in db.tables["users"] if row["updated_at"] != NOW] == [MIA]


def test_a_suspended_member_is_refused_from_their_next_request(client, admin, db):
    token = account(db, "b1000000-0000-4000-8000-0000000000bb", "tess@example.test", full_name="Tess")
    assert client.get("/api/v1/profiles/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200

    assert change(client, admin, "b1000000-0000-4000-8000-0000000000bb", "DEACTIVATED", "Asked to close").status_code == 200

    refused = client.get("/api/v1/profiles/me", headers={"Authorization": f"Bearer {token}"})
    assert (refused.status_code, refused.json()["detail"]) == (403, "This account has been deactivated.")


def test_reactivating_needs_no_reason(client, admin, db):
    # Pat is a provider, whom only an approved verification enables (tests/test_provider_suspension.py).
    db.seed("service_provider_profiles", [provider_profile(PAT)])
    verify(db, PAT)

    response = change(client, admin, PAT, "ACTIVE")

    assert response.status_code == 200, response.text
    assert user(db, PAT)["status"] == "ACTIVE"
    [entry] = admin_entries(db)
    assert entry["summary"] == "Reactivated Pat Provider (service provider)"
    assert entry["metadata"]["reason"] is None


@pytest.mark.parametrize("status", ["SUSPENDED", "DEACTIVATED"])
@pytest.mark.parametrize("reason", [None, "", "   "])
def test_suspending_or_deactivating_needs_a_reason(client, admin, db, status, reason):
    response = change(client, admin, MIA, status, reason)

    assert response.status_code == 422
    assert "Give a reason" in str(response.json()["detail"])
    assert user(db, MIA)["status"] == "ACTIVE"
    assert named_trail(db) == [] and admin_entries(db) == []


def test_an_unknown_status_is_refused(client, admin, db):
    assert change(client, admin, MIA, "PENDING_VERIFICATION", "Back to pending").status_code == 422
    assert user(db, MIA)["status"] == "ACTIVE"


@pytest.mark.parametrize("user_id, code", [
    (ADMIN, 403),        # their own account
    (OTHER_ADMIN, 403),  # another admin
    (OFFICER, 403),      # a Housing Portal officer
    (SAM, 403),          # staff by a role assignment
    (GONE, 409),         # a closed account
])
def test_own_staff_and_closed_accounts_are_refused(client, admin, db, user_id, code):
    before = dict(user(db, user_id))

    response = change(client, admin, user_id, "SUSPENDED", "Testing the rules")

    assert response.status_code == code
    assert user(db, user_id) == before
    assert named_trail(db) == [] and admin_entries(db) == []


def test_setting_the_status_an_account_already_has_records_nothing(client, admin, db):
    response = change(client, admin, PAT, "SUSPENDED", "Again")

    assert response.status_code == 200
    assert user(db, PAT)["updated_at"] == NOW
    assert named_trail(db) == [] and admin_entries(db) == []


def test_a_change_another_admin_made_meanwhile_is_never_overwritten(client, admin, db, monkeypatch):
    seen = dict(user(db, MIA))
    user(db, MIA)["status"] = "DEACTIVATED"  # another admin's change, after this admin read the account
    monkeypatch.setattr(admin_users, "_account", lambda user_id: seen)

    response = change(client, admin, MIA, "SUSPENDED", "Harassment")

    assert response.status_code == 409
    assert user(db, MIA)["status"] == "DEACTIVATED"
    assert named_trail(db) == [] and admin_entries(db) == []


def test_a_failed_admin_log_write_never_undoes_the_change(client, admin, db, monkeypatch, caplog):
    from tests import fake_supabase

    execute = fake_supabase.FakeTableQuery.execute

    def _execute(query):
        if query._op == "insert" and query._name == "mobile_admin_audit_entries":
            raise ConnectionError("database unreachable")
        return execute(query)

    monkeypatch.setattr(fake_supabase.FakeTableQuery, "execute", _execute)

    response = change(client, admin, MIA, "SUSPENDED", "Harassment")

    assert response.status_code == 200
    assert user(db, MIA)["status"] == "SUSPENDED"
    assert len(named_trail(db)) == 1
    assert "admin audit entry write failed for user.status_changed" in caplog.text


# ---------------------------------------------------------------------------
# Opening a member's document
# ---------------------------------------------------------------------------
def test_an_admin_opens_any_members_document_and_the_opening_is_audited(client, admin, db):
    path = stored_file(db, MIA)
    db.seed("profile_documents", [
        document_row(DOC, MIA, file_url=path),
        document_row(MOBILE_DOC, MIA, "MEDICARE_CARD", file_url=f"{MIA}/mobile.pdf"),
    ])

    first = client.get(f"{API}/documents/{DOC}/link", headers=admin)
    mobile = client.get(f"{API}/documents/{MOBILE_DOC}/link", headers=admin)

    assert (first.status_code, mobile.status_code) == (200, 200)
    assert first.headers["cache-control"] == "no-store"
    assert first.json()["expires_in"] == documents.LINK_TTL
    assert db.storage.signatures == [(BUCKET, path, 300), (BUCKET, f"{MIA}/mobile.pdf", 300)]
    opened = [entry for entry in named_trail(db) if entry["action"] == "document.opened"]
    assert [(entry["actor_id"], entry["entity_id"], entry["metadata"]["user_id"]) for entry in opened] == [
        (ADMIN, DOC, MIA), (ADMIN, MOBILE_DOC, MIA)]


def test_an_admin_cannot_open_a_document_without_a_file(client, admin, db):
    db.seed("profile_documents", [document_row(DOC, MIA, "OTHER", file_url="")])

    assert client.get(f"{API}/documents/{DOC}/link", headers=admin).status_code == 404
    assert client.get(f"{API}/documents/{MOBILE_DOC}/link", headers=admin).status_code == 404
    assert db.storage.signatures == []
