"""Structured property reviews on the shared contract (tracker R12).

A tenant reviews a home they rented through mobile_submit_review, run as
them: all 8 category ratings, the text, the details and up to 4 photos,
which the web stores in review-photos at <users.id>/<file> first and takes
back when the review fails. The homes they may review come from
mobile_reviewable_homes. The property page reads the PUBLISHED reviews with
their ratings, never the private eviction answer or the reviewer's name or
id (only the author and admins read that answer), and photos only through
short-lived links for signed-in members. Reports go through
mobile_report_review, and the landlord's reply through reply_to_listing_review.
"""

import json

import pytest

from app.services import reviews
from tests.factories_identity import account
from tests.factories_reviews_complaints import application, listing, property_row, review

pytestmark = pytest.mark.usefixtures("strict_schema")

TESS = "a1200000-0000-4000-8000-000000000001"
NINA = "a1200000-0000-4000-8000-000000000002"
OLIVIA = "a1200000-0000-4000-8000-000000000003"
LUKE = "a1200000-0000-4000-8000-000000000004"
ADA = "a1200000-0000-4000-8000-000000000005"
FERN = "a1200000-0000-4000-8000-000000000006"
PROPERTY = "b1200000-0000-4000-8000-000000000001"
LISTING = "b1200000-0000-4000-8000-000000000002"
OTHER_PROPERTY = "b1200000-0000-4000-8000-000000000003"
OTHER_LISTING = "b1200000-0000-4000-8000-000000000004"
API = "/api/v1"
BUCKET = "review-photos"

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
GIF = b"GIF89a" + b"\x00" * 32
RATINGS = {
    "conditionAtMoveIn": 4, "ownerResponsiveness": 5, "complianceFairness": 4, "costValue": 3,
    "maintenanceHandling": 5, "repairQuality": 4, "safetyPrivacy": 5, "neighbourhood": 4,
}
DETAILS = {
    "pros": "Bright rooms and a quiet street.",
    "cons": "Small kitchen.",
    "advice_to_owner": "Fix the back gate.",
    "would_recommend": True,
    "issues_disclosed": False,
    "maintenance_or_eviction_issue": True,
    "reported_issues": ["Plumbing: fixed within 1-3 days", "  "],
}


@pytest.fixture
def db(strict_schema):
    """Tess rented Olivia's Harbour flat; Nina only applied. Each has a token, as the shared functions need."""
    strict_schema.tokens_by_user = {
        TESS: account(strict_schema, TESS, "tess@example.test", full_name="Tess Tenant"),
        NINA: account(strict_schema, NINA, "nina@example.test", full_name="Nina Neighbour"),
        OLIVIA: account(strict_schema, OLIVIA, "olivia@example.test", "LANDLORD", full_name="Olivia Owner"),
        LUKE: account(strict_schema, LUKE, "luke@example.test", "LANDLORD", full_name="Luke Landlord"),
        ADA: account(strict_schema, ADA, "ada@example.test", "ADMIN", full_name="Ada Admin"),
    }
    strict_schema.seed("properties", [property_row(PROPERTY, OLIVIA), property_row(OTHER_PROPERTY, LUKE)])
    strict_schema.seed("listings", [listing(LISTING, PROPERTY, OLIVIA, "Harbour flat"),
                                    listing(OTHER_LISTING, OTHER_PROPERTY, LUKE, "Hill house")])
    strict_schema.seed("rental_applications", [
        application("c1200000-0000-4000-8000-000000000001", LISTING, TESS),
        application("c1200000-0000-4000-8000-000000000002", LISTING, NINA, status="SHORTLISTED"),
    ])
    return strict_schema


def headers(db, user_id) -> dict:
    return {"Authorization": f"Bearer {db.tokens_by_user[user_id]}"}


def auth_id(db, user_id) -> str:
    return db.tokens[db.tokens_by_user[user_id]]


def submit(client, db, user_id=TESS, property_id=LISTING, photos=(), **changes):
    body = {"ratings": RATINGS, "title": "Bright flat", "body": "Quiet street and quick repairs.", "details": DETAILS,
            **changes}
    files = [("photos", (f"photo-{index}", data, kind)) for index, (data, kind) in enumerate(photos)]
    return client.post(f"{API}/properties/{property_id}/reviews", data={"review": json.dumps(body)},
                       files=files or None, headers=headers(db, user_id))


def stored_reviews(db) -> list[dict]:
    return db.tables.get("reviews", [])


def stored_photos(db) -> list[str]:
    return sorted(path for bucket, path in db.storage.objects if bucket == BUCKET)


def listed(client, db=None, user_id=None) -> list[dict]:
    response = client.get(f"{API}/properties/{LISTING}/reviews", headers=headers(db, user_id) if user_id else {})
    assert response.status_code == 200, response.text
    return response.json()


def test_a_tenant_picks_a_home_they_rented_and_reviews_it_once(client, db):
    homes = client.get(f"{API}/me/reviewable-homes", headers=headers(db, TESS))

    assert homes.status_code == 200, homes.text
    assert [(home["property_id"], home["listing_id"], home["name"], home["address"], home["review_count"])
            for home in homes.json()] == [(PROPERTY, LISTING, "Harbour flat", "Wollongong, NSW", 0)]
    # Run as Tess: the function takes her from her token.
    assert db.rpc_callers[-1] == ("mobile_reviewable_homes", auth_id(db, TESS))
    # Nina's application was never approved.
    assert client.get(f"{API}/me/reviewable-homes", headers=headers(db, NINA)).json() == []

    assert submit(client, db).status_code == 201
    assert client.get(f"{API}/me/reviewable-homes", headers=headers(db, TESS)).json() == []


@pytest.mark.parametrize("user_id", [OLIVIA, ADA])
def test_only_tenants_have_homes_to_review(client, db, user_id):
    assert client.get(f"{API}/me/reviewable-homes", headers=headers(db, user_id)).status_code == 403
    assert client.get(f"{API}/me/reviewable-homes").status_code == 401


def test_a_review_keeps_all_eight_ratings_the_details_and_the_photos(client, db):
    response = submit(client, db, photos=[(PNG, "image/png"), (JPEG, "image/jpeg")])

    assert response.status_code == 201, response.text
    body = response.json()
    [row] = stored_reviews(db)
    assert body["id"] == row["id"]
    assert (row["property_id"], row["reviewer_user_id"], row["reviewed_user_id"]) == (PROPERTY, TESS, OLIVIA)
    assert (row["status"], row["is_verified_interaction"], row["title"], row["body"]) == (
        "PUBLISHED", True, "Bright flat", "Quiet street and quick repairs.")
    # The overall score averages the 8 (34/8, rounded half up); the landlord's its 4 (18/4).
    assert (row["rating"], row["landlord_rating"]) == (4, 5)
    photos = row["media_urls"]["photos"]
    assert len(photos) == 2 and all(path.startswith(f"{TESS}/") for path in photos)
    assert stored_photos(db) == sorted(photos)
    assert row["media_urls"]["mobile"] == {
        "ratings": RATINGS, "pros": "Bright rooms and a quiet street.", "cons": "Small kitchen.",
        "adviceToOwner": "Fix the back gate.", "wouldRecommend": True, "issuesDisclosed": False,
        "maintenanceOrEvictionIssue": True, "reportedIssues": ["Plumbing: fixed within 1-3 days"],
    }
    assert db.rpc_callers[-1] == ("mobile_submit_review", auth_id(db, TESS))
    # The author reads their review back as saved, the private answer and photo links included.
    assert (body["ratings"], body["rating"], body["landlord_rating"], body["status"], body["mine"]) == (
        RATINGS, 4, 5, "PUBLISHED", True)
    assert (body["maintenance_or_eviction_issue"], body["photo_count"], len(body["photos"])) == (True, 2, 2)
    assert body["reported_issues"] == ["Plumbing: fixed within 1-3 days"]
    # The function told the landlord.
    [notice] = [n for n in db.tables["notifications"] if n["user_id"] == OLIVIA]
    assert (notice["title"], notice["body"]) == ("New property review", "Tess Tenant rated Harbour flat 4/5.")


def test_a_review_is_saved_to_the_property_by_its_own_id_too(client, db):
    assert submit(client, db, property_id=PROPERTY).status_code == 201
    assert [row["property_id"] for row in stored_reviews(db)] == [PROPERTY]


@pytest.mark.parametrize("changes, message", [
    ({"ratings": {**RATINGS, "costValue": 6}}, "Please rate all categories before continuing."),
    ({"ratings": {**RATINGS, "costValue": 0}}, "Please rate all categories before continuing."),
    ({"ratings": {key: 4 for key in list(RATINGS)[:7]}}, "Please rate all categories before continuing."),
    ({"body": "   "}, "Please share your overall experience."),
    ({"body": "x" * 4001}, "Your review can be up to 4000 characters."),
    ({"title": "x" * 121}, "The review title can be up to 120 characters."),
    ({"details": {**DETAILS, "pros": "x" * 1001}}, "Pros, cons and advice can be up to 1000 characters each."),
])
def test_a_review_the_function_refuses_says_why_and_takes_its_photos_back(client, db, changes, message):
    response = submit(client, db, photos=[(PNG, "image/png")], **changes)

    assert response.status_code == 422, response.text
    assert response.json()["detail"] == message
    assert stored_reviews(db) == [] and stored_photos(db) == []


def test_a_score_that_is_not_a_whole_number_is_refused_before_anything_is_stored(client, db):
    response = submit(client, db, photos=[(PNG, "image/png")], ratings={**RATINGS, "costValue": 4.5})

    assert response.status_code == 422
    assert stored_photos(db) == [] and db.rpc_calls == []


def test_a_fifth_photo_is_refused_before_anything_is_stored(client, db):
    response = submit(client, db, photos=[(PNG, "image/png")] * 5)

    assert response.status_code == 422
    assert response.json()["detail"] == "You can attach up to 4 photos."
    assert stored_photos(db) == [] and db.rpc_calls == []


def test_a_photo_the_bucket_refuses_takes_the_others_back(client, db):
    response = submit(client, db, photos=[(PNG, "image/png"), (GIF, "image/gif")])

    assert response.status_code == 415
    assert stored_photos(db) == [] and stored_reviews(db) == [] and db.rpc_calls == []


def test_a_second_review_of_a_home_is_refused(client, db):
    assert submit(client, db).status_code == 201

    again = submit(client, db, photos=[(PNG, "image/png")])

    assert again.status_code == 409
    assert again.json()["detail"] == "A tenant can only review a property once"
    assert len(stored_reviews(db)) == 1 and stored_photos(db) == []


@pytest.mark.parametrize("user_id, property_id, code, message", [
    (NINA, LISTING, 403, "Only an approved tenant can review this property"),  # shortlisted only
    (TESS, OTHER_LISTING, 403, "Only an approved tenant can review this property"),
    (TESS, "b1200000-0000-4000-8000-000000000099", 404, "Property not found."),
    (OLIVIA, LISTING, 403, "Only tenants can review a property."),
    (ADA, LISTING, 403, "Only tenants can review a property."),
])
def test_only_an_approved_tenant_reviews_a_home(client, db, user_id, property_id, code, message):
    response = submit(client, db, user_id=user_id, property_id=property_id, photos=[(PNG, "image/png")])

    assert response.status_code == code, response.text
    assert response.json()["detail"] == message
    assert stored_reviews(db) == [] and stored_photos(db) == []


def test_a_signed_out_visitor_cannot_review(client, db):
    response = client.post(f"{API}/properties/{LISTING}/reviews", data={"review": json.dumps({"ratings": RATINGS})})
    assert response.status_code == 401
    assert stored_reviews(db) == []


def test_the_old_review_payload_asks_for_the_review_form(client, db):
    response = client.post(f"{API}/reviews", json={"property_id": LISTING, "rating": 4, "comment": "Good view."},
                           headers=headers(db, TESS))

    assert response.status_code == 422
    assert stored_reviews(db) == []


@pytest.fixture
def reviewed(client, db):
    """Tess's review with two photos, and reviews of the flat a moderator took down or someone flagged."""
    response = submit(client, db, photos=[(PNG, "image/png"), (JPEG, "image/jpeg")])
    assert response.status_code == 201, response.text
    # A reviewer reviews a property once (reviews_property_id_reviewer_user_id_key): Fern, an earlier tenant.
    db.tokens_by_user[FERN] = account(db, FERN, "fern@example.test", full_name="Fern Former")
    db.seed("reviews", [
        review("d1200000-0000-4000-8000-000000000001", NINA, OLIVIA, 1, property_id=PROPERTY, body="Hidden.",
               status="HIDDEN"),
        review("d1200000-0000-4000-8000-000000000002", FERN, OLIVIA, 2, property_id=PROPERTY, body="Flagged.",
               status="FLAGGED"),
    ])
    return response.json()["id"]


def test_a_visitor_reads_published_reviews_without_names_private_answers_or_photos(client, db, reviewed):
    [shown] = listed(client)

    assert shown["id"] == reviewed
    assert (shown["client_name"], shown["client_avatar_url"], shown["verified"]) == ("Verified tenant", None, True)
    assert (shown["ratings"], shown["title"], shown["comment"], shown["would_recommend"]) == (
        RATINGS, "Bright flat", "Quiet street and quick repairs.", True)
    assert (shown["pros"], shown["cons"], shown["advice_to_owner"], shown["issues_disclosed"]) == (
        "Bright rooms and a quiet street.", "Small kitchen.", "Fix the back gate.", False)
    # The private answer and the photos stay back; how many photos there are does not.
    assert (shown["maintenance_or_eviction_issue"], shown["photos"], shown["photo_count"]) == (None, [], 2)
    assert (shown["mine"], shown["reported_by_me"]) == (False, False)
    text = client.get(f"{API}/properties/{LISTING}/reviews").text
    for private in (TESS, "Tess", "tess@example.test", BUCKET, "client_id"):
        assert private not in text


def test_a_signed_in_member_sees_the_photos_through_short_lived_links(client, db, reviewed):
    db.storage.signatures.clear()  # the uploads' own

    [shown] = listed(client, db, NINA)

    assert shown["maintenance_or_eviction_issue"] is None
    assert len(shown["photos"]) == 2
    assert all(photo["expires_in"] == reviews.PHOTO_LINK_TTL <= 15 * 60 for photo in shown["photos"])
    assert all(f"/storage/v1/object/sign/{BUCKET}/" in photo["url"] for photo in shown["photos"])
    keys = next(row for row in stored_reviews(db) if row["id"] == reviewed)["media_urls"]["photos"]
    assert {(path, ttl) for bucket, path, ttl in db.storage.signatures if bucket == BUCKET} == {
        (key, reviews.PHOTO_LINK_TTL) for key in keys}
    # Nothing else names the reviewer. (A link's path is the bucket's key, <users.id>/<file>.)
    assert TESS not in json.dumps({**shown, "photos": []})


@pytest.mark.parametrize("user_id, mine", [(TESS, True), (ADA, False)])
def test_only_the_author_and_admins_read_the_private_answer(client, db, reviewed, user_id, mine):
    [shown] = listed(client, db, user_id)

    assert (shown["maintenance_or_eviction_issue"], shown["mine"]) == (True, mine)
    for other in (NINA, OLIVIA):
        assert listed(client, db, other)[0]["maintenance_or_eviction_issue"] is None


def test_a_review_saved_without_details_lists_with_its_score_alone(client, db):
    db.seed("reviews", [review("d1200000-0000-4000-8000-000000000003", NINA, OLIVIA, 3, property_id=PROPERTY,
                               body="Fine.", is_verified_interaction=False)])

    [shown] = listed(client)

    assert (shown["rating"], shown["ratings"], shown["client_name"], shown["photo_count"]) == (3, {}, "Tenant", 0)


def test_any_member_reports_a_review_once_with_a_reason(client, db, reviewed):
    response = client.post(f"{API}/reviews/{reviewed}/reports", headers=headers(db, NINA),
                           json={"reason": "misleading", "details": " Never had a back gate. "})

    assert response.status_code == 201, response.text
    assert response.json() == {"review_id": reviewed, "reason": "misleading", "reported_by_me": True}
    row = next(row for row in stored_reviews(db) if row["id"] == reviewed)
    [report] = row["media_urls"]["reports"]
    assert (report["userId"], report["reason"], report["details"]) == (NINA, "misleading", "Never had a back gate.")
    assert row["status"] == "PUBLISHED"
    assert db.rpc_callers[-1] == ("mobile_report_review", auth_id(db, NINA))
    # The function told the admins.
    [notice] = [n for n in db.tables["notifications"] if n["user_id"] == ADA]
    assert (notice["title"], notice["body"]) == (
        "Review reported", 'Misleading information: "Bright flat" — Never had a back gate.')
    assert listed(client, db, NINA)[0]["reported_by_me"] is True

    again = client.post(f"{API}/reviews/{reviewed}/reports", headers=headers(db, NINA), json={"reason": "spam"})
    assert (again.status_code, again.json()["detail"]) == (409, "You have already reported this review.")


@pytest.mark.parametrize("user_id, review_id, payload, code, message", [
    (TESS, None, {"reason": "spam"}, 422, "You cannot report your own review."),
    (NINA, None, {"reason": "rude"}, 422, "Please select a reason for reporting this review."),
    (NINA, None, {"reason": "other", "details": "x" * 501}, 422, "Extra details can be up to 500 characters."),
    (NINA, "d1200000-0000-4000-8000-000000000001", {"reason": "spam"}, 404, "Review not found."),  # hidden
    (NINA, "d1200000-0000-4000-8000-000000000002", {"reason": "spam"}, 404, "Review not found."),  # flagged
])
def test_a_report_the_function_refuses_says_why(client, db, reviewed, user_id, review_id, payload, code, message):
    response = client.post(f"{API}/reviews/{review_id or reviewed}/reports", headers=headers(db, user_id), json=payload)

    assert (response.status_code, response.json()["detail"]) == (code, message)
    assert all(not (row["media_urls"] or {}).get("reports") for row in stored_reviews(db))


def test_a_signed_out_visitor_cannot_report(client, db, reviewed):
    assert client.post(f"{API}/reviews/{reviewed}/reports", json={"reason": "spam"}).status_code == 401


def test_the_landlord_replies_through_the_shared_function(client, db, reviewed):
    response = client.patch(f"{API}/reviews/{reviewed}/reply", headers=headers(db, OLIVIA),
                            json={"provider_reply": " Thanks, Tess! "})

    assert response.status_code == 200, response.text
    assert response.json()["provider_reply"] == "Thanks, Tess!"
    row = next(row for row in stored_reviews(db) if row["id"] == reviewed)
    assert (row["landlord_reply"], row["reviewed_user_id"]) == ("Thanks, Tess!", OLIVIA)
    assert row["landlord_replied_at"] == row["updated_at"]
    name, params = db.rpc_calls[-1]
    assert (name, params["p_listing_id"], params["p_landlord_id"], params["p_review_id"]) == (
        "reply_to_listing_review", LISTING, OLIVIA, reviewed)
    # The service role calls it with the landlord as a parameter, and it tells the reviewer: once.
    assert db.rpc_callers[-1] == ("reply_to_listing_review", None)
    assert [n["title"] for n in db.tables["notifications"] if n["user_id"] == TESS] == [
        "Landlord replied to your review"]
    assert listed(client)[0]["provider_reply"] == "Thanks, Tess!"


@pytest.mark.parametrize("user_id, review_id, payload, code, message", [
    (LUKE, None, {"provider_reply": "Hi"}, 403, "Only the property landlord can reply to this review"),
    (OLIVIA, None, {"provider_reply": "   "}, 422, "Reply must be between 1 and 2000 characters"),
    (OLIVIA, "d1200000-0000-4000-8000-000000000002", {"provider_reply": "Hi"}, 409,
     "This review was reported and waits for a moderator. You can reply once it has been checked."),
    (OLIVIA, "d1200000-0000-4000-8000-000000000001", {"provider_reply": "Hi"}, 404, "Review not found"),
])
def test_a_reply_the_function_refuses_says_why(client, db, reviewed, user_id, review_id, payload, code, message):
    response = client.patch(f"{API}/reviews/{review_id or reviewed}/reply", headers=headers(db, user_id), json=payload)

    assert (response.status_code, response.json()["detail"]) == (code, message)
    assert all(row["landlord_reply"] is None for row in stored_reviews(db))
    assert not [n for n in db.tables.get("notifications", []) if n["user_id"] in (TESS, NINA)]


def test_a_tenant_cannot_reply(client, db, reviewed):
    response = client.patch(f"{API}/reviews/{reviewed}/reply", headers=headers(db, TESS), json={"provider_reply": "Hi"})
    assert response.status_code == 403
