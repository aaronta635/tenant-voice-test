# Demo features and sample data

This page lists every part of the web app that shows sample data or only
works as a demo, so that nothing passes for live (requirements tracker R11,
Aaron step 1). Each entry says where it is, what is simulated, what it would
take to make it real, and the label it carries.

## Rules

- **Label it.** A surface with sample data or a simulated result renders
  `DemoLabel` (`frontend/app/components/demo/DemoLabel.tsx`).
  - Use the `pill` beside the value it marks, or the `notice`, a block with
    a short reason.
  - Both show "Demo" and read "Demo: <reason>" to a screen reader. The
    contrast is AA.
  - The pill keeps its outline in forced-colors mode and prints dark on
    white.
- **List it.** Add the component to [Labelled in the app](#labelled-in-the-app).
  Two tests keep this page and the code together:
  - `frontend/app/components/demo/demo-features-doc.test.ts` fails when a
    component renders a Demo label and this page does not list it, or lists
    a component that no longer renders one.
  - `frontend/app/components/demo/labelled-surfaces.test.tsx` renders every
    such component. It fails when a label is missing, and when a component
    has no render case there.
- **Make it real, then remove it.** The change that makes a feature real
  removes its label, its row here and its render case, and rewrites the
  support chat's help passages that name the component on a `Demo:` line
  (`backend/app/data/help/*.md`):
  `frontend/app/components/support/help-demos.test.ts` fails until it does.
- **No demo rows on the live shared database.** See the next section.

## Demo accounts and sample rows

- **The accounts.** `supabase/seed.sql` creates the fictional accounts:
  - six providers, `a0000000-0000-4000-8000-000000000001` to `…006`;
  - nine tenants, `b0000000-…-000000000001` to `…009`;
  - seven landlords, `c0000000-…-000000000001` to `…007`;
  - one admin, `d0000000-…-000000000001`.

  All of them have `@demo.test` emails. That file is for the old web-only
  project and must never run on the shared one (`supabase/README.md`,
  `docs/shared-db.md`).
- **How the app recognises them.** `frontend/app/lib/demo.ts` matches the
  fixed ids:
  - `isDemoProvider` matches the six providers. It labels the provider
    workspace and public profile.
  - `isDemoAccount` matches all 23 accounts. It labels the landlord and
    tenant workspaces and the admin console.

  `users.id` has no default: whoever creates a user supplies it. So demo
  users recreated on a copy of the shared project can keep these ids
  (migration plan §2.1).
- **The walkthrough rows.** `backend/scripts/seed_provider_demo.py` adds the
  provider walkthrough for Amelia:
  - in `web`: 24 bookings with their invoices, payments and fees;
  - in `public`: threads, messages, reviews, connection requests and
    notifications.

  It runs as a dry run by default: it prints what it would write and writes
  nothing. Only `--apply` writes. It never creates an account and stops
  unless every demo account's `users` row is already there.
- **The browser journeys' dataset.** `backend/scripts/e2e_seed.py` makes the
  accounts and rows the E2E suite runs on (`docs/e2e.md`): ten fictional
  accounts with `@e2e.test` emails, their listings, bookings, threads,
  reviews and documents. They exist only in the memory of the E2E server
  (`backend/scripts/e2e_server.py`), which runs on the tests' fake database
  and refuses to start with a real Supabase project's settings, and are made
  again before every journey. So the app labels none of them: they test it as
  members would use it.
- **Never write demo rows to the live shared database.** The mobile app reads
  the same tables, so it would show them at once (migration plan §4,
  decision 9).
  - Run `--apply` only against a disposable copy of the shared project.
  - The script connects with the backend's `.env` settings. Before adding
    `--apply`, check that `SUPABASE_URL` names the copy, not the live
    project.
  - `--apply` stops before it connects when `SUPABASE_URL` names a protected
    project: the shared production project `bwjhnjzczesjcebcdbdl`
    (`PROTECTED_PROJECT_REFS` in the script), or a ref the
    `PROTECTED_PROJECT_REFS` setting adds (comma-separated; it cannot take
    the production project off the list). Only
    `--allow-protected-project <ref>`, with that project's ref typed out,
    lets it write there. A preview only reads, so it runs anywhere.
  - On the live project, no `users` row may have one of the ids above or a
    `@demo.test` email.

## Labelled in the app

| Surface | Component | What is sample or simulated | To make it real | Label |
|---|---|---|---|---|
| Seeded provider workspace and public profile | `frontend/app/components/provider/DemoNotice.tsx`, shown by `frontend/app/components/provider/ProviderShell.tsx` (every `/dashboard` page) and `frontend/app/components/providers/PublicProviderProfileView.tsx` (`/providers/[slug]`) | The account and its walkthrough bookings, reviews, messages, invoices and earnings | Nothing: walkthrough data stays sample, on a disposable copy only | Notice: "Sample business, bookings, reviews and earnings for a TenantVoice walkthrough." |
| Seeded landlord and tenant workspaces (the `/owner` and `/tenant` pages, not the public pages these shells also wrap) | `frontend/app/components/owner/OwnerShell.tsx`, `frontend/app/components/tenant/TenantShell.tsx` | The account and the walkthrough rows it shares with Amelia | As above | Notice: "Sample account: the people, homes, bookings and messages here are fictional…" |
| Seeded landlord and tenant onboarding | `frontend/app/components/onboarding/OnboardingFrame.tsx` (`/tenant/onboarding`, `/owner/onboarding`, which stand outside the workspace shells) | The account and the details it fills in | As above | Notice, the workspaces' wording |
| Seeded admin console | `frontend/app/components/admin/AdminShell.tsx` (every `/admin` page) | The admin account `d0000000-…-000000000001` | Nothing: a real admin is created by staff on the live project | Notice: "Sample account: this admin is fictional…" |
| Provider finances | `frontend/app/(dashboard)/dashboard/finances/page.tsx` | The whole ledger (`backend/app/services/ledger.py`). Confirming a booking issues an invoice. Completing it records a payment and the 8.5% platform fee, and marks the invoice paid. Payouts are records only. Nothing is charged or transferred | A payment provider takes the client's payment and pays the provider out, and its webhooks write `web.transactions`. Out of capstone scope: `docs/SCOPE.md` excludes money movement | Notice: "Simulated ledger: …" |
| Printable invoice | `frontend/app/components/provider/InvoiceSheet.tsx` (`/dashboard/finances/invoices/[id]`) | "Paid" means the simulated ledger recorded a payment | As the finances, plus real invoice numbering and GST details | Pill beside the status, printed with the invoice |
| Provider overview | `frontend/app/(dashboard)/dashboard/page.tsx` | "Earned this month" adds up simulated payments | As the finances | Notice under the figures |
| Files in the provider inbox | `frontend/app/components/provider/UnscannedFilesNotice.tsx`, above the provider's messages (`/dashboard/messages`) | While no virus scanner is connected (`CLAMAV_HOST` unset, as on every deployment so far), `backend/app/services/uploads.py` stores every upload unscanned: `virus_scan` is `not_scanned` in its object metadata, and `GET /uploads/scanning` answers `enabled: false` | Run clamd and set `CLAMAV_HOST` (and `CLAMAV_PORT`). Uploads are then scanned before they are stored, an infected file is refused, and the notice goes. Files stored before keep `not_scanned` and are no longer labelled | Notice: "Not virus-scanned: files sent in messages are not checked for viruses yet." It also shows when the server cannot say |
| Completing a booking | `frontend/app/components/bookings/BookingList.tsx` | "Mark done" records a payment and a fee in the simulated ledger | As the finances | Notice in the confirm dialog |
| Owner AI chat | `frontend/app/(owner)/owner/help/ai-chat/page.tsx` | The answers are real (R29, `backend/app/services/owner_assistant.py`): the model once a key is configured and the owner is verified, else fixed rules over the same records under an "AI unavailable" pill, which is not a Demo label. Only the replies this page saved before then are sample: they repeat the `mobile_owner_assistant_context` data | Nothing: those replies leave the shared 30-day history | Pill on each of those replies (the history is shared with the mobile assistant, whose replies get none) |
| Owner AI actions | `frontend/app/components/owner/assistant/ActionPreview.tsx` (the owner AI chat's preview of a suggested action) | A confirmed action is a real write (`mobile_owner_assistant_action`, R30). What it records stays partly simulated: a reminder is delivered in the app only, a rent charge or payment is the owner's own record and no money moves, and a door access request is only noted, as no lock is connected | An email and SMS provider, a payment gateway and a smart-lock integration (see "Planned to stay demos") | Pill in the preview: "in-app reminder only; no email or SMS is sent", "recorded by you; TenantVoice does not collect rent" or "door access is not connected; no door is unlocked" |
| Owner help | `frontend/app/(owner)/owner/help/page.tsx` | The support email and phone are the seeded placeholders (`support@tenantvoice.test`, `1800 836 268` in `supabase/shared/0002_web_seed.sql`; `services/content.py` falls back to `support@tenantvoice.test`). The message form mails that address. Its "Chat with AI" card leads to the owner AI chat, which is real (R29) | Real `support_email` and `support_phone` rows in `web.platform_settings` | Notice while the address is on a domain kept for examples or the phone number is a seeded or fallback one (`isSampleEmail`, `isSamplePhone` in `frontend/app/lib/demo.ts`), naming which |
| Contact page | `frontend/app/(public)/contact/page.tsx` | The same placeholder contact | As the owner help | Notice, on the same condition |
| Tenant score | `frontend/app/components/tenant/TenantScreenTemplates.tsx` (`/tenant/scorecard`) | A readiness gauge worked out in the browser. Its profile band is the completion the server works out (R14, as on `/tenant/profile-completion`); the others count applications and accepted connections with fixed weights, and average the scores owners gave the applications. Nothing is saved, and it is not an owner's scorecard | Owners' scorecards are real (R43: the Scorecards card on `/tenant/dashboard`). Show those here, or the server's profile completion, instead of the gauge | Notice |
| Tenant access passes | `frontend/app/components/tenant/TenantScreenTemplates.tsx` (`/tenant/manage-subscription`) | Choosing a pass records an active `web.user_subscriptions` row without payment, and nothing checks the pass | A checkout, and review access that depends on the pass. Out of scope: no money movement | Notice |
| Owner plans | `frontend/app/(owner)/owner/subscription/page.tsx` | Choosing a plan records it without payment. The renewal date is set 30 days ahead and never renews. Listing limits and plan features are not enforced | A checkout, renewals, and plan limits that the listing service enforces | Notice |
| Owner recommendations | `frontend/app/(owner)/owner/recommendations/page.tsx` | The people suggestions: the first 24 public profiles, filtered in the browser. The service providers above them are ranked on the server (R31) | Suggest people from the server too, with reasons | Notice: "The people suggestions below are public profiles filtered on this page…" |
| Tenant recommendations | `frontend/app/(tenant)/tenant/recommendations/page.tsx` | The people suggestions: the first 24 public profiles, filtered in the browser. The homes and landlords above them are real matches from the server (R34), and so are the service providers below them (R31) | Suggest members from saved preferences on the server, as the homes are | Notice: "The people suggestions are public profiles filtered on this page…" |
| Housing Portal tribunal outcomes | `frontend/app/components/housing/TribunalOutcomes.tsx` (on `/housing/complaints`, below the real complaint statuses) | Four fictional NCAT outcomes, in a table with its CSV download. TenantVoice receives no tribunal decisions | An NCAT outcome feed kept in `web.tribunal_outcomes` (a later `supabase/shared/000N_*.sql`) and matched to complaints (R41) | Notice: "Sample tribunal outcomes: TenantVoice receives no NCAT decisions yet…"; pill on each example; the CSV's Source column says "Sample, not a real outcome" |
| Housing surveys | `frontend/app/components/housing/SurveyPrototypeNotice.tsx` (on `/housing/surveys`) | Officers build surveys for real (`regulatory_surveys`, `regulatory_survey_questions`) and move them from Draft to Live to Closed. Going live sends nothing, no answers are collected, and the response count is whatever the row holds: there is no response table | A response table, sending surveys to members with their consent, and collecting the answers (R41) | Notice: "Prototype surveys: no survey is sent to anyone and no answers are collected yet…" |
| Listing import sample | `frontend/app/components/rental/import/SampleImportNotice.tsx`, shown by the import's review and summary on the wizard's first step (`/owner/properties/create`) | realestate.com.au and Domain refuse automatic reading, as do sites that answer 401, 403, 429 or 451 or a bot check, so the import offers a made-up sample listing instead, read by the same rules (`backend/app/services/listing_import.py`, `sample_import`). Links and PDFs that can be read fill the draft for real (`docs/listing-import.md`) | A licensed listings feed or API for those sites. Out of scope: `docs/SCOPE.md` §9 excludes real realestate.com.au and Domain integration | Notice: "Sample import: these details are a made-up listing, not the one you linked…" |

## Shown by components other areas own

These show sample data, or save a choice that changes nothing yet. Their
files belong to other areas, so they carry no Demo label yet; most say in
their own words what does not work. The area that owns each one adds the
label and moves the row to the table above.

| Surface | Component | What is sample or simulated | To make it real |
|---|---|---|---|
| Saved property search | `frontend/app/components/rental/PropertyMarketplace.tsx` (`/properties`, `/tenant/properties`) | "Save search" keeps the filters in this browser only (`tv_saved_property_search`), and nothing reads them back or alerts on them | Saved searches on the account, alerting as the match alerts do (R36), or the button goes |
| Files other people sent, elsewhere | `frontend/app/components/messaging/ConversationsView.tsx` (the tenant and owner inboxes) and `frontend/app/components/admin/VerificationItemCard.tsx` (the documents in `/admin/verification`) | Uploads are stored unscanned while no virus scanner is connected, as above | Render `UnscannedFilesNotice` (or a pill on each file), or connect clamd |
| Demo accounts in lists | `frontend/app/components/providers/ProviderCard.tsx`, `frontend/app/components/public-profiles/`, `frontend/app/components/network/`, `frontend/app/components/tenant/NetworkRecommendations.tsx`, and the admin lists (`frontend/app/components/admin/AdminUsers.tsx`, `frontend/app/components/admin/VerificationItemCard.tsx`, `frontend/app/components/admin/AdminRepairs.tsx`) | Seeded accounts appear in the marketplace, search, public profiles, recommendations and the admin console without a label. Only a provider's own page shows the notice | Nothing to build: add a pill where `isDemoAccount` matches |

## Planned to stay demos

The assumptions table in the requirements tracker (#7, #17 and #18) and the
shared scope ("conceptual or simulated") keep these as demos once they are
built. Each one carries a Demo label then. Rent collection is the
exception: it stays unbuilt, and the rent ledger, which is real, says so in
plain words instead.

| Feature | Where | What stays simulated | Label when built | What would make it real |
|---|---|---|---|---|
| Email and SMS reminders | Owner AI "send a reminder" (R30, labelled above as Owner AI actions); inspection reminders | In-app reminders are real notifications. Nothing is emailed or texted | Pill: "no email or SMS is sent" | An email and SMS provider (custom SMTP, an SMS gateway), with consent and opt-out |
| Rent collection | Owner rent ledger (R27, `/owner/rent`, `/owner/rent/print`, `/tenant/rent`) | Nothing: collecting rent is not built. Owners record receipts by hand, no payment gateway exists, and a receipt never counts as "collected" | No Demo label, as nothing is simulated: the ledger, the statement and the tenant's rent page say in plain words that the owner records receipts and TenantVoice does not collect rent (assumptions #7 and #18) | A payment gateway. Out of capstone scope (`docs/SCOPE.md` §9) |
| External e-signing | Lease signing (R26) | Typed-name signatures with consent text and a document hash are real. The external signing service runs in test mode | Pill: test-mode signing, not legally binding | A production signing account and a legal review |

## Checked, and not demos

- **Tenant and owner profile details** (R14). The tenant profile screens and
  the owner profile, business details and settings save to the account, and
  `/tenant/profile-completion` shows the score the server works out. The
  three reference-scorecard rows say owner scorecards do not count yet:
  `services/profile_completion.py` does not read them (R43).
- **Onboarding** (R19). The tenant and landlord wizards (`/tenant/onboarding`,
  `/owner/onboarding`) save each step to the account and resume at the saved
  step in any browser; the provider wizard saves through the provider
  workspace. `/owner/profile/completion` lists a landlord's setup from the
  saved profile and the verification requirements, without a score: the
  server works one out for renter profiles only.
- **Documents and verification** (R15, R17). The tenant ID screens, the owner
  verification page and the provider credentials upload to private storage,
  one document per type, and admins decide them in `/admin/verification`
  through the shared database's review functions, beside the documents sent
  from the mobile app (read-only). A file name an older build kept in the
  browser is shown once as not uploaded, then dropped.
- **Ratings, the verified seal and the connect button** (R23, R24). They
  read the reviews, `users.verification_status` and `connection_requests`.
- **Property reviews and their photos** (R12, the listing page and
  `/admin/reviews`). A tenant with an approved application reviews a home
  once, with the eight ratings, a written review and up to four photos,
  through the shared database's review function. The listing page shows the
  category averages and the published reviews, with photos only through
  short-lived links for signed-in viewers; reports and admin decisions are
  real.
- **Notification switches** (R36, `/tenant/settings`,
  `/owner/profile/settings`). `notify()` writes no notice of a kind switched
  off. Account alerts cannot be switched off, and the form shows that switch
  on and locked.
- **Tenant matches and match alerts** (R34, R36, `/tenant/recommendations`).
  The homes and landlords come from the tenant's saved preferences on the
  server, with the facts behind each match, and a tenant is alerted to each
  new strong match once, when a listing is published or a save changes
  their preferences (`docs/tenant-matching.md`). The page says when its AI
  ordering is not connected, or needs a verified account, and the rule
  order it falls back to is real.
- **Provider recommendation assistant** (`/dashboard/recommendations`). It
  says when its AI is not connected and falls back to profile matching
  that is real.
- **Support chat** (R37, `frontend/app/components/support/SupportChat.tsx`
  on `/tenant/help-support`, `/owner/help` and `/faqs`). Its answers come
  from the real help pages (`backend/app/data/help/`) and FAQs. Without a
  model key, for an unverified account or when the model fails, it says
  "AI answers are unavailable" and shows the matching help pages
  themselves, which are real too; its daily limit is real. It is separate
  from the owner AI chat (labelled above), and changes nothing.
- **Work opportunities** (`/dashboard/recommendations?view=opportunities`).
  The server ranks real owners and landlords from their public profiles,
  listings, reviews and verification; no model is involved.
- **Provider suggestions** (R31: `/owner/recommendations`, the owner
  dashboard, `/tenant/recommendations`). The server ranks the listed
  providers by where they work, their rating and how their price compares
  with the median for the same kind of price, and each reason is one of those
  figures (`docs/shared-db.md`, "Provider suggestions"); no model is involved.
- **Assigned repairs** (`/dashboard/repairs`). Booking a visit and marking
  the job done write the shared work order and notify the tenant and owner.
  An admin cancels or closes a repair from the console's Repairs page
  (`/admin/repairs`), with a reason the tenant, owner and provider are told.
- **Virus scanning** (assumption #22). With `CLAMAV_HOST` set, every upload
  is scanned by clamd before it is stored, an infected file is refused and
  the Not virus-scanned notice goes (`backend/app/services/uploads.py`).
  Without it, files are stored unscanned and labelled (above).
- **Listing analytics and QR code** (`/owner/properties/[id]/analytics`,
  `/owner/properties/[id]/qr-code`). They show real counts and a real link.
- **Listings and applications** (R25). Owners edit every listing field,
  its photos and its status, and see each application under its listing
  with the applicant's badge, rating, shared details and the documents
  the tenant chose to share, which open through short-lived links. A
  tenant applies with the form filled from their profile, and the
  decision, its note and the history reach them. Likes are saved. Signed
  out, the listing page shows no street address. A listing without
  photos says "No photo yet" wherever its photo would be (the listing
  cards and page, the review wizard, a tenant's applications), as the
  owner pages do, rather than a stock photo
  (`frontend/app/components/rental/NoPhotoYet.tsx`).
- **Inspections** (R13). Tenants book a published time from the listing
  page or the pipeline, and owners publish, cancel and decide times and
  keep inspection records, all through the mobile functions
  (`docs/shared-db.md`, "Inspections").
- **Landing and sign-in figures.** They are counted from the rows on every
  request (`services/content.py`); a provider whose account is suspended or
  closed is not counted as verified. The sign-in page's checks are the
  verification gates' (`services/gates.py`): owners verify their ID and
  ownership before a listing is published, providers their ID and
  insurance before going live. An ABN is optional, so none is promised.
- **Owner scorecards** (R43: the Scorecards card on `/tenant/dashboard`, and
  `/owner/scorecard`). A tenant asks the owner or agent of a home they rent
  or rented; the owner rates the seven items or declines, and each step
  notifies the other side (`web.scorecard_requests`, `docs/shared-db.md`).
  The completed scorecards a tenant chooses show on their public profile as
  an average, and none while "Share my readiness score"
  (`users.metadata.privacy.share_score`, `/tenant/settings`) is off. The
  landlord readiness gauge `/owner/scorecard` showed before is gone.
- **Listing auto-fill** (R32, the first step of `/owner/properties/create`).
  A link the server can read, or a PDF, fills the draft from what it says,
  each field marked found, inferred or missing with its snippet, and only
  the fields the owner keeps (`docs/listing-import.md`). Only the sample a
  refusing site offers is a demo (above).
- **Leases** (R26, `/owner/leases`, `/tenant/leases`). The owner drafts an
  approved application's lease and sends its PDF; the tenant confirms the
  terms and signs; the owner signs and activates it, all through the shared
  lease functions and tables (`docs/shared-db.md`). The rental pipeline's
  lease and move-in steps show that lease and move on only when it does.
  Signatures are typed names with consent text and the PDF's SHA-256, and
  the pages say TenantVoice is not a certified e-signature service.
- **Rent ledger** (R27, `/owner/rent`, `/owner/rent/print`, `/tenant/rent`).
  Charges, receipts and expenses are real shared rows. A receipt is the
  owner's record of money they received, shown as "Recorded by owner",
  and each page says in plain words that TenantVoice does not collect rent
  or take payments online. Nothing is simulated, so there is no Demo label;
  collecting rent stays out of scope (Rent collection, above).
- **Housing Portal** (R41, `/housing`, officers only). The referrals and
  their actions, the red-flag events and regulatory alerts, the complaint
  statuses, the review and rating figures, the data category requests and
  the de-identified aggregates read and write the shared records, and each
  table's CSV holds what it shows. Only the tribunal outcomes, and the
  sending and answers of the surveys, are demos (above).
