"""POST /uploads/property-image: listing photos go to the shared public bucket (plan §2.3, §3 a6)."""

import pytest

from app.services import uploads
from tests.factories_rental import OWNER, STRANGER, TENANT, media_row, photo_link, seed_listing, seed_people
from tests.fake_supabase import FakeBucket

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
BUCKET = "property-images"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def _upload(client, data: bytes, name: str = "front.png", content_type: str = "image/png"):
    return client.post(f"{API}/uploads/property-image", files={"file": (name, data, content_type)})


@pytest.fixture
def landlord(client, strict_schema, as_profile):
    as_profile(id=OWNER, role="landlord")
    return strict_schema


def test_a_landlord_uploads_a_listing_photo_to_the_public_bucket(client, landlord):
    response = _upload(client, PNG)

    assert response.status_code == 200, response.text
    body = response.json()
    folder, name = body["path"].split("/")
    assert (folder, name.endswith(".png"), len(name)) == (OWNER, True, 36)
    assert landlord.storage.objects == {(BUCKET, body["path"]): PNG}
    assert body["url"] == f"http://supabase.invalid/storage/v1/object/public/{BUCKET}/{body['path']}"
    assert (body["content_type"], body["size"]) == ("image/png", len(PNG))
    # A public bucket needs no signed link.
    assert landlord.storage.signatures == []


def test_the_file_type_comes_from_its_bytes(client, landlord):
    response = _upload(client, JPEG, name="front.png", content_type="image/jpeg")

    assert (response.status_code, response.json()["path"].endswith(".jpg")) == (200, True)


@pytest.mark.parametrize(
    ("data", "content_type"),
    [(b"%PDF-1.7 lease", "application/pdf"), (b"<svg onload=alert(1)>", "image/png"), (PNG, "image/svg+xml")],
)
def test_only_images_go_into_the_listing_bucket(client, landlord, data, content_type):
    response = _upload(client, data, content_type=content_type)

    assert response.status_code == 415
    assert landlord.storage.objects == {}


def test_a_photo_over_3_mb_is_refused(client, landlord):
    # The bucket's own limit is 3 MB, below the 5 MB the other uploads allow.
    response = _upload(client, PNG + b"\x00" * (3 * 1024 * 1024))

    assert (response.status_code, response.json()["detail"]) == (413, "File is too large (max 3 MB)")
    assert landlord.storage.objects == {}


def test_an_empty_file_is_refused(client, landlord):
    assert _upload(client, b"").status_code == 400


def test_only_landlords_upload_listing_photos(client, strict_schema, as_profile):
    as_profile(id=TENANT, role="tenant")

    assert _upload(client, PNG).status_code == 403
    assert strict_schema.storage.objects == {}


def test_a_storage_failure_is_a_bad_gateway(client, landlord, monkeypatch):
    def unavailable(self, path, data, options):
        raise RuntimeError("storage is down")

    monkeypatch.setattr(FakeBucket, "upload", unavailable)

    assert _upload(client, PNG).status_code == 502


def test_an_uploaded_photo_names_its_object_on_the_listing(client, landlord):
    seed_people(landlord)
    uploaded = _upload(client, PNG).json()

    response = client.post(f"{API}/me/properties", json={
        "title": "Harbour flat", "address": "1 Harbour Street", "suburb": "Wollongong", "state": "NSW",
        "postcode": "2500", "price": 650, "photo_urls": [uploaded["url"]],
    })

    assert response.status_code == 201, response.text
    [media] = landlord.tables["property_media"]
    assert (media["media_url"], media["storage_bucket"], media["storage_path"]) == (uploaded["url"], BUCKET, uploaded["path"])
    assert response.json()["photo_urls"] == [uploaded["url"]]


# -- discarding a photo no listing shows ---------------------------------------------
def _discard(client, url: str):
    return client.delete(f"{API}/uploads/property-image", params={"url": url})


def test_a_photo_taken_out_of_the_wizard_is_deleted(client, landlord):
    uploaded = _upload(client, PNG).json()

    assert _discard(client, uploaded["url"]).status_code == 204
    assert landlord.storage.objects == {}


@pytest.mark.parametrize("shown_by", ["storage_path", "media_url"])
def test_a_photo_a_listing_shows_is_kept(client, landlord, shown_by):
    seed_people(landlord)
    uploaded = _upload(client, PNG).json()
    _, property_id = seed_listing(landlord)
    kept = {"storage_bucket": BUCKET, "storage_path": uploaded["path"]} if shown_by == "storage_path" else {}
    url = uploaded["url"] if shown_by == "media_url" else "https://example.test/elsewhere.png"
    landlord.seed("property_media", [media_row(property_id, url, **kept)])

    response = _discard(client, uploaded["url"])

    assert response.status_code == 409
    assert (BUCKET, uploaded["path"]) in landlord.storage.objects


@pytest.mark.parametrize("url", [
    photo_link(STRANGER),  # another owner's upload
    "https://images.example.test/front.png",  # not this project's bucket
    uploads.public_url(BUCKET, f"{OWNER}/../{STRANGER}/front.png"),
])
def test_only_the_owners_own_upload_can_be_discarded(client, landlord, url):
    path = f"{STRANGER}/front.png"
    landlord.storage.objects[(BUCKET, path)] = PNG

    assert _discard(client, url).status_code == 404
    assert landlord.storage.objects == {(BUCKET, path): PNG}


def test_only_landlords_discard_listing_photos(client, strict_schema, as_profile):
    as_profile(id=TENANT, role="tenant")

    assert _discard(client, photo_link(TENANT)).status_code == 403


def test_a_public_link_names_only_an_object_of_this_bucket():
    path = f"{OWNER}/a b.jpg"
    link = uploads.public_url(BUCKET, path)

    assert link.endswith("/a%20b.jpg")
    assert uploads.public_path(link, BUCKET) == path
    assert uploads.public_path(link + "?width=200", BUCKET) == path
    assert uploads.public_path(link, "avatars") is None
    assert uploads.public_path(uploads.public_url(BUCKET, "../secret.jpg"), BUCKET) is None
    assert uploads.public_path("https://images.example.test/a.jpg", BUCKET) is None
    assert uploads.public_path(None, BUCKET) is None
