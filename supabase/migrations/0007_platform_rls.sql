-- TenantVoice — Row-Level Security for the platform reference tables
-- Apply AFTER 0006_platform_schema.sql.
--
-- The FastAPI backend uses the service-role key (bypasses RLS); these policies
-- are defence-in-depth, per docs/rules.md ("RLS policies must be set for every
-- new table").

alter table public.service_categories    enable row level security;
alter table public.connections           enable row level security;
alter table public.subscription_plans    enable row level security;
alter table public.user_subscriptions    enable row level security;
alter table public.faqs                  enable row level security;
alter table public.notifications         enable row level security;
alter table public.property_inspections  enable row level security;
alter table public.platform_settings     enable row level security;

-- ---------------------------------------------------------------------------
-- Reference data: world-readable, admin-writable
-- ---------------------------------------------------------------------------
drop policy if exists categories_select on public.service_categories;
create policy categories_select on public.service_categories for select using (true);

drop policy if exists categories_write on public.service_categories;
create policy categories_write on public.service_categories for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists plans_select on public.subscription_plans;
create policy plans_select on public.subscription_plans for select using (true);

drop policy if exists plans_write on public.subscription_plans;
create policy plans_write on public.subscription_plans for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists faqs_select on public.faqs;
create policy faqs_select on public.faqs for select using (true);

drop policy if exists faqs_write on public.faqs;
create policy faqs_write on public.faqs for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists settings_select on public.platform_settings;
create policy settings_select on public.platform_settings for select using (true);

drop policy if exists settings_write on public.platform_settings;
create policy settings_write on public.platform_settings for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- connections (either side of the request, or admin)
-- ---------------------------------------------------------------------------
drop policy if exists connections_select on public.connections;
create policy connections_select on public.connections for select using (
  requester_id = auth.uid() or addressee_id = auth.uid() or public.is_admin()
);

drop policy if exists connections_insert on public.connections;
create policy connections_insert on public.connections for insert
  with check (requester_id = auth.uid());

drop policy if exists connections_update on public.connections;
create policy connections_update on public.connections for update
  using (addressee_id = auth.uid() or public.is_admin())
  with check (addressee_id = auth.uid() or public.is_admin());

drop policy if exists connections_delete on public.connections;
create policy connections_delete on public.connections for delete
  using (requester_id = auth.uid() or addressee_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- user_subscriptions (own row only)
-- ---------------------------------------------------------------------------
drop policy if exists subscriptions_all on public.user_subscriptions;
create policy subscriptions_all on public.user_subscriptions for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- notifications (own feed only)
-- ---------------------------------------------------------------------------
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete
  using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- property_inspections (public for listed properties; owner writes)
-- ---------------------------------------------------------------------------
drop policy if exists inspections_select on public.property_inspections;
create policy inspections_select on public.property_inspections for select using (
  exists (
    select 1 from public.properties p
    where p.id = property_id and (p.status = 'available' or p.owner_id = auth.uid())
  )
  or public.is_admin()
);

drop policy if exists inspections_write on public.property_inspections;
create policy inspections_write on public.property_inspections for all
  using (public.owns_property(property_id) or public.is_admin())
  with check (public.owns_property(property_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- Grants (RLS still gates rows; these gate table-level access)
-- ---------------------------------------------------------------------------
grant select on
  public.service_categories,
  public.subscription_plans,
  public.faqs,
  public.platform_settings,
  public.property_inspections
to anon, authenticated;

grant select on public.connections, public.user_subscriptions, public.notifications to authenticated;
grant insert, update, delete on public.connections, public.user_subscriptions to authenticated;
grant update, delete on public.notifications to authenticated;
grant insert, update, delete on public.property_inspections to authenticated;
