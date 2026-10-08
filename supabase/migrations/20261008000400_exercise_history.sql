-- Historia wykonań dla silnika progresji jednym zapytaniem: ostatnie N wykonań każdego ćwiczenia
-- (tylko serie robocze, posortowane). Wywołuje wyłącznie API kluczem serwisowym.
create or replace function public.exercise_history(
  p_user_id uuid,
  p_exercise_ids uuid[],
  p_exclude_session uuid,
  p_per_exercise integer default 6
)
returns table (exercise_id uuid, session_id uuid, performed_at timestamptz, sets jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select x.exercise_id, x.session_id, x.performed_at, x.sets
  from (
    select se.exercise_id,
           s.id as session_id,
           s.completed_at as performed_at,
           (
             select coalesce(
               jsonb_agg(
                 jsonb_build_object('loadKg', ss.load_kg, 'reps', ss.reps, 'rir', ss.rir, 'rpe', ss.rpe, 'completed', ss.is_completed)
                 order by ss.set_index
               ),
               '[]'::jsonb
             )
             from public.session_sets ss
             where ss.session_exercise_id = se.id
               and ss.user_id = p_user_id
               and ss.set_type = 'working'
           ) as sets,
           row_number() over (partition by se.exercise_id order by s.completed_at desc) as rn
    from public.session_exercises se
    join public.workout_sessions s on s.id = se.session_id and s.user_id = se.user_id
    where se.user_id = p_user_id
      and se.exercise_id = any (p_exercise_ids)
      and se.skipped = false
      and s.status = 'completed'
      and s.id <> p_exclude_session
  ) x
  where x.rn <= p_per_exercise
  order by x.exercise_id, x.performed_at;
$$;

revoke execute on function public.exercise_history(uuid, uuid[], uuid, integer) from public, anon, authenticated;
grant execute on function public.exercise_history(uuid, uuid[], uuid, integer) to service_role;
