-- TenantVoice — Row-Level Security for the Owner/Property domain
-- Apply AFTER 0003_properties_schema.sql.
--
-- IMPORTANT: the FastAPI backend uses the service-role key, which BYPASSES RLS.
-- These policies are defence-in-depth for any direct anon/authenticated access
-- (rules.md: "RLS policies must be set for every new table").

-- ---------------------------------------------------------------------------
-- Helper (SECURITY DEFINER — bypasses RLS to avoid policy recursion).
-- Mirrors public.owns_provider() in 0002_rls.sql.
-- ---------------------------------------------------------------------------
create or replace function public.owns_property(p uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.properties pr
    where pr.id = p and pr.owner_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
alter table public.properties            enable row level security;
alter table public.property_applications enable row level security;

-- ---------------------------------------------------------------------------
-- properties (public reads available listings; owner writes)
-- ---------------------------------------------------------------------------
drop policy if exists properties_select on public.properties;
create policy properties_select on public.properties for select using (
  status = 'available' or owner_id = auth.uid() or public.is_admin()
);

drop policy if exists properties_insert on public.properties;
create policy properties_insert on public.properties for insert with check (owner_id = auth.uid());

drop policy if exists properties_update on public.properties;
create policy properties_update on public.properties for update
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

drop policy if exists properties_delete on public.properties;
create policy properties_delete on public.properties for delete
  using (owner_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- property_applications (applicant + property owner + admin)
-- ---------------------------------------------------------------------------
drop policy if exists applications_select on public.property_applications;
create policy applications_select on public.property_applications for select using (
  tenant_id = auth.uid() or public.owns_property(property_id) or public.is_admin()
);

drop policy if exists applications_insert on public.property_applications;
create policy applications_insert on public.property_applications for insert
  with check (tenant_id = auth.uid());

drop policy if exists applications_update on public.property_applications;
create policy applications_update on public.property_applications for update
  using (tenant_id = auth.uid() or public.owns_property(property_id) or public.is_admin())
  with check (tenant_id = auth.uid() or public.owns_property(property_id) or public.is_admin());

drop policy if exists applications_delete on public.property_applications;
create policy applications_delete on public.property_applications for delete
  using (tenant_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- Grants (RLS still gates rows; these gate table-level access)
-- ---------------------------------------------------------------------------
grant select on public.properties, public.property_applications to anon, authenticated;
grant insert, update, delete on public.properties, public.property_applications to authenticated;
