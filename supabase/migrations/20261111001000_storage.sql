-- Private bucket for raw uploads (§11.2 Storage, §10.3, D14, D15).
-- Path: raw/{handover_id}/{source_id}. 25 MB cap. No client can read, overwrite or delete raw objects;
-- server code (service_role) reads them for preview/parse and deletes them after the final parse.
-- UNVERIFIED on Supabase: that createSignedUploadUrl / uploadToSignedUrl are authorised by this INSERT
-- policy for the signing user, and that file_size_limit is enforced on signed uploads.

insert into storage.buckets (id, name, public, file_size_limit)
values ('source-uploads', 'source-uploads', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- A user may upload exactly the object of a source they created that is still awaiting its upload.
create function public.can_upload_source_object(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_bucket = 'source-uploads' and exists (
    select 1 from public.sources s join public.handovers h on h.id = s.handover_id
     where s.raw_storage_path = p_name and s.state = 'pending_upload' and s.deleted_at is null
       and h.deleted_at is null and s.uploaded_by = auth.uid()
       and (public.is_creator(s.handover_id) or public.member_role(s.handover_id) = 'outgoing')
  )
$$;

create policy baton_source_uploads_insert on storage.objects
  for insert to authenticated
  with check (public.can_upload_source_object(bucket_id, name));
