"""A tenant's profile completion: worked out once, on the server, and stored with the profile.

The scoring follows the reference's Rental Profile page: eight required rows
share 70 %, seven boosters 30 %, rounded half up; every required row makes
"ready", four "almost_ready". The reference's Payslips and Employment
contract rows are one booster: a person keeps one OTHER document.
"""

import uuid
from datetime import timedelta

import pytest

from app.schemas.profiles import sydney_today
from app.services import profile_completion, profiles
from tests.factories import NOW
from tests.factories_identity import users_row

API = "/api/v1"
URL = f"{API}/profiles/me"
MEI = "c0000000-0000-4000-8000-000000000001"
OLLY = "c0000000-0000-4000-8000-000000000002"
PROPERTY = "d0000000-0000-4000-8000-000000000001"
MOVE_IN = (sydney_today() + timedelta(days=30)).isoformat()

REQUIRED = ["personal_details", "employment", "primary_id", "secondary_id", "proof_of_address", "rental_history",
            "property_preferences", "availability"]
BOOSTERS = ["income_documents", "payslips", "bank_statements", "owner_reference", "employer_reference",
            "property_review", "received_references"]
UNAVAILABLE = {"owner_reference", "employer_reference", "received_references"}

USER = {"full_name": "Mei Lin", "phone": "0400 000 000"}
EVERY_REQUIRED_DETAIL = {
    "preferred_locations": ["Newtown"],
    "budget_max": 700.0,
    "move_in_date": MOVE_IN,
    "employment": {"types": ["full_time"], "employer": "Royal Prince Alfred"},
    "rental_history": [{"address": "1 King Street"}],
    "rental_preferences": {"property_types": ["apartment"]},
}
IDENTITY_AND_ADDRESS = [("PASSPORT", None), ("MEDICARE_CARD", None), ("UTILITY_BILL", None)]


def tenant(row: dict | None = None) -> dict:
    """Tenant details as profiles.tenant_details() reads a tenant_profiles row, from columns and metadata."""
    row = dict(row or {})
    metadata = {key: row.pop(key) for key in profiles.TENANT_METADATA_KEYS if key in row}
    return profiles.tenant_details({**row, "metadata": metadata})


def documents(*kinds, status="PENDING") -> list[dict]:
    return [{"document_type": kind, "review_status": status, "web_type": web_type} for kind, web_type in kinds]


def score(user=None, details=None, docs=(), reviewed=False) -> dict:
    return profile_completion.completion(user or {}, tenant(details), list(docs), reviewed)


# -- the scoring --------------------------------------------------------------------
def test_an_empty_profile_has_started_with_every_available_row_to_do():
    result = score()

    assert (result["score"], result["status"]) == (0, "started")
    assert [item["key"] for item in result["items"]] == REQUIRED + BOOSTERS
    assert result["missing"] == [key for key in REQUIRED + BOOSTERS if key not in UNAVAILABLE]
    assert (result["required_total"], result["boosters_total"]) == (8, 7)
    assert {item["key"] for item in result["items"] if not item["available"]} == UNAVAILABLE


@pytest.mark.parametrize(("required", "boosters", "expected"), [
    (1, 0, 9),     # 8.75
    (0, 1, 4),     # 4.29
    (1, 1, 13),    # 13.04
    (2, 0, 18),    # 17.5, rounded half up
    (4, 2, 44),    # 35 + 8.57
    (8, 0, 70),
    (8, 4, 87),    # every booster the web can count today
])
def test_required_rows_share_seventy_percent_and_boosters_thirty(required, boosters, expected, monkeypatch):
    done = {key: index < required for index, key in enumerate(REQUIRED)}
    done |= {key: index < boosters for index, key in enumerate(key for key in BOOSTERS if key not in UNAVAILABLE)}
    monkeypatch.setattr(profile_completion, "_done", lambda *args: {**dict.fromkeys(BOOSTERS, False), **done})

    result = score()

    assert result["score"] == expected
    assert (result["required_done"], result["boosters_done"]) == (required, boosters)


@pytest.mark.parametrize(("required", "status"), [(0, "started"), (3, "started"), (4, "almost_ready"),
                                                  (7, "almost_ready"), (8, "ready")])
def test_the_status_follows_the_required_rows_only(required, status, monkeypatch):
    done = {key: index < required for index, key in enumerate(REQUIRED)}
    monkeypatch.setattr(profile_completion, "_done", lambda *args: {**dict.fromkeys(BOOSTERS, True), **done})

    assert score()["status"] == status


def test_every_required_row_done_is_ready_to_share():
    result = score(USER, EVERY_REQUIRED_DETAIL, documents(*IDENTITY_AND_ADDRESS))

    assert (result["required_done"], result["status"]) == (8, "ready")
    assert result["missing"] == [key for key in BOOSTERS if key not in UNAVAILABLE]
    # A utility bill proves an address but is no income document.
    assert result["score"] == 70


def test_unavailable_rows_are_never_done_so_the_score_stops_short_of_100():
    docs = documents(*IDENTITY_AND_ADDRESS, ("BANK_STATEMENT", None), ("OTHER", "payslip"), ("WRITTEN_REFERENCE", None))

    result = score(USER, EVERY_REQUIRED_DETAIL, docs, reviewed=True)

    assert (result["score"], result["missing"]) == (87, [])
    assert all(not item["done"] for item in result["items"] if item["key"] in UNAVAILABLE)


@pytest.mark.parametrize(("user", "done"), [
    ({"full_name": "Mei Lin", "phone": "0400 000 000"}, True),
    ({"full_name": "Mei Lin", "phone": None}, False),
    ({"full_name": " ", "phone": "0400 000 000"}, False),
])
def test_personal_details_need_a_name_and_a_phone(user, done):
    assert _row(score(user), "personal_details") is done


@pytest.mark.parametrize(("employment", "done"), [
    ({"types": ["full_time"], "employer": "Acme"}, True),
    ({"types": ["full_time"]}, False),
    ({"types": ["student"]}, True),
    ({"types": ["student", "part_time"]}, False),
    ({"types": ["retired"]}, True),
    ({"employer": "Acme"}, False),
])
def test_employment_needs_a_type_and_an_employer_when_working(employment, done):
    assert _row(score(details={"employment": employment}), "employment") is done


@pytest.mark.parametrize("missing", ["preferred_locations", "budget_max", "rental_preferences"])
def test_property_preferences_need_types_suburbs_and_a_budget(missing):
    details = {key: value for key, value in EVERY_REQUIRED_DETAIL.items() if key != missing}

    assert _row(score(USER, details), "property_preferences") is False


@pytest.mark.parametrize(("kinds", "primary", "secondary"), [
    ([("PASSPORT", None)], True, False),
    ([("MEDICARE_CARD", None)], False, False),
    ([("DRIVERS_LICENCE", None), ("MEDICARE_CARD", None)], True, True),
    ([("PASSPORT", None), ("GOVERNMENT_PHOTO_ID", None)], True, True),
    ([("MEDICARE_CARD", None), ("BIRTH_CERTIFICATE", None)], False, False),
])
def test_a_secondary_id_is_a_second_identity_document_beside_a_primary_one(kinds, primary, secondary):
    result = score(docs=documents(*kinds))

    assert (_row(result, "primary_id"), _row(result, "secondary_id")) == (primary, secondary)


def test_a_rejected_document_does_not_count_and_one_in_review_does():
    pending = score(docs=documents(("UTILITY_BILL", None)))
    approved = score(docs=documents(("UTILITY_BILL", None), status="APPROVED"))
    rejected = score(docs=documents(("UTILITY_BILL", None), status="REJECTED"))

    assert [_row(result, "proof_of_address") for result in (pending, approved, rejected)] == [True, True, False]


@pytest.mark.parametrize("web_type", ["payslip", "employment_contract"])
def test_the_other_document_marked_as_a_payslip_or_a_contract_completes_one_booster(web_type):
    result = score(docs=documents(("OTHER", web_type)))
    [row] = [item for item in result["items"] if item["key"] == "payslips"]

    assert (row["done"], row["label"]) == (True, "Payslip or employment contract")
    assert _row(result, "income_documents") is True
    assert "employment_contract" not in {item["key"] for item in result["items"]}


def test_an_unmarked_other_document_completes_no_income_row():
    result = score(docs=documents(("OTHER", None), ("OTHER", "something_else")))

    assert (_row(result, "payslips"), _row(result, "income_documents")) == (False, False)
    assert _row(score(docs=documents(("CENTRELINK_STATEMENT", None))), "income_documents") is True


def test_the_income_row_names_every_document_it_counts():
    """A contract counts as income evidence, as the reference's employment letter does, so the row says so."""
    result = score(docs=documents(("OTHER", "employment_contract")))
    [income] = [item for item in result["items"] if item["key"] == "income_documents"]

    assert income["done"] is True
    assert "contract" in income["description"]


def _row(result: dict, key: str) -> bool:
    return next(item["done"] for item in result["items"] if item["key"] == key)


# -- stored with the profile ---------------------------------------------------------
@pytest.fixture
def mei(strict_schema, as_profile):
    strict_schema.seed("users", [users_row(MEI, "mei@demo.test", full_name="Mei Lin")])
    strict_schema.seed("tenant_profiles", [{"user_id": MEI, "updated_at": NOW}])
    as_profile(id=MEI, role="tenant")
    return strict_schema


def _stored_score(db) -> int:
    [row] = db.tables["tenant_profiles"]
    return row["completion_score"]


def _document(document_type: str, review_status: str = "PENDING", **metadata) -> dict:
    return {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"tenantvoice:completion-tests:{document_type}")), "user_id": MEI,
            "document_type": document_type, "file_url": f"{MEI}/{document_type.lower()}.pdf",
            "review_status": review_status, "metadata": metadata, "updated_at": NOW}


def test_a_save_stores_the_score_it_returns(client, mei):
    mei.seed("profile_documents", [_document("PASSPORT"), _document("UTILITY_BILL")])

    response = client.patch(URL, json={"phone": "0400 000 000", "tenant": {
        key: value for key, value in EVERY_REQUIRED_DETAIL.items() if key != "budget_max"
    }})

    assert response.status_code == 200, response.text
    completion = response.json()["completion"]
    # Personal details, employment, primary ID, proof of address, rental history and availability.
    assert (completion["required_done"], completion["status"], completion["score"]) == (6, "almost_ready", 53)
    assert completion["missing"][:2] == ["secondary_id", "property_preferences"]
    assert _stored_score(mei) == 53


def test_a_read_stores_a_score_that_moved_since_the_last_save(client, mei):
    assert client.get(URL).json()["completion"]["score"] == 0

    # A document upload (R15) does not save the profile, so the next read catches it up.
    mei.seed("profile_documents", [_document("PASSPORT")])
    response = client.get(URL)

    assert response.json()["completion"]["score"] == _stored_score(mei) == 9
    [row] = mei.tables["tenant_profiles"]
    assert row["updated_at"] != NOW


def test_a_review_of_a_property_counts_and_one_of_a_provider_does_not(client, mei):
    mei.seed("users", [users_row(OLLY, "olly@demo.test", "LANDLORD", full_name="Olly Owner")])
    review = {"reviewer_user_id": MEI, "reviewed_user_id": OLLY, "rating": 4, "landlord_rating": 4,
              "status": "PUBLISHED", "updated_at": NOW}
    mei.seed("reviews", [{**review, "id": "f0000000-0000-4000-8000-000000000001", "property_id": None}])
    provider_only = client.get(URL).json()["completion"]

    mei.seed("properties", [{"id": PROPERTY, "owner_user_id": OLLY, "address_line_1": "1 King St", "suburb": "Newtown",
                             "state": "NSW", "postcode": "2042", "updated_at": NOW}])
    mei.seed("reviews", [{**review, "id": "f0000000-0000-4000-8000-000000000002", "property_id": PROPERTY}])
    with_property = client.get(URL).json()["completion"]

    assert "property_review" in provider_only["missing"]
    assert "property_review" not in with_property["missing"]
    assert with_property["score"] == 4


def test_a_hidden_review_does_not_count(client, mei):
    mei.seed("users", [users_row(OLLY, "olly@demo.test", "LANDLORD")])
    mei.seed("properties", [{"id": PROPERTY, "owner_user_id": OLLY, "address_line_1": "1 King St", "suburb": "Newtown",
                             "state": "NSW", "postcode": "2042", "updated_at": NOW}])
    mei.seed("reviews", [{"id": "f0000000-0000-4000-8000-000000000003", "reviewer_user_id": MEI,
                          "reviewed_user_id": OLLY, "property_id": PROPERTY, "rating": 1, "landlord_rating": 1,
                          "status": "HIDDEN", "updated_at": NOW}])

    assert "property_review" in client.get(URL).json()["completion"]["missing"]


def test_the_other_document_marked_in_the_documents_panel_completes_its_rows(client, mei):
    def upload(kind=None):
        data = {"document_type": "OTHER", **({"kind": kind} if kind else {})}
        response = client.post(f"{API}/me/documents", data=data,
                               files={"file": (f"{kind}.pdf", b"%PDF-1.7\n", "application/pdf")})
        assert response.status_code == 201, response.text
        return {item["key"]: item["done"] for item in client.get(URL).json()["completion"]["items"]}

    payslip = upload("payslip")
    contract = upload("employment_contract")  # the one slot: it replaces the payslip
    unmarked = upload()

    assert (payslip["payslips"], payslip["income_documents"]) == (True, True)
    assert (contract["payslips"], contract["income_documents"]) == (True, True)
    assert (unmarked["payslips"], unmarked["income_documents"]) == (False, False)
    assert len(mei.tables["profile_documents"]) == 1


def test_only_tenants_have_a_completion(client, strict_schema, as_profile):
    strict_schema.seed("users", [users_row(OLLY, "olly@demo.test", "LANDLORD", full_name="Olly Owner",
                                           phone="0400 000 000")])
    as_profile(id=OLLY, role="landlord")

    assert client.get(URL).json()["completion"] is None
