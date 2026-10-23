"""The details the mobile app keeps for a member, as the web's own profile shows them (R14).

The mobile app keeps a member's profile in users.metadata.mobile, in the
shapes mobile_public_profile_json reads: personalDetails (phone, suburb,
city, aboutMe, ...), emergencyContact ({name or fullName, phone, ...}),
householdMembers ([{fullName, ...}]), addressHistory or rentalHistory
([{id, suburb, state, city, weeklyRent, isCurrent, leaseEndDate, ...}]) and
employmentStatus.types. Where the web holds none of its own, the member's
own profile (GET /profiles/me) shows the mobile app's value, so a member who
starts in the app finds their forms filled in. Nothing here is written to the
mobile keys: a save writes the web's own keys (services/profiles.py), and a
section saved from a filled-in form starts from the values it showed
(start_from_mobile), so a patch of one field keeps the others.

Only the member reads these: no other response is built from them.
"""

import copy
import json
import re
import uuid

from pydantic import ValidationError

from app.schemas.profiles import ACCOUNT_FIELD_CHECKS, EMPLOYMENT_TYPES, HouseholdMember, RentalHistoryEntry

MOBILE = "mobile"
# Ids for the mobile app's address entries that have none, from their content.
ENTRY_IDS = uuid.UUID("0b6f2f1e-7a52-4d0e-9a51-58f1d1c3a6e2")
ENTRY_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
# The mobile app's employment codes, compared without case, spaces, dashes or underscores.
EMPLOYMENT_CODES = {
    **{code.replace("_", ""): code for code in EMPLOYMENT_TYPES},
    "freelance": "contractor",
    "freelancer": "contractor",
    "notworking": "unemployed",
    "jobseeker": "unemployed",
    "workingholidaymaker": "working_holiday",
}
HISTORY_LIMIT = 20
HOUSEHOLD_LIMIT = 10


def _object(value) -> dict:
    return value if isinstance(value, dict) else {}


def _text(*values) -> str | None:
    """The first value that is text with something in it, trimmed."""
    for value in values:
        if isinstance(value, str) and value.strip():
            return " ".join(value.split())
    return None


def _day(value) -> str | None:
    return value[:10] if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value[:10]) else None


def _number(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    return number if number == number and abs(number) != float("inf") else None


def mobile_of(user: dict | None) -> dict:
    """users.metadata.mobile, when it is an object."""
    return _object(_object((user or {}).get("metadata")).get(MOBILE))


# -- the mobile app's details, in the web's shapes ----------------------------
def personal(mobile: dict) -> dict:
    """{phone, location, about_me} from personalDetails (and tenantBio), each None when it has none."""
    details = _object(mobile.get("personalDetails"))
    return {
        "phone": _text(details.get("phone"), details.get("phoneNumber")),
        "location": _text(details.get("suburb"), details.get("city")),
        "about_me": _text(details.get("aboutMe"), mobile.get("tenantBio")),
    }


def emergency_contact(mobile: dict) -> dict:
    contact = _object(mobile.get("emergencyContact"))
    return {
        "name": _text(contact.get("name"), contact.get("fullName")),
        "relationship": _text(contact.get("relationship")),
        "phone": _text(contact.get("phone"), contact.get("phoneNumber")),
        "email": _text(contact.get("email")),
    }


def household_members(mobile: dict) -> list[dict]:
    """The household members the web can show and save back (HouseholdMember's check)."""
    members = []
    items = mobile.get("householdMembers")
    for item in items if isinstance(items, list) else []:
        item = _object(item)
        age = item.get("age")
        member = {
            "name": _text(item.get("fullName"), item.get("name")),
            "age": age if isinstance(age, int) and not isinstance(age, bool) else None,
            "relationship": _text(item.get("relationship")),
        }
        try:
            members.append(HouseholdMember.model_validate(member).model_dump())
        except ValidationError:
            continue
    return members[:HOUSEHOLD_LIMIT]


def rental_history(mobile: dict) -> list[dict]:
    """addressHistory (else rentalHistory) as the web's entries; one the web cannot save back is left out."""
    items = mobile.get("addressHistory")
    if not isinstance(items, list):
        items = mobile.get("rentalHistory")
    entries = []
    for index, item in enumerate(items if isinstance(items, list) else []):
        if isinstance(item, dict) and (entry := _history_entry(item, index)):
            entries.append(entry)
    return entries[:HISTORY_LIMIT]


def _history_entry(item: dict, index: int) -> dict | None:
    suburb = _text(item.get("suburb"), item.get("city"))
    state = _text(item.get("state"))
    current = item.get("isCurrent") is True
    entry = {
        "id": _entry_id(item, index),
        # An entry without a street is shown by its suburb and state, as the mobile app shows it.
        "address": _text(item.get("address"), item.get("streetAddress"), item.get("fullAddress"))
        or (", ".join(part for part in (suburb, state) if part) or None),
        "suburb": suburb,
        "state": state,
        "start_date": _day(item.get("leaseStartDate") or item.get("startDate") or item.get("moveInDate")),
        # A current address has no end date on the web: its lease end is still ahead.
        "end_date": None if current else _day(item.get("leaseEndDate") or item.get("endDate")),
        "current": current,
        "weekly_rent": _number(item.get("weeklyRent")),
        "landlord_name": _text(item.get("landlordName"), item.get("ownerName"), item.get("agentName")),
        "reason_for_leaving": _text(item.get("reasonForLeaving")),
    }
    # Dates the web's checks refuse (a lease end still ahead) are left out before the whole entry is.
    for attempt in (entry, {**entry, "start_date": None, "end_date": None}):
        try:
            return RentalHistoryEntry.model_validate(attempt).model_dump()
        except ValidationError:
            continue
    return None


def _entry_id(item: dict, index: int) -> str:
    value = item.get("id")
    if isinstance(value, (str, int)) and not isinstance(value, bool) and ENTRY_ID.fullmatch(str(value)):
        return str(value)
    return str(uuid.uuid5(ENTRY_IDS, f"{index}:{json.dumps(item, sort_keys=True, default=str)}"))


def employment_types(mobile: dict) -> list[str]:
    """employmentStatus.types as the web's codes; one the web does not know is left out."""
    types = _object(mobile.get("employmentStatus")).get("types")
    codes = []
    for value in types if isinstance(types, list) else []:
        code = EMPLOYMENT_CODES.get(re.sub(r"[\s_-]", "", value).lower()) if isinstance(value, str) else None
        if code and code not in codes:
            codes.append(code)
    return codes


# -- the member's own view -----------------------------------------------------
def _passes(field: str, value: str) -> bool:
    try:
        ACCOUNT_FIELD_CHECKS[field].validate_python(value)
    except ValidationError:
        return False
    return True


def filled_in(profile: dict, user: dict) -> list[str]:
    """Fill in profile (MyProfileOut's account fields and tenant section) where the web holds none; what was filled.

    Changes profile in place. The names are those of the response:
    "phone", "location", "tenant.about_me", "tenant.employment.types",
    "tenant.household.members", "tenant.emergency_contact",
    "tenant.rental_history".
    """
    mobile = mobile_of(user)
    if not mobile:
        return []
    filled = []
    details = personal(mobile)
    for field in ("phone", "location"):
        # Only a value the web's own check takes: the form sends it back with any other change, and a format
        # the app saved (a phone with dots, a long suburb) would then block that save.
        if not profile.get(field) and details[field] and _passes(field, details[field]):
            profile[field] = details[field]
            filled.append(field)
    tenant = profile.get("tenant")
    if tenant is None:
        return filled
    if not tenant.get("about_me") and details["about_me"]:
        tenant["about_me"] = details["about_me"]
        filled.append("tenant.about_me")
    for name, value in tenant_sections(mobile, tenant).items():
        if name == "employment":
            tenant["employment"]["types"] = value["types"]
            filled.append("tenant.employment.types")
        elif name == "household":
            tenant["household"]["members"] = value["members"]
            filled.append("tenant.household.members")
        else:
            tenant[name] = value
            filled.append(f"tenant.{name}")
    return filled


def tenant_sections(mobile: dict, tenant: dict) -> dict:
    """The tenant sections the mobile app fills in, for a tenant section (TenantDetailsOut) that has none of them.

    {"employment": {"types"}, "household": {"members"}, "emergency_contact": {...},
    "rental_history": [...]}, each only when the web holds none and the app does.
    """
    sections: dict = {}
    if not tenant["employment"]["types"] and (types := employment_types(mobile)):
        sections["employment"] = {"types": types}
    if not tenant["household"]["members"] and (members := household_members(mobile)):
        sections["household"] = {"members": members}
    contact = emergency_contact(mobile)
    if not any(tenant["emergency_contact"].values()) and any(contact.values()):
        sections["emergency_contact"] = contact
    if not tenant["rental_history"] and (history := rental_history(mobile)):
        sections["rental_history"] = history
    return sections


def completion_inputs(user: dict, tenant: dict) -> tuple[dict, dict]:
    """The users row and tenant section (TenantDetailsOut) that completion counts: filled in as the member sees them."""
    view = {"phone": user.get("phone"), "location": None, "tenant": copy.deepcopy(tenant)}
    filled_in(view, user)
    return {**user, "phone": view["phone"]}, view["tenant"]


def start_from_mobile(meta_changes: dict, shown: dict, user: dict) -> None:
    """Start a tenant patch's sections from the mobile app's values they showed (in place).

    shown is the tenant section as stored on the web (TenantDetailsOut).
    A section the web had none of showed the app's values, and a form sends
    only the fields that changed: so the employment types, the household
    members and the emergency contact it showed go into the save, under the
    fields the patch sends, which win. A list sent whole (the rental
    history, or members sent) is the patch's own.
    """
    sections = tenant_sections(mobile_of(user), shown)
    for name in ("employment", "household", "emergency_contact"):
        patch = meta_changes.get(name)
        if name in sections and isinstance(patch, dict):
            meta_changes[name] = {**copy.deepcopy(sections[name]), **patch}
