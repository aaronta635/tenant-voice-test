"""Your own profile: the account fields, plus the private details of your role (R14).

GET and PATCH /profiles/me are the only endpoints that send or take the
role sections and settings below; every other response that names a member
is built from its own allowlist (docs/shared-db.md, "Profile details").

A PATCH is a patch at every level: a key left out keeps what is stored and
a null clears it, inside a section too. Lists are replaced whole. The *Update
models check what may be stored; the *Out models read back whatever the
shared rows hold, which the mobile app writes as well.
"""

import re
from datetime import date, datetime, timedelta
from typing import Annotated, Literal, get_args
from zoneinfo import ZoneInfo

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StrictBool,
    StringConstraints,
    TypeAdapter,
    field_validator,
    model_validator,
)

# The web's notification kinds (maps_messaging.WEB_TO_NOTIFICATION_CATEGORY),
# which notify() is given; each has a switch of the same name below.
NOTIFICATION_KINDS = ("message", "review", "booking", "application", "property", "account")
EmploymentType = Literal[
    "full_time", "part_time", "self_employed", "contractor", "student", "retired", "unemployed",
    "working_holiday", "other",
]
# The web's property types (shared_map.WEB_TO_PROPERTY_TYPE), so preferences compare with listings.
PropertyType = Literal["apartment", "house", "studio", "townhouse", "unit", "duplex"]
QualityTag = Literal[
    "reliable_rent", "clear_communication", "cares_for_property", "respectful_neighbour", "long_term_stay",
]
BondReturned = Literal["yes", "no", "partial", "pending"]
EMPLOYMENT_TYPES = get_args(EmploymentType)
PROPERTY_TYPES = get_args(PropertyType)
QUALITY_TAGS = get_args(QualityTag)

PHONE_CHARACTERS = re.compile(r"\+?[0-9 ()-]+")
SYDNEY = ZoneInfo("Australia/Sydney")
# The earliest tenancy a rental history may record.
EARLIEST_TENANCY = date(1950, 1, 1)
# How far from today a move-in date may be.
MOVE_IN_PAST = timedelta(days=365)
MOVE_IN_AHEAD = timedelta(days=2 * 365)


def sydney_today() -> date:
    return datetime.now(SYDNEY).date()


def _blank_to_none(value):
    """A cleared text box arrives as "": store it as nothing, not as an empty string."""
    return None if isinstance(value, str) and not value.strip() else value


def _phone(value: str) -> str:
    digits = sum(char.isdigit() for char in value)
    if not PHONE_CHARACTERS.fullmatch(value) or not 6 <= digits <= 15:
        raise ValueError("Enter a phone number of 6 to 15 digits")
    return value


def _matching(pattern: str, message: str) -> AfterValidator:
    """Text that must match pattern whole, or fail with a message a person can act on."""
    compiled = re.compile(pattern)

    def check(value: str) -> str:
        if not compiled.fullmatch(value):
            raise ValueError(message)
        return value

    return AfterValidator(check)


def _distinct(values: list) -> list:
    """values without repeats, keeping the first of each; text compares ignoring case."""
    seen, kept = set(), []
    for value in values:
        key = value.casefold() if isinstance(value, str) else value
        if key not in seen:
            seen.add(key)
            kept.append(value)
    return kept


def _text(max_length: int, min_length: int = 1):
    return Annotated[str, StringConstraints(strip_whitespace=True, min_length=min_length, max_length=max_length)]


def _optional(kind):
    return Annotated[kind | None, BeforeValidator(_blank_to_none)]


Name = _text(120)
ShortText = _text(200)
Note = _text(1000)
About = _text(2000)
Place = _text(80)
StateName = _text(40)
Relationship = _text(60)
Phone = Annotated[_text(30), AfterValidator(_phone)]
Email = Annotated[_text(254), _matching(r"[^@\s]+@[^@\s]+\.[^@\s]+", "Enter a valid email address")]
Postcode = Annotated[_text(10), _matching(r"\d{4}", "Enter a 4-digit postcode")]
ImageUrl = Annotated[_text(2048), _matching(r"https?://\S+", "Use a web address that starts with https://")]
Licence = Annotated[
    _text(40), _matching(r"[A-Za-z0-9 ./-]+", "Use only letters, numbers, spaces, dots, slashes and dashes")
]
# Opaque: the web's are uuids, the mobile app's may be anything of this shape.
EntryId = Annotated[_text(64), _matching(r"[A-Za-z0-9_-]+", "Not an entry id")]
# Dollars a week; the upper bound catches a typo (a yearly figure, an extra zero).
WeeklyAmount = Annotated[float, Field(ge=0, le=20_000)]
AnnualIncome = Annotated[float, Field(ge=0, le=10_000_000)]
Rooms = Annotated[int, Field(ge=0, le=10)]
Age = Annotated[int, Field(ge=0, le=120)]
HouseholdSize = Annotated[int, Field(ge=1, le=20)]
PortfolioSize = Annotated[int, Field(ge=0, le=10_000)]


class _Section(BaseModel):
    """A section of the patch: an unknown key is a mistake, not something to drop silently."""

    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------------------
# Tenant: tenant_profiles columns, plus private keys in its metadata
# ---------------------------------------------------------------------------
class EmploymentUpdate(_Section):
    types: Annotated[list[EmploymentType], Field(max_length=9), AfterValidator(_distinct)] | None = None
    employer: _optional(Name) = None
    job_title: _optional(Name) = None
    annual_income: AnnualIncome | None = None
    notes: _optional(Note) = None


class HouseholdMember(_Section):
    name: Name
    age: Age | None = None
    relationship: _optional(Relationship) = None


class HouseholdUpdate(_Section):
    members: Annotated[list[HouseholdMember], Field(max_length=10)] | None = None
    pets: _optional(ShortText) = None


class EmergencyContactUpdate(_Section):
    name: _optional(Name) = None
    relationship: _optional(Relationship) = None
    phone: _optional(Phone) = None
    email: _optional(Email) = None


class RentalHistoryEntry(_Section):
    """One self-reported tenancy. The list is sent whole; an entry without an id gets one."""

    id: EntryId | None = None
    address: ShortText
    suburb: _optional(Place) = None
    state: _optional(StateName) = None
    start_date: date | None = None
    end_date: date | None = None
    current: StrictBool = False
    weekly_rent: WeeklyAmount | None = None
    landlord_name: _optional(Name) = None
    landlord_contact: _optional(ShortText) = None
    reason_for_leaving: _optional(ShortText) = None
    bond_returned: BondReturned | None = None

    @model_validator(mode="after")
    def dates_in_order(self):
        today = sydney_today()
        if self.start_date and not EARLIEST_TENANCY <= self.start_date <= today:
            raise ValueError("A tenancy must start between 1950 and today")
        if self.current and self.end_date:
            raise ValueError("A current address has no end date")
        if self.end_date and not EARLIEST_TENANCY <= self.end_date <= today:
            raise ValueError("A past tenancy must end between 1950 and today; tick current if you still live there")
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("A tenancy cannot end before it starts")
        return self


class RentalPreferencesUpdate(_Section):
    property_types: Annotated[list[PropertyType], Field(max_length=6), AfterValidator(_distinct)] | None = None
    bedrooms_min: Rooms | None = None
    bathrooms_min: Rooms | None = None
    parking_min: Rooms | None = None
    notes: _optional(Note) = None


class QualitiesUpdate(_Section):
    tags: Annotated[list[QualityTag], Field(max_length=5), AfterValidator(_distinct)] | None = None
    notes: _optional(Note) = None


class TenantDetailsUpdate(_Section):
    # tenant_profiles columns. about_me, the budget, the suburbs and the
    # move-in month are public (services/public_profiles.py).
    about_me: _optional(About) = None
    budget_min: WeeklyAmount | None = None
    budget_max: WeeklyAmount | None = None
    preferred_locations: Annotated[list[Place], Field(max_length=10), AfterValidator(_distinct)] | None = None
    move_in_date: date | None = None
    household_size: HouseholdSize | None = None
    has_pets: StrictBool | None = None
    # tenant_profiles.metadata: private to the tenant.
    employment: EmploymentUpdate | None = None
    household: HouseholdUpdate | None = None
    emergency_contact: EmergencyContactUpdate | None = None
    rental_history: Annotated[list[RentalHistoryEntry], Field(max_length=20)] | None = None
    rental_preferences: RentalPreferencesUpdate | None = None
    qualities: QualitiesUpdate | None = None

    @field_validator("move_in_date")
    @classmethod
    def move_in_within_reach(cls, value: date | None) -> date | None:
        today = sydney_today()
        if value is not None and not today - MOVE_IN_PAST <= value <= today + MOVE_IN_AHEAD:
            raise ValueError("Choose a move-in date between a year ago and two years from today")
        return value


class EmploymentOut(BaseModel):
    types: list[str] = []
    employer: str | None = None
    job_title: str | None = None
    annual_income: float | None = None
    notes: str | None = None


class HouseholdMemberOut(BaseModel):
    name: str
    age: int | None = None
    relationship: str | None = None


class HouseholdOut(BaseModel):
    members: list[HouseholdMemberOut] = []
    pets: str | None = None


class EmergencyContactOut(BaseModel):
    name: str | None = None
    relationship: str | None = None
    phone: str | None = None
    email: str | None = None


class RentalHistoryEntryOut(BaseModel):
    id: str
    address: str
    suburb: str | None = None
    state: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    current: bool = False
    weekly_rent: float | None = None
    landlord_name: str | None = None
    landlord_contact: str | None = None
    reason_for_leaving: str | None = None
    bond_returned: str | None = None


class RentalPreferencesOut(BaseModel):
    property_types: list[str] = []
    bedrooms_min: int | None = None
    bathrooms_min: int | None = None
    parking_min: int | None = None
    notes: str | None = None


class QualitiesOut(BaseModel):
    tags: list[str] = []
    notes: str | None = None


class TenantDetailsOut(BaseModel):
    about_me: str | None = None
    budget_min: float | None = None
    budget_max: float | None = None
    preferred_locations: list[str] = []
    move_in_date: date | None = None
    household_size: int | None = None
    has_pets: bool = False
    employment: EmploymentOut = Field(default_factory=EmploymentOut)
    household: HouseholdOut = Field(default_factory=HouseholdOut)
    emergency_contact: EmergencyContactOut = Field(default_factory=EmergencyContactOut)
    rental_history: list[RentalHistoryEntryOut] = []
    rental_preferences: RentalPreferencesOut = Field(default_factory=RentalPreferencesOut)
    qualities: QualitiesOut = Field(default_factory=QualitiesOut)


# ---------------------------------------------------------------------------
# Landlord: landlord_profiles columns, plus its metadata
# ---------------------------------------------------------------------------
class LandlordDetailsUpdate(_Section):
    agency_name: _optional(Name) = None
    license_number: _optional(Licence) = None
    portfolio_size: PortfolioSize | None = None
    # landlord_profiles.metadata.bio: the about line of the public profile.
    bio: _optional(Note) = None


class LandlordDetailsOut(BaseModel):
    agency_name: str | None = None
    license_number: str | None = None
    portfolio_size: int | None = None
    bio: str | None = None


# ---------------------------------------------------------------------------
# Every member: users.metadata.mobile.notificationPreferences and .privacySettings,
# shared with the mobile app (services/member_settings.py has the keys)
# ---------------------------------------------------------------------------
class NotificationPreferencesUpdate(_Section):
    # Off: no notice at all but account and security ones (the app's pushEnabled).
    push_enabled: StrictBool | None = None
    # The mobile app's categories: match alerts, repairs, applications and profile updates.
    matches: StrictBool | None = None
    repairs: StrictBool | None = None
    application: StrictBool | None = None
    profile_updates: StrictBool | None = None
    # The web's other kinds; property is listing and complaint updates.
    message: StrictBool | None = None
    review: StrictBool | None = None
    booking: StrictBool | None = None
    property: StrictBool | None = None
    # Accepted, but account notices always go.
    account: StrictBool | None = None


class PrivacyUpdate(_Section):
    public_profile: StrictBool | None = None
    discoverable: StrictBool | None = None
    show_contact: StrictBool | None = None
    show_availability: StrictBool | None = None
    allow_messages: StrictBool | None = None
    share_score: StrictBool | None = None


class SettingsUpdate(_Section):
    notification_preferences: NotificationPreferencesUpdate | None = None
    privacy: PrivacyUpdate | None = None


class NotificationPreferencesOut(BaseModel):
    """On unless the member turned a switch off; account notices always go."""

    push_enabled: bool = True
    matches: bool = True
    repairs: bool = True
    application: bool = True
    profile_updates: bool = True
    message: bool = True
    review: bool = True
    booking: bool = True
    property: bool = True
    account: bool = True


class PrivacyOut(BaseModel):
    # False takes the member out of the public profiles, in both apps.
    public_profile: bool = True
    # False keeps a public profile out of the searches; its page still opens.
    discoverable: bool = True
    # The mobile app's: whether it shows the member's email and phone. The website never does.
    show_contact: bool = False
    # The mobile app's: whether it shows whether the member is looking.
    show_availability: bool = True
    # The mobile app's: whether members may start a conversation with them there.
    allow_messages: bool = True
    # Whether owners may see the tenant's scorecard once they can (R43).
    share_score: bool = True


class SettingsOut(BaseModel):
    notification_preferences: NotificationPreferencesOut = Field(default_factory=NotificationPreferencesOut)
    privacy: PrivacyOut = Field(default_factory=PrivacyOut)


# ---------------------------------------------------------------------------
# Completion (services/profile_completion.py)
# ---------------------------------------------------------------------------
class CompletionItemOut(BaseModel):
    key: str
    label: str
    description: str
    kind: Literal["required", "booster"]
    done: bool
    # False while the feature it needs is not built: it cannot be done yet.
    available: bool = True


class ProfileCompletionOut(BaseModel):
    score: int
    status: Literal["started", "almost_ready", "ready"]
    required_done: int
    required_total: int
    boosters_done: int
    boosters_total: int
    items: list[CompletionItemOut]
    # The keys of the rows still to do, required first; unavailable rows are left out.
    missing: list[str]


# ---------------------------------------------------------------------------
# The profile
# ---------------------------------------------------------------------------
class ProfileOut(BaseModel):
    id: str
    role: str
    full_name: str
    # users.email, which the shared database holds for every account (NOT NULL).
    email: str | None = None
    avatar_url: str | None = None
    phone: str | None = None
    location: str | None = None
    state: str | None = None
    postcode: str | None = None
    created_at: datetime
    updated_at: datetime


class MyProfileOut(ProfileOut):
    """ProfileOut with what only its owner may read; tenant and landlord are null for other roles."""

    settings: SettingsOut
    tenant: TenantDetailsOut | None = None
    landlord: LandlordDetailsOut | None = None
    # Tenants only: their renter profile's completeness.
    completion: ProfileCompletionOut | None = None
    # The fields shown from the mobile app's details, where the web holds none
    # (services/mobile_profile.py): "phone", "tenant.emergency_contact", ...
    from_mobile: list[str] = []


# The checks of the account fields, which profiles.update_my_profile runs on
# the values that change only: one the mobile app stored in another format
# (a phone such as 0412.345.678) is sent back unchanged by the forms, and
# must not block saving another field.
ACCOUNT_FIELD_CHECKS = {
    "full_name": TypeAdapter(Name),
    "avatar_url": TypeAdapter(_optional(ImageUrl)),
    "phone": TypeAdapter(_optional(Phone)),
    "location": TypeAdapter(_optional(Place)),
    "state": TypeAdapter(_optional(StateName)),
    "postcode": TypeAdapter(_optional(Postcode)),
}


class ProfileUpdate(BaseModel):
    # Text, checked by ACCOUNT_FIELD_CHECKS once compared with what is
    # stored. Every account keeps a name, so a null full_name is ignored.
    full_name: str | None = None
    avatar_url: str | None = None
    phone: str | None = None
    location: str | None = None
    state: str | None = None
    postcode: str | None = None
    tenant: TenantDetailsUpdate | None = None
    landlord: LandlordDetailsUpdate | None = None
    settings: SettingsUpdate | None = None
