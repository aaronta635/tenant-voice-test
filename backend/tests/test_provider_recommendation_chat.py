"""Recommendation chat: criteria collection without contacting Supabase or DeepSeek.

The chat only turns what the provider types into search criteria. These tests
cover the guided (no model) questions, the validated model path, the fallbacks
and the confirmed search that uses those criteria. Members are shared users
rows and services the provider's mobile_provider_services rows
(tests.factories_recommendations).
"""

import copy
import json
from types import SimpleNamespace

import httpx
import pytest
from pydantic import SecretStr

from app.core.config import settings
from app.services import provider_recommendations as service
from tests.factories_identity import verify
from tests.factories_messaging import connection
from tests.factories_provider_core import provider_profile
from tests.factories_recommendations import member, offering, signed_in, uid

pytestmark = pytest.mark.usefixtures("strict_schema")

URL = "/api/v1/me/recommendations/provider"
CHAT = URL + "/chat"
REAL_CALL_CHAT_MODEL = service.call_chat_model
ME = "10000000-0000-4000-8000-000000000001"
OTHER_PROVIDER = "10000000-0000-4000-8000-000000000002"
# On the shared database a provider is keyed by its owner's users.id.
PROVIDER = ME
OTHER_BUSINESS = OTHER_PROVIDER
LOCAL_OWNER = "30000000-0000-4000-8000-000000000001"
LOCAL_TENANT = "30000000-0000-4000-8000-000000000002"
AREA_OWNER = "30000000-0000-4000-8000-000000000003"
APPRAISAL, LEASING = uid("svc-appraisal"), uid("svc-leasing")
INACTIVE, OTHER_BUSINESS_SERVICE = uid("svc-inactive"), uid("svc-other-business")


@pytest.fixture(autouse=True)
def isolated_ai(monkeypatch):
    """Never permit a real paid request, including when a local key exists."""
    service.clear_caches()
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr(""))

    def unexpected_call(_payload):
        raise AssertionError("This test must not contact DeepSeek")

    monkeypatch.setattr(service, "call_deepseek", unexpected_call)
    monkeypatch.setattr(service, "call_chat_model", unexpected_call)
    yield
    service.clear_caches()


@pytest.fixture
def provider_account(fake_db, as_profile):
    own_profile = member(
        ME, "service_provider", "Private Provider Name", "Newtown", "NSW",
        email="private-provider@example.test", phone="0400000001",
    )
    fake_db.seed("users", [
        own_profile,
        member(OTHER_PROVIDER, "service_provider", "Other Provider", "Melbourne", "VIC"),
        member(LOCAL_OWNER, "landlord", "Private Owner Name", "Newtown", "NSW", email="private-owner@example.test"),
        member(LOCAL_TENANT, "tenant", "Local Tenant", "Newtown", "NSW"),
        member(AREA_OWNER, "landlord", "Area Owner", "Ryde", "NSW"),
    ])
    fake_db.seed("service_provider_profiles", [
        provider_profile(PROVIDER, category="real_estate_agent", business_name="Private Business Name", abn="PRIVATE-ABN"),
        provider_profile(OTHER_BUSINESS, category="cleaner"),
    ])
    fake_db.seed("mobile_provider_services", [
        offering(APPRAISAL, PROVIDER, "Rental appraisal", "Parramatta", 1, price=99,
                 description="Private service notes must not be forwarded"),
        offering(LEASING, PROVIDER, "Leasing management", "Newtown", 2, price=450),
        offering(INACTIVE, PROVIDER, "Inactive offering", "Melbourne", 3, live=False),
        offering(OTHER_BUSINESS_SERVICE, OTHER_BUSINESS, "End of lease clean", "Melbourne", 4),
    ])
    fake_db.seed("connection_requests", [
        connection(ME, LOCAL_TENANT, "ACCEPTED"),
        connection(AREA_OWNER, ME, "PENDING"),
    ])
    # A model turn is the paid AI, for verified providers only (R18, tests/test_gate_wiring.py).
    verify(fake_db, ME)
    return signed_in(as_profile, own_profile)


def say(*texts, criteria=None, history=None):
    """A chat request body whose last message is the provider's."""
    messages = list(history or [])
    for index, text in enumerate(texts):
        role = "user" if (len(texts) - index) % 2 == 1 else "assistant"
        messages.append({"role": role, "content": text})
    body = {"messages": messages}
    if criteria is not None:
        body["criteria"] = criteria
    return body


def enable_chat_model(monkeypatch, responder):
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr("test-key-never-sent"))
    calls = []

    def call(payload):
        calls.append(copy.deepcopy(payload))
        return responder(payload)

    monkeypatch.setattr(service, "call_chat_model", call)
    return calls


def turn(action="ask", reply="Which area should I focus on?", quick_replies=None, **criteria):
    return {
        "action": action,
        "reply": reply,
        "criteria": {"role": None, "location": None, "service_ids": [], "new_only": False, **criteria},
        "quick_replies": quick_replies or [],
    }


# --- access and validation --------------------------------------------------

def test_chat_requires_sign_in(client):
    assert client.post(CHAT, json=say("hi")).status_code == 401


@pytest.mark.parametrize("role", ["tenant", "landlord", "admin"])
def test_only_service_providers_can_chat(client, as_profile, role):
    as_profile(role=role)
    assert client.post(CHAT, json=say("hi")).status_code == 403


def test_chat_requires_callers_own_business(client, fake_db, as_profile):
    as_profile(id=ME, role="service_provider")
    fake_db.seed("service_provider_profiles", [provider_profile(OTHER_PROVIDER)])
    assert client.post(CHAT, json=say("hi")).status_code == 404


@pytest.mark.parametrize("body", [
    {"messages": []},
    {"messages": [{"role": "assistant", "content": "Hello"}]},
    {"messages": [{"role": "user", "content": "   "}]},
    {"messages": [{"role": "user", "content": "x" * 601}]},
    {"messages": [{"role": "user", "content": "hi"}] * 21},
    {"messages": [{"role": "system", "content": "hi"}]},
    {"messages": [{"role": "user", "content": "hi"}], "criteria": {"role": "admin"}},
    {"messages": [{"role": "user", "content": "hi"}], "criteria": {"location": "x" * 81}},
    {"messages": [{"role": "user", "content": "hi"}], "criteria": {"service_ids": ["a"] * 6}},
    {"messages": [{"role": "user", "content": "hi"}], "provider_id": PROVIDER},
])
def test_chat_input_is_bounded_and_strict(client, provider_account, body):
    assert client.post(CHAT, json=body).status_code == 422


# --- guided questions (no model) ---------------------------------------------

def test_guided_chat_asks_for_role_first_without_ai(client, provider_account):
    data = client.post(CHAT, json=say("hi")).json()
    assert data["state"] == "ask"
    assert data["missing"] == ["role", "location"]
    assert data["reply"] == "Who would you like to reach: landlords, tenants or both?"
    assert data["quick_replies"] == ["Landlords", "Tenants", "Both"]
    assert (data["source"], data["ai_status"]) == ("rules", "not_configured")
    assert data["criteria"] == {"role": None, "location": None, "service_ids": [], "new_only": False}


def test_guided_chat_offers_own_areas_that_can_find_someone(client, provider_account):
    data = client.post(CHAT, json=say("I'd like to meet landlords")).json()
    assert data["state"] == "ask"
    assert data["criteria"]["role"] == "landlord"
    assert data["missing"] == ["location"]
    # Parramatta is a service area but no landlord profile is there, so it is not offered.
    assert data["quick_replies"] == ["Newtown", "NSW", "Anywhere"]


def test_guided_chat_confirms_once_role_and_area_are_known(client, provider_account):
    data = client.post(CHAT, json=say(
        "landlords", "Which area?", "Ryde", criteria={"role": "landlord"},
    )).json()
    assert data["state"] == "confirm"
    assert data["missing"] == []
    assert data["quick_replies"] == []
    assert data["criteria"]["location"] == "Ryde"
    assert data["reply"] == "I'll look for landlords in Ryde. Check Search details, then choose Find matches."


def test_bare_area_answer_counts_only_when_the_area_was_asked(client, provider_account):
    asked = client.post(CHAT, json=say("in Liverpool please", criteria={"role": "tenant"})).json()
    assert asked["criteria"]["location"] == "Liverpool"
    assert asked["state"] == "confirm"

    opening = client.post(CHAT, json=say("hello there")).json()
    assert opening["criteria"]["location"] is None


def test_guided_chat_understands_vietnamese(client, provider_account):
    data = client.post(CHAT, json=say("Tôi muốn tìm chủ nhà ở Newtown")).json()
    assert data["criteria"]["role"] == "landlord"
    assert data["criteria"]["location"] == "Newtown"
    assert data["state"] == "confirm"
    assert data["reply"] == "Tôi sẽ tìm chủ nhà ở Newtown. Kiểm tra mục Search details rồi chọn Find matches."

    question = client.post(CHAT, json=say("xin chào, bạn giúp tôi nhé")).json()
    assert question["reply"] == "Bạn muốn tìm chủ nhà, người thuê hay cả hai?"
    assert question["quick_replies"] == ["Chủ nhà", "Người thuê", "Cả hai"]


@pytest.mark.parametrize("text, role, location", [
    ("both, anywhere is fine", "any", ""),
    ("landlords and tenants near Newtown", "any", "Newtown"),
    ("tenants around 2150 NSW", "tenant", "2150 NSW"),
    ("renters in Victoria", "tenant", "VIC"),
    ("người thuê, ở đâu cũng được", "tenant", ""),
])
def test_guided_chat_parses_roles_and_areas(client, provider_account, text, role, location):
    data = client.post(CHAT, json=say(text)).json()
    assert data["criteria"]["role"] == role
    assert data["criteria"]["location"] == location
    assert data["state"] == "confirm"


def test_guided_chat_picks_mentioned_services_and_new_only(client, provider_account):
    data = client.post(CHAT, json=say("only new landlords in Newtown for a rental appraisal")).json()
    assert data["criteria"]["service_ids"] == [APPRAISAL]
    assert data["criteria"]["new_only"] is True


@pytest.mark.parametrize("text, expected", [
    ("landlords in Ryde for appraisals", [APPRAISAL]),
    ("tenants in Ryde for leasing and appraisal", [APPRAISAL, LEASING]),
    ("tenants in Ryde, leasing and appraisal", []),
    ("tenants in Ryde, standard services", []),
])
def test_guided_service_matching_handles_plurals_but_not_generic_words(client, provider_account, text, expected):
    assert client.post(CHAT, json=say(text)).json()["criteria"]["service_ids"] == expected


def test_chat_lists_only_own_active_services_and_drops_foreign_ids(client, provider_account):
    # "svc-leasing-id" is no uuid, so it names no service and is never sent to the database.
    response = client.post(CHAT, json=say("hi", criteria={
        "service_ids": [APPRAISAL, INACTIVE, OTHER_BUSINESS_SERVICE, "svc-leasing-id"],
    }))
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["services"] == [
        {"id": APPRAISAL, "title": "Rental appraisal"},
        {"id": LEASING, "title": "Leasing management"},
    ]
    assert data["criteria"]["service_ids"] == [APPRAISAL]


def test_chat_never_returns_member_data(client, provider_account):
    data = client.post(CHAT, json=say("landlords in Newtown")).json()
    assert "items" not in data
    serialized = json.dumps(data)
    for private in ("Private Owner Name", "private-owner@example.test", LOCAL_OWNER):
        assert private not in serialized


# --- model path ----------------------------------------------------------------

def test_model_input_is_limited_to_the_providers_own_data(client, provider_account, monkeypatch):
    calls = enable_chat_model(monkeypatch, lambda _payload: turn())
    client.post(CHAT, json=say("Find me landlords", criteria={"service_ids": [LEASING]}))
    payload = calls[0]
    assert set(payload) == {"provider", "current_criteria", "conversation"}
    assert payload["provider"] == {
        "category": "real_estate_agent", "location": "Newtown", "state": "NSW",
        "services": [
            {"service_id": "service_1", "title": "Rental appraisal", "service_area": "Parramatta"},
            {"service_id": "service_2", "title": "Leasing management", "service_area": "Newtown"},
        ],
    }
    assert payload["current_criteria"]["service_ids"] == ["service_2"]
    assert payload["conversation"] == [{"role": "user", "content": "Find me landlords"}]
    serialized = json.dumps(payload)
    for private in ("Private Provider Name", "private-provider@example.test", "0400000001",
                    "Private Business Name", "PRIVATE-ABN", "Private service notes",
                    "Private Owner Name", "Local Tenant", "Area Owner", PROVIDER, APPRAISAL):
        assert private not in serialized


def test_model_receives_only_the_recent_history(client, provider_account, monkeypatch):
    calls = enable_chat_model(monkeypatch, lambda _payload: turn())
    texts = [f"message {index}" for index in range(19)]
    client.post(CHAT, json=say(*texts))
    conversation = calls[0]["conversation"]
    assert len(conversation) == service.CHAT_HISTORY_LIMIT
    assert conversation[-1] == {"role": "user", "content": "message 18"}


def test_model_question_is_returned_as_plain_text(client, provider_account, monkeypatch):
    enable_chat_model(monkeypatch, lambda _payload: turn(
        reply="Sure!\n\nWhich   suburb\x07 should I start with?", role="landlord",
        quick_replies=["Newtown", "newtown", "Parramatta"],
    ))
    data = client.post(CHAT, json=say("landlords please")).json()
    assert data["reply"] == "Sure! Which suburb should I start with?"
    assert data["quick_replies"] == ["Newtown", "Parramatta"]
    assert data["state"] == "ask"
    assert (data["source"], data["ai_status"]) == ("deepseek", "applied")
    assert data["criteria"]["role"] == "landlord"


def test_model_confirmation_maps_service_aliases_back(client, provider_account, monkeypatch):
    enable_chat_model(monkeypatch, lambda _payload: turn(
        action="confirm", reply="Great, I'll look for landlords in Newtown.",
        role="landlord", location="Newtown", service_ids=["service_2", "service_2"],
        quick_replies=["ignored"],
    ))
    data = client.post(CHAT, json=say("landlords in Newtown for leasing")).json()
    assert data["state"] == "confirm"
    assert data["quick_replies"] == []
    assert data["criteria"] == {"role": "landlord", "location": "Newtown",
                                "service_ids": [LEASING], "new_only": False}


def test_model_cannot_confirm_without_role_and_area(client, provider_account, monkeypatch):
    enable_chat_model(monkeypatch, lambda _payload: turn(action="confirm", reply="Searching now!", role="tenant"))
    data = client.post(CHAT, json=say("tenants")).json()
    assert data["state"] == "ask"
    assert data["missing"] == ["location"]
    assert data["reply"].startswith("Which area should I focus on?")


@pytest.mark.parametrize("raw", [
    {**turn(), "extra": "field"},
    turn(action="search"),
    turn(role="admin"),
    turn(reply=""),
    turn(reply="x" * 401),
    turn(service_ids=["service_9"]),
    turn(quick_replies=["y" * 41]),
    {"action": "ask", "reply": "Hi"},
    ["not", "an", "object"],
])
def test_unusable_model_output_falls_back_to_guided_questions(client, provider_account, monkeypatch, raw):
    enable_chat_model(monkeypatch, lambda _payload: raw)
    data = client.post(CHAT, json=say("hi")).json()
    assert (data["source"], data["ai_status"]) == ("rules", "unavailable")
    assert data["reply"] == "Who would you like to reach: landlords, tenants or both?"


def test_model_failure_does_not_leak_upstream_details(client, provider_account, monkeypatch, caplog):
    def fail(_payload):
        raise httpx.ConnectTimeout("secret-upstream-detail")

    enable_chat_model(monkeypatch, fail)
    response = client.post(CHAT, json=say("hi"))
    assert response.status_code == 200
    assert response.json()["ai_status"] == "unavailable"
    assert "secret-upstream-detail" not in response.text
    assert "secret-upstream-detail" not in caplog.text


def test_chat_turns_are_rate_limited_per_provider(client, provider_account, monkeypatch):
    clock = {"now": 1000.0}
    monkeypatch.setattr(service, "time", SimpleNamespace(monotonic=lambda: clock["now"]))
    calls = enable_chat_model(monkeypatch, lambda _payload: turn())

    assert client.post(CHAT, json=say("hi")).json()["ai_status"] == "applied"
    too_fast = client.post(CHAT, json=say("hi")).json()
    assert (too_fast["source"], too_fast["ai_status"]) == ("rules", "cooldown")

    for _ in range(service.CHAT_TURNS_PER_WINDOW - 1):
        clock["now"] += 2
        assert client.post(CHAT, json=say("hi")).json()["ai_status"] == "applied"
    clock["now"] += 2
    assert client.post(CHAT, json=say("hi")).json()["ai_status"] == "cooldown"
    assert len(calls) == service.CHAT_TURNS_PER_WINDOW

    clock["now"] += service.CHAT_WINDOW_SECONDS
    assert client.post(CHAT, json=say("hi")).json()["ai_status"] == "applied"


def test_chat_model_request_is_bounded_without_network(monkeypatch):
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr("unit-test-key"))
    captured = []

    def respond(request):
        captured.append(request)
        return httpx.Response(200, json={
            "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(turn())}}],
        })

    real_client = httpx.Client
    transport = httpx.MockTransport(respond)
    monkeypatch.setattr(service.httpx, "Client", lambda **kwargs: real_client(transport=transport, **kwargs))
    payload = {"provider": {}, "current_criteria": {}, "conversation": []}
    assert REAL_CALL_CHAT_MODEL(payload) == turn()
    body = json.loads(captured[0].content)
    assert body["messages"][0]["content"] == service.CHAT_SYSTEM_PROMPT
    assert json.loads(body["messages"][1]["content"]) == payload
    assert body["response_format"] == {"type": "json_object"}
    assert 0 < body["max_tokens"] <= 1000


# --- confirmed search ------------------------------------------------------------

def test_confirmed_search_focuses_on_chosen_services(client, provider_account):
    response = client.get(URL, params=[("service_ids", LEASING), ("limit", "12")])
    assert response.status_code == 200
    unknown = client.get(URL, params={"service_ids": OTHER_BUSINESS_SERVICE})
    assert unknown.status_code == 400
    inactive = client.post(URL + "/analyze", json={"service_ids": [INACTIVE]})
    assert inactive.status_code == 400
    not_an_id = client.get(URL, params={"service_ids": "svc-leasing-id"})
    assert (not_an_id.status_code, not_an_id.json()["detail"]) == (400, "Choose from your active services.")


def test_confirmed_search_can_leave_out_existing_connections(client, provider_account):
    everyone = {item["id"] for item in client.get(URL).json()["items"]}
    assert {LOCAL_TENANT, AREA_OWNER} <= everyone
    only_new = {item["id"] for item in client.get(URL, params={"new_only": "true"}).json()["items"]}
    assert LOCAL_TENANT not in only_new and AREA_OWNER not in only_new
    assert LOCAL_OWNER in only_new


def test_ai_reranking_sees_only_the_chosen_services(client, provider_account, monkeypatch):
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr("test-key-never-sent"))
    calls = []

    def rank(payload):
        calls.append(copy.deepcopy(payload))
        return {"recommendations": [
            {"candidate_id": item["candidate_id"], "reason_codes": [item["evidence"][0]["code"]]}
            for item in payload["candidates"][:payload["limit"]]
        ]}

    monkeypatch.setattr(service, "call_deepseek", rank)
    response = client.post(URL + "/analyze", json={"service_ids": [LEASING], "role": "landlord", "location": "Newtown"})
    assert response.status_code == 200
    assert [s["title"] for s in calls[0]["provider"]["services"]] == ["Leasing management"]


# --- regressions found in code review ------------------------------------------

def seed_services(fake_db, rows):
    """More of the provider's live services: (name, title, place in the list[, service area])."""
    fake_db.seed("mobile_provider_services", [
        offering(uid(name), PROVIDER, title, area[0] if area else "Inner West", place)
        for name, title, place, *area in rows
    ])


def test_member_free_text_locations_never_steer_the_guided_parser(client, provider_account, fake_db):
    fake_db.seed("users", [
        member(uid("mallory"), "landlord", "Mallory", "Newtown area", "NSW"),
        member(uid("role-word"), "landlord", "Role Word", "landlords", "NSW"),
    ])
    data = client.post(CHAT, json=say("landlords in the Newtown area")).json()
    assert data["criteria"]["role"] == "landlord"
    assert data["criteria"]["location"] == "Newtown"


@pytest.mark.parametrize("answer", ["I don't know", "not sure yet", "what can you do?", "help me", "không biết", "ok"])
def test_non_answers_to_the_area_question_ask_again(client, provider_account, answer):
    data = client.post(CHAT, json=say(answer, criteria={"role": "landlord"})).json()
    assert data["state"] == "ask"
    assert data["criteria"]["location"] is None


@pytest.mark.parametrize("answer", ["doesn't matter", "any", "whatever", "đâu cũng được", "no preference"])
def test_indifferent_answers_to_the_area_question_mean_any_area(client, provider_account, answer):
    data = client.post(CHAT, json=say(answer, criteria={"role": "landlord"})).json()
    assert data["criteria"]["location"] == ""
    assert data["state"] == "confirm"


def test_near_me_means_the_providers_own_suburb(client, provider_account):
    data = client.post(CHAT, json=say("near me", criteria={"role": "tenant"})).json()
    assert data["criteria"]["location"] == "Newtown"


@pytest.mark.parametrize("body", [
    say("landlords in either Glebe or Balmain"),
    say("Glebe or Balmain", criteria={"role": "landlord"}),
])
def test_several_areas_become_a_choice_instead_of_a_guess(client, provider_account, body):
    data = client.post(CHAT, json=body).json()
    assert data["state"] == "ask"
    assert data["criteria"]["location"] is None
    assert data["quick_replies"] == ["Glebe", "Balmain"]
    assert data["reply"] == "I can search one area at a time. Which one should I start with?"


def test_providers_own_base_is_not_taken_as_the_target_area(client, provider_account):
    data = client.post(CHAT, json=say("I'm based in Newtown and want landlords in Glebe")).json()
    assert data["criteria"]["location"] == "Glebe"


@pytest.mark.parametrize("text", [
    "landlords in Ryde with rent under $1500 a week",
    "landlords in Ryde whose lease ends in 2027",
    "landlords in Ryde, budget 2500 per month",
])
def test_prices_and_years_are_not_postcodes(client, provider_account, text):
    assert client.post(CHAT, json=say(text)).json()["criteria"]["location"] == "Ryde"


@pytest.mark.parametrize("body, location", [
    (say("tenants in postcode 2150"), "2150"),
    (say("tenants around 2150 NSW"), "2150 NSW"),
    (say("2150", criteria={"role": "tenant"}), "2150"),
    (say("Liverpool NSW", criteria={"role": "tenant"}), "Liverpool NSW"),
    (say("landlords in Victoria Park WA"), "Victoria Park WA"),
    (say("landlords in Ryde, no preference on services"), "Ryde"),
    (say("tenants anywhere in NSW"), "NSW"),
])
def test_area_parsing_keeps_what_was_named(client, provider_account, body, location):
    assert client.post(CHAT, json=body).json()["criteria"]["location"] == location


def test_audience_words_never_select_a_service(client, provider_account, fake_db):
    seed_services(fake_db, [
        ("svc-screening", "Tenant screening", 5, "Ryde"),
        ("svc-open-home", "Open home attendance", 6, "Ryde"),
    ])
    assert client.post(CHAT, json=say("tenants in Ryde")).json()["criteria"]["service_ids"] == []
    owners = client.post(CHAT, json=say("home owners in Ryde")).json()["criteria"]
    assert owners["role"] == "landlord"
    assert owners["service_ids"] == []
    focused = client.post(CHAT, json=say("landlords in Ryde for tenant screening")).json()["criteria"]
    assert focused["role"] == "landlord"
    assert focused["service_ids"] == [uid("svc-screening")]


@pytest.mark.parametrize("text, role", [
    ("landlords only, not tenants, in Glebe", "landlord"),
    ("landlords in either Glebe or Balmain", "landlord"),
    ("I'm the owner of Sparkle Cleaning and want tenants in Newtown", "tenant"),
    ("không phải chủ nhà mà là người thuê ở Newtown", "tenant"),
    ("landlords and tenants near Newtown", "any"),
    ("anyone in Glebe", "any"),
])
def test_role_parsing_respects_negation_and_self_description(client, provider_account, text, role):
    assert client.post(CHAT, json=say(text)).json()["criteria"]["role"] == role


def test_follow_ups_can_add_change_and_clear_choices(client, provider_account):
    base = {"role": "landlord", "location": "Ryde", "service_ids": [APPRAISAL], "new_only": True}
    assert client.post(CHAT, json=say("also tenants please", criteria=base)).json()["criteria"]["role"] == "any"
    more = client.post(CHAT, json=say("and leasing too", criteria=base)).json()["criteria"]
    assert more["service_ids"] == [APPRAISAL, LEASING]
    moved = client.post(CHAT, json=say("actually make it Liverpool", criteria=base)).json()["criteria"]
    assert moved["location"] == "Liverpool"
    cleared = client.post(CHAT, json=say("include people I'm already connected with, and all my services",
                                          criteria=base)).json()["criteria"]
    assert cleared["new_only"] is False
    assert cleared["service_ids"] == []
    assert cleared["location"] == "Ryde"


def test_reply_language_follows_the_conversation_not_a_bare_place_name(client, provider_account):
    data = client.post(CHAT, json=say(
        "Tôi muốn tìm chủ nhà", "Bạn muốn tìm ở khu vực nào?", "Newtown", criteria={"role": "landlord"},
    )).json()
    assert data["state"] == "confirm"
    assert data["reply"].startswith("Tôi sẽ tìm chủ nhà ở Newtown")


def test_decomposed_vietnamese_input_is_understood(client, provider_account):
    import unicodedata

    data = client.post(CHAT, json=say(unicodedata.normalize("NFD", "Tôi muốn tìm người thuê ở Newtown"))).json()
    assert data["criteria"]["role"] == "tenant"
    assert data["reply"].startswith("Tôi sẽ tìm người thuê ở Newtown")


def test_model_sees_every_listed_service_and_keeps_far_selections(client, provider_account, fake_db, monkeypatch):
    seed_services(fake_db, [(f"svc-extra-{index}", f"Extra offering {index}", 10 + index) for index in range(10)])
    calls = enable_chat_model(monkeypatch, lambda payload: turn(
        role="landlord", service_ids=payload["current_criteria"]["service_ids"]))
    data = client.post(CHAT, json=say("sounds good", criteria={"service_ids": [uid("svc-extra-9")]})).json()
    assert len(calls[0]["provider"]["services"]) == 12
    assert calls[0]["current_criteria"]["service_ids"] == ["service_12"]
    assert data["criteria"]["service_ids"] == [uid("svc-extra-9")]


def test_model_nulls_do_not_erase_known_criteria(client, provider_account, monkeypatch):
    enable_chat_model(monkeypatch, lambda _payload: turn(reply="Anything else to narrow it down?"))
    data = client.post(CHAT, json=say("hmm", criteria={"role": "landlord", "location": "Ryde"})).json()
    assert (data["source"], data["state"]) == ("deepseek", "ask")
    assert (data["criteria"]["role"], data["criteria"]["location"]) == ("landlord", "Ryde")


def test_partial_model_criteria_are_unusable(client, provider_account, monkeypatch):
    enable_chat_model(monkeypatch, lambda _payload: {
        "action": "ask", "reply": "Which area?", "criteria": {"role": "landlord"}, "quick_replies": [],
    })
    data = client.post(CHAT, json=say("landlords", criteria={"location": "Ryde", "new_only": True})).json()
    assert (data["source"], data["ai_status"]) == ("rules", "unavailable")
    assert data["criteria"]["new_only"] is True


def test_model_confirmation_text_is_rebuilt_from_the_criteria(client, provider_account, monkeypatch):
    enable_chat_model(monkeypatch, lambda _payload: turn(
        action="confirm", reply="Perfect, tenants in Melbourne it is.", role="landlord", location="Newtown",
        service_ids=["service_2"], new_only=True))
    data = client.post(CHAT, json=say("landlords in Newtown")).json()
    assert data["state"] == "confirm"
    assert data["reply"] == ("I'll look for landlords you are not connected with yet in Newtown for "
                             "Leasing management. Check Search details, then choose Find matches.")


@pytest.mark.parametrize("reply", ["I found 4 landlords for you. Want more?", "I've sent the connection requests."])
def test_model_replies_claiming_actions_are_rejected(client, provider_account, monkeypatch, reply):
    enable_chat_model(monkeypatch, lambda _payload: turn(reply=reply))
    assert client.post(CHAT, json=say("hi")).json()["source"] == "rules"


@pytest.mark.parametrize("location, expected_state, expected_location", [
    (" \n ", "ask", None), ("\x00", "ask", None), ("Anywhere", "confirm", ""),
])
def test_model_location_text_is_normalised(client, provider_account, monkeypatch, location, expected_state,
                                           expected_location):
    enable_chat_model(monkeypatch, lambda _payload: turn(action="confirm", reply="Okay.", role="landlord",
                                                         location=location))
    data = client.post(CHAT, json=say("landlords")).json()
    assert data["state"] == expected_state
    assert data["criteria"]["location"] == expected_location


def test_contact_details_are_removed_before_the_model(client, provider_account, monkeypatch):
    calls = enable_chat_model(monkeypatch, lambda _payload: turn())
    client.post(CHAT, json=say("my client jane@example.com on 0412 345 678 wants landlords in Ryde 2112 NSW"))
    content = calls[0]["conversation"][-1]["content"]
    assert "jane@example.com" not in content and "0412 345 678" not in content
    assert "[email removed]" in content and "[phone removed]" in content
    assert "2112" in content


def test_a_failed_model_turn_releases_the_provider(client, provider_account, monkeypatch):
    clock = {"now": 1000.0}
    monkeypatch.setattr(service, "time", SimpleNamespace(monotonic=lambda: clock["now"]))
    outcomes = iter([httpx.ConnectTimeout("down"), turn()])

    def respond(_payload):
        outcome = next(outcomes)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    enable_chat_model(monkeypatch, respond)
    assert client.post(CHAT, json=say("hi")).json()["ai_status"] == "unavailable"
    clock["now"] += 2
    assert client.post(CHAT, json=say("hi")).json()["ai_status"] == "applied"


def test_malformed_upstream_envelope_falls_back_instead_of_500(client, provider_account, monkeypatch):
    monkeypatch.setattr(settings, "deepseek_api_key", SecretStr("unit-test-key"))
    monkeypatch.setattr(service, "call_chat_model", REAL_CALL_CHAT_MODEL)
    real_client = httpx.Client
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, json={"choices": [None]}))
    monkeypatch.setattr(service.httpx, "Client", lambda **kwargs: real_client(transport=transport, **kwargs))
    response = client.post(CHAT, json=say("hi"))
    assert response.status_code == 200
    assert response.json()["ai_status"] == "unavailable"


def test_selected_services_beyond_the_first_twenty_still_work(client, provider_account, fake_db):
    seed_services(fake_db, [(f"svc-bulk-{index}", f"Bulk offering {index}", 100 + index) for index in range(22)])
    far = uid("svc-bulk-21")
    chat_data = client.post(CHAT, json=say("hi", criteria={"service_ids": [far]})).json()
    assert chat_data["criteria"]["service_ids"] == [far]
    assert {"id": far, "title": "Bulk offering 21"} in chat_data["services"]
    assert client.get(URL, params={"service_ids": far}).status_code == 200


# --- connections live in connection_requests on the shared schema ------------------

def test_connection_requests_drive_connection_status(client, provider_account, fake_db):
    fake_db.seed("connection_requests", [connection(ME, LOCAL_OWNER, "ACCEPTED")])
    items = {item["id"]: item for item in client.get(URL).json()["items"]}
    assert items[LOCAL_OWNER]["connection_status"] == "accepted"
    only_new = {item["id"] for item in client.get(URL, params={"new_only": "true"}).json()["items"]}
    assert LOCAL_OWNER not in only_new


def test_a_declined_connection_request_is_never_suggested(client, provider_account, fake_db):
    fake_db.seed("connection_requests", [connection(LOCAL_OWNER, ME, "DECLINED")])
    assert LOCAL_OWNER not in {item["id"] for item in client.get(URL).json()["items"]}
    # The only Newtown landlord declined, so Newtown is no longer offered for landlords.
    assert client.post(CHAT, json=say("landlords")).json()["quick_replies"] == ["NSW", "Anywhere"]
