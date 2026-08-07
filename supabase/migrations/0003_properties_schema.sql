-- TenantVoice — Owner/Property schema
-- Target: Supabase (PostgreSQL). Apply after 0001_schema.sql and 0002_rls.sql.
--
-- The FastAPI backend accesses this DB with the service-role key (which BYPASSES RLS).
-- Row-Level Security policies live in 0004_properties_rls.sql as defence-in-depth.
--
-- Apply order: 0001_schema.sql -> 0002_rls.sql -> 0003_properties_schema.sql -> 0004_properties_rls.sql

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type property_status as enum ('available','rented','off_market');
exception when duplicate_object then null; end $$;

do $$ begin
  create type application_status as enum ('new','reviewing','approved','declined');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- A landlord's property listing
create table if not exists public.properties (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.profiles(id) on delete cascade,
  title          text not null,
  description    text,
  address        text not null,
  suburb         text,
  state          text,
  postcode       text,
  property_type  text,
  bedrooms       integer,
  bathrooms      integer,
  parking        integer,
  price          numeric(10,2) not null check (price >= 0),
  bond           numeric(10,2) check (bond >= 0),
  lease_term     text,
  available_from date,
  amenities      text[],
  photo_urls     text[],
  status         property_status not null default 'available',
  rating_avg     numeric(3,2) not null default 0.0,   -- maintained by trigger once property reviews exist
  review_count   integer not null default 0,          -- maintained by trigger once property reviews exist
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- A tenant's application to rent a property
create table if not exists public.property_applications (
  id             uuid primary key default gen_random_uuid(),
  property_id    uuid not null references public.properties(id) on delete cascade,
  tenant_id      uuid not null references public.profiles(id) on delete cascade,
  status         application_status not null default 'new',
  annual_income  numeric(12,2),
  move_in_date   date,
  rent_offered   numeric(10,2),
  tenant_score   numeric(3,2),
  shortlisted    boolean not null default false,
  has_pets       boolean not null default false,
  message        text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (property_id, tenant_id)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_properties_owner          on public.properties (owner_id);
create index if not exists idx_properties_status          on public.properties (status) where status = 'available';
create index if not exists idx_applications_property      on public.property_applications (property_id);
create index if not exists idx_applications_tenant        on public.property_applications (tenant_id);

-- ---------------------------------------------------------------------------
-- Triggers (reuses public.set_updated_at() from 0001_schema.sql)
-- ---------------------------------------------------------------------------
drop trigger if exists trg_properties_updated on public.properties;
create trigger trg_properties_updated before update on public.properties
  for each row execute function public.set_updated_at();

drop trigger if exists trg_applications_updated on public.property_applications;
create trigger trg_applications_updated before update on public.property_applications
  for each row execute function public.set_updated_at();
