-- TenantVoice — Service Provider schema
-- Target: Supabase (PostgreSQL). Safe to run on a fresh project.
-- The FastAPI backend accesses this DB with the service-role key (which BYPASSES RLS).
-- Row-Level Security policies live in 0002_rls.sql as defence-in-depth.
--
-- Apply order: 0001_schema.sql -> 0002_rls.sql -> seed.sql

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid(), crypt()

-- ---------------------------------------------------------------------------
-- Enums (the "USER-DEFINED" types from the old dump, now explicit)
-- ---------------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('tenant','landlord','service_provider','officer','admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type service_provider_category as enum (
    'co_host_inspector','real_estate_agent','accountant','tradie',
    'cleaner','photographer','conveyancer','property_manager','other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type verification_type as enum ('id','licence','insurance','abn','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type verification_status as enum ('pending','verified','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type pricing_type as enum ('flat','hourly','from');
exception when duplicate_object then null; end $$;

do $$ begin
  create type booking_status as enum (
    'new_enquiry','confirmed','in_progress','completed','declined','cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type transaction_type as enum ('payment','refund','platform_fee','payout');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invoice_status as enum ('draft','issued','paid','void');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Base user, extends Supabase auth.users
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        user_role not null default 'tenant',
  full_name   text not null,
  avatar_url  text,
  phone       text,
  location    text,
  state       text,
  postcode    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Service Provider profile (one per SP user)
create table if not exists public.service_providers (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid not null unique references public.profiles(id) on delete cascade,
  category           service_provider_category not null,
  business_name      text,
  abn                text,
  tagline            text,
  bio                text,
  years_experience   integer,
  languages          text[],
  skills             text[],
  service_radius_km  integer,
  website            text,
  is_published       boolean not null default false,
  profile_completion integer not null default 0 check (profile_completion between 0 and 100),
  rating_avg         numeric(3,2) not null default 0.0,   -- maintained by trigger
  review_count       integer not null default 0,          -- maintained by trigger
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Verification documents (ID, licence, insurance, ABN)
create table if not exists public.verification_documents (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references public.service_providers(id) on delete cascade,
  type         verification_type not null,
  label        text,
  document_url text,
  status       verification_status not null default 'pending',
  verified_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- Fixed-price services offered by a provider
create table if not exists public.provider_services (
  id                  uuid primary key default gen_random_uuid(),
  provider_id         uuid not null references public.service_providers(id) on delete cascade,
  title               text not null,
  description         text,
  pricing_type        pricing_type not null default 'flat',
  price               numeric(10,2) not null check (price >= 0),
  duration_minutes    integer,
  inclusions          text,
  exclusions          text,
  service_area        text,
  cancellation_policy text,
  is_active           boolean not null default true,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Weekly availability (0 = Sunday .. 6 = Saturday)
create table if not exists public.provider_availability (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references public.service_providers(id) on delete cascade,
  day_of_week  integer not null check (day_of_week between 0 and 6),
  start_time   time not null,
  end_time     time not null,
  is_available boolean not null default true,
  check (end_time > start_time)
);

-- Portfolio / work samples (Nice-to-have; table ready)
create table if not exists public.provider_portfolio (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references public.service_providers(id) on delete cascade,
  title        text,
  description  text,
  image_url    text not null,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

-- Bookings / enquiries
create table if not exists public.bookings (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.profiles(id) on delete cascade,
  provider_id       uuid not null references public.service_providers(id) on delete cascade,
  service_id        uuid references public.provider_services(id) on delete set null,
  status            booking_status not null default 'new_enquiry',
  property_address  text,
  property_suburb   text,
  scheduled_date    date,
  scheduled_time    time,
  price             numeric(10,2) check (price >= 0),
  notes             text,
  completion_report text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Reviews (one per booking, enforced by unique index below)
create table if not exists public.reviews (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid references public.bookings(id) on delete set null,
  provider_id    uuid not null references public.service_providers(id) on delete cascade,
  client_id      uuid not null references public.profiles(id) on delete cascade,
  rating         integer not null check (rating between 1 and 5),
  comment        text,
  provider_reply text,
  replied_at     timestamptz,
  is_flagged     boolean not null default false,
  created_at     timestamptz not null default now()
);

-- Conversations between a client and a provider
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.profiles(id) on delete cascade,
  provider_id     uuid not null references public.service_providers(id) on delete cascade,
  booking_id      uuid references public.bookings(id) on delete set null,
  subject         text,
  last_message_at timestamptz,   -- maintained by trigger
  created_at      timestamptz not null default now()
);

-- Individual messages
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade,
  body            text not null,
  attachment_url  text,
  is_read         boolean not null default false,
  created_at      timestamptz not null default now()
);

-- Earnings ledger (mocked totals, real ledger structure)
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.service_providers(id) on delete cascade,
  booking_id  uuid references public.bookings(id) on delete set null,
  type        transaction_type not null,
  amount      numeric(10,2) not null,
  description text,
  created_at  timestamptz not null default now()
);

-- Invoices (Base finance: list + download). Mocked, no real payment.
create table if not exists public.invoices (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references public.service_providers(id) on delete cascade,
  booking_id   uuid references public.bookings(id) on delete set null,
  number       text not null,
  amount       numeric(10,2) not null check (amount >= 0),
  status       invoice_status not null default 'draft',
  issued_at    timestamptz,
  due_date     date,
  document_url text,
  created_at   timestamptz not null default now(),
  unique (provider_id, number)
);

-- Saved / favourite providers (Nice-to-have; table ready)
create table if not exists public.saved_providers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  provider_id uuid not null references public.service_providers(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (user_id, provider_id)
);

-- Audit trail (cross-cutting Base requirement: who / what / when)
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles(id) on delete set null,
  action      text not null,
  entity_type text,
  entity_id   uuid,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_service_providers_category  on public.service_providers (category);
create index if not exists idx_service_providers_published on public.service_providers (is_published) where is_published;
create index if not exists idx_verification_provider       on public.verification_documents (provider_id);
create index if not exists idx_services_provider           on public.provider_services (provider_id);
create index if not exists idx_availability_provider       on public.provider_availability (provider_id);
create index if not exists idx_portfolio_provider          on public.provider_portfolio (provider_id);
create index if not exists idx_bookings_provider_status    on public.bookings (provider_id, status);
create index if not exists idx_bookings_client             on public.bookings (client_id);
create index if not exists idx_reviews_provider            on public.reviews (provider_id);
create unique index if not exists uq_reviews_booking       on public.reviews (booking_id) where booking_id is not null;
create index if not exists idx_conversations_client        on public.conversations (client_id);
create index if not exists idx_conversations_provider      on public.conversations (provider_id);
create index if not exists idx_messages_conversation       on public.messages (conversation_id, created_at);
create index if not exists idx_transactions_provider       on public.transactions (provider_id);
create index if not exists idx_invoices_provider           on public.invoices (provider_id);
create index if not exists idx_saved_user                  on public.saved_providers (user_id);
create index if not exists idx_audit_entity                on public.audit_log (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Triggers & functions
-- ---------------------------------------------------------------------------

-- Keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_providers_updated on public.service_providers;
create trigger trg_providers_updated before update on public.service_providers
  for each row execute function public.set_updated_at();

drop trigger if exists trg_services_updated on public.provider_services;
create trigger trg_services_updated before update on public.provider_services
  for each row execute function public.set_updated_at();

drop trigger if exists trg_bookings_updated on public.bookings;
create trigger trg_bookings_updated before update on public.bookings
  for each row execute function public.set_updated_at();

-- Recompute a provider's rating_avg and review_count on any review change
create or replace function public.recalc_provider_rating()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_provider uuid;
begin
  v_provider := coalesce(new.provider_id, old.provider_id);
  update public.service_providers sp set
    rating_avg   = coalesce((select round(avg(rating)::numeric, 2)
                             from public.reviews r where r.provider_id = v_provider), 0),
    review_count = (select count(*) from public.reviews r where r.provider_id = v_provider)
  where sp.id = v_provider;
  return null;
end $$;

drop trigger if exists trg_reviews_recalc on public.reviews;
create trigger trg_reviews_recalc
  after insert or update or delete on public.reviews
  for each row execute function public.recalc_provider_rating();

-- Bump conversation.last_message_at when a message arrives
create or replace function public.bump_conversation()
returns trigger language plpgsql as $$
begin
  update public.conversations set last_message_at = new.created_at
  where id = new.conversation_id;
  return new;
end $$;

drop trigger if exists trg_messages_bump on public.messages;
create trigger trg_messages_bump after insert on public.messages
  for each row execute function public.bump_conversation();

-- Auto-create a profile row when a new auth user signs up.
-- Reads full_name and role from the signup metadata (raw_user_meta_data).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'tenant'),
    coalesce(new.raw_user_meta_data->>'full_name', new.email)
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
