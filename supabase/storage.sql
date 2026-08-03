-- InstaWill — Supabase Storage bucket for will documents (§1.6 in the brief).
--
-- Files land at wills/{will_id}/{doc_type}-{timestamp}.{ext}. The app generates
-- a 7-day signed URL on upload and stores it on the `documents` row
-- (file_path, file_url, expires_at) — that URL is what the ops portal package
-- renders as a clickable "ready to attach" link.
--
-- These are permissive DEMO policies (anon can insert/select) so the prototype
-- works without wiring up full client auth. Tighten to per-lead ownership
-- (matched via a signed JWT claim, same pattern as schema.sql's RLS policies)
-- before handling real client documents in production.

-- Idempotent: safe to run more than once. `create policy` isn't re-runnable on
-- its own (errors with "policy already exists"), so we drop first.

insert into storage.buckets (id, name, public)
values ('wills', 'wills', false)
on conflict (id) do nothing;

drop policy if exists "wills bucket: anon insert (demo)" on storage.objects;
drop policy if exists "wills bucket: anon select (demo)" on storage.objects;
drop policy if exists "wills bucket: anon update (demo)" on storage.objects;

create policy "wills bucket: anon insert (demo)" on storage.objects
  for insert to anon
  with check (bucket_id = 'wills');

create policy "wills bucket: anon select (demo)" on storage.objects
  for select to anon
  using (bucket_id = 'wills');

create policy "wills bucket: anon update (demo)" on storage.objects
  for update to anon
  using (bucket_id = 'wills');
