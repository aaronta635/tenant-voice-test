-- TenantVoice — a private Storage bucket for chat attachments on the shared Supabase project
-- Run in the SQL Editor of the shared project (README.md). It does not need 0001 or 0002.
--
-- The web backend stores each file someone attaches to a message here, as
-- {users.id}/{random hex}.{ext}, keeps that key in
-- public.message_attachments.file_url, and hands readers a short-lived
-- signed URL. The browser never talks to Storage itself.
--
-- A bucket of its own, not a messages/ folder in profile-documents:
--   * profile-documents holds identity documents (passports, licences,
--     insurance) and the mobile app's clean-up of them
--     (profile_document_deletion_queue, mark_profile_document_object_deleted):
--     chat files there would sit under rules made for those documents, and
--     no profile_documents row would name them;
--   * a chat link is signed in a bucket that holds no identity document, so
--     a mistake in the backend's folder check can never sign one;
--   * it takes the types the web accepts for chat, GIF included, which
--     profile-documents refuses (the upload then failed with 502).
--
-- Private, with no storage policies: anon and authenticated keys get
-- nothing, and only the backend's service role (which bypasses RLS) reads
-- and writes. Nothing in public changes.
--
-- Safe to re-run: it creates the bucket, or puts one of that name back to
-- these settings.

begin;

-- As in 0001: wait at most 5 s for a lock, then fail and roll back. On a
-- timeout, run again.
set local lock_timeout = '5s';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-attachments',
  'message-attachments',
  false,
  5242880,  -- 5 MB: this bucket's entry in the backend's uploads.BUCKETS
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
