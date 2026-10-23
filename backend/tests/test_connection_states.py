"""The Connect button's states (GET /me/connections/with/{id}) and the rules behind them (R24).

Tracker assumption #3: any active tenant, landlord or provider may ask any
other active member, never themselves or staff; a pair has one request at a
time; the receiver accepts or declines and the sender may withdraw; after a
decline only the person who declined may send again. Every state is checked
from both people's side.
"""

import pytest

from app.services import connections
from tests.factories_messaging import connection, person

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1/me/connections"
AMELIA = "a0000000-0000-4000-8000-000000000041"  # a provider
MEI = "c0000000-0000-4000-8000-000000000041"  # a tenant
JON = "c0000000-0000-4000-8000-000000000042"  # an agent, listed with landlords
ADMIN = "d0000000-0000-4000-8000-000000000041"
SUSPENDED = "d0000000-0000-4000-8000-000000000042"
CLOSED = "d0000000-0000-4000-8000-000000000043"
NOBODY = "d0000000-0000-4000-8000-0000000000ff"
WAITING = "d0000000-0000-4000-8000-000000000044"  # signed in, but not active yet
REQUEST = "e0000000-0000-4000-8000-000000000041"
OLDER = "e0000000-0000-4000-8000-000000000042"
ROLES = {AMELIA: "service_provider", MEI: "tenant", JON: "landlord", ADMIN: "admin"}


@pytest.fixture
def people(strict_schema):
    strict_schema.seed("users", [
        person(AMELIA, "SERVICE_PROVIDER", "Amelia Whitlock"),
        person(MEI, "TENANT", "Mei Lin"),
        person(JON, "AGENT", "Jon Doe"),
        person(ADMIN, "ADMIN", "Ada Admin"),
        {**person(SUSPENDED, "TENANT", "Sus Pended"), "status": "SUSPENDED"},
        {**person(CLOSED, "LANDLORD", "Cleo Closed"), "deleted_at": "2025-12-01T00:00:00+00:00"},
    ])
    return strict_schema


@pytest.fixture
def state(client, as_profile):
    """viewer's state with other, as their profile page reads it: (state, connection_id)."""
    def read(viewer: str, other: str) -> tuple:
        as_profile(id=viewer, role=ROLES[viewer])
        response = client.get(f"{API}/with/{other}")
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["user_id"] == other
        return body["state"], body["connection_id"]

    return read


def _stored(db) -> list[tuple]:
    return [(row["sender_user_id"], row["receiver_user_id"], row["status"])
            for row in db.tables.get("connection_requests", [])]


def test_signing_in_is_needed_to_read_a_state(client, people):
    assert client.get(f"{API}/with/{MEI}").status_code == 401


def test_nobody_is_offered_a_connection_with_themselves(people, state):
    assert state(AMELIA, AMELIA) == ("self", None)


@pytest.mark.parametrize("other", [ADMIN, SUSPENDED, CLOSED, NOBODY, "not-a-person"])
def test_staff_and_accounts_that_are_not_active_members_are_unavailable(people, state, other):
    assert state(AMELIA, other) == ("unavailable", None)


def test_a_staff_viewer_is_offered_no_connection(people, state):
    assert state(ADMIN, MEI) == ("unavailable", None)


@pytest.mark.parametrize("rows, amelia, mei", [
    ([], "none", "none"),
    ([connection(AMELIA, MEI, "PENDING", id=REQUEST)], "sent", "received"),
    ([connection(MEI, AMELIA, "PENDING", id=REQUEST)], "received", "sent"),
    ([connection(AMELIA, MEI, "ACCEPTED", id=REQUEST)], "connected", "connected"),
    # Mei declined Amelia's request: only Mei may send a new one.
    ([connection(AMELIA, MEI, "DECLINED", id=REQUEST)], "declined", "none"),
    ([connection(AMELIA, MEI, "BLOCKED", id=REQUEST)], "unavailable", "unavailable"),
    # Withdrawn in the mobile app: no connection at all.
    ([connection(AMELIA, MEI, "WITHDRAWN", id=REQUEST)], "none", "none"),
    # The newest request decides.
    ([connection(MEI, AMELIA, "PENDING", id=REQUEST, created_at="2025-12-31T10:00:00+00:00"),
      connection(AMELIA, MEI, "DECLINED", id=OLDER, created_at="2025-12-30T10:00:00+00:00")], "received", "sent"),
], ids=["nothing", "amelia-asked", "mei-asked", "accepted", "mei-declined", "blocked", "withdrawn", "newest"])
def test_both_people_see_the_state_their_request_gives_them(people, state, rows, amelia, mei):
    people.seed("connection_requests", rows)
    deciding = next((row["id"] for row in rows if row["status"] != "WITHDRAWN"), None)

    assert state(AMELIA, MEI) == (amelia, deciding)
    assert state(MEI, AMELIA) == (mei, deciding)


def test_two_pending_requests_that_both_stayed_are_decided_by_the_first(people, state):
    # The check after an insert is best effort: when a race leaves both, the first decides, as _won() keeps it.
    people.seed("connection_requests", [
        connection(MEI, AMELIA, "PENDING", id=REQUEST, created_at="2025-12-31T10:00:00+00:00"),
        connection(AMELIA, MEI, "PENDING", id=OLDER, created_at="2025-12-31T09:59:59+00:00"),
    ])

    assert state(AMELIA, MEI) == ("sent", OLDER)
    assert state(MEI, AMELIA) == ("received", OLDER)


def test_a_request_moves_through_every_state_for_both_people(client, people, as_profile, state):
    def act(viewer, method, path="", **body):
        as_profile(id=viewer, role=ROLES[viewer])
        return client.request(method, f"{API}{path}", json=body or None)

    def both() -> tuple:
        return state(AMELIA, MEI)[0], state(MEI, AMELIA)[0]

    sent = act(AMELIA, "POST", addressee_id=MEI)
    assert sent.status_code == 201, sent.text
    assert both() == ("sent", "received")

    assert act(AMELIA, "DELETE", f"/{sent.json()['id']}").status_code == 204  # Amelia withdraws it
    assert both() == ("none", "none")

    again = act(AMELIA, "POST", addressee_id=MEI)
    assert act(MEI, "PATCH", f"/{again.json()['id']}", status="declined").status_code == 200
    assert both() == ("declined", "none")
    assert act(AMELIA, "POST", addressee_id=MEI).status_code == 409  # the declined sender cannot ask again

    reply = act(MEI, "POST", addressee_id=AMELIA)  # the person who declined can
    assert reply.status_code == 201, reply.text
    assert reply.json()["id"] == again.json()["id"]
    assert both() == ("received", "sent")

    assert act(AMELIA, "PATCH", f"/{reply.json()['id']}", status="accepted").status_code == 200
    assert both() == ("connected", "connected")
    assert state(MEI, AMELIA)[1] == reply.json()["id"]
    assert _stored(people) == [(MEI, AMELIA, "ACCEPTED")]


def test_only_the_sender_can_withdraw_a_pending_request(client, people, as_profile, state):
    people.seed("connection_requests", [connection(AMELIA, MEI, "PENDING", id=REQUEST)])
    as_profile(id=MEI, role="tenant")

    response = client.delete(f"{API}/{REQUEST}")

    assert response.status_code == 403
    assert response.json()["detail"] == "Accept or decline this request: only its sender can withdraw it"
    assert state(MEI, AMELIA) == ("received", REQUEST)


def test_an_id_in_upper_case_names_the_same_person(client, people, as_profile):
    # Postgres compares uuids ignoring case, so only a normalised id is safe to compare.
    as_profile(id=AMELIA, role="service_provider")

    own = client.post(API, json={"addressee_id": AMELIA.upper()})
    own_state = client.get(f"{API}/with/{AMELIA.upper()}").json()
    other = client.post(API, json={"addressee_id": MEI.upper()})

    assert (own.status_code, own.json()["detail"]) == (400, "You cannot connect with yourself")
    assert (own_state["user_id"], own_state["state"]) == (AMELIA, "self")
    assert other.status_code == 201, other.text
    assert _stored(people) == [(AMELIA, MEI, "PENDING")]
    assert client.get(f"{API}/with/{MEI.upper()}").json()["state"] == "sent"


def test_staff_cannot_send_requests(client, people, as_profile):
    as_profile(id=ADMIN, role="admin")

    response = client.post(API, json={"addressee_id": MEI})

    assert (response.status_code, response.json()["detail"]) == (403, "Staff accounts cannot send connection requests")
    assert _stored(people) == []


def test_an_account_that_is_not_active_yet_cannot_ask_anyone(client, people, as_profile):
    # A PENDING_VERIFICATION account can sign in, but nobody can ask it either.
    people.seed("users", [{**person(WAITING, "TENANT", "Wai Ting"), "status": "PENDING_VERIFICATION"}])
    as_profile(id=WAITING, role="tenant")

    response = client.post(API, json={"addressee_id": MEI})
    offered = client.get(f"{API}/with/{MEI}").json()["state"]
    listed = {found["id"]: found["connection"]["state"] for found in client.get("/api/v1/profiles/search").json()}

    assert (response.status_code, response.json()["detail"]) == (403, "Only active members can send connection requests")
    assert _stored(people) == []
    assert offered == listed[MEI] == "unavailable"


@pytest.mark.parametrize("addressee", [ADMIN, SUSPENDED, CLOSED])
def test_staff_and_inactive_accounts_cannot_be_asked(client, people, as_profile, addressee):
    as_profile(id=AMELIA, role="service_provider")

    response = client.post(API, json={"addressee_id": addressee})

    assert (response.status_code, response.json()["detail"]) == (404, "Profile not found")
    assert _stored(people) == []


def test_an_agent_can_be_asked_as_a_landlord(client, people, as_profile, state):
    as_profile(id=AMELIA, role="service_provider")

    assert client.post(API, json={"addressee_id": JON}).status_code == 201
    assert state(JON, AMELIA)[0] == "received"


@pytest.fixture
def unseen_rival(monkeypatch):
    """The request check misses a request the other person sends at the same moment."""
    reads = []
    rows_between = connections._rows_between

    def first_read_misses(me, other):
        reads.append((me, other))
        return [] if len(reads) == 1 else rows_between(me, other)

    monkeypatch.setattr(connections, "_rows_between", first_read_misses)
    return reads


def test_of_two_requests_sent_at_once_the_first_stays(client, people, as_profile, unseen_rival):
    # Mei's request reached the table first (the fake's clock starts at 2026-01-01).
    people.seed("connection_requests", [
        connection(MEI, AMELIA, "PENDING", id=REQUEST, created_at="2025-12-31T23:59:59+00:00"),
    ])
    as_profile(id=AMELIA, role="service_provider")

    response = client.post(API, json={"addressee_id": MEI})

    assert (response.status_code, response.json()["detail"]) == (409, "A connection already exists with this member")
    assert _stored(people) == [(MEI, AMELIA, "PENDING")]
    assert len(unseen_rival) == 2  # checked again after the insert


def test_a_request_that_was_first_stays_when_a_later_one_lands(client, people, as_profile, unseen_rival):
    people.seed("connection_requests", [
        connection(MEI, AMELIA, "PENDING", id=REQUEST, created_at="2026-06-01T00:00:00+00:00"),
    ])
    as_profile(id=AMELIA, role="service_provider")

    response = client.post(API, json={"addressee_id": MEI})

    assert response.status_code == 201, response.text
    assert (AMELIA, MEI, "PENDING") in _stored(people)  # the later one removes itself on its own check


def test_the_profile_search_offers_each_person_their_state(client, people, as_profile):
    people.seed("connection_requests", [connection(AMELIA, MEI, "DECLINED", id=REQUEST)])

    def states(viewer):
        as_profile(id=viewer, role=ROLES[viewer])
        response = client.get("/api/v1/profiles/search")
        assert response.status_code == 200, response.text
        return {item["id"]: item["connection"]["state"] for item in response.json()}

    assert states(MEI)[AMELIA] == "none"  # Mei declined, so she may ask
    assert states(AMELIA)[MEI] == "declined"
    assert set(states(ADMIN).values()) == {"unavailable"}
