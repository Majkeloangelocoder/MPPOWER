-- Ankieta startowa → pomiary obwodów → zdjęcia sylwetki → plan na cykl 8 tygodni.

-- Obwód brzucha (na wysokości pępka) obok talii (najwęższe miejsce).
alter table public.measurements drop constraint measurements_kind_check;
alter table public.measurements add constraint measurements_kind_check
  check (kind in ('body_weight', 'waist', 'abdomen', 'hips', 'chest', 'arm', 'thigh', 'body_fat_pct'));

-- Ankieta pyta o rok urodzenia (nie pełną datę) i o sprzęt w domu.
alter table public.profiles
  add column birth_year smallint check (birth_year between 1900 and 2100),
  add column home_equipment text check (home_equipment in ('none', 'dumbbells'));

-- Zdjęcia sylwetki: pliki w kubełku body-photos (<user_id>/...), tu tylko metadane.
-- Zapis wymaga zgody 'body_images' — tak samo jak polityka kubełka.
create table public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  pose text not null check (pose in ('front', 'side', 'back')),
  storage_path text not null unique,
  taken_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (split_part(storage_path, '/', 1) = user_id::text)
);
create index progress_photos_user_time_idx on public.progress_photos (user_id, taken_at desc);
alter table public.progress_photos enable row level security;
create policy progress_photos_select_own on public.progress_photos for select to authenticated
  using (user_id = (select auth.uid()));
create policy progress_photos_insert_with_consent on public.progress_photos for insert to authenticated
  with check (user_id = (select auth.uid()) and public.has_consent('body_images'));
create policy progress_photos_delete_own on public.progress_photos for delete to authenticated
  using (user_id = (select auth.uid()));

-- Cykl: program wygenerowany pod użytkownika ma tygodnie z modyfikatorami serii i zapasu RIR.
alter table public.programs add column cycle_weeks smallint check (cycle_weeks between 1 and 16);

create table public.program_weeks (
  program_id uuid not null references public.programs (id) on delete cascade,
  week_index smallint not null check (week_index between 1 and 16),
  phase text not null check (phase in ('intro', 'build', 'deload', 'peak')),
  label text not null,
  sets_delta smallint not null default 0 check (sets_delta between -3 and 3),
  sets_multiplier numeric(3, 2) not null default 1 check (sets_multiplier between 0.3 and 1.5),
  rir_delta numeric(3, 1) not null default 0 check (rir_delta between -3 and 3),
  hold_progression boolean not null default false,
  check_in boolean not null default false,
  focus text,
  primary key (program_id, week_index)
);
alter table public.program_weeks enable row level security;
create policy program_weeks_select on public.program_weeks for select to authenticated
  using (exists (select 1 from public.programs p where p.id = program_id));

-- Tydzień cyklu zapisany przy starcie treningu: podgląd, zapis i progresja liczą się z tej samej recepty.
alter table public.workout_sessions add column cycle_week smallint check (cycle_week between 1 and 16);

create or replace function public.start_workout_session(p_user_id uuid, p_program_day_id uuid, p_client_session_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_program public.programs%rowtype;
  v_allowed boolean;
  v_user_program public.user_programs%rowtype;
  v_title text;
  v_week smallint;
begin
  select p.* into v_program
  from public.programs p
  join public.program_days d on d.program_id = p.id
  where d.id = p_program_day_id;
  if not found then
    raise exception 'program_day_not_found' using errcode = 'P0002';
  end if;

  v_allowed := (v_program.owner_user_id is not null and v_program.owner_user_id = p_user_id)
    or (v_program.org_id is not null
        and v_program.status = 'published'
        and coalesce((select pl.rank from public.plans pl where pl.code = v_program.required_plan), 32767)
            <= public.plan_rank_for(p_user_id));
  if not coalesce(v_allowed, false) then
    raise exception 'program_not_available' using errcode = '42501';
  end if;

  select up.* into v_user_program
  from public.user_programs up
  where up.user_id = p_user_id and up.program_id = v_program.id and up.status = 'active';

  if v_program.cycle_weeks is not null and v_user_program.id is not null then
    v_week := least(v_program.cycle_weeks, greatest(1, floor(extract(epoch from now() - v_user_program.started_at) / 604800)::int + 1));
  end if;

  select d.title into v_title from public.program_days d where d.id = p_program_day_id;

  -- Idempotencja: ten sam client_session_id z telefonu zwraca istniejącą sesję.
  insert into public.workout_sessions (user_id, user_program_id, program_day_id, client_session_id, title, cycle_week)
  values (p_user_id, v_user_program.id, p_program_day_id, p_client_session_id, v_title, v_week)
  on conflict (user_id, client_session_id) do nothing
  returning id into v_session_id;

  if v_session_id is null then
    select s.id into v_session_id
    from public.workout_sessions s
    where s.user_id = p_user_id and s.client_session_id = p_client_session_id;
    return v_session_id;
  end if;

  insert into public.session_exercises (session_id, user_id, exercise_id, program_exercise_id, order_index)
  select v_session_id, p_user_id, pe.exercise_id, pe.id, pe.order_index
  from public.program_exercises pe
  where pe.program_day_id = p_program_day_id;

  return v_session_id;
end;
$$;

-- Zapis wygenerowanego planu w jednej transakcji: poprzedni aktywny plan kończy się, nowy staje się aktywny.
-- p_program: GeneratedProgram z @mp-power/core (camelCase).
create or replace function public.assign_generated_program(p_user_id uuid, p_program jsonb, p_inputs jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_program_id uuid;
  v_day jsonb;
  v_day_id uuid;
begin
  update public.user_programs set status = 'completed'
  where user_id = p_user_id and status = 'active';

  insert into public.programs (owner_user_id, title, goal, level, days_per_week, location, source, status, required_plan, cycle_weeks, generator_inputs, created_by)
  values (p_user_id, p_program ->> 'title', p_program ->> 'goal', p_program ->> 'level', (p_program ->> 'daysPerWeek')::smallint,
          p_program ->> 'location', 'generated', 'published', 'free', (p_program ->> 'cycleWeeks')::smallint,
          jsonb_build_object('profile', p_inputs, 'generatorVersion', p_program ->> 'generatorVersion', 'insights', p_program -> 'insights'),
          p_user_id)
  returning id into v_program_id;

  for v_day in select * from jsonb_array_elements(p_program -> 'days') loop
    insert into public.program_days (program_id, day_index, title, focus, estimated_minutes)
    values (v_program_id, (v_day ->> 'dayIndex')::smallint, v_day ->> 'title', v_day ->> 'focus', (v_day ->> 'estimatedMinutes')::smallint)
    returning id into v_day_id;

    insert into public.program_exercises (program_day_id, exercise_id, order_index, block, sets, rep_min, rep_max, target_rir, tempo, rest_seconds, progression_model)
    select v_day_id, (x ->> 'exerciseId')::uuid, ord::smallint, x ->> 'block', (x ->> 'sets')::smallint, (x ->> 'repMin')::smallint,
           (x ->> 'repMax')::smallint, (x ->> 'targetRir')::numeric, x ->> 'tempo', (x ->> 'restSeconds')::smallint, x ->> 'model'
    from jsonb_array_elements(v_day -> 'exercises') with ordinality as t(x, ord);
  end loop;

  insert into public.program_weeks (program_id, week_index, phase, label, sets_delta, sets_multiplier, rir_delta, hold_progression, check_in, focus)
  select v_program_id, (w ->> 'weekIndex')::smallint, w ->> 'phase', w ->> 'label', (w ->> 'setsDelta')::smallint,
         (w ->> 'setsMultiplier')::numeric, (w ->> 'rirDelta')::numeric, (w ->> 'holdProgression')::boolean, (w ->> 'checkIn')::boolean, w ->> 'focus'
  from jsonb_array_elements(p_program -> 'weeks') as w;

  insert into public.user_programs (user_id, program_id, status) values (p_user_id, v_program_id, 'active');
  update public.profiles set onboarding_completed_at = coalesce(onboarding_completed_at, now()) where id = p_user_id;
  return v_program_id;
end;
$$;

revoke execute on function public.assign_generated_program(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.assign_generated_program(uuid, jsonb, jsonb) to service_role;
revoke execute on function public.start_workout_session(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_workout_session(uuid, uuid, uuid) to service_role;
