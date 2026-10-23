"""The provider walkthrough seed (scripts/seed_provider_demo.py) on the shared schema.

Regression cover: the script read the legacy profiles, service_providers and
provider_services tables, so it stopped with PGRST205 before writing, and it
wrote legacy-shaped bookings, reviews, threads and messages into public. It
now checks the demo accounts' users rows and writes bookings, invoices and
payments into the web schema and threads, messages and reviews as the
shared rows the API reads.
"""

import sys
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

import pytest

from app.core import supabase as supabase_module
from app.core.config import settings
from scripts.seed_provider_demo import (
    AMELIA_ID, CLIENT_IDS, CLIENT_NAMES, SERVICE_TITLES, TABLES, WEB_TABLES, build_dataset, demo_id, main,
)
from tests.factories import NOW
from tests.factories_bookings import person, rows, uid, web_rows
from tests.factories_provider_core import provider_profile, service_row

pytestmark = pytest.mark.usefixtures("strict_schema")

CLIENT_ROLES = ["LANDLORD"] * 7 + ["TENANT"] * 3
SERVICE_IDS = [uid(f"demo-service-{index}") for index in range(len(SERVICE_TITLES))]
PRICES = [99, 200, 150, 280]


def services() -> list[dict]:
    return [service_row(service_id, AMELIA_ID, title=title, price=price)
            for service_id, title, price in zip(SERVICE_IDS, SERVICE_TITLES, PRICES, strict=True)]


def dataset(anchor=date(2026, 9, 23)):
    return build_dataset(AMELIA_ID, services(), anchor)


def test_demo_data_stays_inside_seed_accounts_and_has_stable_ids():
    first, later = dataset(), dataset(date(2027, 1, 2))
    people = {AMELIA_ID, *CLIENT_IDS}
    for table, table_rows in first.items():
        assert [r["id"] for r in table_rows] == [r["id"] for r in later[table]]
        assert len({r["id"] for r in table_rows}) == len(table_rows)
        for row in table_rows:
            for key in ("client_id", "provider_id", "user_id", "sender_user_id", "receiver_user_id",
                        "reviewer_user_id", "reviewed_user_id", "created_by_user_id"):
                if row.get(key) is not None:
                    assert row[key] in people, (table, key)
    assert {row["provider_id"] for table in WEB_TABLES for row in first[table]} == {AMELIA_ID}


def test_demo_finance_reviews_and_threads_match_their_bookings():
    data = dataset()
    bookings = {b["id"]: b for b in data["bookings"]}
    reviews = {r["id"]: r for r in data["reviews"]}
    reviewed = [b for b in bookings.values() if b["review_id"]]
    assert {b["review_id"] for b in reviewed} == set(reviews)
    for booking in reviewed:
        review = reviews[booking["review_id"]]
        assert booking["status"] == "completed"
        assert (review["reviewer_user_id"], review["reviewed_user_id"]) == (booking["client_id"], AMELIA_ID)
        assert review["created_at"][:10] >= booking["scheduled_date"]
    payments = {t["booking_id"]: t for t in data["transactions"] if t["type"] == "payment"}
    fees = {t["booking_id"]: t for t in data["transactions"] if t["type"] == "platform_fee"}
    for invoice in data["invoices"]:
        booking = bookings[invoice["booking_id"]]
        assert invoice["amount"] == booking["price"]
        if invoice["status"] == "paid":
            assert payments[booking["id"]]["amount"] == invoice["amount"]
            expected = (Decimal(str(invoice["amount"])) * Decimal("0.085")).quantize(Decimal("0.01"), ROUND_HALF_UP)
            assert Decimal(str(fees[booking["id"]]["amount"])) == expected
        else:
            assert booking["id"] not in payments
    threads = {t["id"]: t for t in data["conversations"]}
    assert {b["conversation_id"] for b in bookings.values() if b["conversation_id"]} == set(threads)
    for thread in threads.values():
        booking = bookings[thread["metadata"]["booking_id"]]
        assert booking["conversation_id"] == thread["id"]
        assert (thread["metadata"]["client_id"], thread["metadata"]["provider_id"]) == (booking["client_id"], AMELIA_ID)
        members = {p["user_id"] for p in data["conversation_participants"] if p["conversation_id"] == thread["id"]}
        assert members == {booking["client_id"], AMELIA_ID}
    for message in data["messages"]:
        assert message["sender_user_id"] in {AMELIA_ID, threads[message["conversation_id"]]["metadata"]["client_id"]}
    assert all(b["scheduled_date"] >= "2026-09-23" for b in bookings.values() if b["status"] != "completed")


def test_demo_fee_uses_runtime_half_up_rounding():
    data = dataset()
    fees = {row["booking_id"]: row["amount"] for row in data["transactions"] if row["type"] == "platform_fee"}
    appraisals = [row for row in data["bookings"] if row["status"] == "completed" and row["price"] == 99]
    assert appraisals
    assert all(fees[booking["id"]] == 8.42 for booking in appraisals)


@pytest.fixture
def demo_db(fake_db):
    """The demo accounts the script checks before writing: users rows, Amelia's business and her services."""
    fake_db.seed("users", [person(AMELIA_ID, "Amelia Whitlock", "SERVICE_PROVIDER", email="amelia@demo.test")])
    fake_db.seed("users", [person(client_id, name, role)
                           for client_id, name, role in zip(CLIENT_IDS, CLIENT_NAMES, CLIENT_ROLES, strict=True)])
    fake_db.seed("service_provider_profiles", [provider_profile(AMELIA_ID, business_name="Whitlock Property",
                                                                slug="whitlock-property")])
    fake_db.seed("mobile_provider_services", services())
    return fake_db


def seed(monkeypatch, capsys, *args) -> str:
    """Run the script against the fake database and return what it printed."""
    monkeypatch.setattr(sys, "argv", ["seed_provider_demo", "--date", "2026-10-21", *args])
    capsys.readouterr()
    main()
    return capsys.readouterr().out


def saved(db, table, key):
    stored = web_rows(db, table) if table in WEB_TABLES else rows(db, table)
    return next(row for row in stored if row["id"] == demo_id(key))


def written(db) -> dict[str, int]:
    return {table: len(web_rows(db, table) if table in WEB_TABLES else rows(db, table)) for table in TABLES}


def test_a_preview_writes_nothing(demo_db, monkeypatch, capsys):
    out = seed(monkeypatch, capsys)

    assert "bookings: 24 new, 0 already present" in out and "No changes made" in out
    assert set(written(demo_db).values()) == {0}


def test_the_walkthrough_reads_back_through_the_api(client, demo_db, as_profile, monkeypatch, capsys):
    seed(monkeypatch, capsys, "--apply")
    as_profile(AMELIA_ID, "service_provider", "Amelia Whitlock")

    bookings = client.get("/api/v1/bookings")
    assert bookings.status_code == 200, bookings.text
    by_id = {b["id"]: b for b in bookings.json()}
    assert len(by_id) == 24
    open_job, reviewed_job = by_id[demo_id("booking-19")], by_id[demo_id("booking-4")]
    assert (open_job["status"], open_job["conversation_id"], open_job["unread_count"]) == (
        "confirmed", demo_id("conversation-19"), 1)
    assert (open_job["client_name"], open_job["service_title"]) == ("Tom Whittaker", "Listing preparation")
    assert (reviewed_job["review_rating"], reviewed_job["conversation_id"]) == (4, None)

    threads = client.get("/api/v1/conversations").json()
    assert len(threads) == 6
    thread = next(t for t in threads if t["id"] == demo_id("conversation-19"))
    assert (thread["kind"], thread["booking_id"], thread["counterpart_name"], thread["unread_count"]) == (
        "marketplace", demo_id("booking-19"), "Tom Whittaker", 1)
    messages = client.get(f"/api/v1/conversations/{thread['id']}/messages").json()
    assert [m["sender_id"] for m in messages] == [CLIENT_IDS[9], AMELIA_ID, CLIENT_IDS[9]]

    reviews = client.get("/api/v1/me/reviews").json()
    assert len(reviews) == 9 and all(r["comment"] and r["service_title"] in SERVICE_TITLES for r in reviews)
    finance = client.get("/api/v1/me/dashboard/provider/finance")
    assert finance.status_code == 200, finance.text
    assert len(client.get("/api/v1/me/invoices").json()) == 22
    assert len(client.get("/api/v1/me/transactions").json()) == 36
    notices = rows(demo_db, "notifications", user_id=AMELIA_ID)
    assert sorted(n["category"] for n in notices) == ["project", "social", "social", "system"]


def test_demo_connections_are_listed_on_the_network_page(client, demo_db, as_profile, monkeypatch, capsys):
    assert "connection_requests: 7 new, 0 already present" in seed(monkeypatch, capsys, "--apply")

    as_profile(AMELIA_ID, "service_provider")
    network = client.get("/api/v1/me/connections")
    assert network.status_code == 200, network.text
    assert sorted((c["person_name"], c["status"], c["direction"]) for c in network.json()) == [
        ("Amanda Thorne", "pending", "outgoing"), ("David Kim", "pending", "incoming"),
        ("Elena Rodriguez", "pending", "incoming"), ("Emily Davis", "accepted", "incoming"),
        ("John Doe", "accepted", "outgoing"), ("Michael Chen", "accepted", "incoming"),
        ("Sarah Jenkins", "accepted", "outgoing"),
    ]


def test_demo_connections_keep_existing_pairs(demo_db, monkeypatch, capsys):
    # John already asked Amelia during a walkthrough.
    demo_db.seed("connection_requests", [{"id": uid("walkthrough"), "sender_user_id": CLIENT_IDS[0],
                                          "receiver_user_id": AMELIA_ID, "status": "PENDING", "created_at": NOW}])

    out = seed(monkeypatch, capsys, "--apply")

    assert "connection_requests: 6 new, 1 already present" in out
    pairs = [{r["sender_user_id"], r["receiver_user_id"]} for r in rows(demo_db, "connection_requests")]
    assert len(pairs) == 7
    assert pairs.count({CLIENT_IDS[0], AMELIA_ID}) == 1


def _rename(db, user_id, **changes):
    next(row for row in db.tables["users"] if row["id"] == user_id).update(changes)


@pytest.mark.parametrize("change, message", [
    (lambda db: _rename(db, AMELIA_ID, email="amelia@example.com"), "Expected Amelia seed account not found"),
    (lambda db: _rename(db, AMELIA_ID, primary_role="LANDLORD"), "Expected Amelia seed account not found"),
    (lambda db: _rename(db, AMELIA_ID, deleted_at=NOW), "Expected Amelia seed account not found"),
    (lambda db: db.tables["service_provider_profiles"][0].update(company_name="Other Co"),
     "Expected Whitlock Property seed provider not found"),
    (lambda db: _rename(db, CLIENT_IDS[3], primary_role="ADMIN"), "Required fictional client profiles are missing"),
    (lambda db: db.tables["users"].remove(next(u for u in db.tables["users"] if u["id"] == CLIENT_IDS[6])),
     "Required fictional client profiles are missing"),
    (lambda db: _rename(db, CLIENT_IDS[0], full_name="Someone Real"), "A client fixture was renamed"),
    (lambda db: db.tables["mobile_provider_services"].pop(), "Amelia's demo services are missing: Listing preparation"),
], ids=["amelia's email", "amelia's role", "amelia closed", "business", "client role", "client missing",
        "client renamed", "service missing"])
def test_nothing_is_written_unless_every_demo_account_is_the_seed_one(demo_db, monkeypatch, capsys, change, message):
    change(demo_db)

    with pytest.raises(SystemExit, match=message):
        seed(monkeypatch, capsys, "--apply")
    assert set(written(demo_db).values()) == {0}


def test_refresh_rewrites_old_demo_copy_but_keeps_walkthrough_changes(demo_db, monkeypatch, capsys):
    seed(monkeypatch, capsys, "--apply")
    # What an earlier version of this script saved, then a walkthrough changed.
    notice = saved(demo_db, "notifications", "notification-0")
    notice.update(body="Two demo enquiries are ready for your response.", is_read=True)
    fee = saved(demo_db, "transactions", "platform_fee-0")
    fee["amount"] = 8.41
    review = saved(demo_db, "reviews", "review-1")
    review["landlord_reply"] = "Thanks, see you next quarter."
    booking = saved(demo_db, "bookings", "booking-19")
    booking["status"] = "cancelled"

    assert "notifications: 0 new, 4 already present" in seed(monkeypatch, capsys, "--apply")
    preview = seed(monkeypatch, capsys, "--refresh")
    assert "notifications: 0 new, 1 to refresh, 3 unchanged" in preview
    assert (f"    {demo_id('notification-0')}: body 'Two demo enquiries are ready for your response.' -> "
            "'Review the demo enquiries awaiting your response.'; is_read True -> False\n") in preview
    assert "transactions: 0 new, 1 to refresh, 35 unchanged" in preview
    assert "No changes made" in preview
    assert (notice["body"], fee["amount"]) == ("Two demo enquiries are ready for your response.", 8.41)

    seed(monkeypatch, capsys, "--refresh", "--apply")

    assert (notice["body"], notice["is_read"]) == ("Review the demo enquiries awaiting your response.", False)
    assert fee["amount"] == 8.42
    assert review["landlord_reply"] == "Thanks, see you next quarter."
    assert booking["status"] == "cancelled"
    assert "notifications: 0 new, 0 to refresh, 4 unchanged" in seed(monkeypatch, capsys, "--refresh")


def test_refresh_rewrites_a_review_text_and_stamps_it(demo_db, monkeypatch, capsys):
    seed(monkeypatch, capsys, "--apply")
    review = saved(demo_db, "reviews", "review-2")
    original, stamped = review["body"], review["updated_at"]
    review.update(rating=3, landlord_rating=3, body="An earlier draft.")

    seed(monkeypatch, capsys, "--refresh", "--apply")

    assert (review["rating"], review["landlord_rating"], review["body"]) == (5, 5, original)
    assert review["updated_at"] != stamped


def test_payments_and_invoices_keep_the_price_their_booking_was_saved_with(demo_db, monkeypatch, capsys):
    seed(monkeypatch, capsys, "--apply")
    # A walkthrough raises the appraisal price after the demo is seeded, and an
    # earlier version of the script rounded one fee down.
    next(s for s in demo_db.tables["mobile_provider_services"] if s["title"] == "Rental appraisal")["price"] = 120
    saved(demo_db, "transactions", "platform_fee-0")["amount"] = 8.41
    # Rows lost since then are written again for their saved booking.
    for table, key in (("transactions", "payment-4"), ("invoices", "invoice-4")):
        demo_db.schema_tables["web"][table].remove(saved(demo_db, table, key))

    preview = seed(monkeypatch, capsys, "--refresh")
    assert (f"transactions: 1 new, 1 to refresh, 34 unchanged\n"
            f"    {demo_id('platform_fee-0')}: amount 8.41 -> 8.42\n") in preview

    seed(monkeypatch, capsys, "--refresh", "--apply")
    for index in (0, 4, 8, 12, 16):  # the completed appraisals
        booking = saved(demo_db, "bookings", f"booking-{index}")
        invoice = saved(demo_db, "invoices", f"invoice-{index}")
        payment, fee = (saved(demo_db, "transactions", f"{kind}-{index}") for kind in ("payment", "platform_fee"))
        assert (booking["price"], invoice["amount"], payment["amount"], fee["amount"]) == (99, 99, 99, 8.42)


# -- the shared production project -----------------------------------------------------------
PRODUCTION = "bwjhnjzczesjcebcdbdl"


@pytest.fixture
def connections(monkeypatch):
    """Each time the script asks for a database client, which a refused --apply never does."""
    asked = []
    real = supabase_module.get_supabase_client

    def counted():
        asked.append(True)
        return real()

    counted.cache_clear = real.cache_clear  # fake_db clears the client's cache after the test
    monkeypatch.setattr(supabase_module, "get_supabase_client", counted)
    return asked


@pytest.mark.parametrize("url", [
    f"https://{PRODUCTION}.supabase.co", f"https://{PRODUCTION.upper()}.supabase.co/", f"{PRODUCTION}.supabase.co",
])
def test_apply_never_writes_to_the_shared_production_project(demo_db, monkeypatch, capsys, connections, url):
    monkeypatch.setattr(settings, "supabase_url", url)

    with pytest.raises(SystemExit, match=f"SUPABASE_URL is the protected project {PRODUCTION}"):
        seed(monkeypatch, capsys, "--apply")

    assert set(written(demo_db).values()) == {0}
    assert connections == []


@pytest.mark.parametrize("typed", ["yes", PRODUCTION[:-1], f"{PRODUCTION}x", "abcdefghijklmnopqrst"])
def test_allowing_a_protected_project_needs_its_ref_typed_out(demo_db, monkeypatch, capsys, connections, typed):
    monkeypatch.setattr(settings, "supabase_url", f"https://{PRODUCTION}.supabase.co")

    with pytest.raises(SystemExit, match=f"names {typed}, but SUPABASE_URL is the protected project {PRODUCTION}"):
        seed(monkeypatch, capsys, "--apply", "--allow-protected-project", typed)

    assert set(written(demo_db).values()) == {0}
    assert connections == []


def test_the_ref_typed_out_lets_apply_write_to_a_protected_project(demo_db, monkeypatch, capsys):
    monkeypatch.setattr(settings, "supabase_url", f"https://{PRODUCTION}.supabase.co")

    out = seed(monkeypatch, capsys, "--apply", "--allow-protected-project", PRODUCTION)

    assert "bookings: 24 new, 0 already present" in out
    assert written(demo_db)["bookings"] == 24


def test_a_preview_of_a_protected_project_still_only_reads(demo_db, monkeypatch, capsys):
    monkeypatch.setattr(settings, "supabase_url", f"https://{PRODUCTION}.supabase.co")

    assert "No changes made" in seed(monkeypatch, capsys)
    assert set(written(demo_db).values()) == {0}


def test_the_setting_protects_more_projects_but_never_fewer(demo_db, monkeypatch, capsys, connections):
    monkeypatch.setattr(settings, "protected_project_refs", " stagingcopyref , ")
    monkeypatch.setattr(settings, "supabase_url", "https://stagingcopyref.supabase.co")
    with pytest.raises(SystemExit, match="protected project stagingcopyref"):
        seed(monkeypatch, capsys, "--apply")

    monkeypatch.setattr(settings, "supabase_url", f"https://{PRODUCTION}.supabase.co")
    with pytest.raises(SystemExit, match=f"protected project {PRODUCTION}"):
        seed(monkeypatch, capsys, "--apply")
    assert set(written(demo_db).values()) == {0}
    assert connections == []


def test_a_disposable_copy_is_written_as_before(demo_db, monkeypatch, capsys):
    monkeypatch.setattr(settings, "supabase_url", "https://disposablecopy01.supabase.co")

    seed(monkeypatch, capsys, "--apply")

    assert written(demo_db)["bookings"] == 24
