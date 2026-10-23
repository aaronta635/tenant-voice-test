"""Provider finance and dashboard figures (app.services.dashboard), from the web ledger tables.

Bookings, transactions and invoices are web rows keyed by the provider's
users.id; services are mobile_provider_services rows.
"""

from datetime import date

import pytest
from fastapi import HTTPException

from app.services import dashboard, invoices
from tests.factories_bookings import booking, invoice, person, seed_provider, service, transaction, uid
from tests.schema_variants import max_rows  # noqa: F401 (fixture)

pytestmark = pytest.mark.usefixtures("strict_schema")

PROVIDER, CLIENT = uid("amelia"), uid("jon")
PROVIDER_ROW = {"id": PROVIDER, "rating_avg": 0, "review_count": 0, "profile_completion": 0}


@pytest.fixture
def provider(strict_schema):
    seed_provider(strict_schema, PROVIDER)
    strict_schema.seed("users", [person(CLIENT, "Jonathan Hayes")])
    return strict_schema


def _transactions(db, *rows):
    db.seed("transactions", [transaction(uid(f"t{n}"), PROVIDER, kind, amount, created_at=at)
                             for n, (kind, amount, at) in enumerate(rows)], schema="web")


def _bookings(db, *rows):
    db.seed("bookings", [booking(uid(f"b-{name}"), CLIENT, PROVIDER, status, **over)
                         for name, status, over in rows], schema="web")


def test_month_buckets_follow_sydney_time():
    # 15:30 UTC on 30 Sep is 01:30 on 1 Oct in Sydney.
    assert dashboard._month_key("2026-09-30T15:30:00+00:00") == "2026-10"
    assert dashboard._month_key("2026-09-30T10:00:00+00:00") == "2026-09"


def test_months_back_spans_year_boundaries():
    assert dashboard._months_back(date(2026, 2, 10), 4) == ["2025-11", "2025-12", "2026-01", "2026-02"]


def test_finance_is_net_of_fees_and_refunds_and_pending_excludes_drafts(provider):
    _transactions(
        provider,
        ("payment", 100, "2026-09-10T00:00:00+00:00"),
        ("platform_fee", 8.5, "2026-09-10T00:00:00+00:00"),
        ("refund", 20, "2026-09-12T00:00:00+00:00"),
        ("payout", 50, "2026-09-14T00:00:00+00:00"),
    )
    provider.seed("invoices", [
        invoice(uid("i-issued"), PROVIDER, number="INV-A", amount=30, status="issued"),
        invoice(uid("i-draft"), PROVIDER, number="INV-B", amount=10, status="draft"),
        invoice(uid("i-paid"), PROVIDER, number="INV-C", amount=99, status="paid"),
    ], schema="web")
    finance = dashboard.provider_finance(PROVIDER)
    assert finance["lifetime_earnings"] == 71.5
    assert finance["available_balance"] == 21.5
    assert finance["upcoming_payouts"] == 21.5
    assert finance["total_payouts"] == 50
    assert finance["pending_payments"] == 30
    assert len(finance["monthly"]) == 12


def test_finance_counts_only_the_providers_own_rows(provider):
    other = uid("other-provider")
    seed_provider(provider, other, "Other Co", slug="other-co")
    _transactions(provider, ("payment", 100, "2026-09-10T00:00:00+00:00"))
    provider.seed("transactions", [transaction(uid("theirs"), other, "payment", 900)], schema="web")
    provider.seed("invoices", [invoice(uid("their-invoice"), other, amount=500)], schema="web")
    finance = dashboard.provider_finance(PROVIDER)
    assert (finance["lifetime_earnings"], finance["pending_payments"]) == (100, 0)


def test_conversion_ignores_open_enquiries_and_cancellations(provider):
    _bookings(provider, ("a", "completed", {}), ("b", "confirmed", {}), ("c", "declined", {}),
              ("d", "cancelled", {}), ("e", "new_enquiry", {}))
    stats = dashboard.provider_dashboard(PROVIDER, PROVIDER_ROW)
    assert stats["booking_conversion_pct"] == 50.0
    assert (stats["total_enquiries"], stats["new_enquiries"], stats["completed_bookings"]) == (5, 1, 1)


def test_the_overview_counts_published_and_draft_services(provider):
    provider.seed("mobile_provider_services", [
        service(uid("live-1"), PROVIDER), service(uid("live-2"), PROVIDER),
        service(uid("draft"), PROVIDER, live=False),
        service(uid("someone-elses"), CLIENT),
    ])
    stats = dashboard.provider_dashboard(PROVIDER, PROVIDER_ROW)
    assert (stats["service_count"], stats["published_service_count"], stats["draft_service_count"]) == (3, 2, 1)


def test_invoice_document_resolves_parties_and_is_owner_scoped(provider):
    provider.tables["users"][0]["metadata"] = {"location": "Newtown", "state": "NSW"}
    provider.seed("mobile_provider_services", [service(uid("s"), PROVIDER, "Rental appraisal")])
    provider.seed("bookings", [booking(uid("b"), CLIENT, PROVIDER, "completed", service_id=uid("s"),
                                       scheduled_date="2026-10-05", property_suburb="Newtown")], schema="web")
    provider.seed("invoices", [invoice(uid("i"), PROVIDER, uid("b"), amount=99, status="paid",
                                       created_at="2026-10-01T00:00:00+00:00")], schema="web")
    owner = {"id": PROVIDER, "profile_id": PROVIDER, "business_name": "Whitlock Property", "abn": None}
    doc = invoices.invoice_document(uid("i"), owner)
    assert doc["provider"]["name"] == "Whitlock Property"
    assert doc["provider"]["location"] == "Newtown, NSW"
    assert doc["client"]["name"] == "Jonathan Hayes"
    assert doc["lines"] == [{"description": "Rental appraisal", "detail": "5 Oct 2026 · Newtown", "amount": 99.0}]
    with pytest.raises(HTTPException) as exc:
        invoices.invoice_document(uid("i"), {**owner, "id": CLIENT})
    assert exc.value.status_code == 404


def test_month_comparison_uses_same_days_and_preserves_timestamp_offset(provider, monkeypatch):
    monkeypatch.setattr(dashboard, "_local_today", lambda: date(2026, 10, 3))
    _transactions(
        provider,
        ("payment", 200, "2026-10-01T00:00:00+10:00"),
        ("payment", 100, "2026-09-03T23:30:00+10:00"),
        ("payment", 900, "2026-09-20T00:00:00+10:00"),
    )
    stats = dashboard.provider_dashboard(PROVIDER, PROVIDER_ROW)
    assert stats["month_change_pct"] == 100.0
    assert stats["previous_month_earnings"] == 1000


def test_overdue_jobs_are_separate_from_upcoming_week(provider, monkeypatch):
    monkeypatch.setattr(dashboard, "_local_today", lambda: date(2026, 10, 3))
    _bookings(provider, ("late", "confirmed", {"scheduled_date": "2026-10-02"}),
              ("soon", "confirmed", {"scheduled_date": "2026-10-03"}),
              ("later", "confirmed", {"scheduled_date": "2026-10-10"}))
    stats = dashboard.provider_dashboard(PROVIDER, PROVIDER_ROW)
    assert stats["due_this_week"] == 1
    assert stats["overdue_bookings"] == 1
    assert stats["decided_enquiries"] == 3


def test_finance_year_comparison_uses_same_period(provider, monkeypatch):
    monkeypatch.setattr(dashboard, "_local_today", lambda: date(2026, 10, 3))
    _transactions(
        provider,
        ("payment", 100, "2026-09-03T12:00:00+10:00"),
        ("payment", 100, "2025-10-03T12:00:00+10:00"),
        ("payment", 900, "2025-11-01T12:00:00+11:00"),
    )
    assert dashboard.provider_finance(PROVIDER)["yoy_change_pct"] == 0.0


def test_the_figures_read_every_row_past_the_max_rows_cap(provider, max_rows):
    """PostgREST answers a select with at most max-rows rows: the ledger and bookings are read page by page."""
    _transactions(provider, *[("payment", 10, "2026-09-10T00:00:00+00:00")] * 3)
    _bookings(provider, ("a", "completed", {}), ("b", "completed", {}))
    assert dashboard.provider_finance(PROVIDER)["lifetime_earnings"] == 30
    assert dashboard.provider_dashboard(PROVIDER, PROVIDER_ROW)["completed_bookings"] == 2
