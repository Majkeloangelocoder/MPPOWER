-- Zgody z formularza rejestracji zapisują się razem z kontem (także gdy e-mail wymaga potwierdzenia).
-- Aplikacja przekazuje je w metadanych: { "consents": { "version": "2026-10", "terms": true, "privacy": true } }.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version text := new.raw_user_meta_data #>> '{consents,version}';
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  if v_version is not null then
    insert into public.consents (user_id, consent_type, document_version, granted, source)
    select new.id, t, v_version, true, 'app'
    from unnest(array['terms', 'privacy']) as t
    where coalesce((new.raw_user_meta_data #>> array['consents', t])::boolean, false);
  end if;
  return new;
end;
$$;
