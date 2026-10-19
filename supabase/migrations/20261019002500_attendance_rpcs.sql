-- ===========================================================================
-- 0025  Attendance submission and statistics
-- ---------------------------------------------------------------------------
-- The invariant this module exists to protect, restated because every function
-- below depends on it:
--
--   A lesson whose teacher has NOT submitted attendance has no
--   student_attendance rows, and is EXCLUDED from every percentage.
--   It is never counted as an absence.
--
-- So a percentage is always `present / submitted`, never `present / scheduled`.
-- A student with one submitted lesson out of five scheduled, in which they were
-- present, has 100% attendance — not 20%. The four unsubmitted lessons are a
-- teacher's outstanding task, not the student's absence.
--
-- Submitting attendance writes a teaching_session plus one row per student and
-- sets submitted_at, all in one transaction. Doing it as separate calls would
-- allow a half-submitted lesson: submitted_at set with rows missing, which
-- would then read as "everyone absent" for the students whose rows never
-- arrived. That is precisely the failure mode the invariant forbids, so the
-- write is atomic.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- submit_attendance
-- ---------------------------------------------------------------------------
-- p_entries is [{ "student_id": "...", "status": "present|absent|late|excused",
--                 "remark": "..." }, ...]
--
-- Called for a first submission and for a correction alike. A correction
-- requires a reason, which is recorded in audit_logs by the generic trigger.
-- --------------------------------------------------------------------------
create or replace function public.submit_attendance(
  p_routine_period_id uuid,
  p_session_date date,
  p_entries jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_teacher uuid := app.current_teacher_id();
  v_is_authority   boolean := app.is_authority();
  v_period         public.routine_periods%rowtype;
  v_session_id     uuid;
  v_existing       public.teaching_sessions%rowtype;
  v_entry          jsonb;
  v_student        uuid;
  v_enrolled       boolean;
  v_count          integer := 0;
  v_is_correction  boolean := false;
  v_holiday        boolean;
  v_cancelled      boolean;
begin
  select * into v_period
  from public.routine_periods
  where id = p_routine_period_id;

  if not found then
    raise exception 'no such scheduled period' using errcode = 'no_data_found';
  end if;

  -- Only the teacher the routine names, or the authority, may submit.
  if not v_is_authority and v_period.teacher_id is distinct from v_caller_teacher then
    raise exception 'you are not the teacher scheduled for this period'
      using errcode = 'insufficient_privilege';
  end if;

  -- The date must actually be an occurrence of this period.
  if extract(dow from p_session_date)::smallint <> v_period.weekday then
    raise exception 'that date is not a % for this period',
      to_char(p_session_date, 'Day')
      using errcode = 'check_violation';
  end if;

  if p_session_date < v_period.effective_from
     or (v_period.effective_to is not null and p_session_date > v_period.effective_to) then
    raise exception 'that date falls outside the period''s effective dates'
      using errcode = 'check_violation';
  end if;

  -- A holiday or a cancelled period has no lesson to attend, so attendance
  -- cannot be recorded against it. Without this check a mistaken submission on
  -- a holiday would create a denominator that should not exist.
  select exists (
    select 1 from public.school_holidays h
    where h.holiday_date = p_session_date
      and h.academic_year_id = v_period.academic_year_id
      and (h.class_id is null or h.class_id = v_period.class_id)
  ) into v_holiday;

  if v_holiday then
    raise exception 'that date is a school holiday' using errcode = 'check_violation';
  end if;

  select exists (
    select 1 from public.cancelled_periods c
    where c.routine_period_id = p_routine_period_id
      and c.occurs_on = p_session_date
  ) into v_cancelled;

  if v_cancelled then
    raise exception 'this period was cancelled on that date'
      using errcode = 'check_violation';
  end if;

  -- One session per period per date, created on first submission.
  select * into v_existing
  from public.teaching_sessions
  where routine_period_id = p_routine_period_id
    and session_date = p_session_date
  for update;

  if found then
    v_session_id := v_existing.id;
    v_is_correction := v_existing.submitted_at is not null;

    if v_is_correction and coalesce(btrim(p_reason), '') = '' then
      raise exception 'correcting submitted attendance requires a reason'
        using errcode = 'check_violation';
    end if;
  else
    insert into public.teaching_sessions (
      routine_period_id, session_date, class_id, section_id, subject_id,
      teacher_id, period_no, starts_at, ends_at
    )
    values (
      p_routine_period_id, p_session_date, v_period.class_id, v_period.section_id,
      v_period.subject_id, v_period.teacher_id, v_period.period_no,
      v_period.starts_at, v_period.ends_at
    )
    returning id into v_session_id;
  end if;

  for v_entry in select * from jsonb_array_elements(p_entries)
  loop
    v_student := (v_entry ->> 'student_id')::uuid;

    -- Only students actually enrolled in this section for this year may be
    -- marked, so a crafted payload cannot write attendance for someone else's
    -- student.
    select exists (
      select 1 from public.student_enrollments se
      where se.student_id = v_student
        and se.section_id = v_period.section_id
        and se.academic_year_id = v_period.academic_year_id
        and se.status = 'active'
    ) into v_enrolled;

    if not v_enrolled then
      raise exception 'student % is not enrolled in this section', v_student
        using errcode = 'foreign_key_violation';
    end if;

    insert into public.student_attendance (
      teaching_session_id, student_id, status, remark, marked_by
    )
    values (
      v_session_id,
      v_student,
      (v_entry ->> 'status')::public.attendance_status,
      nullif(btrim(coalesce(v_entry ->> 'remark', '')), ''),
      auth.uid()
    )
    on conflict (teaching_session_id, student_id) do update
      set status    = excluded.status,
          remark    = excluded.remark,
          marked_by = excluded.marked_by,
          marked_at = now();

    v_count := v_count + 1;
  end loop;

  -- submitted_at is set LAST, after every student row is written. If anything
  -- above raised, the whole statement rolls back and the lesson stays
  -- unsubmitted — which is the correct state, not "everyone absent".
  update public.teaching_sessions
     set submitted_at = coalesce(submitted_at, now()),
         submitted_by = auth.uid(),
         updated_at   = now()
   where id = v_session_id;

  return jsonb_build_object(
    'session_id', v_session_id,
    'marked', v_count,
    'correction', v_is_correction
  );
end;
$$;

comment on function public.submit_attendance(uuid, date, jsonb, text) is
  'Atomic attendance submission. submitted_at is set only after every student row is written.';

revoke all on function public.submit_attendance(uuid, date, jsonb, text) from public, anon;
grant execute on function public.submit_attendance(uuid, date, jsonb, text) to authenticated;

-- ===========================================================================
-- Statistics
-- ---------------------------------------------------------------------------
-- All of these count SUBMITTED, non-cancelled sessions only. The
-- `scheduled_periods` figure is returned alongside so a caller can show how
-- much is still outstanding — but it is never the denominator of a percentage.
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
  v_visible boolean;
  v_result  jsonb;
begin
  -- This function bypasses RLS, so it checks visibility itself: the student
  -- themselves, a teacher who teaches them, or the authority.
  v_visible :=
    app.is_authority()
    or app.owns_student_record(p_student_id)
    or ((select app.is_teacher()) and app.teaches_student(p_student_id));

  if not v_visible then
    raise exception 'not permitted to read this student''s attendance'
      using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'present',   count(*) filter (where sa.status in ('present', 'late')),
    'late',      count(*) filter (where sa.status = 'late'),
    'absent',    count(*) filter (where sa.status = 'absent'),
    'excused',   count(*) filter (where sa.status = 'excused'),
    -- The denominator: lessons whose attendance was actually submitted AND in
    -- which this student has a recorded status.
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

  -- Scheduled-but-unsubmitted, reported separately and never as absence.
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
  'Attendance counts for one student. The denominator is submitted lessons only; unsubmitted ones are reported separately.';

revoke all on function public.student_attendance_stats(uuid, date, date) from public, anon;
grant execute on function public.student_attendance_stats(uuid, date, date) to authenticated;

-- --------------------------------------------------------------------------
-- Per-subject breakdown for a student, for the month/subject views
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
    and (
      app.is_authority()
      or app.owns_student_record(p_student_id)
      or ((select app.is_teacher()) and app.teaches_student(p_student_id))
    )
  group by s.id, s.name
  order by s.name;
$$;

revoke all on function public.student_attendance_by_subject(uuid, date, date) from public, anon;
grant execute on function public.student_attendance_by_subject(uuid, date, date) to authenticated;

-- --------------------------------------------------------------------------
-- Class/section averages, for the class overview and the dashboard
-- --------------------------------------------------------------------------
-- Returns the average across students of (present / submitted), plus the raw
-- totals so a caller can show the denominator. Authority only.
-- --------------------------------------------------------------------------
create or replace function public.section_attendance_stats(
  p_academic_year_id uuid,
  p_from date,
  p_to date
)
returns table (
  section_id      uuid,
  class_id        uuid,
  class_name      text,
  section_name    text,
  level_order     integer,
  students        bigint,
  male            bigint,
  female          bigint,
  present_marks   bigint,
  submitted_marks bigint,
  unsubmitted_sessions bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with roster as (
    select se.section_id, se.student_id, st.gender
    from public.student_enrollments se
    join public.students st on st.id = se.student_id
    where se.academic_year_id = p_academic_year_id
      and se.status = 'active'
  ),
  marks as (
    select
      ts.section_id,
      count(*) filter (where sa.status in ('present', 'late')) as present_marks,
      count(sa.id) as submitted_marks
    from public.teaching_sessions ts
    join public.student_attendance sa on sa.teaching_session_id = ts.id
    where ts.submitted_at is not null
      and not ts.is_cancelled
      and ts.session_date between p_from and p_to
    group by ts.section_id
  ),
  pending as (
    select ts.section_id, count(*) as unsubmitted
    from public.teaching_sessions ts
    where ts.submitted_at is null
      and not ts.is_cancelled
      and ts.session_date between p_from and p_to
    group by ts.section_id
  )
  select
    sec.id,
    c.id,
    c.name,
    sec.name,
    c.level_order,
    count(r.student_id),
    count(r.student_id) filter (where r.gender = 'male'),
    count(r.student_id) filter (where r.gender = 'female'),
    coalesce(max(m.present_marks), 0),
    coalesce(max(m.submitted_marks), 0),
    coalesce(max(p.unsubmitted), 0)
  from public.sections sec
  join public.classes c on c.id = sec.class_id
  left join roster r on r.section_id = sec.id
  left join marks m on m.section_id = sec.id
  left join pending p on p.section_id = sec.id
  where app.is_authority()
    and sec.is_active
  group by sec.id, c.id, c.name, sec.name, c.level_order
  order by c.level_order, sec.name;
$$;

comment on function public.section_attendance_stats(uuid, date, date) is
  'Per-section roster and attendance totals. Authority only. Percentages derive from submitted_marks.';

revoke all on function public.section_attendance_stats(uuid, date, date) from public, anon;
grant execute on function public.section_attendance_stats(uuid, date, date) to authenticated;

-- --------------------------------------------------------------------------
-- Lessons still awaiting submission, for the teacher's to-do list and the
-- authority's overdue view
-- --------------------------------------------------------------------------
-- Returns expected occurrences of the routine in a date window that have no
-- submitted session, skipping weekends, holidays and cancellations. This is
-- what makes "not submitted" visible as work outstanding rather than silently
-- becoming absence.
-- --------------------------------------------------------------------------
create or replace function public.pending_attendance(
  p_from date,
  p_to date,
  p_teacher_id uuid default null
)
returns table (
  routine_period_id uuid,
  session_date      date,
  class_name        text,
  section_name      text,
  subject_name      text,
  teacher_id        uuid,
  teacher_name      text,
  period_no         smallint,
  starts_at         time,
  ends_at           time
)
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select d::date as day
    from generate_series(p_from, p_to, interval '1 day') d
    where extract(dow from d)::smallint not in (
      select weekday from public.school_weekends
    )
  ),
  scope as (
    -- A teacher may only ask about their own; the authority about anyone.
    select case
      when app.is_authority() then coalesce(p_teacher_id, '00000000-0000-0000-0000-000000000000'::uuid)
      else app.current_teacher_id()
    end as teacher_filter,
    app.is_authority() as all_teachers
  )
  select
    rp.id,
    d.day,
    c.name,
    sec.name,
    subj.name,
    rp.teacher_id,
    t.full_name,
    rp.period_no,
    rp.starts_at,
    rp.ends_at
  from days d
  cross join scope sc
  join public.routine_periods rp
    on rp.weekday = extract(dow from d.day)::smallint
   and rp.effective_from <= d.day
   and (rp.effective_to is null or rp.effective_to >= d.day)
  join public.classes c on c.id = rp.class_id
  join public.sections sec on sec.id = rp.section_id
  join public.subjects subj on subj.id = rp.subject_id
  join public.teachers t on t.id = rp.teacher_id
  where (
      (sc.all_teachers and (p_teacher_id is null or rp.teacher_id = p_teacher_id))
      or rp.teacher_id = sc.teacher_filter
    )
    -- Not a holiday for this class.
    and not exists (
      select 1 from public.school_holidays h
      where h.holiday_date = d.day
        and h.academic_year_id = rp.academic_year_id
        and (h.class_id is null or h.class_id = rp.class_id)
    )
    -- Not cancelled on that date.
    and not exists (
      select 1 from public.cancelled_periods cp
      where cp.routine_period_id = rp.id and cp.occurs_on = d.day
    )
    -- And not already submitted.
    and not exists (
      select 1 from public.teaching_sessions ts
      where ts.routine_period_id = rp.id
        and ts.session_date = d.day
        and ts.submitted_at is not null
    )
  order by d.day, rp.starts_at;
$$;

comment on function public.pending_attendance(date, date, uuid) is
  'Expected routine occurrences with no submitted attendance. Skips weekends, holidays and cancellations.';

revoke all on function public.pending_attendance(date, date, uuid) from public, anon;
grant execute on function public.pending_attendance(date, date, uuid) to authenticated;
