"""A client's review of a completed booking is a shared reviews row (migration plan §3 c3).

Regression cover: a booking review was inserted with booking_id, provider_id,
client_id and comment, columns the shared reviews table lacks (PGRST204,
500), after a duplicate check on reviews.booking_id (42703). It is now a
review of the provider's users.id like any other, linked from
web.bookings.review_id, which also allows one review per booking.
"""

import pytest
from postgrest.exceptions import APIError

from app.services import bookings
from tests.factories_bookings import booking, person, rows, seed_provider, service, uid, web_rows
from tests.factories_provider_core import review_row

pytestmark = pytest.mark.usefixtures("strict_schema")

AMELIA, JON, MEI = uid("amelia"), uid("jon"), uid("mei")
APPRAISAL, JOB, OPEN_JOB, PLAIN_JOB = uid("appraisal"), uid("job"), uid("open-job"), uid("plain-job")
API = "/api/v1"


@pytest.fixture
def finished_job(strict_schema, as_profile):
    seed_provider(strict_schema, AMELIA, "Whitlock Property", "Amelia Whitlock", slug="whitlock-property")
    strict_schema.seed("users", [person(JON, "Jonathan Hayes", location="Newtown"), person(MEI, "Mei Lin")])
    strict_schema.seed("mobile_provider_services", [service(APPRAISAL, AMELIA, "Rental appraisal", price=99)])
    strict_schema.seed("bookings", [
        booking(JOB, JON, AMELIA, "completed", service_id=APPRAISAL, price=99),
        booking(OPEN_JOB, JON, AMELIA, "confirmed", service_id=APPRAISAL, price=99),
        booking(PLAIN_JOB, JON, AMELIA, "completed"),
    ], schema="web")
    as_profile(JON, "landlord")
    return strict_schema


def _review(client, booking_id=JOB, **payload):
    return client.post(f"{API}/reviews", json={"booking_id": booking_id, "rating": 5, "comment": "Great", **payload})


def test_a_client_reviews_their_completed_booking(client, finished_job):
    response = _review(client)

    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["booking_id"], body["provider_id"], body["client_id"], body["client_name"]) == (
        JOB, AMELIA, JON, "Jonathan Hayes",
    )
    assert (body["rating"], body["comment"], body["service_title"], body["is_flagged"]) == (5, "Great", "Rental appraisal", False)
    [stored] = rows(finished_job, "reviews")
    assert stored["id"] == body["id"] and stored["updated_at"]
    assert (stored["reviewer_user_id"], stored["reviewed_user_id"], stored["property_id"]) == (JON, AMELIA, None)
    assert (stored["rating"], stored["landlord_rating"], stored["title"], stored["body"]) == (5, 5, "Rental appraisal", "Great")
    assert (stored["is_verified_interaction"], stored["status"]) == (True, "PUBLISHED")
    assert web_rows(finished_job, "bookings", id=JOB)[0]["review_id"] == body["id"]
    [notice] = rows(finished_job, "notifications", user_id=AMELIA)
    assert (notice["title"], notice["body"], notice["link"], notice["category"]) == (
        "New 5-star review from Jonathan Hayes", "Great", "/dashboard/reviews", "social",
    )


def test_the_review_shows_wherever_the_provider_and_the_booking_are(client, finished_job, as_profile):
    review_id = _review(client, rating=4).json()["id"]

    assert {b["id"]: b["review_rating"] for b in client.get(f"{API}/bookings").json()}[JOB] == 4
    public = client.get(f"{API}/providers/whitlock-property/reviews").json()
    # Anyone reads it: the client is named by role alone, after a booking a verified one.
    assert [(r["id"], r["service_title"], r["client_name"], r["location"]) for r in public] == [
        (review_id, "Rental appraisal", "Verified tenant", None),
    ]

    as_profile(AMELIA, "service_provider")
    assert [r["id"] for r in client.get(f"{API}/me/reviews").json()] == [review_id]
    overview = client.get(f"{API}/me/dashboard/provider").json()
    assert (overview["review_count"], overview["rating_avg"], overview["awaiting_reply"]) == (1, 4.0, 1)
    assert client.patch(f"{API}/reviews/{review_id}/reply", json={"provider_reply": "Thanks!"}).status_code == 200
    assert client.get(f"{API}/me/dashboard/provider").json()["awaiting_reply"] == 0


def test_a_booking_takes_one_review(client, finished_job):
    assert _review(client).status_code == 201
    again = _review(client, rating=1)
    assert (again.status_code, again.json()["detail"]) == (409, "This booking has already been reviewed")
    assert len(rows(finished_job, "reviews")) == 1


@pytest.mark.parametrize("user, booking_id, status, detail", [
    (MEI, JOB, 403, "You can only review your own bookings"),
    (JON, OPEN_JOB, 400, "You can only review a completed booking"),
    (JON, uid("no-such-booking"), 404, "Booking not found"),
    (JON, "not-a-booking", 404, "Booking not found"),
    (JON, None, 400, "A property or booking is required to submit a review"),
], ids=["someone else's", "not finished", "unknown", "not a uuid", "nothing named"])
def test_only_the_client_reviews_a_finished_booking(client, finished_job, as_profile, user, booking_id, status, detail):
    as_profile(user, "tenant")
    response = _review(client, booking_id)
    assert (response.status_code, response.json()["detail"]) == (status, detail)
    assert not rows(finished_job, "reviews") and not rows(finished_job, "notifications")


def test_a_booking_without_a_service_is_reviewed_without_a_title(client, finished_job):
    response = _review(client, PLAIN_JOB, comment=None)
    assert response.status_code == 201, response.text
    [stored] = rows(finished_job, "reviews")
    assert (stored["title"], stored["body"]) == (None, None)
    assert response.json()["service_title"] is None


def test_a_review_without_a_comment_shows_no_text(client, finished_job, as_profile):
    # The service booked is the row's title: it names the job, the client never wrote it.
    response = _review(client, comment=None)

    assert response.status_code == 201, response.text
    assert (response.json()["comment"], response.json()["service_title"]) == (None, "Rental appraisal")
    public = client.get(f"{API}/providers/whitlock-property/reviews").json()
    as_profile(AMELIA, "service_provider")
    mine = client.get(f"{API}/me/reviews").json()
    assert [(r["comment"], r["service_title"]) for r in public + mine] == [(None, "Rental appraisal")] * 2


def test_a_review_sent_while_another_was_saved_is_taken_back(client, finished_job, monkeypatch):
    earlier = uid("earlier-review")
    finished_job.seed("reviews", [review_row(earlier, AMELIA, JON, 3)])
    attach = bookings.attach_review

    def other_request_links_first(booking_id, review_id):
        # Both requests found the booking unreviewed; the other one links its review first.
        assert attach(booking_id, earlier)
        return attach(booking_id, review_id)

    monkeypatch.setattr(bookings, "attach_review", other_request_links_first)
    response = _review(client)

    assert (response.status_code, response.json()["detail"]) == (409, "This booking has already been reviewed")
    assert [row["id"] for row in rows(finished_job, "reviews")] == [earlier]
    assert web_rows(finished_job, "bookings", id=JOB)[0]["review_id"] == earlier
    assert not rows(finished_job, "notifications")


def test_a_review_whose_link_fails_is_taken_back(client, finished_job, monkeypatch):
    def timing_out(booking_id, review_id):
        raise APIError({"code": "57014", "message": "canceling statement due to statement timeout"})

    monkeypatch.setattr(bookings, "attach_review", timing_out)
    response = _review(client)

    assert response.status_code == 500
    assert not rows(finished_job, "reviews")
    assert web_rows(finished_job, "bookings", id=JOB)[0]["review_id"] is None


def test_a_review_moderators_took_down_shows_no_stars_on_the_booking(client, finished_job):
    review_id = _review(client).json()["id"]
    next(row for row in rows(finished_job, "reviews") if row["id"] == review_id)["status"] = "HIDDEN"

    assert {b["id"]: b["review_rating"] for b in client.get(f"{API}/bookings").json()}[JOB] is None
    assert _review(client).status_code == 409
