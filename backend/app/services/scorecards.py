"""Tenant scorecards (tracker R43, assumption #20) on web.scorecard_requests.

A tenant asks an owner or agent for a scorecard about one home; the owner
rates them on the seven items of the Owner/Agent Tenant Scorecard
(schemas/scorecards.ITEMS) from 1 to 5, with an optional comment, or
declines. Only the two of them read a request: anyone else gets 404, as if
it did not exist.

- **Who may be asked.** The owner of a rent_agreements row the tenant is
  the tenant of, once it took effect (took_effect): a lease current or
  past. And the owner or the manager of the property of a listing the
  tenant's application to was APPROVED: who decides applications on the
  web (properties.owns). The person asked must hold an open, ACTIVE
  landlord or agent account. recipients() lists them, and request()
  refuses anyone else (403), never saying which part failed.
- **One at a time.** A tenant has one PENDING request per owner and home:
  the partial unique index uq_scorecard_requests_pending refuses another,
  two sent at once included (409). Requests answered or cancelled stay.
- **Asking again.** One scorecard per tenant, owner and home: once one is
  COMPLETED, another is refused (409), so one tenancy never counts twice on
  the profile. After a decline the tenant asks that owner about that home
  again only DECLINED_WAIT later, and after a cancel CANCELLED_WAIT later,
  from the start of the next day in Sydney (the day they are told), so
  nobody can flood an owner with requests and their notices.
- **Answers.** Submitting takes a rating for every item and is final
  (COMPLETED). Declining keeps the owner's reason, if they gave one, and
  the tenant may cancel while it waits. Each of these writes applies only
  while the request is still PENDING, so the second of two answers is 409.
- **Notices** (kind review). A request and a cancellation tell the owner
  (OWNER_LINK), an answer tells the tenant (TENANT_LINK).
- **The public profile.** The completed scorecards a tenant chose to show
  (visible_on_profile) count on their public profile as one average and a
  count (public_summary); public_profiles leaves them off while the
  tenant's users.metadata.privacy.share_score is false. No name, comment or
  single rating reaches it.

Every write to web.scorecard_requests is in this module.
"""

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from postgrest.exceptions import APIError

from app.core.supabase import get_supabase_client, web_table
from app.schemas.scorecards import ITEMS
from app.services import audit, public_profiles
from app.services._common import select_all, select_in
from app.services.maps_messaging import is_uuid
from app.services.notifications import notify

TABLE = "scorecard_requests"
PENDING, COMPLETED, DECLINED, CANCELLED = "PENDING", "COMPLETED", "DECLINED", "CANCELLED"
STATUS_TO_WEB = {PENDING: "pending", COMPLETED: "completed", DECLINED: "declined", CANCELLED: "cancelled"}
# The accounts that may be asked: landlords and agents (web role landlord).
OWNER_ROLES = {"LANDLORD": "Landlord", "AGENT": "Agent"}
# rent_agreements.status is text the mobile app writes: DRAFT until the owner
# activates the lease (mobile_owner_activate_rent_agreement), which sets
# activated_at. A lease that took effect, current or past, has that time; an
# ACTIVE one without it counts too.
ACTIVE_AGREEMENT_STATUSES = frozenset({"ACTIVE"})
APPROVED_APPLICATION = "APPROVED"
PROPERTY_COLUMNS = "id, owner_user_id, manager_user_id, nickname, address_line_1, suburb, state"
NOTICE_KIND = "review"
# How long a tenant waits to ask the same owner about the same home again (defaults to confirm).
DECLINED_WAIT = timedelta(days=30)
CANCELLED_WAIT = timedelta(days=7)
SYDNEY = ZoneInfo("Australia/Sydney")
OWNER_LINK = "/owner/scorecard"
TENANT_LINK = "/tenant/dashboard#scorecards"
FALLBACK_NAME = "TenantVoice member"

NOT_FOUND = "Scorecard request not found"
NOT_ELIGIBLE = (
    "You can ask for a scorecard only from the owner or agent of a home you rent or rented: "
    "a lease with them, or an application they approved."
)
ALREADY_PENDING = "You already asked them for a scorecard for this home. It is waiting for their answer."
ALREADY_COMPLETED = "They already completed your scorecard for this home."
WAIT_TO_ASK = {
    DECLINED: "They declined your last request for this home. You can ask them again from {day}.",
    CANCELLED: "You cancelled your last request for this home. You can ask them again from {day}.",
}
ANSWERED = {
    COMPLETED: "This scorecard was already completed.",
    DECLINED: "This request was already declined.",
    CANCELLED: "This request was cancelled.",
}
CHANGED = "This request changed while you were answering it. Reload and try again."
ONLY_OWNER = "Only the owner or agent who was asked can answer this request."
ONLY_TENANT = "Only the tenant who asked can change this request."
NOT_COMPLETED = "Only a completed scorecard can show on your public profile."


def _moment() -> datetime:
    return datetime.now(timezone.utc)


def _now() -> str:
    return _moment().isoformat()


def _table():
    return web_table(TABLE)


# ---------------------------------------------------------------------------
# Who may be asked
# ---------------------------------------------------------------------------
def took_effect(agreement: dict) -> bool:
    """Whether a rent_agreements row is a lease that started, current or past: not a draft."""
    return bool(agreement.get("activated_at")) or (agreement.get("status") or "").upper() in ACTIVE_AGREEMENT_STATUSES


def _open_owners(user_ids) -> dict[str, dict]:
    """{id: users row} of the ids that are open, ACTIVE landlord or agent accounts."""
    rows = select_in(
        lambda: get_supabase_client()
        .table("users")
        .select("id, full_name, primary_role")
        .eq("status", "ACTIVE")
        .is_("deleted_at", "null")
        .in_("primary_role", list(OWNER_ROLES))
        .order("id"),
        "id",
        user_ids,
    )
    return {row["id"]: row for row in rows}


def _eligible(tenant_id: str) -> tuple[dict[tuple[str, str], dict], dict[str, dict], dict[str, dict]]:
    """({(owner id, property id): what links them}, {property id: row}, {owner id: users row}) for a tenant.

    What links them is {"source", "agreement_id", "application_id"}: the
    newest lease that took effect, else the newest approved application.
    """
    supabase = get_supabase_client()
    agreements = [
        row
        for row in supabase.table("rent_agreements")
        .select("id, listing_id, owner_user_id, status, activated_at, created_at")
        .eq("tenant_user_id", tenant_id)
        .order("created_at", desc=True)
        .order("id")
        .execute()
        .data
        or []
        if took_effect(row)
    ]
    applications = (
        supabase.table("rental_applications")
        .select("id, listing_id, last_status_at")
        .eq("applicant_user_id", tenant_id)
        .eq("status", APPROVED_APPLICATION)
        .order("last_status_at", desc=True)
        .order("id")
        .execute()
        .data
        or []
    )
    listings = {
        row["id"]: row
        for row in select_in(
            lambda: supabase.table("listings").select("id, property_id").order("id"),
            "id",
            [row["listing_id"] for row in agreements + applications],
        )
    }
    props = {
        row["id"]: row
        for row in select_in(
            lambda: supabase.table("properties").select(PROPERTY_COLUMNS).order("id"),
            "id",
            [listing["property_id"] for listing in listings.values()],
        )
    }
    found: dict[tuple[str, str], dict] = {}
    for agreement in agreements:
        listing = listings.get(agreement["listing_id"])
        if listing and listing["property_id"] in props:
            found.setdefault(
                (agreement["owner_user_id"], listing["property_id"]),
                {"source": "agreement", "agreement_id": agreement["id"], "application_id": None},
            )
    for application in applications:
        listing = listings.get(application["listing_id"])
        prop = props.get(listing["property_id"]) if listing else None
        if prop is None:
            continue
        for owner_id in filter(None, (prop.get("owner_user_id"), prop.get("manager_user_id"))):
            found.setdefault(
                (owner_id, prop["id"]),
                {"source": "application", "agreement_id": None, "application_id": application["id"]},
            )
    owners = _open_owners({owner_id for owner_id, _ in found} - {tenant_id})
    return {pair: link for pair, link in found.items() if pair[0] in owners}, props, owners


def _parsed(value) -> datetime | None:
    try:
        moment = datetime.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None
    return moment.replace(tzinfo=moment.tzinfo or timezone.utc) if moment else None


def _wait_over(decided: datetime, outcome: str) -> datetime:
    """When the tenant may ask again after a decline or a cancel: the start of the day in Sydney after the wait.

    The tenant is told that day, so a request succeeds all of it, never only
    from the time of day the wait began.
    """
    over = (decided + (DECLINED_WAIT if outcome == DECLINED else CANCELLED_WAIT)).astimezone(SYDNEY)
    day = over.date() if over.time() == time(0) else over.date() + timedelta(days=1)
    return datetime.combine(day, time(0), tzinfo=SYDNEY).astimezone(timezone.utc)


def _history_of(tenant_id: str) -> dict[tuple[str, str], dict]:
    """{(owner id, property id): {"pending", "completed", "wait"}} of the tenant's requests.

    pending and completed are request ids (the newest completed one); wait is
    (until when, the status that set it) while the newest declined or
    cancelled request still keeps the tenant from asking again (_wait_over).
    """
    rows = select_all(
        lambda: _table().select("id, owner_user_id, property_id, status, requested_at, decided_at")
        .eq("tenant_user_id", tenant_id).order("requested_at", desc=True).order("id")
    )
    history: dict[tuple[str, str], dict] = {}
    waited: set[tuple[str, str]] = set()
    now = _moment()
    for row in rows:
        key = (row["owner_user_id"], row["property_id"])
        pair = history.setdefault(key, {"pending": None, "completed": None, "wait": None})
        if row["status"] == PENDING:
            pair["pending"] = row["id"]
        elif row["status"] == COMPLETED:
            pair["completed"] = pair["completed"] or row["id"]
        elif row["status"] in WAIT_TO_ASK and key not in waited:
            # Only the newest decline or cancel counts: the rows come newest first.
            waited.add(key)
            decided = _parsed(row.get("decided_at")) or _parsed(row.get("requested_at"))
            until = _wait_over(decided, row["status"]) if decided else None
            pair["wait"] = (until, row["status"]) if until and until > now else None
    return history


def _day(moment: datetime) -> str:
    """"23 November 2026", the day in Sydney."""
    local = moment.astimezone(SYDNEY)
    return f"{local.day} {local.strftime('%B %Y')}"


def recipients(tenant_id: str) -> list[dict]:
    """The owners and agents the tenant may ask, one entry per person and home, by home then name."""
    found, props, owners = _eligible(tenant_id)
    history = _history_of(tenant_id)
    entries = []
    for (owner_id, property_id), link in found.items():
        prop, owner = props[property_id], owners[owner_id]
        past = history.get((owner_id, property_id), {})
        wait = past.get("wait")
        entries.append({
            "owner_id": owner_id,
            "owner_name": _name(owner),
            "owner_role_label": OWNER_ROLES[owner["primary_role"]],
            "property_id": property_id,
            "property_label": _property_label(prop),
            "suburb": prop.get("suburb"),
            "state": prop.get("state"),
            "source": link["source"],
            "pending_request_id": past.get("pending"),
            "completed_request_id": past.get("completed"),
            "ask_again_from": wait[0].isoformat() if wait else None,
        })
    return sorted(entries, key=lambda entry: (
        entry["property_label"].casefold(), entry["property_id"], entry["owner_name"].casefold(), entry["owner_id"],
    ))


# ---------------------------------------------------------------------------
# Responses
# ---------------------------------------------------------------------------
def _name(user: dict | None) -> str:
    """A person's name as the other party reads it: never an email or phone number saved as a name."""
    return public_profiles.shown_name((user or {}).get("full_name")) or FALLBACK_NAME


def _property_label(prop: dict | None) -> str:
    """How both parties know the home: its nickname, else its street line."""
    prop = prop or {}
    for value in (prop.get("nickname"), prop.get("address_line_1")):
        if isinstance(value, str) and value.strip():
            return " ".join(value.split())
    return "A home"


def _is_rating(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 5


def answers_of(stored) -> tuple[list[dict], float | None]:
    """The ratings stored in answers, in the scorecard's order, and their average to two decimals.

    Keys the web does not ask about, and values that are not a rating from 1
    to 5, are left out.
    """
    if not isinstance(stored, dict):
        return [], None
    answers = [
        {"key": key, "label": label, "rating": stored[key]} for key, label in ITEMS if _is_rating(stored.get(key))
    ]
    if not answers:
        return [], None
    return answers, round(sum(answer["rating"] for answer in answers) / len(answers), 2)


def _decided_at(row: dict) -> str | None:
    """When the request stopped waiting: its decided_at, which every answer and a cancellation set."""
    if row["status"] == PENDING:
        return None
    return row.get("decided_at") or (row.get("completed_at") if row["status"] == COMPLETED else None)


def _out(rows: list[dict], viewer_id: str) -> list[dict]:
    """ScorecardRequestOut for each row as viewer_id reads it, with both people's names and the home.

    Whether a scorecard shows on the tenant's profile is the tenant's choice,
    and only theirs to read: the owner gets null.
    """
    if not rows:
        return []
    supabase = get_supabase_client()
    people = {
        row["id"]: row
        for row in select_in(
            lambda: supabase.table("users").select("id, full_name").order("id"),
            "id",
            [row["tenant_user_id"] for row in rows] + [row["owner_user_id"] for row in rows],
        )
    }
    props = {
        row["id"]: row
        for row in select_in(
            lambda: supabase.table("properties").select(PROPERTY_COLUMNS).order("id"),
            "id",
            [row["property_id"] for row in rows],
        )
    }
    out = []
    for row in rows:
        prop = props.get(row["property_id"]) or {}
        completed = row["status"] == COMPLETED
        answers, average = answers_of(row.get("answers")) if completed else ([], None)
        out.append({
            "id": row["id"],
            "status": STATUS_TO_WEB[row["status"]],
            "tenant_id": row["tenant_user_id"],
            "tenant_name": _name(people.get(row["tenant_user_id"])),
            "owner_id": row["owner_user_id"],
            "owner_name": _name(people.get(row["owner_user_id"])),
            "property_id": row["property_id"],
            "property_label": _property_label(prop),
            "suburb": prop.get("suburb"),
            "state": prop.get("state"),
            "requested_at": row["requested_at"],
            "decided_at": _decided_at(row),
            "answers": answers,
            "average": average,
            "comment": row.get("comment") if completed else None,
            "reason": row.get("decided_reason") if row["status"] == DECLINED else None,
            "visible_on_profile": bool(row.get("visible_on_profile")) if viewer_id == row["tenant_user_id"] else None,
        })
    return out


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------
def _row(request_id: str) -> dict | None:
    if not is_uuid(request_id):
        return None
    rows = _table().select("*").eq("id", request_id).limit(1).execute().data
    return rows[0] if rows else None


def _party_row(request_id: str, user_id: str) -> dict:
    """The request, if user_id is its tenant or its owner; 404 for anyone else, as for an unknown id."""
    row = _row(request_id)
    if row is None or user_id not in (row["tenant_user_id"], row["owner_user_id"]):
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return row


def list_mine(user_id: str, role: str) -> list[dict]:
    """A tenant's requests sent, or an owner's (web role landlord) requests received; newest first."""
    column = "tenant_user_id" if role == "tenant" else "owner_user_id"
    rows = select_all(lambda: _table().select("*").eq(column, user_id).order("requested_at", desc=True).order("id"))
    return _out(rows, user_id)


def get(request_id: str, user_id: str) -> dict:
    return _out([_party_row(request_id, user_id)], user_id)[0]


def public_summary(tenant_id: str) -> dict | None:
    """{"average", "count"} of the completed scorecards the tenant shows on their profile; None for none.

    The average is the mean of each scorecard's own average, to two decimals.
    An owner counts once per home, with their newest scorecard: one tenancy is
    one scorecard, however many rows another app left. Whether the tenant
    shares their score at all is public_profiles' check.
    """
    rows = select_all(
        lambda: _table().select("id, owner_user_id, property_id, answers, completed_at").eq("tenant_user_id", tenant_id)
        .eq("status", COMPLETED).eq("visible_on_profile", True).order("completed_at", desc=True).order("id")
    )
    newest: dict[tuple[str, str], dict] = {}
    for row in rows:
        newest.setdefault((row["owner_user_id"], row["property_id"]), row)
    averages = [average for row in newest.values() if (average := answers_of(row.get("answers"))[1]) is not None]
    if not averages:
        return None
    return {"average": round(sum(averages) / len(averages), 2), "count": len(averages)}


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------
def request(tenant_id: str, owner_id: str, property_id: str) -> dict:
    """Ask an owner or agent for a scorecard about one home; they are told."""
    found, _, _ = _eligible(tenant_id)
    link = found.get((owner_id, property_id))
    if link is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_ELIGIBLE)
    past = _history_of(tenant_id).get((owner_id, property_id), {})
    if past.get("completed"):
        raise HTTPException(status.HTTP_409_CONFLICT, ALREADY_COMPLETED)
    if past.get("wait"):
        until, why = past["wait"]
        raise HTTPException(status.HTTP_409_CONFLICT, WAIT_TO_ASK[why].format(day=_day(until)))
    try:
        created = _table().insert({
            "tenant_user_id": tenant_id,
            "owner_user_id": owner_id,
            "property_id": property_id,
            "agreement_id": link["agreement_id"],
            "application_id": link["application_id"],
            "status": PENDING,
        }).execute().data[0]
    except APIError as exc:
        # uq_scorecard_requests_pending: one is waiting already, sent earlier or at the same moment.
        if getattr(exc, "code", None) == "23505":
            raise HTTPException(status.HTTP_409_CONFLICT, ALREADY_PENDING) from None
        raise
    audit.record(tenant_id, "scorecard.requested", "scorecard_request", created["id"],
                 {"owner_id": owner_id, "property_id": property_id, "source": link["source"]})
    [out] = _out([created], tenant_id)
    notify(
        owner_id, NOTICE_KIND, f"Scorecard request from {out['tenant_name']}",
        f"{out['tenant_name']} asked you to complete a tenant scorecard for {out['property_label']}.", OWNER_LINK,
    )
    return out


def _still_pending(row: dict) -> None:
    if row["status"] != PENDING:
        raise HTTPException(status.HTTP_409_CONFLICT, ANSWERED.get(row["status"], CHANGED))


def _decide(row: dict, changes: dict, party_column: str, party_id: str) -> dict:
    """Write changes while the request is still PENDING; 409 when it was answered or cancelled meanwhile."""
    result = (
        _table().update(changes).eq("id", row["id"]).eq(party_column, party_id).eq("status", PENDING).execute()
    )
    if not result.data:
        _still_pending(_row(row["id"]) or row)
        raise HTTPException(status.HTTP_409_CONFLICT, CHANGED)
    return result.data[0]


def _owner_row(request_id: str, owner_id: str) -> dict:
    row = _party_row(request_id, owner_id)
    if row["owner_user_id"] != owner_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, ONLY_OWNER)
    _still_pending(row)
    return row


def _tenant_row(request_id: str, tenant_id: str) -> dict:
    row = _party_row(request_id, tenant_id)
    if row["tenant_user_id"] != tenant_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, ONLY_TENANT)
    return row


def submit(request_id: str, owner_id: str, answers: dict, comment: str | None) -> dict:
    """The owner's ratings for every item, and their comment; final. The tenant is told."""
    row = _owner_row(request_id, owner_id)
    now = _now()
    saved = _decide(row, {
        "status": COMPLETED,
        "answers": {key: answers[key] for key, _ in ITEMS},
        "comment": comment or None,
        "completed_at": now,
        "decided_at": now,
    }, "owner_user_id", owner_id)
    [out] = _out([saved], owner_id)
    # The parties and the home only: admins read the audit log, and only the two of them read the scorecard.
    audit.record(owner_id, "scorecard.completed", "scorecard_request", saved["id"],
                 {"tenant_id": saved["tenant_user_id"], "property_id": saved["property_id"]})
    notify(
        saved["tenant_user_id"], NOTICE_KIND, "Your scorecard is ready",
        f"{out['owner_name']} completed your tenant scorecard for {out['property_label']}: "
        f"{out['average']:.1f} out of 5.",
        TENANT_LINK,
    )
    return out


def decline(request_id: str, owner_id: str, reason: str | None) -> dict:
    """The owner says no, with their reason if they give one. The tenant is told."""
    row = _owner_row(request_id, owner_id)
    saved = _decide(row, {"status": DECLINED, "decided_reason": reason or None, "decided_at": _now()},
                    "owner_user_id", owner_id)
    [out] = _out([saved], owner_id)
    audit.record(owner_id, "scorecard.declined", "scorecard_request", saved["id"],
                 {"tenant_id": saved["tenant_user_id"], "property_id": saved["property_id"]})
    notify(
        saved["tenant_user_id"], NOTICE_KIND, "Scorecard request declined",
        f"{out['owner_name']} declined your request for a scorecard for {out['property_label']}."
        + (f" Their reason: {out['reason']}" if out["reason"] else ""),
        TENANT_LINK,
    )
    return out


def cancel(request_id: str, tenant_id: str) -> dict:
    """The tenant takes back a request still waiting for an answer. The owner is told."""
    row = _tenant_row(request_id, tenant_id)
    _still_pending(row)
    saved = _decide(row, {"status": CANCELLED, "decided_at": _now()}, "tenant_user_id", tenant_id)
    [out] = _out([saved], tenant_id)
    audit.record(tenant_id, "scorecard.cancelled", "scorecard_request", saved["id"],
                 {"owner_id": saved["owner_user_id"]})
    notify(
        saved["owner_user_id"], NOTICE_KIND, "Scorecard request cancelled",
        f"{out['tenant_name']} cancelled their request for a scorecard for {out['property_label']}. "
        "There is nothing to complete.",
        OWNER_LINK,
    )
    return out


def set_visibility(request_id: str, tenant_id: str, visible: bool) -> dict:
    """Show a completed scorecard on the tenant's public profile, or take it off."""
    row = _tenant_row(request_id, tenant_id)
    if row["status"] != COMPLETED:
        raise HTTPException(status.HTTP_409_CONFLICT, NOT_COMPLETED)
    result = (
        _table().update({"visible_on_profile": visible}).eq("id", row["id"]).eq("tenant_user_id", tenant_id)
        .eq("status", COMPLETED).execute()
    )
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    audit.record(tenant_id, "scorecard.visibility_changed", "scorecard_request", row["id"], {"visible": visible})
    return _out(result.data, tenant_id)[0]
