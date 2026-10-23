-- TenantVoice — tenant scorecards (tracker R43) on the shared Supabase project
-- Run in the SQL Editor of the shared project, after 0001_web_schema.sql (README.md).
--
-- A tenant asks the owner or agent of a home they rent or rented for a
-- scorecard; the owner rates them on the seven items of the Owner/Agent
-- Tenant Scorecard (1 to 5 each) with an optional comment, or declines. Both
-- of them see the result, and the tenant chooses whether it counts on their
-- public profile (tracker assumption #20). The backend's
-- services/scorecards.py is the only writer.
--
-- The table points at shared rows by foreign key (public.users,
-- public.properties, public.rent_agreements, public.rental_applications)
-- and changes nothing in public. RLS is on with no policies, and only the
-- service role is granted it, as for the tables of 0001.
--
-- Safe to re-run: it creates only what is missing and recreates its trigger.
-- One transaction, so a failure leaves nothing half-made.

begin;

-- As in 0001: wait at most 5 s for a lock, then fail and roll back. The
-- foreign keys lock the four shared tables they point at against writes
-- until commit. On a timeout, run again.
set local lock_timeout = '5s';

create table if not exists web.scorecard_requests (
  id                 uuid primary key default gen_random_uuid(),
  tenant_user_id     uuid not null references public.users(id) on delete cascade,
  -- The owner or agent asked: a property's owner or manager, or an agreement's owner.
  owner_user_id      uuid not null references public.users(id) on delete cascade,
  -- What made the tenant one the owner may be asked about: a lease, current
  -- or past, or an application the owner approved. Kept when it goes.
  agreement_id       uuid references public.rent_agreements(id) on delete set null,
  application_id     uuid references public.rental_applications(id) on delete set null,
  property_id        uuid not null references public.properties(id) on delete cascade,
  status             text not null default 'PENDING'
                     check (status in ('PENDING','COMPLETED','DECLINED','CANCELLED')),
  -- The owner's ratings once completed: {"paid_rent_on_time": 5, ...}, one
  -- key per item (docs/shared-db.md, "Scorecards").
  answers            jsonb check (answers is null or jsonb_typeof(answers) = 'object'),
  comment            text check (char_length(comment) <= 1000),
  -- The tenant's choice: whether a completed scorecard counts on their public profile.
  visible_on_profile boolean not null default false,
  requested_at       timestamptz not null default now(),
  completed_at       timestamptz,
  -- When the owner answered or the tenant cancelled. Not updated_at: that
  -- moves too when a linked lease or application goes (set null above).
  decided_at         timestamptz,
  -- Why the owner declined, when they said.
  decided_reason     text check (char_length(decided_reason) <= 500),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (tenant_user_id <> owner_user_id),
  check (status <> 'COMPLETED' or (answers is not null and completed_at is not null))
);

-- decided_at came after the first draft of this file: a table made from
-- that draft gets it here, and running the file again changes nothing.
alter table web.scorecard_requests add column if not exists decided_at timestamptz;

-- One request waiting for an answer per tenant, owner and home; the ones
-- answered or cancelled stay beside it.
create unique index if not exists uq_scorecard_requests_pending on web.scorecard_requests (tenant_user_id, owner_user_id, property_id)
  where status in ('PENDING');
create index if not exists idx_scorecard_requests_tenant on web.scorecard_requests (tenant_user_id, status);
create index if not exists idx_scorecard_requests_owner  on web.scorecard_requests (owner_user_id, status);

drop trigger if exists trg_scorecard_requests_updated on web.scorecard_requests;
create trigger trg_scorecard_requests_updated before update on web.scorecard_requests
  for each row execute function web.set_updated_at();

-- Row-Level Security: on, with no policies.
alter table web.scorecard_requests enable row level security;

-- The service role only. 0001's default privileges cover a table its role
-- creates; this grant does not depend on which role runs this file.
grant all privileges on table web.scorecard_requests to service_role;

-- Let PostgREST see the new table without waiting for its next reload.
notify pgrst, 'reload schema';

commit;
