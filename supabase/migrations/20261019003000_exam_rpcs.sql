-- ===========================================================================
-- 0030  Exams: grading rules, mark entry, submission tracking, publishing
-- ---------------------------------------------------------------------------
-- The owner confirmed the policy this implements:
--
--   * Standard GPA-5 scale — A+ 80-100 = 5.0, A 70-79 = 4.0, A- 60-69 = 3.5,
--     B 50-59 = 3.0, C 40-49 = 2.0, D 33-39 = 1.0, F below 33 = 0.0.
--   * A student must reach the pass mark in EVERY subject to pass the term.
--
-- Both remain configuration rather than code: the bands live in grade_bands,
-- and the pass rule is a column on grading_scales, so a later change is a data
-- change. Nothing below hard-codes a threshold.
--
-- The invariant this module protects: a draft mark is private until the
-- authority publishes. Teachers write marks; students read published_results.
-- Students hold no policy on `marks` at all, so a half-entered exam cannot be
-- seen, and publishing writes an immutable snapshot so a later correction
-- cannot silently rewrite a sheet a parent already received.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Pass rule, as configuration
-- --------------------------------------------------------------------------
create type public.pass_rule as enum (
  -- Confirmed default: every subject must reach the pass mark.
  'all_subjects',
  -- Pass on the overall percentage even with a failed subject.
  'average',
  -- Tolerate exactly one failed subject if the average passes.
  'allow_one_fail'
);

alter table public.grading_scales
  add column if not exists pass_rule public.pass_rule not null default 'all_subjects',
  -- Bangladeshi convention prints GPA 0.00 when any subject is failed, rather
  -- than an average that would look like a pass. The computed average is kept
  -- in the snapshot either way, so the information is never lost.
  add column if not exists fail_zeroes_gpa boolean not null default true,
  -- Classes at or below this level print grades and marks but no GPA figure.
  -- NULL means every class gets a GPA.
  add column if not exists no_gpa_below_level integer;

comment on column public.grading_scales.pass_rule is
  'How the overall term result is decided. The owner confirmed all_subjects.';
comment on column public.grading_scales.fail_zeroes_gpa is
  'Print GPA 0.00 when any subject is failed, per Bangladeshi convention. The computed average is still kept in the result snapshot.';

-- --------------------------------------------------------------------------
-- app.grade_for — the single place a percentage becomes a grade
-- --------------------------------------------------------------------------
create or replace function app.grade_for(p_scale_id uuid, p_pct numeric)
returns table (grade text, grade_point numeric, is_pass boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select gb.grade, gb.grade_point, gb.is_pass
  from public.grade_bands gb
  where gb.scale_id = p_scale_id
    and p_pct >= gb.min_pct
    and p_pct <= gb.max_pct
  -- Bands within a scale cannot overlap (an exclusion constraint in migration
  -- 0003 guarantees it), so this returns at most one row.
  limit 1;
$$;

grant execute on function app.grade_for(uuid, numeric) to authenticated;

-- ===========================================================================
-- submit_marks
-- ---------------------------------------------------------------------------
-- p_entries is [{ "student_id": uuid, "marks": numeric|null, "absent": bool }]
--
-- Atomic, like attendance: the marks and the submission record are written
-- together, so a crash cannot leave a subject recorded as submitted with marks
-- missing — which the authority would then see as "ready to publish".
-- ===========================================================================
create or replace function public.submit_marks(
  p_exam_subject_id uuid,
  p_section_id uuid,
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
  v_es             public.exam_subjects%rowtype;
  v_exam           public.exams%rowtype;
  v_entry          jsonb;
  v_student        uuid;
  v_marks          numeric(6,2);
  v_absent         boolean;
  v_count          integer := 0;
  v_existing       public.mark_submissions%rowtype;
  v_is_correction  boolean := false;
  v_assigned       boolean;
begin
  select * into v_es from public.exam_subjects where id = p_exam_subject_id;
  if not found then
    raise exception 'no such exam subject' using errcode = 'no_data_found';
  end if;

  select * into v_exam from public.exams where id = v_es.exam_id;

  -- Entry is only open while the authority says so. Outside that window a
  -- teacher cannot quietly change a mark after the authority began reviewing.
  if v_exam.status <> 'marks_open' and not v_is_authority then
    raise exception 'mark entry is not open for this exam (it is %)', v_exam.status
      using errcode = 'check_violation';
  end if;

  -- A teacher may only enter marks for a subject they are assigned to teach in
  -- that section. Derived from teacher_assignments, never from the payload.
  if not v_is_authority then
    select exists (
      select 1 from public.teacher_assignments ta
      where ta.teacher_id = v_caller_teacher
        and ta.section_id = p_section_id
        and ta.subject_id = v_es.subject_id
        and ta.academic_year_id = v_exam.academic_year_id
    ) into v_assigned;

    if not coalesce(v_assigned, false) then
      raise exception 'you are not assigned to teach that subject to that class'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- The section must belong to the class the exam subject is for.
  if not exists (
    select 1 from public.sections s
    where s.id = p_section_id and s.class_id = v_es.class_id
  ) then
    raise exception 'that class and section do not match this exam subject'
      using errcode = 'check_violation';
  end if;

  select * into v_existing
  from public.mark_submissions
  where exam_subject_id = p_exam_subject_id and section_id = p_section_id
  for update;

  v_is_correction := found and v_existing.submitted_at is not null;

  if v_is_correction and coalesce(btrim(p_reason), '') = '' then
    raise exception 'changing submitted marks requires a reason'
      using errcode = 'check_violation';
  end if;

  for v_entry in select * from jsonb_array_elements(p_entries)
  loop
    v_student := (v_entry ->> 'student_id')::uuid;
    v_absent  := coalesce((v_entry ->> 'absent')::boolean, false);
    v_marks   := nullif(v_entry ->> 'marks', '')::numeric(6,2);

    if v_absent and v_marks is not null then
      raise exception 'a student marked absent cannot also have a score'
        using errcode = 'check_violation';
    end if;

    if not v_absent and v_marks is null then
      raise exception 'every student needs a score or an absence mark'
        using errcode = 'check_violation';
    end if;

    -- Only students enrolled in this section may be marked.
    if not exists (
      select 1 from public.student_enrollments se
      where se.student_id = v_student
        and se.section_id = p_section_id
        and se.academic_year_id = v_exam.academic_year_id
        and se.status = 'active'
    ) then
      raise exception 'student % is not enrolled in this section', v_student
        using errcode = 'foreign_key_violation';
    end if;

    -- A trigger from migration 0008 also refuses a mark above the maximum.
    insert into public.marks (
      exam_subject_id, student_id, marks_obtained, is_absent, entered_by, entered_at
    )
    values (p_exam_subject_id, v_student, v_marks, v_absent, auth.uid(), now())
    on conflict (exam_subject_id, student_id) do update
      set marks_obtained = excluded.marks_obtained,
          is_absent      = excluded.is_absent,
          entered_by     = excluded.entered_by,
          entered_at     = now();

    v_count := v_count + 1;
  end loop;

  -- Recorded LAST, after every mark is written, so a failure leaves the subject
  -- un-submitted rather than submitted-but-incomplete.
  insert into public.mark_submissions (
    exam_subject_id, section_id, teacher_id, submitted_at, submitted_by
  )
  values (
    p_exam_subject_id, p_section_id,
    coalesce(v_caller_teacher, v_es.subject_id), -- authority edits keep the row
    now(), auth.uid()
  )
  on conflict (exam_subject_id, section_id) do update
    set submitted_at = now(),
        submitted_by = auth.uid();

  return jsonb_build_object(
    'exam_subject_id', p_exam_subject_id,
    'marked', v_count,
    'correction', v_is_correction
  );
end;
$$;

comment on function public.submit_marks(uuid, uuid, jsonb, text) is
  'Atomic mark entry. Teacher must be assigned to the subject; submission recorded only after every mark is written.';

revoke all on function public.submit_marks(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.submit_marks(uuid, uuid, jsonb, text) to authenticated;

-- ===========================================================================
-- exam_submission_progress — who has submitted, who has not
-- ===========================================================================
create or replace function public.exam_submission_progress(p_exam_id uuid)
returns table (
  exam_subject_id uuid,
  class_id        uuid,
  class_name      text,
  section_id      uuid,
  section_name    text,
  subject_id      uuid,
  subject_name    text,
  teacher_id      uuid,
  teacher_name    text,
  roster          bigint,
  marks_entered   bigint,
  submitted_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    es.id,
    c.id,
    c.name,
    sec.id,
    sec.name,
    subj.id,
    subj.name,
    ta.teacher_id,
    t.full_name,
    (select count(*) from public.student_enrollments se
      where se.section_id = sec.id
        and se.academic_year_id = e.academic_year_id
        and se.status = 'active'),
    (select count(*) from public.marks m
       join public.student_enrollments se2
         on se2.student_id = m.student_id
        and se2.section_id = sec.id
        and se2.academic_year_id = e.academic_year_id
        and se2.status = 'active'
      where m.exam_subject_id = es.id),
    ms.submitted_at
  from public.exam_subjects es
  join public.exams e on e.id = es.exam_id
  join public.classes c on c.id = es.class_id
  join public.sections sec on sec.class_id = es.class_id and sec.is_active
  join public.subjects subj on subj.id = es.subject_id
  left join public.teacher_assignments ta
    on ta.section_id = sec.id
   and ta.subject_id = es.subject_id
   and ta.academic_year_id = e.academic_year_id
  left join public.teachers t on t.id = ta.teacher_id
  left join public.mark_submissions ms
    on ms.exam_subject_id = es.id and ms.section_id = sec.id
  where es.exam_id = p_exam_id
    and app.is_authority()
  order by c.level_order, sec.name, subj.name;
$$;

comment on function public.exam_submission_progress(uuid) is
  'Per class/section/subject mark entry progress for one exam. Authority only.';

revoke all on function public.exam_submission_progress(uuid) from public, anon;
grant execute on function public.exam_submission_progress(uuid) to authenticated;

-- ===========================================================================
-- publish_results
-- ---------------------------------------------------------------------------
-- Computes and freezes every student's result for one exam.
--
-- REFUSES to publish while any mark is missing. Publishing a partial exam
-- would print a sheet whose total is wrong in a way nobody can see — far worse
-- than making the authority chase the outstanding subject first. An absence is
-- not a missing mark: it is an explicit decision and scores zero.
-- ===========================================================================
create or replace function public.publish_results(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam        public.exams%rowtype;
  v_term        public.terms%rowtype;
  v_scale_id    uuid;
  v_scale       public.grading_scales%rowtype;
  v_missing     integer;
  v_published   integer := 0;
  r             record;
begin
  if not app.is_admin() then
    raise exception 'only a school administrator may publish results'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_exam from public.exams where id = p_exam_id for update;
  if not found then
    raise exception 'unknown exam' using errcode = 'no_data_found';
  end if;

  if v_exam.results_published_at is not null then
    raise exception 'results for this exam were already published on %',
      v_exam.results_published_at::date
      using errcode = 'unique_violation';
  end if;

  select * into v_term from public.terms where id = v_exam.term_id;

  v_scale_id := coalesce(
    v_exam.grading_scale_id,
    (select id from public.grading_scales where is_default limit 1)
  );

  if v_scale_id is null then
    raise exception 'no grading scale is configured, so results cannot be graded'
      using errcode = 'no_data_found';
  end if;

  select * into v_scale from public.grading_scales where id = v_scale_id;

  -- --------------------------------------------------------------
  -- Refuse while anything is un-entered.
  -- --------------------------------------------------------------
  select count(*) into v_missing
  from public.exam_subjects es
  join public.student_enrollments se
    on se.class_id = es.class_id
   and se.academic_year_id = v_exam.academic_year_id
   and se.status = 'active'
  left join public.marks m
    on m.exam_subject_id = es.id and m.student_id = se.student_id
  where es.exam_id = p_exam_id
    and (m.id is null or (m.marks_obtained is null and not m.is_absent));

  if v_missing > 0 then
    raise exception
      '% mark(s) are still un-entered. Every subject must be submitted before publishing.',
      v_missing
      using errcode = 'check_violation';
  end if;

  -- --------------------------------------------------------------
  -- Per student
  -- --------------------------------------------------------------
  for r in
    select
      se.student_id,
      se.id as enrollment_id,
      se.class_id,
      se.section_id,
      c.level_order
    from public.student_enrollments se
    join public.classes c on c.id = se.class_id
    where se.academic_year_id = v_exam.academic_year_id
      and se.status = 'active'
      and exists (
        select 1 from public.exam_subjects es
        where es.exam_id = p_exam_id and es.class_id = se.class_id
      )
  loop
    declare
      v_subjects    jsonb := '[]'::jsonb;
      v_obtained    numeric(8,2) := 0;
      v_max         numeric(8,2) := 0;
      v_points      numeric(10,4) := 0;
      v_subject_n   integer := 0;
      v_failed      integer := 0;
      v_pct         numeric(5,2);
      v_gpa         numeric(4,2);
      v_gpa_raw     numeric(4,2);
      v_grade       text;
      v_is_pass     boolean;
      v_att_present bigint := 0;
      v_att_total   bigint := 0;
      v_att_pct     numeric(5,2);
      s             record;
    begin
      for s in
        select
          es.id as exam_subject_id,
          subj.name as subject_name,
          es.max_marks,
          coalesce(es.pass_marks, es.max_marks * v_scale.subject_pass_pct / 100) as pass_marks,
          m.marks_obtained,
          m.is_absent
        from public.exam_subjects es
        join public.subjects subj on subj.id = es.subject_id
        join public.marks m
          on m.exam_subject_id = es.id and m.student_id = r.student_id
        where es.exam_id = p_exam_id and es.class_id = r.class_id
        order by subj.name
      loop
        declare
          v_score numeric(6,2) := coalesce(s.marks_obtained, 0);
          v_spct  numeric(5,2) := round(v_score / s.max_marks * 100, 2);
          v_sgrade text;
          v_spoint numeric(4,2);
          v_spass  boolean;
        begin
          select g.grade, g.grade_point, g.is_pass
            into v_sgrade, v_spoint, v_spass
          from app.grade_for(v_scale_id, v_spct) g;

          -- A subject is passed only if it also clears its own pass mark, which
          -- may be stricter than the band's is_pass flag.
          v_spass := coalesce(v_spass, false) and v_score >= s.pass_marks and not s.is_absent;

          if not v_spass then v_failed := v_failed + 1; end if;

          v_obtained := v_obtained + v_score;
          v_max := v_max + s.max_marks;
          v_points := v_points + coalesce(v_spoint, 0);
          v_subject_n := v_subject_n + 1;

          v_subjects := v_subjects || jsonb_build_object(
            'subject', s.subject_name,
            'obtained', case when s.is_absent then null else v_score end,
            'max', s.max_marks,
            'pass_marks', round(s.pass_marks, 2),
            'percentage', v_spct,
            'grade', case when s.is_absent then 'Abs' else v_sgrade end,
            'grade_point', case when s.is_absent then 0 else v_spoint end,
            'absent', s.is_absent,
            'passed', v_spass
          );
        end;
      end loop;

      if v_subject_n = 0 then
        continue;
      end if;

      v_pct := round(v_obtained / v_max * 100, 2);
      v_gpa_raw := round(v_points / v_subject_n, 2);

      -- The configured pass rule. The owner confirmed all_subjects.
      v_is_pass := case v_scale.pass_rule
        when 'all_subjects'   then v_failed = 0
        when 'average'        then v_pct >= v_scale.subject_pass_pct
        when 'allow_one_fail' then v_failed <= 1 and v_pct >= v_scale.subject_pass_pct
      end;

      -- Bangladeshi convention: a failed subject prints GPA 0.00 rather than an
      -- average that would read as a pass. The computed figure is kept in the
      -- snapshot so nothing is lost.
      v_gpa := case
        when not v_is_pass and v_scale.fail_zeroes_gpa then 0.00
        else v_gpa_raw
      end;

      -- Classes below the configured level print no GPA at all.
      if v_scale.no_gpa_below_level is not null
         and r.level_order <= v_scale.no_gpa_below_level then
        v_gpa := null;
      end if;

      select g.grade into v_grade from app.grade_for(v_scale_id, v_pct) g;

      -- ---------------------------------------------------------
      -- Attendance over the TERM's configured window, not the whole year.
      -- Submitted lessons only, exactly as everywhere else.
      -- ---------------------------------------------------------
      if v_term.attendance_window_start is not null then
        select
          count(*) filter (where sa.status in ('present', 'late')),
          count(sa.id)
        into v_att_present, v_att_total
        from public.teaching_sessions ts
        join public.student_attendance sa
          on sa.teaching_session_id = ts.id and sa.student_id = r.student_id
        where ts.submitted_at is not null
          and not ts.is_cancelled
          and ts.session_date between v_term.attendance_window_start
                                  and coalesce(v_term.attendance_window_end, v_term.ends_on);
      end if;

      v_att_pct := case when v_att_total > 0
        then round(v_att_present::numeric / v_att_total * 100, 2) end;

      insert into public.published_results (
        exam_id, student_id, enrollment_id,
        total_obtained, total_max, percentage, gpa, grade, is_pass,
        attendance_pct, snapshot, published_by
      )
      values (
        p_exam_id, r.student_id, r.enrollment_id,
        v_obtained, v_max, v_pct, v_gpa, v_grade, v_is_pass,
        v_att_pct,
        jsonb_build_object(
          'subjects', v_subjects,
          'gpa_computed', v_gpa_raw,
          'gpa_printed', v_gpa,
          'failed_subjects', v_failed,
          'pass_rule', v_scale.pass_rule,
          'scale', v_scale.name,
          'attendance', jsonb_build_object(
            'present', v_att_present,
            'submitted_lessons', v_att_total,
            'window_start', v_term.attendance_window_start,
            'window_end', coalesce(v_term.attendance_window_end, v_term.ends_on)
          )
        ),
        auth.uid()
      );

      v_published := v_published + 1;
    end;
  end loop;

  -- Class positions, by percentage within the student's own section.
  with ranked as (
    select
      pr.id,
      rank() over (
        partition by se.section_id
        order by pr.percentage desc
      ) as position
    from public.published_results pr
    join public.student_enrollments se on se.id = pr.enrollment_id
    where pr.exam_id = p_exam_id
  )
  update public.published_results pr
     set position_in_class = ranked.position
    from ranked
   where pr.id = ranked.id;

  update public.exams
     set status = 'published',
         results_published_at = now(),
         results_published_by = auth.uid()
   where id = p_exam_id;

  return jsonb_build_object(
    'exam_id', p_exam_id,
    'published', v_published,
    'scale', v_scale.name,
    'pass_rule', v_scale.pass_rule
  );
end;
$$;

comment on function public.publish_results(uuid) is
  'Computes and freezes results for one exam. Admin only. Refuses while any mark is un-entered.';

revoke all on function public.publish_results(uuid) from public, anon;
grant execute on function public.publish_results(uuid) to authenticated;

-- ===========================================================================
-- Class tests — teacher-created, with a duplicate-guarded "send result"
-- ===========================================================================
create or replace function public.send_class_test_result(p_class_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_test  public.class_tests%rowtype;
  v_count integer;
begin
  select * into v_test from public.class_tests where id = p_class_test_id for update;
  if not found then
    raise exception 'unknown class test' using errcode = 'no_data_found';
  end if;

  if not app.is_authority() and v_test.teacher_id is distinct from app.current_teacher_id() then
    raise exception 'that class test belongs to another teacher'
      using errcode = 'insufficient_privilege';
  end if;

  -- The guard against a double click sending two rounds of SMS. Checked and
  -- set in the same transaction, so two concurrent requests cannot both pass.
  if v_test.result_sent_at is not null then
    raise exception 'results for this test were already sent on %',
      v_test.result_sent_at::date
      using errcode = 'unique_violation';
  end if;

  select count(*) into v_count
  from public.class_test_marks where class_test_id = p_class_test_id;

  if v_count = 0 then
    raise exception 'enter marks before sending results'
      using errcode = 'check_violation';
  end if;

  update public.class_tests
     set result_sent_at = now(),
         result_sent_by = auth.uid(),
         status = 'sent'
   where id = p_class_test_id;

  -- The SMS itself is queued by the application layer, which in simulate mode
  -- records what it would have sent and delivers nothing. This function only
  -- marks the test as sent, which is what makes the action idempotent.
  return jsonb_build_object(
    'class_test_id', p_class_test_id,
    'students', v_count
  );
end;
$$;

revoke all on function public.send_class_test_result(uuid) from public, anon;
grant execute on function public.send_class_test_result(uuid) to authenticated;

-- ===========================================================================
-- A student's own published results
-- ===========================================================================
create or replace function public.student_results(p_student_id uuid)
returns table (
  exam_id         uuid,
  exam_name       text,
  term_name       text,
  academic_year   text,
  total_obtained  numeric,
  total_max       numeric,
  percentage      numeric,
  gpa             numeric,
  grade           text,
  is_pass         boolean,
  attendance_pct  numeric,
  position_in_class integer,
  snapshot        jsonb,
  published_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pr.exam_id, e.name, t.name, ay.name,
    pr.total_obtained, pr.total_max, pr.percentage, pr.gpa, pr.grade,
    pr.is_pass, pr.attendance_pct, pr.position_in_class, pr.snapshot,
    pr.published_at
  from public.published_results pr
  join public.exams e on e.id = pr.exam_id
  join public.terms t on t.id = e.term_id
  join public.academic_years ay on ay.id = e.academic_year_id
  where pr.student_id = p_student_id
    and coalesce(
      app.is_authority()
      or app.owns_student_record(p_student_id)
      or (app.is_teacher() and app.teaches_student(p_student_id)),
      false
    )
  order by pr.published_at desc;
$$;

comment on function public.student_results(uuid) is
  'Published results for one student. Only published rows exist here, so drafts cannot leak.';

revoke all on function public.student_results(uuid) from public, anon;
grant execute on function public.student_results(uuid) to authenticated;
