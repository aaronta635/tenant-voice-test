"""The review functions' stand-ins keep the details of their SQL (tests/fake_rpcs/fa_reviews.py).

Each case is one the backend's tests lean on: Postgres rounding, the photo
key rule, what mobile_review_json returns, and mobile_admin_moderate_review
never keeping its update.
"""

import pytest
from postgrest.exceptions import APIError

from app.core.supabase import user_client
from tests.factories_identity import account
from tests.factories_reviews_complaints import application, listing, property_row, review

pytestmark = pytest.mark.usefixtures("strict_schema")

TESS = "a1300000-0000-4000-8000-000000000001"
OLIVIA = "a1300000-0000-4000-8000-000000000002"
ADA = "a1300000-0000-4000-8000-000000000003"
PROPERTY = "b1300000-0000-4000-8000-000000000001"
LISTING = "b1300000-0000-4000-8000-000000000002"
REVIEW = "d1300000-0000-4000-8000-000000000001"
RATINGS = {"conditionAtMoveIn": 5, "ownerResponsiveness": 4, "complianceFairness": 4, "costValue": 4,
           "maintenanceHandling": 5, "repairQuality": 5, "safetyPrivacy": 5, "neighbourhood": 4}


@pytest.fixture
def tokens(strict_schema):
    found = {
        TESS: account(strict_schema, TESS, "tess@example.test", full_name="  "),
        OLIVIA: account(strict_schema, OLIVIA, "olivia@example.test", "LANDLORD"),
        ADA: account(strict_schema, ADA, "ada@example.test", "ADMIN"),
    }
    strict_schema.seed("properties", [property_row(PROPERTY, OLIVIA, property_type="APARTMENT")])
    strict_schema.seed("listings", [listing(LISTING, PROPERTY, OLIVIA, "Harbour flat")])
    strict_schema.seed("rental_applications", [application("c1300000-0000-4000-8000-000000000001", LISTING, TESS)])
    return found


def submit(tokens, **params):
    return user_client(tokens[TESS]).rpc("mobile_submit_review", {
        "p_property_id": PROPERTY, "p_ratings": RATINGS, "p_title": None, "p_body": "Good.", **params,
    }).execute().data


def test_scores_round_half_away_from_zero_as_postgres_does(strict_schema, tokens):
    saved = submit(tokens)

    # 36 / 8 = 4.5 and 18 / 4 = 4.5 both round up, where Python's round() would go to 4.
    assert (saved["rating"], saved["landlordRating"]) == (5, 5)
    # A blank name reads as the email, as coalesce(nullif(trim(full_name), ''), email) does.
    [notice] = strict_schema.tables["notifications"]
    assert notice["body"] == "tess@example.test rated Harbour flat 5/5."


def test_the_review_json_is_the_mobile_apps_shape(strict_schema, tokens):
    saved = submit(tokens, p_title="  Sunny  ", p_photos=[f" {TESS}/a.png ", f"{TESS}/a.png", f"{TESS}/b.png"])

    assert (saved["title"], saved["userName"], saved["mine"], saved["reportedByMe"], saved["status"]) == (
        "Sunny", "Verified tenant", True, False, "published")
    # Photo keys trimmed, repeats dropped, first-seen order.
    assert saved["photos"] == [f"{TESS}/a.png", f"{TESS}/b.png"]
    assert (saved["propertyName"], saved["propertyAddress"], saved["listingId"]) == (
        "Harbour flat", "Wollongong, NSW", LISTING)


@pytest.mark.parametrize("photos, message", [
    ([f"{TESS}/{n}.png" for n in range(5)], "You can attach up to 4 photos."),
    ([f"{OLIVIA}/a.png"], "A photo could not be attached. Please add it again."),
    ([f"{TESS}/nested/a.png"], "A photo could not be attached. Please add it again."),
])
def test_photo_keys_must_be_the_tenants_own_and_at_most_four(strict_schema, tokens, photos, message):
    with pytest.raises(APIError) as refused:
        submit(tokens, p_photos=photos)

    assert (refused.value.code, refused.value.message) == ("22023", message)
    assert not strict_schema.tables.get("reviews")


def test_the_homes_rating_rounds_to_one_place(strict_schema, tokens):
    other = "a1300000-0000-4000-8000-000000000009"
    strict_schema.seed("reviews", [review(REVIEW, other, OLIVIA, 4, property_id=PROPERTY),
                                   review("d1300000-0000-4000-8000-000000000002", OLIVIA, OLIVIA, 5,
                                          property_id=PROPERTY),
                                   review("d1300000-0000-4000-8000-000000000003", ADA, OLIVIA, 4,
                                          property_id=PROPERTY)])

    [home] = user_client(tokens[TESS]).rpc("mobile_reviewable_homes", {}).execute().data

    assert (home["rating"], home["reviewCount"], home["type"]) == (4.3, 3, "Apartment")


def test_moderation_raises_after_its_checks_and_keeps_nothing(strict_schema, tokens):
    strict_schema.seed("reviews", [review(REVIEW, TESS, OLIVIA, 1, property_id=PROPERTY,
                                          media_urls={"reports": [{"userId": OLIVIA, "reason": "spam"}]})])

    def moderate(user_id, action):
        return user_client(tokens[user_id]).rpc("mobile_admin_moderate_review", {
            "p_review_id": REVIEW, "p_action": action}).execute()

    for user_id, action, code in [(OLIVIA, "HIDE", "42501"), (ADA, "BURY", "22023"), (ADA, " hide ", "P0002")]:
        with pytest.raises(APIError) as refused:
            moderate(user_id, action)
        assert refused.value.code == code
    [row] = strict_schema.tables["reviews"]
    assert (row["status"], len(row["media_urls"]["reports"])) == ("PUBLISHED", 1)
    assert not strict_schema.tables.get("mobile_admin_audit_entries")
