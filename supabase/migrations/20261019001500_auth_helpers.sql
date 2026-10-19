-- ===========================================================================
-- 0015  Authorisation helper functions
-- ---------------------------------------------------------------------------
-- Every RLS policy in the next migration resolves through these functions.
-- Three properties matter and are deliberate:
--
--   SECURITY DEFINER — so that reading profiles/students/teachers to answer
--                      "who is this?" does not itself trigger RLS and recurse.
--   STABLE           — so Postgres evaluates them once per statement when a
--                      policy wraps the call in a scalar subquery, rather than
--                      once per candidate row.
--   set search_path = '' — so a caller cannot shadow a table name and change
--                      what the function resolves.
--
-- Policies call these as `(select app.is_authority())`. The subquery wrapper is
-- what lets the planner hoist the call out of the row loop; calling
-- `app.is_authority()` bare would re-evaluate per row on large tables.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Who is calling
-- --------------------------------------------------------------------------
create or replace function app.caller_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active;
$$;

comment on function app.caller_role() is
  'Role of the calling user, or NULL when unauthenticated or deactivated.';

create or replace function app.is_authority()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.caller_role() in ('authority_admin', 'authority_staff'), false);
$$;

-- High-privilege authority only: publishing results, permissions, overrides,
-- destructive configuration.
create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.caller_role() = 'authority_admin', false);
$$;

create or replace function app.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.caller_role() = 'teacher', false);
$$;

create or replace function app.is_student()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.caller_role() = 'student', false);
$$;

-- --------------------------------------------------------------------------
-- Which record the caller *is*
-- --------------------------------------------------------------------------
create or replace function app.current_student_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.students s
  join public.profiles p on p.id = s.auth_user_id
  where s.auth_user_id = auth.uid()
    and p.is_active;
$$;

comment on function app.current_student_id() is
  'The calling student''s id, or NULL. Students never see a row this does not match.';

create or replace function app.current_teacher_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
  from public.teachers t
  join public.profiles p on p.id = t.auth_user_id
  where t.auth_user_id = auth.uid()
    and t.is_active
    and p.is_active;
$$;

-- --------------------------------------------------------------------------
-- Teacher scope — derived from teacher_assignments, never from anything the
-- client sends
-- --------------------------------------------------------------------------

-- Does the caller teach anything at all in this section, as of a given date?
create or replace function app.teaches_section(p_section_id uuid, p_on date default current_date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.teacher_assignments ta
    where ta.section_id = p_section_id
      and ta.teacher_id = app.current_teacher_id()
      and ta.effective_from <= p_on
      and (ta.effective_to is null or ta.effective_to >= p_on)
  );
$$;

-- Does the caller teach this specific subject in this section?
create or replace function app.teaches_section_subject(
  p_section_id uuid,
  p_subject_id uuid,
  p_on date default current_date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.teacher_assignments ta
    where ta.section_id = p_section_id
      and ta.subject_id = p_subject_id
      and ta.teacher_id = app.current_teacher_id()
      and ta.effective_from <= p_on
      and (ta.effective_to is null or ta.effective_to >= p_on)
  );
$$;

-- May the caller see this student at all? True when the student has an active
-- enrollment, in the current academic year, in a section the caller teaches.
create or replace function app.teaches_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.student_enrollments se
    join public.academic_years ay on ay.id = se.academic_year_id
    join public.teacher_assignments ta on ta.section_id = se.section_id
    where se.student_id = p_student_id
      and se.status = 'active'
      and ay.is_current
      and ta.teacher_id = app.current_teacher_id()
      and ta.academic_year_id = se.academic_year_id
      and ta.effective_from <= current_date
      and (ta.effective_to is null or ta.effective_to >= current_date)
  );
$$;

comment on function app.teaches_student(uuid) is
  'Teacher visibility of a student. Scoped to active enrollment in the current year.';

-- Does the caller own this teaching session (and may therefore submit or
-- correct its attendance)?
create or replace function app.owns_teaching_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.teaching_sessions ts
    where ts.id = p_session_id
      and ts.teacher_id = app.current_teacher_id()
  );
$$;

-- May the caller enter marks for this exam subject? Requires an assignment for
-- the subject AND the exam to be open for entry.
create or replace function app.may_enter_marks(p_exam_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.exam_subjects es
    join public.exams e on e.id = es.exam_id
    join public.teacher_assignments ta
      on ta.subject_id = es.subject_id
     and ta.class_id = es.class_id
    where es.id = p_exam_subject_id
      and e.status = 'marks_open'
      and ta.teacher_id = app.current_teacher_id()
      and ta.academic_year_id = e.academic_year_id
  );
$$;

comment on function app.may_enter_marks(uuid) is
  'Teacher mark entry: own subject only, and only while the exam is marks_open.';

-- --------------------------------------------------------------------------
-- Student scope
-- --------------------------------------------------------------------------
create or replace function app.owns_student_record(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_student_id is not null
     and p_student_id = app.current_student_id();
$$;

-- The sections the calling student is currently enrolled in. Used so a student
-- can see their own published routine without seeing anyone else's.
create or replace function app.current_student_section_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select se.section_id
  from public.student_enrollments se
  join public.academic_years ay on ay.id = se.academic_year_id
  where se.student_id = app.current_student_id()
    and se.status = 'active'
    and ay.is_current
  limit 1;
$$;

-- --------------------------------------------------------------------------
-- The public QR card — the ONLY database surface exposed to anonymous callers
-- --------------------------------------------------------------------------
-- Returning a frozen snapshot means the public page performs no join to
-- students, contacts, fees, marks or attendance. A future policy mistake on
-- those tables therefore cannot widen what a QR scan reveals.
--
-- School branding is read live rather than frozen so that a corrected office
-- number appears on already-issued cards.
-- --------------------------------------------------------------------------
create or replace function public.get_public_card(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'card', q.card_snapshot,
    'school', jsonb_build_object(
      'name', s.name,
      'logo_path', s.logo_path,
      'email', s.email,
      'office_phone', s.office_phone
    ),
    'issued_at', q.issued_at
  )
  from public.qr_tokens q
  cross join public.school_settings s
  where q.token = p_token
    and q.revoked_at is null;
$$;

comment on function public.get_public_card(text) is
  'Public ID-card lookup by opaque token. Returns the frozen printed fields and school branding only.';

-- --------------------------------------------------------------------------
-- Admit-card eligibility — one definition, used by the student portal, the
-- office search screen and the issue action alike, so no screen can bypass it.
-- --------------------------------------------------------------------------
create or replace function public.admit_card_eligibility(
  p_student_id uuid,
  p_exam_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rule              public.admit_card_rules%rowtype;
  v_exam              public.exams%rowtype;
  v_blocks            text[] := array[]::text[];
  v_feedback_done     boolean;
  v_outstanding       numeric(10,2);
  v_exam_fee_due      numeric(10,2);
  v_override          boolean;
begin
  select * into v_exam from public.exams where id = p_exam_id;
  if not found then
    return jsonb_build_object('eligible', false, 'blocks', array['exam_not_found']::text[]);
  end if;

  select * into v_rule from public.admit_card_rules where exam_id = p_exam_id;

  -- With no rule configured, nothing is asserted to be satisfied: the card is
  -- blocked rather than silently issued.
  if not found then
    return jsonb_build_object(
      'eligible', false,
      'blocks', array['no_rule_configured']::text[],
      'detail', 'No admit card rule is configured for this exam.'
    );
  end if;

  -- --- Feedback requirement -------------------------------------------------
  if v_rule.require_feedback then
    select fc.completed_at is not null
      into v_feedback_done
    from public.feedback_completions fc
    where fc.student_id = p_student_id
      and fc.campaign_id = coalesce(
            v_rule.feedback_campaign_id,
            (select c.id from public.feedback_campaigns c
              where c.term_id = v_exam.term_id and c.blocks_admit_card
              order by c.created_at limit 1)
          );

    if coalesce(v_feedback_done, false) is false then
      v_blocks := v_blocks || 'feedback_incomplete'::text;
    end if;
  end if;

  -- --- Monthly fee requirement ---------------------------------------------
  if v_rule.require_fees_cleared and v_rule.fees_cleared_through_month is not null then
    select coalesce(sum(fc.amount - fc.amount_paid - fc.discount_amount), 0)
      into v_outstanding
    from public.fee_charges fc
    where fc.student_id = p_student_id
      and fc.status in ('pending', 'partial')
      and fc.period_year is not null
      and (fc.period_year, fc.period_month)
          <= (v_rule.fees_cleared_through_year, v_rule.fees_cleared_through_month);

    if v_outstanding > v_rule.allowed_outstanding then
      v_blocks := v_blocks || 'monthly_fees_outstanding'::text;
    end if;
  end if;

  -- --- Exam fee requirement -------------------------------------------------
  if v_rule.require_exam_fee_paid then
    select coalesce(sum(fc.amount - fc.amount_paid - fc.discount_amount), 0)
      into v_exam_fee_due
    from public.fee_charges fc
    where fc.student_id = p_student_id
      and fc.exam_id = p_exam_id
      and fc.status in ('pending', 'partial');

    if v_exam_fee_due > v_rule.allowed_outstanding then
      v_blocks := v_blocks || 'exam_fee_unpaid'::text;
    end if;
  end if;

  -- --- Audited override -----------------------------------------------------
  select exists (
    select 1 from public.admit_card_overrides o
    where o.exam_id = p_exam_id and o.student_id = p_student_id
  ) into v_override;

  return jsonb_build_object(
    'eligible', (array_length(v_blocks, 1) is null)
                or (v_rule.allow_override and v_override),
    'blocks', v_blocks,
    'overridden', v_rule.allow_override and v_override,
    'outstanding_monthly', coalesce(v_outstanding, 0),
    'outstanding_exam_fee', coalesce(v_exam_fee_due, 0)
  );
end;
$$;

comment on function public.admit_card_eligibility(uuid, uuid) is
  'Single definition of admit-card eligibility. With no rule configured, the card is blocked.';

-- --------------------------------------------------------------------------
-- Execution grants
-- --------------------------------------------------------------------------
-- Anonymous visitors may call exactly one function: the public card lookup.
revoke all on function public.get_public_card(text) from public;
grant execute on function public.get_public_card(text) to anon, authenticated;

revoke all on function public.admit_card_eligibility(uuid, uuid) from public;
grant execute on function public.admit_card_eligibility(uuid, uuid) to authenticated;

-- The app.* helpers are called from inside policies, which run as the table
-- owner, but server code also calls them directly.
grant execute on function app.caller_role() to authenticated;
grant execute on function app.is_authority() to authenticated;
grant execute on function app.is_admin() to authenticated;
grant execute on function app.is_teacher() to authenticated;
grant execute on function app.is_student() to authenticated;
grant execute on function app.current_student_id() to authenticated;
grant execute on function app.current_teacher_id() to authenticated;
grant execute on function app.current_student_section_id() to authenticated;
