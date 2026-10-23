"""Notifications on the shared table the mobile app reads too (migration plan §3 a3).

The row's link is in link, its body is NOT NULL and its category is the
NotificationCategory enum (system, bid, social, project); the web's kinds are
stored as those and read back from the link.
"""

import logging

import pytest

from app.services import notifications
from tests.factories_messaging import person, uid

pytestmark = pytest.mark.usefixtures("strict_schema")

MEI = uid("mei")


@pytest.fixture
def mei(strict_schema, as_profile):
    strict_schema.seed("users", [person(MEI, "TENANT", "Mei Lin")])
    as_profile(id=MEI, role="tenant")
    return strict_schema


@pytest.mark.parametrize("kind, category", [
    ("message", "social"), ("review", "social"), ("booking", "project"), ("application", "project"),
    ("property", "system"), ("account", "system"), ("something new", "system"),
])
def test_each_web_kind_is_saved_as_a_shared_category(mei, kind, category):
    notifications.notify(MEI, kind, "Title", "Body", "/tenant/messages?thread=t")

    [row] = mei.tables["notifications"]
    assert (row["category"], row["title"], row["body"], row["link"], row["is_read"]) == (
        category, "Title", "Body", "/tenant/messages?thread=t", False
    )


def test_a_notice_without_a_body_or_link_is_saved_with_an_empty_body(mei):
    notifications.notify(MEI, "account", "Welcome")

    [row] = mei.tables["notifications"]
    assert (row["body"], row["link"]) == ("", None)


def test_long_titles_and_bodies_are_cut_to_size(mei):
    notifications.notify(MEI, "message", "T" * 500, "B" * 500)

    [row] = mei.tables["notifications"]
    assert (len(row["title"]), len(row["body"])) == (200, 280)


def test_a_failed_write_never_raises_and_is_logged_as_an_error(mei, caplog):
    with caplog.at_level(logging.ERROR, logger="app.services.notifications"):
        notifications.notify(uid("nobody"), "message", "New message", "Hello", "/tenant/messages")
        notifications.notify(None, "message", "Nobody to tell")

    assert not mei.tables.get("notifications")
    [record] = caplog.records
    assert record.levelno == logging.ERROR and "23503" in record.getMessage()


def test_the_bell_reads_each_notice_with_its_web_kind_and_link(client, mei):
    mei.seed("notifications", [
        {"id": uid("n-message"), "user_id": MEI, "title": "New message", "body": "Hi", "category": "social",
         "link": "/tenant/messages?thread=t", "created_at": "2026-01-01T05:00:00+00:00"},
        {"id": uid("n-review"), "user_id": MEI, "title": "Reply", "body": "Thanks", "category": "social",
         "link": "/providers/whitlock-property", "created_at": "2026-01-01T04:00:00+00:00"},
        {"id": uid("n-booking"), "user_id": MEI, "title": "Confirmed", "body": "", "category": "project",
         "link": "/tenant/bookings", "created_at": "2026-01-01T03:00:00+00:00"},
        {"id": uid("n-mobile"), "user_id": MEI, "title": "From the app", "body": "Bid received", "category": "bid",
         "link": None, "created_at": "2026-01-01T02:00:00+00:00"},
    ])

    response = client.get("/api/v1/me/notifications")

    assert response.status_code == 200, response.text
    assert [(n["category"], n["link_href"], n["body"]) for n in response.json()] == [
        ("message", "/tenant/messages?thread=t", "Hi"),
        ("review", "/providers/whitlock-property", "Thanks"),
        ("booking", "/tenant/bookings", None),
        ("system", None, "Bid received"),
    ]


def test_reading_notices_marks_them_read(client, mei):
    notifications.notify(MEI, "message", "One", "Hi", "/tenant/messages")
    notifications.notify(MEI, "booking", "Two", "Hi", "/tenant/bookings")
    first, second = mei.tables["notifications"]

    marked = client.patch(f"/api/v1/me/notifications/{first['id']}/read")
    assert marked.status_code == 200, marked.text
    assert (marked.json()["is_read"], marked.json()["category"]) == (True, "message")
    assert [n["id"] for n in client.get("/api/v1/me/notifications", params={"unread_only": True}).json()] == [
        second["id"]
    ]
    assert [n["category"] for n in client.post("/api/v1/me/notifications/read-all").json()] == ["booking"]
