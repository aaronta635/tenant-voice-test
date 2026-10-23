"""The rental listings in supabase/seed.sql must read like real NSW rentals,
and the FAQs it seeds for the public /faqs page must call landlords landlords."""
import re
from pathlib import Path

SEED = Path(__file__).resolve().parents[2] / "supabase" / "seed.sql"
PLACEHOLDERS = ("Cityville", "Suburbia", "Campus Town", "Downtown", "Main St", "Oak Ave", "College Rd")
# Australia Post postcodes for the suburbs the demo listings use.
NSW_POSTCODES = {"Newtown": "2042", "Baulkham Hills": "2153", "Camperdown": "2050"}

LISTING = re.compile(
    r"insert into public\.properties \([^)]*\)\s*values \(u_owner, '(?P<title>[^']*)',\s*'[^']*',\s*"
    r"'(?P<address>[^']*)', '(?P<suburb>[^']*)', '(?P<state>[^']*)', '(?P<postcode>[^']*)'"
)
RENTAL_THREAD = re.compile(
    r"insert into public\.conversations \(owner_id, tenant_id, property_id, subject\)\s*"
    r"values \(u_owner, \w+, \w+, '(?P<subject>[^']*)'\)"
)
FAQS = re.compile(r"insert into public\.faqs .*?on conflict do nothing;", re.DOTALL)
FAQ_ROW = re.compile(r"\('(?P<audience>\w+)', '[^']*',\s*'(?P<answer>[^']*)', \d+\)")


def seed_text() -> str:
    return SEED.read_text(encoding="utf-8")


def seeded_listings() -> list[dict]:
    return [match.groupdict() for match in LISTING.finditer(seed_text())]


def test_seeded_listings_sit_in_real_nsw_suburbs():
    listings = seeded_listings()
    assert len(listings) == 3
    for listing in listings:
        assert listing["state"] == "NSW"
        assert NSW_POSTCODES.get(listing["suburb"]) == listing["postcode"], listing


def test_seed_shows_no_placeholder_places():
    text = seed_text()
    assert [word for word in PLACEHOLDERS if word in text] == []


def test_rental_threads_and_notifications_name_a_seeded_listing():
    text = seed_text()
    titles = {listing["title"] for listing in seeded_listings()}
    subjects = [match["subject"] for match in RENTAL_THREAD.finditer(text)]
    assert subjects and set(subjects) <= titles
    applications = re.findall(r"'New application for ([^']*)'", text)
    assert applications and set(applications) <= titles


def test_seeded_faqs_never_call_landlords_owners():
    # Sign-up and the other public pages call this role a landlord.
    faqs = FAQS.search(seed_text())
    assert faqs is not None
    assert re.findall(r"\bowners?\b", faqs[0], re.IGNORECASE) == []


def test_landlord_faqs_never_send_the_landlord_to_the_landlord():
    # Landlords read these answers, so "the landlord" would be the reader.
    faqs = FAQS.search(seed_text())
    answers = [match["answer"] for match in FAQ_ROW.finditer(faqs[0]) if match["audience"] == "landlord"]
    assert len(answers) == 5
    assert [answer for answer in answers if re.search(r"\bthe landlord\b", answer, re.IGNORECASE)] == []
