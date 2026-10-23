"""The stand-ins the rent ledger calls answer as the functions' bodies do.

Each case follows a branch of output/shared-catalog/functions/<name>.sql:
generate_upcoming_rent_charges' dates and mobile_my_rent_summary's balances
(tests/fake_rpcs/fb_rent.py), and mobile_owner_assistant_action's expense
checks and request ids (its one stand-in, tests/fake_rpcs/fb_owner_ai.py).
"""

from datetime import datetime, timezone

import pytest
from postgrest.exceptions import APIError

from app.core import supabase as supabase_module
from app.core.supabase import user_client
from tests import fake_supabase
from tests.factories_identity import account
from tests.factories_rental import listing_row, property_row

AGREEMENT = "e8000000-0000-4000-8000-000000000001"
OWNER = "e8100000-0000-4000-8000-000000000001"
TENANT = "e8100000-0000-4000-8000-000000000002"
PROPERTY = "e8200000-0000-4000-8000-000000000001"
LISTING = "e8200000-0000-4000-8000-000000000002"
REQUEST = "e8300000-0000-4000-8000-000000000001"


@pytest.fixture
def at(monkeypatch):
    """Set the database's now(), as the stand-ins read it."""
    def set_to(moment: datetime):
        monkeypatch.setattr(fake_supabase.RpcContext, "now", staticmethod(lambda: moment.isoformat()))
    set_to(datetime(2026, 10, 23, 1, 0, tzinfo=timezone.utc))
    return set_to


def _agreement(fake_db, **over):
    fake_db.seed("rent_agreements", [{
        "id": AGREEMENT, "application_id": "e8000000-0000-4000-8000-000000000009", "listing_id": LISTING,
        "tenant_user_id": TENANT, "owner_user_id": OWNER, "rent_amount": 2600, "rent_frequency": "MONTHLY",
        "start_date": "2026-01-31", "first_due_date": "2026-01-31", "status": "ACTIVE",
        "activated_at": "2026-01-20T00:00:00+00:00", **over,
    }])


def _generate(fake_db):
    return supabase_module.get_supabase_client().rpc(
        "generate_upcoming_rent_charges", {"p_agreement_id": AGREEMENT}).execute().data


def _charges(fake_db):
    return sorted(fake_db.tables.get("rent_charges", []), key=lambda row: row["due_date"])


def test_a_monthly_charge_keeps_to_the_end_of_a_short_month(fake_db, at):
    _agreement(fake_db)
    at(datetime(2026, 2, 25, 1, 0, tzinfo=timezone.utc))

    assert _generate(fake_db) == 1
    charge = _charges(fake_db)[0]
    # 31 January plus a month is 28 February; its period runs to the day before 31 March.
    assert (charge["due_date"], charge["period_start"], charge["period_end"]) == (
        "2026-02-28", "2026-02-28", "2026-03-30")
    assert (charge["amount_due"], charge["status"]) == (2600, "ISSUED")


def test_a_charge_more_than_7_days_away_waits(fake_db, at):
    _agreement(fake_db, rent_frequency="FORTNIGHTLY", first_due_date="2026-10-02", start_date="2026-10-02")

    at(datetime(2026, 10, 8, 1, 0, tzinfo=timezone.utc))  # the next due date, the 16th, is 8 days away
    assert _generate(fake_db) == 0
    at(datetime(2026, 10, 9, 1, 0, tzinfo=timezone.utc))
    assert _generate(fake_db) == 1
    assert [(row["due_date"], row["period_end"]) for row in _charges(fake_db)] == [("2026-10-16", "2026-10-29")]


def test_no_charge_before_activation_or_after_the_end_date(fake_db, at):
    _agreement(fake_db, rent_frequency="WEEKLY", first_due_date="2026-10-02", start_date="2026-10-02",
               activated_at="2026-10-21T00:00:00+00:00", end_date="2026-10-25")

    # Activated on the 21st: the first charge is the 23rd's, never the 9th's or the 16th's.
    assert _generate(fake_db) == 1
    assert [(row["due_date"], row["period_end"]) for row in _charges(fake_db)] == [("2026-10-23", "2026-10-25")]
    at(datetime(2026, 10, 26, 1, 0, tzinfo=timezone.utc))
    assert _generate(fake_db) == 0


def test_an_issued_charge_is_left_alone_and_a_void_one_clashes(fake_db, at):
    _agreement(fake_db, rent_frequency="WEEKLY", first_due_date="2026-10-02", start_date="2026-10-02")
    fake_db.seed("rent_charges", [{"id": "e8400000-0000-4000-8000-000000000001", "agreement_id": AGREEMENT,
                                   "period_start": "2026-10-23", "period_end": "2026-10-29", "due_date": "2026-10-23",
                                   "amount_due": 2600, "status": "VOID"}])

    with pytest.raises(APIError) as clash:
        _generate(fake_db)
    assert clash.value.code == "23505"
    fake_db.tables["rent_charges"][0]["status"] = "ISSUED"
    assert _generate(fake_db) == 0


def test_inactive_and_unactivated_agreements_get_no_charge(fake_db, at):
    _agreement(fake_db, status="DRAFT", activated_at=None)

    assert _generate(fake_db) == 0
    assert _charges(fake_db) == []


@pytest.fixture
def people(fake_db):
    tokens = {
        "owner": account(fake_db, OWNER, "owner@example.test", "LANDLORD"),
        "tenant": account(fake_db, TENANT, "tenant@example.test", "TENANT"),
    }
    fake_db.seed("properties", [property_row(OWNER, id=PROPERTY)])
    fake_db.seed("listings", [listing_row(PROPERTY, OWNER, "LEASED", id=LISTING)])
    return tokens


def test_the_summary_counts_only_verified_successful_payments(fake_db, at, people):
    _agreement(fake_db, rent_frequency="WEEKLY", first_due_date="2026-10-16", start_date="2026-10-16")
    fake_db.seed("rent_charges", [
        {"id": "e8400000-0000-4000-8000-000000000016", "agreement_id": AGREEMENT, "period_start": "2026-10-16",
         "period_end": "2026-10-22", "due_date": "2026-10-16", "amount_due": 600, "status": "ISSUED"},
        {"id": "e8400000-0000-4000-8000-000000000023", "agreement_id": AGREEMENT, "period_start": "2026-10-23",
         "period_end": "2026-10-29", "due_date": "2026-10-23", "amount_due": 600, "status": "ISSUED"},
    ])
    fake_db.seed("rent_payments", [
        {"charge_id": "e8400000-0000-4000-8000-000000000016", "amount": 100, "status": "SUCCEEDED",
         "verified_at": "2026-10-16T00:00:00+00:00"},
        {"charge_id": "e8400000-0000-4000-8000-000000000016", "amount": 500, "status": "CANCELLED",
         "verified_at": "2026-10-16T00:00:00+00:00"},
        {"charge_id": "e8400000-0000-4000-8000-000000000023", "amount": 50, "status": "PENDING"},
    ])

    summary = user_client(people["tenant"]).rpc("mobile_my_rent_summary", {}).execute().data

    assert [(row["dueDate"], row["amountPaid"], row["amountOutstanding"], row["paymentStatus"])
            for row in summary[0]["charges"]] == [("2026-10-16", 100, 500, "OVERDUE"), ("2026-10-23", 0, 600, "UNPAID")]
    assert supabase_module.get_supabase_client().rpc("mobile_my_rent_summary", {}).execute().data == []
    assert user_client(people["owner"]).rpc("mobile_my_rent_summary", {}).execute().data == []


def _action(token, operation="create_record", payload=None, confirmed=True, request=REQUEST):
    return user_client(token).rpc("mobile_owner_assistant_action", {
        "p_request": request, "p_operation": operation, "p_confirmed": confirmed,
        "p_payload": payload if payload is not None else {
            "listingId": LISTING, "kind": "expense", "title": "Gutter clean",
            "data": {"amount": 95, "date": "2026-10-22"}},
    }).execute().data


def test_an_action_answers_once_per_request_id(fake_db, at, people):
    first = _action(people["owner"])

    assert first["message"] == "Expense saved."
    assert first["record"]["status"] == "recorded" and first["record"]["payload"]["currency"] == "AUD"
    assert _action(people["owner"]) == first
    with pytest.raises(APIError) as reused:
        _action(people["owner"], payload={"listingId": LISTING, "kind": "expense", "title": "Other",
                                          "data": {"amount": 95, "date": "2026-10-22"}})
    assert (reused.value.code, reused.value.message) == (
        "P0001", "This request ID was already used for different details.")
    assert len(fake_db.tables["owner_assistant_records"]) == 1


@pytest.mark.parametrize(("data", "confirmed", "message"), [
    ({"amount": 95, "date": "2026-10-22"}, False, "Review financial records before confirming."),
    ({"amount": 95.001, "date": "2026-10-22"}, True, "Amount must be positive AUD with at most two decimal places."),
    ({"amount": 0, "date": "2026-10-22"}, True, "Amount must be positive AUD with at most two decimal places."),
    ({"amount": 95, "date": "22/10/2026"}, True, "Use YYYY-MM-DD dates"),
    ({"amount": 95}, True, "Recorded payment/expense date must not be in the future"),
    ({"amount": 95, "date": "2026-10-24"}, True, "Recorded payment/expense date must not be in the future"),
])
def test_an_expense_is_checked_as_the_function_checks_it(fake_db, at, people, data, confirmed, message):
    with pytest.raises(APIError) as refused:
        _action(people["owner"], payload={"listingId": LISTING, "kind": "expense", "title": "Gutter clean",
                                          "data": data}, confirmed=confirmed)

    assert (refused.value.code, refused.value.message) == ("P0001", message)
    assert fake_db.tables.get("owner_assistant_records", []) == []
    assert fake_db.tables.get("owner_assistant_requests", []) == []


def test_the_sydney_day_bounds_a_recorded_date(fake_db, at, people):
    at(datetime(2026, 10, 23, 13, 0, tzinfo=timezone.utc))  # midnight on the 24th in Sydney

    assert _action(people["owner"], payload={"listingId": LISTING, "kind": "expense", "title": "Gutter clean",
                                             "data": {"amount": 95, "date": "2026-10-24"}})["record"]


def test_only_an_owner_acts_and_only_on_their_records(fake_db, at, people):
    with pytest.raises(APIError) as tenant:
        _action(people["tenant"])
    assert (tenant.value.code, tenant.value.message) == ("42501", "Active owner access is required.")
    record = _action(people["owner"])["record"]
    stranger = account(fake_db, "e8100000-0000-4000-8000-000000000003", "stranger@example.test", "LANDLORD")
    with pytest.raises(APIError) as other:
        _action(stranger, "cancel_record", {"recordId": record["id"]}, request="e8300000-0000-4000-8000-000000000002")
    assert (other.value.code, other.value.message) == ("42501", "Record is not yours")
    with pytest.raises(APIError) as unconfirmed:
        _action(people["owner"], "cancel_record", {"recordId": record["id"]}, confirmed=False,
                request="e8300000-0000-4000-8000-000000000003")
    assert unconfirmed.value.message == "Confirm the financial correction"

    cancelled = _action(people["owner"], "cancel_record", {"recordId": record["id"]},
                        request="e8300000-0000-4000-8000-000000000004")
    assert (cancelled["message"], cancelled["record"]["status"]) == ("Record updated.", "cancelled")


def test_a_payment_record_needs_its_charge_record_and_an_approved_tenant(fake_db, at, people):
    with pytest.raises(APIError) as no_tenant:
        _action(people["owner"], payload={"listingId": LISTING, "kind": "payment", "title": "Rent",
                                          "data": {"amount": 95, "date": "2026-10-22"}})
    assert no_tenant.value.message == "Choose a tenant with an approved application for this listing."

    fake_db.seed("rental_applications", [{"id": "e8500000-0000-4000-8000-000000000001", "listing_id": LISTING,
                                          "applicant_user_id": TENANT, "status": "APPROVED", "offer_weekly_rent": 600,
                                          "updated_at": "2026-10-01T00:00:00+00:00"}])
    rent = {"listingId": LISTING, "title": "Rent", "recipientId": TENANT}
    charge = _action(people["owner"], payload={**rent, "kind": "charge",
                                               "data": {"amount": 600, "dueDate": "2026-10-23"}},
                     request="e8300000-0000-4000-8000-000000000005")["record"]
    with pytest.raises(APIError) as too_much:
        _action(people["owner"], payload={**rent, "kind": "payment",
                                          "data": {"amount": 601, "date": "2026-10-22", "chargeId": charge["id"]}},
                request="e8300000-0000-4000-8000-000000000006")
    assert too_much.value.message == "Payment exceeds the remaining rent charge"
    paid = _action(people["owner"], payload={**rent, "kind": "payment",
                                             "data": {"amount": 600, "date": "2026-10-22", "chargeId": charge["id"]}},
                   request="e8300000-0000-4000-8000-000000000007")
    assert paid["message"] == "Payment recorded from your supplied information; no online payment was collected."
    assert paid["record"]["payload"]["source"] == "owner_recorded"
    with pytest.raises(APIError) as linked:
        _action(people["owner"], "cancel_record", {"recordId": charge["id"]},
                request="e8300000-0000-4000-8000-000000000008")
    assert linked.value.message == "Correct linked payment records before cancelling this charge"
