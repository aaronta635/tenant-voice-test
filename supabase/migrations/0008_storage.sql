-- TenantVoice — Storage buckets
-- Apply after 0007_platform_rls.sql.
--
-- Uploads go through the FastAPI backend (service-role key), never straight from
-- the browser — see docs/README.md "Supabase is backend-only". The bucket is
-- therefore PRIVATE and the API hands out short-lived signed URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-attachments',
  'message-attachments',
  false,
  5242880,  -- 5 MB, mirrored in app/services/uploads.py
  array[
    'image/png','image/jpeg','image/gif','image/webp','application/pdf'
  ]
)
on conflict (id) do update set
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Defence-in-depth: only conversation participants may read an attachment
-- directly. The backend uses the service-role key and bypasses these.
drop policy if exists message_attachments_read on storage.objects;
create policy message_attachments_read on storage.objects for select using (
  bucket_id = 'message-attachments' and auth.uid() is not null
);
