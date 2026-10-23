"""Recommendation API contracts without contacting Supabase or DeepSeek.

The AI stub selects supplied evidence codes, so tests exercise the same
untrusted-output validation that protects the live integration. The member
directory is the shared users table (tests.factories_recommendations).

Regression cover for the shared-schema port: the directory fell back to the
legacy profiles table, which the shared database lacks (PGRST205, 500), and
services came from provider_services; members are now active users rows and
services the provider's live mobile_provider_services rows.
"""

import copy
import json
from types import SimpleNamespace

import httpx
import pytest
from pydantic import SecretStr

from app.core.config import settings
from app.services import provider_recommendations as service
from tests.factories import NOW
from tests.factories_identity import verify
from tests.factories_messaging import connection
from tests.factories_provider_core import provider_profile
from tests.factories_recommendations import member, offering, signed_in, uid, users

pytestmark = pytest.mark.usefixtures("strict_schema")

REAL_CALL_DEEPSEEK = service.call_deepseek
URL = "/api/v1/me/recommendations/provider"
ME = "10000000-0000-4000-8000-000000000001"
OTHER_PROVIDER = "10000000-0000-4000-8000-000000000002"
# On the shared database a provider is keyed by its owner's users.id.
PROVIDER = ME
OTHER_BUSINESS = OTHER_PROVIDER
LOCAL_OWNER = "30000000-0000-4000-8000-000000000001"
LOCAL_TENANT = "30000000-0000-4000-8000-000000000002"
AREA_OWNER = "30000000-0000-4000-8000-000000000003"
FAR_TENANT = "30000000-0000-4000-8000-000000000004"
DECLINED = "30000000-0000-4000-8000-000000000005"
ADMIN = "30000000-0000-4000-8000-000000000009"
ACTIVE_SERVICE, INACTIVE_SERVICE, OTHER_SERVICE = uid("active-service"), uid("inactive-service"), uid("other-service")


@pytest.fixture(autouse=True)
def isolated_ai(monkeypatch):
    """Never permit a real paid request, including when a local key exists."""
    service.clear_caches()
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr(""))

    def unexpected_call(_payload):
        raise AssertionError("This test must not contact DeepSeek")

    monkeypatch.setattr(service, "call_deepseek", unexpected_call)
    yield
    service.clear_caches()


@pytest.fixture
def provider_account(fake_db, as_profile):
    own_profile = member(
        ME, "service_provider", "Private Provider Name", "Newtown", "NSW",
        email="private-provider@example.test", phone="0400000001",
        metadata={"street_address": "19 Private Provider Street"},
    )
    fake_db.seed("users", [
        own_profile,
        member(OTHER_PROVIDER, "service_provider", "Other Provider", "Melbourne", "VIC"),
        member(
            LOCAL_OWNER, "landlord", "Private Owner Name", "Newtown", "NSW",
            email="private-owner@example.test", phone="0400000002",
            metadata={"street_address": "41 Secret Tenant Street",
                      "private_request": "A confidential maintenance request"},
        ),
        member(LOCAL_TENANT, "tenant", "Local Tenant", "Newtown", "NSW"),
        member(AREA_OWNER, "landlord", "Area Owner", "Parramatta", "NSW"),
        member(FAR_TENANT, "tenant", "Far Tenant", "Melbourne", "VIC"),
        member(DECLINED, "landlord", "Declined Owner", "Newtown", "NSW"),
        member(ADMIN, "admin", location="Newtown", state="NSW"),
    ])
    fake_db.seed("service_provider_profiles", [
        provider_profile(PROVIDER, category="real_estate_agent", business_name="Private Business Name", abn="PRIVATE-ABN"),
        provider_profile(OTHER_BUSINESS, category="cleaner"),
    ])
    fake_db.seed("mobile_provider_services", [
        offering(ACTIVE_SERVICE, PROVIDER, "Rental appraisal", "Parramatta", 1, price=99,
                 description="Private service notes must not be forwarded"),
        offering(INACTIVE_SERVICE, PROVIDER, "Inactive offering", "Melbourne", 2, live=False),
        offering(OTHER_SERVICE, OTHER_BUSINESS, "Other business service", "Melbourne", 3),
    ])
    fake_db.seed("connection_requests", [
        connection(DECLINED, ME, "DECLINED"),
        connection(ME, LOCAL_TENANT, "ACCEPTED"),
        connection(AREA_OWNER, ME, "PENDING"),
        # Someone else's connection must neither hide nor label this candidate.
        connection(OTHER_PROVIDER, LOCAL_OWNER, "DECLINED"),
    ])
    # AI reranking is the paid AI, for verified providers only (R18, tests/test_gate_wiring.py).
    verify(fake_db, ME, OTHER_PROVIDER)
    return signed_in(as_profile, own_profile)


def enable_ai(monkeypatch, responder=None):
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr("test-key-never-sent"))
    calls = []

    def call(payload):
        calls.append(copy.deepcopy(payload))
        if responder is not None:
            return responder(payload)
        selected = list(reversed(payload["candidates"][:payload["limit"]]))
        return {
            "recommendations": [
                {
                    "candidate_id": item["candidate_id"],
                    "reason_codes": [item["evidence"][0]["code"]],
                }
                for item in selected
            ]
        }

    monkeypatch.setattr(service, "call_deepseek", call)
    return calls


@pytest.mark.parametrize("method", ["get", "post"])
def test_requires_sign_in(client, method):
    response = client.get(URL) if method == "get" else client.post(URL + "/analyze", json={})
    assert response.status_code == 401


@pytest.mark.parametrize("role", ["tenant", "landlord", "admin"])
@pytest.mark.parametrize("method", ["get", "post"])
def test_only_service_providers_can_use_recommendations(client, as_profile, role, method):
    as_profile(role=role)
    response = client.get(URL) if method == "get" else client.post(URL + "/analyze", json={})
    assert response.status_code == 403


def test_requires_callers_own_business(client, fake_db, as_profile):
    as_profile(id=ME, role="service_provider")
    fake_db.seed("service_provider_profiles", [provider_profile(OTHER_PROVIDER)])
    assert client.get(URL).status_code == 404


@pytest.mark.parametrize("query", [
    {"role": "service_provider"}, {"limit": 0}, {"limit": 13}, {"location": "x" * 81},
])
def test_query_constraints_apply_to_both_endpoints(client, provider_account, query):
    assert client.get(URL, params=query).status_code == 422
    assert client.post(URL + "/analyze", json=query).status_code == 422


def test_cannot_supply_another_provider_id(client, provider_account):
    response = client.post(URL + "/analyze", json={"provider_id": OTHER_BUSINESS})
    assert response.status_code == 422


def test_rules_rank_local_clients_and_respect_connection_scope(client, provider_account):
    response = client.get(URL, params={"limit": 12})
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "rules"
    assert body["ai_status"] == "not_configured"
    rows = body["items"]
    assert {row["id"] for row in rows} == {LOCAL_OWNER, LOCAL_TENANT, AREA_OWNER, FAR_TENANT}
    assert rows[0]["id"] == LOCAL_OWNER
    by_id = {row["id"]: row for row in rows}
    assert by_id[LOCAL_TENANT]["connection_status"] == "accepted"
    assert by_id[AREA_OWNER]["connection_status"] == "pending"
    assert by_id[LOCAL_OWNER]["connection_status"] is None
    assert all(row["reasons"] for row in rows)
    assert all(row["match_level"] in {"strong", "possible", "explore"} for row in rows)
    assert body["generated_at"]


def test_filters_before_applying_result_limit(client, provider_account):
    response = client.get(URL, params={"role": "tenant", "location": "newtown", "limit": 1})
    assert response.status_code == 200
    assert [row["id"] for row in response.json()["items"]] == [LOCAL_TENANT]


def test_no_key_keeps_analyze_available_with_rules(client, provider_account):
    response = client.post(URL + "/analyze", json={"limit": 2})
    assert response.status_code == 200
    assert response.json()["source"] == "rules"
    assert response.json()["ai_status"] == "not_configured"
    assert len(response.json()["items"]) == 2


def test_get_never_calls_ai_even_when_configured(client, provider_account, monkeypatch):
    calls = enable_ai(monkeypatch)
    response = client.get(URL)
    assert response.status_code == 200
    assert response.json()["ai_status"] == "ready"
    assert response.json()["source"] == "rules"
    assert calls == []


def test_ai_reranks_only_supplied_candidates_with_evidence(client, provider_account, monkeypatch):
    baseline = client.get(URL, params={"limit": 2}).json()
    calls = enable_ai(monkeypatch)
    response = client.post(URL + "/analyze", json={"limit": 2})
    assert response.status_code == 200
    result = response.json()
    assert result["source"] == "deepseek"
    assert result["ai_status"] == "applied"
    assert [item["id"] for item in result["items"]] == list(reversed([item["id"] for item in baseline["items"]]))
    allowed_explanations = {
        evidence["text"] for candidate in calls[0]["candidates"] for evidence in candidate["evidence"]
    }
    assert all(set(row["reasons"]) <= allowed_explanations for row in result["items"])


def test_ai_payload_uses_aliases_and_an_explicit_public_data_allowlist(client, provider_account, monkeypatch):
    calls = enable_ai(monkeypatch)
    assert client.post(URL + "/analyze", json={"limit": 2}).status_code == 200
    payload = calls[0]
    assert set(payload) == {"provider", "candidates", "limit"}
    assert set(payload["provider"]) == {"category", "location", "state", "services"}
    assert payload["provider"]["category"] == "real_estate_agent"
    assert [row["title"] for row in payload["provider"]["services"]] == ["Rental appraisal"]
    assert all(set(row) == {"title", "service_area", "price"} for row in payload["provider"]["services"])
    aliases = [row["candidate_id"] for row in payload["candidates"]]
    assert len(set(aliases)) == len(aliases)
    assert all(alias.startswith("candidate_") for alias in aliases)
    assert all(set(row) == {"candidate_id", "role", "location", "state", "evidence"} for row in payload["candidates"])
    serialized = json.dumps(payload)
    for private_value in [
        ME, PROVIDER, LOCAL_OWNER, LOCAL_TENANT, AREA_OWNER, FAR_TENANT,
        "Private Provider Name", "Private Owner Name", "Private Business Name",
        "private-provider@example.test", "private-owner@example.test",
        "0400000001", "0400000002", "19 Private Provider Street",
        "41 Secret Tenant Street", "A confidential maintenance request", "PRIVATE-ABN",
        "Private service notes must not be forwarded", "Other business service", "Inactive offering",
    ]:
        assert private_value not in serialized


@pytest.mark.parametrize("invalid_kind", ["unknown_candidate", "duplicate", "unsupported_reason", "missing_candidate", "generated_prose"])
def test_untrusted_ai_output_falls_back_to_rules(client, provider_account, monkeypatch, invalid_kind):
    baseline = client.get(URL, params={"limit": 2}).json()["items"]

    def invalid_response(payload):
        candidates = payload["candidates"][:2]
        rows = [
            {"candidate_id": row["candidate_id"], "reason_codes": [row["evidence"][0]["code"]]}
            for row in candidates
        ]
        if invalid_kind == "unknown_candidate":
            rows[0]["candidate_id"] = "candidate_invented"
        elif invalid_kind == "duplicate":
            rows[1] = copy.deepcopy(rows[0])
        elif invalid_kind == "unsupported_reason":
            rows[0]["reason_codes"] = ["confirmed_demand_for_service"]
        elif invalid_kind == "missing_candidate":
            rows.pop()
        else:
            rows[0]["reason"] = "This person urgently needs your service."
        return {"recommendations": rows}

    enable_ai(monkeypatch, invalid_response)
    response = client.post(URL + "/analyze", json={"limit": 2})
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "rules"
    assert body["ai_status"] == "unavailable"
    assert body["items"] == baseline
    assert "urgently" not in json.dumps(body)


def test_ai_failure_returns_usable_results_without_leaking_upstream_error(client, provider_account, monkeypatch):
    def fail(_payload):
        raise httpx.TimeoutException("Authorization: Bearer test-key-never-sent; private upstream failure")

    enable_ai(monkeypatch, fail)
    response = client.post(URL + "/analyze", json={"limit": 2})
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "rules"
    assert body["ai_status"] == "unavailable"
    assert len(body["items"]) == 2
    assert "test-key-never-sent" not in response.text
    assert "private upstream failure" not in response.text


def test_identical_ai_request_uses_cache(client, provider_account, monkeypatch):
    calls = enable_ai(monkeypatch)
    first = client.post(URL + "/analyze", json={"limit": 2}).json()
    second = client.post(URL + "/analyze", json={"limit": 2}).json()
    assert first["source"] == second["source"] == "deepseek"
    assert first["items"] == second["items"]
    assert second["cached"] is True
    assert len(calls) == 1


def test_changing_filters_cannot_bypass_ai_cooldown(client, provider_account, monkeypatch):
    calls = enable_ai(monkeypatch)
    assert client.post(URL + "/analyze", json={"limit": 2}).json()["source"] == "deepseek"
    response = client.post(URL + "/analyze", json={"role": "tenant", "limit": 2})
    assert response.status_code == 200
    assert response.json()["ai_status"] == "cooldown"
    assert response.json()["source"] == "rules"
    assert all(row["role"] == "tenant" for row in response.json()["items"])
    assert len(calls) == 1


def test_ai_cache_and_cooldown_are_isolated_between_accounts(client, provider_account, as_profile, fake_db, monkeypatch):
    calls = enable_ai(monkeypatch)
    first = client.post(URL + "/analyze", json={"limit": 2})
    signed_in(as_profile, users(fake_db)[OTHER_PROVIDER])
    second = client.post(URL + "/analyze", json={"limit": 2})
    assert first.json()["source"] == second.json()["source"] == "deepseek"
    assert second.json()["cached"] is False
    assert len(calls) == 2
    assert calls[0]["provider"]["category"] == "real_estate_agent"
    assert calls[1]["provider"]["category"] == "cleaner"


def test_connection_change_cannot_resurface_declined_person_from_cache(client, provider_account, fake_db, monkeypatch):
    calls = enable_ai(monkeypatch)
    first = client.post(URL + "/analyze", json={"limit": 2}).json()
    person = first["items"][0]["id"]
    fake_db.seed("connection_requests", [connection(ME, person, "DECLINED", created_at="2026-01-02T00:00:00+00:00")])
    response = client.post(URL + "/analyze", json={"limit": 2})
    assert response.status_code == 200
    assert person not in {row["id"] for row in response.json()["items"]}
    assert len(calls) == 1


def test_empty_directory_does_not_spend_ai_request(client, provider_account, monkeypatch):
    calls = enable_ai(monkeypatch)
    response = client.post(URL + "/analyze", json={"location": "No Such Suburb"})
    assert response.status_code == 200
    assert response.json()["items"] == []
    assert calls == []


def test_ai_cache_expires_then_recomputes(client, provider_account, monkeypatch):
    calls = enable_ai(monkeypatch)
    clock = [1000.0]
    monkeypatch.setattr(service, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    first = client.post(URL + "/analyze", json={"limit": 2}).json()
    assert first["source"] == "deepseek"
    clock[0] += service.CACHE_TTL + 1
    second = client.post(URL + "/analyze", json={"limit": 2}).json()
    assert second["source"] == "deepseek"
    assert second["cached"] is False
    assert len(calls) == 2


def test_service_area_does_not_match_a_substring_or_another_state(client, provider_account, fake_db):
    # Partial suburb names and a same-named suburb in another state must not
    # invent geographical relevance to the provider's Newtown/NSW profile.
    partial, same_name = uid("partial"), uid("same-name")
    fake_db.seed("users", [
        member(partial, "tenant", "Partial Match", "Parra", "NSW"),
        member(same_name, "tenant", "Same Name", "Newtown", "VIC"),
    ])
    result = client.get(URL, params={"limit": 12}).json()
    by_id = {item["id"]: item for item in result["items"]}
    assert by_id[partial]["match_level"] == "possible"
    assert by_id[same_name]["match_level"] == "explore"
    assert all("listed service areas" not in reason for reason in by_id[partial]["reasons"])
    assert all("same area" not in reason for reason in by_id[same_name]["reasons"])


def test_deepseek_http_request_is_bounded_and_parses_json_without_network(monkeypatch):
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr("unit-test-key"))
    captured = []
    ranking = {"recommendations": [{"candidate_id": "candidate_1", "reason_codes": ["same_area"]}]}

    def respond(request):
        captured.append(request)
        return httpx.Response(200, json={
            "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(ranking)}}],
        })

    real_client = httpx.Client
    transport = httpx.MockTransport(respond)
    monkeypatch.setattr(service.httpx, "Client", lambda **kwargs: real_client(transport=transport, **kwargs))
    payload = {"provider": {"category": "cleaner"}, "candidates": [], "limit": 1}
    assert REAL_CALL_DEEPSEEK(payload) == ranking
    request = captured[0]
    assert str(request.url) == "https://api.deepseek.com/chat/completions"
    assert request.headers["Authorization"] == "Bearer unit-test-key"
    body = json.loads(request.content)
    assert body["model"] == settings.deepseek_model
    assert body["response_format"] == {"type": "json_object"}
    assert body["stream"] is False
    assert 0 < body["max_tokens"] <= 2000
    assert json.loads(body["messages"][1]["content"]) == payload
    assert all(0 < timeout <= 30 for timeout in request.extensions["timeout"].values())


@pytest.mark.parametrize("upstream", [
    {"choices": [{"finish_reason": "length", "message": {"content": "{}"}}]},
    {"choices": [{"finish_reason": "stop", "message": {"content": "not JSON"}}]},
])
def test_truncated_or_non_json_upstream_responses_are_rejected(monkeypatch, upstream):
    real_client = httpx.Client
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, json=upstream))
    monkeypatch.setattr(service.httpx, "Client", lambda **kwargs: real_client(transport=transport, **kwargs))
    with pytest.raises(ValueError):
        REAL_CALL_DEEPSEEK({"provider": {}, "candidates": [], "limit": 1})


def test_oversized_profile_fields_cannot_expand_the_ai_prompt(client, provider_account, fake_db, monkeypatch):
    oversized_location = "Newtown " + "location-detail " * 3000
    oversized_state = "NSW " + "state-detail " * 3000
    provider_account.raw.update(location=oversized_location, state=oversized_state)
    for person in (ME, LOCAL_OWNER):
        users(fake_db)[person]["metadata"].update(location=oversized_location, state=oversized_state)
    calls = enable_ai(monkeypatch)
    response = client.post(URL + "/analyze", json={"limit": 2})
    assert response.status_code == 200
    assert response.json()["source"] == "deepseek"
    # Evidence explanations embed locations as well as the explicit fields;
    # trimming only location/state properties does not bound the actual prompt.
    assert len(json.dumps(calls[0])) < 20_000


def _only_providers(fake_db):
    fake_db.tables["users"] = [row for row in fake_db.tables["users"] if row["id"] in {ME, OTHER_PROVIDER}]


def test_location_filter_finds_profiles_after_the_directory_cap(client, provider_account, fake_db):
    # The remote members share the provider's state, so only the location
    # filter, applied before each capped read, reaches the late name.
    target = uid("late-filter-match")
    _only_providers(fake_db)
    fake_db.seed("users", [
        member(uid(f"remote-{index}"), "tenant", f"A Remote {index:03}", "Albury", "NSW")
        for index in range(service.BUCKET_LIMIT + 10)
    ])
    fake_db.seed("users", [member(target, "tenant", "Z Matching Tenant", "Wollongong", "NSW")])
    response = client.get(URL, params={"role": "tenant", "location": "wollongong", "limit": 1})
    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [target]


def test_local_candidate_is_not_lost_behind_alphabetical_directory_cap(client, provider_account, fake_db):
    target = uid("late-local-match")
    _only_providers(fake_db)
    fake_db.seed("users", [
        member(uid(f"remote-{index}"), "landlord", f"A Remote {index:03}", "Adelaide", "SA")
        for index in range(service.BUCKET_LIMIT + 10)
    ])
    fake_db.seed("users", [member(target, "landlord", "Z Local Owner", "Newtown", "NSW")])
    response = client.get(URL, params={"limit": 2})
    assert response.status_code == 200
    assert response.json()["items"][0]["id"] == target


@pytest.fixture
def location_directory(provider_account, fake_db):
    postcodes = {LOCAL_OWNER: "2042", LOCAL_TENANT: "2042", AREA_OWNER: "2150", FAR_TENANT: "3000"}
    for person, postcode in postcodes.items():
        users(fake_db)[person]["metadata"]["postcode"] = postcode
    return provider_account


def test_location_suggestions_require_sign_in(client):
    assert client.get(URL + "/locations", params={"search": "new"}).status_code == 401


@pytest.mark.parametrize("role", ["tenant", "landlord", "admin"])
def test_location_suggestions_require_service_provider_role(client, as_profile, role):
    as_profile(role=role)
    assert client.get(URL + "/locations", params={"search": "new"}).status_code == 403


def test_location_suggestions_require_callers_own_business(client, fake_db, as_profile):
    as_profile(id=ME, role="service_provider")
    fake_db.seed("service_provider_profiles", [provider_profile(OTHER_PROVIDER)])
    assert client.get(URL + "/locations").status_code == 404


@pytest.mark.parametrize("query", [{"search": "x" * 81}, {"role": "service_provider"}, {"role": "admin"}])
def test_location_suggestion_input_validation(client, location_directory, query):
    assert client.get(URL + "/locations", params=query).status_code == 422


@pytest.mark.parametrize("search", ["NeWt", "2042", "newtown, NSW 2042"])
def test_location_suggestions_match_partial_suburb_postcode_and_full_label(client, location_directory, search):
    response = client.get(URL + "/locations", params={"search": search})
    assert response.status_code == 200
    assert response.json() == {"items": [{"label": "Newtown, NSW 2042", "value": "Newtown NSW 2042"}]}


def test_location_suggestions_respect_selected_client_role(client, location_directory):
    owner_results = client.get(URL + "/locations", params={"search": "melb", "role": "landlord"})
    tenant_results = client.get(URL + "/locations", params={"search": "melb", "role": "tenant"})
    assert owner_results.status_code == tenant_results.status_code == 200
    assert owner_results.json()["items"] == []
    assert tenant_results.json()["items"] == [{"label": "Melbourne, VIC 3000", "value": "Melbourne VIC 3000"}]


def test_location_suggestions_deduplicate_and_keep_usable_partial_locations(client, location_directory, fake_db):
    fake_db.seed("users", [
        member(uid("same-location"), "tenant", "Z Duplicate", "newtown", "nsw", "2042"),
        member(uid("missing-location"), "tenant", "Null Suburb", None, "NSW", "2042"),
        member(uid("blank-location"), "tenant", "Blank Suburb", "  ", "NSW", "2042"),
        member(uid("empty-location"), "tenant", "Missing Details"),
        member(uid("whitespace-location"), "tenant", "Blank Details", "  ", "  ", "  "),
    ])
    response = client.get(URL + "/locations")
    assert response.status_code == 200
    items = response.json()["items"]
    values = [item["value"].casefold() for item in items]
    assert values.count("newtown nsw 2042") == 1
    assert values.count("nsw 2042") == 1
    assert all(item["value"].strip() and item["label"].strip() for item in items)


def test_location_suggestions_are_bounded_to_eight_unique_locations(client, location_directory, fake_db):
    fake_db.seed("users", [
        member(uid(f"suburb-{index}"), "tenant", f"Suburb Member {index:02}", f"Suburb {index:02}", "NSW",
               f"{2100 + index}")
        for index in range(20)
    ])
    response = client.get(URL + "/locations", params={"search": "suburb"})
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 8
    assert len({item["value"].casefold() for item in items}) == 8


def test_empty_location_search_excludes_private_or_unavailable_profiles_and_never_calls_ai(
    client, location_directory, fake_db, monkeypatch,
):
    excluded_locations = {ME: "Selfplace", OTHER_PROVIDER: "Providerplace", ADMIN: "Adminplace", DECLINED: "Declinedplace"}
    for person, place in excluded_locations.items():
        users(fake_db)[person]["metadata"].update(location=place, state="NSW", postcode="9999")
    # Accounts that are closed or not active are no one to suggest either.
    fake_db.seed("users", [
        member(uid("suspended"), "tenant", "Sam Suspended", "Suspendedplace", "NSW", "9999", status="SUSPENDED"),
        member(uid("closed"), "landlord", "Cleo Closed", "Closedplace", "NSW", "9999", deleted_at=NOW),
    ])
    calls = enable_ai(monkeypatch)
    response = client.get(URL + "/locations")
    assert response.status_code == 200
    items = response.json()["items"]
    assert {item["value"] for item in items} == {"Newtown NSW 2042", "Parramatta NSW 2150", "Melbourne VIC 3000"}
    assert all(set(item) == {"label", "value"} for item in items)
    for private_value in [ME, LOCAL_OWNER, "Private Owner Name", "private-owner@example.test", "0400000002", "41 Secret Tenant Street"]:
        assert private_value not in response.text
    assert calls == []


def test_location_suggestion_value_filters_recommendations_without_forwarding_postcode_to_ai(
    client, location_directory, monkeypatch,
):
    suggestion = client.get(URL + "/locations", params={"search": "2042", "role": "tenant"}).json()["items"][0]
    query = {"location": suggestion["value"], "role": "tenant"}
    response = client.get(URL, params=query)
    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [LOCAL_TENANT]
    assert "postcode" not in response.json()["items"][0]
    calls = enable_ai(monkeypatch)
    analyzed = client.post(URL + "/analyze", json=query)
    assert analyzed.status_code == 200
    assert analyzed.json()["source"] == "deepseek"
    assert [item["id"] for item in analyzed.json()["items"]] == [LOCAL_TENANT]
    assert "2042" not in json.dumps(calls[0])
    assert "postcode" not in json.dumps(calls[0])


def test_location_search_filters_before_directory_cap(client, location_directory, fake_db):
    _only_providers(fake_db)
    fake_db.seed("users", [
        member(uid(f"remote-{index}"), "tenant", f"A Remote {index:03}", "Adelaide", "SA", "5000")
        for index in range(service.DIRECTORY_LIMIT + 10)
    ])
    fake_db.seed("users", [member(uid("late-location"), "tenant", "Z Matching Tenant", "Wollongong", "NSW", "2500")])
    response = client.get(URL + "/locations", params={"role": "tenant", "search": "250"})
    assert response.status_code == 200
    assert response.json()["items"] == [{"label": "Wollongong, NSW 2500", "value": "Wollongong NSW 2500"}]


def test_new_connections_precede_existing_and_reasons_do_not_repeat_owner_role(client, provider_account):
    rows = client.get(URL, params={"limit": 12}).json()["items"]
    first_existing = next(index for index, row in enumerate(rows) if row["connection_status"])
    assert all(not row["connection_status"] for row in rows[:first_existing])
    assert all(row["connection_status"] for row in rows[first_existing:])
    for row in rows:
        if any("potential audience" in reason for reason in row["reasons"]):
            assert not any("Property owner profile;" in reason for reason in row["reasons"])


def test_connection_requests_label_people_and_hide_declines(client, provider_account, fake_db):
    # The Network page saves requests in connection_requests: a person who
    # accepted there must not be offered a Connect that fails, and one who
    # declined or was blocked is not suggested again. A request withdrawn in
    # the mobile app is none.
    fake_db.seed("connection_requests", [
        connection(FAR_TENANT, ME, "ACCEPTED"),
        connection(ME, LOCAL_OWNER, "BLOCKED"),
        connection(ME, "30000000-0000-4000-8000-000000000006", "WITHDRAWN"),
    ])
    rows = client.get(URL, params={"limit": 12}).json()["items"]
    assert {row["id"]: row["connection_status"] for row in rows} == {
        LOCAL_TENANT: "accepted", AREA_OWNER: "pending", FAR_TENANT: "accepted",
    }


def test_an_agent_is_suggested_as_a_landlord(client, provider_account, fake_db):
    # As on the Network page, an agent's account lists with the landlords.
    agent = uid("agent")
    fake_db.seed("users", [member(agent, "agent", "Alex Agent", "Newtown", "NSW")])

    landlords = client.get(URL, params={"role": "landlord", "limit": 12}).json()["items"]
    tenants = client.get(URL, params={"role": "tenant", "limit": 12}).json()["items"]

    assert {item["id"]: item["role"] for item in landlords}[agent] == "landlord"
    assert agent not in {item["id"] for item in tenants}


def test_location_suggestions_leave_out_people_declined_in_connection_requests(client, location_directory, fake_db):
    melbourne = [{"label": "Melbourne, VIC 3000", "value": "Melbourne VIC 3000"}]
    assert client.get(URL + "/locations", params={"search": "melb"}).json()["items"] == melbourne
    fake_db.seed("connection_requests", [connection(FAR_TENANT, ME, "DECLINED")])
    assert client.get(URL + "/locations", params={"search": "melb"}).json()["items"] == []
