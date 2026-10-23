# Tenant matching and match alerts

Tracker R34 (handover package 5) and R36. A tenant's recommendations page
(`/tenant/recommendations`) shows the homes and landlords the server matched
to their saved preferences, with the facts behind each match. New strong
matches reach the tenant as notifications. The code is
`backend/app/services/matching.py`; the shared rows it writes are in
`docs/shared-db.md` ("Tenant matching").

## The preferences

Matching reads what the rental preferences page (`/tenant/rental-preferences`,
R14) saves. Five filters can be musts:

| Filter | Saved as | A listing meets it when |
|---|---|---|
| Budget | `tenant_profiles.budget_max` | its weekly rent is at most the budget |
| Suburbs | `tenant_profiles.preferred_locations` | one preferred place names its suburb, postcode or state, alone or together: "Newtown", "Newtown NSW", "2042" and "New South Wales" all name a Newtown, NSW 2042 listing |
| Pets | `tenant_profiles.has_pets` | `properties.pet_friendly` is true |
| Bedrooms | `rental_preferences.bedrooms_min` | it has at least that many; a listing that gives none does not |
| Move-in | `tenant_profiles.move_in_date` | it is free now, or by the move-in date (a date already past counts as today) |

Property types and the minimum bathrooms and car spaces are nice to have
only. A filter excludes nothing until its value is saved, and a tenant with
no preference saved gets an empty state that asks for them.

**Musts.** The page's "What every home must have" card ticks the musts and
saves them with `PUT /me/matches/essentials`, into
`rental_preferences.essentials` through `profiles.update_my_profile`. Until
the tenant saves it, every filter is a must. A listing that fails a must is
never shown, suggested, alerted or sent to the model. A nice-to-have it
misses is listed on its card instead, and lowers its score.

## Which listings, and in what order

The candidates are the newest 500 `PUBLISHED` listings (by `published_at`,
then `created_at`) whose owner's account is `ACTIVE` and not closed. Listings
the tenant applied for, whatever the application's state, are left out.

Each preference that applies earns points, and the score is the share of
the points that apply:

| Points | For |
|---|---|
| 30 | the budget; above it, the points fall away over the first 20% |
| 25 | the suburbs |
| 15, 10, 10 | the bedrooms, pets, and the move-in date |
| 5, 3, 3 | the property type, bathrooms, car spaces |
| 10 | the landlord's rating (average / 5); half while they have no reviews |
| 8 | a verified landlord |
| 7 | listed in the last 7 days; half within 30 days |

The landlord's rating and badge are their public profile's
(`public_profiles.trust_of`). An owner whose profile is out of the public
lists counts as unrated and unverified, and the card shows no landlord.
A score of 75 or more is a strong match, 55 a good one, else fair. Homes come
best score first, then newest, then cheapest, up to 24.

The reasons are the facts behind the score, such as "$620 a week, within
your $650 budget", "In Newtown, NSW: one of your preferred areas",
"Verified landlord" or "Listed in the last week". A rating below 4 lowers
the score but is not given as a reason.

**Landlords** are suggested only for their listings that meet every must,
and only while their public profile is listed: up to six, by their best
match, each with up to three of those homes. A card shows what the
landlord's public profile shows.

## The model's order (optional)

`POST /me/matches/properties/refine` lets the model re-order the 12 best
matches, through the provider assistant's DeepSeek client
(`docs/ai-recommendations.md` says how to set the key). Showing the matches
never calls it.

- **What it sees:** the tenant's budget, suburbs, pets, room minimums,
  property types, move-in month and musts, and each listing as `listing_1`,
  `listing_2`... with its rent, suburb, state, facts (code and text) and the
  nice-to-haves it misses. Never an id, title, description, address or name.
- **What it may answer:** exactly the aliases it was given, each once, with
  up to three codes of that listing's own facts. Anything else (a listing it
  was not given, a repeat, a made-up reason, other keys, prose), a failure or
  a timeout keeps the rule order, with `ai_status` `unavailable`. Without a
  key it is `not_configured`, and the page says the AI is not connected.
- **Who may ask:** the model is the paid AI (tracker R18), so only a tenant
  whose account is active and verified, read at each request
  (`gates.refusal`). Anyone else keeps the rule order, with `ai_status`
  `verification_required` and the gate's refusal in `verification`, which
  the page shows with a link to their documents; the model is not called.
  `GET /me/matches/properties` answers so too, once a key is set, so the
  page says why from the first load instead of offering a refine button
  the server would refuse. An order the model gave before is not shown to
  them either; it comes back once the account is verified again.
- The reasons it picks come first on the card; every reason is still a fact.
- Its order is recorded and shown again, also after a reload, until the
  matches change. One call per tenant at a time, and one each 30 seconds
  (process-local; several workers need a shared limiter).
- Two requests that record a tenant's matches at once (two tabs, a page
  load while a refine runs) end with one set of rows: each set has its own
  `payload.batch`, and each request keeps only the newest set it finds
  after writing its own, so a refine that ends last keeps the model's order.

## Match alerts

A tenant hears about a match with a `property` notification (stored as the
`system` category), only while their `matches` switch and all notices
(`push_enabled`) are on. Each notice is about one listing and links to
`/matches/property/<listing id>`, the link `mobile_notify_matches` writes,
which the notification list opens as `/tenant/properties/<id>`
(`frontend/app/lib/notification-links.ts`). Before alerting, the web skips
a listing the tenant already has such a notice for, and the mobile app
skips one the web sent, so neither app tells a tenant about a match twice.

- **A listing is published.** `matching.alert_matches_for_listing(listing_id)`
  tells each active tenant with saved preferences that it is a strong match
  for, and who has not applied for it: "A new home matches your preferences".
  It reads up to 5,000 tenants. The
  owner's requests call it once each, as a background task after the
  answer (`api/routes/properties.py`): a create that publishes, and an edit
  that moves the listing to `PUBLISHED` (published again, or reopened to
  applications). An edit that publishes nothing never calls it
  (`tests/test_publish_alerts.py`).
- **Preferences change.** `matching.alert_matches_for_tenant(tenant_id)`
  sends a notice for each strong match the tenant was not alerted to yet
  ("A home matches your preferences"), up to 20 at once as the mobile app
  takes. `profiles.update_my_profile` calls it after a save that changes what
  matching reads (`matching.preferences_of`): `PATCH /profiles/me` with a
  tenant section, so the rental preferences page and the onboarding steps,
  and `PUT /me/matches/essentials`. A save that sends the values already
  stored, or only other fields (the about line, employment), alerts nobody.

Each listing is alerted to a tenant at most once: the alert is recorded
first (a `recommendations` row of kind `alert`), and a second alert for the
same pair finds it. No page load sends an alert. Both functions never raise:
a failure is logged and the change that triggered them stands.

## Notification switches

`notifications.notify()` reads the switches the mobile app shares
(`users.metadata.mobile.notificationPreferences`, then the web's earlier
`users.metadata.notification_preferences`; `docs/shared-db.md`) before it
writes: a switch that is off (`false`, or text Postgres reads as false)
writes no row, and `pushEnabled` off stops every notice. Account and
security notices always go, so the settings form shows the "Account
alerts" switch on and locked.

## API

| Route | What it does |
|---|---|
| `GET /api/v1/me/matches/properties` | The matches, the musts and what each must left out (`excluded`), and the AI status |
| `POST /api/v1/me/matches/properties/refine` | The same, in the model's order when it can give one |
| `GET /api/v1/me/matches/landlords` | The landlords with homes that meet every must |
| `PUT /api/v1/me/matches/essentials` | `{"essentials": [...]}`, the musts; answers the new matches |

Tenants only: signed out is 401, any other role 403. No route takes a
tenant's id, and every read of the recorded rows is the caller's own.
A database failure is an error with a retry on the page, never an empty
list.

## Defaults to confirm

- Every filter is a must until the tenant marks it nice to have.
- Alerts are for strong matches (75 or more), or a home that meets every
  preference the tenant saved: the landlord and freshness points count in
  every score, so a perfect fit for a tenant who saved one preference can
  score under 75.
- Listings of suspended or closed owners, and listings the tenant applied
  for, are never matched.
- A city name does not include its suburbs: there are no coordinates, so
  "Sydney" names only the suburb called Sydney.

## Tests

`backend/tests/test_tenant_matching.py` (musts, reasons, empty states,
per-tenant results, recorded rows and two requests at once, the model's
order, its validation and who may ask), `backend/tests/test_match_alerts.py`
(once per tenant and listing, a profile save that changes preferences and
one that does not, never on a page load, the switches) and `backend/tests/test_notification_preferences.py`.
On the page: `frontend/app/components/tenant/TenantMatches.test.tsx`,
`NetworkRecommendations.test.tsx` and
`frontend/app/components/profile/ProfileSettingsForm.test.tsx`. The model
never runs in a test.
