-- TenantVoice — Row-Level Security
-- Apply AFTER 0001_schema.sql.
--
-- IMPORTANT: the FastAPI backend uses the service-role key, which BYPASSES RLS.
-- These policies are defence-in-depth for any direct anon/authenticated access
-- (rules.md: "RLS policies must be set for every new table"). If the frontend
-- ever queried Supabase directly, these are the rules that would apply.

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER — bypass RLS to avoid policy recursion)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.owns_provider(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.service_providers sp
    where sp.id = p and sp.profile_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS on every table
-- ---------------------------------------------------------------------------
alter table public.profiles               enable row level security;
alter table public.service_providers      enable row level security;
alter table public.verification_documents enable row level security;
alter table public.provider_services      enable row level security;
alter table public.provider_availability  enable row level security;
alter table public.provider_portfolio     enable row level security;
alter table public.bookings               enable row level security;
alter table public.reviews                enable row level security;
alter table public.conversations          enable row level security;
alter table public.messages               enable row level security;
alter table public.transactions           enable row level security;
alter table public.invoices               enable row level security;
alter table public.saved_providers        enable row level security;
alter table public.audit_log              enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (
  id = auth.uid()
  or public.is_admin()
  or id in (select profile_id from public.service_providers where is_published)  -- public sees provider name/avatar
);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- service_providers
-- ---------------------------------------------------------------------------
drop policy if exists sp_select on public.service_providers;
create policy sp_select on public.service_providers for select using (
  is_published or profile_id = auth.uid() or public.is_admin()
);

drop policy if exists sp_insert on public.service_providers;
create policy sp_insert on public.service_providers for insert with check (profile_id = auth.uid());

drop policy if exists sp_update on public.service_providers;
create policy sp_update on public.service_providers for update
  using (profile_id = auth.uid() or public.is_admin())
  with check (profile_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- verification_documents (private to owner + admin)
-- ---------------------------------------------------------------------------
drop policy if exists vdoc_all on public.verification_documents;
create policy vdoc_all on public.verification_documents for all
  using (public.owns_provider(provider_id) or public.is_admin())
  with check (public.owns_provider(provider_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- provider_services (public read active services of published providers)
-- ---------------------------------------------------------------------------
drop policy if exists svc_select on public.provider_services;
create policy svc_select on public.provider_services for select using (
  (is_active and provider_id in (select id from public.service_providers where is_published))
  or public.owns_provider(provider_id)
  or public.is_admin()
);

drop policy if exists svc_write on public.provider_services;
create policy svc_write on public.provider_services for all
  using (public.owns_provider(provider_id) or public.is_admin())
  with check (public.owns_provider(provider_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- provider_availability (public read, owner write)
-- ---------------------------------------------------------------------------
drop policy if exists avail_select on public.provider_availability;
create policy avail_select on public.provider_availability for select using (
  provider_id in (select id from public.service_providers where is_published)
  or public.owns_provider(provider_id) or public.is_admin()
);

drop policy if exists avail_write on public.provider_availability;
create policy avail_write on public.provider_availability for all
  using (public.owns_provider(provider_id) or public.is_admin())
  with check (public.owns_provider(provider_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- provider_portfolio (public read, owner write)
-- ---------------------------------------------------------------------------
drop policy if exists portfolio_select on public.provider_portfolio;
create policy portfolio_select on public.provider_portfolio for select using (
  provider_id in (select id from public.service_providers where is_published)
  or public.owns_provider(provider_id) or public.is_admin()
);

drop policy if exists portfolio_write on public.provider_portfolio;
create policy portfolio_write on public.provider_portfolio for all
  using (public.owns_provider(provider_id) or public.is_admin())
  with check (public.owns_provider(provider_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- bookings (client + provider participants, + admin)
-- ---------------------------------------------------------------------------
drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings for select using (
  client_id = auth.uid() or public.owns_provider(provider_id) or public.is_admin()
);

drop policy if exists bookings_insert on public.bookings;
create policy bookings_insert on public.bookings for insert with check (client_id = auth.uid());

drop policy if exists bookings_update on public.bookings;
create policy bookings_update on public.bookings for update
  using (client_id = auth.uid() or public.owns_provider(provider_id) or public.is_admin())
  with check (client_id = auth.uid() or public.owns_provider(provider_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- reviews (public read; client writes; provider replies; admin all)
-- ---------------------------------------------------------------------------
drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews for select using (true);

drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews for insert with check (client_id = auth.uid());

drop policy if exists reviews_update on public.reviews;
create policy reviews_update on public.reviews for update
  using (client_id = auth.uid() or public.owns_provider(provider_id) or public.is_admin())
  with check (client_id = auth.uid() or public.owns_provider(provider_id) or public.is_admin());

drop policy if exists reviews_delete on public.reviews;
create policy reviews_delete on public.reviews for delete
  using (client_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- conversations (participants + admin)
-- ---------------------------------------------------------------------------
drop policy if exists conv_select on public.conversations;
create policy conv_select on public.conversations for select using (
  client_id = auth.uid() or public.owns_provider(provider_id) or public.is_admin()
);

drop policy if exists conv_insert on public.conversations;
create policy conv_insert on public.conversations for insert with check (
  client_id = auth.uid() or public.owns_provider(provider_id)
);

drop policy if exists conv_update on public.conversations;
create policy conv_update on public.conversations for update
  using (client_id = auth.uid() or public.owns_provider(provider_id) or public.is_admin())
  with check (client_id = auth.uid() or public.owns_provider(provider_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- messages (only conversation participants)
-- ---------------------------------------------------------------------------
drop policy if exists msg_select on public.messages;
create policy msg_select on public.messages for select using (
  conversation_id in (
    select c.id from public.conversations c
    where c.client_id = auth.uid() or public.owns_provider(c.provider_id)
  ) or public.is_admin()
);

drop policy if exists msg_insert on public.messages;
create policy msg_insert on public.messages for insert with check (
  sender_id = auth.uid()
  and conversation_id in (
    select c.id from public.conversations c
    where c.client_id = auth.uid() or public.owns_provider(c.provider_id)
  )
);

drop policy if exists msg_update on public.messages;
create policy msg_update on public.messages for update using (
  conversation_id in (
    select c.id from public.conversations c
    where c.client_id = auth.uid() or public.owns_provider(c.provider_id)
  )
);

-- ---------------------------------------------------------------------------
-- transactions (owner read; writes via backend/admin)
-- ---------------------------------------------------------------------------
drop policy if exists tx_select on public.transactions;
create policy tx_select on public.transactions for select using (
  public.owns_provider(provider_id) or public.is_admin()
);

drop policy if exists tx_write on public.transactions;
create policy tx_write on public.transactions for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- invoices (owner + admin)
-- ---------------------------------------------------------------------------
drop policy if exists inv_select on public.invoices;
create policy inv_select on public.invoices for select using (
  public.owns_provider(provider_id) or public.is_admin()
);

drop policy if exists inv_write on public.invoices;
create policy inv_write on public.invoices for all
  using (public.owns_provider(provider_id) or public.is_admin())
  with check (public.owns_provider(provider_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- saved_providers (private to the user)
-- ---------------------------------------------------------------------------
drop policy if exists saved_all on public.saved_providers;
create policy saved_all on public.saved_providers for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- audit_log (admin reads; authenticated may append)
-- ---------------------------------------------------------------------------
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select using (public.is_admin());

drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log for insert with check (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- Grants (RLS still gates rows; these gate table-level access)
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to anon, authenticated;

-- The backend connects as service_role and expects full access (it enforces
-- authorization in the API layer; RLS is defence-in-depth for direct access).
--
-- A stock Supabase project already grants this via default privileges, so it is
-- normally invisible. Those defaults are owned by the `public` schema, though —
-- `drop schema public cascade` destroys them, and then every backend query
-- fails with "permission denied for table ...". Granting explicitly here means
-- the migrations alone are enough to rebuild a working database from scratch.
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

-- `on all tables` only covers tables that exist right now; later migrations
-- (0003, 0006) create more. Default privileges cover those as they are created.
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
