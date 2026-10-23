"""The E2E server's demo dataset (scripts/e2e_server.py), made through the app's own routes.

What a person makes in the app is made as they would make it, through the
API in process: members sign up, fill in their profiles and upload their
documents; an admin decides the documents, so the verified accounts are
verified by the real rule; landlords upload photos and publish listings;
tenants apply, book, message, review and report repairs; the provider
confirms and finishes a job. The rows are then the ones the app writes.

The test factories add only what no route makes: the staff accounts and an
agent, which the mobile app provisions; the web catalogue rows of
supabase/shared/0002_web_seed.sql; the date of one past booking, since no
route books a time that has passed; and the agent as the manager of the
Glebe studio, which the mobile app sets.

Every name, address, phone number and document is made up. seed() returns
the fixtures the journeys read from GET /e2e/fixtures.
"""

from __future__ import annotations

import json
import struct
import uuid
import zlib
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.core.supabase import get_supabase_client, web_table
from app.services import reviews as reviews_service
from tests import web_schema
from tests.factories_identity import users_row

SYDNEY = ZoneInfo("Australia/Sydney")
PASSWORD = "Demo-pass-2026"
API = "/api/v1"
# The listing photos: the landing page's own pictures, uploaded as a landlord uploads them.
PHOTOS = Path(__file__).resolve().parents[2] / "frontend" / "public" / "landing"
CATALOGUE_TABLES = ("service_categories", "subscription_plans", "faqs", "platform_settings")


@dataclass(frozen=True)
class Account:
    key: str
    email: str
    full_name: str
    role: str  # the web role: tenant, landlord, service_provider, admin, officer
    # Whether an admin approved the documents its verification needs (users.verification_status APPROVED).
    verified: bool
    # The login form's account type tab for it, or None for staff (the staff sign-in).
    tab: str | None


ACCOUNTS = (
    Account("tenant", "tara.nguyen@e2e.test", "Tara Nguyen", "tenant", True, "Tenant"),
    Account("applicant", "mia.rossi@e2e.test", "Mia Rossi", "tenant", True, "Tenant"),
    Account("tenant_pending", "tom.becker@e2e.test", "Tom Becker", "tenant", False, "Tenant"),
    Account("landlord", "lena.park@e2e.test", "Lena Park", "landlord", True, "Landlord"),
    Account("landlord_pending", "peter.walsh@e2e.test", "Peter Walsh", "landlord", False, "Landlord"),
    Account("agent", "alex.chen@e2e.test", "Alex Chen", "landlord", False, "Landlord"),
    Account("provider", "sam.okafor@e2e.test", "Sam Okafor", "service_provider", True, "Service provider"),
    Account("provider_pending", "paula.brennan@e2e.test", "Paula Brennan", "service_provider", False,
            "Service provider"),
    Account("admin", "ada.admin@e2e.test", "Ada Admin", "admin", False, None),
    Account("officer", "oscar.officer@e2e.test", "Oscar Officer", "officer", False, None),
)
# Accounts the mobile app provisions, with their shared primary role: no route signs them up.
PROVISIONED = {"admin": "ADMIN", "officer": "REGULATOR", "agent": "AGENT"}

# Tara's private details: none of them may reach a public page (tracker assumption #1).
TARA_PRIVATE = {
    "phone": "0412 555 019",
    "employer": "Harbourview Analytics",
    "job_title": "Data analyst",
    # With cents, so it cannot turn up by chance inside an id or a file hash of the page.
    "income": 91_234.56,
    "emergency_name": "Linh Nguyen",
    "emergency_phone": "0498 555 210",
    "emergency_email": "linh.nguyen@e2e.test",
    "previous_address": "14 Wattle Street",
    "previous_landlord": "Gary Holt",
    "previous_landlord_contact": "0400 555 777",
    "household_member": "Kai Nguyen",
    "notes": "Needs a quiet room for night shifts",
}


class SeedError(RuntimeError):
    """A route refused a step of the dataset: the app or the dataset changed."""


def demo_pdf(title: str) -> bytes:
    """A one-page PDF that reads "Demo document: <title>", what every demo document holds."""
    text = title.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)").encode("latin-1", "replace")
    stream = b"BT /F1 16 Tf 24 64 Td (Demo document: " + text + b") Tj ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 460 140] /Contents 4 0 R"
        b" /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def staff_id(key: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"tenantvoice:e2e:{key}"))


class Api:
    """The app's routes, called in process as one demo account or another."""

    def __init__(self, client: TestClient):
        self.client = client
        self.tokens: dict[str, str] = {}

    def call(self, method: str, path: str, who: str | None = None, ok=(200, 201, 202, 204), **kwargs):
        headers = {"Authorization": f"Bearer {self.tokens[who]}"} if who else {}
        response = self.client.request(method, f"{API}{path}", headers=headers, **kwargs)
        if response.status_code not in ok:
            raise SeedError(f"{method} {path} as {who or 'a visitor'}: {response.status_code} {response.text[:400]}")
        return response.json() if response.content else None

    def get(self, path, who=None, **kwargs):
        return self.call("GET", path, who, **kwargs)

    def post(self, path, who=None, **kwargs):
        return self.call("POST", path, who, **kwargs)

    def patch(self, path, who=None, **kwargs):
        return self.call("PATCH", path, who, **kwargs)

    def upload_document(self, who: str, document_type: str, name: str, **fields) -> dict:
        file = (f"{name}.pdf", demo_pdf(name), "application/pdf")
        data = {"document_type": document_type, **fields}
        return self.post("/me/documents", who, files={"file": file}, data=data)

    def upload_photo(self, who: str, name: str) -> str:
        path = PHOTOS / name
        file = (name, path.read_bytes(), "image/png") if path.exists() else (name, _plain_png(), "image/png")
        return self.post("/uploads/property-image", who, files={"file": file})["url"]


def _plain_png() -> bytes:
    """A small grey PNG, the listing photo when the frontend's pictures are not beside the backend."""
    width, height = 64, 40
    rows = b"".join(b"\x00" + b"\xb4\xbc\xc8" * width for _ in range(height))

    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


def _catalogue(db) -> None:
    """The web catalogue rows the shared project gets from supabase/shared/0002_web_seed.sql."""
    sql = web_schema.WEB_SEED_SQL.read_text(encoding="utf-8")
    for insert in web_schema.parse_inserts(sql, tables=set(CATALOGUE_TABLES)):
        db.seed(insert.table, insert.rows, schema="web")


def _provisioned(db, api: Api, account: Account) -> str:
    """A staff or agent account as the mobile app leaves it: an auth user and its rows, signed in."""
    user_id = staff_id(account.key)
    token = db.add_auth_user(account.email, PASSWORD)
    primary_role = PROVISIONED[account.key]
    db.seed("users", [users_row(user_id, account.email, primary_role, auth_user_id=db.tokens[token],
                                full_name=account.full_name, locale="en-AU", created_at=_now(), updated_at=_now())])
    db.seed("user_role_assignments", [{"id": staff_id(f"{account.key}-role"), "user_id": user_id,
                                       "role": primary_role, "is_primary": True}])
    if primary_role == "AGENT":
        db.seed("agent_profiles", [{"user_id": user_id, "agency_name": "Inner West Realty",
                                    "verification_status": "PENDING", "updated_at": _now(),
                                    "metadata": {"bio": "Property manager for owners across the Inner West."}}])
    api.tokens[account.key] = api.post("/auth/login", json={"email": account.email, "password": PASSWORD})[
        "access_token"]
    return user_id


def _decide(api: Api, user_id: str, decisions: dict[str, str | None]) -> None:
    """The admin's decisions on an account's waiting documents, by type: None approves, a text rejects."""
    item = api.get(f"/admin/verification/{user_id}", "admin")
    for document in item["documents"]:
        if document["document_type"] not in decisions:
            continue
        reason = decisions[document["document_type"]]
        api.post(f"/admin/documents/{document['id']}/decision", "admin", json={
            "decision": "REJECTED" if reason else "APPROVED", "reason": reason,
            "expected_updated_at": document["updated_at"],
        })


def seed(app) -> dict:
    """Fill the current fake with the demo dataset through the app's routes; returns the journeys' fixtures."""
    db = get_supabase_client()
    with TestClient(app, raise_server_exceptions=True) as client:
        return _build(db, Api(client))


def _build(db, api: Api) -> dict:
    from scripts import e2e_server

    today = datetime.now(SYDNEY).date()
    ids: dict[str, str] = {}
    _catalogue(db)

    # -- accounts: staff and the agent as provisioned, members as they sign up
    for account in ACCOUNTS:
        if account.key in PROVISIONED:
            ids[account.key] = _provisioned(db, api, account)
            continue
        session = api.post("/auth/register", json={"email": account.email, "password": PASSWORD,
                                                    "full_name": account.full_name, "role": account.role})
        api.tokens[account.key] = session["access_token"]
        ids[account.key] = session["profile"]["id"]

    # -- profiles
    api.patch("/profiles/me", "tenant", json={
        "phone": TARA_PRIVATE["phone"], "location": "Newtown", "state": "NSW", "postcode": "2042",
        "tenant": {
            "about_me": "Quiet professional who cooks a lot and looks after the places I rent.",
            "budget_min": 500, "budget_max": 750, "preferred_locations": ["Newtown", "Glebe"],
            "move_in_date": (today + timedelta(days=21)).isoformat(), "household_size": 2, "has_pets": False,
            "employment": {"types": ["full_time"], "employer": TARA_PRIVATE["employer"],
                           "job_title": TARA_PRIVATE["job_title"], "annual_income": TARA_PRIVATE["income"]},
            "household": {"members": [{"name": TARA_PRIVATE["household_member"], "age": 29,
                                       "relationship": "Partner"}]},
            "emergency_contact": {"name": TARA_PRIVATE["emergency_name"], "relationship": "Sister",
                                  "phone": TARA_PRIVATE["emergency_phone"], "email": TARA_PRIVATE["emergency_email"]},
            "rental_history": [{"address": TARA_PRIVATE["previous_address"], "suburb": "Marrickville", "state": "NSW",
                                "start_date": "2022-02-01", "end_date": "2025-12-31", "weekly_rent": 560,
                                "landlord_name": TARA_PRIVATE["previous_landlord"],
                                "landlord_contact": TARA_PRIVATE["previous_landlord_contact"],
                                "reason_for_leaving": "Moving closer to work", "bond_returned": "yes"}],
            "rental_preferences": {"property_types": ["apartment", "studio"], "bedrooms_min": 1,
                                   "notes": TARA_PRIVATE["notes"]},
        },
    })
    api.patch("/profiles/me", "applicant", json={
        "phone": "0413 555 201", "location": "Glebe", "state": "NSW",
        "tenant": {"about_me": "Nurse at RPA looking for a long lease close to work.", "budget_min": 550,
                   "budget_max": 800, "preferred_locations": ["Newtown"], "household_size": 1},
    })
    api.patch("/profiles/me", "tenant_pending", json={"location": "Parramatta", "state": "NSW"})
    api.patch("/profiles/me", "landlord", json={
        "phone": "0414 555 302", "location": "Newtown", "state": "NSW",
        "landlord": {"portfolio_size": 3, "bio": "I rent out three homes in the Inner West and answer within a day."},
    })
    api.patch("/profiles/me", "landlord_pending", json={"location": "Leichhardt", "state": "NSW"})

    # -- providers: profiles, services and hours
    api.post("/me/provider", "provider", json={
        "category": "tradie", "business_name": "Okafor Plumbing", "headline": "Licensed plumber, Inner West",
        "bio": "Licensed plumber fixing leaks, drains and hot water across the Inner West since 2014.",
        "years_experience": 11, "service_radius_km": 15,
    })
    api.patch("/profiles/me", "provider", json={"location": "Newtown", "state": "NSW", "phone": "0415 555 403"})
    services = {}
    for key, title, pricing, price, minutes in (
        ("drain", "Blocked drain clearing", "flat", 180, 60),
        ("tap", "Leaking tap repair", "hourly", 95, 60),
        ("hot_water", "Hot water system check", "from", 140, 90),
    ):
        services[key] = api.post("/me/services", "provider", json={
            "title": title, "pricing_type": pricing, "price": price, "duration_minutes": minutes,
            "description": f"{title} by a licensed plumber.", "service_area": "Inner West",
        })["id"]
    for day in range(7):
        api.post("/me/availability", "provider", json={"day_of_week": day, "start_time": "07:00",
                                                        "end_time": "19:00"})
    api.post("/me/provider", "provider_pending", json={
        "category": "cleaner", "business_name": "Brennan Cleaning",
        "bio": "End of lease and regular cleaning in the Hills district.",
    })
    api.post("/me/services", "provider_pending", json={"title": "End of lease clean", "price": 320,
                                                         "duration_minutes": 240,
                                                         "description": "Bond-back end of lease clean."})

    # -- documents, and the admin's decisions on them
    # A tenant's verification needs a passport, a driver licence and a Medicare card (review_profile_document).
    api.upload_document("tenant", "PASSPORT", "Tara Nguyen passport")
    api.upload_document("tenant", "DRIVERS_LICENCE", "Tara Nguyen driver licence")
    api.upload_document("tenant", "MEDICARE_CARD", "Tara Nguyen Medicare card")
    api.upload_document("tenant", "OTHER", "Payslip September", label="Payslip September", kind="payslip",
                        visibility="applications")
    api.upload_document("applicant", "DRIVERS_LICENCE", "Mia Rossi driver licence")
    api.upload_document("applicant", "PASSPORT", "Mia Rossi passport")
    api.upload_document("applicant", "MEDICARE_CARD", "Mia Rossi Medicare card")
    # Tom's passport waits for the admin journey; his other two are approved below.
    api.upload_document("tenant_pending", "PASSPORT", "Tom Becker passport")
    api.upload_document("tenant_pending", "DRIVERS_LICENCE", "Tom Becker driver licence")
    api.upload_document("tenant_pending", "MEDICARE_CARD", "Tom Becker Medicare card")
    # A landlord's and a provider's photo ID counts only as a GOVERNMENT_PHOTO_ID (verification_rules).
    api.upload_document("landlord", "GOVERNMENT_PHOTO_ID", "Lena Park passport")
    api.upload_document("landlord", "PROOF_OF_PROPERTY_OWNERSHIP", "Lena Park rates notice")
    api.upload_document("landlord_pending", "GOVERNMENT_PHOTO_ID", "Peter Walsh driver licence")
    api.upload_document("landlord_pending", "PROOF_OF_PROPERTY_OWNERSHIP", "Peter Walsh rates notice")
    api.upload_document("provider", "GOVERNMENT_PHOTO_ID", "Sam Okafor passport")
    api.upload_document("provider", "PUBLIC_LIABILITY_INSURANCE", "Okafor Plumbing insurance")
    api.upload_document("provider", "TRADE_LICENCE", "Okafor Plumbing licence")
    api.upload_document("provider_pending", "GOVERNMENT_PHOTO_ID", "Paula Brennan photo card")
    api.upload_document("provider_pending", "PUBLIC_LIABILITY_INSURANCE", "Brennan Cleaning insurance")
    _decide(api, ids["tenant"], {"PASSPORT": None, "DRIVERS_LICENCE": None, "MEDICARE_CARD": None})
    _decide(api, ids["applicant"], {"DRIVERS_LICENCE": None, "PASSPORT": None, "MEDICARE_CARD": None})
    _decide(api, ids["tenant_pending"], {"DRIVERS_LICENCE": None, "MEDICARE_CARD": None})
    _decide(api, ids["landlord"], {"GOVERNMENT_PHOTO_ID": None, "PROOF_OF_PROPERTY_OWNERSHIP": None})
    _decide(api, ids["provider"], {"GOVERNMENT_PHOTO_ID": None, "PUBLIC_LIABILITY_INSURANCE": None,
                                   "TRADE_LICENCE": None})
    api.patch("/me/provider", "provider", json={"is_published": True})

    # -- listings, published by the verified landlord with uploaded photos
    listings = {}
    for key, values, photos in (
        ("newtown", {
            "title": "Sunny two-bedroom apartment", "address": "21 King Street", "suburb": "Newtown",
            "postcode": "2042", "property_type": "apartment", "bedrooms": 2, "bathrooms": 1, "parking": 1,
            "price": 680, "bond": 2720, "available_from": (today + timedelta(days=14)).isoformat(),
            "amenities": ["Dishwasher", "Balcony", "Air conditioning"],
            "description": "Bright apartment on a quiet side of King Street, a short walk to the station.",
        }, ("gallery-2.png", "gallery-3.png")),
        ("glebe", {
            "title": "Garden studio near Glebe Point Road", "address": "5 Avon Street", "suburb": "Glebe",
            "postcode": "2037", "property_type": "studio", "bedrooms": 1, "bathrooms": 1, "parking": 0,
            "price": 520, "bond": 2080, "available_from": today.isoformat(),
            "amenities": ["Courtyard", "Internal laundry"],
            "description": "Self-contained studio opening onto a leafy shared garden.",
        }, ("gallery-4.png",)),
        ("marrickville", {
            "title": "Family house with a courtyard", "address": "9 Wilson Street", "suburb": "Marrickville",
            "postcode": "2204", "property_type": "house", "bedrooms": 3, "bathrooms": 2, "parking": 1,
            "price": 950, "bond": 3800, "available_from": (today + timedelta(days=30)).isoformat(),
            "amenities": ["Courtyard", "Dishwasher"],
            "description": "Three-bedroom house with a sunny courtyard and off-street parking.",
        }, ("gallery-1.png",)),
        # Fits all Tara's musts but the budget (an apartment in Newtown, free before she moves in), and
        # has no photo yet: the matches leave it out for its rent alone, and its card says "No photo yet".
        ("over_budget", {
            "title": "Top-floor apartment with a lift", "address": "88 King Street", "suburb": "Newtown",
            "postcode": "2042", "property_type": "apartment", "bedrooms": 2, "bathrooms": 1, "parking": 0,
            "price": 850, "bond": 3400, "available_from": (today + timedelta(days=7)).isoformat(),
            "amenities": ["Lift"],
            "description": "Two bedrooms on the top floor, with a lift and views over the rooftops.",
        }, ()),
    ):
        photo_urls = [api.upload_photo("landlord", name) for name in photos]
        created = api.post("/me/properties", "landlord", json={
            **values, "state": "NSW", "lease_term": "12 months", "photo_urls": photo_urls, "status": "available",
        })
        listings[key] = {"id": created["id"], "title": created["title"], "suburb": values["suburb"]}

    # -- applications: one waiting for the landlord, one approved
    applications = {
        "waiting": api.post("/applications", "applicant", json={
            "property_id": listings["newtown"]["id"], "move_in_date": (today + timedelta(days=14)).isoformat(),
            "occupants": 1, "about": "Nurse at RPA; non-smoker with references from two landlords.",
            "annual_income": 88_000, "message": "I can inspect any weekday after 4pm.",
        })["id"],
    }
    applications["approved"] = api.post("/applications", "tenant", json={
        "property_id": listings["glebe"]["id"], "move_in_date": today.isoformat(), "occupants": 1,
        "about": "Quiet professional, happy to sign a 12 month lease.", "annual_income": TARA_PRIVATE["income"],
    })["id"]
    api.patch(f"/applications/{applications['approved']}", "landlord",
              json={"status": "approved", "note": "Welcome! I will send the lease this week."})

    # -- the Glebe studio's agent, as the mobile app records one, and a scorecard Tara asked Lena for
    studio = db.table("listings").select("property_id").eq("id", listings["glebe"]["id"]).execute().data[0]
    db.table("properties").update({"manager_user_id": ids["agent"]}).eq("id", studio["property_id"]).execute()
    scorecard = api.post("/me/scorecard-requests", "tenant", json={
        "owner_user_id": ids["landlord"], "property_id": studio["property_id"]})["id"]

    # -- bookings: a finished job with its review, an enquiry waiting and a confirmed visit
    finished = api.post("/bookings", "applicant", json={
        "provider_id": ids["provider"], "service_id": services["drain"], "property_address": "40 Glebe Point Road",
        "property_suburb": "Glebe", "scheduled_date": (today + timedelta(days=1)).isoformat(),
        "scheduled_time": "09:00:00", "notes": "The bathroom drain is blocked.",
    })["id"]
    # No route books in the past: the job is moved to last week, as if that week had passed.
    web_table("bookings").update({"scheduled_date": (today - timedelta(days=7)).isoformat()}).eq(
        "id", finished).execute()
    for status in ("confirmed", "in_progress"):
        api.patch(f"/bookings/{finished}", "provider", json={"status": status})
    api.patch(f"/bookings/{finished}", "provider", json={
        "status": "completed", "completion_report": "Cleared the drain and checked the trap. No leaks."})
    provider_review = api.post("/reviews", "applicant", json={
        "booking_id": finished, "rating": 5, "comment": "Fixed our blocked drain in under an hour. Very tidy."})["id"]
    enquiry = api.post("/bookings", "tenant", json={
        "provider_id": ids["provider"], "service_id": services["tap"], "property_address": "5 Avon Street",
        "property_suburb": "Glebe", "scheduled_date": _weekday(today, 3).isoformat(), "scheduled_time": "10:00:00",
        "notes": "The bathroom tap drips all night.",
    })["id"]
    confirmed = api.post("/bookings", "landlord", json={
        "provider_id": ids["provider"], "service_id": services["hot_water"], "property_address": "9 Wilson Street",
        "property_suburb": "Marrickville", "scheduled_date": _weekday(today, 5).isoformat(),
        "scheduled_time": "14:00:00", "notes": "Annual check before new tenants move in.",
    })["id"]
    api.patch(f"/bookings/{confirmed}", "provider", json={"status": "confirmed"})

    # -- reviews: the tenant's review of the studio, which its landlord reports. It is written through
    # mobile_submit_review, which asks for all eight ratings (reviews.CATEGORIES).
    property_review = api.post(f"/properties/{listings['glebe']['id']}/reviews", "tenant", data={"review": json.dumps({
        "ratings": dict.fromkeys(reviews_service.CATEGORIES, 2), "title": "Lovely garden, slow repairs",
        "body": "Lovely garden, but the heater took five weeks to be fixed.",
    })})["id"]
    api.patch(f"/reviews/{property_review}/flag", "landlord")

    # -- a rental thread, two complaints, a repair assigned to the provider, a connection request
    thread = api.post("/conversations/rental", "tenant", json={
        "property_id": listings["newtown"]["id"],
        "body": "Hi Lena, is the King Street apartment free for an inspection this weekend?",
    })["id"]
    api.post(f"/conversations/{thread}/messages", "landlord",
             json={"body": "Hi Tara, yes. Saturday at 10am works; I will meet you at the front door."})
    complaint = api.post("/complaints", "tenant", json={
        # A complaint about a home the tenant rents goes through create_general_complaint, which takes the
        # general codes (complaint_categories.GENERAL) and a severity.
        "subject": "Heater still not repaired", "category": "PROPERTY_CONDITION", "severity": "HIGH",
        "against_id": ids["landlord"],
        "property_id": listings["glebe"]["id"],
        "description": "The heater in the studio has not worked for three weeks despite two requests.",
    })["id"]
    late = api.post("/complaints", "applicant", json={
        "subject": "Plumber arrived two hours late", "category": "OTHER", "against_id": ids["provider"],
        "description": "The plumber came two hours after the booked time and did not call ahead.",
    })["id"]
    repair = api.post("/maintenance", "tenant", json={
        "property_id": listings["glebe"]["id"], "title": "Leaking kitchen tap", "category": "PLUMBING",
        "description": "The kitchen tap drips constantly and the cabinet below is getting wet.",
        "access_notes": "Key in the lockbox, code 4471.",
    })["id"]
    api.post(f"/maintenance/{repair}/assign", "landlord", json={"provider_id": ids["provider"]})
    api.post("/me/connections", "applicant", json={"addressee_id": ids["tenant"]})

    return {
        "password": PASSWORD,
        "accounts": {account.key: {**asdict(account), "id": ids[account.key]} for account in ACCOUNTS},
        "listings": listings,
        "services": services,
        "applications": applications,
        "bookings": {"finished": finished, "enquiry": enquiry, "confirmed": confirmed},
        "reviews": {"provider": provider_review, "reported": property_review},
        "conversations": {"rental": thread},
        "complaints": {"heater": complaint, "late": late},
        "repairs": {"tap": repair},
        "scorecards": {"waiting": scorecard, "property": studio["property_id"]},
        # The listing page the import reads, which the server's fake network answers.
        "imports": {"listing": e2e_server.LISTING_URL, "title": "Renovated terrace near Wentworth Park",
                    "suburb": "Glebe", "postcode": "2037"},
        "private": {"tenant": [str(value) for value in TARA_PRIVATE.values()] + [ACCOUNTS[0].email]},
    }


def _weekday(today: date, days: int) -> date:
    """days after today, moved on past a weekend."""
    day = today + timedelta(days=days)
    while day.weekday() >= 5:
        day += timedelta(days=1)
    return day
