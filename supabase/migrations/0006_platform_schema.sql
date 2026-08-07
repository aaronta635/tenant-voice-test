-- TenantVoice — platform reference + engagement schema
-- Apply after 0005_messaging.sql.
--
-- Everything the UI used to hard-code as mock data now lives here: marketplace
-- categories, provider presentation fields, connections/network, subscription
-- plans, FAQs, notifications, inspection times and platform settings.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type connection_status as enum ('pending','accepted','declined');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_status as enum ('active','cancelled','expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_category as enum (
    'message','booking','application','review','property','account','system'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Marketplace categories (was providers-data.ts CATEGORIES + a Python list)
-- ---------------------------------------------------------------------------
create table if not exists public.service_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,                       -- URL slug: 'co-host-inspector'
  category    service_provider_category not null unique,  -- enum value: 'co_host_inspector'
  name        text not null,
  description text not null,
  icon_bg     text,
  badge       text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Public presentation fields for a provider (was PROVIDERS mock rows)
-- ---------------------------------------------------------------------------
alter table public.service_providers
  add column if not exists slug              text,
  add column if not exists badge_label       text,
  add column if not exists headline          text,
  add column if not exists specialties       text[],
  add column if not exists gallery_urls      text[],
  add column if not exists response_time     text,
  add column if not exists availability_note text,
  add column if not exists is_online         boolean not null default false;

create unique index if not exists uq_service_providers_slug
  on public.service_providers (slug) where slug is not null;

-- ---------------------------------------------------------------------------
-- Professional network (owner + tenant "Connections" screens)
-- ---------------------------------------------------------------------------
create table if not exists public.connections (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status       connection_status not null default 'pending',
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id),
  unique (requester_id, addressee_id)
);

create index if not exists idx_connections_requester on public.connections (requester_id, status);
create index if not exists idx_connections_addressee on public.connections (addressee_id, status);

-- ---------------------------------------------------------------------------
-- Subscription plans (owner "Manage Subscription" + tenant access passes)
-- ---------------------------------------------------------------------------
create table if not exists public.subscription_plans (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  audience      user_role not null default 'landlord',
  price         numeric(10,2) not null check (price >= 0),
  billing_period text not null default 'month',
  description   text,
  features      text[] not null default '{}',
  is_popular    boolean not null default false,
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists public.user_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references public.profiles(id) on delete cascade,
  plan_id    uuid not null references public.subscription_plans(id) on delete restrict,
  status     subscription_status not null default 'active',
  started_at timestamptz not null default now(),
  renews_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_user_subscriptions_updated on public.user_subscriptions;
create trigger trg_user_subscriptions_updated before update on public.user_subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Help centre FAQs (was OWNER_FAQS)
-- ---------------------------------------------------------------------------
create table if not exists public.faqs (
  id         uuid primary key default gen_random_uuid(),
  audience   text not null default 'all',   -- 'all' | a user_role value
  question   text not null,
  answer     text not null,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_faqs_audience on public.faqs (audience) where is_active;

-- ---------------------------------------------------------------------------
-- Notifications / recent activity feed
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  category    notification_category not null default 'system',
  title       text not null,
  body        text,
  link_href   text,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists idx_notifications_user on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Property inspection times (was a hard-coded list of three slots)
-- ---------------------------------------------------------------------------
create table if not exists public.property_inspections (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  starts_at   timestamptz not null,
  duration_minutes integer not null default 30,
  capacity    integer,
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists idx_inspections_property on public.property_inspections (property_id, starts_at);

-- ---------------------------------------------------------------------------
-- Platform settings (support contact details, marketing copy, feature toggles)
-- ---------------------------------------------------------------------------
create table if not exists public.platform_settings (
  key         text primary key,
  value       text not null,
  description text,
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_platform_settings_updated on public.platform_settings;
create trigger trg_platform_settings_updated before update on public.platform_settings
  for each row execute function public.set_updated_at();
