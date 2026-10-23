# Verification

How an account becomes verified (tracker R17). The web adds no table.
Documents are the shared `profile_documents` rows (R15), one per type and
person, and the account's state is `users.verification_status` (`PENDING`,
`APPROVED` or `REJECTED`). The shared database's functions decide it, so the
website and the mobile app keep one rule:

- `review_profile_document`: an admin's decision on a document;
- `review_user_verification`: an admin's decision on the account itself.

The web calls both with the service-role client and the admin's `users.id`
(`services/documents.py`, `services/account_verification.py`), and passes
their refusals on: `42501` is 403, `P0002` 404, `23505` 409, `22023` and
`23514` 422, each with the function's own message.

## What verification needs

`review_profile_document` counts an approved document of each type the
account's role requires (`services/verification_rules.py`, `REQUIRED_TYPES`):

| `users.primary_role` | Required types |
|---|---|
| `TENANT` | Passport, driver licence and Medicare card |
| `LANDLORD` | Government photo ID and proof of property ownership |
| `SERVICE_PROVIDER` | Government photo ID, trade licence and public liability insurance, whatever the provider's category |

The functions review no other role: an agent (`AGENT`) and staff have no
requirements, the queue does not list them, and a decision on an agent's
document or account answers 422 (`User role is not reviewable`). A
landlord's and a provider's photo ID counts only as a government photo ID,
so their documents panel offers that type, which takes any government photo
ID, and not the passport or licence types a tenant needs by name.

## The rule

- **A document decision** (`review_profile_document`) decides only a
  `PENDING` document. It sets the review columns (`verified_by_user_id` and
  `verified_at` name the admin and the time, for a rejection too), merges
  `reviewStatus`, `rejectionReason` and `reviewedAt` into its `metadata`,
  writes the `profile_document_review_events` row and notifies the person.
  Then it sets the account: an `APPROVED` account stays `APPROVED`;
  otherwise it is `APPROVED` once every required type has an approved
  document (`approved_by_user_id` is the admin), `REJECTED` while one of
  them is rejected (`rejection_reason` is this decision's reason, or none
  for an approval), else `PENDING`. A landlord's `landlord_profiles` and a
  provider's `service_provider_profiles.verification_status` follow.
- **An account decision** (`review_user_verification`) decides only a
  `PENDING` account; one decided before answers 409 (`Verification request
  already reviewed`). Approving a provider needs a service area and at least
  one category on its `service_provider_profiles` row (422 otherwise). It
  records the admin in `approved_by_user_id`, for a rejection too, sets
  `rejection_reason` for a rejection, keeps the profile row equal and
  notifies the person.
- **The web's reset.** When the person replaces or deletes a document of a
  type their role requires, on the website or the provider credentials
  page, an `APPROVED` or `REJECTED` account goes back to `PENDING`, with
  `approved_by_user_id`, `approved_at` and `rejection_reason` cleared, and
  the landlord's or provider's profile row with it
  (`account_verification.apply_rule`). An upload of a type the person
  already has replaces that document, so it resets too. A new document of a
  type they had not, and any document their role does not require, leaves
  the account as it is. The next decision sets it again. The reset writes
  only while the account is as it was read; a failure is logged and never
  fails the document change.

The verified badge reads `users.verification_status` alone
(`services/badges.py`), and the verification gates (R18) read it again at
each check (`services/gates.py`).

## Admin decisions

The queue at `/admin/verification` (`GET /admin/verification?role=tenant|landlord|provider&status=PENDING|APPROVED|REJECTED`)
groups documents by account. Waiting accounts come oldest submission first,
decided ones newest decision first. Each document carries a link that opens
its file for 5 minutes. The web's `audit_log` records which documents' links
an admin was given (`document.links_signed`).

- **The mobile app's documents.** The documents the mobile app keeps in
  `users.metadata.mobile.verificationDocuments` come with each account,
  read-only, as `mobile_admin_verification_queue` lists them (run as the
  admin, through their token): for accounts not yet approved. A document
  whose `storagePath` is in the owner's folder of `profile-documents`
  (`{users.id}/...`) gets a link for 5 minutes, recorded in
  `document.links_signed` as `mobile_documents`; any other path or link is
  shown without one. An account with such documents waits in the in-review
  tab from when they were sent (`verificationDocumentsUpdatedAt`). When the
  function cannot be read, the queue still lists the website's documents
  and says so (`mobile_unavailable`).
- **A document:** `POST /admin/documents/{id}/decision` with `decision`
  (`APPROVED` or `REJECTED`), a `reason` (required to reject) and
  `expected_updated_at`, the version the admin saw. A document still in
  review that changed since (a new file, a new name) answers 409 and the
  page reloads that account. Otherwise `review_profile_document` decides it,
  and of two admins the second gets 409 (`Document has already been
  reviewed`) and overwrites nothing. Nobody decides their own document, nor
  a closed account's. The web's `audit_log` gets `document.reviewed`.
- **The account:** `POST /admin/users/{id}/verification` with `decision` and
  `reason` (required to reject), through `review_user_verification`. The
  queue offers it while the account is in review (`can_approve`, with
  `approval_note` saying why not). Both admin logs get
  `user.verification_decided`, as a status change gets
  `user.status_changed`. Own, staff and closed accounts are refused.

The functions write the person's notice (category `system`): `Verification
document reviewed` with the decision and the reason, or `Account
verification updated`. The web adds none of its own.

## To confirm

- The functions' notices link to the mobile app's `/admin/profile`, which
  the website does not have: the notification list should send it to the
  person's documents page (`admin_verification.DOCUMENTS_PATH`).
- `review_profile_document` sets the account again from its documents at
  every decision, so an account an admin rejected is approved again by any
  document decision once every required document is approved.
- Agents cannot be verified on the shared functions, and so cannot publish
  through `transition_listing_status`, which needs an approved `LANDLORD`.
- `upsert_profile_document` and `replace_profile_document` keep
  `review_status` on a new file (the latter is for tenants only), so the
  web writes its own rows: a new file is `PENDING` again, which
  `review_profile_document` needs to decide it.
- A landlord's or provider's passport or licence saved before this rule
  does not count, and no new one is uploaded; one they hold still shows in
  their documents panel, marked as no longer counting, to open, replace or
  delete (`verification_rules.EARLIER_DOCUMENT_TYPES`). Admins still see it
  on the account page.
