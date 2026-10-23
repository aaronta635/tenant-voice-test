"""The owner's rent ledger and the tenant's rent (tracker R27) on the strict shared schema.

Charges are the ISSUED rent_charges of the owner's ACTIVE rent_agreements,
and only the owner's "Create the next charge" makes one
(generate_upcoming_rent_charges). A receipt is a rent_payments row the owner
records: SUCCEEDED and verified, "Recorded by owner", never "collected".
Corrections cancel it with a note. Expenses are owner workspace records made
through mobile_owner_assistant_action with the owner's JWT. Balances follow
mobile_my_rent_summary with "today" in Sydney. The CSV totals are the
screen's. Every call goes through the API as one of the roles.
"""

import csv
import dataclasses
import io
import re
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from postgrest.exceptions import APIError

from app.services import rent_ledger
from tests import fake_supabase
from tests.factories_identity import account
from tests.factories_rental import listing_row, property_row
from tests.fake_supabase import StrictKey

pytestmark = pytest.mark.usefixtures("strict_schema")

OWNER = "e7000000-0000-4000-8000-000000000001"
OTHER_OWNER = "e7000000-0000-4000-8000-000000000002"
TENANT = "e7000000-0000-4000-8000-000000000003"
OTHER_TENANT = "e7000000-0000-4000-8000-000000000004"
PROPERTY = "e7100000-0000-4000-8000-000000000001"
LISTING = "e7100000-0000-4000-8000-000000000002"
SECOND_PROPERTY = "e7100000-0000-4000-8000-000000000003"
SECOND_LISTING = "e7100000-0000-4000-8000-000000000004"
OTHER_PROPERTY = "e7100000-0000-4000-8000-000000000005"
OTHER_LISTING = "e7100000-0000-4000-8000-000000000006"
AGREEMENT = "e7200000-0000-4000-8000-000000000001"
SECOND_AGREEMENT = "e7200000-0000-4000-8000-000000000002"
OTHER_AGREEMENT = "e7200000-0000-4000-8000-000000000003"
CHARGE_9 = "e7300000-0000-4000-8000-000000000009"
CHARGE_16 = "e7300000-0000-4000-8000-000000000016"
CHARGE_23 = "e7300000-0000-4000-8000-000000000023"
SECOND_CHARGE = "e7300000-0000-4000-8000-000000000101"
OTHER_CHARGE = "e7300000-0000-4000-8000-000000000201"
VOID_CHARGE = "e7300000-0000-4000-8000-000000000301"
KEY = "e7400000-0000-4000-8000-000000000001"
REQUEST = "e7500000-0000-4000-8000-000000000001"
API = "/api/v1/me/rent"
# 11:00 am on Friday 23 October 2026 in Sydney (AEDT, UTC+11); also the 23rd in UTC.
NOW = datetime(2026, 10, 23, 0, 0, tzinfo=timezone.utc)
LAST_MINUTE_OF_THE_23RD = datetime(2026, 10, 23, 12, 59, tzinfo=timezone.utc)  # 11:59 pm in Sydney
# 12:00 am on the 24th in Sydney, while it is still the 23rd in UTC.
FIRST_MINUTE_OF_THE_24TH = datetime(2026, 10, 23, 13, 0, tzinfo=timezone.utc)
RECEIPT = {"amount": 200, "received_on": "2026-10-22", "method": "bank_transfer", "reference": "TT-8812",
           "note": "First half of the week", "idempotency_key": KEY}


@pytest.fixture(autouse=True)
def catalog_keys(fake_db, monkeypatch):
    """The unique keys constraints.md and indexs.md give rent_payments and rent_charges; the snapshot has none."""
    tables = fake_db.strict.tables
    for name, keys in {
        "rent_payments": (StrictKey("rent_payments_idempotency_key_key", ("idempotency_key",)),),
        "rent_charges": (
            StrictKey("unique_rent_charge_period", ("agreement_id", "period_start")),
            StrictKey("rent_charge_one_issued_per_due_date", ("agreement_id", "due_date"), constraint=False,
                      where="status in ('ISSUED')"),
        ),
    }.items():
        table = tables[("public", name)]
        monkeypatch.setitem(tables, ("public", name), dataclasses.replace(table, keys=table.keys + keys))


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    """One clock for the API (rent_ledger._now) and for the database's now() and CURRENT_DATE in the stand-ins."""
    moment = {"now": NOW}
    monkeypatch.setattr(rent_ledger, "_now", lambda: moment["now"])
    monkeypatch.setattr(fake_supabase.RpcContext, "now", staticmethod(lambda: moment["now"].isoformat()))
    return lambda value: moment.update(now=value)


def agreement_row(id, listing, tenant, owner=OWNER, **over) -> dict:
    """A weekly A$650 tenancy whose rent falls due every Friday from 2 October 2026."""
    return {"id": id, "application_id": f"e7600000-0000-4000-8000-{id[-12:]}", "listing_id": listing,
            "tenant_user_id": tenant, "owner_user_id": owner, "rent_amount": 650, "rent_frequency": "WEEKLY",
            "start_date": "2026-10-02", "first_due_date": "2026-10-02", "status": "ACTIVE",
            "activated_at": "2026-10-01T03:00:00+00:00", **over}


def charge_row(id, agreement, due, amount=650, status="ISSUED") -> dict:
    start = date.fromisoformat(due)
    return {"id": id, "agreement_id": agreement, "period_start": due,
            "period_end": (start + timedelta(days=6)).isoformat(), "due_date": due, "amount_due": amount,
            "status": status, "issued_at": f"{due}T00:00:00+00:00"}


def payment_row(charge, amount, provider="OWNER_RECORDED", status="SUCCEEDED", **over) -> dict:
    return {"id": str(uuid.uuid4()), "charge_id": charge, "amount": amount, "status": status, "provider": provider,
            "verified_at": "2026-10-10T01:00:00+00:00" if status in ("SUCCEEDED", "CANCELLED") else None,
            "created_at": "2026-10-10T01:00:00+00:00", **over}


@pytest.fixture
def rental(fake_db):
    """Olivia rents the Harbour flat to Tanya and the Garden unit to Theo; Sam owns the Hill house.

    The Harbour flat's charges fall due on 9, 16 and 23 October: the first is
    paid in full, the second in part, the third (today) not at all.
    """
    tokens = {
        "owner": account(fake_db, OWNER, "olivia@example.test", "LANDLORD", full_name="Olivia Owner"),
        "other_owner": account(fake_db, OTHER_OWNER, "sam@example.test", "LANDLORD", full_name="Sam Stranger"),
        "tenant": account(fake_db, TENANT, "tanya@example.test", "TENANT", full_name="Tanya Tenant"),
        "other_tenant": account(fake_db, OTHER_TENANT, "theo@example.test", "TENANT", full_name="Theo Tenant"),
    }
    fake_db.seed("properties", [
        property_row(OWNER, id=PROPERTY, address_line_1="1 Harbour Street"),
        property_row(OWNER, id=SECOND_PROPERTY, address_line_1="5 Garden Road", suburb="Fairy Meadow"),
        property_row(OTHER_OWNER, id=OTHER_PROPERTY, address_line_1="9 Hill Avenue"),
    ])
    fake_db.seed("listings", [
        listing_row(PROPERTY, OWNER, "LEASED", id=LISTING, title="Harbour flat"),
        listing_row(SECOND_PROPERTY, OWNER, "LEASED", id=SECOND_LISTING, title="Garden unit"),
        listing_row(OTHER_PROPERTY, OTHER_OWNER, "LEASED", id=OTHER_LISTING, title="Hill house"),
    ])
    fake_db.seed("rent_agreements", [
        agreement_row(AGREEMENT, LISTING, TENANT),
        agreement_row(SECOND_AGREEMENT, SECOND_LISTING, OTHER_TENANT, rent_amount=500),
        agreement_row(OTHER_AGREEMENT, OTHER_LISTING, OTHER_TENANT, owner=OTHER_OWNER),
    ])
    fake_db.seed("rent_charges", [
        charge_row(CHARGE_9, AGREEMENT, "2026-10-09"),
        charge_row(CHARGE_16, AGREEMENT, "2026-10-16"),
        charge_row(CHARGE_23, AGREEMENT, "2026-10-23"),
        charge_row(VOID_CHARGE, AGREEMENT, "2026-10-02", status="VOID"),
        charge_row(SECOND_CHARGE, SECOND_AGREEMENT, "2026-10-16", amount=500),
        charge_row(OTHER_CHARGE, OTHER_AGREEMENT, "2026-10-16"),
    ])
    fake_db.seed("rent_payments", [
        payment_row(CHARGE_9, 650),
        payment_row(CHARGE_16, 200),
        payment_row(OTHER_CHARGE, 650),
    ])
    return {role: {"Authorization": f"Bearer {token}"} for role, token in tokens.items()}


def _ledger(client, headers, **filters) -> dict:
    response = client.get(f"{API}/ledger", headers=headers, params=filters)
    assert response.status_code == 200, response.text
    return response.json()


def _charge(ledger: dict, charge_id: str) -> dict:
    return next(row for row in ledger["charges"] if row["id"] == charge_id)


def _payments(fake_db, charge_id: str) -> list[dict]:
    return [row for row in fake_db.tables.get("rent_payments", []) if row["charge_id"] == charge_id]


def _csv_totals(text: str) -> dict:
    rows = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    start = rows.index(["Totals"])
    return {row[0]: row[1] for row in rows[start + 1:] if row}


# ---------------------------------------------------------------------------
# Reading the ledger
# ---------------------------------------------------------------------------
def test_the_owner_sees_each_charge_of_their_tenancies_with_its_balance(client, rental):
    ledger = _ledger(client, rental["owner"])

    # By due date, then listing: the Garden unit's charge of the 16th comes before the Harbour flat's.
    assert [row["id"] for row in ledger["charges"]] == [CHARGE_9, SECOND_CHARGE, CHARGE_16, CHARGE_23]
    paid, part, theo, today = (_charge(ledger, charge) for charge in (CHARGE_9, CHARGE_16, SECOND_CHARGE, CHARGE_23))
    assert (paid["payment_status"], paid["amount_paid"], paid["amount_outstanding"]) == ("PAID", 650, 0)
    # Part paid, and its due date has passed: overdue, as mobile_my_rent_summary says.
    assert (part["payment_status"], part["amount_paid"], part["amount_outstanding"]) == ("OVERDUE", 200, 450)
    assert theo["payment_status"] == "OVERDUE" and theo["tenant_name"] == "Theo Tenant"
    # Due today: not overdue yet.
    assert (today["payment_status"], today["amount_outstanding"]) == ("UNPAID", 650)
    assert (paid["listing_title"], paid["tenant_name"]) == ("Harbour flat", "Tanya Tenant")
    assert paid["property_address"] == "1 Harbour Street, Wollongong, NSW, 2500"
    assert ledger["totals"] == {"charges": 4, "rent_due": 2450, "received": 850, "outstanding": 1600,
                                "overdue": 950, "expenses": 0, "net": 850}
    assert ledger["today"] == "2026-10-23"
    assert {row["id"] for row in ledger["agreements"]} == {AGREEMENT, SECOND_AGREEMENT}


def test_the_ledger_holds_nothing_of_another_owners_tenancies(client, rental):
    ledger = _ledger(client, rental["owner"])
    other = _ledger(client, rental["other_owner"])

    assert OTHER_CHARGE not in {row["id"] for row in ledger["charges"]}
    assert "Hill house" not in str(ledger)
    assert [row["id"] for row in other["charges"]] == [OTHER_CHARGE]
    assert {row["title"] for row in other["listings"]} == {"Hill house"}
    assert other["totals"]["received"] == 650
    # Another owner's tenancy as a filter finds nothing of it.
    assert _ledger(client, rental["owner"], listing_id=OTHER_LISTING)["charges"] == []


def test_a_void_charge_and_an_ended_tenancy_stay_out_of_the_ledger(client, rental, fake_db):
    next(row for row in fake_db.tables["rent_agreements"] if row["id"] == SECOND_AGREEMENT)["status"] = "ENDED"

    ledger = _ledger(client, rental["owner"])

    assert {row["id"] for row in ledger["charges"]} == {CHARGE_9, CHARGE_16, CHARGE_23}
    assert [row["id"] for row in ledger["agreements"]] == [AGREEMENT]


def test_only_the_owner_reads_the_ledger(client, rental):
    assert client.get(f"{API}/ledger", headers=rental["tenant"]).status_code == 403
    assert client.get(f"{API}/ledger.csv", headers=rental["tenant"]).status_code == 403
    assert client.get(f"{API}/ledger").status_code == 401
    assert client.get(API, headers=rental["owner"]).status_code == 403


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------
def test_the_owner_filters_by_listing_tenant_and_due_dates(client, rental):
    by_listing = _ledger(client, rental["owner"], listing_id=SECOND_LISTING)
    by_tenant = _ledger(client, rental["owner"], tenant_id=TENANT)
    by_dates = _ledger(client, rental["owner"], **{"from": "2026-10-16", "to": "2026-10-16"})

    assert [row["id"] for row in by_listing["charges"]] == [SECOND_CHARGE]
    assert [row["id"] for row in by_listing["agreements"]] == [SECOND_AGREEMENT]
    assert {row["id"] for row in by_tenant["charges"]} == {CHARGE_9, CHARGE_16, CHARGE_23}
    # Both ends are inclusive.
    assert {row["id"] for row in by_dates["charges"]} == {CHARGE_16, SECOND_CHARGE}
    assert by_dates["totals"]["rent_due"] == 1150
    # The options still list every listing and tenant.
    assert {row["title"] for row in by_listing["listings"]} == {"Harbour flat", "Garden unit"}
    assert {row["name"] for row in by_listing["tenants"]} == {"Tanya Tenant", "Theo Tenant"}


def test_filters_that_cannot_match_are_refused(client, rental):
    assert client.get(f"{API}/ledger", headers=rental["owner"],
                      params={"from": "2026-10-20", "to": "2026-10-01"}).status_code == 422
    assert client.get(f"{API}/ledger", headers=rental["owner"], params={"listing_id": "flat"}).status_code == 422
    assert client.get(f"{API}/ledger", headers=rental["owner"], params={"from": "23/10/2026"}).status_code == 422


# ---------------------------------------------------------------------------
# Receipts
# ---------------------------------------------------------------------------
def test_partial_payments_and_several_receipts_settle_a_charge(client, rental, fake_db):
    first = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"], json=RECEIPT)
    part = _charge(_ledger(client, rental["owner"]), CHARGE_23)
    second = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"],
                         json={**RECEIPT, "amount": 449.5, "method": "cash", "reference": None, "note": None,
                               "idempotency_key": "e7400000-0000-4000-8000-000000000002"})
    third = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"],
                        json={**RECEIPT, "amount": 0.5, "idempotency_key": "e7400000-0000-4000-8000-000000000003"})
    paid = _charge(_ledger(client, rental["owner"]), CHARGE_23)

    assert (first.status_code, second.status_code, third.status_code) == (201, 201, 201)
    assert (part["payment_status"], part["amount_paid"], part["amount_outstanding"]) == ("PARTIALLY_PAID", 200, 450)
    assert (paid["payment_status"], paid["amount_paid"], paid["amount_outstanding"]) == ("PAID", 650, 0)
    assert [(row["amount"], row["method"]) for row in paid["receipts"]] == [
        (200, "bank_transfer"), (449.5, "cash"), (0.5, "bank_transfer")]
    assert len(_payments(fake_db, CHARGE_23)) == 3


def test_a_receipt_never_exceeds_what_is_owing(client, rental, fake_db):
    over = client.post(f"{API}/charges/{CHARGE_16}/receipts", headers=rental["owner"], json={**RECEIPT, "amount": 451})
    settled = client.post(f"{API}/charges/{CHARGE_9}/receipts", headers=rental["owner"], json=RECEIPT)

    assert over.status_code == 422
    assert over.json()["detail"] == "The receipt is more than the $450.00 still owing on this charge."
    assert settled.status_code == 409
    assert len(_payments(fake_db, CHARGE_16)) == 1 and len(_payments(fake_db, CHARGE_9)) == 1


def test_a_receipt_is_recorded_by_the_owner_and_never_collected(client, rental, fake_db):
    response = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"], json=RECEIPT)

    receipt = response.json()
    stored = _payments(fake_db, CHARGE_23)[0]
    assert stored["status"] == "SUCCEEDED" and stored["verified_at"] == NOW.isoformat()
    assert (stored["provider"], stored["currency"], stored["amount"]) == ("OWNER_RECORDED", "AUD", 200)
    assert stored["idempotency_key"] == f"web:{OWNER}:{KEY}"
    assert receipt["source_label"] == "Recorded by owner" and receipt["source"] == "owner_recorded"
    assert (receipt["received_on"], receipt["method"], receipt["reference"], receipt["note"]) == (
        "2026-10-22", "bank_transfer", "TT-8812", "First half of the week")
    assert receipt["counted"] and receipt["correctable"]
    # The details are the web audit_log's entry for the receipt.
    entry = next(row for row in fake_db.schema_tables["web"]["audit_log"] if row["action"] == "rent_payment.recorded")
    assert (entry["entity_type"], entry["entity_id"], entry["actor_id"]) == ("rent_payment", stored["id"], OWNER)
    assert entry["metadata"]["received_on"] == "2026-10-22"
    # The words: recorded by the owner, never collected or paid online.
    exported = client.get(f"{API}/ledger.csv", headers=rental["owner"]).text
    for text in (response.text, client.get(f"{API}/ledger", headers=rental["owner"]).text, exported):
        assert "Recorded by owner" in text
        assert not re.search(r"collected|paid online", text, re.IGNORECASE)


def test_a_stripe_payment_is_named_as_one_and_only_the_owners_receipts_are_correctable(client, rental, fake_db):
    fake_db.seed("rent_payments", [payment_row(CHARGE_23, 100, provider="STRIPE",
                                               id="e7700000-0000-4000-8000-000000000999")])

    receipt = _charge(_ledger(client, rental["owner"]), CHARGE_23)["receipts"][0]
    refused = client.post(f"{API}/receipts/{receipt['id']}/correction", headers=rental["owner"],
                          json={"note": "Not mine to correct"})

    assert (receipt["source_label"], receipt["counted"], receipt["correctable"]) == ("Stripe payment", True, False)
    assert refused.status_code == 409


def test_a_repeated_submission_does_not_double_the_balance(client, rental, fake_db):
    first = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"], json=RECEIPT)
    again = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"], json=RECEIPT)
    changed = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"],
                          json={**RECEIPT, "amount": 300})

    assert (first.status_code, again.status_code) == (201, 200)
    assert again.json()["id"] == first.json()["id"]
    assert changed.status_code == 409
    assert len(_payments(fake_db, CHARGE_23)) == 1
    assert _charge(_ledger(client, rental["owner"]), CHARGE_23)["amount_paid"] == 200
    assert sum(row["action"] == "rent_payment.recorded" for row in fake_db.schema_tables["web"]["audit_log"]) == 1


def test_two_submissions_at_once_record_one_receipt(client, rental, fake_db, monkeypatch):
    """Both requests looked for the key before either wrote: the unique key decides, and the loser answers 200."""
    winner = {**payment_row(CHARGE_23, 200), "id": "e7700000-0000-4000-8000-000000000777",
              "idempotency_key": f"web:{OWNER}:{KEY}"}
    lookups = []
    real_lookup = rent_ledger._payment_by_key

    def lookup(key):
        lookups.append(key)
        if len(lookups) == 1:
            fake_db.seed("rent_payments", [winner])  # the other request's insert lands now
            return None
        return real_lookup(key)

    monkeypatch.setattr(rent_ledger, "_payment_by_key", lookup)
    response = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"], json=RECEIPT)

    assert response.status_code == 200 and response.json()["id"] == winner["id"]
    assert len(_payments(fake_db, CHARGE_23)) == 1


def test_a_receipt_whose_details_failed_gets_them_when_sent_again(client, rental, fake_db, monkeypatch):
    real_table = rent_ledger.web_table
    failures = []

    def flaky(name):
        query = real_table(name)
        insert = query.insert

        def failing_insert(payload, **kwargs):
            if not failures:
                failures.append(payload)
                raise APIError({"code": "57P01", "message": "terminating connection", "details": None, "hint": None})
            return insert(payload, **kwargs)

        query.insert = failing_insert
        return query

    monkeypatch.setattr(rent_ledger, "web_table", flaky)
    failed = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"], json=RECEIPT)
    retried = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"], json=RECEIPT)

    assert failed.status_code == 503
    assert retried.status_code == 200 and retried.json()["received_on"] == "2026-10-22"
    assert len(_payments(fake_db, CHARGE_23)) == 1


def test_receipt_values_are_checked(client, rental, fake_db):
    for body in ({**RECEIPT, "amount": 0}, {**RECEIPT, "amount": -5}, {**RECEIPT, "amount": 10.005},
                 {**RECEIPT, "method": "paypal"}, {**RECEIPT, "idempotency_key": "twice"},
                 {**RECEIPT, "collected": True}):
        assert client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"], json=body).status_code == 422
    void = client.post(f"{API}/charges/{VOID_CHARGE}/receipts", headers=rental["owner"], json=RECEIPT)
    assert void.status_code == 409
    assert _payments(fake_db, CHARGE_23) == []


def test_another_owners_charge_takes_no_receipt_from_this_owner(client, rental, fake_db):
    theirs = client.post(f"{API}/charges/{OTHER_CHARGE}/receipts", headers=rental["owner"], json=RECEIPT)
    missing = client.post(f"{API}/charges/not-a-charge/receipts", headers=rental["owner"], json=RECEIPT)
    as_tenant = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["tenant"], json=RECEIPT)

    assert (theirs.status_code, missing.status_code, as_tenant.status_code) == (404, 404, 403)
    assert theirs.json()["detail"] == missing.json()["detail"] == "Rent charge not found"
    assert len(_payments(fake_db, OTHER_CHARGE)) == 1 and _payments(fake_db, CHARGE_23) == []


# ---------------------------------------------------------------------------
# Corrections
# ---------------------------------------------------------------------------
def test_a_correction_cancels_the_receipt_with_its_note(client, rental, fake_db):
    receipt = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"],
                          json={**RECEIPT, "amount": 650}).json()
    corrected = client.post(f"{API}/receipts/{receipt['id']}/correction", headers=rental["owner"],
                            json={"note": "Entered against the wrong week"})
    charge = _charge(_ledger(client, rental["owner"]), CHARGE_23)
    again = client.post(f"{API}/receipts/{receipt['id']}/correction", headers=rental["owner"],
                        json={"note": "Entered against the wrong week"})

    assert corrected.status_code == 200
    assert corrected.json()["status"] == "CANCELLED" and not corrected.json()["counted"]
    assert corrected.json()["correction_note"] == "Entered against the wrong week"
    # Kept, cancelled, and no longer counted.
    assert _payments(fake_db, CHARGE_23)[0]["status"] == "CANCELLED"
    assert (charge["payment_status"], charge["amount_paid"]) == ("UNPAID", 0)
    assert [row["status"] for row in charge["receipts"]] == ["CANCELLED"]
    assert charge["receipts"][0]["correction_note"] == "Entered against the wrong week"
    assert again.status_code == 409
    # The tenant's summary no longer counts it either.
    tenant_charge = client.get(API, headers=rental["tenant"]).json()["agreements"][0]["charges"][-1]
    assert (tenant_charge["id"], tenant_charge["amount_paid"]) == (CHARGE_23, 0)


def test_of_two_receipts_sent_at_once_the_later_one_past_the_charge_is_withdrawn(client, rental, fake_db, monkeypatch):
    first = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"],
                        json={**RECEIPT, "amount": 650})
    # The second form, from another tab, read what was owing before the first was in.
    with monkeypatch.context() as stale:
        stale.setattr(rent_ledger, "_counted_paid", lambda charge_id: rent_ledger.ZERO)
        second = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"],
                             json={**RECEIPT, "amount": 650, "idempotency_key": str(uuid.uuid4())})

    assert first.status_code == 201
    assert (second.status_code, second.json()["detail"]) == (409, rent_ledger.OVERPAID_AT_ONCE)
    assert sorted(row["status"] for row in _payments(fake_db, CHARGE_23)) == ["CANCELLED", "SUCCEEDED"]
    charge = _charge(_ledger(client, rental["owner"]), CHARGE_23)
    assert (charge["amount_paid"], charge["payment_status"]) == (650, "PAID")


def test_a_withdrawn_or_corrected_receipt_sent_again_is_not_recorded(client, rental, fake_db, monkeypatch):
    client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"], json={**RECEIPT, "amount": 650})
    late = {**RECEIPT, "amount": 650, "idempotency_key": str(uuid.uuid4())}
    with monkeypatch.context() as stale:
        stale.setattr(rent_ledger, "_counted_paid", lambda charge_id: rent_ledger.ZERO)
        withdrawn = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"], json=late)
    # The dialog keeps its key after the 409, so "Record receipt" sends the same form again.
    again = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"], json=late)

    assert withdrawn.status_code == 409
    assert (again.status_code, again.json()["detail"]) == (409, rent_ledger.RESENT_WITHDRAWN)
    assert sorted(row["status"] for row in _payments(fake_db, CHARGE_23)) == ["CANCELLED", "SUCCEEDED"]
    assert _charge(_ledger(client, rental["owner"]), CHARGE_23)["amount_paid"] == 650

    # The same for a receipt the owner corrected since.
    kept = next(row for row in _payments(fake_db, CHARGE_23) if row["status"] == "SUCCEEDED")
    assert client.post(f"{API}/receipts/{kept['id']}/correction", headers=rental["owner"],
                       json={"note": "Wrong week"}).status_code == 200
    resent = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"],
                         json={**RECEIPT, "amount": 650})
    assert (resent.status_code, resent.json()["detail"]) == (409, rent_ledger.RESENT_WITHDRAWN)
    assert len(_payments(fake_db, CHARGE_23)) == 2


def test_two_corrections_at_once_cancel_the_receipt_once(client, rental, fake_db, monkeypatch):
    receipt = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"], json=RECEIPT).json()
    first = client.post(f"{API}/receipts/{receipt['id']}/correction", headers=rental["owner"], json={"note": "First"})
    # The second request read the receipt before the first cancelled it.
    real = rent_ledger._payment_of
    monkeypatch.setattr(rent_ledger, "_payment_of", lambda owner, payment_id: {**real(owner, payment_id), "status": "SUCCEEDED"})

    second = client.post(f"{API}/receipts/{receipt['id']}/correction", headers=rental["owner"], json={"note": "Second"})

    assert first.status_code == 200
    assert (second.status_code, second.json()["detail"]) == (409, "This receipt changed meanwhile. Reload the ledger.")
    notes = [row["metadata"]["note"] for row in fake_db.schema_tables["web"]["audit_log"]
             if row["action"] == "rent_payment.cancelled"]
    assert notes == ["First"]


def test_a_correction_needs_a_note_and_the_owners_own_receipt(client, rental, fake_db):
    receipt = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"], json=RECEIPT).json()
    theirs = next(row for row in fake_db.tables["rent_payments"] if row["charge_id"] == OTHER_CHARGE)

    assert client.post(f"{API}/receipts/{receipt['id']}/correction", headers=rental["owner"],
                       json={"note": ""}).status_code == 422
    assert client.post(f"{API}/receipts/{theirs['id']}/correction", headers=rental["owner"],
                       json={"note": "Not theirs"}).status_code == 404
    assert client.post(f"{API}/receipts/{receipt['id']}/correction", headers=rental["other_owner"],
                       json={"note": "Not theirs"}).status_code == 404
    assert client.post(f"{API}/receipts/{receipt['id']}/correction", headers=rental["tenant"],
                       json={"note": "Not theirs"}).status_code == 403
    assert {row["status"] for row in fake_db.tables["rent_payments"]} == {"SUCCEEDED"}


# ---------------------------------------------------------------------------
# Sydney's calendar
# ---------------------------------------------------------------------------
def test_a_charge_is_overdue_from_midnight_in_sydney(client, rental, clock):
    clock(LAST_MINUTE_OF_THE_23RD)
    before = _charge(_ledger(client, rental["owner"]), CHARGE_23)
    tenant_before = client.get(API, headers=rental["tenant"]).json()
    clock(FIRST_MINUTE_OF_THE_24TH)
    after = _ledger(client, rental["owner"])
    tenant_after = client.get(API, headers=rental["tenant"]).json()

    assert before["payment_status"] == "UNPAID"
    # Midnight in Sydney, while the database's CURRENT_DATE is still the 23rd (UTC).
    assert _charge(after, CHARGE_23)["payment_status"] == "OVERDUE"
    assert after["today"] == "2026-10-24" and after["totals"]["overdue"] == 450 + 500 + 650
    assert tenant_before["agreements"][0]["charges"][-1]["payment_status"] == "UNPAID"
    assert tenant_after["agreements"][0]["charges"][-1]["payment_status"] == "OVERDUE"
    assert tenant_after["totals"]["overdue"] == 450 + 650


def test_a_receipt_may_be_dated_today_in_sydney_but_not_tomorrow(client, rental, clock):
    tomorrow = {**RECEIPT, "received_on": "2026-10-24"}
    clock(LAST_MINUTE_OF_THE_23RD)
    early = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"], json=tomorrow)
    clock(FIRST_MINUTE_OF_THE_24TH)
    on_time = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"], json=tomorrow)

    assert early.status_code == 422
    assert on_time.status_code == 201


# ---------------------------------------------------------------------------
# Charges: only when the owner asks
# ---------------------------------------------------------------------------
def test_the_owner_creates_the_next_charge_only_once(client, rental, fake_db):
    fake_db.tables["rent_charges"] = [row for row in fake_db.tables["rent_charges"] if row["id"] != CHARGE_23]
    fake_db.tables["rent_payments"] = [row for row in fake_db.tables["rent_payments"] if row["charge_id"] != CHARGE_23]

    first = client.post(f"{API}/agreements/{AGREEMENT}/charges", headers=rental["owner"])
    second = client.post(f"{API}/agreements/{AGREEMENT}/charges", headers=rental["owner"])

    assert first.status_code == 200 and first.json()["created"] == 1
    assert second.json() == {"created": 0, "message": "No new charge: the next one is not due within 7 days, "
                                                      "or it is already in the ledger."}
    created = [row for row in fake_db.tables["rent_charges"]
               if row["agreement_id"] == AGREEMENT and row["due_date"] == "2026-10-23"]
    assert len(created) == 1
    assert (created[0]["period_end"], created[0]["amount_due"], created[0]["status"]) == ("2026-10-29", 650, "ISSUED")
    assert fake_db.rpc_calls.count(("generate_upcoming_rent_charges", {"p_agreement_id": AGREEMENT})) == 2
    # The service role calls it: the function takes the agreement, not the caller.
    assert ("generate_upcoming_rent_charges", None) in fake_db.rpc_callers
    assert CHARGE_23 not in {row["id"] for row in _ledger(client, rental["owner"])["charges"]}
    assert "2026-10-23" in {row["due_date"] for row in _ledger(client, rental["owner"])["charges"]}


@pytest.mark.parametrize("change, code, message", [
    ("ends", 422, "The tenancy ends on the next due date, so there is no further rent to charge."),
    ("voided", 409, "A voided charge already covers the next rent period, so no new charge can be made for it."),
])
def test_a_charge_the_database_refuses_is_explained_in_plain_words(client, rental, fake_db, change, code, message):
    if change == "ends":
        fake_db.tables["rent_charges"] = [row for row in fake_db.tables["rent_charges"] if row["id"] != CHARGE_23]
        fake_db.tables["rent_payments"] = [row for row in fake_db.tables["rent_payments"] if row["charge_id"] != CHARGE_23]
        next(row for row in fake_db.tables["rent_agreements"] if row["id"] == AGREEMENT)["end_date"] = "2026-10-23"
    else:
        next(row for row in fake_db.tables["rent_charges"] if row["id"] == CHARGE_23)["status"] = "VOID"

    response = client.post(f"{API}/agreements/{AGREEMENT}/charges", headers=rental["owner"])

    assert (response.status_code, response.json()["detail"]) == (code, message)


def test_no_one_else_creates_a_charge_for_the_tenancy(client, rental, fake_db):
    before = len(fake_db.tables["rent_charges"])

    assert client.post(f"{API}/agreements/{OTHER_AGREEMENT}/charges", headers=rental["owner"]).status_code == 404
    assert client.post(f"{API}/agreements/tenancy/charges", headers=rental["owner"]).status_code == 404
    assert client.post(f"{API}/agreements/{AGREEMENT}/charges", headers=rental["tenant"]).status_code == 403
    next(row for row in fake_db.tables["rent_agreements"] if row["id"] == AGREEMENT)["status"] = "ENDED"
    assert client.post(f"{API}/agreements/{AGREEMENT}/charges", headers=rental["owner"]).status_code == 409
    assert len(fake_db.tables["rent_charges"]) == before
    assert all(name != "generate_upcoming_rent_charges" for name, _ in fake_db.rpc_calls)


def test_refresh_and_export_create_no_charges(client, rental, fake_db, clock):
    # Theo's tenancy has no charge for 23 October yet: only the owner's action would make it.
    before = [dict(row) for row in fake_db.tables["rent_charges"]]

    for _ in range(2):
        _ledger(client, rental["owner"])
    client.get(f"{API}/ledger.csv", headers=rental["owner"])
    client.get(f"{API}/ledger", headers=rental["owner"], params={"listing_id": LISTING})
    client.get(API, headers=rental["tenant"])

    assert fake_db.tables["rent_charges"] == before
    assert all(name != "generate_upcoming_rent_charges" for name, _ in fake_db.rpc_calls)


# ---------------------------------------------------------------------------
# Expenses
# ---------------------------------------------------------------------------
EXPENSE = {"listing_id": LISTING, "title": "Plumber: kitchen tap", "amount": 120.5, "date": "2026-10-20",
           "category": "repairs", "note": "Washer replaced", "request_id": REQUEST}


def _expenses(fake_db) -> list[dict]:
    return [row for row in fake_db.tables.get("owner_assistant_records", []) if row["kind"] == "expense"]


def test_an_expense_is_an_owner_workspace_record(client, rental, fake_db):
    response = client.post(f"{API}/expenses", headers=rental["owner"], json=EXPENSE)
    again = client.post(f"{API}/expenses", headers=rental["owner"], json=EXPENSE)

    assert response.status_code == 201, response.text
    expense = response.json()
    assert (expense["listing_title"], expense["amount"], expense["date"], expense["category"]) == (
        "Harbour flat", 120.5, "2026-10-20", "repairs")
    assert expense["status"] == "recorded" and expense["counted"]
    # Through mobile_owner_assistant_action, as the owner, confirmed, as the mobile owner tools call it.
    name, params = fake_db.rpc_calls[-1]
    assert name == "mobile_owner_assistant_action"
    assert (params["p_operation"], params["p_confirmed"], params["p_request"]) == ("create_record", True, REQUEST)
    assert params["p_payload"]["kind"] == "expense"
    assert fake_db.rpc_callers[-1] == (name, fake_db.tokens[rental["owner"]["Authorization"][7:]])
    stored = _expenses(fake_db)
    assert len(stored) == 1 and again.json()["id"] == expense["id"]
    assert stored[0]["payload"] == {"amount": 120.5, "date": "2026-10-20", "category": "repairs",
                                    "note": "Washer replaced", "currency": "AUD"}
    ledger = _ledger(client, rental["owner"])
    assert [row["title"] for row in ledger["expenses"]] == ["Plumber: kitchen tap"]
    assert ledger["totals"]["expenses"] == 120.5 and ledger["totals"]["net"] == 850 - 120.5


def test_the_function_refuses_an_expense_with_its_own_words(client, rental, fake_db):
    future = client.post(f"{API}/expenses", headers=rental["owner"], json={**EXPENSE, "date": "2026-10-24"})
    theirs = client.post(f"{API}/expenses", headers=rental["owner"],
                         json={**EXPENSE, "listing_id": OTHER_LISTING,
                               "request_id": "e7500000-0000-4000-8000-000000000002"})
    as_tenant = client.post(f"{API}/expenses", headers=rental["tenant"], json=EXPENSE)

    assert future.status_code == 422
    assert future.json()["detail"] == "Recorded payment/expense date must not be in the future"
    assert theirs.status_code == 403
    assert theirs.json()["detail"] == "You can only change records for your own property."
    assert as_tenant.status_code == 403
    assert _expenses(fake_db) == []


def test_an_expense_correction_cancels_it_and_keeps_the_note(client, rental, fake_db):
    expense = client.post(f"{API}/expenses", headers=rental["owner"], json=EXPENSE).json()
    correction = {"note": "Charged to the tenant instead", "request_id": "e7500000-0000-4000-8000-000000000003"}

    by_other = client.post(f"{API}/expenses/{expense['id']}/correction", headers=rental["other_owner"], json=correction)
    corrected = client.post(f"{API}/expenses/{expense['id']}/correction", headers=rental["owner"], json=correction)
    again = client.post(f"{API}/expenses/{expense['id']}/correction", headers=rental["owner"], json=correction)
    ledger = _ledger(client, rental["owner"])

    assert by_other.status_code == 404
    assert corrected.status_code == 200
    assert (corrected.json()["status"], corrected.json()["counted"]) == ("cancelled", False)
    assert corrected.json()["correction_note"] == "Charged to the tenant instead"
    assert again.status_code == 409
    assert _expenses(fake_db)[0]["status"] == "cancelled"
    assert fake_db.rpc_calls[-1][1]["p_operation"] == "cancel_record"
    assert ledger["expenses"][0]["status"] == "cancelled" and ledger["totals"]["expenses"] == 0


def test_expenses_follow_the_listing_the_tenant_and_the_dates(client, rental):
    client.post(f"{API}/expenses", headers=rental["owner"], json=EXPENSE)
    client.post(f"{API}/expenses", headers=rental["owner"],
                json={**EXPENSE, "listing_id": SECOND_LISTING, "title": "Garden service", "amount": 80,
                      "date": "2026-10-16", "request_id": "e7500000-0000-4000-8000-000000000004"})

    def titles(**filters):
        return [row["title"] for row in _ledger(client, rental["owner"], **filters)["expenses"]]

    assert titles() == ["Garden service", "Plumber: kitchen tap"]
    assert titles(listing_id=SECOND_LISTING) == ["Garden service"]
    # A tenant's expenses are those of the homes they rent.
    assert titles(tenant_id=TENANT) == ["Plumber: kitchen tap"]
    assert titles(**{"from": "2026-10-17"}) == ["Plumber: kitchen tap"]
    assert titles(**{"to": "2026-10-16"}) == ["Garden service"]


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------
def test_the_export_totals_equal_the_screen(client, rental):
    receipt = client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"], json=RECEIPT).json()
    client.post(f"{API}/receipts/{receipt['id']}/correction", headers=rental["owner"], json={"note": "Duplicate"})
    client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"],
                json={**RECEIPT, "amount": 325.25, "idempotency_key": "e7400000-0000-4000-8000-000000000009"})
    client.post(f"{API}/expenses", headers=rental["owner"], json=EXPENSE)

    for filters in ({}, {"listing_id": LISTING}, {"tenant_id": OTHER_TENANT}, {"from": "2026-10-16"}):
        screen = _ledger(client, rental["owner"], **filters)
        exported = client.get(f"{API}/ledger.csv", headers=rental["owner"], params=filters)
        totals = _csv_totals(exported.text)
        assert totals == {
            "Charges": str(screen["totals"]["charges"]),
            "Rent due": f"{screen['totals']['rent_due']:.2f}",
            "Received": f"{screen['totals']['received']:.2f}",
            "Outstanding": f"{screen['totals']['outstanding']:.2f}",
            "Overdue": f"{screen['totals']['overdue']:.2f}",
            "Expenses": f"{screen['totals']['expenses']:.2f}",
            "Net (received less expenses)": f"{screen['totals']['net']:.2f}",
        }
    everything = _csv_totals(client.get(f"{API}/ledger.csv", headers=rental["owner"]).text)
    assert (everything["Received"], everything["Expenses"], everything["Net (received less expenses)"]) == (
        "1175.25", "120.50", "1054.75")


def test_the_export_is_a_csv_file_of_the_ledger(client, rental, fake_db):
    next(row for row in fake_db.tables["listings"] if row["id"] == LISTING)["title"] = "=HYPERLINK(\"x\")"

    exported = client.get(f"{API}/ledger.csv", headers=rental["owner"], params={"listing_id": LISTING})

    assert exported.headers["content-type"].startswith("text/csv")
    assert exported.headers["content-disposition"] == 'attachment; filename="rent-ledger-2026-10-23.csv"'
    rows = list(csv.reader(io.StringIO(exported.text.lstrip("﻿"))))
    charges = rows[rows.index(["Charges"]) + 2:rows.index(["Receipts"]) - 1]
    assert [row[0] for row in charges] == ["2026-10-09", "2026-10-16", "2026-10-23"]
    # A title a spreadsheet would run as a formula is kept as text.
    assert {row[3] for row in charges} == {"'=HYPERLINK(\"x\")"}
    receipts = rows[rows.index(["Receipts"]) + 2:rows.index(["Expenses"]) - 1]
    assert {row[8] for row in receipts} == {"Recorded by owner"}


# ---------------------------------------------------------------------------
# The tenant's rent
# ---------------------------------------------------------------------------
def test_the_tenant_sees_their_own_charges_and_payments(client, rental, fake_db):
    client.post(f"{API}/charges/{CHARGE_23}/receipts", headers=rental["owner"], json=RECEIPT)

    response = client.get(API, headers=rental["tenant"])

    assert response.status_code == 200
    rent = response.json()
    assert [row["id"] for row in rent["agreements"]] == [AGREEMENT]
    agreement = rent["agreements"][0]
    assert (agreement["listing_title"], agreement["locality"], agreement["rent_frequency"]) == (
        "Harbour flat", "Wollongong, NSW 2500", "WEEKLY")
    assert [(row["id"], row["amount_paid"], row["payment_status"]) for row in agreement["charges"]] == [
        (CHARGE_9, 650, "PAID"), (CHARGE_16, 200, "OVERDUE"), (CHARGE_23, 200, "PARTIALLY_PAID")]
    assert rent["totals"] == {"rent_due": 1950, "paid": 1050, "outstanding": 900, "overdue": 450}
    # mobile_my_rent_summary, as the tenant.
    assert fake_db.rpc_callers[-1] == ("mobile_my_rent_summary", fake_db.tokens[rental["tenant"]["Authorization"][7:]])
    assert "street" not in response.text.lower()


def test_another_tenant_sees_only_their_own_tenancies(client, rental):
    rent = client.get(API, headers=rental["other_tenant"]).json()

    assert {row["id"] for row in rent["agreements"]} == {SECOND_AGREEMENT, OTHER_AGREEMENT}
    assert CHARGE_23 not in str(rent)
