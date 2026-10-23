"""Conversations on the shared schema (migration plan §3 a4).

A thread is a conversations row whose members are conversation_participants
rows; messages and message_attachments hold what was said. The mobile app
writes the same tables, so its threads are listed here and the web's show up
in the app. Who may read or write a thread is decided by its participant rows
alone.

The web keeps two kinds of thread, named in conversations.metadata
(maps_messaging):

  * marketplace, {kind, client_id, provider_id, booking_id}: a DIRECT thread
    between a client and a service provider (whose id is its owner's
    users.id), optionally about one web.bookings row;
  * rental, {kind, tenant_id, owner_id}: a PROPERTY thread between a tenant
    and an owner about a listing (conversations.listing_id), or a DIRECT
    network DM between two connected people (the smaller id is tenant_id).

A thread the mobile app opened has no such metadata; maps_messaging derives
its parties from the members' roles. Other areas open threads and post into
them with marketplace_thread() and post_message(), and count unread messages
with unread_counts().

Every list response is decorated with the counterpart's name, a context line,
the last message preview and an unread count, so the UI renders real data
instead of placeholder strings.
"""

import logging
import mimetypes
from datetime import datetime

from fastapi import HTTPException, status

from app.core.supabase import get_supabase_client, web_table
from app.services import _common
from app.services import connections as connections_service
from app.services import gates
from app.services import maps_messaging as maps
from app.services import notifications
from app.services import service_providers as service_providers_service
from app.services import uploads
from app.services.shared_map import stamp_insert, stamp_update, web_role

logger = logging.getLogger(__name__)

TABLE = "conversations"
PARTICIPANTS = "conversation_participants"
MESSAGES = "messages"
ATTACHMENTS = "message_attachments"
# A thread as the mappers read it: every member, with their role, last read and mute.
THREAD_FIELDS = "*, conversation_participants(user_id, role_label, last_read_at, is_muted, users(primary_role))"
MESSAGE_FIELDS = "id, conversation_id, sender_user_id, content, message_type, created_at"
# The thread types that are one conversation between two people. A GROUP
# thread is never taken for two of its members' own, even with only them in it.
PAIR_THREAD_TYPES = ("DIRECT", "PROPERTY")
# Threads per unread read: each adds an and(...) term to its or_ filter, and
# the request URL must stay well within gateway limits.
UNREAD_THREADS_PER_READ = 40
BOOKING_FIELDS = (
    "id, client_id, provider_id, status, service_id, scheduled_date, scheduled_time, "
    "property_address, property_suburb, price, conversation_id"
)
# A suspended provider still signs in to finish the jobs in progress
# (assumption #14), so they write only to the people of such a job: the
# client of a booking in progress, or the tenant or owner of a repair whose
# visit they booked. The rest of their threads stay theirs to read.
SUSPENDED_WRITES = "Your account is suspended, so you can only message the people of a job in progress."
REPAIRS_IN_PROGRESS = ("SCHEDULED", "IN_PROGRESS")
# Nor does anyone else start a new thread with such a provider, but about a job in progress with them.
NO_NEW_THREADS = "This provider isn't taking new conversations right now."


def _people_by_id(ids: set[str] | list[str]) -> dict[str, dict]:
    """users rows by id, each with its web role. Someone with no users row (a deleted account) is left out."""
    ids = list(dict.fromkeys(i for i in ids if i))
    if not ids:
        return {}
    rows = (
        get_supabase_client()
        .table("users")
        .select("id, full_name, primary_role, avatar_url")
        .in_("id", ids)
        .execute()
        .data
        or []
    )
    return {row["id"]: {**row, "role": web_role(row.get("primary_role"))} for row in rows}


def providers_by_id(ids: set[str] | list[str]) -> dict[str, dict]:
    """Marketplace providers by id, each with profile_id (the owner), business_name and is_published.

    A provider's id is its owner's users.id, the service_provider_profiles
    user_id. Threads, their decoration and notifications resolve providers
    here. Only a uuid reaches that uuid column: anything else, such as a
    slug, is no provider rather than a 22P02.
    """
    uuid_ids = [i for i in dict.fromkeys(ids) if maps.is_uuid(i)]
    if not uuid_ids:
        return {}
    rows = (
        get_supabase_client()
        .table("service_provider_profiles")
        .select("*")
        .in_("user_id", uuid_ids)
        .execute()
        .data
        or []
    )
    providers = (service_providers_service._from_shared(row) for row in rows)
    return {provider["id"]: provider for provider in providers}


# ---------------------------------------------------------------------------
# Threads and their members
# ---------------------------------------------------------------------------
def _thread_row(conversation_id: str) -> dict | None:
    rows = (
        get_supabase_client().table(TABLE).select(THREAD_FIELDS).eq("id", conversation_id).limit(1).execute().data
    )
    return rows[0] if rows else None


def _load_thread(conversation_id: str, profile_id: str) -> dict:
    """The thread with its members, if profile_id is one of them (404 or 403 otherwise)."""
    row = _thread_row(conversation_id) if maps.is_uuid(conversation_id) else None
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    if profile_id not in maps.member_ids(row):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this conversation")
    return row


def _shared_thread_ids(first: str, second: str) -> list[str]:
    """The threads both people take part in."""
    supabase = get_supabase_client()
    mine = [
        row["conversation_id"]
        for row in supabase.table(PARTICIPANTS).select("conversation_id").eq("user_id", first).execute().data or []
    ]
    if not mine:
        return []
    shared = (
        supabase.table(PARTICIPANTS)
        .select("conversation_id")
        .eq("user_id", second)
        .in_("conversation_id", list(dict.fromkeys(mine)))
        .execute()
        .data
        or []
    )
    return list(dict.fromkeys(row["conversation_id"] for row in shared))


def _pair_threads(first: str, second: str, listing_id: str | None) -> list[dict]:
    """The two people's own threads about listing_id (None: about no listing), oldest first.

    A thread is theirs only if it is a PAIR_THREAD_TYPES thread with the two
    of them as its only members: anything said there reaches nobody else.
    """
    ids = _shared_thread_ids(first, second)
    if not ids:
        return []
    query = (
        get_supabase_client().table(TABLE).select(THREAD_FIELDS).in_("id", ids)
        .in_("conversation_type", list(PAIR_THREAD_TYPES))
    )
    query = query.eq("listing_id", listing_id) if listing_id else query.is_("listing_id", "null")
    rows = query.order("created_at").order("id").execute().data or []
    return [row for row in rows if set(maps.member_ids(row)) == {first, second}]


def _out_of_work(user_id: str) -> bool:
    """Whether a provider's account is suspended or otherwise not open, read now (gates.standing)."""
    return gates.standing(user_id).state in (gates.SUSPENDED, gates.INACTIVE)


def _provider_out_of_work(user_id: str) -> bool:
    """Whether someone is a provider whose account is suspended or otherwise not open, read now."""
    found = gates.standing(user_id)
    return found.role == gates.PROVIDER and found.state in (gates.SUSPENDED, gates.INACTIVE)


def _job_in_progress_with(provider_id: str, people) -> bool:
    """Whether the provider has a job in progress with any of these people (SUSPENDED_WRITES)."""
    people = [person for person in dict.fromkeys(people) if maps.is_uuid(person) and person != provider_id]
    if not people:
        return False
    if (
        web_table("bookings").select("id").eq("provider_id", provider_id).eq("status", "in_progress")
        .in_("client_id", people).limit(1).execute().data
    ):
        return True
    parties = ",".join(f"tenant_user_id.eq.{person},landlord_user_id.eq.{person}" for person in people)
    return bool(
        get_supabase_client().table("maintenance_work_orders").select("id").eq("assigned_worker_id", provider_id)
        .in_("status", list(REPAIRS_IN_PROGRESS)).or_(parties).limit(1).execute().data
    )


def _require_job_in_progress(provider_id: str, people) -> None:
    """403 for a suspended provider writing to anyone but the people of a job in progress."""
    if _out_of_work(provider_id) and not _job_in_progress_with(provider_id, people):
        raise HTTPException(status.HTTP_403_FORBIDDEN, SUSPENDED_WRITES)


def _about_job_in_progress(provider_id: str, client_id: str, booking_id: str | None) -> bool:
    """Whether a client's new thread with a provider out of work is about a job in progress between them.

    A booking's thread needs that booking in progress; the pair's general
    thread, any job in progress between them (SUSPENDED_WRITES).
    """
    if booking_id:
        return bool(
            web_table("bookings").select("id").eq("id", booking_id).eq("client_id", client_id)
            .eq("provider_id", provider_id).eq("status", "in_progress").limit(1).execute().data
        )
    return _job_in_progress_with(provider_id, [client_id])


def _remove(table: str, row_id: str) -> None:
    """Delete a row a failed write left half-made. Never raises: the write's own error is the one to report."""
    try:
        get_supabase_client().table(table).delete().eq("id", row_id).execute()
    except Exception as exc:
        logger.error("could not remove the half-written %s row %s: %s", table, row_id, exc)


def _open_thread(
    members: list[str],
    *,
    conversation_type: str,
    metadata: dict,
    subject: str | None,
    listing_id: str | None,
    created_by: str | None,
) -> str:
    """Write a new thread and a participant row for each member, and return its id.

    Every member needs a users row (404 otherwise). role_label is the
    member's web role: the mobile app's vocabulary for it is not known
    (plan §4, decision 3).
    """
    people = _people_by_id(members)
    if any(member not in people for member in members):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    supabase = get_supabase_client()
    thread = stamp_insert(
        TABLE,
        {
            "conversation_type": conversation_type,
            "subject": subject,
            "listing_id": listing_id,
            "created_by_user_id": created_by,
            "metadata": metadata,
        },
    )
    supabase.table(TABLE).insert(thread).execute()
    try:
        supabase.table(PARTICIPANTS).insert(
            [
                stamp_insert(
                    PARTICIPANTS,
                    {"conversation_id": thread["id"], "user_id": member, "role_label": people[member]["role"]},
                )
                for member in members
            ]
        ).execute()
    except Exception:
        # Nobody could ever open a thread without members: don't leave it behind.
        _remove(TABLE, thread["id"])
        raise
    return thread["id"]


def _find_or_open(
    people: tuple[str, str], matches, *, take_app_thread: bool, listing_id: str | None = None,
    open_new: bool = True, **thread
) -> str | None:
    """The id of the two people's first own thread about listing_id that fits, else of a new one.

    A thread the web opened fits if matches(its thread fields). One the
    mobile app opened (no web metadata) is the pair's thread about that
    listing whatever kind their roles suggest, so it fits whenever
    take_app_thread. Without open_new, None when no thread fits.
    """
    if not all(maps.is_uuid(person) for person in people):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    for row in _pair_threads(*people, listing_id):
        if maps.web_parties(row) is None:
            fits = take_app_thread
        else:
            fits = matches(maps.flatten_conversation(row))
        if fits:
            return row["id"]
    return _open_thread(list(people), listing_id=listing_id, **thread) if open_new else None


def _marketplace_thread_id(
    client_id: str, provider_id: str, booking_id: str | None, subject: str | None, created_by: str | None,
    open_new: bool = True,
) -> str | None:
    def matches(thread: dict) -> bool:
        return (thread["kind"], thread["client_id"], thread["provider_id"], thread["booking_id"]) == (
            maps.MARKETPLACE, client_id, provider_id, booking_id,
        )

    return _find_or_open(
        (client_id, provider_id),
        matches,
        # The pair's app thread is their general one, never a booking's.
        take_app_thread=booking_id is None,
        open_new=open_new,
        conversation_type="DIRECT",
        metadata=maps.marketplace_metadata(client_id, provider_id, booking_id),
        subject=subject,
        created_by=created_by,
    )


def marketplace_thread(
    client_id: str,
    provider_id: str,
    *,
    booking_id: str | None = None,
    subject: str | None = None,
    created_by: str | None = None,
) -> dict:
    """Find or open the marketplace thread between a client and a provider, both users.id.

    For other areas, such as bookings opening a booking's thread. The same
    client, provider and booking always share one thread; booking_id=None is
    the pair's general thread, which also takes a DIRECT thread the two of
    them alone started in the mobile app (never a GROUP thread, or one with
    anyone else in it). A new thread is a DIRECT conversation with
    metadata {"kind": "marketplace", "client_id", "provider_id",
    "booking_id"}, a participant row for each of the two, and created_by
    (default: the client) as its creator.

    Nothing is checked: the caller knows the booking is theirs (web.bookings)
    and that the two may talk, as create_conversation() checks for a request.
    Both need a users row (404). Returns ConversationOut's thread fields
    (maps_messaging.flatten_conversation), undecorated; its "id" is what
    web.bookings.conversation_id keeps.
    """
    conversation_id = _marketplace_thread_id(client_id, provider_id, booking_id, subject, created_by or client_id)
    return maps.flatten_conversation(_thread_row(conversation_id))


def _attachment(key: str) -> dict:
    """The message_attachments fields for an uploaded file's key. Its size is not known here."""
    name = key.rsplit("/", 1)[-1]
    return {"file_url": key, "file_name": name, "mime_type": mimetypes.guess_type(name)[0]}


def post_message(
    conversation_id: str,
    sender_id: str | None,
    content: str | None,
    *,
    system: bool = False,
    attachment: dict | None = None,
) -> dict:
    """Write one message into a thread and move the thread up its members' inboxes.

    For other areas, such as bookings' reschedule and status notes. sender_id
    is the users.id it comes from, or None for a note from nobody;
    system=True writes message_type SYSTEM. attachment ({file_url, file_name,
    mime_type, file_size_bytes}) makes it a FILE message with one
    message_attachments row. Readers only ever show a file the sender
    uploaded, so file_url must be the key (or the signed URL) of an upload
    in the sender's own folder of uploads.MESSAGE_ATTACHMENTS_BUCKET, and a
    message from nobody cannot carry one: anything else is a ValueError,
    raised before anything is written. Nothing else is checked (the caller
    knows the sender may write here) and nobody is notified:
    create_message() does both for a request, and notifications.notify() is
    the caller's to send. Returns MessageOut's fields
    (maps_messaging.flatten_message), unread.
    """
    if attachment:
        key = _attachment_key(sender_id, attachment.get("file_url"))
        if key is None:
            raise ValueError("an attachment must be the sender's own upload in the message attachments bucket")
        attachment = {**attachment, "file_url": key}
    supabase = get_supabase_client()
    message = stamp_insert(
        MESSAGES,
        {
            "conversation_id": conversation_id,
            "sender_user_id": sender_id,
            "message_type": "SYSTEM" if system else "FILE" if attachment else "TEXT",
            "content": content or None,
        },
    )
    saved = supabase.table(MESSAGES).insert(message).execute().data[0]
    saved["message_attachments"] = []
    if attachment:
        try:
            saved["message_attachments"] = (
                supabase.table(ATTACHMENTS)
                .insert(stamp_insert(ATTACHMENTS, {**attachment, "message_id": saved["id"]}))
                .execute()
                .data
            )
        except Exception:
            # A FILE message without its file would show as an empty bubble.
            _remove(MESSAGES, saved["id"])
            raise
    try:
        supabase.table(TABLE).update(stamp_update(TABLE, {})).eq("id", conversation_id).execute()
    except Exception as exc:
        # The message is saved: failing now would only make the sender send it twice.
        logger.error("could not move conversation %s up the inbox: %s", conversation_id, exc)
    return maps.flatten_message(saved)


def unread_counts(profile_id: str, conversation_ids: list[str] | None = None) -> dict[str, int]:
    """How many messages each of a person's threads holds that they have not read, by thread id.

    The inbox's rule, for the dashboards and bookings: other people's messages
    newer than the person's last_read_at in that thread, or all of them if
    they never read it. conversation_ids limits the count to those threads;
    one the person is not part of counts nothing (and is left out).
    """
    supabase = get_supabase_client()

    def mine():
        return (
            supabase.table(PARTICIPANTS).select("id, conversation_id, last_read_at").eq("user_id", profile_id).order("id")
        )

    if conversation_ids is None:
        rows = _common.select_all(mine)
    else:
        rows = _common.select_in(mine, "conversation_id", [i for i in conversation_ids if maps.is_uuid(i)])
    read_at: dict[str, datetime | None] = {}
    for row in rows:
        # Someone listed twice in a thread has read it as far as their latest row says.
        times = [time for time in (read_at.get(row["conversation_id"]), maps.moment(row.get("last_read_at"))) if time]
        read_at[row["conversation_id"]] = max(times) if times else None
    return _unread_by_thread(profile_id, read_at)


def _unread_by_thread(profile_id: str, read_at: dict[str, datetime | None]) -> dict[str, int]:
    """How many of other people's messages profile_id has not read in each thread of read_at.

    read_at maps a thread id to when they last read it (None: never). Only
    the messages newer than that are read, page by page, so neither a long
    history nor PostgREST's max-rows cap skews a count.
    """
    counts = dict.fromkeys(read_at, 0)
    threads = list(read_at)
    supabase = get_supabase_client()
    for start in range(0, len(threads), UNREAD_THREADS_PER_READ):
        terms = ",".join(
            f"and(conversation_id.eq.{thread},created_at.gt.{maps.filter_time(read_at[thread])})"
            if read_at[thread] else f"conversation_id.eq.{thread}"
            for thread in threads[start:start + UNREAD_THREADS_PER_READ]
        )
        newer = _common.select_all(
            lambda terms=terms: supabase.table(MESSAGES)
            .select("id, conversation_id, sender_user_id, created_at")
            .or_(terms)
            .is_("deleted_at", "null")
            .order("created_at")
            .order("id")
        )
        for message in newer:
            if maps.is_unread(message, profile_id, read_at[message["conversation_id"]]):
                counts[message["conversation_id"]] += 1
    return counts


# ---------------------------------------------------------------------------
# Decoration
# ---------------------------------------------------------------------------
def _counterpart(thread: dict, members: list[str], me: str) -> str | None:
    """The other party of the thread; in a group thread, the first other member by id."""
    if thread["kind"] == maps.MARKETPLACE:
        pair = (thread["client_id"], thread["provider_id"])
    else:
        pair = (thread["tenant_id"], thread["owner_id"])
    if me in pair:
        other = pair[1] if pair[0] == me else pair[0]
        if other:
            return other
    others = sorted(member for member in members if member != me)
    return others[0] if others else None


def _listings_by_id(listing_ids: set[str]) -> dict[str, dict]:
    if not listing_ids:
        return {}
    rows = (
        get_supabase_client()
        .table("listings")
        .select("id, title, properties(suburb, address_line_1, nickname)")
        .in_("id", list(listing_ids))
        .execute()
        .data
        or []
    )
    return {row["id"]: row for row in rows}


def _bookings_by_thread(threads: list[dict]) -> dict[str, dict]:
    """Each marketplace thread's booking (web.bookings), with its service title, by thread id.

    A booking names its thread in conversation_id, and a thread opened for a
    booking names it in its metadata. Only a booking between the thread's own
    client and provider counts.
    """
    marketplace = [thread for thread in threads if thread["kind"] == maps.MARKETPLACE]
    if not marketplace:
        return {}
    linked: dict[str, dict] = {}
    rows = (
        web_table("bookings")
        .select(BOOKING_FIELDS)
        .in_("conversation_id", [thread["id"] for thread in marketplace])
        .execute()
        .data
        or []
    )
    for row in rows:
        linked.setdefault(row["conversation_id"], row)
    named = {t["booking_id"] for t in marketplace if t["booking_id"] and t["id"] not in linked}
    by_id: dict[str, dict] = {}
    if named:
        rows = web_table("bookings").select(BOOKING_FIELDS).in_("id", list(named)).execute().data or []
        by_id = {row["id"]: row for row in rows}

    found: dict[str, dict] = {}
    for thread in marketplace:
        booking = linked.get(thread["id"]) or by_id.get(thread["booking_id"])
        if booking and (booking["client_id"], booking["provider_id"]) == (thread["client_id"], thread["provider_id"]):
            found[thread["id"]] = booking
    service_ids = {booking["service_id"] for booking in found.values() if booking.get("service_id")}
    service_title: dict[str, str] = {}
    if service_ids:
        services = (
            get_supabase_client()
            .table("mobile_provider_services")
            .select("id, title")
            .in_("id", list(service_ids))
            .execute()
            .data
            or []
        )
        service_title = {service["id"]: service["title"] for service in services}
    for booking in found.values():
        booking["service_title"] = service_title.get(booking.get("service_id"))
    return found


def _decorate(rows: list[dict], me: str) -> list[dict]:
    """Thread rows (with THREAD_FIELDS) as ConversationOut, seen by me."""
    if not rows:
        return []

    supabase = get_supabase_client()
    threads = [maps.flatten_conversation(row) for row in rows]
    conversation_ids = [thread["id"] for thread in threads]

    # --- last message + unread count -------------------------------------
    # Each thread's newest message, not its history: one row per thread comes back.
    latest = (
        supabase.table(TABLE)
        .select(f"id, {MESSAGES}({MESSAGE_FIELDS})")
        .in_("id", conversation_ids)
        .is_(f"{MESSAGES}.deleted_at", "null")
        .order("created_at", desc=True, foreign_table=MESSAGES)
        .order("id", desc=True, foreign_table=MESSAGES)
        .limit(1, foreign_table=MESSAGES)
        .execute()
        .data
        or []
    )
    last_message = {row["id"]: row[MESSAGES][0] for row in latest if row.get(MESSAGES)}
    unread = _unread_by_thread(me, {row["id"]: maps.last_read_at(row, me) for row in rows})

    # --- counterpart profile ---------------------------------------------
    counterpart_ids = {
        thread["id"]: _counterpart(thread, maps.member_ids(row), me) for thread, row in zip(threads, rows)
    }
    profile_by_id = _people_by_id({pid for pid in counterpart_ids.values() if pid})
    provider_label = {
        pid: provider["business_name"]
        for pid, provider in providers_by_id(
            {t["provider_id"] for t in threads if t["kind"] == maps.MARKETPLACE and t["provider_id"] != me}
        ).items()
        if provider.get("business_name")
    }

    # --- context (listing address or booking service) --------------------
    listing_by_id = _listings_by_id({t["property_id"] for t in threads if t.get("property_id")})
    booking_by_thread = _bookings_by_thread(threads)

    for thread in threads:
        other_id = counterpart_ids[thread["id"]]
        profile = profile_by_id.get(other_id) or {}
        # A client sees the provider's business name; anyone else a person's own.
        talking_to_provider = thread["kind"] == maps.MARKETPLACE and other_id == thread["provider_id"]
        business = provider_label.get(other_id) if talking_to_provider else None
        thread["counterpart_id"] = other_id
        thread["counterpart_name"] = business or profile.get("full_name")
        thread["counterpart_role"] = profile.get("role")
        thread["counterpart_avatar_url"] = profile.get("avatar_url")
        last = last_message.get(thread["id"])
        thread["last_message"] = (last.get("content") or "") if last else None
        thread["last_message_sender_id"] = last.get("sender_user_id") if last else None
        thread["unread_count"] = unread.get(thread["id"], 0)

        booking = booking_by_thread.get(thread["id"])
        thread["booking"] = None
        if booking:
            thread["booking_id"] = booking["id"]
            thread["booking"] = {
                "id": booking["id"],
                "status": booking["status"],
                "service_title": booking.get("service_title"),
                "scheduled_date": booking.get("scheduled_date"),
                "scheduled_time": booking.get("scheduled_time"),
                "property_address": booking.get("property_address"),
                "price": booking.get("price"),
            }

        context_parts = []
        listing = listing_by_id.get(thread.get("property_id"))
        if listing:
            prop = listing.get("properties") or {}
            label = prop.get("suburb") or prop.get("address_line_1") or prop.get("nickname") or listing.get("title")
            if label:
                context_parts.append(label)
        if booking and booking.get("service_title"):
            context_parts.append(booking["service_title"])
        elif booking and booking.get("property_suburb"):
            context_parts.append(booking["property_suburb"])
        if not context_parts and thread.get("subject"):
            context_parts.append(thread["subject"])
        thread["context"] = " · ".join(context_parts) or None

    return threads


# ---------------------------------------------------------------------------
# Marketplace threads
# ---------------------------------------------------------------------------
def create_conversation(profile_id: str, payload: dict) -> dict:
    """Open (or reopen) the marketplace thread between a client and a provider.

    Find-or-create: the same client, provider and booking always share one
    thread, so repeated "Message" clicks don't pile up empty conversations.
    A provider opens a thread with a client_id; anyone else is the client.
    """
    target_provider_id = payload["provider_id"]
    target = providers_by_id([target_provider_id]).get(target_provider_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service provider not found")

    is_owner = target["profile_id"] == profile_id
    client_id = payload.get("client_id") if is_owner else profile_id
    if not client_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "client_id is required")
    if client_id == target["profile_id"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot message your own listing")

    booking_id = payload.get("booking_id")
    if booking_id and not _is_booking_between(booking_id, client_id, target_provider_id):
        # Never let a thread attach to (and read the details of) someone else's booking.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")

    has_history = _has_relationship(client_id, target_provider_id)
    if is_owner and not has_history:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You can message clients who have booked or contacted you, or connections in your network",
        )
    if is_owner:
        _require_job_in_progress(profile_id, [client_id])
    open_new = True
    if not is_owner and _out_of_work(target_provider_id):
        # A provider out of work (suspended, or their account not open) takes no
        # new thread unless it is about a job in progress with this client, however
        # long they have dealt with each other; a thread the two have still opens.
        open_new = _about_job_in_progress(target_provider_id, client_id, booking_id)
    elif not is_owner and not has_history and not target.get("is_published"):
        # An unpublished provider takes no new thread, except from a client they already deal with.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service provider not found")

    conversation_id = _marketplace_thread_id(
        client_id, target_provider_id, booking_id, payload.get("subject"), profile_id, open_new=open_new,
    )
    if conversation_id is None:
        # As for a provider the marketplace no longer lists.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service provider not found")
    return _decorate([_thread_row(conversation_id)], profile_id)[0]


def _is_booking_between(booking_id: str, client_id: str, provider_id: str) -> bool:
    if not (maps.is_uuid(booking_id) and maps.is_uuid(client_id)):
        return False
    return bool(
        web_table("bookings")
        .select("id")
        .eq("id", booking_id)
        .eq("client_id", client_id)
        .eq("provider_id", provider_id)
        .limit(1)
        .execute()
        .data
    )


def _has_relationship(client_id: str, provider_id: str) -> bool:
    """Whether a provider and a client have dealt with each other, so the provider may write first.

    Any of: a web booking, a thread they share, an accepted connection, a
    repair the provider is assigned to for the client (as its tenant or
    landlord), or a job the client's owner assistant sent the provider.
    client_id can come from the request body: anything but a uuid is nobody,
    and only a checked uuid is spliced into a filter.
    """
    if not maps.is_uuid(client_id):
        return False
    supabase = get_supabase_client()
    return bool(
        web_table("bookings").select("id").eq("client_id", client_id).eq("provider_id", provider_id)
        .limit(1).execute().data
        or _shared_thread_ids(provider_id, client_id)
        or connections_service.are_connected(provider_id, client_id)
        or supabase.table("maintenance_work_orders").select("id").eq("assigned_worker_id", provider_id)
        .or_(f"tenant_user_id.eq.{client_id},landlord_user_id.eq.{client_id}").limit(1).execute().data
        or supabase.table("mobile_ai_service_jobs").select("id").eq("provider_id", provider_id)
        .eq("owner_id", client_id).limit(1).execute().data
    )


# ---------------------------------------------------------------------------
# Rental threads (tenant <-> owner)
# ---------------------------------------------------------------------------
def create_rental_conversation(profile_id: str, role: str, payload: dict) -> dict:
    """Find-or-create a tenant <-> owner thread, optionally posting a first message.

    Either party may start the thread, so the caller's role decides which side
    they are on:

      * tenant  -> pass `property_id` (a listing id; its owner is the
                   property's owner_user_id) or `owner_id`
      * landlord-> pass `tenant_id`; `property_id` is optional but, when given,
                   must be a listing of a property this landlord owns
      * any role-> pass `peer_id` for a connection-gated network DM (the
                   lexicographically smaller id is tenant_id)

    When a tenant starts a thread with only `owner_id` (no property), the peer
    must already be an accepted connection — that powers Network messaging with
    landlords, providers, and other tenants.
    """
    peer_id = payload.get("peer_id")
    if role == "service_provider":
        # A provider's rental side is a network DM; a suspended one writes only about a job in progress.
        _require_job_in_progress(profile_id, [peer_id or payload.get("owner_id") or payload.get("tenant_id")])
    if peer_id:
        return _create_network_dm(profile_id, peer_id, payload)

    property_id = payload.get("property_id")
    listing = _listing(property_id) if property_id else None
    listing_owner = ((listing or {}).get("properties") or {}).get("owner_user_id")
    # Whoever owns or manages the listing's property answers for it, as they decide its applications.
    landlords = {((listing or {}).get("properties") or {}).get(key) for key in ("owner_user_id", "manager_user_id")} - {None}

    if role == "landlord":
        owner_id = profile_id
        tenant_id = payload.get("tenant_id")
        if not tenant_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "tenant_id is required when messaging a tenant"
            )
        # Don't let an owner attach a thread to someone else's listing.
        if listing and profile_id not in landlords:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not own this property")
        if not listing:
            _require_accepted_connection(profile_id, tenant_id)
    else:
        tenant_id = profile_id
        owner_id = listing_owner if listing else payload.get("owner_id")
        if not owner_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Provide either property_id, owner_id, or peer_id"
            )
        if not listing:
            _require_accepted_connection(profile_id, owner_id)

    if owner_id == tenant_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot message yourself")

    return _upsert_rental_thread(
        profile_id,
        owner_id=owner_id,
        tenant_id=tenant_id,
        listing_id=listing["id"] if listing else None,
        subject=payload.get("subject") or (listing["title"] if listing else None),
        body=payload.get("body"),
    )


def _listing(listing_id: str) -> dict:
    """A listing with its property's owner, or 404."""
    rows = maps.is_uuid(listing_id) and (
        get_supabase_client()
        .table("listings")
        .select("id, title, properties(owner_user_id, manager_user_id)")
        .eq("id", listing_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Property not found")
    return rows[0]


def _create_network_dm(profile_id: str, peer_id: str, payload: dict) -> dict:
    """Connection-gated DM between any two profiles (owner/tenant/provider)."""
    if peer_id == profile_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot message yourself")
    _require_accepted_connection(profile_id, peer_id)

    # A stable ordering, so either party finds the same thread.
    tenant_id, owner_id = sorted([profile_id, peer_id])
    return _upsert_rental_thread(
        profile_id,
        owner_id=owner_id,
        tenant_id=tenant_id,
        listing_id=None,
        subject=payload.get("subject"),
        body=payload.get("body"),
    )


def _upsert_rental_thread(
    profile_id: str,
    *,
    owner_id: str,
    tenant_id: str,
    listing_id: str | None,
    subject: str | None,
    body: str | None,
) -> dict:
    """Find or open the pair's rental thread or DM.

    A provider out of work, on either side and however the caller names them
    (peer_id, owner_id or tenant_id), gets no new thread but about a job in
    progress with the caller: only one the two already have opens (403 when
    there is none).
    """
    pair = {owner_id, tenant_id}
    other = owner_id if profile_id == tenant_id else tenant_id
    open_new = not _provider_out_of_work(other) or _job_in_progress_with(other, [profile_id])

    def matches(thread: dict) -> bool:
        # Only a web rental thread or DM: never a booking's thread between the two.
        return thread["kind"] == maps.RENTAL and {thread["tenant_id"], thread["owner_id"]} == pair

    conversation_id = _find_or_open(
        (tenant_id, owner_id),
        matches,
        take_app_thread=True,
        listing_id=listing_id,
        open_new=open_new,
        conversation_type="PROPERTY" if listing_id else "DIRECT",
        metadata=maps.rental_metadata(tenant_id, owner_id),
        subject=subject,
        created_by=profile_id,
    )
    if conversation_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, NO_NEW_THREADS)
    message_body = (body or "").strip()
    if message_body:
        _send(_thread_row(conversation_id), profile_id, message_body)
    return _decorate([_thread_row(conversation_id)], profile_id)[0]


def _require_accepted_connection(profile_id: str, peer_id: str) -> None:
    """Network DMs require an accepted connection between the two profiles."""
    if not connections_service.are_connected(profile_id, peer_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Connect with this person before messaging them",
        )


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------
def list_conversations(profile_id: str) -> list[dict]:
    """Every thread profile_id takes part in, the most recently active first."""
    supabase = get_supabase_client()
    ids = [
        row["conversation_id"]
        for row in supabase.table(PARTICIPANTS).select("conversation_id").eq("user_id", profile_id).execute().data
        or []
    ]
    if not ids:
        return []
    rows = (
        supabase.table(TABLE)
        .select(THREAD_FIELDS)
        .in_("id", list(dict.fromkeys(ids)))
        .order("updated_at", desc=True)
        .order("id")
        .execute()
        .data
        or []
    )
    return _decorate(rows, profile_id)


def get_conversation(conversation_id: str, profile_id: str) -> dict:
    return _decorate([_load_thread(conversation_id, profile_id)], profile_id)[0]


def list_messages(conversation_id: str, profile_id: str) -> list[dict]:
    row = _load_thread(conversation_id, profile_id)
    rows = (
        get_supabase_client()
        .table(MESSAGES)
        .select(f"{MESSAGE_FIELDS}, message_attachments(file_url, created_at)")
        .eq("conversation_id", conversation_id)
        .is_("deleted_at", "null")
        .order("created_at")
        .order("id")
        .order("created_at", foreign_table=ATTACHMENTS)
        .execute()
        .data
        or []
    )
    messages = [
        maps.flatten_message(message, maps.read_by_others(row, message.get("sender_user_id"))) for message in rows
    ]
    name_by_id = {
        pid: person["full_name"] for pid, person in _people_by_id({m["sender_id"] for m in messages}).items()
    }
    for message in messages:
        message["sender_name"] = name_by_id.get(message["sender_id"])
    return _with_attachment_links(messages)


def _attachment_key(sender_id: str | None, value: str | None) -> str | None:
    """The stored key of a file the sender uploaded, or None for any other value."""
    if not sender_id:
        return None
    return uploads.owned_path(
        value,
        uploads.MESSAGE_ATTACHMENTS_BUCKET,
        uploads.message_attachment_folder(sender_id),
    )


def _with_attachment_links(messages: list[dict]) -> list[dict]:
    """Swap each stored attachment key for a short-lived signed URL.

    Only a file from the sender's own upload folder is shown. Anything else
    (an attachment the mobile app keeps elsewhere, or any URL) is dropped, so
    a recipient's browser never loads a remote image or link from a message.
    """
    keys = {
        message["id"]: _attachment_key(message["sender_id"], message.get("attachment_url")) for message in messages
    }
    urls = uploads.signed_urls(uploads.MESSAGE_ATTACHMENTS_BUCKET, keys.values())
    for message in messages:
        key = keys[message["id"]]
        message["attachment_url"] = urls.get(key) if key else None
    return messages


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------
def create_message(conversation_id: str, sender_id: str, payload: dict) -> dict:
    row = _load_thread(conversation_id, sender_id)
    sender = next(
        (member for member in row.get("conversation_participants") or [] if member.get("user_id") == sender_id), {},
    )
    if (sender.get("users") or {}).get("primary_role") == "SERVICE_PROVIDER":
        _require_job_in_progress(sender_id, maps.member_ids(row))
    attachment = None
    if payload.get("attachment_url"):
        key = _attachment_key(sender_id, payload["attachment_url"])
        if key is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Upload the attachment from your account before sending it"
            )
        attachment = _attachment(key)
    message = _send(row, sender_id, (payload.get("body") or "").strip(), attachment)
    return _with_attachment_links([message])[0]


def _send(row: dict, sender_id: str, body: str, attachment: dict | None = None) -> dict:
    """post_message() from a member, telling the other members."""
    message = post_message(row["id"], sender_id, body, attachment=attachment)
    message["sender_name"] = (_people_by_id([sender_id]).get(sender_id) or {}).get("full_name")
    _notify_recipients(row, message)
    return message


def _notify_recipients(row: dict, message: dict) -> None:
    """Tell the thread's other members, with one unread notification per thread each. Never raises.

    Later messages don't stack up: someone who has not opened the earlier
    notice gets no new one. A member who muted the thread (is_muted, which
    the mobile app sets) gets none.
    """
    for participant in row.get("conversation_participants") or []:
        recipient = participant.get("user_id")
        role = maps.participant_role(participant)
        if not recipient or recipient == message["sender_id"] or role is None or participant.get("is_muted"):
            continue  # the sender, an account that is gone, or someone who muted the thread
        try:
            link = notifications.messages_href(web_role(role), row["id"])
            pending = (
                get_supabase_client()
                .table(notifications.TABLE)
                .select("id")
                .eq("user_id", recipient)
                .eq("link", link)
                .eq("is_read", False)
                .limit(1)
                .execute()
                .data
            )
            if pending:
                continue
            notifications.notify(
                recipient,
                "message",
                f"New message from {message.get('sender_name') or 'TenantVoice member'}",
                message.get("body") or "Sent an attachment",
                link,
            )
        except Exception as exc:
            logger.error("message notification failed for %s in %s: %s", recipient, row["id"], exc)


def mark_read(conversation_id: str, profile_id: str) -> int:
    """Mark the thread read up to its newest message; return how many of other people's messages that read.

    The reader's last_read_at becomes the newest message's own created_at
    rather than the server's clock, so a message sent while this runs stays
    unread. Only the newest message and the unread ones are read, never the
    whole history.
    """
    row = _load_thread(conversation_id, profile_id)
    read_at = maps.last_read_at(row, profile_id)
    latest = (
        get_supabase_client()
        .table(MESSAGES)
        .select("id, created_at")
        .eq("conversation_id", conversation_id)
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .order("id", desc=True)
        .limit(1)
        .execute()
        .data
    )
    if not latest or (read_at and maps.moment(latest[0]["created_at"]) <= read_at):
        return 0
    newest = latest[0]
    unread = _unread_by_thread(profile_id, {conversation_id: read_at})[conversation_id]
    if not unread:
        return 0
    (
        get_supabase_client()
        .table(PARTICIPANTS)
        .update(stamp_update(PARTICIPANTS, {"last_read_at": newest["created_at"]}))
        .eq("conversation_id", conversation_id)
        .eq("user_id", profile_id)
        .execute()
    )
    return unread
