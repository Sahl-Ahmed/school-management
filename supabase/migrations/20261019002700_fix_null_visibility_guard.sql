-- ===========================================================================
-- 0027  Fix a NULL-propagation hole in the attendance visibility guard
-- ---------------------------------------------------------------------------
-- A real access-control bug, found by a test asserting that a teacher cannot
-- read the attendance of a student they do not teach. The read SUCCEEDED.
--
-- The cause is three-valued logic. app.owns_student_record was:
--
--     select p_student_id is not null and p_student_id = app.current_student_id();
--
-- For a TEACHER, app.current_student_id() is NULL, so the comparison
-- `p_student_id = NULL` evaluates to NULL — not false. `true and NULL` is NULL,
-- so the function returned NULL rather than false.
--
-- student_attendance_stats then did:
--
--     v_visible := app.is_authority() or app.owns_student_record(...) or (...);
--     if not v_visible then raise ...
--
-- which became `false or NULL or false` = NULL, and `not NULL` = NULL. An IF on
-- NULL does not take its branch, so the guard was skipped entirely and the
-- function returned another student's attendance to any teacher who asked.
--
-- Two fixes, because either alone would leave the trap set for the next caller:
--
--   1. owns_student_record returns a real boolean, never NULL.
--   2. The guard wraps the whole expression in coalesce(..., false), so a NULL
--      from any future helper denies rather than permits.
--
-- The same NULL-returning shape appears nowhere else: every other app.* helper
-- already wraps its result in coalesce or uses `exists`, which cannot be NULL.
-- ===========================================================================

create or replace function app.owns_student_record(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- coalesce is load-bearing: without it this returns NULL for any caller who
  -- is not a student, and NULL defeats an `if not ...` guard.
  select coalesce(
    p_student_id is not null
      and p_student_id = app.current_student_id(),
    false
  );
$$;

comment on function app.owns_student_record(uuid) is
  'True only when the caller IS this student. Returns false, never NULL, so it cannot defeat a NOT guard.';

-- --------------------------------------------------------------------------
-- Re-create the guard with a fail-closed default.
-- --------------------------------------------------------------------------
create or replace function public.student_attendance_stats(
  p_student_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_visible boolean;
  v_result  jsonb;
begin
  -- Wrapped in coalesce so that a NULL anywhere in this expression denies the
  -- read instead of skipping the check.
  v_visible := coalesce(
    app.is_authority()
    or app.owns_student_record(p_student_id)
    or (app.is_teacher() and app.teaches_student(p_student_id)),
    false
  );

  if not v_visible then
    raise exception 'not permitted to read this student''s attendance'
      using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'present',   count(*) filter (where sa.status in ('present', 'late')),
    'late',      count(*) filter (where sa.status = 'late'),
    'absent',    count(*) filter (where sa.status = 'absent'),
    'excused',   count(*) filter (where sa.status = 'excused'),
    'submitted', count(sa.id),
    'from', p_from,
    'to', p_to
  )
  into v_result
  from public.teaching_sessions ts
  join public.student_attendance sa
    on sa.teaching_session_id = ts.id
   and sa.student_id = p_student_id
  where ts.submitted_at is not null
    and not ts.is_cancelled
    and ts.session_date between p_from and p_to;

  return v_result || jsonb_build_object(
    'unsubmitted_scheduled', (
      select count(*)
      from public.teaching_sessions ts2
      join public.student_enrollments se
        on se.section_id = ts2.section_id
       and se.student_id = p_student_id
       and se.status = 'active'
      where ts2.submitted_at is null
        and not ts2.is_cancelled
        and ts2.session_date between p_from and p_to
    )
  );
end;
$$;

comment on function public.student_attendance_stats(uuid, date, date) is
  'Attendance counts for one student. Denominator is submitted lessons only. Visibility check fails closed on NULL.';

-- --------------------------------------------------------------------------
-- The per-subject breakdown carries the same expression in a WHERE clause.
-- There a NULL simply filters the row out, so it already failed closed — but
-- it is made explicit here so the two cannot diverge later.
-- --------------------------------------------------------------------------
create or replace function public.student_attendance_by_subject(
  p_student_id uuid,
  p_from date,
  p_to date
)
returns table (
  subject_id   uuid,
  subject_name text,
  present      bigint,
  absent       bigint,
  submitted    bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.name,
    count(*) filter (where sa.status in ('present', 'late')),
    count(*) filter (where sa.status = 'absent'),
    count(sa.id)
  from public.teaching_sessions ts
  join public.student_attendance sa
    on sa.teaching_session_id = ts.id
   and sa.student_id = p_student_id
  join public.subjects s on s.id = ts.subject_id
  where ts.submitted_at is not null
    and not ts.is_cancelled
    and ts.session_date between p_from and p_to
    and coalesce(
      app.is_authority()
      or app.owns_student_record(p_student_id)
      or (app.is_teacher() and app.teaches_student(p_student_id)),
      false
    )
  group by s.id, s.name
  order by s.name;
$$;

revoke all on function public.student_attendance_stats(uuid, date, date) from public, anon;
grant execute on function public.student_attendance_stats(uuid, date, date) to authenticated;
revoke all on function public.student_attendance_by_subject(uuid, date, date) from public, anon;
grant execute on function public.student_attendance_by_subject(uuid, date, date) to authenticated;
grant execute on function app.owns_student_record(uuid) to authenticated;
