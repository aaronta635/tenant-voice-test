# The `web` schema on the shared Supabase project

The web backend now uses the Supabase project that the mobile app and the
rental web already share. Its `public` schema is managed by Prisma (it has a
`_prisma_migrations` table): a table, column or enum value we add there looks
like drift to the rental web's `prisma migrate dev`, which then offers to reset
the database. So the tables that only the web uses live in their own schema,
`web`, which Prisma does not manage. These files create it and change nothing
in `public`.

The six files are the complete set, applied in this order. Row 3 is a
dashboard setting, not a file; the Apply steps below give every click.

| Order | File | What it does | Needs |
|---|---|---|---|
| 1 | `0001_web_schema.sql` | Creates the `web` schema and its 12 tables: `bookings`, `invoices`, `transactions`, `provider_availability`, `provider_portfolio`, `saved_providers`, `audit_log`, `service_categories`, `faqs`, `platform_settings`, `subscription_plans`, `user_subscriptions`. Also their indexes, `updated_at` triggers, RLS and grants. | — |
| 2 | `0002_web_seed.sql` | Adds the catalogue rows: 9 service categories, 5 subscription plans, 9 FAQs and 3 platform settings. | 1 |
| 3 | *Data API setting* | Adds `web` to the exposed schemas, so PostgREST serves it. | 1 |
| 4 | `0003_storage.sql` | Creates the private Storage bucket `message-attachments` for the files people attach to messages: 5 MB; PNG, JPEG, GIF, WebP and PDF. A bucket of its own keeps chat files apart from the identity documents in `profile-documents` (the file says why). | — |
| 5 | `0004_scorecards.sql` | Creates `scorecard_requests`, the tenant scorecards (R43): a tenant's request to an owner or agent, its status, the owner's seven ratings and comment, and whether it shows on the tenant's public profile. One pending request per tenant, owner and home (a partial unique index). Its `updated_at` trigger, RLS and grant. | 1 |
| 6 | `0005_listing_views.sql` | Creates `listing_views`, the views of each listing for the owner's dashboard and analytics (R28): one row per viewer, listing and Sydney day (a unique key), holding only a hash of the viewer keyed by the day's random salt, and `listing_view_salts`, which keeps only today's salt. Their RLS and grants. | 1 |
| 7 | `0006_housing_portal.sql` | Creates `web.datapoint_requests`, the data category requests Housing Portal officers send the admins (tracker R41), with its indexes, `updated_at` trigger, RLS and grant. | 1 |

Nothing else needs applying. Every table the backend queries is a shared
table or one of these 16 (`backend/tests/test_table_names.py` checks the code
against both), and of the Storage buckets it uses, `profile-documents` and
`property-images` already exist in the shared project and
`message-attachments` comes from 0003.

The web tables point at shared rows by foreign key (`public.users`,
`public.mobile_provider_services`, `public.conversations`, `public.reviews`,
and for the scorecards `public.properties`, `public.rent_agreements` and
`public.rental_applications`, and for the listing views `public.listings`)
and never change them. RLS is on with no policies, and only `service_role`
is granted the schema, so the anon and authenticated keys cannot read it.

Do not run `../migrations/*` or `../seed.sql` on the shared project: they
are for the old web-only project, and `seed.sql` writes demo users.

## Apply

1. In the Supabase dashboard, open the shared project, then **SQL Editor** →
   **New query**.
2. Paste the whole of `0001_web_schema.sql` and click **Run**. The editor
   may ask you to confirm a destructive operation: the file drops and
   recreates its own `updated_at` triggers, so confirm. Expect "Success. No
   rows returned".
3. Open a new query, paste the whole of `0002_web_seed.sql` and click **Run**.
4. Go to **Project Settings** → **Data API** (in older dashboards, **API** →
   **Data API settings**). Under **Exposed schemas**, add `web`, keep the
   schemas already listed, and click **Save**. Until then PostgREST does not
   serve the schema, and the backend gets the error PGRST106 for `web`.
5. Open a new query, paste the whole of `0003_storage.sql` and click **Run**.
   It needs no API setting: the backend reaches Storage with the service
   role.
6. Open a new query, paste the whole of `0004_scorecards.sql` and click
   **Run**. As in step 2, confirm when the editor asks about its trigger. It
   needs no new API setting: `web` is exposed already.
7. Open a new query, paste the whole of `0005_listing_views.sql` and click
   **Run**. It needs no new API setting: `web` is exposed already. Until it
   runs, the owner's dashboard and analytics show no view counts and listing
   pages count no views.
8. Open a new query, paste the whole of `0006_housing_portal.sql` and click
   **Run**. Like 0001, it drops and recreates its own `updated_at` trigger,
   so confirm the destructive-operation prompt. The schema is already
   exposed (step 4), and the file tells PostgREST to reload, so the new
   table is served at once.

Each file runs as one transaction, so an error applies nothing. All six are
safe to run again: existing tables and rows are kept as they are, and 0003
puts the bucket's settings back if they were changed.

Each file also waits at most 5 seconds for each lock it needs
(`lock_timeout`), so a busy table makes it fail fast instead of queueing the
mobile app's writes behind it. A lock it already holds stays held until the
file commits, which takes a moment once nothing else is waiting. If it stops
with `canceling statement due to lock timeout` (55P03), another session was
using one of its tables and nothing was applied: just run the file again.

## Check that it worked

Run this in the SQL Editor:

```sql
select
  (select count(*) from information_schema.tables where table_schema = 'web') as tables,       -- 16 (12 before 0004 to 0006)
  (select count(*) from pg_class where relnamespace = 'web'::regnamespace
     and relkind = 'r' and relrowsecurity) as tables_with_rls,                                 -- 16 (12 before 0004 to 0006)
  (select count(*) from web.service_categories) as categories,                                 -- 9
  (select count(*) from web.subscription_plans) as plans,                                      -- 5
  (select count(*) from web.faqs) as faqs,                                                     -- 9
  (select count(*) from web.platform_settings) as settings;                                    -- 3
```

Then check step 4 from a terminal. Use the project's `service_role` key
(**Project Settings** → **API Keys**; the backend's
`SUPABASE_SERVICE_ROLE_KEY`) as both the `apikey` and the bearer token, and
the project ref from the project URL. Keep the key private: it bypasses RLS.

```sh
curl "https://<project-ref>.supabase.co/rest/v1/faqs?select=question&limit=1" \
  -H "apikey: <service-role key>" \
  -H "Authorization: Bearer <service-role key>" \
  -H "Accept-Profile: web"
```

- **Expected:** a JSON array with one row, such as
  `[{"question":"How do I create a property listing?"}]`.
  `Accept-Profile: web` is the header the backend's `web_table()` sends.
- **`"code":"PGRST106"`:** the schema is not exposed yet. Redo step 4.
- **`"code":"42501"` (`permission denied for schema web`)** when you send
  the anon key instead: that is expected. Only `service_role` is granted
  the schema.

For step 5, run this in the SQL Editor:

```sql
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'message-attachments';
-- one row: false, 5242880, {image/png,image/jpeg,image/gif,image/webp,application/pdf}
```

For step 6, run this in the SQL Editor:

```sql
select
  (select relrowsecurity from pg_class where oid = 'web.scorecard_requests'::regclass) as rls,  -- true
  (select count(*) from pg_indexes where schemaname = 'web' and tablename = 'scorecard_requests'
     and indexname = 'uq_scorecard_requests_pending') as pending_index,                        -- 1
  has_table_privilege('service_role', 'web.scorecard_requests', 'insert') as service_role_writes, -- true
  (select count(*) from information_schema.columns where table_schema = 'web'
     and table_name = 'scorecard_requests' and column_name = 'decided_at') as decided_at;          -- 1
```

For step 7, run this in the SQL Editor:

```sql
select
  (select relrowsecurity from pg_class where oid = 'web.listing_views'::regclass) as rls,     -- true
  (select relrowsecurity from pg_class where oid = 'web.listing_view_salts'::regclass) as salts_rls, -- true
  (select count(*) from pg_constraint where conrelid = 'web.listing_views'::regclass
     and contype = 'u') as one_view_a_day_key,                                                -- 1
  has_table_privilege('service_role', 'web.listing_views', 'insert') as service_role_writes;  -- true
```

For step 8, run this in the SQL Editor:

```sql
select
  (select count(*) from information_schema.tables
     where table_schema = 'web' and table_name = 'datapoint_requests') as housing_table,      -- 1
  (select relrowsecurity from pg_class where oid = 'web.datapoint_requests'::regclass) as rls; -- true
```

## Undo

```sql
drop schema web cascade;
```

Then remove `web` from **Exposed schemas**. This deletes every web table and
row (bookings, invoices, audit entries and the rest) and nothing in `public`.

To undo only 0004, which deletes every scorecard request and the ratings
owners gave, and nothing in `public`:

```sql
drop table if exists web.scorecard_requests;
```

To undo only 0005, which deletes every listing view counted so far, and
nothing in `public`:

```sql
drop table if exists web.listing_views;
drop table if exists web.listing_view_salts;
```

To undo 0006 alone (the officers' data category requests and nothing else):

```sql
drop table if exists web.datapoint_requests;
```

To remove the chat bucket, open **Storage**, empty `message-attachments`,
then delete it. Do it there rather than with SQL, so the files go and not
only their rows. Messages that had attachments keep keys that then point at
nothing: the web shows them without the file.

## For backend developers

`docs/shared-db.md` lists the helpers, the test fixture and the files that
area ports use with this schema.
