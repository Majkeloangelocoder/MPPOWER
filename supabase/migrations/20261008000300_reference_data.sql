-- Dane referencyjne potrzebne w każdym środowisku (także produkcji).
insert into public.organizations (id, slug, name)
values ('a0000000-0000-4000-8000-000000000001', 'mp-power', 'MP POWER')
on conflict (id) do nothing;

insert into public.plans (code, name, rank) values
  ('free', 'FREE', 0),
  ('pro', 'PRO', 1),
  ('premium', 'PREMIUM', 2)
on conflict (code) do nothing;

-- Startowe limity (zgodne z DEFAULT_PLANS w packages/core) — zmieniane później w panelu.
insert into public.plan_features (plan_code, feature_key, enabled, quota_limit, quota_period) values
  ('free', 'ai_coach', true, 5, 'week'),
  ('pro', 'exercise_library_full', true, null, null),
  ('pro', 'program_generator', true, null, null),
  ('pro', 'progression_advanced', true, null, null),
  ('pro', 'ai_session_review', true, null, null),
  ('pro', 'ai_coach', true, 50, 'day'),
  ('pro', 'nutrition_targets', true, null, null),
  ('pro', 'food_scanner', true, 10, 'day'),
  ('pro', 'advanced_stats', true, null, null),
  ('pro', 'weekly_review', true, null, null),
  ('pro', 'progress_photos', true, null, null),
  ('premium', 'exercise_library_full', true, null, null),
  ('premium', 'program_generator', true, null, null),
  ('premium', 'progression_advanced', true, null, null),
  ('premium', 'ai_session_review', true, null, null),
  ('premium', 'ai_coach', true, 150, 'day'),
  ('premium', 'nutrition_targets', true, null, null),
  ('premium', 'food_scanner', true, 25, 'day'),
  ('premium', 'advanced_stats', true, null, null),
  ('premium', 'weekly_review', true, null, null),
  ('premium', 'progress_photos', true, null, null),
  ('premium', 'body_scan', true, 4, 'month'),
  ('premium', 'technique_analysis', true, 20, 'month')
on conflict (plan_code, feature_key) do nothing;

insert into public.equipment (code, name_pl, category, default_increment_kg) values
  ('barbell', 'Sztanga', 'free_weight', 2.5),
  ('dumbbells', 'Hantle', 'free_weight', 2),
  ('kettlebell', 'Kettlebell', 'free_weight', 4),
  ('ez_bar', 'Gryf łamany', 'free_weight', 2.5),
  ('machine', 'Maszyna', 'machine', 5),
  ('cable', 'Wyciąg', 'machine', 2.5),
  ('smith', 'Suwnica Smitha', 'machine', 2.5),
  ('bench', 'Ławka', 'accessory', 0),
  ('squat_rack', 'Klatka / stojaki', 'accessory', 0),
  ('pullup_bar', 'Drążek', 'accessory', 0),
  ('bands', 'Gumy oporowe', 'accessory', 0),
  ('box', 'Skrzynia / stopień', 'accessory', 0),
  ('mat', 'Mata', 'accessory', 0),
  ('bodyweight', 'Masa ciała', 'bodyweight', 0)
on conflict (code) do nothing;
