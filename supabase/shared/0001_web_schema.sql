-- TenantVoice — the web backend's own tables on the shared Supabase project
-- Run in the SQL Editor of the shared project, then 0002_web_seed.sql (README.md).
--
-- The shared public schema is managed by Prisma (public._prisma_migrations):
-- a table, column or enum value added there looks like drift to the rental
-- web's `prisma migrate dev`. Tables only the web uses therefore live in their
-- own schema, "web", which Prisma does not manage. Nothing in public changes.
--
-- The tables keep the names and columns the backend used on the old project
-- (supabase/migrations/0001-0010), so its queries barely change, except:
--   * every person or provider is a public.users(id); a provider's id is its
--     users.id (= service_provider_profiles.user_id);
--   * a column that had an old enum type is text with a CHECK of its values;
--   * bookings point at their shared thread and review (conversation_id,
--     review_id): the shared conversations and reviews have no booking_id.
--
-- RLS is on with no policies: anon and authenticated get nothing, and only
-- the backend's service role (which bypasses RLS) reads and writes.
--
-- Safe to re-run: it creates only what is missing and recreates the
-- triggers. One transaction, so a failure leaves nothing half-made.

begin;

-- Wait at most 5 s for a lock, then fail and roll back. Creating a table
-- with a foreign key locks the shared table it points at (public.users and
-- three more) against writes until commit; waiting behind a busy one would
-- hold up the mobile app's writes to it as well. On a timeout, run again.
set local lock_timeout = '5s';

create schema if not exists web;
comment on schema web is 'TenantVoice web backend tables, from supabase/shared in its repo. Not managed by Prisma.';

-- Keep updated_at fresh, as the old project's public.set_updated_at() did.
create or replace function web.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Catalogue: marketplace categories, plans, FAQs, settings (was 0006)
-- ---------------------------------------------------------------------------
create table if not exists web.service_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,                       -- URL slug: 'co-host-inspector'
  category    text not null unique                        -- web code: 'co_host_inspector'
              check (category in ('co_host_inspector','real_estate_agent','accountant','tradie',
                                  'cleaner','photographer','conveyancer','property_manager','other')),
  name        text not null,
  description text not null,
  icon_bg     text,
  badge       text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists web.subscription_plans (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  name           text not null,
  audience       text not null default 'landlord'
                 check (audience in ('tenant','landlord','service_provider','officer','admin')),
  price          numeric(10,2) not null check (price >= 0),
  billing_period text not null default 'month',
  description    text,
  features       text[] not null default '{}',
  is_popular     boolean not null default false,
  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

create table if not exists web.user_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references public.users(id) on delete cascade,
  plan_id    uuid not null references web.subscription_plans(id) on delete restrict,
  status     text not null default 'active' check (status in ('active','cancelled','expired')),
  started_at timestamptz not null default now(),
  renews_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists web.faqs (
  id         uuid primary key default gen_random_uuid(),
  audience   text not null default 'all',   -- 'all' | a web role
  question   text not null,
  answer     text not null,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (audience, question)               -- the key 0002 skips existing rows by
);

create table if not exists web.platform_settings (
  key         text primary key,
  value       text not null,
  description text,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Provider workspace (was 0001)
-- ---------------------------------------------------------------------------
-- Weekly availability (0 = Sunday .. 6 = Saturday)
create table if not exists web.provider_availability (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references public.users(id) on delete cascade,
  day_of_week  integer not null check (day_of_week between 0 and 6),
  start_time   time not null,
  end_time     time not null,
  is_available boolean not null default true,
  check (end_time > start_time)
);

create table if not exists web.provider_portfolio (
  id          uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.users(id) on delete cascade,
  title       text,
  description text,
  image_url   text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists web.saved_providers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  provider_id uuid not null references public.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (user_id, provider_id)
);

-- ---------------------------------------------------------------------------
-- Bookings and the finance ledger (was 0001)
-- ---------------------------------------------------------------------------
create table if not exists web.bookings (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.users(id) on delete cascade,
  provider_id       uuid not null references public.users(id) on delete cascade,
  service_id        uuid references public.mobile_provider_services(id) on delete set null,
  status            text not null default 'new_enquiry'
                    check (status in ('new_enquiry','confirmed','in_progress','completed','declined','cancelled')),
  property_address  text,
  property_suburb   text,
  scheduled_date    date,
  scheduled_time    time,
  price             numeric(10,2) check (price >= 0),
  notes             text,
  completion_report text,
  conversation_id   uuid references public.conversations(id) on delete set null,
  review_id         uuid references public.reviews(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists web.invoices (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references public.users(id) on delete cascade,
  booking_id   uuid references web.bookings(id) on delete set null,
  number       text not null,
  amount       numeric(10,2) not null check (amount >= 0),
  status       text not null default 'draft' check (status in ('draft','issued','paid','void')),
  issued_at    timestamptz,
  due_date     date,
  document_url text,
  created_at   timestamptz not null default now(),
  unique (provider_id, number)
);

create table if not exists web.transactions (
  id          uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.users(id) on delete cascade,
  booking_id  uuid references web.bookings(id) on delete set null,
  type        text not null check (type in ('payment','refund','platform_fee','payout')),
  amount      numeric(10,2) not null,
  description text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Audit trail: who / what / when (was 0001)
-- ---------------------------------------------------------------------------
create table if not exists web.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.users(id) on delete set null,
  action      text not null,
  entity_type text,
  entity_id   uuid,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_faqs_audience             on web.faqs (audience) where is_active;
create index if not exists idx_availability_provider     on web.provider_availability (provider_id);
create index if not exists idx_portfolio_provider        on web.provider_portfolio (provider_id);
create index if not exists idx_saved_provider            on web.saved_providers (provider_id);
create index if not exists idx_bookings_provider_status  on web.bookings (provider_id, status);
create index if not exists idx_bookings_client           on web.bookings (client_id);
create index if not exists idx_bookings_service          on web.bookings (service_id);
create index if not exists idx_bookings_conversation     on web.bookings (conversation_id) where conversation_id is not null;
-- One booking per review, as the old uq_reviews_booking had it.
create unique index if not exists uq_bookings_review     on web.bookings (review_id) where review_id is not null;
-- These two make the ledger's select-then-insert (services/ledger.py) safe when
-- requests race: one invoice per booking, one payment and one fee per booking.
create unique index if not exists uq_invoices_booking    on web.invoices (booking_id) where booking_id is not null;
create unique index if not exists uq_transactions_booking_type on web.transactions (booking_id, type)
  where booking_id is not null and type in ('payment','platform_fee');
create index if not exists idx_transactions_provider     on web.transactions (provider_id, created_at);
create index if not exists idx_audit_entity              on web.audit_log (entity_type, entity_id);
create index if not exists idx_audit_actor               on web.audit_log (actor_id);
create index if not exists idx_audit_created             on web.audit_log (created_at);

-- ---------------------------------------------------------------------------
-- updated_at triggers (the backend relies on them, as on the old project)
-- ---------------------------------------------------------------------------
drop trigger if exists trg_bookings_updated on web.bookings;
create trigger trg_bookings_updated before update on web.bookings
  for each row execute function web.set_updated_at();

drop trigger if exists trg_user_subscriptions_updated on web.user_subscriptions;
create trigger trg_user_subscriptions_updated before update on web.user_subscriptions
  for each row execute function web.set_updated_at();

drop trigger if exists trg_platform_settings_updated on web.platform_settings;
create trigger trg_platform_settings_updated before update on web.platform_settings
  for each row execute function web.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security: on, with no policies
-- ---------------------------------------------------------------------------
alter table web.service_categories    enable row level security;
alter table web.subscription_plans    enable row level security;
alter table web.user_subscriptions    enable row level security;
alter table web.faqs                  enable row level security;
alter table web.platform_settings     enable row level security;
alter table web.provider_availability enable row level security;
alter table web.provider_portfolio    enable row level security;
alter table web.saved_providers       enable row level security;
alter table web.bookings              enable row level security;
alter table web.invoices              enable row level security;
alter table web.transactions          enable row level security;
alter table web.audit_log             enable row level security;

-- ---------------------------------------------------------------------------
-- Grants: the service role only
-- ---------------------------------------------------------------------------
grant usage on schema web to service_role;
grant all privileges on all tables    in schema web to service_role;
grant all privileges on all sequences in schema web to service_role;
-- Tables a later file adds get the same grants.
alter default privileges in schema web grant all on tables    to service_role;
alter default privileges in schema web grant all on sequences to service_role;

-- Let PostgREST see the new tables without waiting for its next reload.
notify pgrst, 'reload schema';

commit;
