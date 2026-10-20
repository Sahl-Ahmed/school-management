-- ===========================================================================
-- 0032  The printed overall grade follows the pass result
-- ---------------------------------------------------------------------------
-- Found in the phase 5 browser walkthrough: a student who failed one subject
-- had GPA 0.00 (the Bangladeshi convention the owner confirmed) but an overall
-- grade of B, taken straight from the band for 54%. The sheet therefore read
--
--     Not passed        GPA 0.00        Grade B
--
-- which a parent cannot reconcile. Nothing was miscalculated; the two
-- conventions simply were not applied to the same places.
--
-- This replaces publish_results so that whenever fail_zeroes_gpa is on and the
-- student did not pass, the printed overall grade is the scale's failing band
-- (F on the configured scale) rather than the band for the percentage. It stays
-- configuration: a school that turns fail_zeroes_gpa off gets the percentage's
-- band in both places, consistently.
--
-- The band grade for the percentage is kept in the snapshot as grade_computed,
-- beside the gpa_computed that was already there, so the averaged view of a
-- failed result is still recoverable.
--
-- Results already published are untouched: their snapshot is frozen by design.
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
      v_grade_computed text;
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
      v_grade_computed := v_grade;

      -- The same convention that zeroes the GPA applies to the overall grade.
      -- Without this a student who failed one subject printed "Not passed"
      -- beside grade B, which reads as a contradiction on a result sheet a
      -- parent has to make sense of. The band grade for the percentage is kept
      -- in the snapshot as grade_computed, so nothing is lost.
      if not v_is_pass and v_scale.fail_zeroes_gpa then
        select gb.grade into v_grade
        from public.grade_bands gb
        where gb.scale_id = v_scale_id and not gb.is_pass
        order by gb.min_pct
        limit 1;

        -- A scale with no failing band leaves the computed grade alone rather
        -- than printing nothing at all.
        v_grade := coalesce(v_grade, v_grade_computed);
      end if;

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
          'grade_computed', v_grade_computed,
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
  'Computes and freezes results for one exam. Admin only. Refuses while any mark is un-entered. The printed overall grade follows the pass result when fail_zeroes_gpa is on.';

revoke all on function public.publish_results(uuid) from public, anon;
grant execute on function public.publish_results(uuid) to authenticated;
