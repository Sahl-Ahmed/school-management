-- ===========================================================================
-- 0018  Storage buckets
-- ---------------------------------------------------------------------------
-- Three buckets, split by who may read them:
--
--   branding        public  — school logo and signature, printed on cards and
--                             shown on the public QR page
--   student-photos  private — passport photos. Served through signed URLs only;
--                             a student photo is not public data, and the QR
--                             card page receives a short-lived signed URL
--                             generated server-side.
--   documents       private — generated PDFs (admit cards, receipts, routines)
--
-- The 200 KB ceiling on student photos is declared on the bucket as well as
-- validated in the browser, so a client that skips compression is rejected by
-- the server rather than trusted.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('branding', 'branding', true, 2097152,
    array['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']),
  ('student-photos', 'student-photos', false, 204800,
    array['image/jpeg', 'image/webp', 'image/png']),
  ('documents', 'documents', false, 26214400,
    array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- NOTE: no COMMENT ON is set against storage.buckets or storage.objects. On a
-- hosted Supabase project those relations are owned by the platform, and
-- `comment on column storage.buckets...` fails with
-- "must be owner of relation buckets (SQLSTATE 42501)". The 204800-byte limit
-- on student-photos above is the 200 KB ceiling the brief requires.

-- --------------------------------------------------------------------------
-- branding — world-readable, authority-writable
-- --------------------------------------------------------------------------
create policy "branding is public"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'branding');

create policy "authority writes branding"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'branding' and (select app.is_authority()));

create policy "authority updates branding"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'branding' and (select app.is_authority()))
  with check (bucket_id = 'branding' and (select app.is_authority()));

create policy "authority deletes branding"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'branding' and (select app.is_admin()));

-- --------------------------------------------------------------------------
-- student-photos — authority manages; a student reads only their own
-- --------------------------------------------------------------------------
-- Objects are stored as  <student_id>/<filename>, so the first path segment is
-- the authorisation key.
-- --------------------------------------------------------------------------
create policy "authority manages student photos"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'student-photos' and (select app.is_authority()))
  with check (bucket_id = 'student-photos' and (select app.is_authority()));

create policy "student reads own photo"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'student-photos'
    and (storage.foldername(name))[1] = (select app.current_student_id())::text
  );

-- A teacher sees the photo of a student they teach, for the attendance roster.
create policy "teacher reads taught student photo"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'student-photos'
    and (select app.is_teacher())
    -- Guard the cast: an unexpected path must deny, not raise.
    and (storage.foldername(name))[1] ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and app.teaches_student(((storage.foldername(name))[1])::uuid)
  );

-- --------------------------------------------------------------------------
-- documents — authority manages; a student reads only their own folder
-- --------------------------------------------------------------------------
create policy "authority manages documents"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'documents' and (select app.is_authority()))
  with check (bucket_id = 'documents' and (select app.is_authority()));

create policy "student reads own documents"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = 'students'
    and (storage.foldername(name))[2] = (select app.current_student_id())::text
  );
