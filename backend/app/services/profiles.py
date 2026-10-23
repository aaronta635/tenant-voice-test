"""Web accounts on the shared database.

A web account is the person's public.users row, which the mobile app and the
rental web use too, plus its primary user_role_assignments row and the
profile row of its role (maps_identity.PROFILE_TABLES). ensure_user_for_auth()
makes, claims and completes them at each sign-in; get_account_by_auth_id()
keeps deactivated and closed accounts out, and suspended ones but a
provider's (maps_identity.account_block).

get_my_profile() and update_my_profile() are the member's own profile (R14):
the account fields and settings on the users row, and the details of their
role on its profile row, partly in its metadata (docs/shared-db.md, "Profile
details"). The settings are the switches the mobile app shares
(member_settings), and where the web holds no value of its own the member's
profile shows the mobile app's (mobile_profile). Nothing else returns those
details. This module is the only one
that writes tenant_profiles, landlord_profiles and agent_profiles, and the
profile fields and settings of users; admin_users.py writes its status and
account_verification.py its verification.
"""

import copy
import json
import logging
import uuid
from collections.abc import Callable
from datetime import date

from fastapi import HTTPException, status
from fastapi.exceptions import RequestValidationError
from postgrest.exceptions import APIError
from pydantic import BaseModel, ValidationError

from app.core.supabase import get_supabase_client
from app.schemas.profiles import (
    ACCOUNT_FIELD_CHECKS,
    EMPLOYMENT_TYPES,
    PROPERTY_TYPES,
    QUALITY_TAGS,
    EmergencyContactOut,
    EmergencyContactUpdate,
    EmploymentOut,
    EmploymentUpdate,
    HouseholdMember,
    HouseholdMemberOut,
    HouseholdUpdate,
    LandlordDetailsOut,
    QualitiesOut,
    QualitiesUpdate,
    RentalHistoryEntry,
    RentalHistoryEntryOut,
    RentalPreferencesOut,
    RentalPreferencesUpdate,
)
from app.services import audit, maps_identity, member_settings, mobile_profile, profile_completion
from app.services.shared_map import db_role, flatten_user, stamp_insert, stamp_update, web_role

logger = logging.getLogger(__name__)

# Postgres unique_violation: another request inserted the row first.
DUPLICATE_KEY = "23505"

TENANT_PROFILES = "tenant_profiles"
LANDLORD_PROFILES = "landlord_profiles"
AGENT_PROFILES = "agent_profiles"
# The profile row that holds a role section, by the account's primary role. The
# web treats an agent as a landlord, but their row is the mobile app's agent
# profile, which public profiles read for them.
ROLE_TABLES = {"TENANT": TENANT_PROFILES, "LANDLORD": LANDLORD_PROFILES, "AGENT": AGENT_PROFILES}
# The web roles that have a section, which is named after the role.
SECTION_ROLES = ("tenant", "landlord")
# The tenant section's tenant_profiles columns, and its keys in the row's metadata.
TENANT_COLUMNS = ("about_me", "budget_min", "budget_max", "preferred_locations", "move_in_date", "household_size",
                  "has_pets")
TENANT_METADATA_KEYS = ("employment", "household", "emergency_contact", "rental_history", "rental_preferences",
                        "qualities")
# The tenant metadata keys that hold an object, with the keys the web keeps in it.
TENANT_SECTION_KEYS = {
    name: tuple(model.model_fields)
    for name, model in (
        ("employment", EmploymentUpdate),
        ("household", HouseholdUpdate),
        ("emergency_contact", EmergencyContactUpdate),
        ("rental_preferences", RentalPreferencesUpdate),
        ("qualities", QualitiesUpdate),
    )
}
# Where the landlord section's fields live on each table: a column, else a metadata key.
LANDLORD_FIELDS = ("agency_name", "license_number", "portfolio_size", "bio")
LANDLORD_COLUMNS = {
    LANDLORD_PROFILES: ("agency_name", "license_number", "portfolio_size"),
    AGENT_PROFILES: ("agency_name", "license_number"),
}
# Lists of codes, by tenant metadata key and field, with the codes the web knows.
CODE_LISTS = (
    ("employment", "types", EMPLOYMENT_TYPES),
    ("rental_preferences", "property_types", PROPERTY_TYPES),
    ("qualities", "tags", QUALITY_TAGS),
)
# The account fields on the users row itself, and those kept in its metadata.
USER_COLUMNS = ("full_name", "avatar_url", "phone")
USER_METADATA_FIELDS = ("location", "state", "postcode")
# Ids for stored rental history entries that have none, from their content.
ENTRY_IDS = uuid.UUID("5d8f5f6e-3c1a-4f53-9d0e-2a64d1c3b7a1")
# A write that loses a race with another one starts again from the new row, this many times in all.
WRITE_ATTEMPTS = 3
CHANGED_ELSEWHERE = "Your profile changed while this was saving. Please try again."
# The tenant metadata keys that hold a list, and the words for every section in a refusal.
TENANT_LIST_KEYS = ("rental_history",)
SECTION_NAMES = {
    "employment": "employment details", "household": "household details", "emergency_contact": "emergency contact",
    "rental_history": "rental history", "rental_preferences": "rental preferences", "qualities": "tenant qualities",
    "notification_preferences": "notification settings", "privacy": "privacy settings",
}


def _users():
    return get_supabase_client().table("users")


def get_user_row(user_id: str) -> dict | None:
    result = _users().select("*").eq("id", user_id).is_("deleted_at", "null").limit(1).execute()
    return result.data[0] if result.data else None


def _rows_of_auth_user(auth_user_id: str) -> list[dict]:
    """Every users row of an auth user, closed ones too, oldest first."""
    return _users().select("*").eq("auth_user_id", auth_user_id).order("created_at").execute().data or []


def _open_row(rows: list[dict]) -> dict | None:
    return next((row for row in rows if not row.get("deleted_at")), None)


def _check_open(user: dict) -> dict:
    reason = maps_identity.account_block(user)
    if reason:
        raise HTTPException(status.HTTP_403_FORBIDDEN, reason)
    return user


def get_user_by_auth_id(auth_user_id: str) -> dict | None:
    """The auth user's users row; a closed one (deleted_at) does not count."""
    return _open_row(_rows_of_auth_user(auth_user_id))


def get_account_by_auth_id(auth_user_id: str) -> dict | None:
    """The users row an auth user signs in to, or None when there is none.

    403 when the account is closed (deleted_at, which
    archive_user_for_reregistration sets) or blocked (DEACTIVATED, or
    SUSPENDED for anyone but a provider, who still finishes the jobs in
    progress: maps_identity.account_block). Their tokens stay valid, so this
    runs on every request.
    """
    rows = _rows_of_auth_user(auth_user_id)
    user = _open_row(rows)
    if user is None:
        if rows:
            raise HTTPException(status.HTTP_403_FORBIDDEN, maps_identity.CLOSED_ACCOUNT)
        return None
    return _check_open(user)


def ensure_user_for_auth(
    auth_user_id: str, email: str, full_name: str, web_role_name: str, *, may_claim: bool = False
) -> dict:
    """The users row of an auth user, once the account has every row it needs.

    Runs at registration and at every sign-in. With no users row yet, a new
    one is made, unless an unclaimed one has the same email (no auth user).
    That row is taken over if a web sign-up made it and never finished
    (maps_identity.UNFINISHED_SIGNUP: it holds nothing yet), or if may_claim
    allows claiming another app's row by its email; otherwise 409, since the
    web cannot tell that this auth user owns the address. Either way the row
    gets its auth user last, after its role and profile rows exist, so a
    failure half way leaves an unfinished row that the next attempt completes
    and claims. A blocked or closed account gets 403 before anything is written.
    """
    user = get_account_by_auth_id(auth_user_id)
    if user is not None:
        _complete(user)
        return user

    email = maps_identity.normalized_email(email)
    unclaimed = _unclaimed_user(email)
    if unclaimed is None:
        user = _create_user(email, full_name, web_role_name)
    else:
        user = _check_open(unclaimed)
        if not (may_claim or maps_identity.unfinished_signup(user)):
            logger.warning("Not claiming users row %s for a new sign-in: claiming by email is off", user["id"])
            raise HTTPException(status.HTTP_409_CONFLICT, maps_identity.UNLINKED_ACCOUNT)
    _complete(user)
    user = _claim(user, auth_user_id, full_name)
    if unclaimed is not None:
        audit.record(user["id"], "auth.account_claimed", "profile", user["id"], {"auth_user_id": auth_user_id})
    return user


def _unclaimed_user(email: str) -> dict | None:
    """The open users row with this email that no auth user has, if there is exactly one.

    The address is compared ignoring case. A staff row (a staff primary role,
    or any staff role assignment) is never claimed by a sign-in, and several
    candidates are left alone rather than guessed at.
    """
    if not email:
        return None
    rows = (
        _users()
        .select("*")
        .ilike("email", maps_identity.ilike_exact(email))
        .is_("auth_user_id", "null")
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )
    rows = [row for row in rows if maps_identity.same_email(row.get("email"), email)]
    candidates = [row for row in rows if row.get("primary_role") not in maps_identity.STAFF_ROLES]
    staff = _staff_user_ids([row["id"] for row in candidates])
    candidates = [row for row in candidates if row["id"] not in staff]
    if len(candidates) == 1:
        return candidates[0]
    if rows:
        logger.warning("Not claiming users rows %s for a new sign-in: %s", [row["id"] for row in rows],
                       "several match its email" if candidates else "a staff account")
    return None


def _staff_user_ids(user_ids: list[str]) -> set[str]:
    """The users among user_ids that hold a staff role, whatever their primary role."""
    if not user_ids:
        return set()
    rows = (
        get_supabase_client()
        .table("user_role_assignments")
        .select("user_id")
        .in_("user_id", user_ids)
        .in_("role", sorted(maps_identity.STAFF_ROLES))
        .execute()
        .data
        or []
    )
    return {row["user_id"] for row in rows}


def _create_user(email: str, full_name: str, web_role_name: str) -> dict:
    # Self-service provisioning only ever creates the roles anyone may register
    # for; admin/officer accounts are provisioned by staff, never from user input.
    from app.schemas.auth import REGISTERABLE_ROLES

    if web_role_name not in REGISTERABLE_ROLES:
        logger.warning("Refused to provision a %r account for a new sign-in; using tenant", web_role_name)
        web_role_name = "tenant"
    # verification_status keeps its default (PENDING): PENDING_VERIFICATION is
    # an AccountStatus, not a verification value. The row is marked unfinished
    # until _claim() gives it its auth user.
    row = stamp_insert(
        "users",
        {
            "email": email,
            "full_name": full_name,
            "primary_role": db_role(web_role_name),
            "status": "ACTIVE",
            "locale": "en-AU",
            "metadata": {maps_identity.UNFINISHED_SIGNUP: True},
        },
    )
    try:
        return _users().insert(row).execute().data[0]
    except APIError as exc:
        # The address is another account's, one this sign-in may not take over (_unclaimed_user).
        if str(exc.code) == "23505" and "users_email_key" in f"{exc.message} {exc.details}":
            raise HTTPException(status.HTTP_409_CONFLICT, maps_identity.EMAIL_TAKEN) from exc
        raise


def _complete(user: dict) -> None:
    """Add the role assignment and profile row a web account still lacks.

    Only for the roles the web provisions: an agent or staff account keeps
    the rows the app that made it chose.
    """
    role = user.get("primary_role")
    table = maps_identity.PROFILE_TABLES.get(role)
    if table is None:
        return
    supabase = get_supabase_client()
    assigned = (
        supabase.table("user_role_assignments").select("role, is_primary").eq("user_id", user["id"]).execute().data
        or []
    )
    if all(row.get("role") != role for row in assigned):
        # The assignment of users.primary_role is the primary one (guard_primary_role_assignment), and a
        # person has one (user_role_assignments_one_primary_per_user_key): an older primary is unmarked first.
        if any(row.get("is_primary") for row in assigned):
            (
                supabase.table("user_role_assignments")
                .update({"is_primary": False})
                .eq("user_id", user["id"])
                .neq("role", role)
                .eq("is_primary", True)
                .execute()
            )
        _insert_missing("user_role_assignments", {"user_id": user["id"], "role": role, "is_primary": True})
    if not supabase.table(table).select("user_id").eq("user_id", user["id"]).limit(1).execute().data:
        _insert_missing(table, maps_identity.profile_row(role, user["id"]))


def _insert_missing(table: str, row: dict) -> None:
    try:
        get_supabase_client().table(table).insert(stamp_insert(table, row)).execute()
    except APIError as exc:
        if exc.code != DUPLICATE_KEY:
            raise


def _claim(user: dict, auth_user_id: str, full_name: str) -> dict:
    """user, now signed in to by auth_user_id; a row with no name takes the one given."""
    changes: dict = {"auth_user_id": auth_user_id}
    if not (user.get("full_name") or "").strip() and full_name:
        changes["full_name"] = full_name
    if maps_identity.unfinished_signup(user):
        changes["metadata"] = {k: v for k, v in user["metadata"].items() if k != maps_identity.UNFINISHED_SIGNUP}
    claimed = (
        _users()
        .update(stamp_update("users", changes))
        .eq("id", user["id"])
        .is_("auth_user_id", "null")
        .execute()
        .data
    )
    if claimed:
        return claimed[0]
    # Someone claimed the row between our read and this write.
    mine = get_user_by_auth_id(auth_user_id)
    if mine is not None:
        return mine
    raise HTTPException(status.HTTP_409_CONFLICT, "This account was just set up elsewhere. Please sign in again.")


def get_profile(profile_id: str) -> dict:
    user = get_user_row(profile_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    return flatten_user(user)


def get_profile_by_auth_id(auth_user_id: str) -> dict:
    """The profile an auth user signs in to: 403 when blocked or closed, 404 when there is none."""
    user = get_account_by_auth_id(auth_user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    return flatten_user(user)


# ---------------------------------------------------------------------------
# Your own profile (R14): the account, its settings and the details of its role
# ---------------------------------------------------------------------------
def get_my_profile(profile_id: str) -> dict:
    """Your profile as MyProfileOut, with what only you may read.

    A tenant's completion is worked out again, since the documents it counts
    may have changed, and stored when it moved.
    """
    user = get_user_row(profile_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    row = _role_row(user)
    profile = _my_profile(user, row)
    score = profile["completion"]["score"] if profile["completion"] else None
    if row is not None and score is not None and row.get("completion_score") != score:
        # Best effort: a write that loses a race leaves the newer row, which
        # stored its own score, and a failed one the next read tries again.
        try:
            _update_if_unchanged(TENANT_PROFILES, row, {"completion_score": score})
        except APIError as exc:
            logger.warning("Could not store the completion score of %s: %s", profile_id, exc)
    return profile


def update_my_profile(profile_id: str, payload: dict) -> dict:
    """Apply a patch (ProfileUpdate as JSON, only the keys sent) to your profile; returns MyProfileOut.

    The account fields and the settings go to the users row, a role section
    to that role's profile row, which is made (stamped) when the account has
    none yet. Metadata is merged: keys the mobile app or another module wrote
    stay, and so do list items and codes the web cannot read. A write never
    overwrites a change made since its read, but starts again from the new
    row. Every check runs before anything is written. A tenant's completion
    is worked out from the result and stored with it, and a save that
    changes what their matches read alerts them to new matches (R36).
    """
    sections = {name: payload.pop(name, None) for name in ("tenant", "landlord", "settings")}
    # Every account keeps a name, so a null full_name is ignored.
    fields = {key: value for key, value in payload.items() if value is not None or key != "full_name"}
    user = get_user_row(profile_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    fields = _changed_account_fields(user, fields)
    role = web_role(user.get("primary_role"))
    for section in SECTION_ROLES:
        if sections[section] is not None and role != section:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, f"Only {section} accounts have {section} details."
            )

    tenant = sections["tenant"] or {}
    evidence = _evidence(profile_id) if role == "tenant" else None
    if role == "tenant":
        # The checks across fields, before anything is written; the write runs them again on its own read.
        _tenant_changes(_role_row(user), tenant, user, evidence)
    if fields or sections["settings"]:
        user = _save_user(profile_id, fields, sections["settings"] or {})
    if role == "tenant":
        read: dict = {}

        def tenant_changes(row: dict | None) -> dict:
            read["row"] = row  # the row the saved changes were worked out on
            return _tenant_changes(row, tenant, user, evidence)

        row = _save_role_row(user, tenant_changes)
        _alert_if_preferences_changed(profile_id, read.get("row"), row)
    elif role == "landlord" and sections["landlord"]:
        landlord, table = sections["landlord"], ROLE_TABLES[user["primary_role"]]
        row = _save_role_row(user, lambda row: _landlord_changes(row, landlord, table))
    else:
        row = _role_row(user)
    return _my_profile(user, row, evidence)


def _alert_if_preferences_changed(tenant_id: str, before: dict | None, after: dict | None) -> None:
    """Alert the tenant to new strong matches when a save changed what matching reads (R36). Never raises.

    Once per change: a save that sends the values already stored, or another
    section, alerts nobody, and the alert itself sends each listing once.
    matching imports this module, so it is imported here.
    """
    from app.services import matching

    try:
        changed = matching.preferences_of(before) != matching.preferences_of(after)
    except Exception as exc:
        # The save stands either way.
        logger.error("could not tell whether %s changed their preferences: %s", tenant_id, exc)
        return
    if changed:
        matching.alert_matches_for_tenant(tenant_id)


def _changed_account_fields(user: dict, fields: dict) -> dict:
    """The account fields that change, each as its check (ACCOUNT_FIELD_CHECKS) reads it.

    A value sent as it is stored is left out unchecked, so a format another
    app saved never blocks saving another field. A changed value that fails
    its check is a 422, worded as FastAPI words a bad request body.
    """
    stored = flatten_user(user)
    changed, errors = {}, []
    for key, value in fields.items():
        if _as_text(value) == _as_text(stored.get(key)):
            continue
        try:
            changed[key] = ACCOUNT_FIELD_CHECKS[key].validate_python(value)
        except ValidationError as exc:
            errors += [{**error, "loc": ("body", key, *error["loc"])} for error in exc.errors(include_url=False)]
    if errors:
        raise RequestValidationError(errors)
    return changed


def _as_text(value) -> str | None:
    """A text field's value as a form sends it back: trimmed, and nothing for a blank."""
    return value.strip() or None if isinstance(value, str) else value


def _my_profile(user: dict, row: dict | None, evidence: tuple[list[dict], bool] | None = None) -> dict:
    """MyProfileOut; where the web holds no value of its own, the mobile app's is shown (mobile_profile)."""
    role = web_role(user.get("primary_role"))
    profile = {**flatten_user(user), "settings": settings_of(user), "tenant": None, "landlord": None,
               "completion": None}
    if role == "tenant":
        profile["tenant"] = tenant_details(row)
    elif role == "landlord":
        profile["landlord"] = landlord_details(row, ROLE_TABLES.get(user.get("primary_role"), LANDLORD_PROFILES))
    profile["from_mobile"] = mobile_profile.filled_in(profile, user)
    if role == "tenant":
        documents, reviewed_a_property = evidence or _evidence(user["id"])
        counted = {**user, "phone": profile["phone"]}
        profile["completion"] = profile_completion.completion(counted, profile["tenant"], documents,
                                                              reviewed_a_property)
    return profile


def _role_row(user: dict) -> dict | None:
    """The profile row of a tenant, landlord or agent; None for other roles, or when there is none."""
    table = ROLE_TABLES.get(user.get("primary_role"))
    if table is None:
        return None
    rows = get_supabase_client().table(table).select("*").eq("user_id", user["id"]).limit(1).execute().data
    return rows[0] if rows else None


def _evidence(user_id: str) -> tuple[list[dict], bool]:
    """What completion reads besides the profile: the tenant's documents, and whether they reviewed a property."""
    supabase = get_supabase_client()
    documents = (
        supabase.table("profile_documents")
        .select("document_type, review_status, web_type:metadata->>web_type")
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    # A property review first if there is one: provider reviews have no property.
    reviews = (
        supabase.table("reviews")
        .select("property_id")
        .eq("reviewer_user_id", user_id)
        .in_("status", ["PUBLISHED", "FLAGGED"])
        .order("property_id", nullsfirst=False)
        .limit(1)
        .execute()
        .data
        or []
    )
    return documents, bool(reviews and reviews[0].get("property_id"))


# -- writing ------------------------------------------------------------------
def _save_user(profile_id: str, fields: dict, settings: dict) -> dict:
    def changes(user: dict) -> dict:
        update = {key: fields[key] for key in USER_COLUMNS if key in fields and fields[key] != user.get(key)}
        meta = _metadata(user)
        meta_changes = {key: fields[key] for key in USER_METADATA_FIELDS if key in fields}
        # The switches go to the mobile app's keys (member_settings), merged with the location's changes.
        meta_changes.update(member_settings.changes(meta, settings))
        new_meta = merged(meta, meta_changes)
        if new_meta != meta:
            update["metadata"] = new_meta
        return update

    return _write("users", lambda: get_user_row(profile_id), changes)


def _save_role_row(user: dict, changes: Callable[[dict | None], dict]) -> dict | None:
    """Write a section to the user's role profile row, which is made when they have none yet."""
    return _write(
        ROLE_TABLES[user["primary_role"]],
        lambda: _role_row(user),
        changes,
        new_row=lambda update: {**maps_identity.profile_row(user["primary_role"], user["id"]), **update},
    )


def _write(
    table: str,
    read: Callable[[], dict | None],
    changes: Callable[[dict | None], dict],
    new_row: Callable[[dict], dict] | None = None,
) -> dict | None:
    """Read a row, work out the changes to it and write them, unless the row changed in between.

    A row another write changed since the read (its updated_at moved) is read
    again and the changes worked out anew, so neither write is lost;
    WRITE_ATTEMPTS lost races are a 409. With no row, new_row(changes) is the
    row to insert, or the answer is 404. Returns the row as it now stands.
    """
    for _ in range(WRITE_ATTEMPTS):
        row = read()
        if row is None and new_row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
        update = changes(row)
        if not update:
            return row
        saved = _insert(table, new_row(update)) if row is None else _update_if_unchanged(table, row, update)
        if saved is not None:
            return saved
    raise HTTPException(status.HTTP_409_CONFLICT, CHANGED_ELSEWHERE)


def _insert(table: str, row: dict) -> dict | None:
    """The inserted row, or None when another request made it first."""
    try:
        return get_supabase_client().table(table).insert(stamp_insert(table, row)).execute().data[0]
    except APIError as exc:
        if exc.code != DUPLICATE_KEY:
            raise
        return None


def _update_if_unchanged(table: str, row: dict, changes: dict) -> dict | None:
    """row with changes written, or None if another write changed it since it was read."""
    key = "id" if table == "users" else "user_id"
    query = (
        get_supabase_client()
        .table(table)
        .update(stamp_update(table, changes))
        .eq(key, row[key])
        .eq("updated_at", row["updated_at"])
    )
    if table == "users":
        query = query.is_("deleted_at", "null")
    rows = query.execute().data
    return rows[0] if rows else None


def _tenant_changes(row: dict | None, section: dict, user: dict, evidence: tuple[list[dict], bool]) -> dict:
    """The tenant_profiles changes a tenant section makes to row, with the completion score they lead to."""
    stored = row or {}
    update = {}
    for column in TENANT_COLUMNS:
        if column in section:
            value = section[column] if column != "has_pets" else section[column] is True
            if value != stored.get(column):
                update[column] = value
    meta = _metadata(stored)
    # A copy: this runs again on every new read, and the section must stay as sent.
    meta_changes = copy.deepcopy({key: section[key] for key in TENANT_METADATA_KEYS if key in section})
    for key in meta_changes:
        _refuse_another_shape(meta, key, list if key in TENANT_LIST_KEYS else dict)
    for key, keys in TENANT_SECTION_KEYS.items():
        if key in meta_changes:
            meta_changes[key] = _cleared(meta_changes[key], keys)
    # A section the form filled in from the mobile app's details saves them with the fields it changed.
    mobile_profile.start_from_mobile(meta_changes, tenant_details(stored), user)
    _keep_what_the_web_cannot_read(meta, meta_changes)
    new_meta = merged(meta, meta_changes)
    if new_meta != meta:
        update["metadata"] = new_meta

    after = {**stored, **update}
    _check_tenant(after, section)
    score = profile_completion.completion(*mobile_profile.completion_inputs(user, tenant_details(after)),
                                          *evidence)["score"]
    if score != stored.get("completion_score", 0):
        update["completion_score"] = score
    return update


def _check_tenant(row: dict, section: dict) -> None:
    """The rules that span fields, on the row as it would be saved; only those the patch touches.

    Rows the mobile app wrote may break them already, which must not block
    an unrelated edit.
    """
    if "budget_min" in section or "budget_max" in section:
        low, high = _number(row.get("budget_min")), _number(row.get("budget_max"))
        if low is not None and high is not None and low > high:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "The minimum budget can't be more than the maximum."
            )
    if "emergency_contact" in section:
        contact = _metadata(row).get("emergency_contact")
        contact = contact if isinstance(contact, dict) else {}
        named = bool(contact.get("name"))
        reachable = bool(contact.get("phone") or contact.get("email"))
        if (reachable or contact.get("relationship")) and not named:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Add your emergency contact's name.")
        if named and not reachable:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Add a phone number or email for your emergency contact."
            )


def _landlord_changes(row: dict | None, section: dict, table: str) -> dict:
    stored = row or {}
    columns = LANDLORD_COLUMNS[table]
    update = {
        column: section[column] for column in columns if column in section and section[column] != stored.get(column)
    }
    meta = _metadata(stored)
    new_meta = merged(meta, {key: section[key] for key in LANDLORD_FIELDS if key in section and key not in columns})
    if new_meta != meta:
        update["metadata"] = new_meta
    return update


def _refuse_another_shape(meta: dict, key: str, shape: type) -> None:
    """409 when another app stored a section as something else (text, say): a save would overwrite it.

    The web reads such a section as empty, and cannot merge into it.
    """
    if key in meta and meta[key] is not None and not isinstance(meta[key], shape):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Your {SECTION_NAMES[key]} were saved by another app in a form this page cannot change. "
            "Update them in that app.",
        )


def _keep_what_the_web_cannot_read(meta: dict, meta_changes: dict) -> None:
    """Add to list patches what the stored lists hold that the web never showed, so a save cannot drop it.

    Rental history entries and household members the web cannot read (see
    _items) stay after the ones sent; a sent entry keeps the keys another
    app added to its stored copy; codes the web does not know stay in their
    lists. A null list keeps those too.
    """
    if "rental_history" in meta_changes:
        stored = meta.get("rental_history")
        sent = [_with_id(entry) for entry in meta_changes["rental_history"] or []]
        meta_changes["rental_history"] = _kept(stored, sent, RentalHistoryEntry, by_id=True) or None
    household = meta_changes.get("household")
    if isinstance(household, dict) and "members" in household:
        stored = meta["household"].get("members") if isinstance(meta.get("household"), dict) else None
        sent = [_compact(member) for member in household["members"] or []]
        household["members"] = _kept(stored, sent, HouseholdMember) or None
    for key, field, known in CODE_LISTS:
        change = meta_changes.get(key)
        if isinstance(change, dict) and field in change:
            stored = meta[key].get(field) if isinstance(meta.get(key), dict) else None
            foreign = [code for code in stored if code not in known] if isinstance(stored, list) else []
            change[field] = [*(change[field] or []), *foreign] or None


def _kept(stored, sent: list[dict], model: type[BaseModel], by_id: bool = False) -> list:
    """sent, each item with the keys another app added to its stored copy, then the items the web cannot read.

    An entry is its stored copy by id; an item without one (a household
    member) is the first stored copy the web showed with the same values.
    """
    _readable, unreadable = _items(model, stored)
    known = set(model.model_fields)
    items = [(index, item) for index, item in enumerate(stored if isinstance(stored, list) else [])
             if isinstance(item, dict)]
    if by_id:
        by_key = {_entry_id(item, index): item for index, item in items}
        sent = [{**{k: v for k, v in by_key.get(item["id"], {}).items() if k not in known}, **item} for item in sent]
        return [*sent, *unreadable]
    shown = [(_compact(_shown(model, item) or {}), item) for _index, item in items]
    with_extras = []
    for item in sent:
        match = next((pair for pair in shown if pair[0] == item), None)
        if match:
            shown.remove(match)
            item = {**{k: v for k, v in match[1].items() if k not in known}, **item}
        with_extras.append(item)
    return [*with_extras, *unreadable]


def _shown(model: type[BaseModel], item: dict) -> dict | None:
    """A stored item as the web shows it (model's view of its known keys); None when the web cannot."""
    try:
        return model.model_validate({key: item[key] for key in model.model_fields if key in item}).model_dump()
    except ValidationError:
        return None


def _cleared(value: dict | None, keys: tuple[str, ...]) -> dict:
    """A section's patch; a null clears only the web's own keys in it, never another app's."""
    return {key: None for key in keys} if value is None else value


def _with_id(entry: dict) -> dict:
    """A rental history entry as stored: its id (a new one if it had none) and the values it holds."""
    return {"id": entry.get("id") or str(uuid.uuid4()), **_compact(entry)}


def _compact(item: dict) -> dict:
    """A list item without its empty values, as the web stores it."""
    return {key: value for key, value in item.items() if value is not None}


def merged(stored: dict, changes: dict) -> dict:
    """stored with changes applied as a patch: objects merge key by key and a null removes a key.

    Any other value, a list included, replaces what was there, and an object
    left empty goes. Keys the changes do not name stay as they were.
    """
    result = dict(stored)
    for key, value in changes.items():
        if isinstance(value, dict):
            current = result.get(key)
            value = merged(current if isinstance(current, dict) else {}, value) or None
        if value is None:
            result.pop(key, None)
        else:
            result[key] = value
    return result


# -- reading --------------------------------------------------------------------
def settings_of(user: dict) -> dict:
    """A member's notification and privacy settings (SettingsOut), from the keys the mobile app shares."""
    meta = _metadata(user)
    return {
        "notification_preferences": member_settings.notification_preferences(meta),
        "privacy": member_settings.privacy(meta),
    }


def tenant_details(row: dict | None) -> dict:
    """A tenant_profiles row as TenantDetailsOut. Values held in another shape read as empty."""
    row = row or {}
    meta = _metadata(row)
    employment = _read(EmploymentOut, meta.get("employment"))
    household = meta.get("household") if isinstance(meta.get("household"), dict) else {}
    members, _others = _items(HouseholdMember, household.get("members"))
    history, _others = _items(RentalHistoryEntry, meta.get("rental_history"))
    preferences = _read(RentalPreferencesOut, meta.get("rental_preferences"))
    qualities = _read(QualitiesOut, meta.get("qualities"))
    # Only the codes a save may send back, so a code another app wrote never blocks one.
    employment["types"] = [code for code in employment["types"] if code in EMPLOYMENT_TYPES]
    preferences["property_types"] = [code for code in preferences["property_types"] if code in PROPERTY_TYPES]
    qualities["tags"] = [code for code in qualities["tags"] if code in QUALITY_TAGS]
    return {
        "about_me": _string(row.get("about_me")),
        "budget_min": _number(row.get("budget_min")),
        "budget_max": _number(row.get("budget_max")),
        "preferred_locations": _strings(row.get("preferred_locations")),
        "move_in_date": _date(row.get("move_in_date")),
        "household_size": _integer(row.get("household_size")),
        "has_pets": row.get("has_pets") is True,
        "employment": employment,
        "household": {
            "members": [HouseholdMemberOut(**member).model_dump() for member in members],
            "pets": _string(household.get("pets")),
        },
        "emergency_contact": _read(EmergencyContactOut, meta.get("emergency_contact")),
        "rental_history": [RentalHistoryEntryOut(**entry).model_dump() for entry in history],
        "rental_preferences": preferences,
        "qualities": qualities,
    }


def landlord_details(row: dict | None, table: str) -> dict:
    """A landlord_profiles or agent_profiles row as LandlordDetailsOut."""
    row, columns = row or {}, LANDLORD_COLUMNS[table]
    meta = _metadata(row)
    values = {key: row.get(key) if key in columns else meta.get(key) for key in LANDLORD_FIELDS}
    return _read(LandlordDetailsOut, values)


def _read(model: type[BaseModel], value) -> dict:
    """A stored object as model reads it; a field it holds in another shape reads as the default."""
    known = {name: value[name] for name in model.model_fields if name in value} if isinstance(value, dict) else {}
    try:
        return model.model_validate(known).model_dump()
    except ValidationError as exc:
        unreadable = {error["loc"][0] for error in exc.errors() if error["loc"]}
        return model.model_validate({k: v for k, v in known.items() if k not in unreadable}).model_dump()


def _items(model: type[BaseModel], value) -> tuple[list[dict], list]:
    """A stored list, split into the items the web can show and save back unchanged, and the rest as stored.

    An item counts when its known keys pass model, the check a save makes,
    so sending it back never fails. Another app's item that does not (no
    address, a rent over the cap) is not shown; saves keep it (_kept). An
    entry's id is read as text (_entry_id).
    """
    readable, unreadable = [], []
    for index, item in enumerate(value if isinstance(value, list) else []):
        if not isinstance(item, dict):
            unreadable.append(item)
            continue
        known = {key: item[key] for key in model.model_fields if key in item}
        if "id" in model.model_fields:
            known["id"] = _entry_id(item, index)
        try:
            readable.append(model.model_validate(known).model_dump())
        except ValidationError:
            unreadable.append(item)
    return readable, unreadable


def _entry_id(entry: dict, index: int) -> str:
    """A stored entry's id as text; one without, the same id at every read of the entry at that place.

    The place in the list tells two identical entries apart.
    """
    value = entry.get("id")
    if isinstance(value, (str, int)) and not isinstance(value, bool) and str(value):
        return str(value)
    return str(uuid.uuid5(ENTRY_IDS, f"{index}:{json.dumps(entry, sort_keys=True, default=str)}"))


def _metadata(row: dict | None) -> dict:
    meta = (row or {}).get("metadata")
    return dict(meta) if isinstance(meta, dict) else {}


def _string(value) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def _strings(value) -> list[str]:
    items = value.split(",") if isinstance(value, str) else value if isinstance(value, list) else []
    return [item.strip() for item in items if isinstance(item, str) and item.strip()]


def _number(value) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and abs(number) != float("inf") else None


def _integer(value) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _date(value) -> date | None:
    try:
        return date.fromisoformat(value[:10]) if isinstance(value, str) else None
    except ValueError:
        return None
