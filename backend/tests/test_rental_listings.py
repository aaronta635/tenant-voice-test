"""Owner listings and the public catalogue on the shared tables (plan §3 a6).

Every test runs under the strict fake, so each read and write must fit the
shared schema: stamped ids and times, enum labels and NOT NULL columns.
"""

from datetime import datetime

import pytest

from app.services import properties as properties_service
from app.services.shared_map import stamp_insert
from tests.factories_identity import account
from tests.factories_rental import (
    MANAGER,
    NOW,
    OTHER_TENANT,
    OWNER,
    STRANGER,
    TENANT,
    application_row,
    media_row,
    new_id,
    photo_link,
    property_row,
    review_row,
    seed_listing,
    seed_people,
    support_embedded_or,
    user_row,
)

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
BUCKET = "property-images"


@pytest.fixture
def owner(client, strict_schema, as_profile):
    seed_people(strict_schema)
    as_profile(id=OWNER, role="landlord", full_name="Olivia Owner")
    return strict_schema


def _new_listing(**over) -> dict:
    return {
        "title": "Harbour flat", "address": "1 Harbour Street", "suburb": "Wollongong", "state": "NSW",
        "postcode": "2500", "property_type": "Apartment", "bedrooms": 2, "bathrooms": 1, "price": 650,
        "lease_term": "12 months", **over,
    }


def _by_id(db, table: str) -> dict[str, dict]:
    return {row["id"]: row for row in db.tables.get(table, [])}


# -- create ---------------------------------------------------------------------
def test_a_new_listing_writes_stamped_property_and_listing_rows(client, owner):
    response = client.post(f"{API}/me/properties", json=_new_listing(bond=2600, amenities=["Balcony"]))

    assert response.status_code == 201, response.text
    [prop] = owner.tables["properties"]
    [listing] = owner.tables["listings"]
    assert (prop["owner_user_id"], prop["nickname"], prop["country"]) == (OWNER, "Harbour flat", "AU")
    assert (prop["property_type"], prop["suburb"], prop["metadata"]) == ("APARTMENT", "Wollongong", {"amenities": ["Balcony"]})
    assert (listing["property_id"], listing["created_by_user_id"]) == (prop["id"], OWNER)
    assert (listing["status"], listing["lease_term_months"], listing["bond_amount"]) == ("PUBLISHED", 12, 2600)
    assert listing["published_at"] and listing["updated_at"] and prop["updated_at"]
    body = response.json()
    assert (body["id"], body["owner_id"], body["status"]) == (listing["id"], OWNER, "available")
    assert (body["lease_term"], body["property_type"], body["amenities"]) == ("12 months", "apartment", ["Balcony"])


def test_an_off_market_listing_is_saved_paused_and_unpublished(client, owner):
    response = client.post(f"{API}/me/properties", json=_new_listing(status="off_market", lease_term=None))

    assert response.status_code == 201, response.text
    [listing] = owner.tables["listings"]
    assert (listing["status"], listing["published_at"], listing["lease_term_months"]) == ("PAUSED", None, None)
    assert response.json()["status"] == "off_market"


@pytest.mark.parametrize(
    ("blank", "detail"),
    [
        ({"suburb": None}, "Suburb is required."),
        ({"postcode": "  "}, "Postcode is required."),
        ({"suburb": "", "state": None, "postcode": None}, "Suburb, state and postcode are required."),
        ({"address": " "}, "Address is required."),
    ],
)
def test_a_listing_needs_its_address_suburb_state_and_postcode(client, owner, blank, detail):
    # properties.suburb, state and postcode are NOT NULL, though PropertyCreate leaves them optional.
    response = client.post(f"{API}/me/properties", json=_new_listing(**blank))

    assert (response.status_code, response.json()["detail"]) == (422, detail)
    assert not owner.tables.get("properties")


@pytest.mark.parametrize(
    ("typed", "stored", "shown"),
    [("Apartment", "APARTMENT", "apartment"), (" townhouse ", "TOWNHOUSE", "townhouse"),
     ("Flat", "OTHER", "other"), (None, "OTHER", "other")],
)
def test_a_free_text_type_is_stored_as_its_shared_type_or_other(client, owner, typed, stored, shown):
    response = client.post(f"{API}/me/properties", json=_new_listing(property_type=typed))

    assert response.status_code == 201, response.text
    assert owner.tables["properties"][0]["property_type"] == stored
    assert response.json()["property_type"] == shown


@pytest.mark.parametrize(
    ("field", "value"),
    [("status", "sold"), ("lease_term", "Flexible"), ("lease_term", "6 weeks"), ("lease_term", "0 months")],
)
def test_an_unknown_status_or_unreadable_lease_term_is_refused(client, owner, field, value):
    response = client.post(f"{API}/me/properties", json=_new_listing(**{field: value}))

    assert response.status_code == 422
    assert not owner.tables.get("properties")


def test_photos_keep_their_order_and_name_the_objects_the_owner_uploaded(client, owner):
    uploaded, elsewhere = photo_link(name="a.jpg"), "https://images.example.test/b.jpg"
    someone_elses = photo_link(owner=STRANGER, name="c.jpg")

    response = client.post(
        f"{API}/me/properties", json=_new_listing(photo_urls=[uploaded, elsewhere, uploaded, someone_elses])
    )

    assert response.status_code == 201, response.text
    rows = sorted(owner.tables["property_media"], key=lambda row: row["sort_order"])
    assert [(row["media_url"], row["sort_order"], row["is_cover"]) for row in rows] == [
        (uploaded, 0, True), (elsewhere, 1, False), (someone_elses, 2, False),
    ]
    assert [(row["storage_bucket"], row["storage_path"]) for row in rows] == [
        (BUCKET, f"{OWNER}/a.jpg"), (None, None), (None, None),
    ]
    assert {(row["media_type"], row["uploaded_by_user_id"]) for row in rows} == {("image", OWNER)}
    assert response.json()["photo_urls"] == [uploaded, elsewhere, someone_elses]


def test_inline_photo_data_is_refused(client, owner):
    # The wizard used to send data: URLs; property_media.media_url would hold the whole image.
    response = client.post(f"{API}/me/properties", json=_new_listing(photo_urls=["data:image/png;base64,iVBORw0KGgo="]))

    assert (response.status_code, response.json()["detail"]) == (422, "Photos must be links to uploaded images.")
    assert not owner.tables.get("properties")


@pytest.mark.parametrize("failing_table", ["listings", "property_media"])
def test_a_create_that_fails_part_way_leaves_no_rows_behind(client, owner, monkeypatch, failing_table):
    def stamp_without_id(table, row, now=None):
        stamped = stamp_insert(table, row, now)
        if table == failing_table:
            stamped.pop("id")
        return stamped

    monkeypatch.setattr(properties_service, "stamp_insert", stamp_without_id)

    response = client.post(f"{API}/me/properties", json=_new_listing(photo_urls=[photo_link()]))

    assert response.status_code == 400  # 23502: the id has no default
    assert owner.tables["properties"] == []
    assert not owner.tables.get("listings")
    assert not owner.tables.get("property_media")


# -- owner reads ------------------------------------------------------------------
def test_my_properties_are_the_listings_of_properties_i_own_or_manage(client, owner):
    agent_listed, _ = seed_listing(owner, listing={"created_by_user_id": MANAGER, "title": "Agent listed"})
    managed, _ = seed_listing(owner, owner=STRANGER, prop={"manager_user_id": OWNER}, listing={"title": "Managed"})
    seed_listing(owner, owner=STRANGER, listing={"created_by_user_id": OWNER, "title": "Created, not owned"})
    seed_listing(owner, status="ARCHIVED", listing={"title": "Deleted"})

    response = client.get(f"{API}/me/properties")

    assert response.status_code == 200, response.text
    assert {row["id"] for row in response.json()} == {agent_listed, managed}
    assert client.get(f"{API}/me/properties/{managed}").json()["owner_id"] == STRANGER


@pytest.mark.parametrize(
    ("web", "shared"),
    [("available", {"PUBLISHED", "APPLICATIONS_CLOSED"}), ("rented", {"LEASED"}), ("off_market", {"DRAFT", "PAUSED"})],
)
def test_status_filters_match_every_shared_status_shown_that_way(client, owner, web, shared):
    ids = {status: seed_listing(owner, status=status)[0]
           for status in ("DRAFT", "PUBLISHED", "PAUSED", "APPLICATIONS_CLOSED", "LEASED", "ARCHIVED")}

    response = client.get(f"{API}/me/properties", params={"status": web})

    assert response.status_code == 200, response.text
    assert {row["id"] for row in response.json()} == {ids[status] for status in shared}
    assert {row["status"] for row in response.json()} == {web}


def test_an_unknown_status_filter_is_a_bad_request(client, owner):
    # It used to fall back to PUBLISHED.
    response = client.get(f"{API}/me/properties", params={"status": "sold"})

    assert response.status_code == 400


def test_another_landlords_listing_is_not_found_even_by_its_creator(client, owner):
    theirs, _ = seed_listing(owner, owner=STRANGER, listing={"created_by_user_id": OWNER})

    assert client.get(f"{API}/me/properties/{theirs}").status_code == 404
    assert client.patch(f"{API}/me/properties/{theirs}", json={"title": "Mine now"}).status_code == 404
    assert client.delete(f"{API}/me/properties/{theirs}").status_code == 404
    assert _by_id(owner, "listings")[theirs]["title"] == "Harbour flat"


# -- update -----------------------------------------------------------------------
def test_an_edit_stamps_both_rows_and_saves_the_lease_term(client, owner):
    listing_id, prop_id = seed_listing(owner, prop={"metadata": {"amenities": [], "floor": 3}})

    response = client.patch(f"{API}/me/properties/{listing_id}", json={
        "title": "Harbour view flat", "suburb": "North Wollongong", "lease_term": "1 year", "price": 700,
        "property_type": "unit", "amenities": ["Balcony"],
    })

    assert response.status_code == 200, response.text
    listing, prop = _by_id(owner, "listings")[listing_id], _by_id(owner, "properties")[prop_id]
    assert (listing["title"], listing["weekly_rent"], listing["lease_term_months"]) == ("Harbour view flat", 700, 12)
    assert (prop["nickname"], prop["suburb"], prop["property_type"]) == ("Harbour view flat", "North Wollongong", "UNIT")
    assert prop["metadata"] == {"amenities": ["Balcony"], "floor": 3}
    assert listing["updated_at"] != NOW and prop["updated_at"] != NOW
    body = response.json()
    assert (body["lease_term"], body["suburb"], body["property_type"]) == ("12 months", "North Wollongong", "unit")
    assert datetime.fromisoformat(body["updated_at"]) == datetime.fromisoformat(listing["updated_at"])


def test_an_edit_cannot_blank_a_required_address_field(client, owner):
    listing_id, prop_id = seed_listing(owner)

    response = client.patch(f"{API}/me/properties/{listing_id}", json={"title": "New title", "postcode": ""})

    assert (response.status_code, response.json()["detail"]) == (422, "Postcode is required.")
    assert _by_id(owner, "listings")[listing_id]["title"] == "Harbour flat"
    assert _by_id(owner, "properties")[prop_id]["postcode"] == "2500"


def test_making_a_listing_available_publishes_it_unless_it_already_shows_so(client, owner):
    paused, _ = seed_listing(owner, status="PAUSED")
    closed, _ = seed_listing(owner, status="APPLICATIONS_CLOSED")

    assert client.patch(f"{API}/me/properties/{paused}", json={"status": "available"}).json()["status"] == "available"
    assert client.patch(f"{API}/me/properties/{closed}", json={"status": "available"}).json()["status"] == "available"

    listings = _by_id(owner, "listings")
    assert (listings[paused]["status"], bool(listings[paused]["published_at"])) == ("PUBLISHED", True)
    # Closed to applications shows as available already: the edit must not reopen it.
    assert (listings[closed]["status"], listings[closed]["published_at"]) == ("APPLICATIONS_CLOSED", None)


def test_taking_a_listing_off_the_market_but_never_marking_it_rented(client, owner):
    listing_id, _ = seed_listing(owner)

    rented = client.patch(f"{API}/me/properties/{listing_id}", json={"status": "rented"})
    assert (rented.status_code, rented.json()["detail"]) == (
        409, "A listing is leased when you approve one of its applications.",
    )
    assert _by_id(owner, "listings")[listing_id]["status"] == "PUBLISHED"
    assert client.patch(f"{API}/me/properties/{listing_id}", json={"status": "off_market"}).json()["status"] == "off_market"
    assert _by_id(owner, "listings")[listing_id]["status"] == "PAUSED"
    assert client.patch(f"{API}/me/properties/{listing_id}", json={"status": "sold"}).status_code == 422


def test_editing_photos_keeps_reorders_adds_and_removes_rows(client, owner):
    listing_id, prop_id = seed_listing(owner)
    kept, dropped, added = photo_link(name="kept.jpg"), photo_link(name="dropped.jpg"), photo_link(name="added.jpg")
    tour = "https://cdn.example.test/tour.mp4"
    dropped_row = media_row(prop_id, dropped, 0, True, storage_bucket=BUCKET, storage_path=f"{OWNER}/dropped.jpg")
    kept_row = media_row(prop_id, kept, 1, storage_bucket=BUCKET, storage_path=f"{OWNER}/kept.jpg")
    owner.seed("property_media", [dropped_row, kept_row, media_row(prop_id, tour, 2, media_type="video")])
    for name in ("dropped.jpg", "kept.jpg"):
        owner.storage.objects[(BUCKET, f"{OWNER}/{name}")] = b"jpeg"

    response = client.patch(f"{API}/me/properties/{listing_id}", json={"photo_urls": [kept, added]})

    assert response.status_code == 200, response.text
    assert response.json()["photo_urls"] == [kept, added]
    rows = {row["media_url"]: row for row in owner.tables["property_media"]}
    assert set(rows) == {kept, added, tour}  # the video is not a photo, so it stays
    assert (rows[kept]["id"], rows[kept]["sort_order"], rows[kept]["is_cover"]) == (kept_row["id"], 0, True)
    assert (rows[added]["sort_order"], rows[added]["is_cover"], rows[added]["storage_path"]) == (
        1, False, f"{OWNER}/added.jpg",
    )
    assert (BUCKET, f"{OWNER}/dropped.jpg") not in owner.storage.objects
    assert (BUCKET, f"{OWNER}/kept.jpg") in owner.storage.objects
    assert _by_id(owner, "listings")[listing_id]["updated_at"] != NOW


def test_a_removed_photo_keeps_a_file_that_is_still_shown_or_not_the_owners(client, owner):
    listing_id, prop_id = seed_listing(owner)
    _, other_prop = seed_listing(owner)
    shared, theirs = photo_link(name="shared.jpg"), photo_link(owner=STRANGER, name="theirs.jpg")
    owner.seed("property_media", [
        media_row(prop_id, shared, 0, True, storage_bucket=BUCKET, storage_path=f"{OWNER}/shared.jpg"),
        # The object is on one row (property_media_storage_object_idx); an older row shows it by its link alone.
        media_row(other_prop, shared, 0, True),
        media_row(prop_id, theirs, 1, storage_bucket=BUCKET, storage_path=f"{STRANGER}/theirs.jpg"),
    ])
    owner.storage.objects[(BUCKET, f"{OWNER}/shared.jpg")] = b"jpeg"
    owner.storage.objects[(BUCKET, f"{STRANGER}/theirs.jpg")] = b"jpeg"

    response = client.patch(f"{API}/me/properties/{listing_id}", json={"photo_urls": []})

    assert response.status_code == 200, response.text
    assert response.json()["photo_urls"] == []
    assert [row["property_id"] for row in owner.tables["property_media"]] == [other_prop]
    assert set(owner.storage.objects) == {(BUCKET, f"{OWNER}/shared.jpg"), (BUCKET, f"{STRANGER}/theirs.jpg")}


def test_an_edit_clears_the_optional_fields_it_sends_as_null(client, owner):
    listing_id, prop_id = seed_listing(
        owner,
        listing={"description": "Sunny", "bond_amount": 2600, "lease_term_months": 12, "available_from": "2026-03-01"},
        prop={"metadata": {"amenities": ["Balcony"], "floor": 3}},
    )

    response = client.patch(f"{API}/me/properties/{listing_id}", json={
        "description": "  ", "bond": None, "lease_term": None, "available_from": None, "bedrooms": None,
        "parking": None, "property_type": None, "amenities": None,
    })

    assert response.status_code == 200, response.text
    listing, prop = _by_id(owner, "listings")[listing_id], _by_id(owner, "properties")[prop_id]
    assert (listing["description"], listing["bond_amount"], listing["lease_term_months"]) == (None, None, None)
    assert listing["available_from"] is None
    assert (prop["bedrooms"], prop["parking_spaces"], prop["property_type"]) == (None, None, "OTHER")
    assert prop["metadata"] == {"amenities": [], "floor": 3}
    # What the edit left out keeps its value.
    assert (listing["title"], listing["weekly_rent"], prop["bathrooms"]) == ("Harbour flat", 650, 1)
    body = response.json()
    assert (body["description"], body["bond"], body["lease_term"], body["bedrooms"]) == (None, None, None, None)


@pytest.mark.parametrize(
    ("field", "detail"),
    [("title", "Title is required."), ("address", "Address is required."), ("suburb", "Suburb is required."),
     ("price", "Weekly rent is required.")],
)
def test_an_edit_cannot_clear_the_title_address_or_rent(client, owner, field, detail):
    listing_id, prop_id = seed_listing(owner)

    response = client.patch(f"{API}/me/properties/{listing_id}", json={field: None, "bond": 900})

    assert (response.status_code, response.json()["detail"]) == (422, detail)
    assert _by_id(owner, "listings")[listing_id]["bond_amount"] is None
    assert _by_id(owner, "listings")[listing_id]["updated_at"] == NOW


@pytest.mark.parametrize(
    ("before", "wanted", "first_publication"),
    [
        ("DRAFT", "published", True),
        ("PUBLISHED", "paused", False),
        ("PUBLISHED", "applications_closed", False),
        ("APPLICATIONS_CLOSED", "published", False),
        ("PAUSED", "published", False),
        ("PAUSED", "applications_closed", False),
    ],
)
def test_an_owner_publishes_pauses_and_closes_applications(client, owner, before, wanted, first_publication):
    # transition_listing_status sets published_at at the first publication only.
    published_at = None if before == "DRAFT" else "2025-12-01T00:00:00+00:00"
    listing_id, _ = seed_listing(owner, status=before, listing={"published_at": published_at})

    response = client.patch(f"{API}/me/properties/{listing_id}", json={"listing_status": wanted})

    assert response.status_code == 200, response.text
    stored = _by_id(owner, "listings")[listing_id]
    assert stored["status"] == wanted.upper()
    assert (stored["published_at"] != published_at) is first_publication
    assert response.json()["listing_status"] == wanted
    trail = [entry for entry in owner.schema_tables["web"]["audit_log"] if entry["action"] == "property.status_changed"]
    assert [entry["metadata"]["listing_status"] for entry in trail] == [wanted]
    assert [(name, params["p_status"]) for name, params in owner.rpc_calls] == [
        ("transition_listing_status", wanted.upper()),
    ]


def test_asking_for_the_status_a_listing_has_changes_nothing(client, owner):
    listing_id, _ = seed_listing(owner, status="PAUSED")

    response = client.patch(f"{API}/me/properties/{listing_id}", json={"listing_status": "paused"})

    assert (response.status_code, response.json()["listing_status"]) == (200, "paused")
    assert not [entry for entry in owner.schema_tables.get("web", {}).get("audit_log", [])
                if entry["action"] == "property.status_changed"]


@pytest.mark.parametrize(
    "body",
    [{"listing_status": "archived"}, {"listing_status": "draft"}, {"listing_status": "paused", "status": "available"}],
)
def test_a_status_the_web_cannot_set_is_refused(client, owner, body):
    listing_id, _ = seed_listing(owner)

    assert client.patch(f"{API}/me/properties/{listing_id}", json=body).status_code == 422
    assert _by_id(owner, "listings")[listing_id]["status"] == "PUBLISHED"


def test_my_properties_name_each_status_and_count_the_applications(client, owner):
    busy, _ = seed_listing(owner, listing={"created_at": "2026-02-01T00:00:00+00:00"})
    quiet, _ = seed_listing(owner, status="APPLICATIONS_CLOSED")
    owner.seed("rental_applications", [
        application_row(busy, status=status, applicant=applicant)
        for status, applicant in (("SUBMITTED", TENANT), ("SHORTLISTED", OTHER_TENANT), ("WITHDRAWN", MANAGER),
                                  ("EXPIRED", STRANGER))
    ])

    response = client.get(f"{API}/me/properties")

    assert response.status_code == 200, response.text
    assert [(row["id"], row["listing_status"], row["application_count"], row["new_application_count"])
            for row in response.json()] == [(busy, "published", 2, 1), (quiet, "applications_closed", 0, 0)]
    assert client.get(f"{API}/me/properties/{busy}").json()["application_count"] == 2


def test_owners_get_the_street_line_to_edit_and_visitors_never_do(client, owner):
    listing_id, _ = seed_listing(owner, prop={"address_line_1": "1 Harbour Street", "address_line_2": "Unit 4"})

    mine = client.get(f"{API}/me/properties/{listing_id}").json()
    edited = client.patch(f"{API}/me/properties/{listing_id}", json={"address": "3 Pier Road"}).json()
    listed = client.get(f"{API}/me/properties").json()

    assert (mine["street_address"], mine["address"]) == ("1 Harbour Street", "1 Harbour Street, Unit 4, Wollongong, NSW, 2500")
    assert (edited["street_address"], listed[0]["street_address"]) == ("3 Pier Road", "3 Pier Road")
    public = client.get(f"{API}/properties/{listing_id}")
    assert "street_address" not in public.json() and "Pier" not in public.text


@pytest.mark.parametrize("path", ["/me/properties/not-a-uuid", "/me/properties/prop1"])
def test_a_malformed_listing_id_is_not_found_for_owners(client, owner, path):
    assert client.get(f"{API}{path}").status_code == 404
    assert client.patch(f"{API}{path}", json={"title": "New"}).status_code == 404
    assert client.delete(f"{API}{path}").status_code == 404


def test_another_owner_cannot_edit_or_change_the_status(client, owner):
    theirs, _ = seed_listing(owner, owner=STRANGER)

    assert client.patch(f"{API}/me/properties/{theirs}", json={"listing_status": "paused"}).status_code == 404
    assert client.patch(f"{API}/me/properties/{theirs}", json={"photo_urls": []}).status_code == 404
    assert _by_id(owner, "listings")[theirs]["status"] == "PUBLISHED"


@pytest.mark.parametrize("role", ["tenant", "service_provider"])
def test_only_landlords_manage_listings(client, owner, as_profile, role):
    listing_id, _ = seed_listing(owner)
    as_profile(id=TENANT, role=role)

    assert client.get(f"{API}/me/properties").status_code == 403
    assert client.post(f"{API}/me/properties", json=_new_listing()).status_code == 403
    assert client.patch(f"{API}/me/properties/{listing_id}", json={"listing_status": "paused"}).status_code == 403
    assert client.delete(f"{API}/me/properties/{listing_id}").status_code == 403
    assert _by_id(owner, "listings")[listing_id]["status"] == "PUBLISHED"


# -- delete -----------------------------------------------------------------------
def test_deleting_a_listing_deletes_its_property_as_the_mobile_app_does(client, owner):
    # delete_owned_unrented_property: the property goes with its listing, applications and photos.
    listing_id, prop_id = seed_listing(owner)
    photo = media_row(prop_id, photo_link(name="front.jpg"), 0, True, storage_bucket=BUCKET,
                      storage_path=f"{OWNER}/front.jpg")
    owner.seed("property_media", [photo])
    owner.storage.objects[(BUCKET, f"{OWNER}/front.jpg")] = b"jpeg"
    owner.seed("rental_applications", [application_row(listing_id)])
    owner.seed("listing_favorites", [{"id": new_id(), "user_id": TENANT, "listing_id": listing_id}])

    assert client.delete(f"{API}/me/properties/{listing_id}").status_code == 204

    for table in ("properties", "listings", "property_media", "rental_applications", "listing_favorites"):
        assert owner.tables[table] == [], table
    assert (BUCKET, f"{OWNER}/front.jpg") not in owner.storage.objects
    assert [name for name, _ in owner.rpc_calls] == ["delete_owned_unrented_property"]
    assert client.get(f"{API}/me/properties/{listing_id}").status_code == 404
    assert client.get(f"{API}/me/properties").json() == []
    assert client.get(f"{API}/properties/{listing_id}").status_code == 404
    assert client.delete(f"{API}/me/properties/{listing_id}").status_code == 404


def test_a_leased_listing_cannot_be_deleted(client, owner):
    # delete_owned_unrented_property refuses a property with rental history; the web asks first.
    listing_id, prop_id = seed_listing(owner, status="LEASED")
    owner.seed("rental_applications", [application_row(listing_id, status="APPROVED")])

    response = client.delete(f"{API}/me/properties/{listing_id}")

    assert (response.status_code, response.json()["detail"]) == (
        409, "This listing has a tenancy on it, so it can't be deleted.",
    )
    assert (_by_id(owner, "listings")[listing_id]["status"], list(_by_id(owner, "properties"))) == ("LEASED", [prop_id])
    assert owner.rpc_calls == []


# -- public catalogue ---------------------------------------------------------------
@pytest.fixture
def catalogue(owner):
    """Published listings, newest first: a Newtown house, a Surry Hills studio and a Wollongong flat."""
    for title, created, rent, prop in (
        ("Newtown house", "2026-03-01T00:00:00+00:00", 900,
         {"property_type": "HOUSE", "bedrooms": 3, "address_line_1": "12 King Street", "suburb": "Newtown",
          "postcode": "2042"}),
        ("Surry Hills studio", "2026-02-01T00:00:00+00:00", 450,
         {"property_type": "STUDIO", "bedrooms": 0, "address_line_1": "3 Crown Street", "suburb": "Surry Hills",
          "postcode": "2010"}),
        ("Wollongong flat", "2026-01-01T00:00:00+00:00", 650, {}),
    ):
        seed_listing(owner, listing={"title": title, "created_at": created, "weekly_rent": rent}, prop=prop)
    seed_listing(owner, status="PAUSED", listing={"title": "Paused house"}, prop={"property_type": "HOUSE"})
    return owner


def _titles(client, headers=None, **params) -> list[str]:
    response = client.get(f"{API}/properties", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return [row["title"] for row in response.json()]


def test_public_listings_are_the_published_ones_newest_first_or_by_rent(client, catalogue):
    assert _titles(client) == ["Newtown house", "Surry Hills studio", "Wollongong flat"]
    assert _titles(client, sort="price_asc") == ["Surry Hills studio", "Wollongong flat", "Newtown house"]
    assert _titles(client, sort="price_desc") == ["Newtown house", "Wollongong flat", "Surry Hills studio"]
    assert _titles(client, min_price=500, max_price=700) == ["Wollongong flat"]


def test_property_filters_apply_before_paging(client, catalogue):
    # Filtering after the page was read returned an empty first page here.
    assert _titles(client, property_type="studio", limit=1) == ["Surry Hills studio"]
    assert _titles(client, property_type="House") == ["Newtown house"]
    assert _titles(client, bedrooms=2, limit=1, offset=1) == ["Wollongong flat"]
    # No shared type is "flat": such listings are stored as OTHER, and this is not a search for OTHER.
    assert _titles(client, property_type="flat") == []


def test_a_listing_without_a_bedroom_count_is_listed_unless_bedrooms_are_asked_for(client, catalogue, owner):
    seed_listing(owner, listing={"title": "Unsized cottage", "created_at": "2025-12-01T00:00:00+00:00"},
                 prop={"bedrooms": None})

    assert _titles(client, bedrooms=0) == _titles(client) == [
        "Newtown house", "Surry Hills studio", "Wollongong flat", "Unsized cottage",
    ]
    assert "Unsized cottage" not in _titles(client, bedrooms=1)


def test_a_location_search_finds_every_word_in_the_address(client, catalogue, monkeypatch):
    support_embedded_or(monkeypatch)
    member = {"Authorization": f"Bearer {account(catalogue, new_id(), 'reader@example.test')}"}

    assert _titles(client, location="surry hills, NSW") == ["Surry Hills studio"]
    assert _titles(client, location="2500") == ["Wollongong flat"]
    assert _titles(client, location="king st", headers=member) == ["Newtown house"]
    assert _titles(client, location="NSW", limit=2) == ["Newtown house", "Surry Hills studio"]
    assert _titles(client, location="Perth") == []
    assert _titles(client, location="%,()") == _titles(client)


def test_a_signed_out_search_never_confirms_a_street(client, catalogue, monkeypatch):
    # Signed out, the street is hidden: a search by its words or number must not find the listing either.
    support_embedded_or(monkeypatch)
    member = {"Authorization": f"Bearer {account(catalogue, new_id(), 'reader@example.test')}"}

    for words in ("king st", "King 12", "12", "crown street"):
        assert _titles(client, location=words) == [], words
    assert _titles(client, location="Newtown 2042") == ["Newtown house"]
    assert _titles(client, location="King 12", headers=member) == ["Newtown house"]
    assert _titles(client, location="King 14", headers=member) == []


def test_only_published_reviews_count_towards_a_listing(client, owner):
    listing_id, prop_id = seed_listing(owner)
    # One review per reviewer and property (reviews_property_id_reviewer_user_id_key).
    reviewers = [new_id() for _ in range(3)]
    owner.seed("users", [user_row(id, f"Tenant {n}") for n, id in enumerate(reviewers)])
    owner.seed("reviews", [
        review_row(prop_id, 5), review_row(prop_id, 4, reviewer_user_id=OTHER_TENANT),
        *(review_row(prop_id, 1, status, reviewer_user_id=id)
          for status, id in zip(("HIDDEN", "FLAGGED", "ARCHIVED"), reviewers)),
    ])

    body = client.get(f"{API}/properties/{listing_id}").json()

    assert (body["review_count"], body["rating_avg"]) == (2, 4.5)


def test_a_listing_closed_to_applications_opens_but_is_not_searched(client, owner):
    closed, _ = seed_listing(owner, status="APPLICATIONS_CLOSED")
    draft, _ = seed_listing(owner, status="DRAFT")

    assert client.get(f"{API}/properties/{closed}").json()["status"] == "available"
    assert client.get(f"{API}/properties/{draft}").status_code == 404
    assert _titles(client) == []


def test_photos_show_cover_first_and_leave_videos_out(client, owner):
    listing_id, prop_id = seed_listing(owner)
    owner.seed("property_media", [
        media_row(prop_id, "https://cdn.example.test/1.jpg", 0),
        media_row(prop_id, "https://cdn.example.test/cover.jpg", 2, True),
        media_row(prop_id, "https://cdn.example.test/tour.mp4", 1, media_type="video/mp4"),
        media_row(prop_id, "kitchen.jpg", 3, storage_bucket=BUCKET, storage_path="mobile/kitchen.jpg"),
    ])

    photos = client.get(f"{API}/properties/{listing_id}").json()["photo_urls"]

    assert photos == [
        "https://cdn.example.test/cover.jpg",
        "https://cdn.example.test/1.jpg",
        f"http://supabase.invalid/storage/v1/object/public/{BUCKET}/mobile/kitchen.jpg",
    ]


def test_amenities_are_read_from_every_page_of_properties(client, owner, monkeypatch):
    monkeypatch.setattr(properties_service, "PAGE_SIZE", 2)
    owner.seed("properties", [
        property_row(id=new_id(), metadata=metadata)
        for metadata in ({"amenities": ["Pool"]}, {"amenities": ["Balcony", "Pool"]}, None,
                         {"amenities": ["Garage", 7]}, {"floor": 2})
    ])

    response = client.get(f"{API}/properties/amenities")

    assert (response.status_code, response.json()) == (200, ["Balcony", "Garage", "Pool"])
