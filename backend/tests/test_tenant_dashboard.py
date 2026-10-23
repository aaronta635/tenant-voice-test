"""The tenant's dashboard and rental history (tracker R35), under the strict fake.

Every value comes from the rows it names: the lease from the ACTIVE rent
agreement, the next payment from its rent_charges and rent_payments (as
mobile_my_rent_summary works it out), repairs from the work orders not yet
resolved, inspections from the tenant's bookings and their home's
inspections, and the history from mobile_my_rental_history, called as the
tenant, with the tenancies they reported on their profile.
"""

from datetime import date

import pytest

from app.core.supabase import user_client
from app.services import dashboard
from tests import fake_rpcs, fake_supabase
from tests.factories_dashboards import (
    FUTURE,
    PAST,
    agreement_row,
    charge_row,
    inspection_row,
    payment_row,
    seed_booking,
    work_order_row,
)
from tests.factories_identity import account
from tests.factories_rental import (
    NOW,
    OTHER_TENANT,
    OWNER,
    STRANGER,
    application_row,
    new_id,
    seed_listing,
    seed_people,
)
from tests.fake_rpcs.fb_dashboards import mobile_parse_date
from tests.fake_supabase import api_error

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1/me/dashboard/tenant"
TODAY = date(2026, 10, 23)
TENANT = "c9999999-9999-4999-8999-999999999999"


@pytest.fixture
def tenant(client, strict_schema, monkeypatch):
    """A tenant who signs in for real, so the history RPC runs with their token; returns the headers."""
    seed_people(strict_schema)
    monkeypatch.setattr(dashboard, "_local_today", lambda: TODAY)
    # The database's clock too, which the history function reads: 12 pm on TODAY in Sydney.
    monkeypatch.setattr(fake_supabase.RpcContext, "now", staticmethod(lambda: "2026-10-23T01:00:00+00:00"))
    token = account(strict_schema, TENANT, "tess@example.test", "TENANT", full_name="Tess Tenant")
    return {"Authorization": f"Bearer {token}"}


def _tenant(client, headers) -> dict:
    response = client.get(API, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _lease(db, **over) -> tuple[str, dict]:
    listing_id, _ = seed_listing(db, listing={"title": "Harbour flat"})
    agreement = agreement_row(listing_id, tenant=TENANT, **over)
    db.seed("rent_agreements", [agreement])
    return listing_id, agreement


# -- the lease and its rent -------------------------------------------------------------
def test_the_current_lease_is_the_active_agreement(client, strict_schema, tenant):
    listing_id, agreement = _lease(strict_schema, rent_amount=2800, rent_frequency="MONTHLY", start_date="2026-02-01",
                                   end_date="2027-01-31", first_due_date="2026-02-01")
    older, _ = seed_listing(strict_schema)
    strict_schema.seed("rent_agreements", [agreement_row(older, tenant=TENANT, status="ENDED", start_date="2025-01-01")])

    body = _tenant(client, tenant)

    assert (body["has_tenancy"], body["listing_id"], body["listing_title"]) == (True, listing_id, "Harbour flat")
    assert body["lease"] == {
        "agreement_id": agreement["id"], "listing_id": listing_id, "listing_title": "Harbour flat",
        "address": "1 Harbour Street, Wollongong, NSW 2500", "rent_amount": 2800.0, "rent_frequency": "MONTHLY",
        "start_date": "2026-02-01", "end_date": "2027-01-31", "first_due_date": "2026-02-01",
    }
    # Its rent is charged once a charge is issued.
    assert (body["next_payment"], body["overdue_count"], body["overdue_amount"]) == (None, 0, 0)


def test_the_next_payment_is_the_first_issued_charge_not_yet_paid(client, strict_schema, tenant):
    _, agreement = _lease(strict_schema)
    paid = charge_row(agreement["id"], "2026-10-02")
    behind = charge_row(agreement["id"], "2026-10-09")
    coming = charge_row(agreement["id"], "2026-10-30")
    strict_schema.seed("rent_charges", [
        coming, paid, behind,
        charge_row(agreement["id"], "2026-10-16", status="DRAFT"),
        charge_row(agreement["id"], "2026-09-25", status="VOID"),
    ])
    strict_schema.seed("rent_payments", [
        payment_row(paid["id"], 325), payment_row(paid["id"], 325),
        payment_row(behind["id"], 200), payment_row(behind["id"], 450, status="PENDING", verified=False),
    ])

    body = _tenant(client, tenant)

    assert body["next_payment"] == {
        "charge_id": behind["id"], "period_start": "2026-10-09", "period_end": "2026-10-16", "due_date": "2026-10-09",
        "amount_due": 650.0, "amount_paid": 200.0, "amount_outstanding": 450.0, "status": "OVERDUE",
    }
    assert (body["overdue_count"], body["overdue_amount"]) == (1, 450.0)


@pytest.mark.parametrize(("due", "payments", "expected"), [
    ("2026-10-30", [(650, "SUCCEEDED")], ("PAID", 650.0, 0.0)),
    ("2026-10-02", [(700, "SUCCEEDED")], ("PAID", 700.0, 0.0)),  # overpaid: nothing outstanding, never below zero
    ("2026-10-30", [(100, "SUCCEEDED")], ("PARTIALLY_PAID", 100.0, 550.0)),
    ("2026-10-30", [], ("UNPAID", 0.0, 650.0)),
    ("2026-10-22", [(100, "SUCCEEDED")], ("OVERDUE", 100.0, 550.0)),  # due yesterday in Sydney
    ("2026-10-23", [], ("UNPAID", 0.0, 650.0)),  # due today is not overdue yet
    # Only a successful, verified payment counts.
    ("2026-10-30", [(650, "PROCESSING"), (650, "FAILED"), (650, "CANCELLED"), (650, "REFUNDED")], ("UNPAID", 0.0, 650.0)),
])
def test_a_charges_status_follows_mobile_my_rent_summary(client, strict_schema, tenant, due, payments, expected):
    _, agreement = _lease(strict_schema)
    charge = charge_row(agreement["id"], due)
    strict_schema.seed("rent_charges", [charge])
    strict_schema.seed("rent_payments", [
        payment_row(charge["id"], amount, status, verified=status in ("SUCCEEDED", "REFUNDED"))
        for amount, status in payments
    ])
    later = charge_row(agreement["id"], "2026-11-06")
    strict_schema.seed("rent_charges", [later])

    body = _tenant(client, tenant)

    payment = body["next_payment"]
    if expected[0] == "PAID":
        assert payment["charge_id"] == later["id"]  # the next charge not paid
    else:
        assert (payment["status"], payment["amount_paid"], payment["amount_outstanding"]) == expected


def test_a_tenant_who_is_paid_up_has_no_next_payment(client, strict_schema, tenant):
    _, agreement = _lease(strict_schema)
    charge = charge_row(agreement["id"], "2026-10-16", amount=650.5)
    strict_schema.seed("rent_charges", [charge])
    strict_schema.seed("rent_payments", [payment_row(charge["id"], 650.25), payment_row(charge["id"], 0.25)])

    body = _tenant(client, tenant)

    assert (body["next_payment"], body["overdue_count"], body["overdue_amount"]) == (None, 0, 0)


def test_another_tenants_lease_and_rent_are_not_read(client, strict_schema, tenant):
    listing_id, _ = seed_listing(strict_schema)
    theirs = agreement_row(listing_id, tenant=OTHER_TENANT)
    strict_schema.seed("rent_agreements", [theirs])
    strict_schema.seed("rent_charges", [charge_row(theirs["id"], "2026-10-02")])

    body = _tenant(client, tenant)

    assert (body["has_tenancy"], body["lease"], body["next_payment"]) == (False, None, None)


# -- repairs and inspections ----------------------------------------------------------
def test_open_repairs_are_the_work_orders_not_yet_resolved(client, strict_schema, tenant):
    statuses = ["OPEN", "ASSIGNED", "SCHEDULED", "PENDING_TENANT_CONFIRMATION", "RESOLVED"]
    strict_schema.seed("maintenance_work_orders", [work_order_row(new_id(), TENANT, status) for status in statuses]
                       + [work_order_row(new_id(), OTHER_TENANT)])

    assert _tenant(client, tenant)["open_maintenance"] == 4


def test_upcoming_inspections_are_the_tenants_bookings_and_their_homes_inspections(client, strict_schema, tenant):
    home, _ = _lease(strict_schema)
    viewing, _ = seed_listing(strict_schema, listing={"title": "Garden house"})
    booked = seed_booking(strict_schema, viewing, "2099-01-03T00:00:00+00:00", tenant=TENANT)
    seed_booking(strict_schema, viewing, FUTURE, status="pending", tenant=TENANT)
    seed_booking(strict_schema, viewing, PAST, tenant=TENANT)
    # Another time: one open, held or booked slot per listing and start
    # (mobile_inspection_slots_listing_start_active_idx).
    seed_booking(strict_schema, viewing, "2099-01-05T01:00:00+00:00", tenant=OTHER_TENANT)
    routine = inspection_row(home, "2099-01-01T00:00:00+00:00")
    private = inspection_row(viewing, "2099-01-02T00:00:00+00:00", kind="Private viewing", attendee_user_id=TENANT)
    strict_schema.seed("mobile_inspections", [
        routine, private,
        inspection_row(home, PAST),
        inspection_row(home, FUTURE, status="Cancelled"),
        inspection_row(viewing, FUTURE),  # someone else's open home
    ])

    body = _tenant(client, tenant)

    assert body["upcoming_inspections"] == 3
    assert [(item["id"], item["kind"], item["label"], item["listing_title"]) for item in body["next_inspections"]] == [
        (routine["id"], "inspection", "Routine inspection", "Harbour flat"),
        (private["id"], "inspection", "Private viewing", "Garden house"),
        (booked["id"], "booking", "Open home booking", "Garden house"),
    ]


# -- rental history ---------------------------------------------------------------------
def _seed_history(db) -> tuple[str, str]:
    """Two approved applications (one long over), one declined, and two reported tenancies."""
    past, _ = seed_listing(db, listing={"title": "Old flat", "lease_term_months": 6})
    current, _ = seed_listing(db, listing={"title": "Harbour flat", "weekly_rent": 720})
    declined, _ = seed_listing(db)
    # Another tenant's tenancy, of another home: a listing has one approved application
    # (rental_applications_one_approved_per_listing_idx).
    theirs, _ = seed_listing(db)
    old = application_row(past, applicant=TENANT, status="APPROVED", offer_weekly_rent=480,
                          metadata={"mobile": {"moveInDate": "15/01/2025"}})
    recent = application_row(current, applicant=TENANT, status="APPROVED", last_status_at="2026-08-31T20:00:00+00:00",
                             metadata={"mobile": {"leaseDuration": "1 year"}})
    db.seed("rental_applications", [old, recent, application_row(declined, applicant=TENANT, status="REJECTED"),
                                    application_row(theirs, applicant=OTHER_TENANT, status="APPROVED")])
    db.seed("tenant_profiles", [{"user_id": TENANT, "updated_at": NOW, "metadata": {"rental_history": [
        {"id": "first-home", "address": "4 River Road", "suburb": "Penrith", "state": "NSW",
         "start_date": "2019-02-01", "end_date": "2021-01-31", "weekly_rent": 390, "landlord_name": "Pat Lee"},
        {"id": "share-house", "address": "9 Hill Street", "start_date": "2021-03-01", "current": True},
        {"id": "not-readable"},  # another app's entry without an address is not shown
    ]}}])
    return old["id"], recent["id"]


def test_the_rental_history_joins_tenantvoice_tenancies_and_the_reported_ones(client, strict_schema, tenant):
    old, recent = _seed_history(strict_schema)

    body = _tenant(client, tenant)

    assert body["rental_history_complete"] is True
    assert [(item["source"], item["id"], item["start_date"], item["end_date"], item["current"])
            for item in body["rental_history"]] == [
        ("tenantvoice", recent, "2026-09-01", "2027-09-01", True),  # approved the 1st of September in Sydney
        ("tenantvoice", old, "2025-01-15", "2025-07-15", False),
        ("self_reported", "share-house", "2021-03-01", None, True),
        ("self_reported", "first-home", "2019-02-01", "2021-01-31", False),
    ]
    platform, reported = body["rental_history"][1], body["rental_history"][3]
    assert (platform["title"], platform["weekly_rent"], platform["landlord_name"]) == ("Old flat", 480.0, "Olivia Owner")
    assert platform["address"] == "1 Harbour Street, Wollongong, NSW, 2500"
    assert (reported["address"], reported["weekly_rent"], reported["landlord_name"]) == (
        "4 River Road, Penrith, NSW", 390.0, "Pat Lee",
    )


def test_the_history_is_read_as_the_tenant(client, strict_schema, tenant):
    _tenant(client, tenant)

    tenant_auth_id = next(user["auth_user_id"] for user in strict_schema.tables["users"] if user["id"] == TENANT)
    assert ("mobile_my_rental_history", tenant_auth_id) in strict_schema.rpc_callers
    assert strict_schema.rpc_unhandled == []


def test_a_history_that_cannot_be_read_leaves_the_rest_of_the_dashboard(client, strict_schema, tenant, monkeypatch):
    _seed_history(strict_schema)
    _, agreement = _lease(strict_schema)

    def timing_out(ctx, params):
        raise api_error("57014", "canceling statement due to statement timeout")

    monkeypatch.setitem(fake_rpcs._STAND_INS, "mobile_my_rental_history", timing_out)

    body = _tenant(client, tenant)

    assert body["rental_history_complete"] is False
    assert [item["source"] for item in body["rental_history"]] == ["self_reported", "self_reported"]
    assert body["lease"]["agreement_id"] == agreement["id"]


def test_the_history_function_refuses_a_caller_it_cannot_name(strict_schema):
    strict_schema.tokens["unknown-token"] = "a0000000-0000-4000-8000-00000000dead"

    with pytest.raises(Exception) as refused:
        user_client("unknown-token").rpc("mobile_my_rental_history", {}).execute()
    assert refused.value.code == "42501"


@pytest.mark.parametrize(("text", "expected"), [
    ("2026-02-05", date(2026, 2, 5)), ("2026-2-5", date(2026, 2, 5)), (" 5/2/2026 ", date(2026, 2, 5)),
    ("31/02/2026", None), ("2026-13-01", None), ("next week", None), ("", None), (None, None),
    # trim() takes spaces only.
    ("2026-02-05\n", None), ("\t5/2/2026", None),
])
def test_the_stand_in_reads_dates_as_mobile_parse_date_does(text, expected):
    assert mobile_parse_date(text) == expected


def test_a_lease_term_runs_to_the_same_day_or_the_months_last(client, strict_schema, tenant):
    listing_id, _ = seed_listing(strict_schema, listing={"lease_term_months": 1})
    strict_schema.seed("rental_applications", [application_row(
        listing_id, applicant=TENANT, status="APPROVED", metadata={"mobile": {"moveInDate": "2026-01-31"}},
    )])

    [item] = _tenant(client, tenant)["rental_history"]

    assert (item["start_date"], item["end_date"], item["current"]) == ("2026-01-31", "2026-02-28", False)


# -- who may read it ------------------------------------------------------------------
@pytest.mark.parametrize(("user", "role"), [(OWNER, "landlord"), (STRANGER, "service_provider"), (OWNER, "admin")])
def test_only_tenants_read_the_tenant_dashboard(client, strict_schema, as_profile, user, role):
    as_profile(id=user, role=role)

    assert client.get(API).status_code == 403
