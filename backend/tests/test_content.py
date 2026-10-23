"""Public content on the shared database.

FAQs and platform settings are web tables; the landing page's figures count
shared providers, credentials and reviews and the web's bookings and
categories. Inspection times are tested in test_inspections.py.

Regression cover for the shared-schema port: FAQs answered 500 (public.faqs
is not there), the support contact showed placeholders, and the figures
came from legacy tables (0 where those are missing) and counted hidden
reviews in one unbounded read.
"""

import uuid

import pytest
from postgrest.exceptions import APIError

from app.services import content
from tests.factories_reviews_complaints import NOW, profile_document, provider_profile, review, user
from tests.fake_supabase import FakeTableQuery

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
TIMEOUT = {"code": "57014", "message": "canceling statement due to statement timeout"}
CLIENT = "c0000000-0000-4000-8000-000000000001"


def _uuid(name: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, name))


@pytest.fixture
def failing(monkeypatch):
    """Tables whose every query raises the given PostgREST error."""
    errors: dict[str, dict] = {}
    execute = FakeTableQuery.execute

    def failing_execute(self):
        if self._name in errors:
            raise APIError({**errors[self._name], "hint": None, "details": None})
        return execute(self)

    monkeypatch.setattr(FakeTableQuery, "execute", failing_execute)
    return errors


def _faq(name, audience, sort_order, is_active=True):
    return {"id": _uuid(name), "audience": audience, "question": f"Question {name}?", "answer": "An answer.",
            "sort_order": sort_order, "is_active": is_active}


def test_faqs_list_the_active_questions_for_an_audience_in_order(client, strict_schema):
    strict_schema.seed("faqs", [
        _faq("b", "service_provider", 2), _faq("a", "all", 1), _faq("c", "tenant", 0), _faq("d", "all", 3, is_active=False),
    ], schema="web")
    response = client.get(f"{API}/faqs", params={"audience": "service_provider"})
    assert response.status_code == 200, response.text
    assert [faq["question"] for faq in response.json()] == ["Question a?", "Question b?"]


def test_a_failed_faq_read_is_an_error_not_an_empty_faq_page(client, failing):
    failing["faqs"] = TIMEOUT
    response = client.get(f"{API}/faqs")
    assert response.status_code == 500
    assert response.json() == {"detail": "Something went wrong. Please try again."}


def test_the_support_contact_comes_from_the_platform_settings(client, strict_schema):
    strict_schema.seed("platform_settings", [
        {"key": "support_email", "value": "help@tenantvoice.test"},
        {"key": "support_phone", "value": "1800 836 268"},
        {"key": "marketplace_city_default", "value": "Sydney"},
    ], schema="web")
    response = client.get(f"{API}/support-contact")
    assert response.status_code == 200, response.text
    assert response.json() == {"email": "help@tenantvoice.test", "phone": "1800 836 268"}


def test_a_failed_settings_read_shows_no_made_up_contact(client, failing):
    failing["platform_settings"] = TIMEOUT
    assert client.get(f"{API}/support-contact").status_code == 500


def _category(code, is_active=True):
    return {"slug": code.replace("_", "-"), "category": code, "name": code.title(), "description": "Services.",
            "is_active": is_active}


def _booking(status):
    return {"client_id": CLIENT, "provider_id": _uuid("listed"), "status": status}


# The providers' accounts, by name: the landing figures count only ACTIVE, open ones.
PROVIDER_ACCOUNTS = {
    "listed": {}, "checked": {}, "approved": {}, "mobile": {}, "draft": {}, "unverified": {},
    "suspended": {"status": "SUSPENDED"}, "deactivated": {"status": "DEACTIVATED"},
    "pending": {"status": "PENDING_VERIFICATION"}, "closed": {"deleted_at": NOW},
}


def provider_accounts(db, names) -> None:
    db.seed("users", [user(_uuid(name), name.title(), "SERVICE_PROVIDER", **PROVIDER_ACCOUNTS.get(name, {}))
                      for name in names])


@pytest.fixture
def marketplace(strict_schema):
    provider_accounts(strict_schema, PROVIDER_ACCOUNTS)
    strict_schema.seed("service_provider_profiles", [
        provider_profile(_uuid("listed"), "Listed, document approved", metadata={"is_published": True}),
        provider_profile(_uuid("checked"), "Listed, profile verified", verification_status="VERIFIED",
                         metadata={"is_published": True}),
        provider_profile(_uuid("approved"), "Listed, profile approved", verification_status="approved"),
        provider_profile(_uuid("mobile"), "Mobile row, no flag, document pending"),
        provider_profile(_uuid("draft"), "Unlisted", verification_status="VERIFIED", metadata={"is_published": False}),
        provider_profile(_uuid("unverified"), "Listed, nothing approved", verification_status="PENDING", metadata={}),
        # Listed and verified, but out of the marketplace: their accounts are not open and ACTIVE.
        provider_profile(_uuid("suspended"), "Suspended, profile verified", verification_status="VERIFIED"),
        provider_profile(_uuid("deactivated"), "Deactivated, document approved"),
        provider_profile(_uuid("pending"), "Account pending, profile approved", verification_status="APPROVED"),
        provider_profile(_uuid("closed"), "Closed, profile verified", verification_status="VERIFIED"),
    ])
    strict_schema.seed("profile_documents", [
        profile_document(_uuid("doc-listed"), _uuid("listed")),
        profile_document(_uuid("doc-draft"), _uuid("draft")),
        profile_document(_uuid("doc-mobile"), _uuid("mobile"), review_status="PENDING"),
        profile_document(_uuid("doc-unverified"), _uuid("unverified"), review_status="REJECTED"),
        profile_document(_uuid("doc-deactivated"), _uuid("deactivated")),
    ])
    strict_schema.seed("bookings", [_booking("completed"), _booking("completed"), _booking("confirmed"),
                                    _booking("cancelled")], schema="web")
    strict_schema.seed("service_categories", [_category("tradie"), _category("cleaner"), _category("photographer"),
                                              _category("accountant", is_active=False)], schema="web")
    # Finished repairs (RESOLVED: maintenance_work_orders_status_check), one per complaint.
    strict_schema.seed("maintenance_work_orders", [
        {"id": _uuid(f"wo-{i}"), "complaint_id": _uuid(f"c-{i}"), "tenant_user_id": CLIENT, "status": "RESOLVED",
         "updated_at": NOW} for i in range(5)
    ])
    strict_schema.seed("reviews", [
        review(_uuid(f"r{i}"), CLIENT, _uuid("listed"), rating) for i, rating in enumerate([5, 4, 2])
    ] + [
        review(_uuid("hidden"), CLIENT, _uuid("listed"), 1, status="HIDDEN"),
        review(_uuid("flagged"), CLIENT, _uuid("listed"), 1, status="FLAGGED"),
    ])
    return strict_schema


EXPECTED_STATS = {
    # Listed with an approved document or a verified profile, on an ACTIVE,
    # open account; unlisted ones, those with nothing approved and those the
    # marketplace hides (suspended, deactivated, pending, closed) are left out.
    "verified_providers": 3,
    # Bookings marked complete, not maintenance work orders.
    "jobs_completed": 2,
    # Published reviews only.
    "average_rating": 3.67,
    "satisfaction_pct": 67,
    "review_count": 3,
    # The active categories the categories list shows.
    "category_count": 3,
}


def test_platform_stats_count_verified_listed_providers_completed_bookings_and_listed_categories(client, marketplace):
    response = client.get(f"{API}/stats/platform")
    assert response.status_code == 200, response.text
    assert response.json() == EXPECTED_STATS


def test_platform_stats_read_every_row_past_a_page(client, marketplace, monkeypatch):
    # PostgREST answers at most max-rows rows; the figures page until a page is empty.
    monkeypatch.setattr(content, "PAGE_SIZE", 2)
    monkeypatch.setattr(content, "ID_CHUNK", 1)
    response = client.get(f"{API}/stats/platform")
    assert response.status_code == 200, response.text
    assert response.json() == EXPECTED_STATS


def test_verified_providers_are_counted_past_a_capped_answer(client, strict_schema, monkeypatch):
    # PostgREST's max-rows may be below PAGE_SIZE: here an answer holds at most two rows.
    execute = FakeTableQuery.execute

    def capped(query):
        result = execute(query)
        if query._op == "select":
            result.data = result.data[:2]
        return result

    monkeypatch.setattr(FakeTableQuery, "execute", capped)
    provider_accounts(strict_schema, ["busy", "one"])
    strict_schema.seed("service_provider_profiles", [
        provider_profile(_uuid("busy"), "Many approved documents"), provider_profile(_uuid("one"), "One approved"),
    ])
    strict_schema.seed("profile_documents", [
        # One document per type (profile_documents_user_id_document_type_key).
        *(profile_document(_uuid(f"busy-{n}"), _uuid("busy"), document_type=document_type)
          for n, document_type in enumerate(("TRADE_LICENCE", "PUBLIC_LIABILITY_INSURANCE", "GOVERNMENT_PHOTO_ID"))),
        profile_document(_uuid("one-doc"), _uuid("one")),
    ])

    response = client.get(f"{API}/stats/platform")

    assert response.status_code == 200, response.text
    assert response.json()["verified_providers"] == 2


@pytest.mark.parametrize("table", ["bookings", "service_categories", "profile_documents", "reviews"])
def test_platform_stats_report_a_failed_count_instead_of_showing_zero(client, marketplace, failing, table):
    failing[table] = TIMEOUT
    assert client.get(f"{API}/stats/platform").status_code == 500

