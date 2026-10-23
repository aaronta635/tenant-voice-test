"""One job from enquiry to review through the API, on the strict shared schema.

The rows of migration plan §1.2 that answered 500 on the shared database
work end to end: bookings (create, list, get, update) and busy times,
invoices, transactions, the provider dashboard and finance, and booking
reviews. People are users rows, the provider a service_provider_profiles
row, the service a mobile_provider_services row and the thread and review
shared rows; the booking, its invoice and its ledger rows are web rows.
"""

from datetime import date, datetime

import pytest

from app.services import bookings, dashboard
from tests.factories_bookings import freeze_clock, open_week, person, rows, seed_provider, service, uid, web_rows

pytestmark = pytest.mark.usefixtures("strict_schema")

AMELIA, JON, APPRAISAL = uid("amelia"), uid("jon"), uid("appraisal")
API = "/api/v1"


@pytest.fixture
def market(strict_schema, monkeypatch):
    seed_provider(strict_schema, AMELIA, "Whitlock Property", "Amelia Whitlock", slug="whitlock-property",
                  abn="51 824 753 556")
    strict_schema.seed("users", [person(JON, "Jonathan Hayes", "LANDLORD", location="Glebe", state="NSW")])
    strict_schema.seed("mobile_provider_services", [service(APPRAISAL, AMELIA, "Rental appraisal", price=99,
                                                            minutes=90)])
    strict_schema.seed("provider_availability", open_week(AMELIA), schema="web")
    # The strict fake's clock writes the ledger in January 2026, Sydney time.
    monkeypatch.setattr(dashboard, "_local_today", lambda: date(2026, 1, 15))
    return strict_schema


def _ok(response, status=200):
    assert response.status_code == status, response.text
    return response.json()


def test_a_job_from_enquiry_to_review(client, market, as_profile, monkeypatch):
    clock = freeze_clock(monkeypatch, bookings, datetime(2030, 1, 15, 12))

    # The client books a published provider's live service.
    as_profile(JON, "landlord")
    booked = _ok(client.post(f"{API}/bookings", json={
        "provider_id": "whitlock-property", "service_id": APPRAISAL, "scheduled_date": "2030-01-16",
        "scheduled_time": "10:00:00", "property_address": "12 Example Terrace", "property_suburb": "Newtown",
    }), 201)
    assert (booked["provider_id"], booked["status"], booked["price"], booked["provider_name"]) == (
        AMELIA, "new_enquiry", 99, "Whitlock Property",
    )
    assert _ok(client.get(f"{API}/bookings/{booked['id']}"))["service_title"] == "Rental appraisal"

    # The provider sees the enquiry and accepts it: an invoice is issued.
    as_profile(AMELIA, "service_provider")
    assert [b["client_name"] for b in _ok(client.get(f"{API}/bookings"))] == ["Jonathan Hayes"]
    overview = _ok(client.get(f"{API}/me/dashboard/provider"))
    assert (overview["new_enquiries"], overview["total_enquiries"], overview["published_service_count"]) == (1, 1, 1)
    assert _ok(client.patch(f"{API}/bookings/{booked['id']}", json={"status": "confirmed"}))["status"] == "confirmed"
    [issued] = _ok(client.get(f"{API}/me/invoices"))
    assert (issued["booking_id"], issued["status"], issued["amount"]) == (booked["id"], "issued", 99)
    assert _ok(client.get(f"{API}/me/dashboard/provider/finance"))["pending_payments"] == 99
    # The accepted job now takes its slot, for 90 minutes.
    assert _ok(client.get(f"{API}/providers/{AMELIA}/busy-times")) == [
        {"date": "2030-01-16", "start_time": "10:00", "end_time": "11:30"},
    ]

    # At the appointment the provider starts and finishes the job: payment, fee and a paid invoice.
    clock[0] = clock[0].replace(day=16, hour=10)
    _ok(client.patch(f"{API}/bookings/{booked['id']}", json={"status": "in_progress"}))
    done = _ok(client.patch(f"{API}/bookings/{booked['id']}",
                            json={"status": "completed", "completion_report": "Appraisal emailed"}))
    assert (done["status"], done["completion_report"]) == ("completed", "Appraisal emailed")
    ledger_rows = _ok(client.get(f"{API}/me/transactions"))
    assert sorted((t["type"], t["amount"], t["client_name"], t["service_title"], t["booking_status"])
                  for t in ledger_rows) == [
        ("payment", 99, "Jonathan Hayes", "Rental appraisal", "completed"),
        ("platform_fee", 8.42, "Jonathan Hayes", "Rental appraisal", "completed"),
    ]
    document = _ok(client.get(f"{API}/me/invoices/{issued['id']}/document"))
    assert document["status"] == "paid"
    assert (document["provider"]["name"], document["provider"]["abn"]) == ("Whitlock Property", "51 824 753 556")
    assert document["client"] == {"name": "Jonathan Hayes", "abn": None, "location": "Newtown", "phone": None}
    assert document["lines"] == [{"description": "Rental appraisal",
                                  "detail": "16 Jan 2030 · 12 Example Terrace · Newtown", "amount": 99.0}]
    finance = _ok(client.get(f"{API}/me/dashboard/provider/finance"))
    assert (finance["lifetime_earnings"], finance["month_earnings"], finance["pending_payments"]) == (90.58, 90.58, 0)
    assert finance["available_balance"] == 90.58

    # The client reviews the finished job; the provider's figures count it.
    as_profile(JON, "landlord")
    review = _ok(client.post(f"{API}/reviews", json={"booking_id": booked["id"], "rating": 5,
                                                     "comment": "Thorough and on time."}), 201)
    assert review["booking_id"] == booked["id"]
    assert _ok(client.get(f"{API}/bookings"))[0]["review_rating"] == 5

    as_profile(AMELIA, "service_provider")
    overview = _ok(client.get(f"{API}/me/dashboard/provider"))
    assert (overview["completed_bookings"], overview["booking_conversion_pct"], overview["month_earnings"]) == (
        1, 100.0, 90.58,
    )
    assert (overview["review_count"], overview["rating_avg"], overview["awaiting_reply"]) == (1, 5.0, 1)
    assert _ok(client.get(f"{API}/providers/whitlock-property"))["completed_jobs"] == 1

    # Every row is where the shared database keeps it.
    [stored] = web_rows(market, "bookings")
    assert stored["review_id"] == review["id"]
    assert [row["reviewed_user_id"] for row in rows(market, "reviews")] == [AMELIA]
    assert [n["title"] for n in rows(market, "notifications", user_id=JON)] == [
        "Whitlock Property accepted your booking", "Whitlock Property has started your job",
        "Whitlock Property marked your job as done",
    ]
    assert [n["title"] for n in rows(market, "notifications", user_id=AMELIA)] == [
        "New enquiry from Jonathan Hayes", "New 5-star review from Jonathan Hayes",
    ]
