# Shared database: what each area port uses

The web backend runs on the Supabase project it shares with the mobile app and
the rental web. That project's `public` schema belongs to Prisma, so the web's
own tables live in a separate `web` schema (`supabase/shared/`). The migration
plan lists the work per area. This page lists the pieces every port should use,
so that all areas do it the same way.

## Files

| What | Where |
|---|---|
| Snapshot of the shared `public` schema: 69 tables with columns, types, enums, NOT NULL, defaults, primary keys and foreign keys (no unique constraints: the export has none), plus 242 RPCs with their parameters | `backend/app/db/shared_schema.json` |
| Refresh the snapshot from a new PostgREST OpenAPI export (offline) | `cd backend && .venv/bin/python -m scripts.snapshot_shared_schema ../output/shared-schema-openapi.json` |
| Questions about a shared table | `app.db.schema`: `columns()`, `has_column()`, `enum_values()`, `required_without_default()`, `is_shared_table()` |
| The 12 web-only tables, and their catalogue rows | `supabase/shared/0001_web_schema.sql`, `supabase/shared/0002_web_seed.sql` |
| The private Storage bucket for chat attachments | `supabase/shared/0003_storage.sql` |
| The tenant scorecards (R43): `web.scorecard_requests` | `supabase/shared/0004_scorecards.sql` |
| Listing views, one per viewer, listing and Sydney day, and the day's salt for their hashes (R28) | `supabase/shared/0005_listing_views.sql` |
| The Housing Portal's data category requests (`web.datapoint_requests`) | `supabase/shared/0006_housing_portal.sql` |
| The files to apply, in order, and how to check and undo them | `supabase/shared/README.md` |

## In service code

- **A web-only table:** use `web_table("bookings")` from `app.core.supabase`
  instead of `get_supabase_client().table("bookings")`. It is the same
  service-role client, on the `web` schema. Columns keep their old names.
  People and providers are `users.id`, and a booking reaches its thread and
  review through `conversation_id` and `review_id`.
- **Writing a shared table:** pass the row through `stamp_insert(table, row)`
  or `stamp_update(table, changes)` from `app.services.shared_map`. They add
  `id` and `updated_at` only where that table needs them (plan §3 a1). Never
  add those keys by hand: a table without `updated_at` rejects the key with
  PGRST204.
- **Enum values:** most shared enums are upper case (`PENDING`,
  `PUBLISHED`), but `notifications.category` is lower case: `system`, `bid`,
  `social` and `project`. `enum_values(table, column)` is the source of
  truth: take the accepted labels from it, not from a rule about case.
- **`mobile_*` RPCs that read `auth.uid()`:** call them on
  `user_client(current.access_token)` from `app.core.supabase`.
  `CurrentProfile.access_token` is the caller's bearer JWT. RPCs that take
  explicit ids and `p_now` keep using the service-role client.

## Web metadata keys

Keys the web keeps in shared `metadata` jsonb columns. The mobile app keeps
its own keys there too, so merge into `metadata`; never replace it.

| Key | Meaning | Written by | Read by |
|---|---|---|---|
| `users.metadata.mobile.privacySettings` | The mobile app's privacy switches, which both apps read and write: `publicProfile` (`false`: out of every search, and the public page answers 404), `discoverable` (`false`: out of the searches, the page still opens), `showContact` (default `false`), `showAvailability` and `allowMessages`, which only the mobile app acts on (the website never shows contact details). The web's own `share_score` is not kept here: `mobile_public_profile_json` hands `privacySettings` to every signed-in viewer. JSON booleans; a missing switch is its default (`member_settings.PRIVACY_DEFAULTS`). Text is read as Postgres casts it (`member_settings.switch`). See [Shared settings](#shared-settings-r14-r36). | `services/profiles.py` through `services/member_settings.py` (the settings of every role) | `services/public_profiles.py`, `services/connections.py` (`search_profiles`); the mobile app's `mobile_discover_profiles`, `mobile_public_profile_json`, `mobile_start_conversation` |
| `users.metadata.mobile.notificationPreferences` | The notification switches, which both apps read and write: `pushEnabled` (`false`: no notice at all but account and security ones), the mobile app's categories `matches`, `repairs`, `applications` and `profileUpdates`, and the web's next to them: `messages`, `bookings`, `reviews` and `propertyUpdates` (listing and complaint updates). JSON booleans; missing is on. Private. | `services/profiles.py` through `services/member_settings.py` | `services/notifications.py`: `notify()` writes no row for a switch that is off (R36), `services/matching.py`'s alerts; the mobile app's `mobile_notify_matches`, `mobile_assistant_notify` |
| `users.metadata.mobile.profilePublished` | The mobile app's: `false` while a tenant has not published their profile there. Such a tenant is out of the searches and their public page answers 404, as `mobile_discover_profiles` leaves them out. Other roles ignore it. | The mobile app | `services/public_profiles.py`, `services/connections.py` |
| `users.metadata.mobile.personalDetails`, `.emergencyContact`, `.householdMembers`, `.addressHistory` (or `.rentalHistory`), `.employmentStatus.types` | The mobile app's profile, in the shapes `mobile_public_profile_json` reads. Where the web holds none of its own, the member's own `GET /profiles/me` shows them in the web's shapes and lists them in `from_mobile`; a save writes the web's keys below, never these. See [Shared settings](#shared-settings-r14-r36). | The mobile app | `services/mobile_profile.py` (the member's own profile only) |
| `users.metadata.privacy.public_profile`, `.share_score` | The web's earlier privacy keys. `public_profile` is read when `privacySettings` has no `publicProfile`, and still written with it, for the readers that read only it (`services/provider_recommendations.py`, `services/matching.py`'s landlord matches). `share_score` is kept only here, private: `false`, the tenant does not want owners to see their scorecard, so their public profile shows none, whichever they chose to show ([Scorecards](#scorecards-r43)); missing or `true`, it shows the ones they chose. | `services/member_settings.py` | Those readers; `services/member_settings.py`; `services/public_profiles.py` (`share_score`) |
| `users.metadata.notification_preferences.<kind>` | The web's earlier switches (`message`, `review`, `booking`, `application`, `property`): read when `notificationPreferences` has no switch of its own, `property` for `matches`, `repairs` and `propertyUpdates`. No longer written. | Nothing now | `services/member_settings.py` as a fallback |
| `tenant_profiles.metadata.employment` | `{types, employer, job_title, annual_income, notes}`; `types` holds codes such as `full_time` and `student` (`schemas/profiles.py`). Private. | `services/profiles.py` | `GET /profiles/me` only |
| `tenant_profiles.metadata.household` | `{members: [{name, age, relationship}], pets}`. The size and `has_pets` are columns. Private. | `services/profiles.py` | `GET /profiles/me` only |
| `tenant_profiles.metadata.emergency_contact` | `{name, relationship, phone, email}`. Private. | `services/profiles.py` | `GET /profiles/me` only |
| `tenant_profiles.metadata.rental_history` | The self-reported tenancies, a list of `{id, address, suburb, state, start_date, end_date, current, weekly_rent, landlord_name, landlord_contact, reason_for_leaving, bond_returned}`. Private. | `services/profiles.py` | `GET /profiles/me` only |
| `tenant_profiles.metadata.rental_preferences` | `{property_types, bedrooms_min, bathrooms_min, parking_min, notes}`, beside the budget, suburb and move-in columns. `property_types` are the web's (`apartment`, `house`, ...). Private. | `services/profiles.py` | `GET /profiles/me`, and the tenant's own matches (`services/matching.py`) |
| `tenant_profiles.metadata.rental_preferences.essentials` | The filters every match must meet (R34): a list of `budget`, `location`, `pets`, `bedrooms` and `move_in` (`schemas/matching.py`). The others are nice to have. Missing: all five are musts; `[]`: none is. A must excludes a listing only once its value is saved (a maximum budget, a suburb, pets, a minimum of bedrooms, a move-in date). Private. | `services/profiles.py`, for `PUT /me/matches/essentials` (`services/matching.py` calls `update_my_profile`) | `services/matching.py` |
| `tenant_profiles.metadata.qualities` | `{tags, notes}` from the Tenant Qualities page; `tags` are codes such as `reliable_rent`. Private until profiles can be shared with an owner. | `services/profiles.py` | `GET /profiles/me` only |
| `users.metadata.location`, `.state` | The suburb and state on a member's profile. Public profiles show these, never the postcode. | `services/profiles.py` | Profile search, public profiles |
| `service_provider_profiles.metadata.is_published` | `true` once a provider goes live. Public profiles list only those; the marketplace still lists a mobile row without the key. | `services/service_providers.py` | Both |
| `service_provider_profiles.metadata.category` | The provider's web category (`tradie`, `cleaner`, ... : `maps_provider_core.WEB_CATEGORIES`), which the marketplace and the category pages read. `service_categories` holds its shared codes beside it (see [Services and categories](#services-and-categories-r03)). Missing (a mobile row): read from the codes. Public | `services/service_providers.py` | `maps_provider_core.provider_category`, `services/public_profiles.py` (a card's category) |
| `landlord_profiles.metadata.bio`, `agent_profiles.metadata.bio` | A landlord's or agent's about line, as `service_provider_profiles.metadata.bio` is a provider's | `services/profiles.py` | Public profiles |
| `agent_profiles.metadata.portfolio_size` | How many properties an agent manages; a landlord's is the `landlord_profiles.portfolio_size` column, and `agent_profiles` has none. Private. | `services/profiles.py` | `GET /profiles/me` only |
| `users.metadata.onboarding.<role>` | Where a member is in the web's onboarding, under their web role: `tenant`, or `landlord` for a landlord or an agent. `{step, completed_at}`: `step` names the wizard step to resume at (such as `budget`), `completed_at` is when they first finished (ISO 8601), kept when they go through the steps again. Missing: not started. Private. See [Onboarding](#onboarding-r19). | `services/onboarding.py` | `GET /me/onboarding` only |

## Profile details (R14)

`GET` and `PATCH /profiles/me` are a member's own profile: `ProfileOut`, plus
`settings`, a `tenant` or `landlord` section and a tenant's `completion`
(`MyProfileOut` in `schemas/profiles.py`). Only `services/profiles.py`
writes `tenant_profiles`, `landlord_profiles` and `agent_profiles`, and the
profile fields and settings of `users`; `services/admin_users.py` writes
its `status`, `services/account_verification.py` its verification (R17)
and `services/onboarding.py` the onboarding key (R19).

- **Where each value goes.** Account fields stay on `users` (the area in its
  metadata), and the settings go to the metadata keys above. A tenant's
  section writes the `tenant_profiles` columns `about_me`, `budget_min`,
  `budget_max`, `preferred_locations`, `move_in_date`, `household_size` and
  `has_pets`, and the rest to its metadata. A landlord's writes
  `agency_name`, `license_number`, `portfolio_size` and the `bio` key of
  `landlord_profiles`. An agent has the same section, but on their
  `agent_profiles` row, which public profiles read for them; there
  `portfolio_size` is a metadata key. A missing profile row is inserted
  stamped, with `maps_identity.profile_row()`'s values.
- **A patch at every level.** A key left out keeps its value and a null
  clears it, inside a section too; lists are replaced whole. Objects merge
  into what is stored, so keys the mobile app wrote stay. A null for a whole
  object (`privacy`, `employment`, ...) clears only the web's keys in it.
- **What the web cannot read stays.** A rental history entry or household
  member another app stored that a save would refuse (no address, a rent
  over the web's cap) is not shown, and a save keeps it after the items it
  sends. An entry sent back keeps the keys another app added to it, matched
  by its `id`: opaque text, and for an entry stored without one, the same id
  at every read of that place in the list. A household member, which has no
  id, is matched by its values. A section another app stored in another
  shape (text where the web keeps an object or a list) is never
  overwritten: saving that section answers 409, and the others still save.
  Codes the web does not know stay in `employment.types`,
  `rental_preferences.property_types` and `qualities.tags`. The forms send
  only the fields that changed, and the server checks an account field
  (name, phone, avatar, suburb, state, postcode) only when its value
  changes, so a value stored before today's checks (an old move-in date,
  another app's phone format) never blocks a save.
- **No lost writes.** Each write is an update filtered on the `updated_at`
  it read. When another app wrote the row in between, the update matches
  nothing, so the row is read again and the patch merged into it anew, up
  to three times, then 409.
- **Checked first.** Pydantic checks types, ranges, lengths and dates, and
  refuses unknown keys in a section. The service checks what spans fields
  on the row as it would be saved: `budget_min <= budget_max`, and an
  emergency contact with a name and a phone or email. Only the rules a
  patch touches run, so a bad value the mobile app stored never blocks an
  unrelated edit. Nothing is written when a check fails.
- **Private.** The about line, budget, suburbs and move-in month are public
  (`services/public_profiles.py`). Everything else in the sections, and the
  settings, reaches only its owner: apart from the owner's own matches
  (`services/matching.py`), no other endpoint reads
  `tenant_profiles.metadata`, and the others that read `users.metadata`
  take only the area from it (`services/documents.py` also the storage
  paths of the mobile app's `verificationDocuments`, which the admin queue
  reads through `mobile_admin_verification_queue`; `notify()` and the match
  alerts the notification switches; the public profiles and the profile
  search the privacy switches). `tests/test_profile_privacy.py` checks the
  public profiles, profile search, connections, applications and
  conversations.
- **Completion.** `services/profile_completion.py` works it out:
  eight required rows share 70 % and eight boosters 30 %, as in
  `output/references/onboarding/profile-completion.md`. Its inputs are the
  `users` row, the tenant section, the tenant's `profile_documents`
  (rejected ones do not count) and whether they reviewed a property. A
  person keeps one document per type, so a payslip and an employment
  contract share the one `OTHER` document, marked by `metadata.web_type`
  `payslip` or `employment_contract`: the reference's Payslips and
  Employment contract rows are one booster (key `payslips`), so there are
  seven. The score is stored in `tenant_profiles.completion_score` by each
  save, and by a read when the documents moved it. The three
  reference-scorecard rows do not read the scorecards of R43 yet
  ([Scorecards](#scorecards-r43)), so the score stops at 87 until they do.

### Shared settings (R14, R36)

The settings live where the mobile app keeps them, so a switch set in one
app holds in the other: `services/member_settings.py` maps the web's names
(`SettingsOut` in `schemas/profiles.py`) onto
`users.metadata.mobile.privacySettings` and `.notificationPreferences`.

- **Reading.** The mobile key first, then the web's earlier key
  (`users.metadata.privacy`, `.notification_preferences`), then the default.
  A JSON boolean, or text Postgres casts to one (`"false"`, `"no"`, `"0"`,
  ...), as the mobile functions cast these keys with `::boolean`.
- **Writing.** JSON booleans only, merged into the stored objects: keys the
  mobile app keeps in `users.metadata.mobile` (`personalDetails`,
  `profilePublished`, switches the web does not know) stay. A null clears a
  switch; a null for a whole section clears only the switches the web
  knows. A section another app stored in another shape answers 409 and
  nothing saves. `privacy.public_profile` is written there too, and
  `privacy.share_score` only there; the web's earlier notification
  switches are only read.
- **Who is listed.** The public profiles and the signed-in profile search
  list a member only when `publicProfile` and `discoverable` are not false,
  and a tenant only when `profilePublished` is not false, as
  `mobile_discover_profiles` does. A member who is not discoverable keeps
  their public page; one whose profile is not public or not published gets
  404 there.
- **What notify() sends.** Each notice falls under one switch
  (`notifications.switch_for`): a match alert (a `/matches/` link) under
  `matches`, a repair's (a maintenance or repairs page) under `repairs`, any
  other property notice under `propertyUpdates`, and an application,
  message, booking or review notice under its own. `pushEnabled` false stops
  all of them. Account and security notices always go. No web notice falls
  under `profileUpdates`, which the app's own notices read.
- **Match alerts.** Each links to `/matches/property/<listing id>`, the link
  `mobile_notify_matches` writes, and the web skips a listing the tenant
  already has a notice with that link for: neither app sends a match twice.
- **Notification links.** The mobile functions write mobile routes
  (`/messages`, `/admin/maintenance`, `/payments/verified/<id>`, ...). The
  notification list opens each at the web page for the reader's role
  (`frontend/app/lib/notification-links.ts`, one table with its tests); a
  link it does not know opens the reader's notifications page.
- **Filled-in profiles.** Where the web holds no value of its own, the
  member's own profile shows the mobile app's (`services/mobile_profile.py`):
  the phone and suburb from `personalDetails`, the tenant's about line
  (`personalDetails.aboutMe`, else `tenantBio`), employment types (the codes
  the web knows), household members, the emergency contact and the rental
  history (`addressHistory`, else `rentalHistory`; an entry the web could
  not save back, such as one with neither a street nor a suburb, is left
  out). `from_mobile` names what was filled in, and the completion counts
  it. A form sends only what changed, so a section saved from filled-in
  values starts from them: the web's key gets the whole section. A value
  cleared on the web while the mobile app still holds one shows the app's
  again; it is removed in the app. Nothing else reads these keys.

### Private documents (R15)

Every role's documents are `profile_documents` rows, written only by
`services/documents.py` (the provider credentials save through it), and the
review decisions by `review_profile_document` (R17, below). The table is
UNIQUE (`user_id`, `document_type`): a person keeps one document of each
type, `OTHER` included ("Other document (for example a payslip or
contract)"). An upload of a type they already have, from the documents
panel or the provider page, replaces that row's file instead of failing
with 23505; the provider page's ABN and other credential share the one
`OTHER` row. The web writes these rows itself rather than through
`upsert_profile_document` or `replace_profile_document`: those keep
`review_status` on a new file (and the latter is for tenants only), while a
new file must be `PENDING` again for `review_profile_document` to decide it.

Files are in the private `profile-documents` bucket under
`{users.id}/{32 hex}/{file name}`: the first folder is the owner's
`users.id`, as the bucket's policies read it, so the mobile app lets the
owner, the owners of listings they apply to and admins open it.
`mobile_profile_documents_select` (`mobile_can_view_applicant_files`) opens
the whole folder to the owner of a listing the person has a `SUBMITTED`,
`UNDER_REVIEW`, `SHORTLISTED` or `APPROVED` application for, whatever a
document's `metadata.visibility` says, so the documents panel and the
onboarding card tell a tenant so (decided at integration, to confirm with
the product owner: the alternative is to keep a private document outside
that folder and move it when its visibility changes). The
`verification/{users.id}/` folder the web used before is still the owner's
(`uploads.owned_path`). Files open only for the owner or an admin on the
website: `/me/documents/{id}/link` and `/admin/documents/{id}/link` sign a
link for 5 minutes at each opening. A tenant's document shared with an
application also opens for the listing's owner (R25, below). The provider
page's credential list (`/me/verification-documents`) still carries the
one-hour links it always had, for its owner only.

A document can be deleted at any time: its review events keep their record
(their foreign key is ON DELETE SET NULL). A file that goes is queued in
`profile_document_deletion_queue` with the reason its CHECK allows
(`REPLACED`, `USER_DELETED`, or `ORPHANED` for an upload whose row was never
saved; one entry per file, so an earlier one is queued again), removed, and
marked with `mark_profile_document_object_deleted`; when Storage fails the
entry keeps `attempts` and `last_error` for the mobile side's cleanup. A file
the mobile app's `users.metadata.mobile.verificationDocuments` still names
is never removed. Which types each role keeps and what its verification
needs are in `services/verification_rules.py`.

| Key | Meaning | Written by | Read by |
|---|---|---|---|
| `profile_documents.metadata.visibility` | Who may see the file besides its owner and admins: `"private"` (missing means private) or `"applications"`, shareable with the owners of the listings a tenant applies to. Only tenants may choose `"applications"`. A tenant attaches such documents to an application, and the listing's owner opens them while the tenant keeps them shareable (R25, below). | `services/documents.py` | The documents panel, `services/property_applications.py` |
| `profile_documents.metadata.label` | The name a person gave a document, such as an `OTHER` one, or a provider credential's label | `services/documents.py`, `services/verification_documents.py` | Both, and the provider page |
| `profile_documents.metadata.web_type` | What the one `OTHER` document is where the shared type cannot tell it. A provider credential: `abn` or `other`. A tenant's document marked in the documents panel: `payslip` or `employment_contract`; an upload without a mark removes it | `services/verification_documents.py` (providers), `services/documents.py` (tenants) | `services/maps_provider_core.py`, `services/profile_completion.py` |
| `profile_documents.metadata.reviewStatus`, `.rejectionReason`, `.reviewedAt` | The last decision, as `review_profile_document` merges it in. Where a row has them, a new file sets `reviewStatus` to `PENDING` and the other two to null, as the columns are reset | `review_profile_document`; `services/documents.py` and `services/verification_documents.py` for a new file | The mobile app |

### Admin console (R16)

Every `/admin` route depends on `core/admin.py`'s `get_current_admin`: the
caller's `users.primary_role` is `ADMIN` (never the token's `user_metadata`)
and their `users.status` is `ACTIVE`. An admin action is recorded in both
logs by `services/admin_audit.py`: the web's `audit_log` and the shared
`mobile_admin_audit_entries`, which the mobile admin console reads.

| Key | Meaning | Written by | Read by |
|---|---|---|---|
| `mobile_admin_audit_entries.metadata` of a `user.status_changed` entry (`entity_type` `user`) | `source` (`"web"`), `from_status` and `to_status` (`users.status` values), `reason` (null only when the account was made active again) and `target_role` (the web role) | `services/admin_audit.py` | The admin account page (`services/admin_users.py`) |

### Verification decisions (R17)

`docs/verification.md` has the rule and the decisions. The shared functions
set `users.verification_status`, `approved_by_user_id`, `approved_at` and
`rejection_reason`, and `landlord_profiles` and
`service_provider_profiles.verification_status`: `review_profile_document`
at a document decision (with its `profile_document_review_events` row and
the person's notice) and `review_user_verification` at an account decision.
The web calls them with the service-role client and the admin's `users.id`.
Sign-up leaves the account `PENDING`; after that the web's only write of
these columns is the reset in `services/account_verification.py`: a
replaced or deleted document of a type the role requires puts an approved
or rejected account back to `PENDING`. The admin queue also shows the mobile
app's `users.metadata.mobile.verificationDocuments`, read-only, through
`mobile_admin_verification_queue` on the admin's token.

| Key | Meaning | Written by | Read by |
|---|---|---|---|
| `users.metadata.verification_rejected_at` | No longer written or read: the web's account rule before it moved onto the shared functions kept an admin's account rejection here. Rows may still have it. An account rejection is now told apart by `approved_by_user_id`, which `review_user_verification` sets and a document decision clears on a rejected account (`account_rejected`) | Nothing | Nothing |
| `mobile_admin_audit_entries.metadata` of a `user.verification_decided` entry (`entity_type` `user`) | As a `user.status_changed` entry's, with `users.verification_status` values in `from_status` and `to_status`; `reason` is null for an approval | `services/admin_audit.py` | The mobile admin console |

### Verification gates and provider suspension (R18)

No new table, column or metadata key: the gates and a suspension read
`users.status`, `users.verification_status` and
`service_provider_profiles.verification_status`, which R16 and R17 write.

- **The gates.** `services/gates.py` reads the account again at every
  check, never `CurrentProfile.raw`. `require_verified(current, action)`,
  where `current` is the caller or their `users.id`, passes only an open
  `users` row with status `ACTIVE` whose `verification_status` earns the
  badge (`badges.is_verified`), and for a provider an approved
  `service_provider_profiles.verification_status` too. The actions are
  `apply`, `publish_listing`, `paid_ai`, `accept_booking`,
  `receive_repairs` and `go_live`; an unknown one raises `ValueError`.
  Anything else is 403 with an object `detail`: `code`
  (`verification_required`), `action`, `status` (`pending`, `rejected` or
  `unknown` for the verification, `suspended` or `inactive` for the
  account), `message` and `documents_href`, the role's documents page
  (`admin_verification.DOCUMENTS_PATH`), or null when documents would not
  help. `require_verified_party(user_id, action)` checks someone the caller
  hands work to, such as the provider an owner assigns a repair: its
  `status` is only `unverified` or `unavailable`, and it has no link. A
  repair goes to a `SERVICE_PROVIDER` only: any other role is
  `unavailable`, verified or not.
  `refusal(current, action)` gives the same detail without raising, or
  null, for a response that still answers without the action. Browsing and
  rule matching never ask. The web shows the refusal with
  `components/trust/VerificationRequired.tsx`, found by
  `lib/verification-gate.ts`.
- **Where they are asked.** `apply`: `property_applications.create_application`.
  `publish_listing`: `properties.create_property` for a listing created
  `PUBLISHED`, and `properties.update_property` for any move to `PUBLISHED`,
  reopening applications included, and for a move to
  `APPLICATIONS_CLOSED` from a status nobody can open (paused; a draft or a
  leased listing never closes to applications), which shows the listing
  publicly. A listing kept off the market, or closed to applications once
  published, needs no check. A move the status matrix refuses is refused
  (409) before the gate asks (R25, below).
  `paid_ai`: every model call before it is made, and confirming an action
  the owner assistant proposed (`owner_assistant.confirm`, a 403). A
  question to the owner assistant (`owner_assistant.ask`), a tenant's
  `POST /me/matches/properties/refine` (`matching._property_matches`) and
  the provider assistant's `/analyze` reranking and `/chat` turns
  (`provider_recommendations.recommend` and `chat`) answer without the
  model instead of a 403: the rules' answer, the rule order, the profile
  matches or the guided questions, with `ai_status`
  `verification_required` and the refusal in `verification`. No cached AI
  answer is served then either, except that an owner's question sent again
  with the same request id gets its saved answer back. A tenant's
  `GET /me/matches/properties` carries the same refusal up front, so their
  page offers no refine button the server would refuse.
  `accept_booking`: `bookings.update_booking` when the provider confirms a
  booking or starts a confirmed one. `receive_repairs`:
  `maintenance.assign_provider` (the party check on the provider the owner
  picks), and `maintenance.schedule_assigned` and `complete_assigned` for
  every visit and its completion, which the shared repair functions take
  from an approved, active provider only.
  `go_live`: `service_providers.update_provider` when the profile is
  published. `tests/test_gate_wiring.py` calls each with a pending, a
  rejected and an approved account, and checks that a refused caller's
  model stub is never called.
- **A suspended provider still signs in** (assumption #14):
  `maps_identity.account_block` leaves a `SUSPENDED` `SERVICE_PROVIDER` in,
  to finish the jobs in progress and read past bookings, messages and
  invoices. Every other suspended, deactivated or closed account is still
  refused. The gates refuse them new work: confirming or starting a
  booking, being assigned a repair, and going live. Completing a booking
  in progress stays open. A repair's visit does not: booking, moving and
  completing it are the shared functions, which run as an `ACTIVE` account
  only (`update_maintenance_work_order`), so the gate refuses them first
  (to confirm with the DB owner). They read all their threads, but write, and
  open a thread, only with the people of a job in progress: the client of
  a booking in progress, or the tenant or owner of a repair whose visit
  they booked (`conversations.SUSPENDED_WRITES`). Nobody else starts a new
  thread with a provider out of work (suspended, or their account not
  open) either, a connection's direct message included, unless it is
  about a job in progress between them: a booking's thread needs that
  booking in progress, their general thread or message any job in
  progress. Having dealt with each other before is not enough: the
  marketplace's route answers 404, the message route 403
  (`conversations.NO_NEW_THREADS`), however its body names the provider
  (`peer_id`, `owner_id` or `tenant_id`, with a property or without). A thread the two already have still
  opens, and the client may still write there, say to cancel a booking.
  Every workspace page tells the provider so, with a link to support
  (`components/provider/AccountStandingBanner.tsx` in `ProviderShell`):
  `GET /me/standing` answers the gates' state of the caller's own
  account (`gates.standing`), `suspended` or `inactive` among them.
- **Hidden from the marketplace.** `services/service_providers.py` lists and
  shows a provider only while the owner's `users` row is `ACTIVE` and open
  (`owner:users!user_id!inner(status, deleted_at)`), as public profiles list
  members: the lists, search, category counts, the public page and its
  reviews, services, hours and portfolio, booking and saving. The landing
  page's count of verified providers (`content._verified_provider_count`)
  leaves them out too. The provider's own workspace still reads them
  (`get_provider_by_profile_id`).
- **The clients are told.** When an admin's status change takes a provider
  out of work (into `SUSPENDED` or `DEACTIVATED`, from neither),
  `services/admin_providers.py` notifies the client of each `confirmed`
  `web.bookings` row dated today or later in Sydney, or not dated yet, with
  a link to their bookings page. It writes nothing else: the booking stays
  for the client to cancel. The status change's answer says how many
  notices it wrote (`notified`), which the admin is told. Enabling
  (`ACTIVE` again from `SUSPENDED` or `DEACTIVATED`) is for an approved
  provider only, the account's and the profile's verification
  (`admin_providers.enable_lock`, `gates.verification_state`): else 409
  and nothing changes, since a profile that was live is listed again at
  once. It tells nobody, and leaves going live to the gates.
- **The admin page.** `GET /admin/users/{id}` has a `provider` section for a
  provider (`schemas/admin_providers.py`): `has_profile`, `published`,
  `listed`, `standing` (the gates' state) and the counts of confirmed
  upcoming bookings and jobs in progress.

### Onboarding (R19)

A new tenant or landlord starts at their role's wizard, `/tenant/onboarding`
or `/owner/onboarding`, and a provider at `/dashboard/onboarding`
(`registerLanding` in `frontend/app/lib/auth-redirect.ts`). Each step saves
its answers through `PATCH /profiles/me` (the sections above) and its
documents through `/me/documents`, then the step to resume at through
`PUT /me/onboarding` (`{step, completed}`); `GET /me/onboarding` reads it
back (`OnboardingOut` in `schemas/onboarding.py`). Only tenants and
landlords, agents included, have these endpoints: a provider's wizard works
out its step from the provider profile, and staff have none.

- **One writer, merged.** Only `services/onboarding.py` writes
  `users.metadata.onboarding`. A save merges into the row's metadata, so the
  mobile app's keys, the settings and another role's place stay as they
  were. A value another app stored there in another shape (text where the
  web keeps an object) is never overwritten: a save answers 409 and a read
  counts it as not started. Each write applies only while the row still has
  the `updated_at` it read, else it starts again from the new row, up to
  three times, then 409, as the writes in `services/profiles.py` do.
- **The steps are the wizards'.** The server checks only the form of a
  step's name (`[a-z][a-z0-9-]{0,39}`); a name a wizard no longer knows
  opens it at its welcome step. The tenant wizard's steps are `welcome`,
  `personal`, `household`, `locations`, `budget`, `property`, `employment`,
  `qualities`, `about`, `history`, `documents`, `emergency`, `preview` and
  `publish`; the landlord's are `welcome`, `personal`, `business`, `about`,
  `documents`, `preview` and `publish`.
- **Finished once.** The last step sends `completed: true`, which sets
  `completed_at` the first time; going through the steps again moves only
  `step`. So the dashboards tell three states apart: a step without
  `completed_at` (skipped, or closed part way) offers "Finish setup",
  finished offers nothing, and no key at all (never started, such as a
  mobile account) offers nothing either.

### Complaints and moderation (R38, R40)

- **Categories.** `complaints.category` holds a fixed code, compared
  without case (`services/complaint_categories.py`): a general complaint's,
  which `create_general_complaint` checks (`PROPERTY_CONDITION`,
  `LANDLORD_CONDUCT`, `SAFETY`, `PRIVACY`, `OTHER`; the forms list these,
  `GET /complaint-categories`), or a repair's (`PLUMBING`, `ELECTRICAL`,
  `HVAC`, `APPLIANCE`, `LOCKS_SECURITY`, `LEAK`, `SAFETY`, `GENERAL`, named
  as `mobile_repair_category_label` names them). A value from before the
  codes (`safety`, `maintenance`, ...) keeps a readable name.
- **Alert policies.** `mobile_admin_issue_categories` rows are not
  complaint categories: each is a policy that covers the complaints whose
  category is one of its `source_categories`, or whose description holds
  one of its `keywords`, with a severity (`NORMAL`, `HIGH`, `URGENT`,
  `CRITICAL`), a response time (`sla_hours`, 1 to 2160) and a routing team.
  The console lists, saves and switches them through
  `mobile_admin_issue_categories`, `mobile_admin_save_issue_category` (the
  code comes from the name; no keywords means the name's words of 4 letters
  or more) and `mobile_admin_toggle_issue_category`, run as the admin
  (`user_client`); those log to `mobile_admin_audit_entries` themselves, and
  the web's `audit_log` gets `issue_category.saved`, `.activated` and
  `.deactivated`. The save function does not write `source_categories`, so
  the web writes the codes a policy covers after it (stamped, both logs:
  `issue_category.codes_changed`), keeping values another app stored that
  are not codes here. Its insert of a new policy leaves that column out,
  which is NOT NULL; whether it has a default is unknown (below). If the
  insert fails with 23502, the web inserts the row the function would (its
  code from the name, made unique as the function does, covering no codes
  yet) and saves it through the function as an edit, which checks and logs
  it; with a default, the function's own insert stands. Tests run both.
- **Who writes what.** A tenant's complaint about a listing they rent goes
  through `create_general_complaint` (an approved application for that
  listing, severity `LOW` to `CRITICAL`, 10 to 3000 characters), which writes
  the complaint (`metadata.source` `tenant_general_complaint`, `listingId`),
  its `LODGED` step and the landlord's notice; the web then merges its
  `subject` and `evidence_urls` into the metadata. A complaint naming a
  person and no property is written by `services/complaints.py`
  (`metadata.source` `web_member_complaint`, the same codes and description
  rule, a `LODGED` step). The database's trigger evaluates the red-flag
  rules on every complaints insert, so the web never does. An admin's
  status change to a `tenant_general_complaint` goes through
  `review_general_complaint` (`IN_REVIEW`, `ESCALATED`, `RESOLVED`, `CLOSED`;
  never from `CLOSED`; a note of up to 1200 characters), which records the
  step (`metadata.fromStatus`, `toStatus`) and tells the tenant; the web
  tells the respondent. Any other complaint's status is written by
  `services/complaints.py` with its `complaint_events` row. A repair's
  are the shared repair functions' (below); `services/maintenance.py`
  writes only a tenant's edit of their report, and `services/admin_repairs.py`
  an admin's decision on one. `services/admin_moderation.py`
  writes `reviews.status` and `listings.status` for moderation decisions
  only, each while the row still has the status the admin saw (it pauses
  only a `PUBLISHED` listing, as `enforce_listing_status_transition`
  allows, and archives any but a `LEASED` one);
  `services/reviews.py` and `services/properties.py` write the rest of
  those rows.
- **Function errors.** A shared function's refusal reaches the browser in
  its own words: `42501` is 403, `P0002` 404, `23505` 409, and `22023` or
  `23514` 422 (`complaint_categories.run_rpc`).
- **No lost writes.** `complaints` has no `updated_at`, so each web write
  that changes a complaint (an edit, an answer, a withdrawal, an admin's
  assignment, or an admin's status change of one that is not a
  `tenant_general_complaint`, which `review_general_complaint` moves)
  moves `metadata.revision` and applies only
  while the row still has the revision and status it read
  (`complaints._write_guarded`). A write that loses a race reads the row
  again and works its changes out anew, so an assignment and an answer
  sent at once both keep their keys; three lost races are a 409. An
  admin's status change is still 409 when the status itself moved since
  the admin saw it, and an assignment is made on whatever status the case
  has now.
- **Timelines.** Both parties see a complaint's `complaint_events` with
  it: who lodged and answered it, and each status an admin set, with the
  admin's note. `ASSIGNED` steps (which admin handles it) are for staff,
  and a step another app recorded under a type the web does not know
  shows without its note. A finished general complaint's outcome is the
  note of the admin's step that finished it.
- **Decisions.** Each admin decision is in both audit logs
  (`services/admin_audit.py`) with its actor, reason and from/to, and the
  person it affects is notified. Admins decide and read complaints in the
  console only: the parties' `PATCH /complaints/{id}/status` refuses an
  admin (403), and `GET /complaints/{id}` opens only for the complainant
  and the respondent. The same holds for a repair's routes:
  `GET /maintenance/{id}` opens only for its tenant, owner and assigned
  provider, and `PATCH /maintenance/{id}/status` refuses an admin (403).
- **Repairs in the console.** An admin cancels or closes a repair from the
  console's Repairs page instead (`GET /admin/repairs` with status,
  priority and search filters, `POST /admin/repairs/{id}/decision`;
  `services/admin_repairs.py`), always with a reason, and only while the
  work order still has the status the admin saw (409 otherwise; a
  finished repair is not decided again). Both decisions write the work
  order `RESOLVED`, the one end state `maintenance_work_orders_status_check`
  allows (`admin_repairs.CLOSED_WORK_STATUS`), with `completed_at` and the
  reason as `completion_note`, which the parties read as the repair's
  resolution note, and the case `CLOSED` for a cancel or `RESOLVED` for a
  close, with `resolved_at`; the decision in the logs says which it was. The case goes
  first and goes back when the work order's write finds it moved on. The
  reason is a `STATUS_CHANGED` step of the case timeline, both audit logs
  get `repair.status_changed`, and the tenant, the owner and the assigned
  provider are told, each on their own repairs page.

### Red flags and admin alerts (R39)

- **Raising.** Every complaints insert fires
  `evaluate_complaint_red_flags`, which runs
  `evaluate_red_flag_rule_for_property` for each active `red_flag_rules`
  row: the complaints about the property, all of them (`TOTAL`) or those of
  the last `window_days` (`WINDOW`), whatever their category. At
  `threshold_count` it opens one `red_flag_events` row (`OPEN`, the count in
  `evidence`) and notifies every active admin (link `/admin/red-flags`),
  unless the rule already has an `OPEN` or `ACKNOWLEDGED` flag for the
  property. "Re-evaluate now" (`POST /admin/red-flags/rules/{id}/evaluate`)
  runs `evaluate_red_flag_rule` for one active rule over every property.
- **Rules.** `services/red_flags.py` writes `red_flag_rules` (stamped):
  `rule_key` from the name, unique and never changed; threshold 1 to 10000;
  `TOTAL` or `WINDOW`; window 1 to 3650 days; a `ComplaintSeverity`. A rule
  that raised a flag is never deleted (`ON DELETE CASCADE` would take its
  flags and their evidence): it is deactivated instead. Both logs get
  `red_flag_rule.created`, `.updated`, `.activated`, `.deactivated`,
  `.deleted` and `.evaluated`.
- **Flags.** Acknowledge (`OPEN` to `ACKNOWLEDGED`), resolve or dismiss
  (from `OPEN` or `ACKNOWLEDGED`; a note is required; `resolved_at` is set),
  each while the flag still has the status the admin saw. The table has no
  column for who decided or why, so each decision is appended to
  `evidence.decisions`; the keys the database wrote stay as they were.
  Both logs get `red_flag_event.acknowledged`, `.resolved` and `.dismissed`.
- **Alerts.** `GET /admin/alerts` runs `mobile_admin_alerts` as the admin,
  which first runs `mobile_admin_refresh_alerts`: one `mobile_admin_alerts`
  row per unresolved complaint an active policy covers, once it passes the
  policy's `sla_hours` or repeats (2 open at its property in 30 days, 3 for
  its owner in 90), `CRITICAL` for a critical complaint or policy, twice the
  response time (48 hours at least), 3 at a property or 4 for an owner.
  `POST /admin/alerts/{id}/escalate` runs `mobile_admin_escalate_alert`: a
  critical alert only, which prepares the Housing Portal referral package
  (`mobile_admin_referral_packages`, case reference `TV-...`), tells the
  officers the first time and logs `ESCALATE_ALERT`; the web's `audit_log`
  gets `admin_alert.escalated`.

| Key | Meaning | Written by | Read by |
|---|---|---|---|
| `complaints.metadata.assigned_admin_id`, `.assigned_at`, `.assigned_by` | The admin handling a complaint, since when and who assigned them; all three go when it is unassigned. Staff only. | `services/complaints.py` (`staff_assign`) | `services/admin_complaints.py` |
| `complaints.metadata.revision` | How many times the web has changed the complaint (a positive integer; missing until its first web write, as for a row another app made). A web write applies only while the row still has the revision it read, and moves it on. | `services/complaints.py` (`_write_guarded`) | `services/complaints.py` |
| `complaint_events.metadata.from_status`, `.to_status` | Web statuses (`open`, `under_review`, ...) on the parties' steps; `ComplaintStatus` values on an admin's | `services/complaints.py` | Both timelines |
| `complaint_events.metadata.assignee_id`, `.previous_assignee_id` | On an `ASSIGNED` step of a complaint (a repair's names `worker_id`) | `services/complaints.py` | The admin timeline |
| `complaint_events.metadata.decision`, `.work_order_id` | On an admin's `STATUS_CHANGED` step of a repair's case: `cancelled` or `closed`, and the work order; `from_status` and `to_status` are the web's repair statuses (`in_progress`, `cancelled`, ...) | `services/admin_repairs.py` (through `complaints.record_event`) | The mobile app's case timeline |
| `mobile_admin_audit_entries.metadata` of a `review.moderated` entry (`entity_type` `review`) | `decision` (`hidden`, `restored` or `kept`), `from_status`, `to_status`, `reason`, `reviewer_id`, `reviewed_user_id`, `reports` (how many it decided) and `decided_reports` (those reports as `media_urls.reports` held them, which the decision clears). A report older than the review's newest such entry is decided. Entries the web wrote before the move to `mobile_report_review` alone (`review.reported`) are no longer read | `services/admin_moderation.py` | The review queue, `services/reviews.py` (`is_flagged`) |
| `mobile_admin_audit_entries.metadata` of a `listing.moderated` entry (`entity_type` `listing`) | `decision` (`paused` or `archived`), `from_status`, `to_status`, `reason`, `owner_id`, `manager_id` | `services/admin_moderation.py` | The admin listings page |
| `mobile_admin_audit_entries.metadata` of a `complaint.status_changed` or `complaint.assigned` entry (`entity_type` `complaint`) | `from_status`, `to_status` and `reason` (the note both parties see), with `category`, `complainant_id`, `against_id`; or `assignee_id`, `previous_assignee_id`, `reason` | `services/admin_complaints.py` | The activity log |
| `mobile_admin_audit_entries.metadata` of a `repair.status_changed` entry (`entity_type` `repair`, `entity_id` the work order) | `decision` (`cancelled` or `closed`), `from_status` and `to_status` (web repair statuses), `reason`, `complaint_id`, `tenant_id`, `owner_id`, `provider_id` | `services/admin_repairs.py` | The admin Repairs page (the last decision), the activity log |
| `mobile_admin_audit_entries.metadata` of an `issue_category.codes_changed` entry (`entity_type` `issue_category`) | `code`, and the codes the policy covered `before` and `after` | `services/complaint_categories.py` | The activity log |
| `complaints.metadata.source` | `tenant_general_complaint` (written by `create_general_complaint`, with `listingId`) or `web_member_complaint` (a complaint about a member, written by the web) | `create_general_complaint`, `services/complaints.py` | `services/complaints.py`: which function decides its status |
| `complaints.metadata.subject`, `.evidence_urls` | The web form's subject and links; merged in after `create_general_complaint` | `services/complaints.py` | Both complaint pages |
| `red_flag_events.evidence.decisions` | A list of `{action, from_status, to_status, actor_user_id, at, note}`: `action` is `acknowledged`, `resolved` or `dismissed`, `at` ISO 8601. The database's own keys (`details`, `complaintCount`, `thresholdCount`, `triggerMode`, `windowDays`, `windowStart`, `evaluatedAt`) stay as written | `services/red_flags.py` | `GET /admin/red-flags/events` |
| `mobile_admin_audit_entries.metadata` of a `red_flag_rule.*` or `red_flag_event.*` entry | A rule's `rule_key` and the fields set (`before`, `after`), `reason` or `created`; a flag's `from_status`, `to_status`, `reason`, `rule_id`, `property_id` | `services/red_flags.py` | The activity log |

To confirm with the mobile team: their `complaint_events.event_type`
labels and the entries their own moderation writes (the web counts only
`review.moderated` as a decision); whether
`mobile_admin_issue_categories.source_categories` has a default (to read
from `pg_attrdef` or `information_schema.columns`: the OpenAPI export
records none, but it records none for any jsonb or array column, and the
catalog snapshot holds no column defaults). Without one, the app's own
`mobile_admin_save_issue_category` cannot create a policy until the
function writes it or the column gets `'{}'`; the link `/admin/complaints` that
`create_general_complaint` and `review_general_complaint` give the
landlord's and tenant's notices, which is an admin page on the web; and
whether their writes to `complaints.metadata` could move `revision` too: a
write of theirs that keeps it as it was, and the status, goes unseen by the
web's guard.

### Property reviews (R12, R40)

The shared functions write property reviews; the web never writes those
keys itself. `services/reviews.py` calls them and maps their errors (42501:
403, P0002: 404, 23505: 409, 22023 and 23514: 422) with their own message.

- **Writing.** `POST /properties/{id}/reviews` (multipart: `review` as
  JSON, up to 4 `photos`) stores the photos in the private `review-photos`
  bucket at `<users.id>/<32 hex>.<ext>` (JPEG, PNG or WebP, 5 MB), then calls
  `mobile_submit_review` with the tenant's JWT. When the call fails the
  photos are removed. The function checks everything else: a TENANT, all 8
  ratings 1 to 5, a body of up to 4000 characters, a title of up to 120,
  pros, cons and advice of up to 1000, an APPROVED application for the
  property and one review per tenant and property; `rating` averages the 8
  and `landlord_rating` the 4 landlord ones. The homes to review are
  `mobile_reviewable_homes` (`GET /me/reviewable-homes`).
- **Reading.** `GET /properties/{id}/reviews` lists the PUBLISHED ones.
  Nobody is named or has an id there; the eviction answer goes only to its
  author and admins; photos go only to an active signed-in member, as links
  signed for 10 minutes (`reviews.PHOTO_LINK_TTL`). A link's path is the
  bucket's key, so it carries the reviewer's `users.id`, which leads to
  their public profile. The wizard says so on its photos step and, when
  photos are added, in the consent the reviewer ticks; to confirm whether
  photos should be streamed through the API instead, which would hide it.
- **What the app shows.** The shared read functions do not keep to the
  web's rule: `mobile_property_reviews` (any signed-in member) and
  `mobile_owner_review_summary` (the property's owner, its 2 newest) return
  `mobile_review_json` for every PUBLISHED review, whose `userName` is the
  reviewer's `full_name` (`Verified tenant` only when it is empty), with
  `userId` and `maintenanceOrEvictionIssue`. So the wizard's eviction
  question, its consent, the saved review's note, the author's answer on
  the listing and the support help say that in the TenantVoice app
  signed-in members, the owner included, can see the review with the
  reviewer's name and that answer (decided at integration, to confirm with
  the product owner: the alternative is for the DB owner to give
  `userName`, `userId` and `maintenanceOrEvictionIssue` in
  `mobile_review_json` only to the author and admins, after which the web
  can promise a review without the reviewer's name again).
- **Reports** are `mobile_report_review` with the reporter's JWT
  (`POST /reviews/{id}/reports`, any member; `PATCH /reviews/{id}/flag`,
  the reviewed party's reviews page, reason `other`).
- **Replies** to a property review are `reply_to_listing_review` (service
  role, the landlord as `p_landlord_id`); the function tells the reviewer,
  with a link to a mobile route (`/admin/listings/<id>`).
- **Decisions** go through `mobile_admin_moderate_review` with the admin's
  JWT (HIDE, DISMISS, APPROVE). As it stands, that function checks
  `FOUND` after an `EXECUTE`, which never sets it, so every call raises
  P0002 and rolls back; on that answer the web makes the same update
  itself (the status, the reports cleared), only while the review still
  has the status the admin saw. To fix in the database: read
  `GET DIAGNOSTICS ... ROW_COUNT`, or use a plain `UPDATE`. Once fixed, its
  update stands and the web's is not made; it has no expected-status
  check, so two admins deciding at once could then overwrite each other.

| Key | Meaning | Written by | Read by |
|---|---|---|---|
| `reviews.media_urls.photos` | The review's photo keys in `review-photos` (`<users.id>/<file>`), at most 4 | `mobile_submit_review` | `services/reviews.py`, `services/admin_moderation.py` (signed links) |
| `reviews.media_urls.mobile` | `ratings` (`conditionAtMoveIn`, `ownerResponsiveness`, `complianceFairness`, `costValue`, `maintenanceHandling`, `repairQuality`, `safetyPrivacy`, `neighbourhood`, each 1 to 5), `pros`, `cons`, `adviceToOwner`, `wouldRecommend`, `issuesDisclosed`, `maintenanceOrEvictionIssue` (the web shows it to its author and admins only; `mobile_review_json` gives it to every signed-in member, above) and `reportedIssues` (up to 80 characters each; the web sends "Issue: how fast it was fixed") | `mobile_submit_review` | `services/reviews.py`, the property page, the review queue |
| `reviews.media_urls.reports` | One `{userId, reason, details, reportedAt}` per member who reported the review (`spam`, `misleading`, `offensive`, `hate`, `privacy` or `other`); a decision clears it | `mobile_report_review`, `mobile_admin_moderate_review` (or the web's same update, above) | The review queue, `is_flagged`, `reported_by_me` |

## Housing Portal (R41)

The portal is for officers: a `users` row whose `primary_role` is
`REGULATOR` (the web role `officer`) and whose `status` is `ACTIVE`. Every
`/housing` route depends on `core/officer.py`'s `get_current_officer`, which
reads that row on each request and refuses every other role with 403,
admins included (tracker assumption #8): admins prepare referrals in their
console and see no officer views, although the shared
`mobile_require_housing_officer()` lets an ADMIN through as well. Past that
check, every `/housing` request also runs `mobile_require_housing_officer()`
as the officer (their JWT), so the database's rule holds on every endpoint:
its 42501 is 403 with its message. Staff sign-in sends an officer to
`/housing` (`lib/staff-session.ts`).
`services/housing_portal.py` holds the reads and writes, with its routes in
`api/routes/housing_portal.py` and its schemas in `schemas/housing_portal.py`.

- **Referrals** go through the officer's JWT (`user_client`), so the
  database checks the officer itself: `mobile_housing_red_flag_referrals`
  lists the packages admins referred (`mobile_admin_escalate_alert`, one row
  per alert), and `mobile_housing_update_referral` takes `START_REVIEW`,
  `PREPARE_PACKAGE` or `CLOSE` with an optional note of up to 500
  characters (a blank one keeps the last). It changes that one row and logs
  `HOUSING_REFERRAL_<action>` in `mobile_admin_audit_entries`, so a retried
  action never opens a second case; the web adds
  `housing.referral.<action>` to `audit_log`. The functions' errors keep
  their message: 42501 is 403, P0002 404, 23505 409, 22023 and 23514 422.
- **Red-flag alerts.** `red_flag_events` are read only (the database raises
  them, `evaluate_complaint_red_flags`); the portal shows a home's suburb
  and state, never its street. Only `services/housing_portal.py` writes
  `regulatory_red_flags.status` (New, Under review, Escalated, Closed),
  while the row still has the status the officer saw (else 409); asking
  again for the status it has changes nothing.
- **Figures.** Complaints by category (`complaint_categories.Labels`),
  status and severity, with the median days from `lodged_at` to
  `resolved_at`; reviews by status, and the ratings of those shown
  (`VISIBLE_REVIEW_STATUSES`). Read only.
- **Surveys** are `regulatory_surveys` and `regulatory_survey_questions`.
  A new survey is a Draft with an id `SV-` and 8 hex digits, and
  `closes_at` the ISO date chosen (else the column's "Not scheduled"); it
  goes Live once and Closes once, each from the status the officer saw.
  The snapshot shows no default for a question's `id`: the web lets the
  database number the questions, and numbers them itself (the next free
  ids, tried again on 23505) only when the database refuses one without an
  id (23502). Nothing sends a survey or collects answers, so the pages
  label them prototypes (`docs/demo-features.md`).
- **Data category requests** are `web.datapoint_requests` (0006): an
  officer asks for a change to a datapoint (`complaint_categories`,
  `maintenance_categories`, `red_flag_rules`, `review_questions` or
  `other`) and says why; the same pending change sent again by the same
  officer comes back (200) instead of a second row. Every active admin is
  notified (link `/admin/data-requests`). An admin answers from
  `/admin/datapoint-requests` (`get_current_admin`): `pending` may become
  `accepted`, `declined` or `completed`, `accepted` may become `completed`
  or `declined`, and the other two are final. The answer needs the status
  the admin saw and a response, and the officer is notified (link
  `/housing/data-requests`).
- **De-identified aggregates** count the complaints about a home by its
  suburb and state (compared without case or extra spaces) and the
  complaint's category. Only suburbs, states and category names leave the
  server: never a name, email, street address or id. A count under 5 is
  suppressed (`count` null), and where a category would have only one
  suppressed count, its smallest shown count is suppressed too, since the
  overview publishes each category's total. A category found in one suburb
  only can still be read off that total: the overview is for officers, and
  the aggregates are the table meant to leave the portal.
- **CSV dates** read `2026-10-20 12:00`, Sydney time with the year, where
  the pages show `Tue, 20 Oct, 12:00 pm`.
- **CSV downloads** are made in the browser from the table shown
  (`lib/csv.ts`), so they hold nothing the page did not; text a
  spreadsheet would run as a formula gets a leading apostrophe.

| Key | Meaning | Written by | Read by |
|---|---|---|---|
| `mobile_admin_audit_entries.metadata` of a `regulatory_flag.status_changed` entry (`entity_type` `regulatory_red_flag`, `entity_id` null: the alert's id is text) | `source` (`"web"`), `flag_id`, `from_status` and `to_status` (`regulatory_red_flags.status` values) | `services/housing_portal.py` (through `admin_audit.record`) | The activity log |
| `mobile_admin_audit_entries.metadata` of a `datapoint_request.answered` entry (`entity_type` `datapoint_request`) | `source`, `from_status`, `to_status` (`web.datapoint_requests.status` values), `reason` (the admin's response) and `officer_id` | The same | The activity log |

To confirm with the DB owner: whether `regulatory_survey_questions.id` is
an identity column, and the id format the mobile app gives a survey; that
the policies on the `regulatory_*` tables let any authenticated user manage
them (`auth.role() = 'authenticated'`), which the web never relies on; and
whether `mobile_require_housing_officer` should keep letting admins in.

Known limits, left for later:

- A data category request is matched to a pending one by a read, then an
  insert, with no unique index behind it: two posts of the same request at
  the same moment (two tabs, a resend while the first is running) make two
  pending rows, and the admins are told twice. A fix is a normalised
  `change_key` column with a unique partial index `(officer_id, datapoint,
  change_key) where status = 'pending'` in 0006, before it is applied.
- `mobile_housing_update_referral` moves a case from whatever status it
  has, and the web sends no status the officer saw: an officer acting on a
  stale page can close a case another officer just marked ready. To ask the
  DB owner: an expected-status parameter; the web can also re-read the case
  first, which narrows the race.

## Listings and applications (R25)

`services/properties.py` writes `properties`, `listings`, `property_media`
and `listing_favorites`; `services/property_applications.py` writes
`rental_applications`, `application_documents` and
`application_status_events`. Nothing else writes them, except an admin's
moderation decision on `listings.status` (`services/admin_moderation.py`,
above). A web property id is the listing's id; its owner is whoever owns
or manages its property.

The shared database's functions make the status changes, as the mobile
app's do, so both apps keep one set of rules. A function that takes the
actor (`transition_listing_status`, `review_rental_application`,
`submit_rental_application`, `delete_owned_*`) runs with the service role
and the caller's `users.id`; `mobile_withdraw_application` runs as the
tenant (`user_client`). Their errors reach the caller with the function's
message (`maps_rental.function_error`): 42501 is 403, P0002 404, 23505 409,
22023 and 23514 422, and a row still pointing at one being deleted (23503)
409. The web asks first what the status triggers would refuse
(`maps_rental.LISTING_MOVES`, `decision_refusal`) and answers 409 with a
reason, before anything is written.

- **Statuses.** Responses name the exact `listings.status` as
  `listing_status` (`draft`, `published`, `paused`,
  `applications_closed`, `leased`). An owner moves a listing with
  `PATCH /me/properties/{id}` and `listing_status` (`published`,
  `paused`, `applications_closed`). The moves are
  `enforce_listing_status_transition`'s: a draft is published or deleted,
  a published listing pauses, closes to applications or is deleted, a
  paused one is published again or closed to applications, a closed one
  reopens, and a leased one never moves. Nothing goes back to a draft.
  `leased` is refused (409): `enforce_listing_application_consistency`
  wants exactly one approved application on a leased listing, and
  approving one leases it. Only a `PUBLISHED` listing takes applications; a
  closed one still opens.
- **Who moves a listing.** The property's owner, when a `LANDLORD`, moves
  it through `transition_listing_status`, which sets `published_at` at the
  first publication only and asks for `users.verification_status`
  `APPROVED` (the web's gate, which also counts `VERIFIED`, asks first). A
  new listing of theirs is saved as a draft and published that way; if the
  database refuses, nothing of it is left. The functions take only an
  active `LANDLORD` owner, so an agent's move, or a manager's, is written
  by the web with the service role: the same moves, the same gate and the
  same `published_at` rule, applied only while the listing still has the
  status the web read (409 otherwise). The database's triggers allow that
  write; its functions do not, and `add_property_image`,
  `create_property_with_listing_v3` and `update_property_listing_v5` take
  a `LANDLORD` only too, so the web keeps its own writes for the listing's
  fields and photos.
- **Deleting.** `DELETE /me/properties/{id}` deletes as the mobile app's
  delete does, for the property's owner only (a manager gets the
  function's 403). A listing with a tenancy (leased, or with an approved
  application) stays (409). Otherwise `delete_owned_unrented_property`
  removes the property with its listing, applications, likes and photos
  (`ON DELETE CASCADE`; threads and reviews keep their rows, their key set
  to null), and the web removes the photo files it reports from
  `property-images`. A property with other listings keeps them: a draft
  goes alone (`delete_owned_draft_listing`), and any other listing is
  archived (`ARCHIVED`), which takes it off the web. A row that still
  points at the listing with no ON DELETE rule (an agreement, an owner
  assistant record) stops the delete (409).
- **Edits.** A patch changes only the fields it sends, and a null clears
  an optional one (description, bond, lease term, available from, rooms,
  amenities, photos). The title, address fields and rent cannot be
  cleared. Owner responses add `street_address`, the line an edit's
  `address` replaces. Photos are `property_media` rows; a removed one the
  web uploaded loses its file too. Once a property exists, its photos are
  stored at `<owner id>/<property id>/<file>` in `property-images`
  (`POST /me/properties/{id}/photos`), the folder the mobile app's storage
  policy keeps them in; the create wizard's go to `<owner id>/<file>`,
  before the property exists.
- **What a visitor gets.** Signed out (or with a token the API refuses),
  `GET /properties` and `/properties/{id}` give `address` as the suburb,
  state and postcode, and a title that names the street describes the
  home instead ("2-bedroom apartment in Wollongong"): the street's name
  with its type ("Kingfisher Ln") or with a number of the address ("12
  Kingfisher", "Unit 4, 12 Kingfisher Lane"), as `maps_rental.names_street`
  reads it. The description is shown as written. Their `location`
  search matches only the suburb, state and postcode, so no street word or
  number confirms where a listing is. A signed-in member gets the street
  and searches it too. An answer to a token the API refused (expired)
  carries `X-Session-Expired: 1`, and the web refreshes the session and
  asks once more (`lib/api.ts`), so a member is never shown the signed-out
  page for an old token. No listing response holds anyone's email or phone
  number: tenants message the landlord in the app. The listing page names
  the landlord only as their public profile does (`public_profiles`),
  with its badge and rating, and nobody when they are not listed. Its
  reviews (`GET /properties/{id}/reviews`) name no reviewer: "Verified
  tenant", or "Tenant" without a verified tenancy, and no reviewer id
  ([Property reviews](#property-reviews-r12-r40)).
- **Likes.** A `listing_favorites` row per tenant and listing, from
  `PUT` and `DELETE /properties/{id}/like` (tenants only). The pair is
  unique (`listing_favorites_user_id_listing_id_key`), so a like sent
  twice at once finds the first one's row (23505) and answers liked; the
  page shows the count to everyone.
- **Applying.** `POST /applications` calls `submit_rental_application`
  after the web's verification gate (the mobile's own
  `mobile_submit_application` asks for an approved account too). It takes
  a published listing only (404 before the call), never the owner's own
  (403), and one application per tenant and listing
  (`rental_applications_listing_id_applicant_user_id_key`): an open or
  approved one is a 409, and one that was declined, withdrawn or has
  expired is sent again as new, on the same row. The apply form fills
  itself from the tenant's profile in the browser; the tenant can change
  everything, and the server copies nothing from the profile. The offer is
  `offer_weekly_rent` (the asking rent when there is none) and the message
  `message`. The function writes the metadata (`source`, and
  `submittedByRole` or `resubmittedAt`); the web then merges what the
  tenant shared into `metadata.mobile` (table below) and writes the
  submission's step to `application_status_events`, which the function
  keeps none of. The owner and the manager see the applicant's name, badge
  and rating and what they sent, never their phone or email; the web shows
  a mobile application's `metadata.mobile` details the same way.
- **Deciding.** `PATCH /applications/{id}` calls
  `review_rental_application` with the owner's `users.id`. Only the
  property's owner, an active `LANDLORD`, decides: an agent or a manager
  reads the applications but gets the function's 403 ("Active landlord
  access is required", or "Application ownership could not be verified").
  Shortlisting, review and decline leave the listing as it is; approving
  needs a published listing or one closed to applications, leases it, and
  declines every other open application ("Another application was
  approved."). An approved application never changes again, and a
  declined, withdrawn or expired one is no longer decided (409). A note
  goes only with a decision. The owner's score (`tenant_score`) is the
  web's own and may be set by a manager too.
- **Withdrawing.** `DELETE /applications/{id}` calls
  `mobile_withdraw_application` as the tenant: an application that is not
  theirs is a 403, one already decided a 422, and withdrawing twice
  changes nothing.
- **Documents.** Only profile documents the tenant marked shareable, with
  a file the website stored, can go with an application. Each is an
  `application_documents` row: its `document_type`, a copy of the
  profile document's `file_url` (the storage key), `status` left
  `UPLOADED`, and the profile document's id in `metadata`. An application
  sent again goes with the documents chosen that time. The owner sees
  a document, and opens it through
  `GET /applications/{id}/documents/{document_id}/link` (signed for 5
  minutes at each opening, audited as `application.document_opened`),
  only while the tenant still shares the profile document and the
  application is `SUBMITTED`, `UNDER_REVIEW`, `SHORTLISTED` or
  `APPROVED`. A decline, a withdrawal or the expiry ends the sharing.
- **History.** Every status change is an `application_status_events`
  row with `changed_by_user_id` and the owner's `note`. Both sides read
  the history; a step is the applicant's or the landlord's when its actor
  is the applicant or the property's owner or manager.
- **Notices.** The functions write them, with the mobile app's link
  `/admin/applications`: a new or resubmitted application tells the
  owner, a withdrawal tells the owner, and every decision tells the
  applicant ("Harbour flat is now shortlisted."), as an approval tells the
  applicants it declined. The web adds one notice the functions do not
  write: a new application tells the property's manager (link
  `/owner/properties/{id}?tab=applications`).

| Key | Meaning | Written by | Read by |
|---|---|---|---|
| `rental_applications.metadata.mobile` | The application as the mobile app reads it (`mobile_application_json` returns these keys to the app). What the tenant shared on the web: `moveInDate` (YYYY-MM-DD) and `leaseDuration` (the listing's term as applied for, such as `12 months`), which `mobile_my_rental_history` reads, and `occupants`, `hasPets`, `pets`, `about` and `annualIncome`. A field left out is not written. The web reads the mobile app's own applications from the same keys (a date also as DD/MM/YYYY, as `mobile_parse_date` reads it). Seen by the tenant and the listing's owner or manager. | `services/property_applications.py`, and the mobile app | `GET /applications`, `GET /properties/{id}/applications` |
| `rental_applications.metadata.applicant_snapshot` | What the web kept before `metadata.mobile`: `{move_in_date, occupants, has_pets, pets, about, annual_income}`. Read only, for older rows; older still, `annual_income`, `move_in_date` and `has_pets` at the top of `metadata`. | Nothing now | Both application lists |
| `rental_applications.metadata.tenant_score` | The owner's own score for the applicant. Sending the application again (`submit_rental_application`) replaces the metadata, so it goes. | `services/property_applications.py` | Both application lists |
| `application_documents.metadata.profile_document_id` | The `profile_documents` row the attached document is; what the owner sees and opens follows that row's visibility | `services/property_applications.py` | `services/property_applications.py` |

To confirm with the DB owner: whether an agent may publish and decide (the
functions take a `LANDLORD` only, so the web writes an agent's listing
moves and refuses their decisions); whether `application_documents.file_url`
should hold a key or a URL; and where a web user should land from a
function's notice, whose link (`/admin/applications`) is the mobile app's
page.

## Listing auto-fill (R32)

`POST /me/listing-imports/url` and `/pdf` (landlords only,
`services/listing_import.py`, `docs/listing-import.md`) read a listing into
the create-listing wizard's fields and write nothing: no table, column,
metadata key or bucket is added or written, and a PDF is read in memory,
not stored in `owner-assistant-files`. The only read is the `paid_ai` gate's
`users` row, when the owner asks for the model. The audit trail keeps its
usual `web.audit_log` row for the request, with the method, path and status
alone, never the link or what was read. The listing is saved only when the
owner publishes it from the wizard, through `services/properties.py` as
above.

## Inspections (R13)

`services/inspections.py` calls the mobile functions on the caller's JWT,
since each takes the caller from `current_app_user_id()`; nothing on the
web writes the inspection tables itself. A function's refusal keeps its
message: 42501 answers 403, P0002 404, 23505 409, and 22023 or 23514
422. A web property id is the listing's id here too.

| Who | Web call | Function |
|---|---|---|
| Anyone | `GET /properties/{id}/inspections` | None: open, future slots of a PUBLISHED or APPLICATIONS_CLOSED listing, read as `mobile_inspection_open_slots` does (the slots' policy shows open slots to everyone), without the street address |
| Tenant | `GET /properties/{id}/inspection-slots` | `mobile_inspection_open_slots` |
| Tenant | `POST /inspection-slots/{id}/bookings` `{note}` | `mobile_inspection_book`: the slot becomes held, the owner is notified |
| Tenant | `GET /me/inspection-bookings`, `GET /me/inspection-homes` | `mobile_inspection_my_bookings`, `mobile_inspection_tenant_homes` |
| Owner | `GET /me/inspections?property_id=` | `mobile_inspection_owner_list` |
| Owner | `POST /me/properties/{id}/inspection-slots` `{starts_at: [...], duration_minutes}` | `mobile_inspection_create_slots` |
| Owner | `POST /inspection-slots/{id}/cancel` | `mobile_inspection_cancel_slot` |
| Owner | `POST /inspection-bookings/{id}/decision` `{decision: accept \| reject \| reschedule}` | `mobile_inspection_decide` |
| Owner | `GET /me/inspection-records`, `POST /me/properties/{id}/inspection-records`, `PUT /inspection-records/{id}`, `POST /inspection-records/{id}/status` | `mobile_owner_inspections`, `mobile_create_inspection` (then `mobile_inspection_json`), `mobile_update_inspection`, `mobile_set_inspection_status` |
| Owner | `GET /me/properties/{id}/inspection-attendees` | `mobile_inspection_applicants` |
| Tenant | `GET /me/inspection-records` | None: no function lists a record for its attendee, so the web reads the `mobile_inspections` rows where they are the attendee, in the shape `mobile_inspection_json` gives, notes (the meeting link) included. The history comes without its notes, which are the owner's findings and reasons; the owner's form says the attendee reads the notes. On the mobile app an attendee sees no notes |

- **Times.** A time sent without an offset is Sydney wall-clock time
  (`sydney_instant`): the owner's form sends the `datetime-local` value
  as typed. An hour that does not exist when daylight saving starts is
  refused (422); a repeated hour when it ends reads as its first
  (daylight) occurrence. Every page shows times in Australia/Sydney, and
  the functions' notices use `mobile_inspection_when`, which does too.
- **Notices.** The functions write them (`mobile_inspection_notify`,
  category `system`, link `/inspections`). The web's `/inspections` page
  sends an owner to `/owner/inspections` and a tenant to
  `/tenant/inspections`.
- **Records.** Remote and routine inspections are `mobile_inspections`
  rows: `Open home`, `Private viewing`, `Routine inspection`, `Entry
  condition` or `Exit condition`; Scheduled, then Completed or Cancelled.
  The meeting link and the findings go in the notes (up to 1000
  characters) and the status notes.
- **Not used.** The `mobile_inspection_requests` functions
  (`mobile_create_inspection_slots`, `mobile_request_inspection_slot`,
  `mobile_decide_inspection_request`, `mobile_listing_inspection_slots`)
  name columns that are gone.

How the functions behave that the web works around or should know:

- `mobile_inspection_cancel_slot` and `mobile_inspection_decide` test the
  owner with `owner_id <> current_app_user_id()`, which is null, not true,
  for an account that is not ACTIVE (PENDING_VERIFICATION): they would then
  act on anyone's slot or booking. The web checks the row's owner first
  (404, 403).
- A booking the owner asks to reschedule keeps its slot in the unique
  index `mobile_inspection_bookings_active_slot_idx`, although the slot is
  open again: only that tenant can book it (anyone else gets 409, "That
  inspection time is no longer available.") until they book another time,
  which cancels the request, or the owner cancels the slot.
- An accepted booking cannot be cancelled by any function, so its slot
  stays booked.
- "One active booking per home" is only an `exists()` check inside
  `mobile_inspection_book`; the unique index is per slot and each call
  locks only its own slot. So two bookings by one tenant for two slots of
  the same home at the same moment (two tabs, a double submit) both
  commit. To ask the DB owner: a unique partial index on
  `mobile_inspection_bookings (tenant_id, listing_id) where status in
  ('pending', 'accepted')`, which the web would answer as 409.
- A slot held by a reschedule request still reads as open, so the
  booking panel leaves out a time that answered 409.
- Every inspection function checks `properties.owner_user_id` only, while
  the web counts a property's manager (`manager_user_id`) as an owner: a
  manager sees the Inspections tab and "Manage inspection times", and each
  call answers 403 ("Choose one of your properties."). Showing them only to
  the owner needs an owner-only flag from the property API.
- `mobile_create_inspection` accepts any applicant of the listing as the
  attendee, a withdrawn one too, while `mobile_inspection_applicants`
  leaves withdrawn ones out.

The stand-ins in `backend/tests/fake_rpcs/fb_inspections.py` follow the
function bodies, these behaviours and the unique partial indexes included.

## Leases (R26)

`services/leases.py` (routes under `/leases`) runs a lease through the
shared lease functions and tables, so both apps keep one set of rules. The
functions that read `auth.uid()` run on `user_client(current.access_token)`;
the database's triggers check every step and send the notifications, so the
web sends none of its own. Each answer has a `stage`, worked out from the rows
(`leases.stage_of`): `draft`, `review`, `confirmed`, `tenant_signed`,
`signed`, then `active` (or `ended`, `cancelled`).

- **Drafting.** Only the property's owner (`properties.owner_user_id`, not a
  manager) drafts the lease of an `APPROVED` application, with the agreed
  rent, `WEEKLY`, `FORTNIGHTLY` or `MONTHLY`, the start, the first due date
  and an optional end (`mobile_create_rent_agreement_draft`).
  `GET /leases/candidates` lists the owner's approved applications without a
  lease. One agreement per application: a repeated draft with the same terms
  answers 200 with it, other terms 409.
- **The PDF.** The owner previews the guided form's PDF (`services/pdf.py`,
  `POST /leases/{id}/document/preview`; nothing is stored) and sends that
  exact PDF: the send carries the preview's SHA-256, and a PDF that differs
  (the form or the parties changed) is 409. Or the owner uploads a PDF (10 MB,
  `%PDF-`, scanned as every upload). Either way the backend stores it in
  `tenant-lease-documents` at `<agreement id>/lease-v<n>-<12 hex of its
  SHA-256>.pdf` with the owner's own token (`leases.user_storage`): the
  bucket's insert policy and `mobile_register_tenant_lease_document` accept
  only a PDF the draft's owner stored, before the tenant confirms and before
  anyone signs. Then it registers it. A repeated send lands on the same path
  and the same unique row, so it adds nothing. A PDF nothing registered is
  removed.
- **Who opens it.** Only the tenant and the owner read a lease
  (`GET /leases`, `/leases/{id}`; anyone else 404, other roles 403), and only
  its latest PDF opens: the backend streams it from
  `GET /leases/{id}/documents/{document_id}/file`, and an older one is 410.
  The bucket is public, so no answer names its path or a Storage URL.
- **Confirming and signing.** The tenant confirms the terms of the PDF they
  name (`mobile_tenant_confirm_rent_agreement`), then signs it: a
  `tenant_lease_signatures` row with the typed name (2 to 160 characters),
  `TYPED_NAME`, the consent statement and its version
  (`leases.TENANT_CONSENT`, `tenantvoice-web-tenant-2026-10`), and the
  document's id, path and the SHA-256 of the stored bytes. A PDF that is no
  longer the latest is 409, as the guard trigger says. The owner then signs
  the same document, path and hash (`rent_agreement_owner_signatures`,
  `leases.OWNER_CONSENT`, `tenantvoice-web-owner-2026-10`); a stored PDF
  whose hash changed is not countersigned. Both inserts use the service
  role, and a repeated signature answers with the one recorded.
- **Activating.** `mobile_owner_activate_rent_agreement` makes the agreement
  `ACTIVE` once both signatures are on the latest PDF. A draft never counts
  as signed or active before that: the rental pipeline's lease and move-in
  steps (`components/leases/PipelineLease.tsx`) read the stage.
- **Errors.** A function's refusal keeps its message (`leases.refusal`):
  42501 is 403, P0002 404, 23505 409, 22023 and 23514 422, and the mobile
  functions' plain exceptions 422 for a value sent, else 409.
- **Notices.** The triggers link to the mobile app's routes
  (`/documents/lease-ready/...`, `/applications/lease-signed/...`,
  `/agreements/activated/...`); the web has pages at those paths that open
  the lease (`frontend/app/(notice-links)`).

No new table, column or metadata key. To confirm with the DB owner: making
`tenant-lease-documents` private (the web never needs its public URLs), and
whether the web should also write `tenant_lease_signature_evidence_files`
(an evidence PDF in `tenant-lease-signing-evidence`).

## Tenant matching (R34, R36)

`services/matching.py` matches a tenant with listings and landlords from
the preferences above (`docs/tenant-matching.md` has the rules). It reads
`tenant_profiles`, `listings` with `properties`, `property_media`,
`rental_applications`, `users` and `reviews`, and is the only module that
writes the shared `recommendations` table, with stamped inserts (the table
has no `id` default and no `updated_at`). No mobile RPC is called:
`mobile_notify_matches` and `search_listing_catalog` have unknown bodies.

| Column | What the web writes |
|---|---|
| `target_user_id` | The tenant. A tenant only ever sees their own rows. Only the alert for a newly published listing reads other tenants' rows, to skip those it was alerted to. |
| `recommendation_type`, `entity_type`, `entity_id` | `PROPERTY`, `listing` and the listing's id; or `USER`, `user` and a landlord's `users.id` |
| `source` | `RULE_ENGINE`, or `AI` for a match the model ordered |
| `score`, `reason` | 0-100, and the first reasons as text |
| `expires_at` | A day after a match was worked out; 30 days after an alert |

| Key | Meaning | Written by | Read by |
|---|---|---|---|
| `recommendations.payload.app` | `"web"`. The web reads and replaces only its own rows; another app's rows are never read or touched. | `services/matching.py` | `services/matching.py` |
| `recommendations.payload.kind` | `"match"`: one of the tenant's current results, all replaced together when what they show changes (`inputs`), so a refresh writes nothing. `"alert"`: a listing the tenant was alerted to; kept, so a listing is alerted to a tenant at most once. | `services/matching.py` | `services/matching.py` |
| `recommendations.payload.inputs` | A digest of what the results showed (`matching._inputs`): rows with another one are out of date. The model's order is served again while it matches. | `services/matching.py` | `services/matching.py` |
| `recommendations.payload.batch` | One id for the rows one recording of a tenant's matches wrote. Two requests that record at once each keep only the newest batch they find after their own insert (`matching._keep_newest`, by `created_at`, then batch), so they converge on one set. Older rows have none. | `services/matching.py` | `services/matching.py` |
| `recommendations.payload.rank`, `.match_level`, `.reasons`, `.reason_codes`, `.unmet` | A match's place, `strong`, `good` or `fair`, the reasons shown (the model's picks first), their fact codes, and the nice-to-haves missed | `services/matching.py` | `services/matching.py` |
| `recommendations.payload.listing_ids` | A landlord match's listings that fit | `services/matching.py` | Nothing yet |
| `recommendations.payload.trigger`, `.reasons` | An alert's cause: `listing_published` or `preferences_changed`, and the reasons it fit | `services/matching.py` | Nothing yet |

Two alerts for the same tenant and listing at the same moment both insert,
then both look, and the later row is deleted unsent: best effort, as for
connection requests below. A tenant's preferences save alerts them only
when it changed what matching reads (`profiles.update_my_profile`,
`docs/tenant-matching.md`).

## Provider suggestions (R31)

`GET /me/provider-suggestions` (tenants, and landlords with agents) ranks
the providers the marketplace lists for the caller's places, in one category
(`category`, a code or slug; another is 422) or all.
`services/provider_ranking.py` does it in `rank_providers()`, which the owner
AI can call too. It reads `service_provider_profiles` (with its
`service_area` column), the live `mobile_provider_services`, the providers'
`users` rows (the suburb, state and postcode their marketplace card shows,
and the badge), `reviews`, `properties`, `listings` and
`tenant_profiles.preferred_locations`. It writes nothing, adds no metadata
key and calls no RPC or model, so no gate is asked: rule matching never is.

- **Places.** An owner's `property_id` is a listing of a property they own or
  manage, else 404 (an archived one too). Without one: the properties of all
  their listings that are not archived, then the suburb, state and postcode
  on their profile. A tenant's: their profile's, then each preferred suburb,
  read as a suburb, postcode and state ("Newtown, NSW 2042"); a tenant who
  names a property gets 400. The web saves preferred suburbs a name at a
  time, in the order typed, so one saved without a state is in the first
  state saved after it (`["Newtown", "NSW", "Footscray", "VIC"]`), else in
  the tenant's own, and that state is no place of its own; a state saved
  alone is (`preferred_places`).
- **Who is suggested.** `service_providers.published_providers()`
  (published, and the owner's account `ACTIVE` and not deleted), less the
  caller, with at least one live service, which the booking link opens.
- **Where they work.** The profile's and the live services' service areas,
  split at commas, semicolons and slashes. A piece names a suburb as a whole,
  or by its capitalised names ("15km of Newtown"); its 4-digit numbers are
  postcodes, and a piece that is only a state serves all of it. A piece
  without a state is in the provider's own. Then where the provider is
  based. A suburb beats the postcode, which beats the state, and a provider
  that fits no place is left out; with no place to match, nobody is.
- **Rating.** `public_profiles.trust_of()` (PUBLISHED and FLAGGED reviews),
  blended with 3 reviews of 3.5.
- **Price** (assumption #10). The cheapest priced live service, against the
  median of each listed provider's cheapest price of the same pricing type
  (`maps_provider_core.web_pricing_type`) in the provider's category, once 3
  providers have one. At or below the median scores in full; above it, less,
  down to nothing at twice it.
- **Order.** 45 for the place, 35 for the rating and 20 for the price, out
  of the factors that apply, as a 0-100 `score`. Ties go to the verified
  badge, then to more reviews.
- **Reasons**, each from those figures: "Serves Newtown" or "Based in
  Newtown", "Serves postcode 2042", "Serves NSW"; "4.8 from 12 reviews" or
  "No reviews yet"; "$120 fixed, below the $150 median for cleaning";
  "Verified by TenantVoice".

The weights, the prior and the three prices a median needs are defaults to
confirm. There are no coordinates: a region such as "Inner West" matches a
client who names it, never the suburbs in it.

## Support chat (R37)

`POST /support/chat` (`services/support_chat.py`, `docs/support-chat.md`)
answers signed-in members from the help files and the active `web.faqs` of
their audience, read through `content.list_faqs`. It reads nothing of the
caller's account beyond what the `paid_ai` gate reads, and its only write is
the day's count in the shared `mobile_ai_chat_usage`. No mobile RPC is called:
`mobile_ai_chat_limit` takes the caller from `auth.uid()` and its body is
unknown, so the web writes the row itself, stamped.

| Column | What the web writes |
|---|---|
| `user_id`, `usage_date` | The caller's `users.id` and the UTC date, written explicitly: a Supabase database runs in UTC unless its owner changed it, so that is the date the column default `CURRENT_DATE` gives. The pair is the primary key, so the web counts in the row the mobile app's AI chat counts in, and a member's messages on both apps share one daily count |
| `calls` | 1 for a new row; else the count read plus one, in an update filtered on that count (`calls=eq.<read>`), so a message another request or the mobile app counted meanwhile is never lost: the update matches nothing and the row is read again, up to 5 times. Two first messages at once: the later insert fails on the key (23505) and counts in the row the other made. At `settings.support_chat_daily_limit` (30) or more, the message is refused with 429 and nothing is written |
| `last_call` | When the message was counted |

To confirm with the mobile team: whether `mobile_ai_chat_limit` counts the
UTC day as well, and whether a support chat message should share their AI
chat's count, or have its own (which would need a column or a web table).

## Scorecards (R43)

A tenant asks an owner or agent for a scorecard about one home; the owner
rates the tenant on the Owner/Agent Tenant Scorecard, 1 to 5 for each item,
with an optional comment, or declines; both of them read the result, and the
tenant chooses whether it counts on their public profile (tracker assumption
#20). The rows are `web.scorecard_requests` (`supabase/shared/0004_scorecards.sql`),
written only by `services/scorecards.py`, directly: no mobile RPC is called.
The seven items, in their order, are `paid_rent_on_time`,
`looked_after_property`, `communicated_respectfully`,
`followed_lease_conditions`, `cooperated_with_inspections`,
`left_property_in_good_condition` and `would_rent_again`
(`schemas/scorecards.ITEMS`; the web's form reads the same keys).

- **Who may be asked** (`GET /me/scorecard-requests/recipients`, tenants
  only): the owner of a `rent_agreements` row whose tenant is the caller,
  once that lease took effect (`activated_at` is set, or the status is
  `ACTIVE`), current or past; and the owner or manager of the property of a
  listing the caller's application to was `APPROVED`. They must hold an open,
  `ACTIVE` `LANDLORD` or `AGENT` account. `POST /me/scorecard-requests`
  (`owner_user_id`, `property_id`) refuses anyone else with 403, never saying
  which part failed. `property_id` is a `properties.id` here, not the listing
  id other web routes call a property, and the row keeps the `agreement_id`
  or `application_id` that let the tenant ask.
- **One at a time.** One `PENDING` request per tenant, owner and home: the
  partial unique index `uq_scorecard_requests_pending` refuses another (409),
  two sent at once included. Answered and cancelled requests stay.
- **Asking again.** One scorecard per tenant, owner and home: once one is
  `COMPLETED`, another request is 409, so one tenancy never counts twice.
  After a decline the tenant asks that owner about that home again only 30
  days after its `decided_at`, and after a cancel 7 days after, from the
  start of the next day in Sydney (409 until then, naming that day), so a
  request and cancel loop cannot flood an owner with notices. The
  recipients list says which (`completed_request_id`, and `ask_again_from`,
  that day's start), and the form offers neither.
- **Only the two of them read it.** `GET /me/scorecard-requests` lists a
  tenant's requests sent and an owner's or agent's received, newest first;
  `GET /scorecard-requests/{id}` is 404 for anyone else, admins included. The
  owner answers (`POST /scorecard-requests/{id}/submit`, all seven ratings
  and the comment; `/decline` with an optional reason); the tenant cancels
  (`/cancel`) and shows or hides a completed one
  (`PATCH /scorecard-requests/{id}`, `visible_on_profile`). The other side's
  role is refused with 403 before the request is looked up. The web
  `audit_log`, which admins read in the activity log, records who took
  each step about which home, never a rating, the average, the comment or
  a reason.
- **Each answer once.** The writes apply only while the request is still
  `PENDING` (the visibility only while it is `COMPLETED`), so the second of
  two answers is 409 and nothing is overwritten. Each answer and a
  cancellation set `decided_at`, the API's `decided_at`; not `updated_at`,
  which also moves when a linked lease or application is deleted (its key
  is set to null).
- **Notices**, kind `review` (the Reviews switch, whose hint says so): a
  request and a cancellation tell the owner (`/owner/scorecard`, also the
  owner menu's Scorecards item, so an owner with the switch off still finds
  their requests), a completed scorecard or a decline, with its reason,
  tells the tenant (`/tenant/dashboard#scorecards`).
- **The public profile.** A tenant's `GET /public/profiles/{id}` has
  `scorecard`: the average and count of their `COMPLETED` scorecards with
  `visible_on_profile` true (the newest per owner and home), or null, and
  null whatever they chose while
  their `users.metadata.privacy.share_score` is false. It never shows who
  wrote them, a single rating or a comment; search cards have no scorecard.

| Column | What the web writes |
|---|---|
| `status` | `PENDING`, then `COMPLETED`, `DECLINED` or `CANCELLED` (a CHECK) |
| `answers` | Once completed: an object with each item's key and its rating, an integer from 1 to 5. A key or value the web does not know is left out when it reads one |
| `comment`, `decided_reason` | The owner's comment (up to 1,000 characters) and their reason for declining (up to 500); null when they gave none |
| `completed_at`, `decided_at` | When the owner completed it; when it was completed, declined or cancelled. Null while it waits |
| `visible_on_profile` | The tenant's choice, false until they show it. It counts only on a `COMPLETED` row, and only the tenant reads it: the owner's view has null |

The profile completion (`services/profile_completion.py`) does not read
these rows yet: its owner-reference and received-references rows stay
unavailable until it does.

To confirm with the mobile team: the `rent_agreements.status` labels (the
web counts a lease once `activated_at` is set, or while it is `ACTIVE`), and
whether the mobile app shows these scorecards too. The waits after a decline
(30 days) and a cancel (7 days), and one scorecard per tenant, owner and
home (a second lease of the same home asks for none), are defaults to
confirm.

## Ratings and connection requests

- **A rating** is the average and count of the reviews about a member
  (`reviews.reviewed_user_id`) whose status is in
  `maps_reviews_complaints.VISIBLE_REVIEW_STATUSES`, PUBLISHED and FLAGGED:
  the reviews their profile lists. The marketplace
  (`service_providers.COUNTED_REVIEW_STATUSES`), the public profiles
  (`public_profiles.RATED_STATUSES`) and the signed-in profile search
  (`public_profiles.trust_of()`) all count those, and the verified badge
  is `badges.is_verified(users.verification_status)` everywhere. A FLAGGED
  review is one someone reported that no moderator has decided yet: it
  stays listed, marked "Reported · under review" (`reported` on a public
  profile's review, `is_flagged` on a provider's), until a moderator hides
  or archives it (tracker assumption #4, plan §3 a8). Assumption #1's
  "PUBLISHED reviews" is read as these; that reading is to confirm.
- **Public reviews name no reviewer** (assumptions #1, #11; nobody can opt
  to show a name yet). A public profile's reviews and a provider's
  `GET /providers/{id}/reviews` give the reviewer's role alone
  (`public_profiles.reviewer_label`: "Verified tenant" after a verified
  interaction such as a booking, else "Tenant"), with no name, photo,
  suburb or id: a stored name may be an email or a phone number. A
  property's reviews say "Verified tenant" or "Tenant".
- **`connection_requests`** keeps one live request per pair (tracker
  assumption #3; `services/connections.py` lists the states). A new request
  reuses the pair's row when there is one: a WITHDRAWN row, or a DECLINED row
  when the person who declined asks back. Two requests inserted at the same
  moment are both checked after the insert, and the later one is deleted.
  That check is best effort: `created_at` is when a transaction started,
  so one that commits after the other's check can leave both, and the
  first then decides both people's state. Only a unique index on the pair
  (the DB owner's) would make it certain.

## Owner AI assistant (R29-R31)

`services/owner_assistant.py` speaks the mobile assistant's protocol and
adds no table, column or metadata key. Each function runs as the owner,
through `user_client` (`mobile_assistant_owner()`: an active LANDLORD or
AGENT account).

- **A question** (`POST /me/owner-assistant/messages`, with the client's
  `request_id`). `mobile_owner_assistant_reserve` takes the id: 10 a minute
  and 100 a day per owner (429 beyond), and an id already answered gives
  its saved result back (`cached`). `mobile_owner_assistant_context` reads
  the owner's records. `mobile_owner_provider_search` runs when the question
  asks for a provider, with the category and suburb its words name, by
  price for "cheap" and the like. It filters on the account's verification
  and the mobile profile's public flag only, so the web also leaves out a
  provider whose `service_provider_profiles.metadata.is_published` is
  false, as its marketplace does, and one whose profile
  `verification_status` is not approved, whom the R18 gate of
  `POST /maintenance/{id}/assign` refuses. `mobile_owner_assistant_finish`
  saves the turn.
- **Who answers.** The model answers when `DEEPSEEK_API_KEY` is set and the
  owner passes `paid_ai`. It gets the context without tenant names, street
  addresses, emails or phone numbers (`model_input`); applications are
  `Applicant xxxxxx` labels. Otherwise fixed rules answer from the same
  context: also when the model fails, or answers out of bounds
  (`checked_answer`: the wrong shape, a claim that something was done, a
  pick among applicants, or an action that is not the owner's to take). A
  rules reply starts with `RULES_LABEL` ("AI unavailable: ..."), which is
  how the web, and the history the apps share, tell it apart.
- **Rent.** Rent answers come from the owner's rent ledger (R27,
  `rent_ledger.ledger`: the `ISSUED` charges of their `ACTIVE` agreements
  and the receipts counted against them), which the model gets as `rent`
  without tenant names. Charges and payments recorded as assistant records
  (`owner_assistant_records`) are `assistantRent`; the ledger and the
  inspections pages do not show those records, and their preview says so.
- **`owner_assistant_requests.result`** of a chat (`operation` `ai_chat`)
  is `{reply, action?}`, with `action` `{operation, payload}` for an
  operation of `mobile_owner_assistant_action`. `owner_assistant.SCHEMAS`
  checks each payload, and only ids from the owner's context pass. The web
  adds `action.basis` when the action changes a row the preview described:
  `{listing: [updatedAt, status]}`, `{application: [status, listing status,
  listing updatedAt, the ids an approval would reject]}`, `{repair: [status,
  appointmentAt]}`, `{record: [updated_at, status]}` or `{charge:
  [outstanding]}` (`owner_assistant.basis`). The receipt compares only
  `operation` and `payload`. The assistant never offers `schedule_maintenance`: its `mobile_schedule_repair`
  calls `update_maintenance_work_order(..., 'schedule')`, which only the
  assigned provider may run, so an owner's confirm would always be 403.
  `mobile_owner_assistant_receipt` later replaces `reply` with the action's
  message and its receipt.
- **A confirm** (`POST /me/owner-assistant/messages/{request_id}/confirm`,
  `paid_ai`). The service role reads the owner's chat row, scoped by
  `owner_user_id`. The action is checked again against the context as it
  is now, and its `basis` must be as the preview showed it (409 otherwise,
  so a confirm never overwrites a newer edit). An `assign_maintenance`
  passes the same R18 gate as `POST /maintenance/{id}/assign`
  (`gates.require_verified_party`, `receive_repairs`, read now): 403
  otherwise. Then exactly the saved operation and
  payload run: `mobile_owner_assistant_action(action id, operation,
  payload, true)`, then `mobile_owner_assistant_receipt(chat id, action
  id)`. The action id is `uuid5(owner_assistant.ACTION_NAMESPACE, "<owner
  id>:<chat id>")`, so an answer runs at most one action, and a retried
  confirm gets the first result back. A cancel sends nothing.
- **Errors.** A function's 42501 is 403, P0002 404, 23505 409, and 22023
  or 23514 422, with the function's message. P0001 is 422, except the
  request limit (429) and a request id in use (409). Anything else is 503.

To confirm with the DB owner: whether `mobile_owner_assistant_action`'s
operations that call other functions (listings, applications, repairs,
messages) need more than its own checks, whether the mobile app reads
keys of `result` other than `reply` and `action`, and whether
`schedule_maintenance` is meant for owners, who cannot run it today.

## Provider workspace (R33)

### Repairs (R06, R33)

A repair is a `complaints` row (what was reported) and the
`maintenance_work_orders` row hanging off it (who does the work and where it
stands), as the mobile app keeps it; its web id is the work order's. Every
step is the mobile app's own function, run as the person taking it
(`user_client`), so both apps keep one set of rules, one timeline
(`complaint_events`, through `mobile_repair_event`) and one set of notices
(`notifications`, which the functions write and the web does not repeat).
`maintenance_work_orders.status` is only ever `OPEN`, `ASSIGNED`,
`SCHEDULED`, `PENDING_TENANT_CONFIRMATION` or `RESOLVED` (its CHECK): the
web writes none of them itself.
An admin's cancel or close goes through `services/admin_repairs.py`
(above), which keeps to those five statuses.

| Step | Who | Route | Function |
|---|---|---|---|
| Report a repair for a rented home | tenant | `POST /maintenance` | `mobile_create_repair` |
| Log one for a home with a tenant | owner | `POST /maintenance` | `mobile_owner_create_repair` |
| The homes to choose from | tenant, owner | `GET /maintenance/homes` | `mobile_my_repair_properties`, `mobile_owner_repair_properties` |
| The providers to choose from | owner | `GET /maintenance/{id}/providers` | `mobile_repair_providers` |
| Assign a provider | owner | `POST /maintenance/{id}/assign` | `mobile_assign_repair` |
| Book or move the visit | assigned provider | `POST /me/repairs/{id}/schedule` | `mobile_schedule_repair` |
| Mark the job done, after the visit started | assigned provider | `POST /me/repairs/{id}/complete` | `mobile_complete_repair` |
| Confirm the work, with a rating | tenant | `POST /maintenance/{id}/confirm` | `mobile_confirm_repair` |
| Rate a repair the owner resolved | tenant | `POST /maintenance/{id}/rate` | `mobile_rate_repair` |
| Resolve, at any stage | owner | `POST /maintenance/{id}/resolve` | `mobile_resolve_repair` |

- **Reporting.** The category is one of the eight shared codes
  ([Services and categories](#services-and-categories-r03)), the priority
  `low`, `medium`, `high` or `urgent` (severity `LOW` to `CRITICAL`), the
  title up to 120 characters and the description 5 to 2000. Up to 4 photos
  go first to `POST /maintenance/photos`, into the private `repair-photos`
  bucket at `<users.id>/<32 hex>.<ext>` (5 MB; jpeg, png or webp), and the
  report names their keys, which the function checks are the reporter's.
  The parties see them through short-lived links. The functions take a home
  with an `APPROVED` application only: the tenant's own, or the owner's with
  its newest tenant. An agent who owns a home follows its repairs but
  takes no owner step: `mobile_owner_create_repair`,
  `assign_maintenance_work_order` and `mobile_resolve_repair` take an
  active `LANDLORD` account only, so the web offers an agent no home to
  log a repair for, sends `can_assign` and `can_resolve` false, and
  refuses those steps with 403 before calling a function
  (`maintenance.OWNER_STEP_ROLE`; to confirm with the DB owner whether
  agents should take them).
- **Assigning** needs an `OPEN` or `ASSIGNED` work order (else 409) and a
  provider who passes the gate (`require_verified_party`) and whom
  `assign_maintenance_work_order` takes: an approved, active service
  provider whose `service_categories` hold the repair's category. It opens
  the maintenance thread (`conversations.metadata.maintenanceComplaintId`)
  with the tenant and the provider, puts the case `IN_REVIEW` and writes
  the provider's job request (`mobile_ai_service_jobs`, `request.source`
  `maintenance`).
- **The provider's view.** `GET /me/repairs` lists the work orders whose
  `assigned_worker_id` is theirs: the category, priority, title,
  description, photos, listing title, suburb and state, and the owner. The
  street address, the access notes, the tenant's name and the visit time
  come only once they booked the visit (a time, in a status past
  `ASSIGNED`): assigning keeps `appointment_at`, so a time an earlier
  assignee booked is not the new one's. `GET /maintenance` and
  `/maintenance/{id}` leave them out for the provider too. Another
  provider's job, or an id that is not a uuid, is 404.
- **The visit** takes a Sydney date and time in the future and 15 minutes to
  24 hours. Marking the job done needs the visit to have started (a web
  rule) and a note; it leaves the work order `PENDING_TENANT_CONFIRMATION`
  (`awaiting_confirmation`) and the case open until the tenant confirms it,
  which resolves both. The owner may resolve it at any time instead, and
  the tenant may then rate it once.
- **Statuses on the web:** `open` (`OPEN`), `in_progress` (`ASSIGNED`,
  `SCHEDULED`), `awaiting_confirmation`, `resolved`; `cancelled` only for an
  older row. Nothing withdraws a repair: the parties'
  `PATCH /maintenance/{id}/status` takes only the owner's `resolved`, and
  answers 422 for the rest, 403 for the tenant's and the provider's
  `resolved` and for an admin. Each answer carries what the caller may do
  next (`can_confirm`, `can_rate`, `can_assign`, `can_resolve`), as
  `mobile_repair_json` says.
- **A function's refusal** comes back with its own message: 403 for no
  access, 422 for a value it does not take (`maps_provider_core.run_function`).

| Key | Meaning | Written by | Read by |
|---|---|---|---|
| `complaints.metadata.mobile` | `{issueTitle, photos, createdBy}`: the title, the photo keys and who reported it. The web merges a tenant's edited title into it and keeps the rest | `mobile_repair_insert`; `services/maintenance.py` (a tenant's edit) | Both apps |
| `complaints.metadata.access_notes` | How to get in, for the provider once the visit is booked. A web key: the mobile app has no field for it | `services/maintenance.py` | `services/maintenance.py` |
| `complaints.metadata.subject`, `.photo_urls` | A web report's title and photo links from before the shared functions; read when `mobile.issueTitle` is missing | Nothing now | `services/maintenance.py` |

To confirm with the DB owner: the functions' notices link to
`/admin/maintenance`, the mobile app's page, which the web has not; and
whether a suspended provider should still finish a visit they booked.

### Job requests from the mobile app

Owners ask a provider for a job from the mobile app's assistant, and
assigning a repair writes one too: `mobile_ai_service_jobs` rows, whose
`payload` holds the title, description, owner, property and status. The
provider's dashboard lists their own (`GET /me/job-requests`, through
`mobile_ai_jobs`) and moves one on (`POST /me/job-requests/{id}/status`,
through `mobile_ai_provider_job`), both run as the provider
(`services/provider_jobs.py`). The function's moves are the only ones:
`pending` to `accepted` or `declined`, `accepted` to `in_progress`
(`inProgress`), `in_progress` to `completed`; another is 409 with its
message, and another provider's job 404. The function tells the owner. A
job a repair wrote (`from_repair`, `payload.complaintId`) is booked and
done from the repairs page; its own status is the owner's and the
provider's to move, as in the mobile app. The web never creates a job.

### Work opportunities (assumption #19)

`GET /me/recommendations/provider/opportunities` (providers only) ranks the
owners and landlords (`users.primary_role` `LANDLORD` or `AGENT`, `ACTIVE`,
not deleted) in the provider's areas: the provider's own suburb, the
`service_provider_profiles.service_area` column and the service areas of
their live `mobile_provider_services`. `services/provider_recommendations.py`
reads only what public profiles and listings show, and writes nothing.

- **The match, best first:** a browsable listing (`PUBLISHED` or
  `APPLICATIONS_CLOSED`) in an area served, as owner or manager of its
  property; a public suburb that is one; a state a service names as a whole;
  the provider's own state. A suburb matches only as a whole name.
- **Within a match:** the rating (`public_profiles.trust_of`, counted fully
  from five reviews), then `badges.is_verified`, then the number of
  browsable listings. Ties go by name.
- **Who is read.** The candidates come from queries limited to the areas
  served, the suburbs before the states, so their caps (2,000 properties,
  400 owners) drop the weakest matches first. A suburb is matched loosely
  in the query ("st%ives" finds "St. Ives") and as a whole name after.
  The listing counts are each candidate's whole browsable portfolio.
- **Never listed:** a member whose `privacy.public_profile` is false, one who
  declined the provider's request, staff, tenants and other providers.
- **Never read:** repairs, complaints, tenant profiles, applications,
  contact details and street addresses. Each reason states a fact, such as
  `2 listings on TenantVoice in Glebe, an area your "Bond clean" service
  covers.`, and names where the area comes from: the provider's own suburb
  ("where you are based"), the profile's service area ("an area your
  profile says you serve") or a service.

### Services and categories (R03)

- **Services.** A service is a `mobile_provider_services` row, and the web
  writes it only through the shared functions, run as the provider
  (`user_client`): `mobile_create_provider_service`,
  `mobile_update_provider_service` and `mobile_delete_provider_service`
  (`services/provider_services.py`). So both apps keep one set of rules: the
  status is `active` (the web's live service), `draft` or `archived`; the
  price type `flat`, `hourly` or `from`; the category one of the eight codes
  below; a title of up to 80 characters, a description of up to 1000, a
  price from 0 to 100,000 and an area of up to 200; at most 50 services that
  are not archived; and an `active` service needs a description and a price
  above 0. The functions trim the text and clean the inclusion and exclusion
  lists (`mobile_service_clean_list`: no blanks or repeats, 120 characters,
  20 items). Their refusals answer with their own message: 422 for a value,
  403 for an account that is not an active provider (a suspended one too:
  the functions run as `current_app_user_id()`). Another provider's service,
  or an archived one, is 404. Removing a service archives it, so the
  bookings, invoices and reviews that name it keep it; nothing lists an
  archived service but those.
- **Categories.** `service_provider_profiles.service_categories` holds the
  shared repair codes `PLUMBING`, `ELECTRICAL`, `HVAC`, `APPLIANCE`,
  `LOCKS_SECURITY`, `LEAK`, `SAFETY` and `GENERAL`: `update_own_profile`
  takes only those, and `assign_maintenance_work_order` gives a repair only
  to a provider whose list holds its category. The web category stays in
  `metadata.category`. Choosing one writes its codes
  (`maps_provider_core.WEB_CATEGORY_CODES`):

  | Web category | `service_categories` |
  |---|---|
  | `tradie` | all eight |
  | `property_manager` (property maintenance) | `GENERAL`, `LEAK`, `SAFETY` |
  | `co_host_inspector`, `cleaner`, `real_estate_agent`, `accountant`, `conveyancer`, `photographer`, `other` | `GENERAL` |

  Every list holds `GENERAL`, since `review_user_verification` approves a
  worker only with a category. A row without `metadata.category` (the
  mobile app's) reads as a tradie for any trade code and as other for
  `GENERAL` alone; a row the web wrote before the codes keeps its web
  category. Such a row (`service_categories` `['tradie']`) is never listed
  by `mobile_repair_providers` and `assign_maintenance_work_order` refuses
  it, and a repair the web saved in its own words (`heating_cooling`,
  `other`, ...) finds no provider: `backend/scripts/backfill_shared_codes.py`
  rewrites both once (dry run first, then `--apply`; a second run finds
  nothing). What verification needs does not follow the category:
  `review_profile_document` asks every provider for a government photo
  ID, a trade licence and insurance (see [verification](verification.md)),
  so a new category leaves the account's verification as it is.

### ABN (assumption #5)

| Key | Meaning | Written by | Read by |
|---|---|---|---|
| `service_provider_profiles.metadata.abn` | The provider's ABN, optional, as the ABR prints it: `"51 824 753 556"`. A number sent with `PATCH` or `POST /me/provider` must pass the ABR's checksum (`maps_provider_core.abn_is_valid`), else 422 and nothing saves. A value another app stored is shown as it is and checked only when the provider changes it. Public | `services/service_providers.py` (the provider's own profile) | The provider's profile page, the public provider DTO, invoices (`services/invoices.py`) |

### Pricing (assumption #10)

A service has a fixed price, an hourly rate or a "from" price:
`mobile_provider_services.pricing_type` `flat`, `hourly` or `from`, the only
values its CHECK and the service functions take. A row from before the CHECK
may hold another spelling, so `maps_provider_core.web_pricing_type()` reads
those as one of the three (`FIXED`, `per hour`, `starting from`, ...), an
empty one as `flat` (the column default) and an unknown one as `from`, which
never promises less than may be charged. Every card and
page shows the price through the frontend's `formatServicePrice`: `$129`,
`$85 per hour`, `from $85`; the marketplace card's `price_unit` is `fixed`,
`per hour` or `from`.

### Upload scanning (assumption #22)

`services/uploads.store()` scans every file with ClamAV before storing it
when `CLAMAV_HOST` names a clamd (`CLAMAV_PORT`, default 3310, and
`CLAMAV_TIMEOUT_SECONDS`, default 10): the file goes to clamd's `INSTREAM`
over TCP. An infected file answers 422 and nothing is stored. A scanner that
cannot be reached, does not answer in time or answers an error makes the
upload 503, so while scanning is on nothing unscanned is stored. Without
`CLAMAV_HOST` files are stored unscanned, and `GET /uploads/scanning`
(`enabled`) tells the pages to label the files other people sent
(`docs/demo-features.md`).

| Key | Meaning | Written by | Read by |
|---|---|---|---|
| Storage object metadata `virus_scan` (an object's user metadata, in every bucket the web stores into) | `clean` or `not_scanned`. A clean file also has `virus_scanner` (`clamav`) and `virus_scanned_at` (ISO 8601) | `services/uploads.py` | Nothing yet: Storage keeps it with the file. `store()` also returns it as `virus_scan`, for a row's metadata |

## Rent ledger (R27)

`services/rent_ledger.py` serves the owner's ledger under `/me/rent`
(landlords and agents) and the tenant's rent at `GET /me/rent` (tenants).

- **Charges** are the `ISSUED` `rent_charges` of the owner's `ACTIVE`
  `rent_agreements` (`owner_user_id`, as the table's policy reads it). Only
  `POST /me/rent/agreements/{id}/charges` makes one: it calls
  `generate_upcoming_rent_charges` with the service role for one of the
  owner's active agreements, which adds the next charge due within 7 days
  and nothing when it exists. Reading, refreshing and exporting the ledger
  call no function and write no charge. An ended tenancy drops out of the
  ledger, as it does from `mobile_my_rent_summary`.
- **Receipts** are `rent_payments` rows the owner records on one of those
  charges: `status` `SUCCEEDED` with `verified_at` the moment they record it
  (`successful_payment_requires_verification`), `currency` `AUD`, `provider`
  `OWNER_RECORDED`, never more than is still owing. Every page shows them as
  "Recorded by owner"; nothing says "collected" or "paid online". A
  `STRIPE` row (the mobile app's) shows as a Stripe payment and is not
  corrected here. `idempotency_key` is `web:{owner users.id}:{the form's
  uuid}`: the form keeps one key while it is open, so sending it again
  answers 200 with the receipt it recorded, and the same key with another
  amount or charge is 409. So is sending it again once that receipt was
  withdrawn or corrected (`CANCELLED`): it counts for nothing, so it must
  not read as recorded. When two requests race, the unique key decides.
  Two different forms on one charge at once both read the same amount
  owing: after its insert each request checks the counted receipts in
  order (`created_at`, then id), and the one that goes past the charge is
  set `CANCELLED` with a `rent_payment.cancelled` note and answers 409.
  This is a best-effort guard, not a lock: `created_at` is when an insert
  began, not when it became visible. A receipt whose insert began first
  but committed after the other request had checked ranks first and is
  kept, and so is the other, which never saw it, so the charge is
  overpaid and the owner corrects one. Only the check and insert in one
  transaction under a lock on the charge (a database function, for the
  database owner) closes that.
- **Corrections** set a receipt's `status` to `CANCELLED`, filtered on
  `SUCCEEDED`, with a note; nothing is deleted. A cancelled receipt stays in
  the ledger and no longer counts.
- **Expenses** are owner workspace records: `mobile_owner_assistant_action`
  with the owner's JWT, `p_confirmed` true and the form's request id,
  `create_record` kind `expense`, and `cancel_record` to correct one, as the
  mobile owner tools do. The ledger reads them from
  `owner_assistant_records` (the owner's, on listings of properties they
  own, as `mobile_owner_workspace` shows them).
- **Balances** follow `mobile_my_rent_summary`: counted receipts are
  `SUCCEEDED` and verified; a charge is `PAID` once they cover it, else
  `OVERDUE` once its due date is before today in Sydney, else
  `PARTIALLY_PAID` or `UNPAID`. The tenant's page reads
  `mobile_my_rent_summary` with the tenant's JWT and applies the same rule
  with Sydney's day, where the function uses the database's UTC date.
- **Filters and export.** A listing, a tenant and due dates (inclusive).
  Expenses follow the listing and their own date; with a tenant chosen,
  the expenses of the homes they rent. `GET /me/rent/ledger.csv` and the
  printable `/owner/rent/print` are built from the same ledger as the page,
  so their totals are the page's.

`rent_payments` has no column for when the money arrived, how, its
reference or the notes, so they are the web `audit_log`'s entries. A
receipt whose details failed to save gets them when its form is sent again.

| Key | Meaning | Written by | Read by |
|---|---|---|---|
| `rent_payments.provider` `OWNER_RECORDED` | A receipt the owner recorded on the web, not a payment TenantVoice took. Always set: with a null provider, the `notify_after_verified_rent_payment` trigger would tell both parties a Stripe payment was verified | `services/rent_ledger.py` | `services/rent_ledger.py` |
| `web.audit_log` `rent_payment.recorded` (`entity_type` `rent_payment`, `entity_id` the payment) | `metadata`: `source` (`web`), `charge_id`, `agreement_id`, `amount`, `received_on` (a Sydney day), `method` (`bank_transfer`, `cash`, `cheque`, `card`, `other`), `reference`, `note` | `services/rent_ledger.py` | The ledger, the CSV and the statement |
| `web.audit_log` `rent_payment.cancelled` (the same entity) | A correction: `note`, `amount`, `charge_id`, `from_status`, `to_status` | `services/rent_ledger.py` | The same |
| `web.audit_log` `rent_expense.cancelled` (`entity_type` `owner_assistant_record`) | An expense's correction: `note`, `amount`, `listing_id` | `services/rent_ledger.py` | The same |
| `web.audit_log` `rent_charges.created` (`entity_type` `rent_agreement`) | The owner asked for the next charge: `created` (0 or 1) | `services/rent_ledger.py` | The activity log |
| `owner_assistant_records.payload` of a web expense (kind `expense`) | `amount`, `date` (a Sydney day), `category` (`repairs`, `cleaning`, `insurance`, `council_rates`, `strata`, `utilities`, `agent_fees`, `other`) and `note`; the function adds `currency` | `mobile_owner_assistant_action`, sent by `services/rent_ledger.py` | The ledger |

To confirm with the mobile team: the `OWNER_RECORDED` provider value,
whether the mobile app wants a receipt's details in a place of its own, and
whether ended tenancies should keep their charges in the owner's ledger.

## Dashboards and listing views (R28, R35)

`services/dashboard.py` counts the owner's and the tenant's dashboards from
the rows each figure names, and writes nothing. `services/listing_views.py`
is the only writer of `web.listing_views`.

- **Listing views.** A listing page sends `POST /properties/{id}/views`
  when it opens (`components/rental/ListingViewBeacon.tsx`). A listing
  anyone may open (published, or closed to applications) counts one view
  per viewer per Sydney day: a row of `web.listing_views`, whose unique key
  (listing, day, hash) refuses a second one that day (the answer is then
  `counted: false`). A member counts as their `users.id` on every device; a
  signed-out visitor as the random id their browser keeps
  (`lib/listing-views.ts`, `tv_visitor`), which the request must carry
  (422 without). Only an HMAC-SHA256 of the listing, the day and that id is
  stored, keyed by the day's random salt (`web.listing_view_salts`, one row
  a day), and the day, not the time. The day's first view makes its salt
  and deletes every earlier day's, so once a day is over nothing, the
  service role included, can recompute its hashes: its rows name no one,
  and the same viewer's rows on other listings or days cannot be matched.
  Within the day the salt lets the unique key count a viewer once. No user
  id, IP address or user agent is kept, and the request leaves no
  `audit_log` row. The listing's owner and manager, staff
  (`admin`, `officer`) and a request whose token was refused count nothing.
  Another listing answers 404. Signed-out views count at most
  `VISITOR_VIEWS_PER_WINDOW` (60) per client address in 10 minutes
  (`public.consume_api_rate_limit`, called by the service role, keyed by an
  HMAC of the address under the day's salt, so `api_rate_limits` keeps no
  address); behind a proxy, uvicorn must trust its forwarded headers, as for
  password resets. Even so the counts are a guide, not an audit. The
  dashboard counts each listing's views with one head count; the analytics
  reads a range as rows only up to 5000 views, and past that counts it a
  day at a time, so a flood of views costs a bounded number of requests.
- **The owner's dashboard** (`GET /me/dashboard/owner`, landlords): the
  listings of the properties the owner owns or manages, as My properties
  lists them. Occupancy and `active_lease_count` are the listings with an
  `ACTIVE` `rent_agreements` row (one at most per listing, its unique
  index), so they change only when an agreement is activated or ends, never
  when a listing is marked leased. Active complaints are those the owner's
  Complaints page shows open or under review
  (`complaints.list_complaints_against_me`). Upcoming inspections are the
  accepted `mobile_inspection_bookings` whose slot is still to come (and not
  cancelled) and the `Scheduled` `mobile_inspections` still to come, on the
  owner's listings. Applications leave out the withdrawn and expired, as My
  properties counts them. Reviews are the `PUBLISHED` reviews of the
  owner's homes, rounded as a listing card rounds them; favourites are
  `listing_favorites` rows; views are the last 30 days of
  `web.listing_views`. Each listing has its own row of these figures.
  Until 0005 is applied the views read as `null` with `views_available`
  false (the analytics: `views.available` false), the pages show a dash,
  and the beacon counts nothing; every other figure still answers. The
  owner shell's badges come from `GET /me/dashboard/owner/badges`, which
  reads only what they count.
- **A listing's analytics** (`GET /me/dashboard/owner/properties/{id}?days=7|30|90`,
  the listing's owner or manager, else 404): views day by day over the
  range and of all time, favourites, applications by stage, open-home
  bookings by status and those still to come, published reviews by rating,
  and the active agreement.
- **The tenant's dashboard** (`GET /me/dashboard/tenant`, tenants): the lease
  is their `ACTIVE` rent agreement (the latest to start). Its rent follows
  `mobile_my_rent_summary`: only `ISSUED` charges; a payment counts once it
  is `SUCCEEDED` and verified; the outstanding amount never drops below
  zero; and a charge is `PAID`, `OVERDUE` (due before today), `PARTIALLY_PAID`
  or `UNPAID`. The web compares the due date with Sydney's date, where the
  function uses the database's (UTC) date. The next payment is the first
  such charge not paid. Open repairs are their work orders not yet resolved
  (`maps_rental.repair_is_open`). Upcoming inspections are their accepted
  bookings, and the `Scheduled` inspections at their home or that they
  attend, still to come. The rental history is `mobile_my_rental_history`,
  called as the tenant (`user_client`), followed by the tenancies they
  reported (`tenant_profiles.metadata.rental_history`, as `GET /profiles/me`
  reads it). When the function fails, the dashboard still answers, with
  `rental_history_complete` false.

To confirm with the DB owner: how long views should be kept (nothing removes
old rows yet), and whether a lease should count for occupancy from its
`start_date` rather than from its activation.

## In tests

- Every test's `fake_db` (which `client` also uses) answers like the shared
  database; the fake has no lenient mode left. It fails with PGRST205 for an
  unknown table, 42703 for an unknown column, PGRST204 for an unknown write
  key, 22P02 for a bad enum value or uuid, 23502 for a missing NOT NULL
  value, 23514 outside a web CHECK list, 23505 for a value a key already
  holds, 23503 for a foreign key that points at no row, and PGRST202 for an
  unknown RPC or parameter. Inserts get the real column defaults. The
  `strict_schema` fixture is the same `fake_db`, under the name the area
  ports used while strict answers were opt-in; ask for either.
- The keys are the primary keys of every table, plus the web unique
  constraints and unique indexes (a partial index only compares the rows its
  WHERE fits). The snapshot has no unique constraints for `public` (plan
  Appendix A3 asks for them), so a repeated `users.email`, say, passes in
  the fake.
- Seed rows with the real columns: `fake_db.seed("users", [...])` for
  `public`, `fake_db.seed("bookings", rows, schema="web")` for `web`. A seed
  must include every NOT NULL column without a default, such as `id`, `email`
  and `updated_at` for `users`. Web rows are in
  `fake_db.schema_tables["web"]`.
- Seeds skip the foreign-key check, so a test seeds only the rows it needs,
  but they still fail on a repeated key. What the code inserts or updates is
  checked: seed the rows it points at, such as the client and provider
  `users` rows of a new booking.
- A delete applies the web ON DELETE rules: `cascade` removes the rows that
  point at the deleted one, `set null` clears their key and `restrict` fails
  with 23503. The snapshot has no ON DELETE rules (plan Appendix A4), so
  every public foreign key counts as NO ACTION: deleting a row that a public
  row still points at fails with 23503 too, and its hint says why.
- For RPCs, `fake_db.rpc_results[name]` sets the answer and `fake_db.rpc_calls`
  records what was sent.
- The rental stand-ins (`tests/fake_rpcs/fa_rental.py`) check the status
  triggers and the deferred listing and application consistency before
  they write, and a property's delete applies the catalog's ON DELETE rules
  to the rows it reaches (`delete_rows`).
- Embeds such as `select("*, conversation_participants(user_id)")` resolve
  through foreign keys. As in PostgREST, an embed is one object or null when
  the foreign key is the embedded table's primary key or a unique
  constraint: `users.select("id, service_provider_profiles(company_name)")`
  gives each user one profile or null, not a list. Following a foreign key
  to the row it points at gives an object too; any other embed is a list.
  Where the fake cannot imitate PostgREST (an embed across schemas, or `or_`
  operators other than `eq`, `ilike`, `gt`, `gte`, `lt` and `lte`), it
  raises an AssertionError that says so.
- The fake does not create a `users` row for a new auth user: nothing shows
  that the shared project has such a trigger. Seed one (for example with
  `tests/factories_identity.account()`).
- The browser journeys run the whole app on this fake too
  (`backend/scripts/e2e_server.py`, `docs/e2e.md`), so a query it refuses
  fails a journey as it fails a test.
- `backend/tests/test_table_names.py` reads `app/` and `scripts/` without
  running them: every table a query names, or a select embeds, must be in
  the snapshot or the web schema, also on paths no test runs.
- `backend/tests/test_strict_schema_catches.py` held the defects strict mode
  caught on the shared tables (plan §1.2). The ports fixed all of them, so
  its tests now check the working behaviour. Pin a defect strict mode
  catches later there too, and turn its test around when the fix lands.

## Catalog snapshot

`backend/app/db/shared_catalog.json` holds what the shared database enforces
by itself, from its catalog of 2026-10-23: per `public` table the primary
key, the CHECK constraints (name and expression), the unique constraints and
unique indexes (key columns or expressions, partial `WHERE`), the foreign
keys with their `ON DELETE` and `ON UPDATE` rules, and the triggers; plus
the enums. `app.db.catalog` reads it (`checks()`, `unique_keys()`,
`foreign_keys()`, `triggers()`, `enum_labels()`), as `app.db.schema` reads
the columns. The functions' bodies and the policies stay in
`output/shared-catalog/` (`functions/<name>.sql`, `policys.md`).

**Refreshing it** (read-only; nothing here writes to the project):

1. In the shared project's SQL Editor, set the row limit to "No limit" and
   run `output/sql-to-apply/read_only_catalog.sql`. It reads the catalog
   only, never a row of user data.
2. Export the result (Export, Download CSV) as
   `output/shared-catalog/catalog-<date>.csv`.
3. `cd backend && .venv/bin/python -m scripts.import_shared_catalog ../output/shared-catalog/catalog-<date>.csv`
   rewrites the snapshot, sorted, with the CSV's sha256. It reads the CSV as
   data and executes nothing; a row it cannot read stops it rather than
   dropping a rule.
4. Point `EXPORT` in `backend/tests/test_shared_catalog_snapshot.py` at the
   new file, and run the suite. `test_every_rule_of_the_snapshot_is_enforced`
   (`backend/tests/test_fake_catalog_rules.py`) names any rule the fake
   cannot enforce yet (`tests.fake_supabase.catalog_gaps()`): a CHECK shape
   `tests/fake_sql.py` cannot read, or a trigger with no stand-in in
   `tests/fake_triggers.py`. Teach the fake; never skip the rule.

**In tests.** `CATALOG_RULES` in `backend/tests/conftest.py` turns the
snapshot on for every `fake_db`, and it is on for the whole suite. A test
whose answer rests on one of the rules also sets
`fake_db.catalog_rules = True` itself (before seeding), and the fake's own
tests of what happens without them set it to `False`. A value a CHECK keeps
out today but older rows may hold is put on the stored row after a seed the
CHECK accepts. With it on, on top of the checks listed under In tests:

- a row a CHECK finds false fails with 23514 (NULL passes), on inserts,
  updates and seeds; a value its column's type cannot hold, where a CHECK
  reads it, fails with 22P02;
- the unique constraints and unique indexes of `public` apply (23505):
  `users.email`, `profile_documents (user_id, document_type)`,
  `reviews (property_id, reviewer_user_id)`,
  `listing_favorites (user_id, listing_id)`,
  `rental_applications (listing_id, applicant_user_id)` and the partial and
  expression indexes (one approved application per listing, one active
  agreement per listing, `conversations.metadata->>'maintenanceComplaintId'`).
  Keys compare values as their types hold them (a uuid in any case). A
  unique constraint embeds one to one, as PostgREST reads it
  (`rental_applications` -> `rent_agreements` is an object);
- each foreign key has its real `ON DELETE` rule, so deleting a user
  cascades their notifications and is refused while they own a property,
  and a delete runs the triggers of the rows it cascades to;
- the triggers run, from `tests/fake_triggers.py` (written from the bodies):
  BEFORE ones refuse a write before its checks (P0001 for a plain
  `RAISE EXCEPTION`, else the function's errcode), AFTER ones write (a new
  `users` row's primary `user_role_assignments` row, red flag events and
  their admin notices, the lease and payment notices), and the deferred
  `enforce_listing_application_consistency` runs when the request ends;
- each request is one transaction: a table write, or an RPC with all its
  stand-in's statements. Any error in it, a deferred check's included,
  undoes all its writes. So approving an application by a direct update
  fails (23514) and writes nothing; `review_rental_application`, which
  leases the listing in the same call, passes.
- Seeds run no triggers: seed the rows a trigger would have written (a
  user's primary `user_role_assignments` row) when a test needs them.

**What it settles.** Read from the snapshot and the trigger bodies (to
confirm on the disposable copy):

- `mobile_provider_services.status` is `active`, `draft` or `archived`, so
  `maps_provider_core.SERVICE_LIVE_STATUS` (`published`) is refused;
  `mobile_admin_issue_categories.severity` is `NORMAL`, `HIGH`, `URGENT` or
  `CRITICAL`; `profile_document_deletion_queue.reason` is `REPLACED`,
  `USER_DELETED`, `ACCOUNT_RETENTION` or `ORPHANED`;
- `profile_document_review_events.document_id` is `ON DELETE SET NULL`: a
  reviewed document can be deleted, its review events stay;
- the unique keys asked about above exist (likes, applications, issue
  category codes), so a second insert fails with 23505 at once;
- changing `users.primary_role` fails with 23505 on
  `user_role_assignments_one_primary_per_user_key`:
  `sync_primary_role_assignment` adds the new primary assignment before it
  unmarks the old one.

## Rules

- Never add tables, columns or enum values to `public`. Anything new for the
  web goes into a new `supabase/shared/000N_*.sql`, added to the README's
  apply list. `backend/tests/web_schema.py` builds the web tables from the
  files in its `SCHEMA_FILES` (`0001`, `0004`, `0005` and `0006` today), so
  add a new file that creates a table there too: the strict fake and
  `backend/tests/test_web_schema_sql.py` rely on it, and that test fails
  while a file with a table is missing from the list. Give the file its own
  tests, as `test_housing_portal_sql.py` does for 0006.
- Never point a development backend that writes at the live shared project,
  and never run `supabase/seed.sql` or `supabase/migrations/*` there.
- Demo rows go to a disposable copy only, never to the live project:
  `scripts/seed_provider_demo.py` previews unless given `--apply`, and
  `--apply` refuses the production project unless its ref is typed out
  (`docs/demo-features.md`).
