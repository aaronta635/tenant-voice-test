"""The ledger writes each booking's invoice, payment and fee once (web.invoices, web.transactions).

Each write checks for its row first. Two requests can both find none, so two
partial unique indexes settle it (supabase/shared/0001_web_schema.sql): one
invoice per booking (uq_invoices_booking) and one payment and one fee per
booking (uq_transactions_booking_type). The request that loses gets 23505,
which the ledger takes as "already written". The strict fake enforces both
indexes, so these tests run the race itself.
"""

import pytest
from postgrest.exceptions import APIError

from app.services import ledger
from tests.factories_bookings import booking, invoice, person, seed_provider, service, uid, web_rows
from tests.fake_supabase import FakeTableQuery

pytestmark = pytest.mark.usefixtures("strict_schema")

AMELIA, JON, RIVAL = uid("amelia"), uid("jon"), uid("rival")
APPRAISAL, JOB = uid("appraisal"), uid("job")


@pytest.fixture
def job(strict_schema) -> dict:
    """A confirmed, priced booking, as update_booking hands it to the ledger."""
    seed_provider(strict_schema, AMELIA)
    strict_schema.seed("users", [person(JON, "Jonathan Hayes")])
    strict_schema.seed("mobile_provider_services", [service(APPRAISAL, AMELIA, "Rental appraisal", price=99)])
    row = booking(JOB, JON, AMELIA, "confirmed", service_id=APPRAISAL, price=99, scheduled_date="2030-01-16",
                  property_suburb="Newtown")
    strict_schema.seed("bookings", [row], schema="web")
    return dict(row)


def test_confirming_raises_one_issued_invoice_due_a_week_after_the_job(strict_schema, job):
    ledger.issue_invoice(job)
    ledger.issue_invoice(job)

    [raised] = web_rows(strict_schema, "invoices")
    assert (raised["booking_id"], raised["provider_id"], raised["amount"], raised["status"]) == (JOB, AMELIA, 99.0, "issued")
    assert (raised["number"], raised["due_date"]) == (ledger.invoice_number(JOB), "2030-01-23")
    assert raised["issued_at"]


def test_two_requests_issuing_the_invoice_write_it_once(strict_schema, job, monkeypatch):
    invoice_for = ledger._invoice_for
    raced: list[bool] = []

    def other_request_writes_first(booking):
        # This request's check finds no invoice, and the other request writes it right then.
        if not raced:
            raced.append(True)
            ledger.issue_invoice(booking)
            return None
        return invoice_for(booking)

    monkeypatch.setattr(ledger, "_invoice_for", other_request_writes_first)
    ledger.issue_invoice(job)

    assert [row["number"] for row in web_rows(strict_schema, "invoices")] == [ledger.invoice_number(JOB)]


def test_two_requests_recording_the_payment_write_it_once(strict_schema, job, monkeypatch):
    service_title = ledger._service_title
    raced: list[bool] = []

    def other_request_meanwhile(service_id):
        # The title is looked up between the "already paid?" check and the insert.
        if not raced:
            raced.append(True)
            ledger.record_completion(job)
        return service_title(service_id)

    monkeypatch.setattr(ledger, "_service_title", other_request_meanwhile)
    ledger.record_completion(job)

    recorded = {row["type"]: (row["amount"], row["description"]) for row in web_rows(strict_schema, "transactions")}
    assert recorded == {"payment": (99.0, "Payment · Rental appraisal · Newtown"),
                        "platform_fee": (8.42, ledger.PLATFORM_FEE_LABEL)}
    assert [row["status"] for row in web_rows(strict_schema, "invoices")] == ["paid"]


def test_a_finished_job_without_an_invoice_gets_a_paid_one(strict_schema, job):
    ledger.record_completion(job)

    [paid] = web_rows(strict_schema, "invoices")
    assert (paid["booking_id"], paid["status"], paid["amount"]) == (JOB, "paid", 99.0)


def test_an_invoice_number_another_invoice_holds_takes_the_whole_booking_id(strict_schema, job):
    # Invoice numbers are unique per provider, and the short one is eight hex digits of the booking id.
    strict_schema.seed("invoices", [invoice(uid("manual"), AMELIA, None, number=ledger.invoice_number(JOB),
                                            status="draft")], schema="web")

    ledger.issue_invoice(job)

    [raised] = web_rows(strict_schema, "invoices", booking_id=JOB)
    assert raised["number"] == "INV-" + JOB.replace("-", "").upper()


def test_any_other_database_error_is_raised(strict_schema, job, monkeypatch):
    execute = FakeTableQuery.execute

    def timing_out(query):
        if query._op == "insert" and query._name in ("invoices", "transactions"):
            raise APIError({"code": "57014", "message": "canceling statement due to statement timeout"})
        return execute(query)

    monkeypatch.setattr(FakeTableQuery, "execute", timing_out)
    for write in (ledger.issue_invoice, ledger.record_completion):
        with pytest.raises(APIError) as exc:
            write(job)
        assert exc.value.code == "57014"


@pytest.mark.parametrize("price", [None, 0])
def test_an_unpriced_booking_leaves_no_ledger_rows(strict_schema, job, price):
    job["price"] = price
    ledger.issue_invoice(job)
    ledger.record_completion(job)
    assert not web_rows(strict_schema, "invoices") and not web_rows(strict_schema, "transactions")


def test_declining_voids_only_the_providers_open_invoice(strict_schema, job):
    seed_provider(strict_schema, RIVAL, "Rival Co", "Rita Rival", slug="rival-co")
    other_job = uid("other-job")
    strict_schema.seed("bookings", [booking(other_job, JON, AMELIA, "confirmed", price=50)], schema="web")
    strict_schema.seed("invoices", [
        # Written outside the API, which refuses another provider's booking: never touched here.
        invoice(uid("rival-invoice"), RIVAL, JOB, number="RIVAL-1", status="issued"),
        invoice(uid("paid-invoice"), AMELIA, other_job, number="INV-2", status="paid"),
    ], schema="web")

    ledger.void_open_invoice(job)
    ledger.void_open_invoice({**job, "id": other_job})

    assert {row["number"]: row["status"] for row in web_rows(strict_schema, "invoices")} == {
        "RIVAL-1": "issued", "INV-2": "paid",
    }


def test_the_fee_rounds_half_up_to_the_cent():
    assert [ledger.platform_fee(price) for price in (99, 150, 0.5, 1000)] == [8.42, 12.75, 0.04, 85.0]
