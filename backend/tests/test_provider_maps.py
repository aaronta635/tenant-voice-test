"""The provider mappers read either app's rows and write values both apps can show (plan §3 a8, b1, b2)."""

import pytest

from fastapi import HTTPException
from postgrest.exceptions import APIError

from app.services.maps_provider_core import (
    REPAIR_CATEGORIES,
    SERVICE_LIVE_STATUS,
    WEB_CATEGORIES,
    WEB_CATEGORY_CODES,
    category_codes,
    duration_minutes,
    flatten_profile_document,
    flatten_provider_service,
    inclusion_list,
    inclusion_text,
    provider_category,
    repair_category,
    run_function,
    service_changes,
    service_duration,
    web_category,
)

NOW = "2026-01-01T00:00:00+00:00"
FORM = {
    "title": "Gutter clean", "description": None, "pricing_type": "hourly", "price": 120, "duration_minutes": 90,
    "inclusions": "Ladder work\n\n  Downpipes ", "exclusions": None, "service_area": None,
    "cancellation_policy": "24 hours", "is_active": True, "sort_order": 3,
}


def _service(**over) -> dict:
    row = {"id": "s", "provider_user_id": "p", "title": "Gutter clean", "description": "", "pricing_type": "flat",
           "price": 120, "duration": "", "inclusions": [], "exclusions": [], "service_area": "", "category": "GENERAL",
           "status": SERVICE_LIVE_STATUS, "created_at": NOW, "updated_at": NOW}
    row.update(over)
    return row


@pytest.mark.parametrize("text, minutes", [
    ("90 minutes", 90), ("90", 90), ("45 mins", 45), ("2 hours", 120), ("1.5 hrs", 90), ("1h 30m", 90),
    ("2-3 hours", 120), ("1 hour 30", 90), ("", None), (None, None), ("about a day", None), ("2 days", None), (60, 60),
])
def test_durations_from_either_app_read_as_minutes(text, minutes):
    assert duration_minutes(text) == minutes


def test_the_web_writes_durations_both_apps_read():
    assert service_duration(90) == "90 minutes" and duration_minutes(service_duration(90)) == 90
    assert service_duration(None) == ""


def test_inclusions_are_lines_in_the_form_and_a_list_in_the_table():
    assert inclusion_list("Ladder work\n\n  Downpipes \n") == ["Ladder work", "Downpipes"]
    assert inclusion_list(None) == []
    assert inclusion_text(["Ladder work", "Downpipes"]) == "Ladder work\nDownpipes"
    assert inclusion_text([]) is None and inclusion_text(None) is None
    assert inclusion_text("Travel") == "Travel"  # a mobile row holding a JSON string
    assert inclusion_text([{"text": "x"}, 2, True, " "]) == "2"


def test_the_form_maps_onto_what_the_service_functions_take():
    assert service_changes({**FORM, "category": "PLUMBING"}) == {
        "title": "Gutter clean", "price": 120, "pricingType": "hourly", "category": "PLUMBING", "description": "",
        "serviceArea": "", "duration": "90 minutes", "inclusions": ["Ladder work", "Downpipes"], "exclusions": [],
        "status": "active",
    }


def test_an_update_maps_only_what_it_sends_and_never_clears_a_required_field():
    assert service_changes({"is_active": False}) == {"status": "draft"}
    assert service_changes({"title": None, "price": None, "pricing_type": None, "is_active": None,
                            "category": None}) == {}
    assert service_changes({"description": None, "duration_minutes": None, "inclusions": None}) == {
        "description": "", "duration": "", "inclusions": [],
    }


def test_a_mobile_service_reads_in_the_web_shape():
    flat = flatten_provider_service(_service(duration="1.5 hours", inclusions=["Travel"], price="99.50"), sort_order=2,
                                    extras={"cancellation_policy": "24 hours"})
    assert flat == {
        "id": "s", "provider_id": "p", "title": "Gutter clean", "description": None, "pricing_type": "flat",
        "price": 99.5, "duration_minutes": 90, "inclusions": "Travel", "exclusions": None, "service_area": None,
        "category": "GENERAL", "cancellation_policy": "24 hours", "is_active": True, "sort_order": 2,
        "created_at": NOW, "updated_at": NOW,
    }


@pytest.mark.parametrize("status, live", [("active", True), ("draft", False), ("archived", False), ("published", False)])
def test_only_the_active_status_reads_as_live(status, live):
    # The status CHECK allows active, draft and archived; the web once wrote "published".
    assert SERVICE_LIVE_STATUS == "active"
    assert flatten_provider_service(_service(status=status))["is_active"] is live


@pytest.mark.parametrize("stored, code", [
    ("PLUMBING", "PLUMBING"), ("locks_security", "LOCKS_SECURITY"), ("GENERAL", "GENERAL"), ("Roofing", "GENERAL"),
    ("", "GENERAL"), (None, "GENERAL"),
])
def test_a_service_category_reads_as_a_shared_code(stored, code):
    assert flatten_provider_service(_service(category=stored))["category"] == code
    assert repair_category(stored) == code


@pytest.mark.parametrize("values, category", [
    (["tradie"], "tradie"), ("cleaner", "cleaner"), (["Real-Estate Agent"], "real_estate_agent"),
    (["CO_HOST_INSPECTOR"], "co_host_inspector"), (["GENERAL"], "other"), (["PLUMBING", "tradie"], "tradie"),
    (["GENERAL", "cleaner"], "cleaner"), (["PLUMBING"], "tradie"), (["GENERAL", "LEAK"], "tradie"),
    (["Roofing"], "Roofing"), ([], None), (None, None), ([None, " "], None), ({"a": 1}, None),
])
def test_provider_categories_read_as_web_codes(values, category):
    assert web_category(values) == category


def test_every_web_category_maps_to_shared_codes_with_general():
    # update_own_profile takes only these codes, and review_user_verification approves no worker without one.
    assert set(WEB_CATEGORY_CODES) == set(WEB_CATEGORIES)
    for codes in WEB_CATEGORY_CODES.values():
        assert "GENERAL" in codes and set(codes) <= set(REPAIR_CATEGORIES)
    assert set(category_codes("tradie")) == set(REPAIR_CATEGORIES)
    assert category_codes("cleaner") == ["GENERAL"] and category_codes(None) == []


@pytest.mark.parametrize("row, category", [
    ({"service_categories": ["GENERAL"], "metadata": {"category": "real_estate_agent"}}, "real_estate_agent"),
    ({"service_categories": ["GENERAL"], "metadata": {}}, "other"),
    ({"service_categories": ["cleaner"], "metadata": None}, "cleaner"),  # a row the web wrote before the codes
    ({"service_categories": None, "metadata": {"service_categories": ["tradie"]}}, "tradie"),
    ({"service_categories": ["PLUMBING"], "metadata": {"category": "not-a-category"}}, "tradie"),
    ({"service_categories": [], "metadata": {}}, None),
])
def test_a_providers_web_category_is_its_metadata_label_then_its_codes(row, category):
    assert provider_category(row) == category


class _Query:
    def __init__(self, error=None, data=None):
        self.error, self.data = error, data

    def execute(self):
        if self.error:
            raise self.error
        return self


@pytest.mark.parametrize("code, status", [("42501", 403), ("P0002", 404), ("23505", 409), ("22023", 422),
                                          ("23514", 422)])
def test_a_functions_refusal_keeps_its_message(code, status):
    with pytest.raises(HTTPException) as caught:
        run_function(_Query(APIError({"code": code, "message": "Add a price before making the service active."})))
    assert (caught.value.status_code, caught.value.detail) == (status, "Add a price before making the service active.")


def test_any_other_database_error_is_raised_as_it_is():
    with pytest.raises(APIError):
        run_function(_Query(APIError({"code": "57014", "message": "canceling statement due to statement timeout"})))
    assert run_function(_Query(data={"id": "s"})) == {"id": "s"}
    with pytest.raises(HTTPException) as caught:
        run_function(_Query(APIError({"code": "P0001", "message": "Invalid job status change."})), {"P0001": 409})
    assert caught.value.status_code == 409


@pytest.mark.parametrize("document_type, metadata, web_type", [
    ("GOVERNMENT_PHOTO_ID", None, "id"), ("PASSPORT", None, "id"), ("DRIVERS_LICENCE", {}, "id"),
    ("TRADE_LICENCE", None, "licence"), ("PUBLIC_LIABILITY_INSURANCE", None, "insurance"),
    ("POLICE_CHECK", None, "other"), ("OTHER", {"web_type": "abn"}, "abn"), ("OTHER", {"web_type": "id"}, "other"),
    ("OTHER", None, "other"),
])
def test_document_types_read_as_web_credential_types(document_type, metadata, web_type):
    row = {"id": "d", "user_id": "p", "document_type": document_type, "file_url": "", "metadata": metadata}
    assert flatten_profile_document(row)["type"] == web_type


@pytest.mark.parametrize("review_status, is_verified, status", [
    ("PENDING", False, "pending"), ("APPROVED", True, "verified"), ("REJECTED", False, "rejected"),
    ("PENDING", True, "verified"),  # verified before the review_status column existed
    ("REJECTED", True, "rejected"),
])
def test_review_states_read_as_web_statuses(review_status, is_verified, status):
    row = {"id": "d", "user_id": "p", "document_type": "OTHER", "file_url": "", "review_status": review_status,
           "is_verified": is_verified}
    assert flatten_profile_document(row)["status"] == status


def test_a_credential_reads_its_label_file_and_submission_time():
    row = {"id": "d", "user_id": "p", "document_type": "OTHER", "file_url": "", "metadata": {"label": "ABN"},
           "review_status": "PENDING", "verified_at": None, "submitted_at": "2026-02-01T00:00:00+00:00",
           "created_at": NOW}
    assert flatten_profile_document(row) == {
        "id": "d", "provider_id": "p", "type": "other", "label": "ABN", "document_url": None, "status": "pending",
        "rejection_reason": None, "verified_at": None, "created_at": "2026-02-01T00:00:00+00:00",
    }


@pytest.mark.parametrize("review_status, is_verified, reason", [
    ("REJECTED", False, "The photo is blurred."),
    # A new file is back in review: the reason was about the old one.
    ("PENDING", False, None),
    ("APPROVED", True, None),
])
def test_a_credential_gives_the_admins_reason_only_while_it_is_rejected(review_status, is_verified, reason):
    row = {"id": "d", "user_id": "p", "document_type": "PUBLIC_LIABILITY_INSURANCE", "file_url": "",
           "review_status": review_status, "is_verified": is_verified, "rejection_reason": "The photo is blurred."}
    assert flatten_profile_document(row)["rejection_reason"] == reason
