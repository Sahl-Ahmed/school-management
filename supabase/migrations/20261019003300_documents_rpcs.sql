-- ===========================================================================
-- 0033  Phase 6: feedback targeting, admit-card issue, QR cards, printables
-- ---------------------------------------------------------------------------
-- The owner confirmed four policies for this phase. Each is stored as data, so
-- a later change stays a data change:
--
--   * Admit-card fee cutoff: monthly fees must be cleared through THE EXAM'S
--     OWN MONTH. `default_admit_card_rule` derives that from exams.starts_on.
--   * A teacher who changed mid-term is reviewed ALONGSIDE their replacement,
--     provided each taught at least min_periods_taught periods. So target
--     generation walks every assignment that overlapped the term, not just the
--     one in force today.
--   * ID cards exist in BOTH orientations; the office picks the default
--     template. document_templates.orientation already carries this.
--   * The ID card front prints the GUARDIAN'S PHONE NUMBER, and the back the
--     school office number.
--
-- That last one needs care, so here is exactly where the number does and does
-- not appear. It is in the snapshot, because the printed card is generated
-- from the same frozen JSON. It is PRINTED on the card front, which is what
-- the owner asked for: whoever finds a lost card can read the number off the
-- plastic and call the guardian.
--
-- It is NOT rendered on the public /card/<token> page. That page shows a
-- deliberate subset — see the comment in src/app/card/[token]/page.tsx. The
-- reasoning: a finder holding the card does not need the QR to read a printed
-- number, whereas publishing it on the page would hand it to anyone who scans
-- the code, which is a wider audience than the decision was about. If the
-- owner wants it on the page too, that is one field added there.
--
-- Removing it from the card is one row's edit to `config.front_fields` plus a
-- reissue — but cards already in circulation keep the number printed on them
-- until they are physically replaced. `revoke_qr_token` kills the link; it
-- cannot unprint plastic.
--
-- What is NOT configurable, by design: the snapshot trigger from migration 0011
-- still refuses parent names, NIDs, birth certificate numbers, fees, marks and
-- attendance in a QR snapshot, whatever a template asks for.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Seat tokens
-- --------------------------------------------------------------------------
-- The brief wants a seat token printed with the admit card. There was no table
-- for it, and deriving one from the student and exam ids would make it
-- guessable from a registration number — which defeats the point of showing it
-- at the hall door. So it is a stored random code, issued once per student per
-- exam and reprinted identically thereafter.
-- --------------------------------------------------------------------------
create table public.exam_seat_tokens (
  id         uuid primary key default gen_random_uuid(),
  exam_id    uuid not null references public.exams (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  -- Short enough to read aloud and type, random enough not to be guessed.
  token      text not null unique check (token ~ '^[A-HJ-NP-Z2-9]{10}$'),
  issued_at  timestamptz not null default now(),
  unique (exam_id, student_id)
);

create index exam_seat_tokens_exam_idx on public.exam_seat_tokens (exam_id);

comment on table public.exam_seat_tokens is
  'One stored random seat code per student per exam. Reprinting an admit card yields the same code.';

alter table public.exam_seat_tokens enable row level security;

create policy "authority manages seat tokens"
  on public.exam_seat_tokens for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "student reads own seat token"
  on public.exam_seat_tokens for select to authenticated
  using (student_id = (select app.current_student_id()));

create policy "teacher reads taught seat tokens"
  on public.exam_seat_tokens for select to authenticated
  using ((select app.is_teacher()) and app.teaches_student(student_id));

grant select on public.exam_seat_tokens to authenticated;
grant insert, update, delete on public.exam_seat_tokens to authenticated;

-- Ambiguous characters are excluded (no I, O, 0, 1) because this code gets
-- read off paper and typed by hand at a hall door.
create or replace function app.seat_token_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
           1 + floor(random() * 32)::integer, 1),
    ''
  )
  from generate_series(1, 10);
$$;

-- ===========================================================================
-- default_admit_card_rule — the owner's fee cutoff, applied
-- ---------------------------------------------------------------------------
-- Creates the rule for an exam with the cutoff derived from the exam's own
-- start month, which is the policy the owner chose. The office can still edit
-- the row afterwards; this only decides what it starts as, so that configuring
-- an exam does not require remembering the policy.
-- ===========================================================================
create or replace function public.default_admit_card_rule(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam     public.exams%rowtype;
  v_campaign uuid;
  v_rule     public.admit_card_rules;
  v_anchor   date;
begin
  if not app.is_authority() then
    raise exception 'only the school office may configure admit card rules'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_exam from public.exams where id = p_exam_id;
  if not found then
    raise exception 'unknown exam' using errcode = 'no_data_found';
  end if;

  -- An exam with no start date falls back to its term's end, so the rule is
  -- never silently left with no cutoff at all (which blocks every card).
  v_anchor := coalesce(
    v_exam.starts_on,
    (select t.ends_on from public.terms t where t.id = v_exam.term_id)
  );

  select c.id into v_campaign
  from public.feedback_campaigns c
  where c.term_id = v_exam.term_id and c.blocks_admit_card
  order by c.created_at
  limit 1;

  insert into public.admit_card_rules (
    exam_id, require_feedback, feedback_campaign_id,
    require_fees_cleared, fees_cleared_through_year, fees_cleared_through_month,
    require_exam_fee_paid, allowed_outstanding, allow_override
  )
  values (
    p_exam_id, true, v_campaign,
    true,
    extract(year from v_anchor)::integer,
    extract(month from v_anchor)::smallint,
    true, 0, false
  )
  on conflict (exam_id) do update
    set feedback_campaign_id = coalesce(
          public.admit_card_rules.feedback_campaign_id, excluded.feedback_campaign_id)
  returning * into v_rule;

  -- jsonb rather than the composite row type: PostgREST and the test harness
  -- both hand a composite back as an opaque "(a,b,c)" string, so every caller
  -- would have to parse it. Every other RPC in this project returns jsonb.
  return jsonb_build_object(
    'exam_id', v_rule.exam_id,
    'require_feedback', v_rule.require_feedback,
    'feedback_campaign_id', v_rule.feedback_campaign_id,
    'require_fees_cleared', v_rule.require_fees_cleared,
    'fees_cleared_through_year', v_rule.fees_cleared_through_year,
    'fees_cleared_through_month', v_rule.fees_cleared_through_month,
    'require_exam_fee_paid', v_rule.require_exam_fee_paid,
    'allowed_outstanding', v_rule.allowed_outstanding,
    'allow_override', v_rule.allow_override
  );
end;
$$;

revoke all on function public.default_admit_card_rule(uuid) from public, anon;
grant execute on function public.default_admit_card_rule(uuid) to authenticated;

-- ===========================================================================
-- generate_feedback_targets
-- ---------------------------------------------------------------------------
-- Builds a student's list of forms from the assignments that overlapped the
-- term, one per teacher per subject.
--
-- The owner's rule: a teacher who changed mid-term is reviewed alongside their
-- replacement, if each taught enough periods. That is why this iterates
-- assignments by date overlap rather than taking the current one — an
-- assignment that ended in week three still produced lessons a student can
-- speak to.
--
-- periods_taught counts SUBMITTED lessons only, the same basis as every
-- attendance figure in the system. A lesson nobody submitted did not
-- demonstrably happen, so it cannot be used to argue a teacher is reviewable.
-- ===========================================================================
create or replace function public.generate_feedback_targets(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.feedback_campaigns%rowtype;
  v_term     public.terms%rowtype;
  v_created  integer := 0;
  v_skipped  integer := 0;
  v_students integer := 0;
  r          record;
begin
  if not app.is_authority() then
    raise exception 'only the school office may generate feedback forms'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_campaign from public.feedback_campaigns where id = p_campaign_id;
  if not found then
    raise exception 'unknown feedback campaign' using errcode = 'no_data_found';
  end if;

  select * into v_term from public.terms where id = v_campaign.term_id;

  if not exists (select 1 from public.feedback_questions where campaign_id = p_campaign_id) then
    raise exception 'add the rating questions before generating forms'
      using errcode = 'check_violation';
  end if;

  for r in
    select
      se.student_id,
      ta.teacher_id,
      ta.subject_id,
      ta.section_id,
      (
        -- Submitted, non-cancelled lessons for that teacher, subject and
        -- section inside both the term and the assignment's own dates.
        --
        -- teaching_sessions snapshots the teacher, section and subject at
        -- creation precisely so a later routine edit cannot restate who taught
        -- a past lesson, so these are read from the session itself rather than
        -- through routine_periods.
        select count(*)
        from public.teaching_sessions ts
        where ts.section_id = ta.section_id
          and ts.subject_id = ta.subject_id
          and ts.teacher_id = ta.teacher_id
          and ts.submitted_at is not null
          and not ts.is_cancelled
          and ts.session_date between v_term.starts_on and v_term.ends_on
          and ts.session_date >= ta.effective_from
          and (ta.effective_to is null or ts.session_date <= ta.effective_to)
      ) as periods
    from public.student_enrollments se
    join public.teacher_assignments ta
      on ta.section_id = se.section_id
     and ta.academic_year_id = se.academic_year_id
    where se.academic_year_id = v_campaign.academic_year_id
      and se.status = 'active'
      -- The assignment must overlap the term, not merely be current.
      and ta.effective_from <= v_term.ends_on
      and (ta.effective_to is null or ta.effective_to >= v_term.starts_on)
  loop
    v_students := v_students + 1;

    if r.periods < v_campaign.min_periods_taught then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.feedback_targets (
      campaign_id, student_id, teacher_id, section_id, subject_id, periods_taught
    )
    values (
      p_campaign_id, r.student_id, r.teacher_id, r.section_id, r.subject_id, r.periods
    )
    on conflict (campaign_id, student_id, teacher_id, subject_id) do update
      -- Re-running refreshes the period count but never clears answered_at, so
      -- regenerating after a late admission cannot wipe submitted feedback.
      set periods_taught = excluded.periods_taught;

    v_created := v_created + 1;
  end loop;

  -- Completion rows are seeded so the office can see who has not started,
  -- rather than only who has. targets_total is recomputed from the real rows.
  insert into public.feedback_completions (campaign_id, student_id, targets_total, targets_done)
  select p_campaign_id, t.student_id, count(*), count(*) filter (where t.answered_at is not null)
  from public.feedback_targets t
  where t.campaign_id = p_campaign_id
  group by t.student_id
  on conflict (campaign_id, student_id) do update
    set targets_total = excluded.targets_total,
        targets_done  = excluded.targets_done,
        completed_at  = case
                          when excluded.targets_done >= excluded.targets_total
                               and excluded.targets_total > 0
                          then coalesce(public.feedback_completions.completed_at, now())
                        end;

  return jsonb_build_object(
    'campaign_id', p_campaign_id,
    'forms', v_created,
    'skipped_too_few_periods', v_skipped,
    'pairs_considered', v_students
  );
end;
$$;

comment on function public.generate_feedback_targets(uuid) is
  'Builds feedback forms from assignments that overlapped the term, so a mid-term teacher change yields a form for each. Re-runnable.';

revoke all on function public.generate_feedback_targets(uuid) from public, anon;
grant execute on function public.generate_feedback_targets(uuid) to authenticated;

-- ===========================================================================
-- student_feedback_forms — what one student still has to fill in
-- ===========================================================================
create or replace function public.student_feedback_forms(p_campaign_id uuid)
returns table (
  target_id      uuid,
  teacher_id     uuid,
  teacher_name   text,
  designation    text,
  subject_name   text,
  subject_name_bn text,
  class_name     text,
  section_name   text,
  periods_taught integer,
  answered_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id, t.teacher_id, te.full_name, te.designation,
    s.name, s.name_bn, c.name, sec.name,
    t.periods_taught, t.answered_at
  from public.feedback_targets t
  join public.teachers te on te.id = t.teacher_id
  join public.subjects s on s.id = t.subject_id
  join public.sections sec on sec.id = t.section_id
  join public.classes c on c.id = sec.class_id
  where t.campaign_id = p_campaign_id
    and t.student_id = app.current_student_id()
  order by s.name, te.full_name;
$$;

revoke all on function public.student_feedback_forms(uuid) from public, anon;
grant execute on function public.student_feedback_forms(uuid) to authenticated;

-- ===========================================================================
-- feedback_completion_overview — who has finished, for the office
-- ---------------------------------------------------------------------------
-- Names students, which is safe precisely because this reads the completions
-- table and never the responses. It answers "who still owes us feedback",
-- which is what blocks an admit card, and nothing about what anyone said.
-- ===========================================================================
create or replace function public.feedback_completion_overview(
  p_campaign_id uuid,
  p_class_id uuid default null
)
returns table (
  student_id      uuid,
  full_name       text,
  registration_no text,
  class_name      text,
  section_name    text,
  roll_no         integer,
  targets_total   integer,
  targets_done    integer,
  completed_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    st.id, st.full_name, st.registration_no, c.name, sec.name, se.roll_no,
    coalesce(fc.targets_total, 0),
    coalesce(fc.targets_done, 0),
    fc.completed_at
  from public.feedback_campaigns camp
  join public.student_enrollments se
    on se.academic_year_id = camp.academic_year_id and se.status = 'active'
  join public.students st on st.id = se.student_id
  join public.sections sec on sec.id = se.section_id
  join public.classes c on c.id = sec.class_id
  left join public.feedback_completions fc
    on fc.campaign_id = camp.id and fc.student_id = se.student_id
  where camp.id = p_campaign_id
    and (p_class_id is null or se.class_id = p_class_id)
    and app.is_authority()
  order by c.level_order, sec.name, se.roll_no;
$$;

revoke all on function public.feedback_completion_overview(uuid, uuid) from public, anon;
grant execute on function public.feedback_completion_overview(uuid, uuid) to authenticated;

-- ===========================================================================
-- issue_admit_card
-- ---------------------------------------------------------------------------
-- The one place an admit card becomes issuable, used by the student portal and
-- the office alike.
--
-- It re-checks eligibility here rather than trusting the caller, because the
-- brief is explicit that the office must not be able to issue a blocked card
-- from a different screen. A server action that checked and then issued would
-- leave a window; this checks and issues in one transaction.
-- ===========================================================================
create or replace function public.issue_admit_card(
  p_student_id uuid,
  p_exam_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_elig   jsonb;
  v_token  text;
  v_doc_id uuid;
  v_self   boolean;
begin
  v_self := app.owns_student_record(p_student_id);

  if not coalesce(app.is_authority() or v_self, false) then
    raise exception 'you may not issue that admit card'
      using errcode = 'insufficient_privilege';
  end if;

  -- The single definition, from migration 0015. No screen gets its own copy.
  v_elig := public.admit_card_eligibility(p_student_id, p_exam_id);

  if not coalesce((v_elig ->> 'eligible')::boolean, false) then
    raise exception 'admit card blocked: %', v_elig ->> 'blocks'
      using errcode = 'check_violation';
  end if;

  -- The seat code is issued once and reused, so a reprint carries the same
  -- code as the card the student already holds.
  select token into v_token
  from public.exam_seat_tokens
  where exam_id = p_exam_id and student_id = p_student_id;

  if v_token is null then
    loop
      begin
        insert into public.exam_seat_tokens (exam_id, student_id, token)
        values (p_exam_id, p_student_id, app.seat_token_code())
        returning token into v_token;
        exit;
      exception when unique_violation then
        -- A collision on the token column; try another. The (exam, student)
        -- pair cannot collide here because it was just checked above, and a
        -- concurrent insert of the same pair is resolved on the next loop by
        -- the select below.
        select token into v_token
        from public.exam_seat_tokens
        where exam_id = p_exam_id and student_id = p_student_id;
        if v_token is not null then exit; end if;
      end;
    end loop;
  end if;

  -- Recorded so the office can see what has been issued and when. The PDF
  -- itself is generated on demand rather than stored.
  insert into public.generated_documents (
    kind, student_id, exam_id, meta, generated_by
  )
  values (
    'admit_card', p_student_id, p_exam_id,
    jsonb_build_object(
      'seat_token', v_token,
      'eligibility', v_elig,
      'issued_by_office', app.is_authority() and not coalesce(v_self, false)
    ),
    auth.uid()
  )
  returning id into v_doc_id;

  return jsonb_build_object(
    'document_id', v_doc_id,
    'seat_token', v_token,
    'eligibility', v_elig
  );
end;
$$;

comment on function public.issue_admit_card(uuid, uuid) is
  'Issues one admit card. Re-checks eligibility inside the transaction, so no screen can bypass the rule.';

revoke all on function public.issue_admit_card(uuid, uuid) from public, anon;
grant execute on function public.issue_admit_card(uuid, uuid) to authenticated;

-- ===========================================================================
-- override_admit_card — the audited exception, off unless the owner allows it
-- ===========================================================================
create or replace function public.override_admit_card(
  p_student_id uuid,
  p_exam_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.admit_card_rules%rowtype;
  v_elig jsonb;
begin
  if not app.is_admin() then
    raise exception 'only a school administrator may override an admit card'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'an override requires a reason' using errcode = 'check_violation';
  end if;

  select * into v_rule from public.admit_card_rules where exam_id = p_exam_id;
  if not found then
    raise exception 'no admit card rule is configured for this exam'
      using errcode = 'no_data_found';
  end if;

  -- The owner has not enabled overrides. Refusing here rather than in the UI
  -- is the point: the policy lives with the data, not with the screen.
  if not v_rule.allow_override then
    raise exception 'overrides are not permitted for this exam'
      using errcode = 'check_violation';
  end if;

  v_elig := public.admit_card_eligibility(p_student_id, p_exam_id);

  insert into public.admit_card_overrides (
    exam_id, student_id, reason, overridden_checks, approved_by
  )
  values (
    p_exam_id, p_student_id, btrim(p_reason),
    coalesce(v_elig -> 'blocks', '[]'::jsonb), auth.uid()
  )
  on conflict (exam_id, student_id) do update
    set reason = excluded.reason,
        overridden_checks = excluded.overridden_checks,
        approved_by = excluded.approved_by,
        approved_at = now();

  return jsonb_build_object('overridden', coalesce(v_elig -> 'blocks', '[]'::jsonb));
end;
$$;

revoke all on function public.override_admit_card(uuid, uuid, text) from public, anon;
grant execute on function public.override_admit_card(uuid, uuid, text) to authenticated;

-- ===========================================================================
-- admit_card_data — everything one admit card prints
-- ---------------------------------------------------------------------------
-- Returned as one row per exam subject so the card can list the timetable the
-- student actually sits, with the seat code and the eligibility verdict
-- attached. The verdict travels with the data so a PDF route cannot print a
-- card for a blocked student by forgetting to check.
-- ===========================================================================
create or replace function public.admit_card_data(
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
  v_row jsonb;
begin
  if not coalesce(
       app.is_authority()
       or app.owns_student_record(p_student_id)
       or (app.is_teacher() and app.teaches_student(p_student_id)),
       false
     ) then
    raise exception 'you may not read that admit card'
      using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'student', jsonb_build_object(
      'id', st.id,
      'full_name', st.full_name,
      'full_name_bn', st.full_name_bn,
      'registration_no', st.registration_no,
      'roll_no', se.roll_no,
      'class_name', c.name,
      'section_name', sec.name,
      'photo_path', st.photo_path,
      'father_name', st.father_name,
      'mother_name', st.mother_name
    ),
    'exam', jsonb_build_object(
      'id', e.id,
      'name', e.name,
      'term_name', t.name,
      'academic_year', ay.name,
      'starts_on', e.starts_on,
      'ends_on', e.ends_on
    ),
    'school', jsonb_build_object(
      'name', sch.name,
      'short_name', sch.short_name,
      'address', sch.address,
      'office_phone', sch.office_phone,
      'email', sch.email,
      'logo_path', sch.logo_path
    ),
    'seat_token', (
      select token from public.exam_seat_tokens
      where exam_id = p_exam_id and student_id = p_student_id
    ),
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject', sj.name,
        'subject_bn', sj.name_bn,
        'exam_date', es.exam_date,
        'starts_at', es.starts_at,
        'ends_at', es.ends_at,
        'room', es.room,
        'max_marks', es.max_marks
      ) order by es.exam_date nulls last, sj.name)
      from public.exam_subjects es
      join public.subjects sj on sj.id = es.subject_id
      where es.exam_id = p_exam_id and es.class_id = se.class_id
    ), '[]'::jsonb),
    'eligibility', public.admit_card_eligibility(p_student_id, p_exam_id)
  )
  into v_row
  from public.students st
  join public.exams e on e.id = p_exam_id
  join public.terms t on t.id = e.term_id
  join public.academic_years ay on ay.id = e.academic_year_id
  join public.student_enrollments se
    on se.student_id = st.id
   and se.academic_year_id = e.academic_year_id
   and se.status = 'active'
  join public.sections sec on sec.id = se.section_id
  join public.classes c on c.id = sec.class_id
  cross join public.school_settings sch
  where st.id = p_student_id;

  if v_row is null then
    raise exception 'that student is not enrolled for this exam''s year'
      using errcode = 'no_data_found';
  end if;

  return v_row;
end;
$$;

revoke all on function public.admit_card_data(uuid, uuid) from public, anon;
grant execute on function public.admit_card_data(uuid, uuid) to authenticated;

-- ===========================================================================
-- issue_qr_token — the public ID card link
-- ---------------------------------------------------------------------------
-- Builds the snapshot from the TEMPLATE's declared fields, so what the public
-- page shows is decided by configuration rather than by whatever this function
-- happened to select. A field the template does not ask for is not copied, and
-- the trigger from 0011 refuses the forbidden keys regardless.
--
-- Issuing replaces any live token for that student: the unique index permits
-- one, and a lost card's link must stop working when a replacement is printed.
-- ===========================================================================
create or replace function public.issue_qr_token(
  p_student_id uuid,
  p_token text,
  p_template_id uuid default null,
  p_replacing_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template public.document_templates%rowtype;
  v_fields   text[];
  v_snapshot jsonb := '{}'::jsonb;
  v_old      public.qr_tokens%rowtype;
  v_new_id   uuid;
  v_student  record;
begin
  if not app.is_authority() then
    raise exception 'only the school office may issue an ID card'
      using errcode = 'insufficient_privilege';
  end if;

  if p_token is null or length(p_token) < 32 then
    raise exception 'the card token must be at least 32 characters'
      using errcode = 'check_violation';
  end if;

  select * into v_template
  from public.document_templates
  where id = coalesce(
    p_template_id,
    (select id from public.document_templates
      where kind = 'id_card' and is_default and is_active limit 1)
  );

  if not found then
    raise exception 'no ID card template is configured' using errcode = 'no_data_found';
  end if;

  select
    st.full_name, st.full_name_bn, st.registration_no, st.blood_group,
    st.photo_path, se.roll_no, c.name as class_name, sec.name as section_name,
    ay.name as session_name,
    (select sc.phone from public.student_contacts sc
      where sc.student_id = st.id
      order by sc.is_sms_target desc, sc.created_at
      limit 1) as guardian_phone
  into v_student
  from public.students st
  join public.student_enrollments se
    on se.student_id = st.id and se.status = 'active'
  join public.academic_years ay
    on ay.id = se.academic_year_id and ay.is_current
  join public.sections sec on sec.id = se.section_id
  join public.classes c on c.id = sec.class_id
  where st.id = p_student_id;

  if not found then
    raise exception 'that student has no active enrollment in the current year'
      using errcode = 'no_data_found';
  end if;

  -- The template decides the contents. Anything not named here is not copied,
  -- so widening the public surface means editing a template row, which is
  -- visible and auditable, rather than editing a query nobody re-reads.
  v_fields := coalesce(
    array(select jsonb_array_elements_text(v_template.config -> 'front_fields')),
    array[]::text[]
  ) || coalesce(
    array(select jsonb_array_elements_text(v_template.config -> 'back_fields')),
    array[]::text[]
  );

  if 'full_name' = any (v_fields) then
    v_snapshot := v_snapshot || jsonb_build_object('full_name', v_student.full_name);
  end if;
  if 'full_name_bn' = any (v_fields) then
    v_snapshot := v_snapshot || jsonb_build_object('full_name_bn', v_student.full_name_bn);
  end if;
  if 'registration_no' = any (v_fields) then
    v_snapshot := v_snapshot || jsonb_build_object('registration_no', v_student.registration_no);
  end if;
  if 'class_name' = any (v_fields) then
    v_snapshot := v_snapshot || jsonb_build_object('class_name', v_student.class_name);
  end if;
  if 'section_name' = any (v_fields) then
    v_snapshot := v_snapshot || jsonb_build_object('section_name', v_student.section_name);
  end if;
  if 'roll_no' = any (v_fields) then
    v_snapshot := v_snapshot || jsonb_build_object('roll_no', v_student.roll_no);
  end if;
  if 'blood_group' = any (v_fields) then
    v_snapshot := v_snapshot || jsonb_build_object('blood_group', v_student.blood_group);
  end if;
  if 'session' = any (v_fields) then
    v_snapshot := v_snapshot || jsonb_build_object('session', v_student.session_name);
  end if;
  if 'photo' = any (v_fields) then
    v_snapshot := v_snapshot || jsonb_build_object('photo_path', v_student.photo_path);
  end if;
  -- The owner chose to print this on the card. It is kept in the snapshot so
  -- the printed card can be generated from it; the public page deliberately
  -- does not render it. See this migration's header.
  if 'guardian_phone' = any (v_fields) then
    v_snapshot := v_snapshot || jsonb_build_object('guardian_phone', v_student.guardian_phone);
  end if;

  /*
   * Revoke the live card BEFORE inserting the replacement.
   *
   * The order matters and is not cosmetic: qr_tokens_single_active_idx is a
   * unique index on (student_id) WHERE revoked_at IS NULL, so inserting the new
   * row while the old one is still live violates it immediately — which made
   * reissuing a lost card impossible until this was reordered. The
   * replaced_by_id link is set afterwards, once the new row has an id.
   */
  select * into v_old
  from public.qr_tokens
  where student_id = p_student_id and revoked_at is null
  for update;

  if v_old.id is not null then
    update public.qr_tokens
       set revoked_at = now(),
           revoked_by = auth.uid(),
           revoke_reason = coalesce(
             nullif(btrim(coalesce(p_replacing_reason, '')), ''),
             'replaced by a newly issued card'
           )
     where id = v_old.id;
  end if;

  insert into public.qr_tokens (
    token, student_id, template_id, card_snapshot, issued_by
  )
  values (p_token, p_student_id, v_template.id, v_snapshot, auth.uid())
  returning id into v_new_id;

  if v_old.id is not null then
    update public.qr_tokens set replaced_by_id = v_new_id where id = v_old.id;
  end if;

  insert into public.generated_documents (kind, template_id, student_id, meta, generated_by)
  values ('id_card', v_template.id, p_student_id,
          jsonb_build_object('qr_token_id', v_new_id, 'replaced', v_old.id is not null),
          auth.uid());

  return jsonb_build_object(
    'qr_token_id', v_new_id,
    'replaced_previous', v_old.id is not null,
    'fields', (select jsonb_agg(k) from jsonb_object_keys(v_snapshot) k)
  );
end;
$$;

comment on function public.issue_qr_token(uuid, text, uuid, text) is
  'Issues a public card link. The snapshot carries only the template''s declared fields; issuing revokes the previous card.';

revoke all on function public.issue_qr_token(uuid, text, uuid, text) from public, anon;
grant execute on function public.issue_qr_token(uuid, text, uuid, text) to authenticated;

-- ===========================================================================
-- revoke_qr_token — kill a lost card's link
-- ===========================================================================
create or replace function public.revoke_qr_token(p_token_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid;
begin
  if not app.is_authority() then
    raise exception 'only the school office may revoke an ID card'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'revoking a card requires a reason' using errcode = 'check_violation';
  end if;

  update public.qr_tokens
     set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = btrim(p_reason)
   where id = p_token_id and revoked_at is null
  returning student_id into v_student;

  if v_student is null then
    raise exception 'that card is already revoked, or does not exist'
      using errcode = 'no_data_found';
  end if;

  return jsonb_build_object('revoked', p_token_id, 'student_id', v_student);
end;
$$;

revoke all on function public.revoke_qr_token(uuid, text) from public, anon;
grant execute on function public.revoke_qr_token(uuid, text) to authenticated;

-- ===========================================================================
-- exam_admit_overview — the office's issue-and-chase screen
-- ===========================================================================
create or replace function public.exam_admit_overview(
  p_exam_id uuid,
  p_class_id uuid default null
)
returns table (
  student_id      uuid,
  full_name       text,
  registration_no text,
  class_name      text,
  section_name    text,
  roll_no         integer,
  eligible        boolean,
  blocks          jsonb,
  overridden      boolean,
  outstanding_monthly numeric,
  outstanding_exam_fee numeric,
  seat_token      text,
  issued_at       timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    st.id, st.full_name, st.registration_no, c.name, sec.name, se.roll_no,
    coalesce((el ->> 'eligible')::boolean, false),
    coalesce(el -> 'blocks', '[]'::jsonb),
    coalesce((el ->> 'overridden')::boolean, false),
    coalesce((el ->> 'outstanding_monthly')::numeric, 0),
    coalesce((el ->> 'outstanding_exam_fee')::numeric, 0),
    tok.token,
    (select max(gd.generated_at) from public.generated_documents gd
      where gd.kind = 'admit_card'
        and gd.student_id = st.id
        and gd.exam_id = p_exam_id)
  from public.exams e
  join public.student_enrollments se
    on se.academic_year_id = e.academic_year_id and se.status = 'active'
  join public.students st on st.id = se.student_id
  join public.sections sec on sec.id = se.section_id
  join public.classes c on c.id = sec.class_id
  left join public.exam_seat_tokens tok
    on tok.exam_id = p_exam_id and tok.student_id = st.id
  cross join lateral public.admit_card_eligibility(st.id, p_exam_id) el
  where e.id = p_exam_id
    and (p_class_id is null or se.class_id = p_class_id)
    -- Only classes that actually sit this exam.
    and exists (
      select 1 from public.exam_subjects es
      where es.exam_id = p_exam_id and es.class_id = se.class_id
    )
    and app.is_authority()
  order by c.level_order, sec.name, se.roll_no;
$$;

revoke all on function public.exam_admit_overview(uuid, uuid) from public, anon;
grant execute on function public.exam_admit_overview(uuid, uuid) to authenticated;

-- ===========================================================================
-- exam_routine_data — the printable exam schedule
-- ===========================================================================
create or replace function public.exam_routine_data(p_exam_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'exam', jsonb_build_object(
      'name', e.name,
      'term_name', t.name,
      'academic_year', ay.name,
      'starts_on', e.starts_on,
      'ends_on', e.ends_on,
      'routine_published_at', e.routine_published_at
    ),
    'school', jsonb_build_object(
      'name', sch.name,
      'short_name', sch.short_name,
      'address', sch.address,
      'office_phone', sch.office_phone
    ),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'class_name', c.name,
        'level_order', c.level_order,
        'subject', sj.name,
        'subject_bn', sj.name_bn,
        'exam_date', es.exam_date,
        'starts_at', es.starts_at,
        'ends_at', es.ends_at,
        'room', es.room,
        'max_marks', es.max_marks
      ) order by es.exam_date nulls last, c.level_order, sj.name)
      from public.exam_subjects es
      join public.classes c on c.id = es.class_id
      join public.subjects sj on sj.id = es.subject_id
      where es.exam_id = e.id
    ), '[]'::jsonb)
  )
  from public.exams e
  join public.terms t on t.id = e.term_id
  join public.academic_years ay on ay.id = e.academic_year_id
  cross join public.school_settings sch
  where e.id = p_exam_id
    -- A student sees the schedule only once it is published; staff see it any
    -- time, because they are the ones preparing it.
    and coalesce(
      app.is_authority()
      or app.is_teacher()
      or (app.is_student() and e.routine_published_at is not null),
      false
    );
$$;

revoke all on function public.exam_routine_data(uuid) from public, anon;
grant execute on function public.exam_routine_data(uuid) to authenticated;

-- ===========================================================================
-- result_sheet_data — the printable result sheet
-- ---------------------------------------------------------------------------
-- Reads published_results, so an unpublished exam has nothing to print. The
-- figures come from the frozen snapshot, which is why a reprint months later
-- matches the sheet the parent first received.
-- ===========================================================================
create or replace function public.result_sheet_data(
  p_exam_id uuid,
  p_student_id uuid default null,
  p_section_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'exam', jsonb_build_object(
      'name', e.name,
      'term_name', t.name,
      'academic_year', ay.name,
      'results_published_at', e.results_published_at
    ),
    'school', jsonb_build_object(
      'name', sch.name,
      'short_name', sch.short_name,
      'address', sch.address,
      'office_phone', sch.office_phone
    ),
    'sheets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_id', st.id,
        'full_name', st.full_name,
        'full_name_bn', st.full_name_bn,
        'registration_no', st.registration_no,
        'roll_no', se.roll_no,
        'class_name', c.name,
        'section_name', sec.name,
        'father_name', st.father_name,
        'mother_name', st.mother_name,
        'total_obtained', pr.total_obtained,
        'total_max', pr.total_max,
        'percentage', pr.percentage,
        'gpa', pr.gpa,
        'grade', pr.grade,
        'is_pass', pr.is_pass,
        'attendance_pct', pr.attendance_pct,
        'position_in_class', pr.position_in_class,
        'snapshot', pr.snapshot
      ) order by c.level_order, sec.name, se.roll_no)
      from public.published_results pr
      join public.students st on st.id = pr.student_id
      join public.student_enrollments se on se.id = pr.enrollment_id
      join public.sections sec on sec.id = se.section_id
      join public.classes c on c.id = sec.class_id
      where pr.exam_id = e.id
        and (p_student_id is null or pr.student_id = p_student_id)
        and (p_section_id is null or se.section_id = p_section_id)
        -- A student may print only their own; staff may print a whole section.
        and coalesce(
          app.is_authority()
          or app.owns_student_record(pr.student_id)
          or (app.is_teacher() and app.teaches_student(pr.student_id)),
          false
        )
    ), '[]'::jsonb)
  )
  from public.exams e
  join public.terms t on t.id = e.term_id
  join public.academic_years ay on ay.id = e.academic_year_id
  cross join public.school_settings sch
  where e.id = p_exam_id
    and e.results_published_at is not null;
$$;

comment on function public.result_sheet_data(uuid, uuid, uuid) is
  'Printable result sheets from the frozen snapshot. Nothing to return until results are published.';

revoke all on function public.result_sheet_data(uuid, uuid, uuid) from public, anon;
grant execute on function public.result_sheet_data(uuid, uuid, uuid) to authenticated;

-- ===========================================================================
-- The ID card templates the owner asked for
-- ---------------------------------------------------------------------------
-- Both orientations exist and the office switches the default, which is what
-- the owner chose. These live in a migration rather than the dev seed because
-- issue_qr_token cannot run without a template, so a real project needs them.
--
-- The field lists ARE the policy decision:
--   front — photo, name, class, section, roll, registration number, blood
--           group, session, and the GUARDIAN'S PHONE NUMBER
--   back  — school address and the office number, with a return-if-found note
--
-- The guardian's number on the front is the owner's explicit choice. To stop
-- printing it: remove 'guardian_phone' from front_fields and reissue the
-- affected cards. The public QR page does not render it either way.
-- ===========================================================================
insert into public.document_templates (id, kind, name, orientation, is_default, config) values
  (
    'd0c00000-0000-4000-8000-000000000001',
    'id_card', 'Student ID — portrait', 'portrait', true,
    jsonb_build_object(
      'width_mm', 54, 'height_mm', 85.6,
      'front_fields', jsonb_build_array(
        'photo', 'full_name', 'full_name_bn', 'class_name', 'section_name',
        'roll_no', 'registration_no', 'blood_group', 'session', 'guardian_phone'
      ),
      'back_fields', jsonb_build_array('school_address', 'office_phone', 'return_note'),
      'return_note', 'If found, please return this card to the school office.'
    )
  ),
  (
    'd0c00000-0000-4000-8000-000000000002',
    'id_card', 'Student ID — landscape', 'landscape', false,
    jsonb_build_object(
      'width_mm', 85.6, 'height_mm', 54,
      'front_fields', jsonb_build_array(
        'photo', 'full_name', 'full_name_bn', 'class_name', 'section_name',
        'roll_no', 'registration_no', 'blood_group', 'session', 'guardian_phone'
      ),
      'back_fields', jsonb_build_array('school_address', 'office_phone', 'return_note'),
      'return_note', 'If found, please return this card to the school office.'
    )
  ),
  (
    'd0c00000-0000-4000-8000-000000000003',
    'admit_card', 'Admit card — 3 per A4', 'portrait', true,
    jsonb_build_object(
      'per_page', 3,
      'fields', jsonb_build_array(
        'photo', 'full_name', 'class_name', 'section_name', 'roll_no',
        'registration_no', 'seat_token', 'subject_timetable'
      )
    )
  ),
  (
    'd0c00000-0000-4000-8000-000000000004',
    'result_sheet', 'Result sheet — A4', 'portrait', true,
    jsonb_build_object(
      'fields', jsonb_build_array(
        'full_name', 'registration_no', 'roll_no', 'class_name', 'father_name',
        'mother_name', 'subject_table', 'gpa', 'grade', 'position', 'attendance'
      )
    )
  )
on conflict (id) do nothing;

-- ===========================================================================
-- Privileges for everything this migration created
-- ---------------------------------------------------------------------------
-- Supabase's database has DEFAULT PRIVILEGES that grant new tables and
-- functions to `anon` BY NAME, so a `grant ... to authenticated` does not
-- displace them and `revoke ... from public` does not either. Migrations 0020
-- and 0031 both exist because this was missed once. Every object added above
-- is revoked from anon explicitly here, and `npm run report:remote-schema`
-- checks the live project afterwards.
-- ===========================================================================
revoke all on table public.exam_seat_tokens from anon;
revoke all on function app.seat_token_code() from public, anon;
