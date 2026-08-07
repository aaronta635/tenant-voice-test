-- TenantVoice — generalised messaging
-- Apply after 0004_properties_rls.sql.
--
-- 0001_schema.sql modelled conversations as client <-> service_provider only.
-- The rental flow also needs tenant <-> owner threads (see docs/messaging-plan.md),
-- so a conversation is now EITHER:
--   * a marketplace thread  (client_id + provider_id), or
--   * a rental thread       (tenant_id + owner_id [+ property_id]).

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column if not exists owner_id    uuid references public.profiles(id)   on delete cascade,
  add column if not exists tenant_id   uuid references public.profiles(id)   on delete cascade,
  add column if not exists property_id uuid references public.properties(id) on delete set null;

-- The marketplace pair becomes optional so rental threads can exist without it.
alter table public.conversations alter column client_id   drop not null;
alter table public.conversations alter column provider_id drop not null;

-- Exactly one of the two shapes must be present.
alter table public.conversations drop constraint if exists conversations_shape_check;
alter table public.conversations add constraint conversations_shape_check check (
  (client_id is not null and provider_id is not null and owner_id is null and tenant_id is null)
  or
  (tenant_id is not null and owner_id is not null and client_id is null and provider_id is null)
);

create index if not exists idx_conversations_owner    on public.conversations (owner_id);
create index if not exists idx_conversations_tenant   on public.conversations (tenant_id);
create index if not exists idx_conversations_property on public.conversations (property_id);

-- One rental thread per (property, tenant) pair; without a property, one per pair.
create unique index if not exists uq_conversations_rental_property
  on public.conversations (property_id, tenant_id)
  where property_id is not null and tenant_id is not null;

create unique index if not exists uq_conversations_rental_pair
  on public.conversations (owner_id, tenant_id)
  where property_id is null and tenant_id is not null;

-- ---------------------------------------------------------------------------
-- RLS — a participant is any of the four columns
-- ---------------------------------------------------------------------------
create or replace function public.in_conversation(c uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.conversations conv
    where conv.id = c
      and (
        conv.client_id = auth.uid()
        or conv.owner_id = auth.uid()
        or conv.tenant_id = auth.uid()
        or public.owns_provider(conv.provider_id)
      )
  );
$$;

drop policy if exists conv_select on public.conversations;
create policy conv_select on public.conversations for select using (
  client_id = auth.uid()
  or owner_id = auth.uid()
  or tenant_id = auth.uid()
  or public.owns_provider(provider_id)
  or public.is_admin()
);

drop policy if exists conv_insert on public.conversations;
create policy conv_insert on public.conversations for insert with check (
  client_id = auth.uid()
  or tenant_id = auth.uid()
  or owner_id = auth.uid()
  or public.owns_provider(provider_id)
);

drop policy if exists conv_update on public.conversations;
create policy conv_update on public.conversations for update
  using (
    client_id = auth.uid()
    or owner_id = auth.uid()
    or tenant_id = auth.uid()
    or public.owns_provider(provider_id)
    or public.is_admin()
  )
  with check (
    client_id = auth.uid()
    or owner_id = auth.uid()
    or tenant_id = auth.uid()
    or public.owns_provider(provider_id)
    or public.is_admin()
  );

drop policy if exists msg_select on public.messages;
create policy msg_select on public.messages for select using (
  public.in_conversation(conversation_id) or public.is_admin()
);

drop policy if exists msg_insert on public.messages;
create policy msg_insert on public.messages for insert with check (
  sender_id = auth.uid() and public.in_conversation(conversation_id)
);

drop policy if exists msg_update on public.messages;
create policy msg_update on public.messages for update
  using (public.in_conversation(conversation_id) or public.is_admin())
  with check (public.in_conversation(conversation_id) or public.is_admin());
