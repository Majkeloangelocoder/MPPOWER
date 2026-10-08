-- =============================================================================
-- MP POWER COACH — migracja 0001: rdzeń MVP1 (PostgreSQL 15+, Supabase)
--  * RLS na każdej tabeli w schemacie public (włączane na końcu pliku).
--  * Dane użytkownika: user_id = auth.uid(); spójność rodzic–dziecko wymuszają
--    złożone klucze obce (id, user_id) — nie da się podpiąć serii pod cudzą sesję.
--  * Płatności, uprawnienia, rekomendacje, historia czatu i audyt zapisuje wyłącznie serwer.
--  * Komendy złożone (start i koniec treningu) to funkcje SQL wykonywane atomowo.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organizacje i role (multi-tenant od pierwszego dnia; MP POWER = pierwsza organizacja)
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,64}$'),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'coach', 'physio', 'client')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create or replace function public.is_org_staff(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.org_id = p_org
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin', 'coach')
  );
$$;

-- ---------------------------------------------------------------------------
-- Plany i uprawnienia (źródło prawdy dla dostępu — nigdy frontend)
-- ---------------------------------------------------------------------------
create table public.plans (
  code text primary key check (code ~ '^[a-z0-9_]{2,32}$'),
  name text not null,
  rank smallint not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.plan_features (
  plan_code text not null references public.plans (code) on delete cascade,
  feature_key text not null,
  enabled boolean not null default true,
  quota_limit integer check (quota_limit > 0),
  quota_period text check (quota_period in ('day', 'week', 'month')),
  primary key (plan_code, feature_key),
  check ((quota_limit is null) = (quota_period is null))
);

create table public.entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan_code text not null references public.plans (code),
  features jsonb not null default '{}'::jsonb,
  source text not null check (source in ('stripe', 'app_store', 'play_store', 'manual', 'grant', 'default')),
  valid_until timestamptz,
  in_grace_period boolean not null default false,
  computed_at timestamptz not null default now()
);

create or replace function public.plan_rank_for(p_user uuid)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.rank
    from public.entitlements e
    join public.plans p on p.code = e.plan_code
    where e.user_id = p_user
      and (e.valid_until is null or e.valid_until > now())
  ), 0)::smallint;
$$;

create or replace function public.has_plan(p_required text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.rank from public.plans p where p.code = p_required), 32767)
         <= public.plan_rank_for((select auth.uid()));
$$;

-- ---------------------------------------------------------------------------
-- Profil, zgody, sprzęt, ograniczenia
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  birth_date date,
  sex_for_calc text check (sex_for_calc in ('female', 'male', 'unspecified')),
  height_cm numeric(5, 1) check (height_cm between 120 and 230),
  experience_level text check (experience_level in ('beginner', 'intermediate', 'advanced')),
  training_location text check (training_location in ('gym', 'home', 'both')),
  days_per_week smallint check (days_per_week between 1 and 7),
  session_minutes smallint check (session_minutes between 15 and 180),
  preferred_weekdays smallint[] not null default '{}' check (preferred_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  occupation_activity text check (occupation_activity in ('sedentary', 'mixed', 'active')),
  typical_sleep_hours numeric(3, 1) check (typical_sleep_hours between 0 and 14),
  stress_level smallint check (stress_level between 1 and 5),
  locale text not null default 'pl',
  timezone text not null default 'Europe/Warsaw',
  onboarding_completed_at timestamptz,
  deletion_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Historia zgód: tylko dopisywanie; obowiązuje najnowszy wpis danego typu.
create table public.consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  consent_type text not null check (consent_type in ('terms', 'privacy', 'health_data', 'body_images', 'ai_processing', 'marketing', 'research')),
  document_version text not null,
  granted boolean not null,
  source text not null default 'app' check (source in ('app', 'web', 'admin')),
  created_at timestamptz not null default now()
);
create index consents_user_type_idx on public.consents (user_id, consent_type, created_at desc);

create or replace function public.has_consent(p_type text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select c.granted
    from public.consents c
    where c.user_id = (select auth.uid()) and c.consent_type = p_type
    order by c.created_at desc, c.id desc
    limit 1
  ), false);
$$;

create table public.equipment (
  code text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  name_pl text not null,
  category text not null check (category in ('free_weight', 'machine', 'bodyweight', 'accessory')),
  default_increment_kg numeric(4, 2) not null default 0 check (default_increment_kg >= 0)
);

create table public.user_equipment (
  user_id uuid not null references auth.users (id) on delete cascade,
  equipment_code text not null references public.equipment (code),
  increment_kg numeric(4, 2) check (increment_kg > 0),
  primary key (user_id, equipment_code)
);

-- Dane o zdrowiu (art. 9 RODO): zapis wymaga zgody 'health_data' (wymuszone w RLS).
create table public.user_limitations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  body_region text not null check (body_region in ('neck', 'shoulder', 'elbow', 'wrist', 'upper_back', 'lower_back', 'hip', 'knee', 'ankle', 'other')),
  side text check (side in ('left', 'right', 'both')),
  avoid_tags text[] not null default '{}',
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index user_limitations_user_idx on public.user_limitations (user_id);

-- ---------------------------------------------------------------------------
-- Cele i pomiary
-- ---------------------------------------------------------------------------
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_type text not null check (goal_type in ('fat_loss', 'muscle_gain', 'strength', 'fitness', 'physique', 'health')),
  target_value numeric(7, 2),
  target_unit text check (target_unit in ('kg', 'cm', 'pct', 'reps', 'sessions')),
  baseline_value numeric(7, 2),
  is_primary boolean not null default false,
  status text not null default 'active' check (status in ('active', 'achieved', 'abandoned')),
  started_at date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create unique index goals_one_primary_active on public.goals (user_id) where is_primary and status = 'active';
create trigger goals_set_updated_at before update on public.goals
  for each row execute function public.set_updated_at();

create table public.goal_milestones (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  target_value numeric(7, 2),
  sort smallint not null default 0,
  achieved_at timestamptz,
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete cascade
);

create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('body_weight', 'waist', 'hips', 'chest', 'arm', 'thigh', 'body_fat_pct')),
  value numeric(6, 2) not null check (value > 0),
  measured_at timestamptz not null default now(),
  source text not null default 'manual' check (source in ('manual', 'checkin', 'device')),
  created_at timestamptz not null default now()
);
create index measurements_user_kind_time_idx on public.measurements (user_id, kind, measured_at desc);

-- ---------------------------------------------------------------------------
-- Biblioteka ćwiczeń
-- ---------------------------------------------------------------------------
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,80}$'),
  name_pl text not null,
  name_en text,
  category text not null check (category in ('squat', 'hinge', 'push', 'pull', 'carry', 'lunge', 'rotation', 'core', 'mobility', 'conditioning')),
  plane text check (plane in ('horizontal', 'vertical')),
  primary_muscles text[] not null default '{}',
  secondary_muscles text[] not null default '{}',
  equipment text[] not null default '{}',
  difficulty smallint not null default 2 check (difficulty between 1 and 5),
  load_type text not null default 'external' check (load_type in ('external', 'bodyweight', 'time')),
  is_unilateral boolean not null default false,
  default_increment_kg numeric(4, 2) not null default 2.5 check (default_increment_kg >= 0),
  instructions jsonb not null default '[]'::jsonb,
  common_errors jsonb not null default '[]'::jsonb,
  cues jsonb not null default '[]'::jsonb,
  stress_tags text[] not null default '{}',
  media jsonb not null default '{}'::jsonb,
  required_plan text not null default 'free' references public.plans (code),
  is_published boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index exercises_category_idx on public.exercises (category) where is_published;
create index exercises_equipment_gin on public.exercises using gin (equipment);
create index exercises_stress_tags_gin on public.exercises using gin (stress_tags);
create index exercises_primary_muscles_gin on public.exercises using gin (primary_muscles);
create index exercises_name_trgm on public.exercises using gin (name_pl extensions.gin_trgm_ops);
create trigger exercises_set_updated_at before update on public.exercises
  for each row execute function public.set_updated_at();

create table public.exercise_relations (
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  related_exercise_id uuid not null references public.exercises (id) on delete cascade,
  relation text not null check (relation in ('variant', 'regression', 'progression', 'alternative')),
  priority smallint not null default 0,
  primary key (exercise_id, related_exercise_id, relation),
  check (exercise_id <> related_exercise_id)
);
create index exercise_relations_related_idx on public.exercise_relations (related_exercise_id);

create table public.exercise_preferences (
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  preference text not null check (preference in ('favorite', 'avoid')),
  source text not null default 'explicit' check (source in ('onboarding', 'explicit', 'learned')),
  updated_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);

-- Katalog z kłódkami: FREE widzi nazwy ćwiczeń PRO (upsell), ale nie ich treść.
create or replace function public.exercise_catalog()
returns table (
  id uuid,
  slug text,
  name_pl text,
  category text,
  equipment text[],
  difficulty smallint,
  thumbnail_url text,
  required_plan text,
  is_locked boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.slug, e.name_pl, e.category, e.equipment, e.difficulty,
         e.media ->> 'thumbnail_url', e.required_plan, not public.has_plan(e.required_plan)
  from public.exercises e
  where e.is_published
  order by e.name_pl;
$$;

-- ---------------------------------------------------------------------------
-- Programy treningowe
-- ---------------------------------------------------------------------------
create table public.programs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete cascade,
  owner_user_id uuid references auth.users (id) on delete cascade,
  title text not null,
  goal text check (goal in ('fat_loss', 'muscle_gain', 'strength', 'fitness', 'physique', 'health')),
  level text check (level in ('beginner', 'intermediate', 'advanced')),
  days_per_week smallint check (days_per_week between 1 and 7),
  location text check (location in ('gym', 'home', 'both')),
  source text not null check (source in ('template', 'generated', 'custom', 'coach')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  required_plan text not null default 'free' references public.plans (code),
  version integer not null default 1,
  generator_inputs jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((org_id is not null) <> (owner_user_id is not null))
);
create index programs_owner_idx on public.programs (owner_user_id) where owner_user_id is not null;
create index programs_org_status_idx on public.programs (org_id, status) where org_id is not null;
create trigger programs_set_updated_at before update on public.programs
  for each row execute function public.set_updated_at();

create table public.program_days (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  day_index smallint not null check (day_index >= 1),
  title text not null,
  focus text,
  estimated_minutes smallint check (estimated_minutes between 5 and 240),
  unique (program_id, day_index)
);

create table public.program_exercises (
  id uuid primary key default gen_random_uuid(),
  program_day_id uuid not null references public.program_days (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  order_index smallint not null,
  block text not null default 'main' check (block in ('warmup', 'main', 'accessory', 'finisher')),
  sets smallint not null check (sets between 1 and 10),
  rep_min smallint not null check (rep_min >= 1),
  rep_max smallint not null,
  target_rir numeric(3, 1) not null default 2 check (target_rir between 0 and 5),
  tempo text check (tempo ~ '^[0-9X]-[0-9X]-[0-9X]-[0-9X]$'),
  rest_seconds smallint check (rest_seconds between 0 and 600),
  progression_model text not null default 'double_progression' check (progression_model in ('double_progression', 'rir', 'rpe', 'volume')),
  max_sets smallint check (max_sets between 1 and 12),
  notes text,
  superset_group smallint,
  check (rep_max >= rep_min),
  unique (program_day_id, order_index)
);
create index program_exercises_exercise_idx on public.program_exercises (exercise_id);

-- Przypisanie programu tylko przez API (sprawdza plan użytkownika).
create table public.user_programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  program_id uuid not null references public.programs (id),
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  started_at timestamptz not null default now(),
  block_started_at timestamptz not null default now(),
  last_deload_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create unique index user_programs_one_active on public.user_programs (user_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- Treningi (zapis przez API: start_workout_session / complete_workout_session)
-- ---------------------------------------------------------------------------
create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  user_program_id uuid,
  program_day_id uuid references public.program_days (id) on delete set null,
  client_session_id uuid not null,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'abandoned')),
  title text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_seconds integer check (duration_seconds >= 0),
  session_rpe numeric(3, 1) check (session_rpe between 1 and 10),
  score smallint check (score between 1 and 10),
  review jsonb,
  notes text,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, client_session_id),
  foreign key (user_program_id, user_id) references public.user_programs (id, user_id) on delete set null (user_program_id)
);
create index workout_sessions_user_time_idx on public.workout_sessions (user_id, started_at desc);

create table public.session_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  program_exercise_id uuid references public.program_exercises (id) on delete set null,
  swapped_from_exercise_id uuid references public.exercises (id),
  order_index smallint not null,
  skipped boolean not null default false,
  unique (id, user_id),
  unique (session_id, order_index),
  foreign key (session_id, user_id) references public.workout_sessions (id, user_id) on delete cascade
);
create index session_exercises_user_exercise_idx on public.session_exercises (user_id, exercise_id);

create table public.session_sets (
  id uuid primary key default gen_random_uuid(),
  session_exercise_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  set_index smallint not null check (set_index >= 1),
  set_type text not null default 'working' check (set_type in ('warmup', 'working', 'backoff')),
  load_kg numeric(6, 2) check (load_kg >= 0),
  reps smallint not null check (reps >= 0),
  rir numeric(3, 1) check (rir between 0 and 10),
  rpe numeric(3, 1) check (rpe between 1 and 10),
  is_completed boolean not null default true,
  completed_at timestamptz not null default now(),
  unique (session_exercise_id, set_index),
  foreign key (session_exercise_id, user_id) references public.session_exercises (id, user_id) on delete cascade
);
create index session_sets_user_idx on public.session_sets (user_id);

create table public.personal_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  kind text not null check (kind in ('heaviest_load', 'best_e1rm', 'most_reps', 'longest_hold')),
  value numeric(7, 2) not null,
  previous_value numeric(7, 2),
  session_id uuid,
  achieved_at timestamptz not null default now(),
  foreign key (session_id, user_id) references public.workout_sessions (id, user_id) on delete set null (session_id)
);
create index personal_records_lookup_idx on public.personal_records (user_id, exercise_id, kind, value desc);

create table public.recovery_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  log_date date not null,
  sleep_hours numeric(3, 1) check (sleep_hours between 0 and 16),
  fatigue smallint check (fatigue between 1 and 5),
  soreness smallint check (soreness between 1 and 5),
  stress smallint check (stress between 1 and 5),
  energy smallint check (energy between 1 and 5),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (user_id, log_date)
);

-- ---------------------------------------------------------------------------
-- Żywienie
-- ---------------------------------------------------------------------------
create table public.nutrition_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  goal text check (goal in ('fat_loss', 'muscle_gain', 'maintenance', 'recomposition')),
  activity_level text check (activity_level in ('sedentary', 'light', 'moderate', 'high', 'very_high')),
  diet_style text check (diet_style in ('omnivore', 'vegetarian', 'vegan', 'pescatarian', 'other')),
  meals_per_day smallint check (meals_per_day between 1 and 8),
  dislikes text[] not null default '{}',
  allergens text[] not null default '{}',
  main_challenges text[] not null default '{}',
  weekly_loss_pct numeric(3, 2) check (weekly_loss_pct between 0 and 1),
  gentle_mode boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger nutrition_profiles_set_updated_at before update on public.nutrition_profiles
  for each row execute function public.set_updated_at();

create table public.nutrition_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  valid_from date not null default current_date,
  calories_kcal integer not null check (calories_kcal between 800 and 6000),
  protein_g integer not null check (protein_g >= 0),
  fat_g integer not null check (fat_g >= 0),
  carbs_g integer not null check (carbs_g >= 0),
  fiber_g integer not null check (fiber_g >= 0),
  method text not null,
  flags text[] not null default '{}',
  inputs jsonb not null,
  created_by text not null default 'engine' check (created_by in ('engine', 'coach', 'user')),
  engine_version text,
  created_at timestamptz not null default now()
);
create index nutrition_targets_user_idx on public.nutrition_targets (user_id, valid_from desc);

create table public.food_items (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('seed', 'usda', 'open_food_facts', 'mp_power', 'user')),
  source_ref text,
  name_pl text not null,
  name_en text,
  brand text,
  barcode text,
  kcal_100g numeric(6, 1) not null check (kcal_100g >= 0),
  protein_100g numeric(5, 1) not null default 0 check (protein_100g >= 0),
  carbs_100g numeric(5, 1) not null default 0 check (carbs_100g >= 0),
  fat_100g numeric(5, 1) not null default 0 check (fat_100g >= 0),
  fiber_100g numeric(5, 1) not null default 0 check (fiber_100g >= 0),
  default_portion_g numeric(6, 1),
  is_verified boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (source, source_ref)
);
create index food_items_name_trgm on public.food_items using gin (name_pl extensions.gin_trgm_ops);
create index food_items_barcode_idx on public.food_items (barcode) where barcode is not null;

create table public.food_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  status text not null default 'pending' check (status in ('pending', 'analyzed', 'confirmed', 'failed')),
  ai_result jsonb,
  kcal_min integer check (kcal_min >= 0),
  kcal_max integer check (kcal_max >= 0),
  model text,
  prompt_version text,
  corrections jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (id, user_id)
);
create index food_scans_user_idx on public.food_scans (user_id, created_at desc);

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  eaten_at timestamptz not null default now(),
  meal_type text not null default 'other' check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack', 'other')),
  source text not null default 'manual' check (source in ('manual', 'scan', 'barcode', 'suggestion')),
  food_scan_id uuid,
  note text,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (food_scan_id, user_id) references public.food_scans (id, user_id) on delete set null (food_scan_id)
);
create index meals_user_time_idx on public.meals (user_id, eaten_at desc);

create table public.meal_items (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  food_item_id uuid references public.food_items (id) on delete set null,
  custom_name text,
  grams numeric(7, 1) not null check (grams > 0),
  kcal numeric(7, 1) not null check (kcal >= 0),
  protein_g numeric(6, 1) not null default 0,
  carbs_g numeric(6, 1) not null default 0,
  fat_g numeric(6, 1) not null default 0,
  fiber_g numeric(6, 1) not null default 0,
  check (food_item_id is not null or custom_name is not null),
  foreign key (meal_id, user_id) references public.meals (id, user_id) on delete cascade
);
create index meal_items_meal_idx on public.meal_items (meal_id);

-- ---------------------------------------------------------------------------
-- AI: rozmowy, rekomendacje (z human override), koszty
-- ---------------------------------------------------------------------------
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

-- Historię zapisuje tylko serwer: użytkownik nie może podrobić odpowiedzi „asystenta” w kontekście.
create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content jsonb not null,
  safety_category text check (safety_category in ('emergency', 'medical_consult', 'eating_concern')),
  created_at timestamptz not null default now(),
  foreign key (conversation_id, user_id) references public.ai_conversations (id, user_id) on delete cascade
);
create index ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);

create table public.ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('progression', 'deload', 'plan_adjustment', 'nutrition', 'swap')),
  exercise_id uuid references public.exercises (id),
  session_id uuid,
  payload jsonb not null,
  explanation text not null,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'rejected', 'overridden', 'expired', 'applied')),
  source text not null default 'engine' check (source in ('engine', 'ai', 'coach')),
  engine_version text,
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  override_payload jsonb,
  override_note text,
  created_at timestamptz not null default now(),
  foreign key (session_id, user_id) references public.workout_sessions (id, user_id) on delete set null (session_id)
);
create index ai_recommendations_user_status_idx on public.ai_recommendations (user_id, status, created_at desc);
create index ai_recommendations_exercise_idx on public.ai_recommendations (user_id, exercise_id, created_at desc) where exercise_id is not null;

create table public.ai_requests (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  task text not null,
  provider text not null,
  model text not null,
  prompt_version text,
  ok boolean not null,
  fallback_used boolean not null default false,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  latency_ms integer not null default 0,
  error text,
  created_at timestamptz not null default now()
);
create index ai_requests_created_idx on public.ai_requests (created_at desc);
create index ai_requests_user_idx on public.ai_requests (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Płatności i subskrypcje (Stripe + App Store + Google Play)
-- ---------------------------------------------------------------------------
create table public.prices (
  id uuid primary key default gen_random_uuid(),
  plan_code text not null references public.plans (code),
  provider text not null check (provider in ('stripe', 'app_store', 'play_store')),
  provider_price_id text not null,
  billing_interval text not null check (billing_interval in ('month', 'year')),
  currency text not null default 'pln' check (currency ~ '^[a-z]{3}$'),
  unit_amount integer check (unit_amount >= 0),
  trial_days smallint not null default 0 check (trial_days between 0 and 31),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (provider, provider_price_id)
);

create table public.billing_customers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text unique,
  revenuecat_app_user_id text unique,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('stripe', 'app_store', 'play_store', 'manual')),
  provider_subscription_id text not null,
  plan_code text not null references public.plans (code),
  provider_price_id text,
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  trial_end timestamptz,
  past_due_since timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);
create index subscriptions_user_idx on public.subscriptions (user_id);
create trigger subscriptions_set_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- Po usunięciu konta płatności zostają bez powiązania z osobą (obowiązek księgowy).
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  provider text not null check (provider in ('stripe', 'app_store', 'play_store')),
  provider_payment_id text not null,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  amount integer not null,
  currency text not null,
  status text not null check (status in ('paid', 'failed', 'refunded', 'pending')),
  invoice_url text,
  occurred_at timestamptz not null default now(),
  unique (provider, provider_payment_id)
);
create index payments_user_idx on public.payments (user_id, occurred_at desc);

-- Idempotencja webhooków: każde zdarzenie przetwarzamy raz (unique provider + event_id).
create table public.billing_events (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('stripe', 'revenuecat')),
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (provider, event_id)
);

create table public.entitlement_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_code text not null references public.plans (code),
  reason text not null,
  expires_at timestamptz,
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index entitlement_grants_user_idx on public.entitlement_grants (user_id);

create table public.usage_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  feature_key text not null,
  period_start date not null,
  used integer not null default 0 check (used >= 0),
  primary key (user_id, feature_key, period_start)
);

-- Atomowe zużycie limitu (np. skan posiłku): true = wolno, false = limit wyczerpany.
create or replace function public.consume_quota(p_user uuid, p_feature text, p_period_start date, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer;
begin
  if p_limit is null or p_limit <= 0 then
    return false;
  end if;
  insert into public.usage_counters as uc (user_id, feature_key, period_start, used)
  values (p_user, p_feature, p_period_start, 1)
  on conflict (user_id, feature_key, period_start)
  do update set used = uc.used + 1
  where uc.used < p_limit
  returning uc.used into v_used;
  return v_used is not null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Powiadomienia i treści
-- ---------------------------------------------------------------------------
create table public.notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  push_enabled boolean not null default true,
  quiet_hours_start time not null default '21:30',
  quiet_hours_end time not null default '07:30',
  max_per_day smallint not null default 2 check (max_per_day between 0 and 10),
  categories jsonb not null default '{"workout": true, "progress": true, "nutrition": true, "checkin": true, "marketing": false}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (category in ('workout', 'progress', 'nutrition', 'checkin', 'billing', 'system', 'marketing')),
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  dedupe_key text,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_due_idx on public.notifications (scheduled_for) where sent_at is null;

create table public.content (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('article', 'tip', 'brief_snippet', 'push_copy')),
  slug text not null,
  title text not null,
  body_md text not null,
  tags text[] not null default '{}',
  required_plan text not null default 'free' references public.plans (code),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug)
);
create trigger content_set_updated_at before update on public.content
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Audyt operacji administracyjnych: tylko dopisywanie
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  actor_role text,
  org_id uuid,
  action text not null,
  target_table text,
  target_id text,
  diff jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_target_idx on public.audit_logs (target_table, target_id);

create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$;

create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function public.prevent_audit_mutation();

-- ---------------------------------------------------------------------------
-- Komendy treningowe (wywołuje wyłącznie API z kluczem serwisowym)
-- ---------------------------------------------------------------------------
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
  v_user_program_id uuid;
  v_title text;
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

  select up.id into v_user_program_id
  from public.user_programs up
  where up.user_id = p_user_id and up.program_id = v_program.id and up.status = 'active';

  select d.title into v_title from public.program_days d where d.id = p_program_day_id;

  -- Idempotencja: ten sam client_session_id z telefonu zwraca istniejącą sesję.
  insert into public.workout_sessions (user_id, user_program_id, program_day_id, client_session_id, title)
  values (p_user_id, v_user_program_id, p_program_day_id, p_client_session_id, v_title)
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

create or replace function public.complete_workout_session(
  p_user_id uuid,
  p_session_id uuid,
  p_sets jsonb,
  p_score smallint,
  p_review jsonb,
  p_recommendations jsonb,
  p_records jsonb,
  p_skipped uuid[] default '{}',
  p_swaps jsonb default '[]'::jsonb,
  p_session_rpe numeric default null,
  p_completed_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_started timestamptz;
  v_inserted integer;
begin
  select s.status, s.started_at into v_status, v_started
  from public.workout_sessions s
  where s.id = p_session_id and s.user_id = p_user_id
  for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  if v_status = 'completed' then
    return; -- idempotencja: ponowne wysłanie tej samej sesji niczego nie dubluje
  end if;
  if v_status <> 'in_progress' then
    raise exception 'session_not_active' using errcode = '22023';
  end if;

  update public.session_exercises se
  set swapped_from_exercise_id = se.exercise_id,
      exercise_id = (x ->> 'exerciseId')::uuid
  from jsonb_array_elements(p_swaps) as x
  where se.id = (x ->> 'sessionExerciseId')::uuid
    and se.session_id = p_session_id
    and se.user_id = p_user_id;

  update public.session_exercises
  set skipped = true
  where session_id = p_session_id and user_id = p_user_id and id = any (p_skipped);

  delete from public.session_sets ss
  using public.session_exercises se
  where ss.session_exercise_id = se.id and se.session_id = p_session_id and se.user_id = p_user_id;

  insert into public.session_sets (session_exercise_id, user_id, set_index, set_type, load_kg, reps, rir, rpe, is_completed)
  select se.id,
         p_user_id,
         (x ->> 'setIndex')::smallint,
         coalesce(x ->> 'setType', 'working'),
         (x ->> 'loadKg')::numeric,
         (x ->> 'reps')::smallint,
         (x ->> 'rir')::numeric,
         (x ->> 'rpe')::numeric,
         coalesce((x ->> 'completed')::boolean, true)
  from jsonb_array_elements(p_sets) as x
  join public.session_exercises se
    on se.id = (x ->> 'sessionExerciseId')::uuid
   and se.session_id = p_session_id
   and se.user_id = p_user_id;
  get diagnostics v_inserted = row_count;
  if v_inserted <> jsonb_array_length(p_sets) then
    raise exception 'invalid_set_reference' using errcode = '22023';
  end if;

  update public.workout_sessions
  set status = 'completed',
      completed_at = p_completed_at,
      duration_seconds = greatest(0, extract(epoch from (p_completed_at - v_started))::integer),
      score = p_score,
      review = p_review,
      session_rpe = p_session_rpe
  where id = p_session_id;

  -- Starsze, nieprzyjęte propozycje dla tych ćwiczeń wygasają.
  update public.ai_recommendations r
  set status = 'expired'
  where r.user_id = p_user_id
    and r.kind = 'progression'
    and r.status = 'proposed'
    and r.exercise_id in (select (x ->> 'exerciseId')::uuid from jsonb_array_elements(p_recommendations) as x);

  insert into public.ai_recommendations (user_id, kind, exercise_id, session_id, payload, explanation, status, source, engine_version)
  select p_user_id, 'progression', (x ->> 'exerciseId')::uuid, p_session_id, x, x ->> 'explanation', 'proposed', 'engine', x ->> 'engineVersion'
  from jsonb_array_elements(p_recommendations) as x;

  insert into public.personal_records (user_id, exercise_id, kind, value, previous_value, session_id, achieved_at)
  select p_user_id, (x ->> 'exerciseId')::uuid, x ->> 'kind', (x ->> 'value')::numeric, (x ->> 'previous')::numeric, p_session_id, p_completed_at
  from jsonb_array_elements(p_records) as x;
end;
$$;

revoke execute on function public.plan_rank_for(uuid) from public, anon, authenticated;
revoke execute on function public.consume_quota(uuid, text, date, integer) from public, anon, authenticated;
revoke execute on function public.start_workout_session(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.complete_workout_session(uuid, uuid, jsonb, smallint, jsonb, jsonb, jsonb, uuid[], jsonb, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.plan_rank_for(uuid) to service_role;
grant execute on function public.consume_quota(uuid, text, date, integer) to service_role;
grant execute on function public.start_workout_session(uuid, uuid, uuid) to service_role;
grant execute on function public.complete_workout_session(uuid, uuid, jsonb, smallint, jsonb, jsonb, jsonb, uuid[], jsonb, numeric, timestamptz) to service_role;

-- =============================================================================
-- RLS
-- =============================================================================
do $$
declare
  r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end
$$;

-- Własne dane z pełnym zapisem (spójność rodzic–dziecko pilnują złożone klucze obce).
do $$
declare
  t text;
begin
  foreach t in array array[
    'user_equipment', 'goals', 'goal_milestones', 'measurements', 'exercise_preferences',
    'recovery_logs', 'notification_preferences', 'push_tokens', 'meals', 'meal_items'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete_own', t);
  end loop;

  -- Własne dane tylko do odczytu: zapisuje API (logika, pieniądze, AI).
  foreach t in array array[
    'workout_sessions', 'session_exercises', 'session_sets', 'personal_records', 'user_programs',
    'nutrition_targets', 'food_scans', 'ai_conversations', 'ai_messages', 'ai_recommendations',
    'subscriptions', 'payments', 'entitlements', 'entitlement_grants', 'usage_counters', 'billing_customers'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
  end loop;
end
$$;

create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy consents_select_own on public.consents for select to authenticated
  using (user_id = (select auth.uid()));
create policy consents_insert_own on public.consents for insert to authenticated
  with check (user_id = (select auth.uid()) and source in ('app', 'web'));

create policy user_limitations_select_own on public.user_limitations for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_limitations_insert_with_consent on public.user_limitations for insert to authenticated
  with check (user_id = (select auth.uid()) and public.has_consent('health_data'));
create policy user_limitations_update_with_consent on public.user_limitations for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.has_consent('health_data'));
create policy user_limitations_delete_own on public.user_limitations for delete to authenticated
  using (user_id = (select auth.uid()));

-- Alergeny to dane o zdrowiu: niepusta lista wymaga zgody 'health_data'.
create policy nutrition_profiles_select_own on public.nutrition_profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy nutrition_profiles_insert_own on public.nutrition_profiles for insert to authenticated
  with check (user_id = (select auth.uid()) and (cardinality(allergens) = 0 or public.has_consent('health_data')));
create policy nutrition_profiles_update_own on public.nutrition_profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (cardinality(allergens) = 0 or public.has_consent('health_data')));
create policy nutrition_profiles_delete_own on public.nutrition_profiles for delete to authenticated
  using (user_id = (select auth.uid()));

create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy organizations_select on public.organizations for select to authenticated using (true);
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or public.is_org_staff(org_id));

create policy plans_public_select on public.plans for select to anon, authenticated using (is_active);
create policy plan_features_public_select on public.plan_features for select to anon, authenticated using (true);
create policy prices_public_select on public.prices for select to anon, authenticated using (is_active);
create policy equipment_select on public.equipment for select to authenticated using (true);

create policy exercises_select on public.exercises for select to authenticated
  using ((is_published and public.has_plan(required_plan)) or (org_id is not null and public.is_org_staff(org_id)));
create policy exercises_staff_write on public.exercises for all to authenticated
  using (org_id is not null and public.is_org_staff(org_id))
  with check (org_id is not null and public.is_org_staff(org_id));

create policy exercise_relations_select on public.exercise_relations for select to authenticated
  using (exists (select 1 from public.exercises e where e.id = exercise_id));
create policy exercise_relations_staff_write on public.exercise_relations for all to authenticated
  using (exists (select 1 from public.exercises e where e.id = exercise_id and e.org_id is not null and public.is_org_staff(e.org_id)))
  with check (exists (select 1 from public.exercises e where e.id = exercise_id and e.org_id is not null and public.is_org_staff(e.org_id)));

create policy programs_select on public.programs for select to authenticated
  using (
    owner_user_id = (select auth.uid())
    or (org_id is not null and status = 'published' and public.has_plan(required_plan))
    or (org_id is not null and public.is_org_staff(org_id))
  );
create policy programs_owner_write on public.programs for all to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()) and org_id is null and required_plan = 'free');
create policy programs_staff_write on public.programs for all to authenticated
  using (org_id is not null and public.is_org_staff(org_id))
  with check (org_id is not null and public.is_org_staff(org_id));

create policy program_days_select on public.program_days for select to authenticated
  using (exists (select 1 from public.programs p where p.id = program_id));
create policy program_days_write on public.program_days for all to authenticated
  using (exists (select 1 from public.programs p where p.id = program_id
                 and (p.owner_user_id = (select auth.uid()) or (p.org_id is not null and public.is_org_staff(p.org_id)))))
  with check (exists (select 1 from public.programs p where p.id = program_id
                 and (p.owner_user_id = (select auth.uid()) or (p.org_id is not null and public.is_org_staff(p.org_id)))));

create policy program_exercises_select on public.program_exercises for select to authenticated
  using (exists (select 1 from public.program_days d where d.id = program_day_id));
create policy program_exercises_write on public.program_exercises for all to authenticated
  using (exists (select 1 from public.program_days d join public.programs p on p.id = d.program_id
                 where d.id = program_day_id
                   and (p.owner_user_id = (select auth.uid()) or (p.org_id is not null and public.is_org_staff(p.org_id)))))
  with check (exists (select 1 from public.program_days d join public.programs p on p.id = d.program_id
                 where d.id = program_day_id
                   and (p.owner_user_id = (select auth.uid()) or (p.org_id is not null and public.is_org_staff(p.org_id)))));

create policy food_items_select on public.food_items for select to authenticated using (true);
create policy food_items_insert_user on public.food_items for insert to authenticated
  with check (source = 'user' and created_by = (select auth.uid()) and is_verified = false);

create policy content_select on public.content for select to authenticated
  using ((status = 'published' and public.has_plan(required_plan)) or public.is_org_staff(org_id));
create policy content_staff_write on public.content for all to authenticated
  using (public.is_org_staff(org_id)) with check (public.is_org_staff(org_id));

-- ai_requests, billing_events, audit_logs: brak polityk = dostęp wyłącznie dla serwera.
