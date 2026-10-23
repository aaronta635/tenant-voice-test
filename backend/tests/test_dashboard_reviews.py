"""The overview's review figures count the reviews the Reviews page lists.

Regression cover: the overview counted only booking reviews (provider_id,
provider_reply), so a shared-schema review (reviewed_user_id, answered in
landlord_reply) never awaited a reply, and a reviews table without the
provider_id column answered 500. A booking review is a shared row too, about
the provider's users.id, which the booking links in web.bookings.review_id
(migration plan §3 c3).
"""

import pytest

from app.services import reviews as reviews_service
from tests.factories_bookings import booking, person, seed_provider, uid
from tests.factories_provider_core import review_row
from tests.fake_supabase import FakeTableQuery

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
SHARED_USER, CLIENT = uid("priya"), uid("jon")


def _shared_review(name, reply=None):
    return review_row(uid(name), SHARED_USER, CLIENT, 5, body="Spotless end-of-lease clean.", landlord_reply=reply)


def _booking_review(name, reply=None):
    """A booking's review as the shared table keeps it: titled with the service booked."""
    return review_row(uid(name), SHARED_USER, CLIENT, 4, title="Bond clean", body="On time.", landlord_reply=reply,
                      is_verified_interaction=True)


@pytest.fixture
def shared_provider(strict_schema, as_profile):
    seed_provider(strict_schema, SHARED_USER, "Shah Cleaning", "Priya Shah", slug="shah-cleaning")
    strict_schema.seed("users", [person(CLIENT, "Jonathan Hayes")])
    as_profile(id=SHARED_USER, role="service_provider")
    return strict_schema


def _link_bookings(db, *names):
    """Completed web.bookings rows whose review_id names each of these reviews."""
    db.seed("bookings", [booking(uid(f"job-{name}"), CLIENT, SHARED_USER, "completed", review_id=uid(name))
                         for name in names], schema="web")


def _awaiting(client) -> tuple[int, int]:
    """Awaiting reply on the overview, and on the Reviews page's list."""
    overview = client.get(f"{API}/me/dashboard/provider")
    assert overview.status_code == 200, overview.text
    listed = client.get(f"{API}/me/reviews").json()
    return overview.json()["awaiting_reply"], sum(1 for review in listed if not review["provider_reply"])


def test_a_shared_review_awaits_a_reply_until_its_landlord_reply_is_set(client, shared_provider):
    shared_provider.seed("reviews", [
        _shared_review("shared-open"),
        _shared_review("shared-answered", reply="Thank you!"),
        _booking_review("booking-open"),
        _booking_review("booking-answered", reply="Thanks!"),
    ])
    _link_bookings(shared_provider, "booking-open", "booking-answered")
    assert _awaiting(client) == (2, 2)


def test_replying_from_the_reviews_page_clears_it_on_the_overview(client, shared_provider):
    shared_provider.seed("reviews", [_shared_review("shared-open")])
    assert _awaiting(client) == (1, 1)
    reply = client.patch(f"{API}/reviews/{uid('shared-open')}/reply", json={"provider_reply": "Thanks, Jonathan!"})
    assert reply.status_code == 200, reply.text
    assert _awaiting(client) == (0, 0)


def _figures(client) -> tuple[tuple, tuple]:
    """(review_count, rating_avg, awaiting_reply) on the overview, and as the
    Reviews page works them out from the list it shows."""
    overview = client.get(f"{API}/me/dashboard/provider")
    assert overview.status_code == 200, overview.text
    stats = overview.json()
    listed = client.get(f"{API}/me/reviews").json()
    ratings = [review["rating"] for review in listed]
    page = (len(listed), round(sum(ratings) / len(ratings), 2) if ratings else 0,
            sum(1 for review in listed if not review["provider_reply"]))
    return (stats["review_count"], stats["rating_avg"], stats["awaiting_reply"]), page


def test_the_overview_rates_and_counts_a_shared_providers_booking_reviews(client, shared_provider):
    shared_provider.seed("reviews", [
        _shared_review("shared-answered", reply="Thank you!"),  # 5 stars
        _booking_review("booking-open-1"),  # 4 stars each
        _booking_review("booking-open-2"),
    ])
    _link_bookings(shared_provider, "booking-open-1", "booking-open-2")
    overview, page = _figures(client)
    assert overview == page == (3, 4.33, 2)


def test_reviews_moderators_took_down_count_nowhere(client, shared_provider):
    shared_provider.seed("reviews", [
        _shared_review("shown"),
        review_row(uid("hidden"), SHARED_USER, CLIENT, 1, status="HIDDEN"),
        review_row(uid("archived"), SHARED_USER, CLIENT, 1, status="ARCHIVED"),
    ])
    overview, page = _figures(client)
    assert overview == page == (1, 5.0, 1)


def test_the_overview_never_reads_the_reports(client, shared_provider, monkeypatch):
    """It shows no report state, so it skips the read of decisions on reports /me/reviews makes."""
    reads = []
    execute = FakeTableQuery.execute

    def counting(query):
        if query._name == reviews_service.DECISIONS_TABLE and query._op == "select":
            reads.append(query)
        return execute(query)

    monkeypatch.setattr(FakeTableQuery, "execute", counting)
    reported = {"reports": [{"userId": CLIENT, "reason": "spam", "reportedAt": "2026-01-02T00:00:00+00:00"}]}
    shared_provider.seed("reviews", [{**_shared_review("shared-open"), "media_urls": reported}])
    assert client.get(f"{API}/me/dashboard/provider").status_code == 200
    assert reads == []
    assert client.get(f"{API}/me/reviews").status_code == 200
    assert len(reads) == 1
