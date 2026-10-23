-- TenantVoice — Maintenance requests
-- Apply after 0009_complaints.sql.
--
-- SCOPE.md Base, both sides of the same record:
--   Tenant   - submit with description, category and photos; track status;
--              message the landlord and the assigned provider.
--   Landlord - view requests on their properties, assign a service provider
--              from the marketplace, and track open -> in progress -> resolved.
--
-- Deliberately NOT a complaint: a maintenance request is routine operational
-- work with an assignee and a fix, whereas a complaint (0009) is a grievance
-- with a resolution and regulatory weight.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type maintenance_category as enum (
    'plumbing','electrical','appliance','heating_cooling','structural',
    'pest','locks_security','grounds','other'
  );
exception when duplicate_object then null; end $$;

-- SCOPE.md names three states; 'cancelled' is the tenant withdrawing a request
-- they no longer need, which otherwise has nowhere to go.
do $$ begin
  create type maintenance_status as enum ('open','in_progress','resolved','cancelled');
exception when duplicate_object then null; end $$;

-- Urgency drives the landlord's queue ordering. NSW treats some repairs as
-- urgent with a faster obligation, so tenants need a way to say so.
do $$ begin
  create type maintenance_priority as enum ('low','normal','urgent');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.maintenance_requests (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties(id) on delete cascade,
  tenant_id     uuid not null references public.profiles(id)   on delete cascade,
  -- Denormalised from the property at creation time so the landlord's queue and
  -- the RLS check stay cheap, and history survives a change of owner.
  owner_id      uuid not null references public.profiles(id)   on delete cascade,
  -- The marketplace provider the owner assigns. Null until then.
  provider_id   uuid references public.service_providers(id)   on delete set null,
  -- Set when the owner books the assigned provider through the marketplace.
  booking_id    uuid references public.bookings(id)            on delete set null,
  category      maintenance_category not null default 'other',
  priority      maintenance_priority not null default 'normal',
  status        maintenance_status   not null default 'open',
  title         text not null,
  description   text not null,
  photo_urls    text[],
  access_notes  text,
  resolution_note text,
  assigned_at   timestamptz,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_maintenance_property on public.maintenance_requests (property_id);
create index if not exists idx_maintenance_tenant   on public.maintenance_requests (tenant_id);
create index if not exists idx_maintenance_owner    on public.maintenance_requests (owner_id, status);
create index if not exists idx_maintenance_provider on public.maintenance_requests (provider_id)
  where provider_id is not null;
-- Landlord dashboards read "open work, most urgent first".
create index if not exists idx_maintenance_queue    on public.maintenance_requests (status, priority, created_at);

drop trigger if exists trg_maintenance_updated on public.maintenance_requests;
create trigger trg_maintenance_updated before update on public.maintenance_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — the three parties to the job, plus admin.
-- ---------------------------------------------------------------------------
alter table public.maintenance_requests enable row level security;

drop policy if exists maintenance_select on public.maintenance_requests;
create policy maintenance_select on public.maintenance_requests for select using (
  tenant_id = auth.uid()
  or owner_id = auth.uid()
  or public.owns_provider(provider_id)
  or public.is_admin()
);

drop policy if exists maintenance_insert on public.maintenance_requests;
create policy maintenance_insert on public.maintenance_requests for insert
  with check (tenant_id = auth.uid());

drop policy if exists maintenance_update on public.maintenance_requests;
create policy maintenance_update on public.maintenance_requests for update
  using (
    tenant_id = auth.uid()
    or owner_id = auth.uid()
    or public.owns_provider(provider_id)
    or public.is_admin()
  )
  with check (
    tenant_id = auth.uid()
    or owner_id = auth.uid()
    or public.owns_provider(provider_id)
    or public.is_admin()
  );

drop policy if exists maintenance_delete on public.maintenance_requests;
create policy maintenance_delete on public.maintenance_requests for delete
  using (tenant_id = auth.uid() or public.is_admin());

grant select on public.maintenance_requests to anon, authenticated;
grant insert, update, delete on public.maintenance_requests to authenticated;
grant all privileges on public.maintenance_requests to service_role;
