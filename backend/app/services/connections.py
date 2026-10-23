"""The Network page's connections, on the shared connection_requests table (migration plan §3 a5).

A request goes from sender_user_id to receiver_user_id with an upper-case
ConnectionStatus; ConnectionOut keeps the web's requester / addressee and
lower-case status (maps_messaging.flatten_connection). The mobile app writes
the same rows: BLOCKED reads as declined, and WITHDRAWN (a request its sender
took back there) is no connection, so it is never listed and never blocks a
new request.

Who may ask whom follows tracker assumption #3. An active tenant, landlord or
provider may ask any other active member, never themselves and never a staff
account. A pair has one request at a time, in either direction: the receiver
accepts or declines it, and the sender may withdraw it. After a decline only
the person who declined may send a new request. state_with() gives a profile
page's Connect button the viewer's state with one member, and
create_connection() refuses every request that state does not allow.
"""

from datetime import datetime, timezone
import logging

from fastapi import HTTPException, status
from postgrest.exceptions import APIError

from app.core.supabase import get_supabase_client
from app.services import _common
from app.services import maps_messaging as maps
from app.services import member_settings, public_profiles
from app.services.shared_map import flatten_user, stamp_insert, stamp_update, web_role

logger = logging.getLogger(__name__)

TABLE = "connection_requests"
PROFILE_FIELDS = "id, full_name, primary_role, avatar_url, metadata"
DIRECTORY_ROLES = ("tenant", "landlord", "service_provider")
# The users.primary_role values behind each directory role: an agent lists as a landlord.
DIRECTORY_DB_ROLES = {"tenant": ["TENANT"], "landlord": ["LANDLORD", "AGENT"], "service_provider": ["SERVICE_PROVIDER"]}
MEMBER_DB_ROLES = [db_role for name in DIRECTORY_ROLES for db_role in DIRECTORY_DB_ROLES[name]]
# Web roles of staff accounts, which neither send nor receive requests.
STAFF_ROLES = ("admin", "officer")

# The viewer's state with one member (schemas.network.ConnectionStateOut).
SELF = "self"  # their own profile
UNAVAILABLE = "unavailable"  # staff on either side, an account that is not an active member, or a blocked pair
NONE = "none"  # no request: they may send one
SENT = "sent"  # their request waits for the other's answer; they may withdraw it
RECEIVED = "received"  # the other's request waits for their answer
CONNECTED = "connected"
DECLINED = "declined"  # the other declined their request: only the other may send again
# The badges of a person public_profiles.trust_of() found nothing for.
NO_TRUST = {"rating_avg": None, "review_count": 0, "verified": False}
# Sorts before every request time: a request without one counts as the first.
EPOCH = datetime.min.replace(tzinfo=timezone.utc)
# Pages of members a directory search reads at most to fill one page past hidden members.
SEARCH_PAGES = 5


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _canonical(user_id: str) -> str:
    """A uuid as the database returns it, in lower case: Postgres compares uuids ignoring case, Python does not."""
    return user_id.lower() if maps.is_uuid(user_id) else user_id


def _decorate(rows: list[dict], me: str) -> list[dict]:
    """Attach the counterpart profile to each connection (flatten_connection's shape)."""
    if not rows:
        return []

    other_ids = {
        row["addressee_id"] if row["requester_id"] == me else row["requester_id"] for row in rows
    }
    supabase = get_supabase_client()
    profiles = (
        supabase.table("users").select(PROFILE_FIELDS).in_("id", list(other_ids)).execute().data
        or []
    )
    by_id = {p["id"]: p for p in profiles}

    decorated = []
    for row in rows:
        outgoing = row["requester_id"] == me
        other_id = row["addressee_id"] if outgoing else row["requester_id"]
        profile = by_id.get(other_id) or {}
        decorated.append(
            {
                **row,
                "person_id": other_id,
                "person_name": profile.get("full_name") or "TenantVoice member",
                "person_role": web_role(profile.get("primary_role")),
                "person_avatar_url": profile.get("avatar_url"),
                "person_location": (profile.get("metadata") or {}).get("location"),
                "direction": "outgoing" if outgoing else "incoming",
            }
        )
    return decorated


def _connection(connection_id: str) -> dict | None:
    """A connection by id, flattened; None if there is none, or it was withdrawn."""
    rows = maps.is_uuid(connection_id) and (
        get_supabase_client().table(TABLE).select("*").eq("id", connection_id).limit(1).execute().data
    )
    return maps.flatten_connection(rows[0]) if rows else None


# ---------------------------------------------------------------------------
# Who may ask whom (assumption #3)
# ---------------------------------------------------------------------------
def _is_member(user_id: str) -> bool:
    """Whether user_id is an active, open member's account: never staff, a suspended or a closed one."""
    if not maps.is_uuid(user_id):
        return False
    rows = (
        get_supabase_client()
        .table("users")
        .select("id")
        .eq("id", user_id)
        .eq("status", "ACTIVE")
        .is_("deleted_at", "null")
        .in_("primary_role", MEMBER_DB_ROLES)
        .limit(1)
        .execute()
        .data
    )
    return bool(rows)


def _rows_between(me: str, other: str) -> list[dict]:
    """Every request between the two, in either direction, newest first. Both ids must be checked uuids."""
    return (
        get_supabase_client()
        .table(TABLE)
        .select("*")
        .or_(
            f"and(sender_user_id.eq.{me},receiver_user_id.eq.{other}),"
            f"and(sender_user_id.eq.{other},receiver_user_id.eq.{me})"
        )
        .order("created_at", desc=True)
        .order("id")
        .execute()
        .data
        or []
    )


def _rows_of(profile_id: str) -> list[dict]:
    """Every request this person sent or received, newest first. profile_id is spliced into the filter."""
    return (
        get_supabase_client()
        .table(TABLE)
        .select("*")
        .or_(f"sender_user_id.eq.{profile_id},receiver_user_id.eq.{profile_id}")
        .order("created_at", desc=True)
        .order("id")
        .execute()
        .data
        or []
    )


def _other(row: dict, me: str) -> str:
    return row["receiver_user_id"] if row["sender_user_id"] == me else row["sender_user_id"]


def _request_order(row: dict) -> tuple:
    """Requests in the order they were sent: by created_at, then id."""
    return maps.moment(row.get("created_at")) or EPOCH, row["id"]


def _state(me: str, rows: list[dict]) -> tuple[str, dict | None]:
    """My state with someone, from our requests newest first, and the request that decides it.

    The newest request that is not withdrawn decides. BLOCKED, or a status
    the web does not know, leaves nothing to do on the web. Two pending
    requests are a race _won() could not settle: the first decides, as
    _won() would have kept it.
    """
    pending = [row for row in rows if row["status"] == "PENDING"]
    if len(pending) > 1:
        first = min(pending, key=_request_order)
        return (SENT if first["sender_user_id"] == me else RECEIVED), first
    for row in rows:
        db_status = row["status"]
        if db_status == maps.WITHDRAWN:
            continue
        mine = row["sender_user_id"] == me
        if db_status == "PENDING":
            return (SENT if mine else RECEIVED), row
        if db_status == "ACCEPTED":
            return CONNECTED, row
        if db_status == "DECLINED":
            # Only the person who declined may send again.
            return (DECLINED if mine else NONE), row
        return UNAVAILABLE, row
    return NONE, None


def _state_out(user_id: str, state: str, row: dict | None = None) -> dict:
    return {"user_id": user_id, "state": state, "connection_id": row["id"] if row else None}


def state_with(profile_id: str, role: str | None, other_id: str) -> dict:
    """The viewer's connection state with one member, for the Connect button on a profile page.

    An unknown id, a staff account and an account that is not active all read
    as unavailable, so the answer never tells which.
    """
    profile_id, other_id = _canonical(profile_id), _canonical(other_id)
    if other_id == profile_id:
        return _state_out(other_id, SELF)
    if role in STAFF_ROLES or not _is_member(other_id) or not _is_member(profile_id):
        return _state_out(other_id, UNAVAILABLE)
    return _state_out(other_id, *_state(profile_id, _rows_between(profile_id, other_id)))


# ---------------------------------------------------------------------------
# Requests and answers
# ---------------------------------------------------------------------------
def list_connections(profile_id: str, status_filter: str | None = None) -> list[dict]:
    query = (
        get_supabase_client()
        .table(TABLE)
        .select("*")
        .or_(f"sender_user_id.eq.{profile_id},receiver_user_id.eq.{profile_id}")
        .neq("status", maps.WITHDRAWN)
    )
    if status_filter:
        statuses = maps.connection_statuses(status_filter)
        if not statuses:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Status must be pending, accepted or declined")
        query = query.in_("status", statuses)
    rows = query.order("created_at", desc=True).execute().data or []
    return _decorate([c for c in map(maps.flatten_connection, rows) if c], profile_id)


def create_connection(requester_id: str, addressee_id: str, requester_role: str | None = None) -> dict:
    """Send a request, if the requester's state with the addressee is none (state_with()).

    A request the addressee declined earlier, or one that was withdrawn, is
    sent again on the same row. Without one, a new row is inserted, and a
    request the other person sent at the same moment wins over it (_won()).
    """
    requester_id, addressee_id = _canonical(requester_id), _canonical(addressee_id)
    if requester_id == addressee_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot connect with yourself")
    if requester_role in STAFF_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Staff accounts cannot send connection requests")
    # A signed-in account that is not active (PENDING_VERIFICATION) asks nobody, as nobody can ask it.
    if not _is_member(requester_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only active members can send connection requests")
    # Also checks the id before it is spliced into the pair filter below.
    if not _is_member(addressee_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")

    existing = _rows_between(requester_id, addressee_id)
    state, deciding = _state(requester_id, existing)
    if state != NONE:
        raise HTTPException(status.HTTP_409_CONFLICT, "A connection already exists with this member")

    supabase = get_supabase_client()
    request = {
        "sender_user_id": requester_id,
        "receiver_user_id": addressee_id,
        "status": "PENDING",
        "context_type": "NETWORK",
    }
    if existing:
        # A decline the requester gave, else a withdrawn request (the same
        # direction first): sent again on that row, whatever unique key the
        # table may have on the pair. Its status must not have changed since.
        reused = deciding or min(existing, key=lambda row: row["sender_user_id"] != requester_id)
        result = (
            supabase.table(TABLE)
            .update(
                stamp_update(
                    TABLE,
                    {**request, "context_entity_id": None, "note": None, "created_at": _now(), "responded_at": None},
                )
            )
            .eq("id", reused["id"])
            .eq("status", reused["status"])
            .execute()
        )
    else:
        result = supabase.table(TABLE).insert(stamp_insert(TABLE, request)).execute()
        if result.data and not _won(result.data[0], requester_id, addressee_id):
            supabase.table(TABLE).delete().eq("id", result.data[0]["id"]).execute()
            result.data = []
    if not result.data:
        raise HTTPException(status.HTTP_409_CONFLICT, "A connection already exists with this member")
    return _decorate([maps.flatten_connection(result.data[0])], requester_id)[0]


def _won(created: dict, requester_id: str, addressee_id: str) -> bool:
    """Whether a new request is the pair's only one, or the first of requests sent at the same time.

    The table has no unique key on the pair that we know of, so two requests
    sent at once can both be inserted. Each then finds the other here, and
    the earlier one (by created_at, then id) stays. This is best effort:
    created_at is when a transaction started, so a request that commits
    after the other's check can leave both, and _state() then lets the
    first decide. A failed read keeps the request: it was saved.
    """
    try:
        rows = _rows_between(requester_id, addressee_id)
    except APIError as exc:
        logger.warning("could not check connection request %s for a rival: %s", created["id"], exc)
        return True
    rivals = [row for row in rows if row["id"] != created["id"] and row["status"] != maps.WITHDRAWN]
    return all(_request_order(created) < _request_order(row) for row in rivals)


def respond(connection_id: str, profile_id: str, new_status: str) -> dict:
    if new_status not in {"accepted", "declined"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Status must be accepted or declined")

    connection = _connection(connection_id)
    if connection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Connection not found")
    if connection["addressee_id"] != profile_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the recipient can respond to a request")
    if connection["status"] != "pending":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This request has already been answered")

    updated = (
        get_supabase_client()
        .table(TABLE)
        .update(
            stamp_update(TABLE, {"status": maps.WEB_TO_CONNECTION_STATUS[new_status], "responded_at": _now()})
        )
        .eq("id", connection_id)
        # Still pending: the request may have been answered in the app meanwhile.
        .eq("status", "PENDING")
        .execute()
    )
    if not updated.data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This request has already been answered")
    return _decorate([maps.flatten_connection(updated.data[0])], profile_id)[0]


def remove(connection_id: str, profile_id: str) -> None:
    """Withdraw a request, clear a decline or end a connection the caller is part of.

    A pending request is the sender's to withdraw; its receiver accepts or
    declines it. A decline is kept so the declined sender cannot ask again
    (create_connection), so only the person who declined may remove it.
    """
    connection = _connection(connection_id)
    if connection is None or profile_id not in (connection["requester_id"], connection["addressee_id"]):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Connection not found")
    if connection["status"] == "pending" and connection["addressee_id"] == profile_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Accept or decline this request: only its sender can withdraw it")
    if connection["status"] == "declined" and connection["requester_id"] == profile_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the person who declined this request can remove it")
    get_supabase_client().table(TABLE).delete().eq("id", connection_id).execute()


def statuses_for(profile_id: str) -> dict[str, str]:
    """This person's connection status with each counterpart, in the web's lower case.

    Gates messaging and labels people in search and recommendations. The
    newest request of a pair decides; withdrawn ones are none. profile_id is
    spliced into the filter, so pass a stored or signed-in id, never raw input.
    """
    return _statuses(profile_id, _rows_of(profile_id))


def _statuses(profile_id: str, rows: list[dict]) -> dict[str, str]:
    statuses: dict[str, str] = {}
    for row in rows:
        shown = maps.web_connection_status(row["status"])
        if shown is not None:
            statuses.setdefault(_other(row, profile_id), shown)
    return statuses


def are_connected(profile_id: str, other_id: str) -> bool:
    """An accepted connection between the two people, in either direction.

    Only profile_id is sent to the database; other_id may be request input.
    """
    return statuses_for(profile_id).get(other_id) == "accepted"


def _discoverable(row: dict) -> bool:
    """Whether a member's settings let a search find them (member_settings.discoverable_member).

    Their profile is public and discoverable, with the switches the mobile
    app shares, and a tenant's is published there, as mobile_discover_profiles
    finds members.
    """
    return member_settings.discoverable_member(row.get("metadata"), row.get("primary_role"))


def search_profiles(
    profile_id: str,
    search: str | None = None,
    role: str | None = None,
    limit: int = 24,
    viewer_role: str | None = None,
) -> list[dict]:
    """Directory search used by the "Search profiles" / recommendation screens.

    Each person comes with the rating and verified badge their profile shows
    (public_profiles.trust_of) and the viewer's connection state with them,
    so a card offers what their profile page's Connect button offers. A
    member who turned their public profile or discovery off, or a tenant
    whose profile is not published in the mobile app, is left out, as
    public_profiles leaves them out of its search (_discoverable).
    """
    if role and role not in DIRECTORY_ROLES:
        return []
    roles = [role] if role else DIRECTORY_ROLES
    term = _common.search_term(search)

    def page(offset: int) -> list[dict]:
        # Only active marketplace members are discoverable; staff accounts
        # (admin, officer) and archived or suspended accounts never appear.
        query = (
            get_supabase_client()
            .table("users")
            .select(PROFILE_FIELDS)
            .neq("id", profile_id)
            .is_("deleted_at", "null")
            .eq("status", "ACTIVE")
            .in_("primary_role", [db for name in roles for db in DIRECTORY_DB_ROLES[name]])
        )
        if term:
            # Members save their area in users.metadata (profiles.update_profile).
            query = query.or_(f"full_name.ilike.%{term}%,metadata->>location.ilike.%{term}%")
        return query.order("full_name").order("id").range(offset, offset + limit - 1).execute().data or []

    # Hidden members are dropped here, not in the query: a not-false filter on
    # a switch also drops the members without the key, for whom it is null.
    # Later pages fill their places.
    rows: list[dict] = []
    for offset in range(0, limit * SEARCH_PAGES, limit):
        found = page(offset)
        rows += [row for row in found if _discoverable(row)]
        if len(rows) >= limit or len(found) < limit:
            break
    rows = rows[:limit]
    requests = _rows_of(profile_id)
    status_by_person = _statuses(profile_id, requests)
    by_person: dict[str, list[dict]] = {}
    for request in requests:
        by_person.setdefault(_other(request, profile_id), []).append(request)
    trust = public_profiles.trust_of([row["id"] for row in rows])
    may_connect = bool(rows) and viewer_role not in STAFF_ROLES and _is_member(profile_id)

    def connection(person_id: str) -> dict:
        if not may_connect:
            return _state_out(person_id, UNAVAILABLE)
        return _state_out(person_id, *_state(profile_id, by_person.get(person_id, [])))

    # users rows hold primary_role and metadata, not the role and location
    # fields ProfileSearchOut needs.
    return [
        {
            **flatten_user(row),
            "connection_status": status_by_person.get(row["id"]),
            **trust.get(row["id"], NO_TRUST),
            "connection": connection(row["id"]),
        }
        for row in rows
    ]
