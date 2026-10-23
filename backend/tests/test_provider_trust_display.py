"""What the provider pages show of verification (tracker R17, R23).

The marketplace's cards and provider page carry the account's verified seal,
the one public profiles show: an admin approved the account
(badges.is_verified), which an approved credential alone does not make. The
provider's credentials page gives a rejected credential the admin's reason,
until a new file sends it back to review.
"""

import pytest

from tests.factories_documents import stored_file
from tests.factories_identity import account
from tests.factories_provider_core import credential_row, provider_profile, seed_provider

pytestmark = pytest.mark.usefixtures("strict_schema")

API = "/api/v1"
VERIFIED = "71000000-0000-4000-8000-000000000001"
WAITING = "71000000-0000-4000-8000-000000000002"
PAT = "71000000-0000-4000-8000-000000000003"
INSURANCE = "d7000000-0000-4000-8000-000000000001"
PHOTO_ID = "d7000000-0000-4000-8000-000000000002"


def test_marketplace_cards_and_pages_carry_the_accounts_verified_seal(client, strict_schema):
    seed_provider(strict_schema, VERIFIED, business_name="Approved Co", slug="approved-co")
    seed_provider(strict_schema, WAITING, business_name="Waiting Co", slug="waiting-co")
    next(row for row in strict_schema.tables["users"] if row["id"] == VERIFIED)["verification_status"] = "APPROVED"
    # An approved credential earns its own badge, not the account's seal.
    strict_schema.seed("profile_documents", [credential_row(PHOTO_ID, WAITING, "id", status="verified")])

    cards = {card["id"]: card for card in client.get(f"{API}/providers").json()}

    assert (cards[VERIFIED]["verified"], cards[WAITING]["verified"]) == (True, False)
    assert (cards[VERIFIED]["verifications"], cards[WAITING]["verifications"]) == ([], ["ID"])
    assert client.get(f"{API}/providers/approved-co").json()["verified"] is True
    assert client.get(f"{API}/providers/waiting-co").json()["verified"] is False


@pytest.fixture
def pat(strict_schema):
    token = account(strict_schema, PAT, "pat@example.test", "SERVICE_PROVIDER", full_name="Pat Plumber")
    strict_schema.seed("service_provider_profiles", [provider_profile(PAT, "Pat's Plumbing")])
    strict_schema.seed("profile_documents", [
        credential_row(INSURANCE, PAT, "insurance", status="rejected", rejection_reason="The policy has expired.",
                       file_url=stored_file(strict_schema, PAT, "Insurance.pdf")),
        # A reason left from an earlier review of a credential now waiting again.
        credential_row(PHOTO_ID, PAT, "id", status="pending", rejection_reason="Blurred",
                       file_url=stored_file(strict_schema, PAT, "Licence.pdf", "b" * 32)),
    ])
    return {"Authorization": f"Bearer {token}"}


def test_the_credentials_page_gives_a_rejected_credentials_reason(client, pat):
    response = client.get(f"{API}/me/verification-documents", headers=pat)

    assert response.status_code == 200, response.text
    shown = {document["id"]: (document["status"], document["rejection_reason"]) for document in response.json()}
    assert shown == {INSURANCE: ("rejected", "The policy has expired."), PHOTO_ID: ("pending", None)}


def test_replacing_a_rejected_credentials_file_clears_its_reason(client, strict_schema, pat):
    replacement = stored_file(strict_schema, PAT, "Insurance 2027.pdf", "c" * 32)

    response = client.patch(f"{API}/me/verification-documents/{INSURANCE}", json={"document_url": replacement},
                            headers=pat)

    assert response.status_code == 200, response.text
    assert (response.json()["status"], response.json()["rejection_reason"]) == ("pending", None)
