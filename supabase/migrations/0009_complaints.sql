-- TenantVoice — Complaints
-- Apply after 0008_storage.sql.
--
-- A complaint is a formal, tracked grievance — deliberately separate from a
-- review (SCOPE.md Tenant Base: "Submit a formal complaint (separate from a
-- review)"). Reviews are public opinion; complaints are a private case file that
-- an owner responds to, an admin moderates, and a Fair Trading officer
-- aggregates for red-flag detection.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type complaint_category as enum ('safety','maintenance','harassment','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type complaint_status as enum ('open','under_review','resolved','dismissed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.complaints (
  id               uuid primary key default gen_random_uuid(),
  complainant_id   uuid not null references public.profiles(id)   on delete cascade,
  -- Who/what the complaint is about. Either may be null: a complaint can target
  -- a property whose owner later changes, or a person with no listing involved.
  against_id       uuid references public.profiles(id)   on delete set null,
  property_id      uuid references public.properties(id) on delete set null,
  category         complaint_category not null default 'other',
  subject          text not null,
  description      text not null,
  status           complaint_status not null default 'open',
  -- The owner's side of the story (mirrors reviews.provider_reply).
  response         text,
  responded_at     timestamptz,
  -- Filled in when an admin/officer closes the case.
  resolution_note  text,
  resolved_at      timestamptz,
  -- Officer workflow: flagged cases surface in the regulatory portal.
  is_escalated     boolean not null default false,
  evidence_urls    text[],
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (against_id is not null or property_id is not null)
);

create index if not exists idx_complaints_complainant on public.complaints (complainant_id);
create index if not exists idx_complaints_against     on public.complaints (against_id);
create index if not exists idx_complaints_property    on public.complaints (property_id);
create index if not exists idx_complaints_status      on public.complaints (status);
create index if not exists idx_complaints_category    on public.complaints (category);
-- Officer dashboards read "complaints over time" and "unresolved per landlord".
create index if not exists idx_complaints_created     on public.complaints (created_at);

drop trigger if exists trg_complaints_updated on public.complaints;
create trigger trg_complaints_updated before update on public.complaints
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — complainant, the accused, and admins. NOT world-readable: unlike a
-- review, a complaint is not public until a regulator acts on it.
-- ---------------------------------------------------------------------------
alter table public.complaints enable row level security;

drop policy if exists complaints_select on public.complaints;
create policy complaints_select on public.complaints for select using (
  complainant_id = auth.uid()
  or against_id = auth.uid()
  or public.owns_property(property_id)
  or public.is_admin()
);

drop policy if exists complaints_insert on public.complaints;
create policy complaints_insert on public.complaints for insert
  with check (complainant_id = auth.uid());

-- The complainant may edit their own open complaint; the accused may only add a
-- response; admins may do anything. Column-level limits are enforced in the API.
drop policy if exists complaints_update on public.complaints;
create policy complaints_update on public.complaints for update
  using (
    complainant_id = auth.uid()
    or against_id = auth.uid()
    or public.owns_property(property_id)
    or public.is_admin()
  )
  with check (
    complainant_id = auth.uid()
    or against_id = auth.uid()
    or public.owns_property(property_id)
    or public.is_admin()
  );

drop policy if exists complaints_delete on public.complaints;
create policy complaints_delete on public.complaints for delete
  using (complainant_id = auth.uid() or public.is_admin());

grant select on public.complaints to anon, authenticated;
grant insert, update, delete on public.complaints to authenticated;
grant all privileges on public.complaints to service_role;
