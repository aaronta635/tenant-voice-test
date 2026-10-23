import json

from postgrest.exceptions import APIError
from pydantic import SecretStr

from app.core.config import settings
from app.services import reviews
from app.services.shared_map import (
    db_listing_status,
    db_role,
    flatten_listing,
    web_application_status,
    web_listing_status,
)
from tests.factories import NOW
from tests.factories_rental import user_row


OWNER = "c1111111-1111-4111-8111-111111111111"
TENANT = "c3333333-3333-4333-8333-333333333333"
LISTING = "b2222222-2222-4222-8222-222222222222"
PROPERTY_ROW = "b1111111-1111-4111-8111-111111111111"


def _seed_rental(fake_db):
    # Both verified, as publishing and applying need (services/gates.py).
    fake_db.seed("users", [user_row(OWNER, "Olivia Owner", "LANDLORD", verification_status="APPROVED"),
                           user_row(TENANT, "Tanya Tenant", verification_status="APPROVED")])
    fake_db.seed(
        "properties",
        [
            {
                "id": PROPERTY_ROW,
                "owner_user_id": OWNER,
                "nickname": "Harbour flat",
                "address_line_1": "1 Harbour Street",
                "suburb": "Wollongong",
                "state": "NSW",
                "postcode": "2500",
                "property_type": "APARTMENT",
                "bedrooms": 2,
                "bathrooms": 1,
                "parking_spaces": 1,
                "metadata": {"amenities": ["Balcony"]},
                "created_at": NOW,
                "updated_at": NOW,
            }
        ],
    )
    fake_db.seed(
        "listings",
        [
            {
                "id": LISTING,
                "property_id": PROPERTY_ROW,
                "created_by_user_id": OWNER,
                "title": "Harbour flat",
                "description": "Sunny two bedroom apartment.",
                "weekly_rent": 650,
                "bond_amount": 2600,
                "status": "PUBLISHED",
                "created_at": NOW,
                "updated_at": NOW,
            }
        ],
    )


def test_shared_map_preserves_web_contract_values():
    assert db_role("landlord") == "LANDLORD"
    assert db_listing_status("available") == "PUBLISHED"
    assert web_listing_status("LEASED") == "rented"
    assert web_application_status("SHORTLISTED") == "reviewing"

    listing = {"id": LISTING, "created_by_user_id": OWNER, "weekly_rent": 650, "status": "PUBLISHED"}
    property_row = {"id": PROPERTY_ROW, "address_line_1": "1 Harbour Street", "property_type": "APARTMENT"}
    flattened = flatten_listing(listing, property_row)
    assert flattened["id"] == LISTING
    assert flattened["owner_id"] == OWNER
    assert flattened["status"] == "available"
    assert flattened["property_type"] == "apartment"


def test_listing_application_and_property_review_flow(client, fake_db, as_profile):
    _seed_rental(fake_db)

    # The public endpoint exposes the listing id, rather than the private
    # properties-row id, so it can be used consistently by applications.
    public = client.get(f"/api/v1/properties/{LISTING}")
    assert public.status_code == 200
    assert public.json()["id"] == LISTING
    assert public.json()["price"] == 650

    as_profile(id=TENANT, role="tenant")
    application = client.post(
        "/api/v1/applications",
        json={"property_id": LISTING, "rent_offered": 650, "message": "Interested"},
    )
    assert application.status_code == 201, application.text
    application_id = application.json()["id"]

    as_profile(id=OWNER, role="landlord")
    approved = client.patch(f"/api/v1/applications/{application_id}", json={"status": "approved"})
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"

    # A review goes through mobile_submit_review, which takes the tenant from their token.
    next(row for row in fake_db.tables["users"] if row["id"] == TENANT)["auth_user_id"] = TENANT
    fake_db.tokens["jwt-tanya"] = TENANT
    as_profile(id=TENANT, role="tenant", access_token="jwt-tanya")
    ratings = {key: 4 for key in reviews.CATEGORIES}
    form = {"review": json.dumps({"ratings": ratings, "body": "Good view."})}
    review = client.post(f"/api/v1/properties/{LISTING}/reviews", data=form)
    assert review.status_code == 201, review.text
    assert review.json()["mine"] is True and review.json()["property_id"] == PROPERTY_ROW

    duplicate = client.post(f"/api/v1/properties/{LISTING}/reviews", data=form)
    assert duplicate.status_code == 409

    public_reviews = client.get(f"/api/v1/properties/{LISTING}/reviews")
    assert public_reviews.status_code == 200
    assert [row["comment"] for row in public_reviews.json()] == ["Good view."]


def test_owner_assistant_says_it_is_unavailable_when_shared_rpcs_fail(client, fake_db, as_profile, monkeypatch):
    # The tracker's R29 row: a failing function no longer passes for an empty answer.
    fake_db.seed("users", [user_row(OWNER, "Olivia Owner", "LANDLORD", verification_status="APPROVED")])
    as_profile(id=OWNER, role="landlord")
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr(""))

    class TimedOut:
        def execute(self):
            raise APIError({"code": "57014", "message": "canceling statement due to statement timeout"})

    monkeypatch.setattr(fake_db, "rpc", lambda name, params=None: TimedOut())

    workspace = client.get("/api/v1/me/owner-assistant")
    message = client.post("/api/v1/me/owner-assistant/messages", json={"question": "What is outstanding?"})

    assert (workspace.status_code, message.status_code) == (503, 503)
    assert message.json()["detail"] == "The assistant is unavailable right now. Please try again."
