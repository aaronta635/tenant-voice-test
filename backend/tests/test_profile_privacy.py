"""A member's private profile details reach nobody but the member (R14).

The tenant saves every private detail through PATCH /profiles/me, the path
the app uses. A landlord she applied to, messaged and connected with then
reads every endpoint that shows her, and a visitor reads her public profile:
none of their responses holds a private value or one of the keys they are
kept under. Her own GET /profiles/me holds them all.
"""

import json
from datetime import timedelta

import pytest

from app.schemas.profiles import sydney_today
from app.services import public_profiles
from tests.factories_identity import verify
from tests.factories_messaging import connection, person, seed_listing

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
MEI = "c0000000-0000-4000-8000-000000000001"
OLLY = "c0000000-0000-4000-8000-000000000002"

PRIVATE_DETAILS = {
    "household_size": 3,
    "has_pets": True,
    "employment": {"types": ["full_time"], "employer": "Quokka Mining Pty", "job_title": "Night Auditor",
                   "annual_income": 123457.25, "notes": "PRIVATE-EMPLOYMENT-NOTE"},
    "household": {"members": [{"name": "Bertie Householder", "age": 41, "relationship": "Uncle"}],
                  "pets": "SECRET-PET-DETAIL"},
    "emergency_contact": {"name": "Ines Emergency", "relationship": "Sister", "phone": "0499 111 999",
                          "email": "ines.emergency@private.example"},
    "rental_history": [{"address": "77 Secret Lane", "suburb": "Hiddenvale", "start_date": "2020-03-01",
                        "end_date": (sydney_today() - timedelta(days=60)).isoformat(), "weekly_rent": 612.75,
                        "landlord_name": "Larry Formerlandlord", "landlord_contact": "larry@private.example",
                        "reason_for_leaving": "PRIVATE-REASON", "bond_returned": "partial"}],
    "rental_preferences": {"property_types": ["townhouse"], "bedrooms_min": 3, "notes": "PRIVATE-PREFERENCE-NOTE"},
    "qualities": {"tags": ["respectful_neighbour"], "notes": "PRIVATE-QUALITY-NOTE"},
}
# Shown on her public card: an about line, a budget, suburbs and a move-in month.
PUBLIC_DETAILS = {
    "about_me": "Quiet nurse.", "budget_min": 400, "budget_max": 650, "preferred_locations": ["Newtown"],
    "move_in_date": (sydney_today() + timedelta(days=45)).isoformat(),
}
SETTINGS = {"notification_preferences": {"booking": False}, "privacy": {"share_score": False}}

# The numbers have decimals, which no uuid or timestamp in a response can hold.
SECRETS = [
    "Quokka Mining", "Night Auditor", "123457.25", "PRIVATE-EMPLOYMENT-NOTE", "Bertie Householder", "SECRET-PET-DETAIL",
    "Ines Emergency", "0499 111 999", "ines.emergency@private.example", "77 Secret Lane", "Hiddenvale", "612.75",
    "Larry Formerlandlord", "larry@private.example", "PRIVATE-REASON", "PRIVATE-PREFERENCE-NOTE",
    "PRIVATE-QUALITY-NOTE",
]
# An application has a has_pets of its own: what the tenant declared on it.
PRIVATE_KEYS = [
    "household_size", "employment", "household", "emergency_contact", "rental_history",
    "rental_preferences", "qualities", "settings", "notification_preferences", "privacy", "share_score",
    "completion", "license_number",
]


@pytest.fixture(autouse=True)
def fresh_scans(monkeypatch):
    monkeypatch.setattr(public_profiles, "_scans", {})
    monkeypatch.setattr(public_profiles, "SCAN_TTL_SECONDS", 0)


@pytest.fixture
def shared(client, strict_schema, as_profile):
    """Mei, with every private detail saved, has applied to, messaged and connected with Olly's listing."""
    strict_schema.seed("users", [person(MEI, "TENANT", "Mei Lin"), person(OLLY, "LANDLORD", "Olly Owner")])
    # Verified, as applying needs (services/gates.py).
    verify(strict_schema, MEI)
    strict_schema.seed("tenant_profiles", [{"user_id": MEI, "updated_at": "2026-01-01T00:00:00+00:00"}])
    strict_schema.seed("connection_requests", [connection(MEI, OLLY)])
    listing = seed_listing(strict_schema, OLLY)

    as_profile(id=OLLY, role="landlord")
    saved_landlord = client.patch(f"{API}/profiles/me", json={"landlord": {"license_number": "LIC-PRIVATE-77"}})
    as_profile(id=MEI, role="tenant")
    saved = client.patch(f"{API}/profiles/me", json={"tenant": {**PRIVATE_DETAILS, **PUBLIC_DETAILS},
                                                     "settings": SETTINGS})
    applied = client.post(f"{API}/applications", json={"property_id": listing, "message": "Keen to apply"})
    messaged = client.post(f"{API}/conversations/rental", json={"property_id": listing, "body": "Is it free?"})
    for response in (saved_landlord, saved, applied, messaged):
        assert response.status_code in (200, 201), response.text
    return {"listing": listing, "thread": messaged.json()["id"], "own": saved.json()}


def _responses(client, as_profile, shared) -> dict[str, str]:
    """Every response that shows Mei to Olly or to a visitor, as text."""
    as_profile(id=OLLY, role="landlord")
    reads = {
        "public search": client.get(f"{API}/public/profiles", params={"role": "tenant"}),
        "public profile": client.get(f"{API}/public/profiles/{MEI}"),
        "landlord's public profile": client.get(f"{API}/public/profiles/{OLLY}"),
        "profile search": client.get(f"{API}/profiles/search", params={"search": "Mei"}),
        "connections": client.get(f"{API}/me/connections"),
        "applications": client.get(f"{API}/properties/{shared['listing']}/applications"),
        "conversations": client.get(f"{API}/conversations"),
        "thread": client.get(f"{API}/conversations/{shared['thread']}"),
        "messages": client.get(f"{API}/conversations/{shared['thread']}/messages"),
    }
    for name, response in reads.items():
        assert response.status_code == 200, (name, response.text)
    return {name: response.text for name, response in reads.items()}


def test_her_own_profile_holds_every_private_detail(shared):
    own = shared["own"]
    assert own["tenant"]["employment"]["employer"] == "Quokka Mining Pty"
    assert own["tenant"]["emergency_contact"]["phone"] == "0499 111 999"
    assert own["tenant"]["rental_history"][0]["address"] == "77 Secret Lane"
    assert own["settings"]["privacy"]["share_score"] is False
    text = json.dumps(own)
    assert all(secret in text for secret in SECRETS)


def test_no_other_response_shows_a_private_detail_or_its_key(client, as_profile, shared):
    responses = _responses(client, as_profile, shared)

    # Each read does show Mei, so a missing detail is held back, not absent.
    assert "Mei" in responses["public profile"] and "Mei Lin" in responses["applications"]
    assert "Mei Lin" in responses["connections"] and "Mei" in responses["conversations"]
    for name, text in responses.items():
        for secret in [*SECRETS, "LIC-PRIVATE-77"]:
            assert secret not in text, (name, secret)
        for key in PRIVATE_KEYS:
            assert f'"{key}"' not in text, (name, key)
    # Her application says nothing about pets, so her profile's answer stays hers.
    [application] = json.loads(responses["applications"])
    assert application["has_pets"] is False


def test_the_public_card_shows_only_what_is_meant_to_be_public(client, as_profile, shared):
    card = json.loads(_responses(client, as_profile, shared)["public profile"])

    assert (card["about"], card["budget_min"], card["budget_max"], card["areas"]) == (
        "Quiet nurse.", 400.0, 650.0, ["Newtown"],
    )
    assert card["move_in_month"] == PUBLIC_DETAILS["move_in_date"][:7]
