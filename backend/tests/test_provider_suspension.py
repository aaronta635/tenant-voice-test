"""Suspending and enabling a provider from the admin console (tracker R18, assumption #14).

A suspension is the provider's users.status, set with the account status
control. It hides them from the marketplace and search
(test_marketplace_account_status) and keeps new work away, but they still
sign in to finish the jobs in progress and read past bookings, messages and
invoices. The client of each confirmed booking from today on is told once.
Enabling makes the account ACTIVE again, for an approved provider only:
listed while the profile is live, and going live still needs verification.
"""

from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException

from app.core.deps import CurrentProfile
from app.services import admin_providers, bookings, gates, public_profiles
from tests.factories import make_availability
from tests.factories_bookings import booking, freeze_clock, invoice, person, rows, service, uid, web_rows
from tests.factories_identity import account, verify
from tests.factories_messaging import connection, message, seed_thread
from tests.factories_provider_core import category_row, provider_profile, provider_user, review_row
from tests.factories_rental import seed_listing

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
NOW_IN_SYDNEY = datetime(2030, 1, 15, 12)
TODAY = NOW_IN_SYDNEY.date()
TOMORROW, YESTERDAY = (TODAY + timedelta(days=1)).isoformat(), (TODAY - timedelta(days=1)).isoformat()

ADMIN, PAT, OTHER, QUINN = uid("ada"), uid("pat"), uid("olga"), uid("quinn")
TINA, LEO, PIA = uid("tina"), uid("leo"), uid("pia")
FIX = uid("fix-tap")
# Pat's jobs, by what the suspension does with them.
SOON, TODAYS, UNDATED = uid("soon"), uid("todays"), uid("undated")
PAST, ENQUIRY, WORKING, DONE, CANCELLED, OTHERS = (
    uid("past"), uid("enquiry"), uid("working"), uid("done"), uid("cancelled"), uid("others"))


@pytest.fixture(autouse=True)
def clocks(monkeypatch):
    """One Sydney moment for the bookings and for what the suspension counts as upcoming."""
    freeze_clock(monkeypatch, bookings, NOW_IN_SYDNEY)
    freeze_clock(monkeypatch, admin_providers, NOW_IN_SYDNEY)


@pytest.fixture(autouse=True)
def fresh_scans(monkeypatch):
    monkeypatch.setattr(public_profiles, "_scans", {})
    monkeypatch.setattr(public_profiles, "SCAN_TTL_SECONDS", 0)


@pytest.fixture
def db(strict_schema):
    strict_schema.seed("service_categories", [category_row("tradie")], schema="web")
    strict_schema.seed("users", [
        person(OTHER, "Olga Other", "SERVICE_PROVIDER"),
        person(QUINN, "Quinn Quiet", "SERVICE_PROVIDER", verification_status="PENDING"),
        person(TINA, "Tina Tenant"),
        person(LEO, "Leo Landlord", "LANDLORD"),
        person(PIA, "Pia Provider", "SERVICE_PROVIDER"),
    ])
    strict_schema.seed("service_provider_profiles", [
        {**provider_profile(OTHER, "Other Co", slug="other-co"), "verification_status": "APPROVED"},
        provider_profile(QUINN, "Quiet Co", slug="quiet-co", published=False),
    ])
    strict_schema.seed("mobile_provider_services", [service(FIX, PAT, "Fix a tap", price=150)])
    strict_schema.seed("reviews", [review_row(uid("review"), PAT, TINA, 5, body="Quick and tidy")])
    strict_schema.seed("provider_availability", [make_availability(PAT, 1, id=uid("hours"))], schema="web")
    strict_schema.seed("provider_portfolio", [
        {"id": uid("photo"), "provider_id": PAT, "image_url": "https://example.test/tap.jpg", "title": "Tap"},
    ], schema="web")
    job = {"service_id": FIX, "price": 150, "property_suburb": "Newtown", "scheduled_time": "10:00:00"}
    strict_schema.seed("bookings", [
        booking(SOON, TINA, PAT, "confirmed", **job, scheduled_date=TOMORROW),
        booking(TODAYS, LEO, PAT, "confirmed", **job, scheduled_date=TODAY.isoformat()),
        booking(UNDATED, PIA, PAT, "confirmed", service_id=FIX, price=150),
        booking(PAST, TINA, PAT, "confirmed", **job, scheduled_date=YESTERDAY),
        booking(ENQUIRY, TINA, PAT, "new_enquiry", **job, scheduled_date=TOMORROW),
        booking(WORKING, LEO, PAT, "in_progress", **job, scheduled_date=YESTERDAY),
        booking(DONE, TINA, PAT, "completed", **job, scheduled_date=YESTERDAY),
        booking(CANCELLED, LEO, PAT, "cancelled", **job, scheduled_date=TOMORROW),
        booking(OTHERS, TINA, OTHER, "confirmed", scheduled_date=TOMORROW),
    ], schema="web")
    strict_schema.seed("invoices", [invoice(uid("invoice"), PAT, DONE, "INV-7", 150)], schema="web")
    return strict_schema


@pytest.fixture
def pat(db):
    """Pat's headers: a verified, live plumber with a sign-in."""
    token = account(db, PAT, "pat@example.test", "SERVICE_PROVIDER", full_name="Pat Plumber",
                    verification_status="APPROVED")
    db.seed("service_provider_profiles", [
        {**provider_profile(PAT, "Pat's Plumbing", slug="pats-plumbing"), "verification_status": "APPROVED"},
    ])
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin(db):
    token = account(db, ADMIN, "ada@example.test", "ADMIN", full_name="Ada Admin")
    return {"Authorization": f"Bearer {token}"}


def user(db, user_id):
    return next(row for row in db.tables["users"] if row["id"] == user_id)


def change(client, admin, user_id, status, reason=None):
    response = client.post(f"{API}/admin/users/{user_id}/status", json={"status": status, "reason": reason},
                           headers=admin)
    assert response.status_code == 200, response.text
    return response.json()


def listed(client, **params):
    response = client.get(f"{API}/providers", params=params)
    assert response.status_code == 200, response.text
    return [provider["id"] for provider in response.json()]


def notices(db):
    return [(row["user_id"], row["title"], row["link"]) for row in rows(db, "notifications")]


# ---------------------------------------------------------------------------
# What a suspended provider keeps
# ---------------------------------------------------------------------------
def test_a_suspended_provider_still_signs_in_and_reads_their_past_work(client, db, pat, admin):
    thread = seed_thread(db, [PAT, TINA])
    db.seed("messages", [message(thread, TINA, "Is Tuesday still fine?", "2025-12-31T10:00:00+00:00",
                                 id=uid("question"))])
    change(client, admin, PAT, "SUSPENDED", "Unlicensed work")

    login = client.post(f"{API}/auth/login", json={"email": "pat@example.test", "password": "password123"})
    assert login.status_code == 200, login.text
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    jobs = client.get(f"{API}/bookings", headers=headers)
    assert jobs.status_code == 200, jobs.text
    assert {job["id"] for job in jobs.json()} == {SOON, TODAYS, UNDATED, PAST, ENQUIRY, WORKING, DONE, CANCELLED}
    invoices = client.get(f"{API}/me/invoices", headers=headers)
    assert [item["number"] for item in invoices.json()] == ["INV-7"]
    messages = client.get(f"{API}/conversations/{thread}/messages", headers=headers)
    assert [item["body"] for item in messages.json()] == ["Is Tuesday still fine?"]
    # Their own profile still opens, though nobody else can find it.
    assert client.get(f"{API}/me/provider", headers=headers).json()["id"] == PAT


def test_a_suspended_provider_may_finish_a_job_in_progress(client, db, pat, admin):
    change(client, admin, PAT, "SUSPENDED", "Unlicensed work")

    response = client.patch(f"{API}/bookings/{WORKING}", json={"status": "completed", "completion_report": "Fixed"},
                            headers=pat)

    assert response.status_code == 200, response.text
    assert web_rows(db, "bookings", id=WORKING)[0]["status"] == "completed"


@pytest.mark.parametrize("primary_role", ["TENANT", "LANDLORD", "AGENT"])
def test_anyone_else_suspended_is_still_refused(client, db, primary_role):
    token = account(db, uid("sam"), "sam@example.test", primary_role, status="SUSPENDED")

    login = client.post(f"{API}/auth/login", json={"email": "sam@example.test", "password": "password123"})
    me = client.get(f"{API}/profiles/me", headers={"Authorization": f"Bearer {token}"})

    assert (login.status_code, me.status_code) == (403, 403)
    assert me.json()["detail"] == "This account is suspended. Contact support to restore access."


def test_a_suspended_provider_gets_no_new_work_from_the_gates(client, db, pat, admin):
    change(client, admin, PAT, "SUSPENDED", "Unlicensed work")
    provider = CurrentProfile(id=PAT, role="service_provider", full_name="Pat Plumber", raw={})

    for action in ("accept_booking", "receive_repairs", "go_live"):
        with pytest.raises(HTTPException) as refused:
            gates.require_verified(provider, action)
        assert refused.value.detail["status"] == "suspended"
    with pytest.raises(HTTPException) as refused:
        gates.require_verified_party(PAT, "receive_repairs")
    assert refused.value.detail["status"] == "unavailable"


# ---------------------------------------------------------------------------
# Clients with confirmed upcoming bookings are told
# ---------------------------------------------------------------------------
def test_suspending_a_provider_tells_the_clients_of_their_confirmed_upcoming_bookings(client, db, pat, admin):
    change(client, admin, PAT, "SUSPENDED", "Unlicensed work")

    title = "Your booking with Pat's Plumbing may not go ahead"
    assert sorted(notices(db)) == sorted([
        (TINA, title, "/tenant/bookings"),
        (LEO, title, "/owner/bookings"),
        (PIA, title, "/dashboard/client-bookings"),
    ])
    by_client = {row["user_id"]: row for row in rows(db, "notifications")}
    assert by_client[TINA]["body"] == (
        "Fix a tap · Newtown · Wed 16 Jan at 10:00 am. Pat's Plumbing can't take on work on TenantVoice for now. "
        "You can cancel this booking from your bookings."
    )
    assert by_client[PIA]["body"].startswith("Fix a tap. Pat's Plumbing can't take on work")
    assert {row["category"] for row in rows(db, "notifications")} == {"project"}
    # The reason stays in the audit log, and the bookings stay as they were, for the clients to cancel.
    assert all("Unlicensed" not in row["body"] for row in rows(db, "notifications"))
    assert {row["id"] for row in web_rows(db, "bookings", status="confirmed")} == {SOON, TODAYS, UNDATED, PAST, OTHERS}


@pytest.mark.parametrize("steps, told", [
    # Into suspension or deactivation from active work: the three clients are told.
    (["SUSPENDED"], [3]),
    (["DEACTIVATED"], [3]),
    # Already out of work: told once only.
    (["SUSPENDED", "DEACTIVATED"], [3, 0]),
    (["DEACTIVATED", "SUSPENDED"], [3, 0]),
    # Enabling tells nobody; suspending again tells them again.
    (["SUSPENDED", "ACTIVE"], [3, 0]),
    (["SUSPENDED", "ACTIVE", "SUSPENDED"], [3, 0, 3]),
])
def test_clients_are_told_each_time_the_provider_stops_taking_work(client, db, pat, admin, steps, told):
    answers = [change(client, admin, PAT, status, None if status == "ACTIVE" else "A reason") for status in steps]

    assert len(notices(db)) == sum(told)
    # Each answer says how many notices that change itself sent, for the admin's message.
    assert [answer["notified"] for answer in answers] == told


def test_suspending_someone_who_is_not_a_provider_tells_nobody(client, db, admin):
    change(client, admin, TINA, "SUSPENDED", "Harassment")
    change(client, admin, LEO, "DEACTIVATED", "Asked to close")

    assert notices(db) == []


def test_a_failed_notice_never_undoes_the_suspension(client, db, pat, admin, monkeypatch, caplog):
    def unreachable(rows, viewer_id=None):
        raise ConnectionError("database unreachable")

    monkeypatch.setattr(bookings, "decorate", unreachable)

    body = change(client, admin, PAT, "SUSPENDED", "Fraud")

    assert (body["status"], user(db, PAT)["status"]) == ("SUSPENDED", "SUSPENDED")
    assert notices(db) == []
    # The admin is told no client heard, though three have upcoming bookings.
    assert (body["notified"], body["provider"]["upcoming_bookings"]) == (0, 3)
    assert "could not tell the clients of provider" in caplog.text


# ---------------------------------------------------------------------------
# Enabling
# ---------------------------------------------------------------------------
def test_enabling_a_provider_lists_them_again_while_their_profile_is_live(client, db, pat, admin):
    change(client, admin, PAT, "SUSPENDED", "Unlicensed work")
    assert PAT not in listed(client)

    body = change(client, admin, PAT, "ACTIVE")

    assert user(db, PAT)["status"] == "ACTIVE"
    assert PAT in listed(client)
    assert client.get(f"{API}/providers/pats-plumbing").status_code == 200
    assert (body["provider"]["listed"], body["provider"]["standing"]) == (True, "approved")


def test_enabling_never_publishes_a_profile(client, db, admin):
    user(db, QUINN)["status"] = "SUSPENDED"
    verify(db, QUINN)

    body = change(client, admin, QUINN, "ACTIVE")

    assert user(db, QUINN)["status"] == "ACTIVE"
    assert body["provider"] == {
        "has_profile": True, "published": False, "listed": False, "standing": "approved",
        "upcoming_bookings": 0, "jobs_in_progress": 0,
    }
    assert QUINN not in listed(client)


@pytest.mark.parametrize("out_of_work", ["SUSPENDED", "DEACTIVATED"])
@pytest.mark.parametrize("account_verification, profile_verification", [
    ("PENDING", "PENDING"), ("REJECTED", "REJECTED"), ("APPROVED", "PENDING"),
])
def test_only_an_approved_provider_is_enabled(
    client, db, pat, admin, out_of_work, account_verification, profile_verification,
):
    change(client, admin, PAT, out_of_work, "Unlicensed work")
    # A licence replaced meanwhile is back in review: enabling would list the live profile at once.
    user(db, PAT)["verification_status"] = account_verification
    next(row for row in db.tables["service_provider_profiles"] if row["user_id"] == PAT)["verification_status"] = (
        profile_verification)
    entries = len(db.tables["mobile_admin_audit_entries"])

    response = client.post(f"{API}/admin/users/{PAT}/status", json={"status": "ACTIVE"}, headers=admin)

    assert (response.status_code, response.json()["detail"]) == (
        409, "Only an approved provider can be enabled. Approve their verification first, then enable the account.",
    )
    assert user(db, PAT)["status"] == out_of_work
    assert PAT not in listed(client)
    assert len(db.tables["mobile_admin_audit_entries"]) == entries
    # Approved again, they are enabled and listed.
    verify(db, PAT)
    assert change(client, admin, PAT, "ACTIVE")["provider"]["listed"] is True


def test_enabling_anyone_else_needs_no_verification(client, db, admin):
    user(db, TINA)["status"] = "SUSPENDED"

    change(client, admin, TINA, "ACTIVE")

    assert (user(db, TINA)["status"], user(db, TINA)["verification_status"]) == ("ACTIVE", "PENDING")


# ---------------------------------------------------------------------------
# The admin account page
# ---------------------------------------------------------------------------
def test_the_account_page_shows_a_providers_marketplace_state_and_open_jobs(client, db, pat, admin):
    shown = client.get(f"{API}/admin/users/{PAT}", headers=admin).json()["provider"]
    assert shown == {
        "has_profile": True, "published": True, "listed": True, "standing": "approved",
        "upcoming_bookings": 3, "jobs_in_progress": 1,
    }

    suspended = change(client, admin, PAT, "SUSPENDED", "Unlicensed work")["provider"]

    assert suspended == {**shown, "listed": False, "standing": "suspended"}


def test_the_account_page_has_no_provider_section_for_anyone_else(client, db, admin):
    assert client.get(f"{API}/admin/users/{TINA}", headers=admin).json()["provider"] is None
    # A verified provider account the web has no profile row for, so the gates refuse it.
    db.seed("users", [provider_user(uid("new"), "New Provider", verification_status="APPROVED")])
    assert client.get(f"{API}/admin/users/{uid('new')}", headers=admin).json()["provider"] == {
        "has_profile": False, "published": False, "listed": False, "standing": "unknown",
        "upcoming_bookings": 0, "jobs_in_progress": 0,
    }


@pytest.mark.parametrize("primary_role", ["TENANT", "LANDLORD", "SERVICE_PROVIDER", "REGULATOR"])
def test_only_an_admin_reads_or_changes_a_providers_status(client, db, pat, primary_role):
    token = account(db, uid("caller"), "caller@example.test", primary_role)
    headers = {"Authorization": f"Bearer {token}"}

    read = client.get(f"{API}/admin/users/{PAT}", headers=headers)
    changed = client.post(f"{API}/admin/users/{PAT}/status", json={"status": "SUSPENDED", "reason": "x"},
                          headers=headers)

    assert (read.status_code, changed.status_code) == (403, 403)
    assert user(db, PAT)["status"] == "ACTIVE"
    assert notices(db) == []


def test_a_provider_cannot_lift_their_own_suspension(client, db, pat, admin):
    change(client, admin, PAT, "SUSPENDED", "Unlicensed work")

    response = client.post(f"{API}/admin/users/{PAT}/status", json={"status": "ACTIVE"}, headers=pat)

    assert response.status_code == 403
    assert user(db, PAT)["status"] == "SUSPENDED"


# ---------------------------------------------------------------------------
# The workspace says why: GET /me/standing
# ---------------------------------------------------------------------------
def test_a_provider_reads_their_own_standing_as_the_gates_do(client, db, pat, admin):
    assert client.get(f"{API}/me/standing", headers=pat).json() == {"state": "approved"}

    change(client, admin, PAT, "SUSPENDED", "Unlicensed work")

    response = client.get(f"{API}/me/standing", headers=pat)
    assert response.status_code == 200, response.text
    assert response.json() == {"state": "suspended"}
    # Back to work once enabled, read at each request.
    change(client, admin, PAT, "ACTIVE")
    assert client.get(f"{API}/me/standing", headers=pat).json() == {"state": "approved"}


def test_the_standing_is_the_callers_own_and_needs_a_sign_in(client, db, pat):
    user(db, TINA)["verification_status"] = "REJECTED"
    tina = signed_in_as(db, TINA, "tina@example.test")
    quinn = signed_in_as(db, QUINN, "quinn@example.test")

    assert client.get(f"{API}/me/standing").status_code == 401
    assert client.get(f"{API}/me/standing", headers=tina).json() == {"state": "rejected"}
    assert client.get(f"{API}/me/standing", headers=quinn).json() == {"state": "pending"}
    assert client.get(f"{API}/me/standing", headers=pat).json() == {"state": "approved"}


# ---------------------------------------------------------------------------
# Messages: a suspended provider writes only about a job in progress
# ---------------------------------------------------------------------------
def signed_in_as(db, user_id, email):
    """Headers for a users row the fixture seeded, given a sign-in of its own."""
    token = db.add_auth_user(email)
    user(db, user_id)["auth_user_id"] = db.tokens[token]
    return {"Authorization": f"Bearer {token}"}


def sent(db, thread):
    return [row["content"] for row in rows(db, "messages", conversation_id=thread)]


def test_a_suspended_provider_messages_only_the_people_of_a_job_in_progress(client, db, pat, admin):
    # Tina's jobs with Pat are confirmed or done; Leo's is in progress.
    with_tina = seed_thread(db, [PAT, TINA])
    change(client, admin, PAT, "SUSPENDED", "Harassing clients")

    refused = client.post(f"{API}/conversations/{with_tina}/messages", json={"body": "Still here"}, headers=pat)
    opened = client.post(f"{API}/conversations", json={"provider_id": PAT, "client_id": TINA}, headers=pat)
    working = client.post(f"{API}/conversations", json={"provider_id": PAT, "client_id": LEO, "booking_id": WORKING},
                          headers=pat)

    assert (refused.status_code, opened.status_code) == (403, 403)
    assert refused.json()["detail"] == "Your account is suspended, so you can only message the people of a job in progress."
    assert sent(db, with_tina) == []
    assert working.status_code == 201, working.text
    reply = client.post(f"{API}/conversations/{working.json()['id']}/messages", json={"body": "Back at 2pm."}, headers=pat)
    assert reply.status_code == 201, reply.text
    # Reading stays open.
    assert client.get(f"{API}/conversations/{with_tina}/messages", headers=pat).status_code == 200


def test_a_suspended_provider_messages_the_people_of_a_repair_in_progress(client, db, pat, admin):
    landlord = uid("quentin")
    db.seed("users", [person(landlord, "Quentin Owner", "LANDLORD")])
    db.seed("complaints", [{"id": uid("case"), "reporter_user_id": TINA, "category": "maintenance",
                            "description": "Tap drips.", "lodged_at": "2026-01-01T00:00:00+00:00"}])
    db.seed("maintenance_work_orders", [{
        "id": uid("job"), "complaint_id": uid("case"), "tenant_user_id": TINA, "landlord_user_id": landlord,
        "assigned_worker_id": PAT, "status": "SCHEDULED", "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
    }])
    with_tina = seed_thread(db, [PAT, TINA])
    change(client, admin, PAT, "SUSPENDED", "Unlicensed work")

    response = client.post(f"{API}/conversations/{with_tina}/messages", json={"body": "Running late."}, headers=pat)

    assert response.status_code == 201, response.text
    assert sent(db, with_tina) == ["Running late."]


def threads_between(db, first, second) -> list[str]:
    members: dict[str, set] = {}
    for row in rows(db, "conversation_participants"):
        members.setdefault(row["conversation_id"], set()).add(row["user_id"])
    return [thread for thread, people in members.items() if people == {first, second}]


def test_no_new_client_opens_a_thread_with_a_suspended_provider(client, db, pat, admin):
    newcomer = account(db, uid("nora"), "nora@example.test", "TENANT", full_name="Nora New")
    change(client, admin, PAT, "SUSPENDED", "Unlicensed work")

    fresh = client.post(f"{API}/conversations", json={"provider_id": PAT}, headers={"Authorization": f"Bearer {newcomer}"})

    # The marketplace no longer lists Pat.
    assert fresh.status_code == 404


@pytest.mark.parametrize("out_of_work", ["SUSPENDED", "DEACTIVATED"])
def test_a_client_starts_a_thread_with_a_provider_out_of_work_only_about_a_job_in_progress(
    client, db, pat, admin, out_of_work,
):
    # Tina has had and booked jobs with Pat (done, and confirmed from tomorrow) but none in progress;
    # Leo's WORKING booking is, and his CANCELLED one is not.
    tina = signed_in_as(db, TINA, "tina@example.test")
    leo = signed_in_as(db, LEO, "leo@example.test")
    change(client, admin, PAT, out_of_work, "Unlicensed work")

    upcoming = client.post(f"{API}/conversations", json={"provider_id": PAT, "booking_id": SOON}, headers=tina)
    general = client.post(f"{API}/conversations", json={"provider_id": PAT}, headers=tina)
    cancelled = client.post(f"{API}/conversations", json={"provider_id": PAT, "booking_id": CANCELLED}, headers=leo)
    working = client.post(f"{API}/conversations", json={"provider_id": PAT, "booking_id": WORKING}, headers=leo)
    leos_general = client.post(f"{API}/conversations", json={"provider_id": PAT}, headers=leo)

    assert (upcoming.status_code, general.status_code, cancelled.status_code) == (404, 404, 404)
    assert threads_between(db, TINA, PAT) == []
    assert (working.status_code, leos_general.status_code) == (201, 201), (working.text, leos_general.text)
    assert working.json()["booking_id"] == WORKING


def test_the_tenant_of_a_repair_in_progress_starts_a_thread_with_its_suspended_provider(client, db, pat, admin):
    db.seed("complaints", [{"id": uid("case"), "reporter_user_id": TINA, "category": "maintenance",
                            "description": "Tap drips.", "lodged_at": "2026-01-01T00:00:00+00:00"}])
    db.seed("maintenance_work_orders", [{
        "id": uid("job"), "complaint_id": uid("case"), "tenant_user_id": TINA, "assigned_worker_id": PAT,
        "status": "SCHEDULED", "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00",
    }])
    tina = signed_in_as(db, TINA, "tina@example.test")
    change(client, admin, PAT, "SUSPENDED", "Unlicensed work")

    response = client.post(f"{API}/conversations", json={"provider_id": PAT}, headers=tina)

    assert response.status_code == 201, response.text
    assert threads_between(db, TINA, PAT) == [response.json()["id"]]


def test_a_thread_a_client_already_has_with_a_suspended_provider_still_opens(client, db, pat, admin):
    with_tina = seed_thread(db, [PAT, TINA])
    tina = signed_in_as(db, TINA, "tina@example.test")
    change(client, admin, PAT, "SUSPENDED", "Unlicensed work")

    opened = client.post(f"{API}/conversations", json={"provider_id": PAT}, headers=tina)

    assert opened.status_code == 201, opened.text
    assert opened.json()["id"] == with_tina
    assert threads_between(db, TINA, PAT) == [with_tina]
    # Messages to him still arrive, say to cancel a booking.
    assert client.post(f"{API}/conversations/{with_tina}/messages", json={"body": "Can we cancel?"},
                       headers=tina).status_code == 201


def test_a_connection_opens_no_new_message_thread_with_a_suspended_provider(client, db, pat, admin):
    db.seed("connection_requests", [connection(TINA, PAT), connection(LEO, PAT)])
    tina = signed_in_as(db, TINA, "tina@example.test")
    leo = signed_in_as(db, LEO, "leo@example.test")
    change(client, admin, PAT, "SUSPENDED", "Unlicensed work")

    refused = client.post(f"{API}/conversations/rental", json={"peer_id": PAT, "body": "Hi Pat"}, headers=tina)
    working = client.post(f"{API}/conversations/rental", json={"peer_id": PAT}, headers=leo)

    assert refused.status_code == 403
    assert refused.json()["detail"] == "This provider isn't taking new conversations right now."
    assert threads_between(db, TINA, PAT) == []
    assert rows(db, "messages") == []
    # Leo's booking with Pat is in progress.
    assert working.status_code == 201, working.text


@pytest.mark.parametrize("who, sends", [
    ("tenant", lambda listing: {"owner_id": PAT, "body": "Hi Pat"}),
    ("landlord", lambda listing: {"tenant_id": PAT, "body": "Hi Pat"}),
    ("landlord", lambda listing: {"tenant_id": PAT, "property_id": listing, "body": "Hi Pat"}),
], ids=["a tenant naming the owner", "a landlord naming the tenant", "a landlord about their listing"])
def test_no_way_of_naming_the_other_side_opens_a_new_thread_with_a_suspended_provider(client, db, pat, admin, who, sends):
    db.seed("connection_requests", [connection(TINA, PAT), connection(LEO, PAT)])
    listing, _ = seed_listing(db, owner=LEO)
    # Leo's job in progress with Pat is done: neither of them has one with him now.
    next(row for row in web_rows(db, "bookings") if row["id"] == WORKING)["status"] = "completed"
    caller, user_id = ("tina@example.test", TINA) if who == "tenant" else ("leo@example.test", LEO)
    headers = signed_in_as(db, user_id, caller)
    change(client, admin, PAT, "SUSPENDED", "Unlicensed work")

    response = client.post(f"{API}/conversations/rental", json=sends(listing), headers=headers)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "This provider isn't taking new conversations right now."
    assert threads_between(db, user_id, PAT) == []
    assert rows(db, "messages") == []


def test_a_landlord_with_a_job_in_progress_still_names_a_suspended_provider_as_the_tenant(client, db, pat, admin):
    db.seed("connection_requests", [connection(LEO, PAT)])
    leo = signed_in_as(db, LEO, "leo@example.test")
    change(client, admin, PAT, "SUSPENDED", "Unlicensed work")

    # Leo's WORKING booking with Pat is in progress.
    response = client.post(f"{API}/conversations/rental", json={"tenant_id": PAT, "body": "When do you finish?"},
                           headers=leo)

    assert response.status_code == 201, response.text
    assert threads_between(db, LEO, PAT) == [response.json()["id"]]


def test_a_message_thread_a_connection_already_has_with_a_suspended_provider_still_opens(client, db, pat, admin):
    db.seed("connection_requests", [connection(TINA, PAT)])
    dm = seed_thread(db, [PAT, TINA])
    tina = signed_in_as(db, TINA, "tina@example.test")
    change(client, admin, PAT, "SUSPENDED", "Unlicensed work")

    response = client.post(f"{API}/conversations/rental", json={"peer_id": PAT}, headers=tina)
    by_owner = client.post(f"{API}/conversations/rental", json={"owner_id": PAT}, headers=tina)

    assert response.status_code == 201, response.text
    assert response.json()["id"] == dm
    assert by_owner.status_code == 201, by_owner.text
    assert by_owner.json()["id"] == dm


def test_messages_flow_as_before_for_an_active_provider(client, db, pat):
    with_tina = seed_thread(db, [PAT, TINA])

    response = client.post(f"{API}/conversations/{with_tina}/messages", json={"body": "See you Tuesday."}, headers=pat)

    assert response.status_code == 201, response.text
