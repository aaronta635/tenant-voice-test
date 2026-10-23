"""The listing page's view beacon (tracker R28): one view per viewer, listing and Sydney day.

POST /properties/{id}/views counts at most one view a day for each viewer of
a listing anyone may open, keeping only a keyed hash of the viewer in
web.listing_views (supabase/shared/0005_listing_views.sql): no user id,
visitor id, IP address or user agent, and no audit entry naming who looked.
"""

import hashlib
import hmac
import re
from datetime import date

import pytest
from postgrest.exceptions import APIError

from app.core.config import settings
from app.core.deps import CurrentProfile, get_optional_profile
from app.core.supabase import get_supabase_client
from app.main import app
from app.services import listing_views
from tests.factories_identity import account
from tests.factories_rental import MANAGER, OWNER, STRANGER, TENANT, seed_listing, seed_people

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
VISITOR = "0f8e6c1a-5b2d-4c3e-9a7f-1d2e3f4a5b6c"
OTHER_VISITOR = "a1b2c3d4e5f6a7b8c9d0"
DAY = date(2026, 10, 23)
PROVIDER = "c6666666-6666-4666-8666-666666666666"
ADMIN = "c7777777-7777-4777-8777-777777777777"
MEMBER = "c8888888-8888-4888-8888-888888888888"


@pytest.fixture
def listing(strict_schema, monkeypatch):
    seed_people(strict_schema)
    monkeypatch.setattr(listing_views, "_today", lambda: DAY)
    return seed_listing(strict_schema, prop={"manager_user_id": MANAGER})[0]


def _views(db) -> list[dict]:
    return db.schema_tables.get("web", {}).get("listing_views", [])


def _salts(db) -> list[dict]:
    return db.schema_tables.get("web", {}).get("listing_view_salts", [])


def _as_viewer(id: str, role: str) -> None:
    profile = CurrentProfile(id=id, role=role, full_name="Viewer", raw={"id": id})
    app.dependency_overrides[get_optional_profile] = lambda: profile


def _view(client, listing_id, visitor=VISITOR, **kwargs):
    body = {} if visitor is None else {"visitor_id": visitor}
    return client.post(f"{API}/properties/{listing_id}/views", json=body, **kwargs)


def test_a_visitor_counts_once_a_day_on_each_listing(client, strict_schema, listing):
    second, _ = seed_listing(strict_schema)

    answers = [_view(client, listing).json(), _view(client, listing).json(), _view(client, second).json(),
               _view(client, listing, OTHER_VISITOR).json()]

    assert answers == [{"counted": True}, {"counted": False}, {"counted": True}, {"counted": True}]
    assert sorted((row["listing_id"], row["viewed_on"]) for row in _views(strict_schema)) == sorted(
        [(listing, "2026-10-23"), (listing, "2026-10-23"), (second, "2026-10-23")]
    )


def test_the_next_sydney_day_counts_again(client, strict_schema, listing, monkeypatch):
    assert _view(client, listing).json() == {"counted": True}
    monkeypatch.setattr(listing_views, "_today", lambda: date(2026, 10, 24))

    assert _view(client, listing).json() == {"counted": True}
    assert _view(client, listing).json() == {"counted": False}
    assert sorted(row["viewed_on"] for row in _views(strict_schema)) == ["2026-10-23", "2026-10-24"]


def test_a_member_counts_once_a_day_on_all_their_devices(client, strict_schema, listing):
    _as_viewer(TENANT, "tenant")

    phone, laptop = _view(client, listing, VISITOR), _view(client, listing, OTHER_VISITOR)

    assert (phone.json(), laptop.json()) == ({"counted": True}, {"counted": False})
    assert len(_views(strict_schema)) == 1


def test_a_row_keeps_only_a_hash_that_differs_by_listing_and_day(client, strict_schema, listing, monkeypatch):
    second, _ = seed_listing(strict_schema)
    _as_viewer(TENANT, "tenant")
    _view(client, listing)
    _view(client, second)
    monkeypatch.setattr(listing_views, "_today", lambda: date(2026, 10, 24))
    _view(client, listing)

    rows = _views(strict_schema)
    assert {tuple(sorted(row)) for row in rows} == {("id", "listing_id", "viewed_on", "visitor_hash")}
    hashes = [row["visitor_hash"] for row in rows]
    assert all(re.fullmatch(r"[0-9a-f]{64}", value) for value in hashes)
    assert len(set(hashes)) == 3  # nothing links the same member's views across listings or days
    stored = repr(rows)
    assert TENANT not in stored and VISITOR not in stored


def test_once_a_day_is_over_nothing_can_recompute_its_hashes(client, strict_schema, listing, monkeypatch):
    _as_viewer(TENANT, "tenant")
    _view(client, listing)
    [salt] = _salts(strict_schema)
    [row] = _views(strict_schema)
    assert salt["viewed_on"] == "2026-10-23" and re.fullmatch(r"[0-9a-f]{64}", salt["salt"])
    assert row["visitor_hash"] == listing_views.visitor_hash(salt["salt"], listing, DAY, f"member:{TENANT}")

    monkeypatch.setattr(listing_views, "_today", lambda: date(2026, 10, 24))
    _view(client, listing)

    # The 23rd's salt is gone, and no key the server keeps (the service-role key included) makes its hash.
    assert [item["viewed_on"] for item in _salts(strict_schema)] == ["2026-10-24"]
    derived = hmac.new(settings.supabase_service_role_key.encode(), b"tenantvoice/listing-views/v1", hashlib.sha256).digest()
    for key in (derived, settings.supabase_service_role_key.encode(), bytes.fromhex(_salts(strict_schema)[0]["salt"])):
        assert hmac.new(key, f"{listing}|2026-10-23|member:{TENANT}".encode(), hashlib.sha256).hexdigest() != row["visitor_hash"]


@pytest.mark.parametrize(("viewer", "role"), [(TENANT, "tenant"), (STRANGER, "landlord"), (PROVIDER, "service_provider")])
def test_members_of_every_role_count(client, strict_schema, listing, viewer, role):
    _as_viewer(viewer, role)

    assert _view(client, listing).json() == {"counted": True}


@pytest.mark.parametrize(("viewer", "role"), [(OWNER, "landlord"), (MANAGER, "landlord"), (ADMIN, "admin"), (ADMIN, "officer")])
def test_the_owner_the_manager_and_staff_do_not_count(client, strict_schema, listing, viewer, role):
    _as_viewer(viewer, role)

    assert _view(client, listing).json() == {"counted": False}
    assert _views(strict_schema) == []


@pytest.mark.parametrize("status", ["DRAFT", "PAUSED", "LEASED", "ARCHIVED"])
def test_a_listing_nobody_may_open_counts_nothing(client, strict_schema, listing, status):
    hidden, _ = seed_listing(strict_schema, status=status)

    assert _view(client, hidden).status_code == 404
    assert _view(client, "not-a-listing").status_code == 404
    assert _view(client, "c9999999-9999-4999-8999-999999999999").status_code == 404
    assert _views(strict_schema) == []


def test_closed_to_applications_still_counts(client, strict_schema, listing):
    closed, _ = seed_listing(strict_schema, status="APPLICATIONS_CLOSED")

    assert _view(client, closed).json() == {"counted": True}


@pytest.mark.parametrize("visitor", [None, "short", "has spaces in it ok", "x" * 65, "semi;colon-0123456789"])
def test_a_signed_out_view_needs_a_well_formed_visitor_id(client, strict_schema, listing, visitor):
    assert _view(client, listing, visitor).status_code == 422
    assert _views(strict_schema) == []


def test_a_refused_token_counts_nothing_until_the_session_is_refreshed(client, strict_schema, listing):
    response = _view(client, listing, headers={"Authorization": "Bearer expired-token"})

    assert (response.status_code, response.json()) == (200, {"counted": False})
    assert response.headers.get("X-Session-Expired") == "1"
    assert _views(strict_schema) == []


def test_a_signed_in_view_leaves_no_audit_entry(client, strict_schema, listing):
    # A real sign-in, so the request names its actor as the audit trail reads it.
    token = account(strict_schema, MEMBER, "mia@example.test", "TENANT")
    signed_in = {"Authorization": f"Bearer {token}"}

    assert _view(client, listing, headers=signed_in).json() == {"counted": True}
    # Another request by the same member is audited, so the trail is on.
    assert client.put(f"{API}/properties/{listing}/like", headers=signed_in).status_code == 200

    actions = [row["action"] for row in strict_schema.schema_tables["web"].get("audit_log", [])]
    assert actions == [f"put:{API}/properties/{listing}/like"]


def test_the_counts_read_back_by_listing_and_day(client, strict_schema, listing, monkeypatch):
    second, _ = seed_listing(strict_schema)
    for day, visitor in ((date(2026, 10, 20), VISITOR), (date(2026, 10, 22), VISITOR), (date(2026, 10, 22), OTHER_VISITOR)):
        monkeypatch.setattr(listing_views, "_today", lambda day=day: day)
        _view(client, listing, visitor)
    _view(client, second)

    counts = listing_views.daily_counts([listing, second], since=date(2026, 10, 21))

    assert {key: dict(value) for key, value in counts.items()} == {
        listing: {"2026-10-22": 2},
        second: {"2026-10-22": 1},
    }
    assert (listing_views.total(listing), listing_views.total(second)) == (3, 1)
    assert listing_views.daily_counts([], since=DAY) == {}


def test_one_address_counts_a_limited_number_of_signed_out_views(client, strict_schema, listing, monkeypatch):
    monkeypatch.setattr(listing_views, "VISITOR_VIEWS_PER_WINDOW", 2)
    second, _ = seed_listing(strict_schema)
    third, _ = seed_listing(strict_schema)

    # A script with a fresh visitor id each time, from one address.
    answers = [_view(client, home, f"script-visitor-{index:06d}").json() for index, home in
               enumerate((listing, second, third))]

    assert answers == [{"counted": True}, {"counted": True}, {"counted": False}]
    assert len(_views(strict_schema)) == 2
    # The database keeps a keyed hash of the address, never the address.
    [limit] = strict_schema.tables["api_rate_limits"]
    assert re.fullmatch(r"[0-9a-f]{64}", limit["key_hash"]) and limit["request_count"] == 3
    # A member counts once a day per listing whatever the address did.
    _as_viewer(TENANT, "tenant")
    assert _view(client, third).json() == {"counted": True}


def test_many_views_are_counted_by_the_database_a_day_at_a_time(client, strict_schema, listing, monkeypatch):
    for day, visitor in ((date(2026, 10, 21), VISITOR), (date(2026, 10, 22), VISITOR), (date(2026, 10, 22), OTHER_VISITOR)):
        monkeypatch.setattr(listing_views, "_today", lambda day=day: day)
        _view(client, listing, visitor)
    monkeypatch.setattr(listing_views, "ROW_READ_LIMIT", 2)

    def no_rows(*_args, **_kwargs):
        raise AssertionError("views read row by row")

    monkeypatch.setattr(listing_views, "select_in", no_rows)

    counts = listing_views.daily_counts([listing], since=date(2026, 10, 20), until=date(2026, 10, 22))

    assert dict(counts[listing]) == {"2026-10-21": 1, "2026-10-22": 2}
    assert listing_views.period_counts([listing], since=date(2026, 10, 22)) == {listing: 2}


@pytest.mark.parametrize(("limit", "window"), [(0, 600), (5, 0)])
def test_the_rate_limit_function_refuses_a_limit_or_window_below_one(strict_schema, limit, window):
    request = get_supabase_client().rpc("consume_api_rate_limit", {"p_key_hash": "k", "p_limit": limit, "p_window_seconds": window})

    with pytest.raises(APIError) as refused:
        request.execute()
    assert (refused.value.code, refused.value.message) == ("22023", "Invalid rate limit configuration")
    assert strict_schema.tables.get("api_rate_limits", []) == []


def test_the_rate_limit_function_counts_per_key_and_window(strict_schema):
    def consume(key):
        return get_supabase_client().rpc("consume_api_rate_limit", {
            "p_key_hash": key, "p_limit": 2, "p_window_seconds": 3600}).execute().data

    assert [consume("a"), consume("a"), consume("b"), consume("a")] == [True, True, True, False]
    assert sorted((row["key_hash"], row["request_count"]) for row in strict_schema.tables["api_rate_limits"]) == [
        ("a", 3), ("b", 1)]


def test_before_the_views_table_exists_a_view_is_not_counted_and_nothing_fails(client, strict_schema, listing, monkeypatch):
    def missing(name):
        raise APIError({"code": "PGRST205", "message": f"Could not find the table 'web.{name}' in the schema cache"})

    monkeypatch.setattr(listing_views, "web_table", missing)

    assert _view(client, listing).json() == {"counted": False}
