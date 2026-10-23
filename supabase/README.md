# TenantVoice — Supabase

Database schema, Row-Level Security, and demo data.
The FastAPI backend (`../backend`) is the only client of this database.

> **On the shared Supabase project** (the one the mobile app and the rental
> web use), run only [`shared/`](shared/README.md). Never run the migrations,
> `seed.sql` or the reset below there: they are for the old web-only project.

## Files

| File | Purpose |
|---|---|
| `migrations/0001_schema.sql` | Service Provider domain: extensions, enums, tables, indexes, triggers |
| `migrations/0002_rls.sql` | Helper functions, RLS policies, grants (incl. `service_role`) |
| `migrations/0003_properties_schema.sql` | Owner/Property domain: `properties`, `property_applications` |
| `migrations/0004_properties_rls.sql` | RLS for the property tables |
| `migrations/0005_messaging.sql` | Extends `conversations` for rental (tenant↔owner) threads |
| `migrations/0006_platform_schema.sql` | `service_categories`, `connections`, `subscription_plans`, `user_subscriptions`, `faqs`, `notifications`, `property_inspections`, `platform_settings` |
| `migrations/0007_platform_rls.sql` | RLS for the platform tables |
| `seed.sql` | Base demo accounts and data |
| `../backend/scripts/seed_provider_demo.py` | Additive Service Provider walkthrough data for Amelia |

**Apply order:** `0001` → `0002` → `0003` → `0004` → `0005` → `0006` → `0007` → `seed.sql`.

Run them in order and in full. Every table uses `create table if not exists`, so
running them against a database that already holds an older schema will *silently
skip* the stale tables and leave you with a half-migrated mix. If in doubt, reset
(below) rather than re-running over the top.

## Applying

### Local (Supabase CLI)
```bash
supabase start
supabase db reset      # runs migrations/ in order, then seed.sql
```

### Hosted project (SQL Editor)
Paste and run each migration in the order above, then `seed.sql`. On a hosted
project the raw `auth.users` inserts in `seed.sql` do work when run from the SQL
editor (it runs as a superuser role).

### Resetting a hosted project

When the database has drifted, wipe it and rebuild from the migrations:

```sql
-- DESTRUCTIVE — drops all application data.
drop schema public cascade;
create schema public;
delete from auth.users;
```

Then run `0001` → `0007` → `seed.sql`.

> `drop schema public cascade` also destroys the **default privileges** Supabase
> normally sets up for the `service_role`. `0002_rls.sql` re-grants them
> explicitly, which is why the migrations must be run in full after a reset —
> otherwise every backend query fails with `permission denied for table ...`.

## Service Provider walkthrough

After the base seed has been applied, add a fuller dataset for the existing
**Amelia / Whitlock Property** account:

```bash
cd backend
.venv/bin/python -m scripts.seed_provider_demo             # preview only
.venv/bin/python -m scripts.seed_provider_demo --apply     # insert missing rows
```

Uses the backend's existing `.env` connection. Point it at a disposable copy of the
shared project: demo rows must never be written to the live one, where the mobile
app shows them at once (`docs/demo-features.md`). It validates the fixed demo account
IDs/names and Amelia's `@demo.test` identity before writing. It adds 24 bookings (18 completed),
9 reviews, 6 conversations, invoice/payment/fee records, and demo network activity.
Only the fictional accounts from `seed.sql` participate. No real payments or email
are sent. The provider workspace and public profile, and the workspaces of the
demo landlords and tenants, display a **Demo** notice.

Login: **Provider** → `amelia@demo.test` / `password123` (unless the demo password
has since been changed). Public profile: `/providers/amelia-whitlock`.

Dates are relative to the first run; use `--date YYYY-MM-DD` to choose the anchor.
IDs are stable across runs: rerunning skips existing records and preserves changes
made during a walkthrough. It does not move existing bookings to new dates or
reset the database. To refresh dates later, reschedule the demo bookings in the UI.

## Schema overview

24 tables across three domains.

**Service Provider (0001):** `profiles` → `service_providers` →
(`verification_documents`, `provider_services`, `provider_availability`,
`provider_portfolio`) · `bookings` · `reviews` · `conversations` → `messages` ·
`transactions` · `invoices` · `saved_providers` · `audit_log`

**Owner/Property (0003):** `properties` → `property_applications`

**Platform (0006):** `service_categories` · `connections` · `subscription_plans` ·
`user_subscriptions` · `faqs` · `notifications` · `property_inspections` ·
`platform_settings`

**Enums:** `user_role`, `service_provider_category`, `verification_type`,
`verification_status`, `pricing_type`, `booking_status`, `transaction_type`,
`invoice_status`, `property_status`, `application_status`.

Note the provider category enum is `service_provider_category`. If your database
reports a type named `provider_category`, it predates these migrations — reset it.

**Automatic behaviour (triggers):**
- `updated_at` refreshed on update (profiles, service_providers, provider_services, bookings)
- `service_providers.rating_avg` / `review_count` recomputed on any review change
- `conversations.last_message_at` bumped on new message
- new `auth.users` row → `public.profiles` row (`handle_new_user`, reads `full_name` + `role` from signup metadata)

## Security notes

- The backend uses the **service-role key**, which **bypasses RLS**. Policies in
  `0002_rls.sql` are defence-in-depth for any direct anon/authenticated access.
- Never put the service-role key in the frontend. The frontend talks to FastAPI,
  which talks to Supabase.
- **All schema changes go through a new migration file in a PR** — do not edit an
  already-applied migration.
