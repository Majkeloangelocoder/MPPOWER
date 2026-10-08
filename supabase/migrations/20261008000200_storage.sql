-- Prywatne kubełki na pliki użytkownika; ścieżka zawsze zaczyna się od <user_id>/.
-- Zdjęcia sylwetki dodatkowo wymagają zgody 'body_images'. Media ćwiczeń są publiczne (CDN),
-- a zapisuje je wyłącznie panel administracyjny kluczem serwisowym.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('food-scans', 'food-scans', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('body-photos', 'body-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('technique-videos', 'technique-videos', false, 104857600, array['video/mp4', 'video/quicktime']),
  ('exercise-media', 'exercise-media', true, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'])
on conflict (id) do nothing;

create policy food_scans_files_select_own on storage.objects for select to authenticated
  using (bucket_id = 'food-scans' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy food_scans_files_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'food-scans' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy food_scans_files_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'food-scans' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy body_photos_files_select_own on storage.objects for select to authenticated
  using (bucket_id = 'body-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy body_photos_files_insert_with_consent on storage.objects for insert to authenticated
  with check (bucket_id = 'body-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
              and public.has_consent('body_images'));
create policy body_photos_files_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'body-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy technique_videos_files_select_own on storage.objects for select to authenticated
  using (bucket_id = 'technique-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy technique_videos_files_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'technique-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy technique_videos_files_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'technique-videos' and (storage.foldername(name))[1] = (select auth.uid())::text);
