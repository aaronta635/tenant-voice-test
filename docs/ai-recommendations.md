# Provider recommendations with DeepSeek

The provider workspace suggests potential professional connections, not confirmed
service demand. Tenants/landlords do not yet publish service-request preferences,
budgets or dates for this feature. Recommendations never claim that a person needs
a particular service, is available, or has a certain probability of booking.

## Enable

1. Create a DeepSeek Platform API key and ensure the account has API credit.
2. Set `DEEPSEEK_API_KEY` in **backend/.env** (or backend hosting secrets).
   `DEEPSEEK_MODEL` defaults to `deepseek-flash` and
   `DEEPSEEK_TIMEOUT_SECONDS` defaults to 12 (allowed range: 1–30 seconds).
3. Restart the backend. Sign in as a provider and open `/dashboard/recommendations`.
4. Describe who you want to reach to the **Recommendation assistant**, answer any
   follow-up question, then choose **Find matches**. Opening the page shows
   profile-based suggestions without any model call.

Leaving the key blank keeps the whole page usable: the assistant switches to
guided questions and matching uses profile information, both labelled as such.
The browser never receives the key. Existing `httpx` is used; no SDK,
database migration, schema reset or frontend secret is required.

## Recommendation assistant (chat)

1. The provider types what they want, e.g. "landlords in Parramatta for my
   rental appraisals", in English or Vietnamese.
2. `POST /api/v1/me/recommendations/provider/chat` turns the conversation into
   search criteria: **role** (landlord, tenant or both), **area** (a suburb,
   postcode or state, or anywhere), optional **services** (the provider's own
   active services) and **new people only**. Role and area are required; until
   both are known the assistant asks one short question at a time, with
   suggested answers (for areas: the provider's own suburb, suburbs named in
   their service areas and their state, offered only when at least one eligible
   profile matches them). Several areas in one message become a choice.
3. When both are known the assistant confirms. The confirmation sentence, the
   summary next to **Find matches** and the **Search details** card are all built
   from the validated criteria, never from the model's wording. The provider can
   edit the card by hand, and nothing is searched until they choose **Find
   matches**.
4. **Find matches** calls the existing `/analyze` endpoint with those criteria
   (`role`, `location`, `service_ids`, `new_only`), so results keep the grounded
   matching and reasons described below.

The chat endpoint never searches the directory and never returns other members'
data. See "Data sent to DeepSeek" for what a model turn contains. The reply must
be strict JSON with every criteria key present; unknown keys, roles, service
aliases, empty, overlong or blank text and replies claiming actions the app never
takes (searched, sent, contacted…) are rejected. A model `null` never erases a
value already known, and a model "confirm" without role and area becomes a
question. Questions are shown as plain text.

Without a key, when DeepSeek fails or returns unusable output, or past the chat
rate limit (one turn in flight, at least 1 second apart and 20 turns per
10 minutes per provider, process-local), the same endpoint answers with guided
rule-based questions (`source: "rules"`, `ai_status` explains why), so the
provider can always finish. The guided parser reads only the provider's own
words and profile, never other members' free text: role words (with negation,
"also …" and "owner of …" handled), places after "in/around/near/ở…", the
provider's own areas, Australian states, postcodes next to a state or after
"postcode" (not prices or years), "anywhere"/"doesn't matter"/"near me" answers,
services named in full or after "for/also/cho…", and "only new" / "include
existing connections". Short replies to the area question count as the area
unless they are questions or non-answers ("not sure", "không biết").

The adapter uses the official [DeepSeek Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)
with JSON output, non-thinking mode and a 1,400 output-token cap. Model IDs are
configurable so they can be updated independently of the frontend. API usage is
billed by DeepSeek; see its [pricing page](https://api-docs.deepseek.com/quick_start/pricing/).

## Matching and explanations

- Candidate profiles come from the existing member directory (tenant/landlord
  roles only). The current user, other providers, admins and declined connections
  are excluded. Connection status belongs to the signed-in provider only.
- The initial order uses exact profile-area matches, named service areas, state,
  and category/role relevance. Location filters match suburb/state/postcode text.
- Typing in the Search details Location field suggests up to eight distinct
  locations from eligible profiles, respecting the selected role. Choosing one,
  or keeping typed free text, sets the area; **Find matches** runs the search.
  These are directory suggestions, not a complete Australian places database;
  a city name does not automatically include surrounding suburbs.
- No geographic coordinates are available, so the feature never claims a measured
  distance or that a client is within the provider's kilometre radius.
- DeepSeek can rerank the shortlisted profiles and choose relevant explanation
  codes. Candidate IDs and explanation codes are validated against the supplied
  list. Displayed explanations are rendered from those verified facts; arbitrary
  model-generated claims are rejected.
- Strong/possible/explore are heuristic profile-match labels, not AI confidence
  percentages. No connection or message is sent automatically.

## Data sent to DeepSeek

**Reranking a confirmed search (Find matches):** the provider's category,
suburb/state and the chosen active service titles, areas and prices, plus each
candidate's role, suburb/state and matching evidence. Candidate IDs are replaced
with request-local aliases. Names, email, phone, profile IDs, street addresses,
ABN, documents, member-to-member messages and private maintenance requests are
not model inputs.

**A chat turn:** the provider's category, suburb/state, active service titles and
areas (as aliases such as `service_1`), the current criteria and the last 12 chat
messages (each at most 600 characters). The messages are what the provider typed,
forwarded as written except that email addresses and phone numbers are replaced
with placeholders; the page says so before the provider types. Stored profile
fields such as name, email, phone, business name, ABN, service descriptions and
prices, and every other member's data, are not sent.

Free-text fields are treated as untrusted data in both cases; the model cannot
add candidates, display unverified explanations or write the confirmation.

## API and failure handling

- `GET /api/v1/me/recommendations/provider` returns profile matches and AI status.
- `GET /api/v1/me/recommendations/provider/locations` accepts optional `search`
  (up to 80 characters) and `role`, returning location labels/filter values only.
  It filters before reading up to 200 profiles and never calls DeepSeek.
- `POST /api/v1/me/recommendations/provider/analyze` optionally calls DeepSeek.
- `POST /api/v1/me/recommendations/provider/chat` collects criteria (see above);
  it accepts `messages` (1–20, last one from the provider) and the current
  `criteria`, and returns the reply, `state` (`ask`/`confirm`), validated
  criteria, what is still `missing`, suggested `quick_replies`, the provider's
  active `services`, `source` and `ai_status`.
- All require a service-provider login and resolve the business from that login.
  The client cannot supply a provider ID.
- Both model calls are the paid AI (tracker R18): only a provider whose account
  is active and verified, with an approved provider profile, read at each
  request (`gates.refusal`), reaches DeepSeek. Anyone else gets the profile
  matches and the guided questions, with `ai_status` `verification_required`
  and the gate's refusal in `verification`, which the page shows with a link to
  their documents. No cached AI result is served to them either.
- The two recommendation endpoints accept `role` (`tenant`/`landlord`, optional), `location` (up to 80 characters),
  `limit` (1–12, default 12), `service_ids` (up to 5 of the caller's active
  services; anything else is a 400) and `new_only` (leave out pending/accepted
  connections); GET uses query parameters (repeat `service_ids`), POST uses JSON.
- Missing key, upstream error/timeout, incomplete JSON or unsupported output
  returns usable profile matches with an explicit AI status. Database failures
  remain errors with a retry UI, rather than fabricated empty results.
- Identical AI results are cached for five minutes per provider and input snapshot.
  Each provider has a 30-second AI cooldown; concurrent requests are coalesced by
  rejecting duplicate in-flight work to the profile fallback. The cache holds at
  most 256 entries. Failed requests are not cached as successful AI results.
- The MVP reads up to 200 profiles per geographic bucket (local/service areas,
  same state, broader directory), applying role/location filters before the cap.
  It deduplicates them, shortlists the strongest 24 and returns up to 12.
  Model input fields are shortened and the serialized input is capped at 32 KB.
  This is not exhaustive search over a large directory.
  A larger rollout needs indexed candidate retrieval and shared rate limiting.
- Cache/cooldown state is process-local. Multiple backend workers need a shared
  cache/rate limiter for a global spend limit. Restarting clears the local cache.

## Verification

Run `cd backend && .venv/bin/pytest -q`, then frontend lint, tests and build.
Automated tests use an in-memory database and fake DeepSeek responses: they never
spend API credit. They cover auth/ownership, missing key, filters, grounded AI
output, rejected invented candidates/reasons, timeout fallback, data minimisation,
cache separation and cooldown. `tests/test_provider_recommendation_chat.py` adds
the chat: input bounds, guided questions in English and Vietnamese, what the model
may see, rejected model output, fallbacks, the chat rate limit and searches that
use the confirmed criteria. An authenticated live DeepSeek smoke test still
requires a real key and should be done after configuring it.
