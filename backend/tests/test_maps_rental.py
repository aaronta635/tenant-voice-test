"""The rental mappings: status filters, property types, lease terms, photos and repairs."""

import pytest

from app.db import schema
from app.services import maps_rental, shared_map


# -- listings -----------------------------------------------------------------------
def test_listing_filters_cover_each_shared_status_but_archived_once():
    # Deleting on the web archives a listing, so the web never lists ARCHIVED.
    covered = [status for statuses in maps_rental.LISTING_STATUS_FILTER.values() for status in statuses]
    assert sorted(covered) == sorted(set(schema.enum_values("listings", "status")) - {"ARCHIVED"})
    for web, statuses in maps_rental.LISTING_STATUS_FILTER.items():
        assert {shared_map.web_listing_status(status) for status in statuses} == {web}
    assert sorted(maps_rental.OWNER_LISTING_STATUSES) == sorted(covered)


def test_an_unknown_listing_status_is_an_error_not_a_default():
    # It used to become PUBLISHED.
    with pytest.raises(ValueError):
        maps_rental.listing_statuses("sold")
    with pytest.raises(ValueError):
        shared_map.db_listing_status("sold")
    assert (shared_map.db_listing_status(None), shared_map.db_listing_status("off_market")) == ("PUBLISHED", "PAUSED")


@pytest.mark.parametrize(
    ("typed", "stored"),
    [("Apartment", "APARTMENT"), (" HOUSE ", "HOUSE"), ("unit", "UNIT"), ("Flat", "OTHER"),
     ("Granny flat", "OTHER"), ("OTHER", "OTHER"), ("", "OTHER"), (None, "OTHER")],
)
def test_any_free_text_type_is_written_as_a_shared_label(typed, stored):
    assert shared_map.db_property_type(typed) == stored
    assert stored in schema.enum_values("properties", "property_type")


def test_a_type_search_names_a_shared_type_or_none():
    assert (maps_rental.property_type_filter("Studio"), maps_rental.property_type_filter("other")) == ("STUDIO", "OTHER")
    assert maps_rental.property_type_filter("flat") is None


@pytest.mark.parametrize(
    ("text", "months"),
    [("12 months", 12), ("12", 12), ("6-month lease", 6), ("1 year", 12), ("1.5 years", 18), ("2 yrs", 24),
     ("18mo", 18), (None, None), ("  ", None)],
)
def test_a_lease_term_becomes_whole_months(text, months):
    assert maps_rental.lease_term_months(text) == months


@pytest.mark.parametrize("text", ["Flexible", "6 weeks", "0 months", "121 months", "1.5 months", "11 years"])
def test_a_lease_term_without_whole_months_is_an_error(text):
    with pytest.raises(ValueError):
        maps_rental.lease_term_months(text)


def test_a_photo_shows_its_public_link():
    photo_url, is_photo = maps_rental.photo_url, maps_rental.is_photo
    assert photo_url({"media_url": "https://cdn.example.test/a.jpg"}) == "https://cdn.example.test/a.jpg"
    keyed = {"media_url": "a.jpg", "storage_bucket": "property-images", "storage_path": "mobile/a.jpg"}
    assert photo_url(keyed) == "http://supabase.invalid/storage/v1/object/public/property-images/mobile/a.jpg"
    assert photo_url({"media_url": "a.jpg", "storage_bucket": "review-photos", "storage_path": "x/a.jpg"}) == "a.jpg"
    assert (is_photo({"media_type": "image"}), is_photo({"media_type": "image/webp"}), is_photo({})) == (True, True, True)
    assert is_photo({"media_type": "VIDEO"}) is False


# -- applications --------------------------------------------------------------------
def test_application_filters_cover_each_shared_status_once():
    covered = [status for statuses in maps_rental.APPLICATION_STATUS_FILTER.values() for status in statuses]
    assert sorted(covered) == sorted(schema.enum_values("rental_applications", "status"))
    for web, statuses in maps_rental.APPLICATION_STATUS_FILTER.items():
        assert {shared_map.web_application_status(status) for status in statuses} == {web}


def test_an_unknown_application_status_is_an_error_not_a_default():
    # It used to become SUBMITTED.
    with pytest.raises(ValueError):
        maps_rental.application_statuses("pending")
    with pytest.raises(ValueError):
        shared_map.db_application_status("pending")
    assert (shared_map.db_application_status(None), shared_map.db_application_status("declined")) == (
        "SUBMITTED", "REJECTED",
    )


# -- repairs -------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("status", "open_"),
    [("OPEN", True), ("open", True), (None, True), ("ASSIGNED", True), ("SCHEDULED", True), ("IN_PROGRESS", True),
     ("AWAITING_PARTS", True), ("COMPLETED", False), ("RESOLVED", False), ("resolved", False), ("CLOSED", False),
     ("CANCELLED", False)],
)
def test_a_repair_is_open_until_it_is_finished_closed_or_cancelled(status, open_):
    assert maps_rental.repair_is_open(status) is open_


# -- the shared database's rules -------------------------------------------------------
# enforce_listing_status_transition, as output/shared-catalog/functions holds it.
TRIGGER_MOVES = {
    ("DRAFT", "PUBLISHED"), ("DRAFT", "ARCHIVED"),
    ("PUBLISHED", "PAUSED"), ("PUBLISHED", "APPLICATIONS_CLOSED"), ("PUBLISHED", "LEASED"), ("PUBLISHED", "ARCHIVED"),
    ("PAUSED", "PUBLISHED"), ("PAUSED", "APPLICATIONS_CLOSED"), ("PAUSED", "ARCHIVED"),
    ("APPLICATIONS_CLOSED", "PUBLISHED"), ("APPLICATIONS_CLOSED", "LEASED"), ("APPLICATIONS_CLOSED", "ARCHIVED"),
    ("LEASED", "ARCHIVED"),
}


def test_the_web_allows_exactly_the_triggers_listing_moves_but_leasing_by_hand():
    statuses = schema.enum_values("listings", "status")
    allowed = {(old, new) for old in statuses for new in statuses
               if old != new and maps_rental.listing_move_refusal(old, new) is None}

    # An archived listing moves nowhere, and only an approval leases one.
    assert allowed == {move for move in TRIGGER_MOVES if move[1] != "LEASED"}
    assert maps_rental.listing_move_refusal("PUBLISHED", "LEASED") == maps_rental.LEASED_BY_APPROVAL
    assert maps_rental.listing_move_refusal("PAUSED", "PAUSED") is None


@pytest.mark.parametrize(
    ("current", "wanted", "listing", "refused"),
    [
        ("SUBMITTED", "APPROVED", "PUBLISHED", False),
        ("SHORTLISTED", "UNDER_REVIEW", "APPLICATIONS_CLOSED", False),
        ("UNDER_REVIEW", "REJECTED", "PAUSED", False),
        ("SUBMITTED", "APPROVED", "PAUSED", True),
        ("SUBMITTED", "APPROVED", "LEASED", True),
        ("UNDER_REVIEW", "SUBMITTED", "PUBLISHED", True),
        ("APPROVED", "REJECTED", "LEASED", True),
        ("REJECTED", "APPROVED", "PUBLISHED", True),
        ("WITHDRAWN", "SHORTLISTED", "PUBLISHED", True),
        ("EXPIRED", "REJECTED", "PUBLISHED", True),
    ],
)
def test_an_owner_decides_only_what_review_rental_application_and_the_trigger_allow(current, wanted, listing,
                                                                                      refused):
    assert (maps_rental.decision_refusal(current, wanted, listing) is not None) is refused


@pytest.mark.parametrize(
    ("code", "status"),
    [("42501", 403), ("P0002", 404), ("23505", 409), ("22023", 422), ("23514", 422), ("23503", 409)],
)
def test_a_functions_error_keeps_its_message_with_the_matching_status(code, status):
    from postgrest.exceptions import APIError

    mapped = maps_rental.function_error(APIError({"code": code, "message": "Listing is not open for applications"}))

    assert mapped.status_code == status
    if code != "23503":
        assert mapped.detail == "Listing is not open for applications"


def test_any_other_error_is_left_to_the_apps_handler():
    from postgrest.exceptions import APIError

    error = APIError({"code": "57014", "message": "canceling statement due to statement timeout"})

    assert maps_rental.function_error(error) is None
    with pytest.raises(APIError):
        with maps_rental.function_errors():
            raise error


@pytest.mark.parametrize(
    ("text", "read"),
    [("2026-11-01", "2026-11-01"), ("1/2/2027", "2027-02-01"), (" 2026-3-9 ", "2026-03-09"), ("2026-02-30", None),
     ("next week", None), (None, None), (20261101, None)],
)
def test_a_mobile_date_reads_as_mobile_parse_date_reads_it(text, read):
    parsed = maps_rental.mobile_date(text)

    assert (parsed.isoformat() if parsed else None) == read


def test_a_lease_term_reads_as_the_mobile_writes_its_lease_duration():
    assert [maps_rental.lease_duration(months) for months in (12, 1, None, 0)] == ["12 months", "1 month", None, None]
