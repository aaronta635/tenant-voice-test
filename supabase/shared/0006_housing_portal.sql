-- TenantVoice — the Housing Portal's data category requests on the shared Supabase project
-- Run in the SQL Editor of the shared project after 0001_web_schema.sql (README.md).
--
-- Housing Portal officers (users.primary_role REGULATOR, the web's "officer")
-- ask the TenantVoice admins to change a datapoint the platform records, such
-- as the maintenance or complaint categories, and say why. An admin answers
-- each request: accepted, declined or completed, with a response the officer
-- reads. Only the web backend reads and writes it
-- (backend/app/services/housing_portal.py): the portal's
-- /housing/datapoint-requests and the admin console's
-- /admin/datapoint-requests.
--
-- The people are public.users(id), as everywhere in web. A request outlives
-- the account that made or answered it: the key is cleared, never the row.
--
-- RLS is on with no policies, as for every web table: anon and authenticated
-- get nothing, and only the backend's service role reads and writes. Nothing
-- in public changes.
--
-- Safe to re-run: it creates only what is missing and recreates its trigger.
-- One transaction, so a failure leaves nothing half-made.

begin;

-- As in 0001: wait at most 5 s for a lock, then fail and roll back. The two
-- foreign keys lock public.users against writes until commit; waiting behind
-- a busy users table would hold up the mobile app's writes to it as well. On
-- a timeout, run again.
set local lock_timeout = '5s';

create table if not exists web.datapoint_requests (
  id               uuid primary key default gen_random_uuid(),
  officer_id       uuid references public.users(id) on delete set null,     -- who asked: a REGULATOR
  datapoint        text not null
                   check (datapoint in ('complaint_categories','maintenance_categories','red_flag_rules',
                                        'review_questions','other')),
  requested_change text not null check (char_length(requested_change) between 1 and 1000),
  reason           text not null check (char_length(reason) between 1 and 1000),
  status           text not null default 'pending'
                   check (status in ('pending','accepted','declined','completed')),
  admin_response   text check (char_length(admin_response) <= 1000),
  responded_by     uuid references public.users(id) on delete set null,     -- the admin who answered last
  responded_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- The admin console lists them by status, the portal by officer.
create index if not exists idx_datapoint_requests_status  on web.datapoint_requests (status, created_at);
create index if not exists idx_datapoint_requests_officer on web.datapoint_requests (officer_id);

drop trigger if exists trg_datapoint_requests_updated on web.datapoint_requests;
create trigger trg_datapoint_requests_updated before update on web.datapoint_requests
  for each row execute function web.set_updated_at();

alter table web.datapoint_requests enable row level security;

-- 0001's default privileges grant a table made later by the same role; this
-- grants it whoever runs the file.
grant all privileges on table web.datapoint_requests to service_role;

-- Let PostgREST see the new table without waiting for its next reload.
notify pgrst, 'reload schema';

commit;
