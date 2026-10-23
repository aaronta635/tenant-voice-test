"""A provider's invoices are web.invoices rows keyed by the provider's users.id (migration plan §3 c3).

Regression cover: every invoice route read and wrote a public invoices table
the shared database lacks (PGRST205, 500).
"""

import pytest

from tests.factories_bookings import booking, invoice, person, seed_provider, uid, web_rows
from tests.schema_variants import max_rows  # noqa: F401 (fixture)

pytestmark = pytest.mark.usefixtures("strict_schema")

AMELIA, RIVAL, JON = uid("amelia"), uid("rival"), uid("jon")
OWN_JOB, NEW_JOB, RIVAL_JOB = uid("own-job"), uid("new-job"), uid("rival-job")
DRAFT, ISSUED, RIVALS = uid("draft-invoice"), uid("issued-invoice"), uid("rival-invoice")
API = "/api/v1/me/invoices"


@pytest.fixture
def ledger_rows(strict_schema, as_profile):
    seed_provider(strict_schema, AMELIA)
    seed_provider(strict_schema, RIVAL, "Rival Co", "Rita Rival", slug="rival-co")
    strict_schema.seed("users", [person(JON, "Jonathan Hayes")])
    strict_schema.seed("bookings", [booking(OWN_JOB, JON, AMELIA, "confirmed", price=99),
                                    booking(NEW_JOB, JON, AMELIA, "new_enquiry"),
                                    booking(RIVAL_JOB, JON, RIVAL, "confirmed", price=50)], schema="web")
    strict_schema.seed("invoices", [
        invoice(DRAFT, AMELIA, None, number="A-1", amount=40, status="draft", created_at="2026-01-01T00:00:00+00:00"),
        invoice(ISSUED, AMELIA, OWN_JOB, number="A-2", amount=99, status="issued",
                created_at="2026-02-01T00:00:00+00:00"),
        invoice(RIVALS, RIVAL, RIVAL_JOB, number="R-1", amount=50),
    ], schema="web")
    as_profile(AMELIA, "service_provider")
    return strict_schema


def _numbers(db) -> dict[str, str]:
    return {row["number"]: row["status"] for row in web_rows(db, "invoices", provider_id=AMELIA)}


def test_a_provider_lists_and_opens_only_their_own_invoices(client, ledger_rows):
    listed = client.get(API)
    assert listed.status_code == 200, listed.text
    assert [row["id"] for row in listed.json()] == [ISSUED, DRAFT]
    assert client.get(f"{API}/{ISSUED}").json()["booking_id"] == OWN_JOB
    for unknown in (RIVALS, uid("no-such-invoice"), "not-an-invoice"):
        assert client.get(f"{API}/{unknown}").status_code == 404, unknown


def test_every_invoice_is_listed_past_the_max_rows_cap(client, ledger_rows, max_rows):
    # PostgREST answers a select with at most max-rows rows (one here): the list reads page by page.
    assert [row["id"] for row in client.get(API).json()] == [ISSUED, DRAFT]


def test_a_provider_writes_an_invoice_for_no_booking_or_their_own(client, ledger_rows):
    manual = client.post(API, json={"number": "A-3", "amount": 120, "due_date": "2026-03-01"})
    assert manual.status_code == 201, manual.text
    assert (manual.json()["status"], manual.json()["provider_id"], manual.json()["booking_id"]) == ("draft", AMELIA, None)

    for_booking = client.post(API, json={"number": "A-4", "amount": 99, "booking_id": NEW_JOB})
    assert for_booking.status_code == 201, for_booking.text
    assert for_booking.json()["booking_id"] == NEW_JOB


@pytest.mark.parametrize("payload, status, detail", [
    ({"number": "A-5", "amount": 1, "booking_id": RIVAL_JOB}, 404, "Booking not found"),
    ({"number": "A-5", "amount": 1, "booking_id": uid("no-such-booking")}, 404, "Booking not found"),
    ({"number": "A-5", "amount": 1, "booking_id": "not-a-booking"}, 404, "Booking not found"),
    ({"number": "A-1", "amount": 1}, 409, "That already exists."),  # numbers are unique per provider
    ({"number": "A-5", "amount": 1, "booking_id": OWN_JOB}, 409, "That already exists."),  # one per booking
])
def test_an_invoice_for_someone_elses_booking_or_a_taken_number_is_refused(client, ledger_rows, payload, status, detail):
    response = client.post(API, json=payload)
    assert (response.status_code, response.json()["detail"]) == (status, detail)
    assert set(_numbers(ledger_rows)) == {"A-1", "A-2"}


def test_another_providers_invoice_number_is_theirs_alone(client, ledger_rows):
    assert client.post(API, json={"number": "R-1", "amount": 10}).status_code == 201


def test_issuing_and_paying_follow_the_invoice_statuses(client, ledger_rows):
    issued = client.patch(f"{API}/{DRAFT}", json={"status": "issued", "due_date": "2026-04-01"})
    assert issued.status_code == 200, issued.text
    assert (issued.json()["status"], issued.json()["due_date"]) == ("issued", "2026-04-01")
    assert issued.json()["issued_at"]
    assert client.patch(f"{API}/{DRAFT}", json={"status": "paid"}).json()["status"] == "paid"

    refused = client.patch(f"{API}/{DRAFT}", json={"status": "draft"})
    assert (refused.status_code, refused.json()["detail"]) == (400, "Cannot transition invoice from paid to draft")
    assert client.patch(f"{API}/{RIVALS}", json={"status": "paid"}).status_code == 404
    assert web_rows(ledger_rows, "invoices", id=RIVALS)[0]["status"] == "issued"


def test_only_a_draft_can_be_deleted(client, ledger_rows):
    refused = client.delete(f"{API}/{ISSUED}")
    assert (refused.status_code, refused.json()["detail"]) == (400, "Only draft invoices can be deleted")
    assert client.delete(f"{API}/{RIVALS}").status_code == 404
    assert client.delete(f"{API}/{DRAFT}").status_code == 204
    assert _numbers(ledger_rows) == {"A-2": "issued"}
    assert len(web_rows(ledger_rows, "invoices", provider_id=RIVAL)) == 1


def test_invoices_are_for_providers_only(client, ledger_rows, as_profile):
    as_profile(JON, "landlord")
    assert client.get(API).status_code == 403
