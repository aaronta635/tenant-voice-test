-- TenantVoice — listing views (tracker R28) on the shared Supabase project
-- Run in the SQL Editor of the shared project, after 0001_web_schema.sql (README.md).
--
-- A listing page sends a beacon when it opens (POST /properties/{id}/views),
-- and the owner's dashboard and listing analytics count the views. Each
-- viewer counts once per listing and Sydney calendar day: one row each, and
-- the unique key below turns a second visit that day into no new row. The
-- backend's services/listing_views.py is the only writer.
--
-- Nothing personal is kept: no user id, IP address, user agent, cookie or
-- time of day. A row holds the listing, the day and a keyed hash
-- (HMAC-SHA256) of the listing, the day and the viewer. The key is the
-- day's random salt in web.listing_view_salts: the day's first view makes
-- it and deletes every earlier day's, so once a day is over its rows name
-- no one and the same viewer's rows on other listings or days cannot be
-- matched, not even by the service role.
--
-- The table points at public.listings by foreign key and changes nothing in
-- public. RLS is on with no policies, and only the service role is granted
-- it, as for the tables of 0001.
--
-- Safe to re-run: it creates only what is missing. One transaction, so a
-- failure leaves nothing half-made.

begin;

-- As in 0001: wait at most 5 s for a lock, then fail and roll back. The
-- foreign key locks public.listings against writes until commit. On a
-- timeout, run again.
set local lock_timeout = '5s';

create table if not exists web.listing_views (
  id           uuid primary key default gen_random_uuid(),
  -- A listing that goes takes its views with it.
  listing_id   uuid not null references public.listings(id) on delete cascade,
  -- The day of the view in Sydney: the marketplace is NSW-only.
  viewed_on    date not null,
  -- The keyed hash of the listing, the day and the viewer, as 64 hex digits.
  visitor_hash text not null check (visitor_hash ~ '^[0-9a-f]{64}$'),
  -- One view per viewer, listing and day. It also serves the reads, which
  -- ask for listings' views from a day on.
  unique (listing_id, viewed_on, visitor_hash)
);

-- The key of the day's hashes: 32 random bytes as 64 hex digits, one row
-- per Sydney day. Only today's is kept.
create table if not exists web.listing_view_salts (
  viewed_on date primary key,
  salt      text not null check (salt ~ '^[0-9a-f]{64}$')
);

-- Row-Level Security: on, with no policies.
alter table web.listing_views enable row level security;
alter table web.listing_view_salts enable row level security;

-- The service role only. 0001's default privileges cover a table its role
-- creates; these grants do not depend on which role runs this file.
grant all privileges on table web.listing_view_salts to service_role;
grant all privileges on table web.listing_views to service_role;

-- Let PostgREST see the new tables without waiting for its next reload.
notify pgrst, 'reload schema';

commit;
