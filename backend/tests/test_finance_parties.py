"""Finance rows and printed invoices name the people behind each job.

Clients and providers are users rows (web.bookings keeps users.id), and a
provider is a service_provider_profiles row keyed by its owner's users.id.
The ledger is web.transactions and web.invoices; the job's service is a
mobile_provider_services row.
"""

import pytest

from tests.factories_bookings import booking, invoice, person, service, transaction, uid
from tests.factories_provider_core import provider_profile

pytestmark = pytest.mark.usefixtures("strict_schema")

PROVIDER_USER, CLIENT_USER = uid("sam"), uid("tina")
SERVICE, JOB, PAYMENT, INVOICE = uid("power-point"), uid("job"), uid("payment"), uid("invoice")
CLIENT = {"name": "Tina Tenant", "abn": None, "location": "Newtown", "phone": None}


@pytest.fixture
def shared_provider_job(strict_schema, as_profile):
    strict_schema.seed("users", [
        person(PROVIDER_USER, "Sam Sparky", "SERVICE_PROVIDER", location="Marrickville", state="NSW",
               phone="0400 111 222"),
        person(CLIENT_USER, "Tina Tenant", location="Glebe", state="NSW"),
    ])
    strict_schema.seed("service_provider_profiles", [
        provider_profile(PROVIDER_USER, business_name="Sparky Electrical", abn="51 824 753 556"),
    ])
    strict_schema.seed("mobile_provider_services", [service(SERVICE, PROVIDER_USER, "Power point install", price=180)])
    strict_schema.seed("bookings", [booking(JOB, CLIENT_USER, PROVIDER_USER, "completed", service_id=SERVICE,
                                            scheduled_date="2026-10-05", scheduled_time="10:00:00",
                                            property_suburb="Newtown", price=180)], schema="web")
    strict_schema.seed("transactions", [transaction(PAYMENT, PROVIDER_USER, "payment", 180, booking_id=JOB)], schema="web")
    strict_schema.seed("invoices", [invoice(INVOICE, PROVIDER_USER, JOB, amount=180, status="paid")], schema="web")
    as_profile(PROVIDER_USER, "service_provider")
    return strict_schema


def test_shared_provider_finance_table_names_the_client(client, shared_provider_job):
    response = client.get("/api/v1/me/transactions")
    assert response.status_code == 200, response.text
    [row] = response.json()
    assert (row["client_name"], row["service_title"], row["booking_status"]) == ("Tina Tenant", "Power point install", "completed")


def test_shared_provider_invoice_prints_both_parties(client, shared_provider_job):
    response = client.get(f"/api/v1/me/invoices/{INVOICE}/document")
    assert response.status_code == 200, response.text
    document = response.json()
    assert document["provider"] == {"name": "Sparky Electrical", "abn": "51 824 753 556",
                                    "location": "Marrickville, NSW", "phone": "0400 111 222"}
    assert document["client"] == CLIENT
    assert document["lines"] == [{"description": "Power point install", "detail": "5 Oct 2026 · Newtown", "amount": 180.0}]


def test_shared_provider_without_business_name_prints_the_owner_name(client, shared_provider_job):
    shared_provider_job.tables["service_provider_profiles"][0]["company_name"] = None
    response = client.get(f"/api/v1/me/invoices/{INVOICE}/document")
    assert response.status_code == 200, response.text
    assert response.json()["provider"]["name"] == "Sam Sparky"


def test_client_without_any_booking_location_falls_back_to_their_profile_place(client, shared_provider_job):
    shared_provider_job.schema_tables["web"]["bookings"][0]["property_suburb"] = None
    document = client.get(f"/api/v1/me/invoices/{INVOICE}/document").json()
    assert document["client"]["location"] == "Glebe, NSW"


def test_an_invoice_of_no_booking_prints_the_provider_alone(client, shared_provider_job):
    manual = uid("manual")
    shared_provider_job.seed("invoices", [invoice(manual, PROVIDER_USER, None, number="MANUAL-1", amount=40,
                                                  status="draft")], schema="web")
    document = client.get(f"/api/v1/me/invoices/{manual}/document").json()
    assert document["provider"]["name"] == "Sparky Electrical"
    assert document["client"] == {"name": None, "abn": None, "location": None, "phone": None}
    assert document["lines"] == [{"description": "Service", "detail": None, "amount": 40.0}]
