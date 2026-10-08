-- Dane deweloperskie (supabase db reset). Produkcyjne treści dodaje się w panelu.
-- Wartości odżywcze: orientacyjne dane typu USDA dla produktów ogólnych — do zastąpienia importem.
insert into public.exercises (id, org_id, slug, name_pl, category, plane, primary_muscles, equipment, difficulty, load_type, default_increment_kg, stress_tags, required_plan, is_published, is_unilateral) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'back-squat', 'Przysiad ze sztangą', 'squat', null, '{quadriceps,glutes}', '{barbell,squat_rack}', 3, 'external', 2.5, '{knee_deep_flexion,spinal_axial_load}', 'free', true, false),
  ('e0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'goblet-squat', 'Przysiad goblet', 'squat', null, '{quadriceps,glutes}', '{dumbbells}', 2, 'external', 2, '{knee_deep_flexion}', 'free', true, false),
  ('e0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'romanian-deadlift', 'Martwy ciąg rumuński', 'hinge', null, '{hamstrings,glutes}', '{barbell}', 3, 'external', 2.5, '{spinal_flexion_load}', 'free', true, false),
  ('e0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', 'db-romanian-deadlift', 'Martwy ciąg rumuński z hantlami', 'hinge', null, '{hamstrings,glutes}', '{dumbbells}', 2, 'external', 2, '{spinal_flexion_load}', 'free', true, false),
  ('e0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', 'hip-thrust', 'Hip thrust ze sztangą', 'hinge', null, '{glutes}', '{barbell,bench}', 2, 'external', 2.5, '{}', 'pro', true, false),
  ('e0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', 'glute-bridge', 'Most biodrowy', 'hinge', null, '{glutes}', '{bodyweight,mat}', 1, 'bodyweight', 0, '{}', 'free', true, false),
  ('e0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000001', 'bench-press', 'Wyciskanie sztangi leżąc', 'push', 'horizontal', '{chest,triceps,front_delts}', '{barbell,bench}', 3, 'external', 2.5, '{shoulder_horizontal_load}', 'free', true, false),
  ('e0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000001', 'db-bench-press', 'Wyciskanie hantli leżąc', 'push', 'horizontal', '{chest,triceps,front_delts}', '{dumbbells,bench}', 2, 'external', 2, '{shoulder_horizontal_load}', 'free', true, false),
  ('e0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000001', 'machine-chest-press', 'Wyciskanie na maszynie', 'push', 'horizontal', '{chest,triceps}', '{machine}', 1, 'external', 5, '{}', 'free', true, false),
  ('e0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000001', 'push-up', 'Pompki', 'push', 'horizontal', '{chest,triceps,core}', '{bodyweight}', 2, 'bodyweight', 0, '{wrist_extension}', 'free', true, false),
  ('e0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000001', 'incline-push-up', 'Pompki na podwyższeniu', 'push', 'horizontal', '{chest,triceps}', '{bodyweight,box}', 1, 'bodyweight', 0, '{wrist_extension}', 'free', true, false),
  ('e0000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000001', 'decline-push-up', 'Pompki z nogami na podwyższeniu', 'push', 'horizontal', '{chest,front_delts,triceps}', '{bodyweight,box}', 3, 'bodyweight', 0, '{wrist_extension}', 'free', true, false),
  ('e0000000-0000-4000-8000-000000000013', 'a0000000-0000-4000-8000-000000000001', 'overhead-press', 'Wyciskanie żołnierskie', 'push', 'vertical', '{shoulders,triceps}', '{barbell}', 3, 'external', 2.5, '{shoulder_overhead}', 'pro', true, false),
  ('e0000000-0000-4000-8000-000000000014', 'a0000000-0000-4000-8000-000000000001', 'lat-pulldown', 'Ściąganie drążka wyciągu górnego', 'pull', 'vertical', '{lats,biceps}', '{cable}', 1, 'external', 2.5, '{}', 'free', true, false),
  ('e0000000-0000-4000-8000-000000000015', 'a0000000-0000-4000-8000-000000000001', 'pull-up', 'Podciąganie nachwytem', 'pull', 'vertical', '{lats,biceps}', '{pullup_bar}', 4, 'bodyweight', 0, '{shoulder_overhead}', 'pro', true, false),
  ('e0000000-0000-4000-8000-000000000016', 'a0000000-0000-4000-8000-000000000001', 'one-arm-db-row', 'Wiosłowanie hantlem jednorącz', 'pull', 'horizontal', '{lats,mid_back}', '{dumbbells,bench}', 2, 'external', 2, '{}', 'free', true, true),
  ('e0000000-0000-4000-8000-000000000017', 'a0000000-0000-4000-8000-000000000001', 'seated-cable-row', 'Wiosłowanie na wyciągu siedząc', 'pull', 'horizontal', '{lats,mid_back}', '{cable}', 1, 'external', 2.5, '{}', 'free', true, false),
  ('e0000000-0000-4000-8000-000000000018', 'a0000000-0000-4000-8000-000000000001', 'walking-lunge', 'Wykroki chodzone z hantlami', 'lunge', null, '{quadriceps,glutes}', '{dumbbells}', 2, 'external', 2, '{knee_deep_flexion}', 'free', true, true),
  ('e0000000-0000-4000-8000-000000000019', 'a0000000-0000-4000-8000-000000000001', 'plank', 'Deska (plank)', 'core', null, '{core}', '{bodyweight,mat}', 1, 'time', 0, '{}', 'free', true, false),
  ('e0000000-0000-4000-8000-000000000020', 'a0000000-0000-4000-8000-000000000001', 'dead-bug', 'Dead bug', 'core', null, '{core}', '{bodyweight,mat}', 1, 'bodyweight', 0, '{}', 'free', true, false)
on conflict (id) do nothing;

insert into public.exercise_relations (exercise_id, related_exercise_id, relation, priority) values
  ('e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'regression', 1),
  ('e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000004', 'alternative', 1),
  ('e0000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000005', 'progression', 1),
  ('e0000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000008', 'alternative', 1),
  ('e0000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000009', 'alternative', 2),
  ('e0000000-0000-4000-8000-000000000007', 'e0000000-0000-4000-8000-000000000010', 'alternative', 3),
  ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000011', 'regression', 1),
  ('e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000012', 'progression', 1),
  ('e0000000-0000-4000-8000-000000000011', 'e0000000-0000-4000-8000-000000000010', 'progression', 1),
  ('e0000000-0000-4000-8000-000000000014', 'e0000000-0000-4000-8000-000000000015', 'progression', 1),
  ('e0000000-0000-4000-8000-000000000015', 'e0000000-0000-4000-8000-000000000014', 'regression', 1),
  ('e0000000-0000-4000-8000-000000000016', 'e0000000-0000-4000-8000-000000000017', 'alternative', 1)
on conflict do nothing;

insert into public.programs (id, org_id, title, goal, level, days_per_week, location, source, status, required_plan) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'MP POWER Start — Full Body A/B', 'fitness', 'beginner', 3, 'gym', 'template', 'published', 'free')
on conflict (id) do nothing;

insert into public.program_days (id, program_id, day_index, title, focus, estimated_minutes) values
  ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 1, 'Full Body A', 'przysiad, wyciskanie, wiosłowanie', 50),
  ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 2, 'Full Body B', 'zawias biodrowy, pompki, przyciąganie', 50)
on conflict (id) do nothing;

insert into public.program_exercises (program_day_id, exercise_id, order_index, block, sets, rep_min, rep_max, target_rir, tempo, rest_seconds, progression_model) values
  ('d0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 1, 'main', 3, 8, 12, 2, '3-1-1-0', 120, 'double_progression'),
  ('d0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000008', 2, 'main', 3, 8, 12, 2, '2-1-1-0', 120, 'double_progression'),
  ('d0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000016', 3, 'main', 3, 8, 12, 2, '2-0-1-1', 90, 'double_progression'),
  ('d0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000006', 4, 'accessory', 3, 10, 15, 2, '2-1-1-1', 60, 'double_progression'),
  ('d0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000019', 5, 'finisher', 3, 20, 40, 2, null, 60, 'double_progression'),
  ('d0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000004', 1, 'main', 3, 8, 12, 2, '3-1-1-0', 120, 'double_progression'),
  ('d0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000010', 2, 'main', 3, 6, 12, 2, '2-1-1-0', 90, 'double_progression'),
  ('d0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000014', 3, 'main', 3, 8, 12, 2, '2-0-1-1', 90, 'double_progression'),
  ('d0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000018', 4, 'accessory', 2, 8, 12, 2, null, 90, 'double_progression'),
  ('d0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000020', 5, 'finisher', 3, 8, 12, 2, null, 60, 'double_progression')
on conflict do nothing;

insert into public.food_items (source, name_pl, name_en, kcal_100g, protein_100g, carbs_100g, fat_100g, fiber_100g, default_portion_g) values
  ('seed', 'Pierś z kurczaka pieczona, bez skóry', 'Chicken breast, roasted, skinless', 165, 31.0, 0, 3.6, 0, 150),
  ('seed', 'Ryż biały gotowany', 'White rice, cooked', 130, 2.7, 28.2, 0.3, 0.4, 200),
  ('seed', 'Płatki owsiane', 'Oats, rolled', 389, 16.9, 66.3, 6.9, 10.6, 50),
  ('seed', 'Jajko kurze całe', 'Egg, whole, raw', 143, 12.6, 0.7, 9.5, 0, 55),
  ('seed', 'Banan', 'Banana, raw', 89, 1.1, 22.8, 0.3, 2.6, 120),
  ('seed', 'Ziemniaki gotowane bez skórki', 'Potatoes, boiled, without skin', 86, 1.7, 20.0, 0.1, 1.8, 200),
  ('seed', 'Oliwa z oliwek', 'Olive oil', 884, 0, 0, 100, 0, 10),
  ('seed', 'Brokuł surowy', 'Broccoli, raw', 34, 2.8, 6.6, 0.4, 2.6, 100),
  ('seed', 'Jogurt grecki naturalny 0%', 'Greek yogurt, plain, nonfat', 59, 10.2, 3.6, 0.4, 0, 150),
  ('seed', 'Łosoś atlantycki hodowlany, pieczony', 'Salmon, Atlantic, farmed, cooked', 206, 22.1, 0, 12.4, 0, 150);
