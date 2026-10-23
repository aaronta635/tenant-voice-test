"""The booking mappers (app.services.maps_bookings): pure reshaping, no database."""

import pytest

from app.services import maps_bookings as maps
from app.services.maps_messaging import marketplace_metadata, rental_metadata
from tests.factories_bookings import uid

CLIENT, PROVIDER, OTHER = uid("client"), uid("provider"), uid("other")
BOOKING, SECOND = uid("booking"), uid("second-booking")


@pytest.mark.parametrize("service, price", [
    ({"price": 99.0}, 99.0), ({"price": 0}, None), ({"price": 0.0}, None), ({}, None), (None, None),
])
def test_a_service_nobody_priced_gives_a_booking_no_price(service, price):
    assert maps.booking_price(service) == price


def test_a_new_booking_keeps_the_filled_form_fields_both_parties_and_the_price():
    form = {"provider_id": "a-slug", "service_id": uid("service"), "property_address": None,
            "property_suburb": "Newtown", "scheduled_date": "2030-01-16", "scheduled_time": "10:00:00",
            "notes": "Gate code 1234", "unknown": "never a column"}

    assert maps.new_booking(CLIENT, PROVIDER, form, 99.0) == {
        "service_id": uid("service"), "property_suburb": "Newtown", "scheduled_date": "2030-01-16",
        "scheduled_time": "10:00:00", "notes": "Gate code 1234", "client_id": CLIENT, "provider_id": PROVIDER,
        "price": 99.0,
    }
    assert "price" not in maps.new_booking(CLIENT, PROVIDER, {}, None)


@pytest.mark.parametrize("service, minutes", [
    ({"duration_minutes": 90}, 90), ({"duration_minutes": None}, 60), (None, 60),
])
def test_a_service_without_a_duration_takes_an_hour(service, minutes):
    assert maps.service_minutes(service) == minutes


def _thread(id, members, metadata=None, created_at="2026-01-01T00:00:00+00:00"):
    return {"id": id, "metadata": metadata, "created_at": created_at,
            "conversation_participants": [{"user_id": member} for member in members]}


def test_a_booking_takes_its_linked_thread_else_the_oldest_opened_for_it():
    linked = {"id": BOOKING, "client_id": CLIENT, "provider_id": PROVIDER, "conversation_id": uid("linked")}
    unlinked = {"id": SECOND, "client_id": CLIENT, "provider_id": PROVIDER, "conversation_id": None}
    threads = [
        _thread(uid("newer"), [CLIENT, PROVIDER], marketplace_metadata(CLIENT, PROVIDER, SECOND), "2026-02-01"),
        _thread(uid("older"), [CLIENT, PROVIDER], marketplace_metadata(CLIENT, PROVIDER, SECOND), "2026-01-01"),
        _thread(uid("for-linked"), [CLIENT, PROVIDER], marketplace_metadata(CLIENT, PROVIDER, BOOKING)),
    ]

    assert maps.booking_threads([linked, unlinked], threads) == {BOOKING: uid("linked"), SECOND: uid("older")}


@pytest.mark.parametrize("thread", [
    _thread(uid("other-provider"), [CLIENT, OTHER], marketplace_metadata(CLIENT, OTHER, BOOKING)),
    _thread(uid("provider-left"), [CLIENT], marketplace_metadata(CLIENT, PROVIDER, BOOKING)),
    _thread(uid("general"), [CLIENT, PROVIDER], marketplace_metadata(CLIENT, PROVIDER, None)),
    _thread(uid("rental"), [CLIENT, PROVIDER], {**rental_metadata(CLIENT, PROVIDER), "booking_id": BOOKING}),
    _thread(uid("app"), [CLIENT, PROVIDER]),
], ids=["another provider's", "a party left", "the pair's general thread", "a rental thread", "an app thread"])
def test_only_a_thread_opened_for_the_booking_between_its_own_parties_counts(thread):
    unlinked = {"id": BOOKING, "client_id": CLIENT, "provider_id": PROVIDER, "conversation_id": None}
    assert maps.booking_threads([unlinked], [thread]) == {}


def test_a_review_moderators_took_down_shows_no_stars():
    reviews = [
        {"id": "published", "rating": 4, "landlord_rating": 4, "status": "PUBLISHED"},
        {"id": "flagged", "rating": 2, "landlord_rating": 2, "status": "FLAGGED"},
        {"id": "hidden", "rating": 1, "landlord_rating": 1, "status": "HIDDEN"},
        {"id": "archived", "rating": 5, "landlord_rating": 5, "status": "ARCHIVED"},
        {"id": "landlord-only", "rating": 0, "landlord_rating": 3, "status": "PUBLISHED"},
    ]
    assert maps.review_ratings(reviews) == {"published": 4, "flagged": 2, "landlord-only": 3}


def test_a_booking_review_is_a_verified_published_review_of_the_provider():
    job = {"id": BOOKING, "client_id": CLIENT, "provider_id": PROVIDER}

    assert maps.booking_review(job, 4, "On time.", "Bond clean") == {
        "reviewer_user_id": CLIENT, "reviewed_user_id": PROVIDER, "property_id": None, "rating": 4,
        "landlord_rating": 4, "title": "Bond clean", "body": "On time.", "is_verified_interaction": True,
        "status": "PUBLISHED",
    }


def test_labels_skip_what_is_missing():
    assert maps.payment_label("Bond clean", "Newtown") == "Payment · Bond clean · Newtown"
    assert maps.payment_label(None, None) == "Payment"
    assert maps.place({"location": "Glebe", "state": "NSW"}) == "Glebe, NSW"
    assert maps.place({"state": "NSW"}) == "NSW"
    assert maps.place({}) is None
