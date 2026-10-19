-- ===========================================================================
-- 0028  Count unsubmitted lessons from the ROUTINE, not from session rows
-- ---------------------------------------------------------------------------
-- A real defect found by looking at the student attendance page: the
-- "N scheduled lessons have no attendance submitted yet" notice could never
-- appear, because the figure behind it was always zero.
--
-- student_attendance_stats computed `unsubmitted_scheduled` as:
--
--     teaching_sessions where submitted_at is null
--
-- but a teaching_session row is only CREATED when a teacher submits. A lesson
-- nobody has touched has no row at all, so the query counted a state that
-- essentially never exists. The number was not wrong in a subtle way — it was
-- structurally incapable of being right.
--
-- That matters because this figure is the student-facing half of the invariant
-- the whole module rests on. A percentage of "3 of 3, 100%" is honest only if
-- the student can also see that nine other lessons that week are still
-- outstanding. Without it, a 100% from one submitted lesson looks like a full
-- month's attendance.
--
-- The fix derives expected occurrences from the routine, the same way
-- pending_attendance already does: walk the dates in the window, skip
-- weekends, holidays and cancellations, and count the ones with no submitted
-- session. Those lessons are still NEVER counted as absence — they are
-- reported separately, which is the entire point.
-- ===========================================================================

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
  v_visible     boolean;
  v_result      jsonb;
  v_unsubmitted bigint;
begin
  -- coalesce so a NULL anywhere denies the read rather than skipping the
  -- check. See migration 0027 for the bug that made this necessary.
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
    -- The denominator: lessons actually submitted, in which this student has a
    -- recorded status. Never the number of lessons scheduled.
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

  -- --------------------------------------------------------------------
  -- Expected occurrences of this student's routine with nothing submitted.
  -- Derived from routine_periods, because an untouched lesson has no
  -- teaching_sessions row to count.
  -- --------------------------------------------------------------------
  select count(*)
    into v_unsubmitted
  from generate_series(p_from, p_to, interval '1 day') d
  join public.student_enrollments se
    on se.student_id = p_student_id
   and se.status = 'active'
  join public.routine_periods rp
    on rp.section_id = se.section_id
   and rp.academic_year_id = se.academic_year_id
   and rp.weekday = extract(dow from d)::smallint
   and rp.effective_from <= d::date
   and (rp.effective_to is null or rp.effective_to >= d::date)
  where
    -- Not a non-teaching weekday.
    extract(dow from d)::smallint not in (select weekday from public.school_weekends)
    -- Not a holiday for this class.
    and not exists (
      select 1 from public.school_holidays h
      where h.holiday_date = d::date
        and h.academic_year_id = rp.academic_year_id
        and (h.class_id is null or h.class_id = rp.class_id)
    )
    -- Not cancelled on that date.
    and not exists (
      select 1 from public.cancelled_periods cp
      where cp.routine_period_id = rp.id and cp.occurs_on = d::date
    )
    -- And not already submitted.
    and not exists (
      select 1 from public.teaching_sessions ts2
      where ts2.routine_period_id = rp.id
        and ts2.session_date = d::date
        and ts2.submitted_at is not null
    );

  return v_result || jsonb_build_object('unsubmitted_scheduled', v_unsubmitted);
end;
$$;

comment on function public.student_attendance_stats(uuid, date, date) is
  'Attendance for one student. Denominator is submitted lessons only; unsubmitted lessons are derived from the routine and reported separately, never as absence.';

revoke all on function public.student_attendance_stats(uuid, date, date) from public, anon;
grant execute on function public.student_attendance_stats(uuid, date, date) to authenticated;
