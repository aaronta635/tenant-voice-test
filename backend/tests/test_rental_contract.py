"""Listings on the shared database's rules (R07, R25), by direct API calls per role on the strict fake.

A listing moves only as enforce_listing_status_transition lets it, and the
web refuses any other move (409) before it writes. The property's LANDLORD
owner publishes and moves a listing through transition_listing_status; an
agent's or a manager's move is written by the web, under the same rules,
since the function takes no one else. Deleting follows
delete_owned_unrented_property and delete_owned_draft_listing, and photos
for a listing that exists go to its property's folder, as the mobile app's
storage policy keeps them. tests/fake_rpcs/fa_rental.py runs the functions.
"""

import pytest

from tests.factories_rental import (
    MANAGER,
    NOW,
    OWNER,
    STRANGER,
    TENANT,
    application_row,
    media_row,
    new_id,
    photo_link,
    seed_listing,
    seed_people,
)

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
BUCKET = "property-images"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
NEW_LISTING = {
    "title": "Harbour flat", "address": "1 Harbour Street", "suburb": "Wollongong", "state": "NSW",
    "postcode": "2500", "property_type": "Apartment", "bedrooms": 2, "bathrooms": 1, "price": 650,
}


@pytest.fixture
def db(strict_schema):
    seed_people(strict_schema)
    return strict_schema


def _listing(db, listing_id: str) -> dict:
    return next(row for row in db.tables["listings"] if row["id"] == listing_id)


def _move(client, listing_id: str, listing_status: str):
    return client.patch(f"{API}/me/properties/{listing_id}", json={"listing_status": listing_status})


def _rpcs(db) -> list[str]:
    return [name for name, _ in db.rpc_calls]


# -- the status matrix ----------------------------------------------------------------
@pytest.mark.parametrize(
    ("before", "wanted", "detail"),
    [
        ("DRAFT", "paused", "This listing is a draft, so it can't be paused."),
        ("DRAFT", "applications_closed", "This listing is a draft, so it can't be closed to applications."),
        ("APPLICATIONS_CLOSED", "paused", "This listing is closed to applications, so it can't be paused."),
        ("PUBLISHED", "leased", "A listing is leased when you approve one of its applications."),
        ("PAUSED", "leased", "A listing is leased when you approve one of its applications."),
        ("LEASED", "published", "This listing is leased, so its status can no longer change. "
                                "To let the home again, create a new listing."),
        ("LEASED", "paused", "This listing is leased, so its status can no longer change. "
                             "To let the home again, create a new listing."),
    ],
)
def test_a_move_the_database_refuses_is_refused_before_anything_is_written(client, db, as_profile, before,
                                                                             wanted, detail):
    listing_id, _ = seed_listing(db, status=before)
    as_profile(id=OWNER, role="landlord")

    response = client.patch(f"{API}/me/properties/{listing_id}", json={"listing_status": wanted, "title": "New"})

    assert (response.status_code, response.json()["detail"]) == (409, detail)
    assert (_listing(db, listing_id)["status"], _listing(db, listing_id)["title"]) == (before, "Harbour flat")
    assert _listing(db, listing_id)["updated_at"] == NOW
    assert db.rpc_calls == []


@pytest.mark.parametrize("before", ["PUBLISHED", "APPLICATIONS_CLOSED"])
def test_marking_rented_by_the_web_status_is_refused_too(client, db, as_profile, before):
    listing_id, _ = seed_listing(db, status=before)
    as_profile(id=OWNER, role="landlord")

    response = client.patch(f"{API}/me/properties/{listing_id}", json={"status": "rented"})

    assert response.status_code == 409
    assert _listing(db, listing_id)["status"] == before


def test_a_landlord_publishes_through_transition_listing_status(client, db, as_profile):
    listing_id, _ = seed_listing(db, status="DRAFT")
    as_profile(id=OWNER, role="landlord")

    response = _move(client, listing_id, "published")

    assert response.status_code == 200, response.text
    assert db.rpc_calls == [("transition_listing_status", {
        "p_listing_id": listing_id, "p_owner_user_id": OWNER, "p_status": "PUBLISHED",
        "p_now": db.rpc_calls[0][1]["p_now"],
    })]
    stored = _listing(db, listing_id)
    assert (stored["status"], stored["published_at"]) == ("PUBLISHED", db.rpc_calls[0][1]["p_now"])


def test_the_database_asks_for_an_approved_landlord_to_publish(client, db, as_profile):
    # The web's badge counts VERIFIED as verified; transition_listing_status takes APPROVED only.
    for user in db.tables["users"]:
        if user["id"] == OWNER:
            user["verification_status"] = "VERIFIED"
    listing_id, _ = seed_listing(db, status="PAUSED")
    as_profile(id=OWNER, role="landlord")

    response = client.patch(f"{API}/me/properties/{listing_id}", json={"listing_status": "published", "price": 700})

    assert (response.status_code, response.json()["detail"]) == (403, "Landlord verification is required")
    assert (_listing(db, listing_id)["status"], _listing(db, listing_id)["weekly_rent"]) == ("PAUSED", 650)


@pytest.mark.parametrize(
    ("owner", "manager"),
    [(MANAGER, None), (STRANGER, OWNER)],
    ids=["an agent's own listing", "a listing the landlord manages"],
)
def test_an_agent_or_a_manager_moves_a_listing_under_the_same_rules(client, db, as_profile, owner, manager):
    # transition_listing_status takes the property's LANDLORD owner only; the web writes these moves.
    listing_id, _ = seed_listing(db, owner=owner, status="PAUSED", prop={"manager_user_id": manager})
    as_profile(id=manager or owner, role="landlord")

    assert _move(client, listing_id, "published").status_code == 200
    assert _move(client, listing_id, "applications_closed").status_code == 200
    first_publication = _listing(db, listing_id)["published_at"]
    assert _move(client, listing_id, "published").status_code == 200
    refused = _move(client, listing_id, "leased")

    assert refused.status_code == 409
    stored = _listing(db, listing_id)
    assert (stored["status"], stored["published_at"]) == ("PUBLISHED", first_publication)
    assert first_publication and db.rpc_calls == []


def test_a_move_made_meanwhile_is_never_overwritten(client, db, as_profile, monkeypatch):
    from app.services import properties

    listing_id, _ = seed_listing(db, owner=MANAGER)
    read = properties.owned_listing

    def closed_after_the_read(*args):
        found = read(*args)
        _listing(db, listing_id)["status"] = "APPLICATIONS_CLOSED"
        return found

    monkeypatch.setattr(properties, "owned_listing", closed_after_the_read)
    as_profile(id=MANAGER, role="landlord")

    response = _move(client, listing_id, "paused")

    assert response.status_code == 409
    assert _listing(db, listing_id)["status"] == "APPLICATIONS_CLOSED"


# -- creating ---------------------------------------------------------------------------
def test_a_landlords_new_listing_is_published_through_the_function(client, db, as_profile):
    as_profile(id=OWNER, role="landlord")

    response = client.post(f"{API}/me/properties", json=NEW_LISTING)

    assert response.status_code == 201, response.text
    [listing] = db.tables["listings"]
    assert (listing["status"], response.json()["listing_status"]) == ("PUBLISHED", "published")
    assert listing["published_at"] == db.rpc_calls[0][1]["p_now"]
    assert [(name, params["p_status"]) for name, params in db.rpc_calls] == [("transition_listing_status", "PUBLISHED")]


def test_an_agents_new_listing_is_saved_published(client, db, as_profile):
    as_profile(id=MANAGER, role="landlord")

    response = client.post(f"{API}/me/properties", json=NEW_LISTING)

    assert response.status_code == 201, response.text
    [listing] = db.tables["listings"]
    assert (listing["status"], bool(listing["published_at"]), db.rpc_calls) == ("PUBLISHED", True, [])


def test_a_new_listing_is_never_rented(client, db, as_profile):
    as_profile(id=OWNER, role="landlord")

    response = client.post(f"{API}/me/properties", json={**NEW_LISTING, "status": "rented"})

    assert response.status_code == 422
    assert "approve one of its applications" in response.json()["detail"]
    assert not db.tables.get("properties")


def test_a_publication_the_database_refuses_leaves_no_listing_behind(client, db, as_profile):
    for user in db.tables["users"]:
        if user["id"] == OWNER:
            user["verification_status"] = "VERIFIED"
    as_profile(id=OWNER, role="landlord")

    response = client.post(f"{API}/me/properties", json={**NEW_LISTING, "photo_urls": [photo_link()]})

    assert (response.status_code, response.json()["detail"]) == (403, "Landlord verification is required")
    assert (db.tables["properties"], db.tables["listings"], db.tables["property_media"]) == ([], [], [])


# -- deleting ---------------------------------------------------------------------------
def test_a_manager_cannot_delete_the_owners_listing(client, db, as_profile):
    # The delete functions check the property's owner_user_id, as the mobile app's delete does.
    listing_id, prop_id = seed_listing(db, owner=STRANGER, prop={"manager_user_id": OWNER})
    as_profile(id=OWNER, role="landlord")

    response = client.delete(f"{API}/me/properties/{listing_id}")

    assert (response.status_code, response.json()["detail"]) == (403, "Listing ownership could not be verified")
    assert [row["id"] for row in db.tables["properties"]] == [prop_id]


@pytest.mark.parametrize("status", ["PUBLISHED", "PAUSED", "DRAFT"])
def test_a_manager_cannot_delete_a_listing_beside_the_owners_others(client, db, as_profile, status):
    # A property with other listings: a draft goes through delete_owned_draft_listing, which refuses a
    # manager, and the web would archive any other listing itself, so it refuses them first.
    other, prop_id = seed_listing(db, owner=STRANGER, prop={"manager_user_id": OWNER})
    mine = {"id": new_id(), "property_id": prop_id, "created_by_user_id": OWNER, "title": "Relisted",
            "weekly_rent": 700, "status": status, "updated_at": NOW}
    db.seed("listings", [mine])
    as_profile(id=OWNER, role="landlord")

    response = client.delete(f"{API}/me/properties/{mine['id']}")

    assert (response.status_code, response.json()["detail"]) == (403, "Listing ownership could not be verified")
    assert {row["id"]: row["status"] for row in db.tables["listings"]} == {other: "PUBLISHED", mine["id"]: status}
    assert [name for name, _ in db.rpc_calls] == (["delete_owned_draft_listing"] if status == "DRAFT" else [])


def test_a_draft_beside_other_listings_goes_alone(client, db, as_profile):
    old_listing, prop_id = seed_listing(db, status="LEASED")
    db.seed("rental_applications", [application_row(old_listing, status="APPROVED")])
    draft = {"id": new_id(), "property_id": prop_id, "created_by_user_id": OWNER, "title": "Relisted",
             "weekly_rent": 700, "status": "DRAFT", "updated_at": NOW}
    db.seed("listings", [draft])
    as_profile(id=OWNER, role="landlord")

    assert client.delete(f"{API}/me/properties/{draft['id']}").status_code == 204

    assert [row["id"] for row in db.tables["listings"]] == [old_listing]
    assert [row["id"] for row in db.tables["properties"]] == [prop_id]
    assert _rpcs(db) == ["delete_owned_draft_listing"]


def test_a_published_listing_beside_other_listings_is_archived(client, db, as_profile):
    first, prop_id = seed_listing(db, status="PAUSED")
    second = {"id": new_id(), "property_id": prop_id, "created_by_user_id": OWNER, "title": "Room two",
              "weekly_rent": 300, "status": "PUBLISHED", "updated_at": NOW}
    db.seed("listings", [second])
    db.seed("rental_applications", [application_row(second["id"])])
    as_profile(id=OWNER, role="landlord")

    assert client.delete(f"{API}/me/properties/{second['id']}").status_code == 204

    assert {row["id"]: row["status"] for row in db.tables["listings"]} == {first: "PAUSED", second["id"]: "ARCHIVED"}
    assert len(db.tables["rental_applications"]) == 1
    assert client.get(f"{API}/me/properties/{second['id']}").status_code == 404


def test_a_listing_still_in_use_elsewhere_is_not_deleted(client, db, as_profile):
    # owner_assistant_records.listing_id has no ON DELETE rule: the database refuses the delete (23503).
    listing_id, prop_id = seed_listing(db)
    db.seed("owner_assistant_records", [{"id": new_id(), "owner_user_id": OWNER, "listing_id": listing_id,
                                         "kind": "proposal", "title": "Draft", "payload": {}}])
    as_profile(id=OWNER, role="landlord")

    response = client.delete(f"{API}/me/properties/{listing_id}")

    assert (response.status_code, response.json()["detail"]) == (
        409, "This listing is still in use elsewhere in TenantVoice, so it can't be deleted.",
    )
    assert [row["id"] for row in db.tables["properties"]] == [prop_id]
    assert _listing(db, listing_id)["status"] == "PUBLISHED"


def test_only_the_photo_files_of_the_listing_bucket_are_removed(client, db, as_profile):
    listing_id, prop_id = seed_listing(db)
    db.seed("property_media", [
        media_row(prop_id, "https://cdn.example.test/a.jpg", 0, True),
        media_row(prop_id, photo_link(name="b.jpg"), 1, storage_bucket=BUCKET, storage_path=f"{OWNER}/{prop_id}/b.jpg"),
        media_row(prop_id, "https://cdn.example.test/c.jpg", 2, storage_bucket="avatars", storage_path="c.jpg"),
    ])
    db.storage.objects.update({(BUCKET, f"{OWNER}/{prop_id}/b.jpg"): PNG, ("avatars", "c.jpg"): PNG})
    as_profile(id=OWNER, role="landlord")

    assert client.delete(f"{API}/me/properties/{listing_id}").status_code == 204

    assert set(db.storage.objects) == {("avatars", "c.jpg")}


# -- photos -----------------------------------------------------------------------------
def _upload(client, listing_id: str):
    return client.post(f"{API}/me/properties/{listing_id}/photos", files={"file": ("front.png", PNG, "image/png")})


@pytest.mark.parametrize("uploader", [OWNER, MANAGER], ids=["the owner", "its manager"])
def test_a_photo_for_a_listing_goes_to_its_propertys_folder(client, db, as_profile, uploader):
    # mobile_property_images_insert_own keeps a property's photos under <owner id>/<property id>/.
    listing_id, prop_id = seed_listing(db, prop={"manager_user_id": MANAGER})
    as_profile(id=uploader, role="landlord")

    uploaded = _upload(client, listing_id)

    assert uploaded.status_code == 200, uploaded.text
    path = uploaded.json()["path"]
    assert path.startswith(f"{OWNER}/{prop_id}/") and db.storage.objects == {(BUCKET, path): PNG}
    saved = client.patch(f"{API}/me/properties/{listing_id}", json={"photo_urls": [uploaded.json()["url"]]})
    assert saved.status_code == 200, saved.text
    [row] = db.tables["property_media"]
    assert (row["storage_bucket"], row["storage_path"], row["uploaded_by_user_id"]) == (BUCKET, path, uploader)
    # Taken off the listing, the web's own upload loses its file too.
    assert client.patch(f"{API}/me/properties/{listing_id}", json={"photo_urls": []}).status_code == 200
    assert db.storage.objects == {}


@pytest.mark.parametrize("uploader", [OWNER, MANAGER], ids=["the owner", "its manager"])
def test_a_photo_uploaded_for_a_listing_and_never_saved_can_be_discarded(client, db, as_profile, uploader):
    listing_id, _ = seed_listing(db, prop={"manager_user_id": MANAGER})
    as_profile(id=uploader, role="landlord")
    uploaded = _upload(client, listing_id).json()

    response = client.delete(f"{API}/uploads/property-image", params={"url": uploaded["url"]})

    assert response.status_code == 204
    assert db.storage.objects == {}


def test_another_landlord_neither_uploads_nor_discards_a_listings_photos(client, db, as_profile):
    listing_id, _ = seed_listing(db)
    as_profile(id=OWNER, role="landlord")
    uploaded = _upload(client, listing_id).json()
    as_profile(id=STRANGER, role="landlord")

    assert _upload(client, listing_id).status_code == 404
    assert client.delete(f"{API}/uploads/property-image", params={"url": uploaded["url"]}).status_code == 404
    assert list(db.storage.objects) == [(BUCKET, uploaded["path"])]


@pytest.mark.parametrize("role", ["tenant", "service_provider"])
def test_only_landlords_upload_a_listings_photos(client, db, as_profile, role):
    listing_id, _ = seed_listing(db)
    as_profile(id=TENANT, role=role)

    assert _upload(client, listing_id).status_code == 403
    assert db.storage.objects == {}
