-- ===========================================================================
-- 0037  Message templates, the notification queue, and delivery reporting
-- ---------------------------------------------------------------------------
-- NOTHING HERE SENDS AN SMS. No provider is connected and the owner has asked
-- that none be connected yet, so every dispatch runs in simulate mode: the
-- message is rendered, costed and recorded, and nothing leaves the building.
-- That is a deliberate state, not an unfinished one — the point is that the
-- rules, the templates, the queue, the duplicate prevention and the reporting
-- can all be built and tested now, so connecting a provider later is a
-- credentials change rather than a rewrite.
--
-- Where the hard part is: "exactly one daily summary per student per school
-- day" is not a scheduling problem, it is an idempotency problem. A cron that
-- overlaps itself, a manual retry, a second office click — each must produce
-- one message, not two. `notification_jobs.dedupe_key` is UNIQUE (migration
-- 0013) and that unique index IS the guarantee. Everything below builds keys
-- and lets the index refuse the duplicate; nothing checks-then-inserts, because
-- the gap between the two is exactly where a double send lives.
--
-- Rendering is deliberately NOT done here. A job carries structured facts in
-- `payload`; the application renders the body and counts billable segments,
-- because Bangla is UCS-2 at 70 characters per segment against 160 for Latin
-- and that arithmetic belongs with the one implementation of it
-- (src/lib/sms/segments.ts). SQL that re-counted it would be a second
-- implementation to disagree with the first.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- notification_templates — the message bodies, as configuration
-- --------------------------------------------------------------------------
-- One row per notification type per language. The body carries {placeholders}
-- that the renderer fills from the job's payload; an unknown placeholder is
-- left visible rather than silently blanked, so a broken template is obvious
-- in the preview instead of producing a message with a hole in it.
-- --------------------------------------------------------------------------
create table public.notification_templates (
  id            uuid primary key default gen_random_uuid(),
  type          public.notification_type not null,
  -- 'en' or 'bn'. Bangla costs more than twice as much per character to send,
  -- so the choice is a budget decision as much as a language one.
  language      text not null default 'en' check (language in ('en', 'bn')),

  name          text not null,
  body          text not null check (length(btrim(body)) > 0),

  -- The placeholder names this template expects, for the preview and for a
  -- check that a template is not asking for a fact the job does not carry.
  placeholders  text[] not null default array[]::text[],

  is_active     boolean not null default true,
  is_default    boolean not null default false,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null,

  unique (type, language, name)
);

-- One default per type per language, so rendering never has to choose.
create unique index notification_templates_default_idx
  on public.notification_templates (type, language)
  where is_default and is_active;

create trigger notification_templates_touch_updated_at
  before update on public.notification_templates
  for each row execute function app.touch_updated_at();

comment on table public.notification_templates is
  'SMS bodies as configuration. {placeholders} are filled from notification_jobs.payload by the application.';

alter table public.notification_templates enable row level security;

create policy "authority manages templates"
  on public.notification_templates for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

grant select, insert, update, delete on public.notification_templates to authenticated;
revoke all on table public.notification_templates from anon;

-- --------------------------------------------------------------------------
-- The starting templates.
-- --------------------------------------------------------------------------
-- Wording is a placeholder for the owner to edit, not a decision: it is a
-- table, and the authority screen edits it. The Bangla variants exist so the
-- cost difference is visible in the preview before anyone commits to sending
-- in Bangla.
-- --------------------------------------------------------------------------
insert into public.notification_templates (type, language, name, body, placeholders, is_default) values
  (
    'daily_attendance', 'en', 'Daily attendance (English)',
    '{school}: {student} was {status} on {date}. Present {present}/{lessons} lessons.',
    array['school', 'student', 'status', 'date', 'present', 'lessons'],
    true
  ),
  (
    'daily_attendance', 'bn', 'Daily attendance (Bangla)',
    '{school}: {date} তারিখে {student} {status}। উপস্থিত {present}/{lessons} ক্লাস।',
    array['school', 'student', 'status', 'date', 'present', 'lessons'],
    true
  ),
  (
    'exam_result', 'en', 'Published result (English)',
    -- A hyphen, NOT an em dash. One character outside GSM-7 forces the whole
    -- message into UCS-2, where a segment is 70 characters rather than 160 —
    -- so an em dash here doubles the cost of every result SMS. Migration 0038
    -- exists because this shipped wrong once.
    '{school}: {student} - {exam} result. Marks {obtained}/{max} ({percentage}%), GPA {gpa}, grade {grade}. {outcome}.',
    array['school', 'student', 'exam', 'obtained', 'max', 'percentage', 'gpa', 'grade', 'outcome'],
    true
  ),
  (
    'exam_result', 'bn', 'Published result (Bangla)',
    '{school}: {student} — {exam} ফলাফল। নম্বর {obtained}/{max} ({percentage}%), জিপিএ {gpa}, গ্রেড {grade}। {outcome}।',
    array['school', 'student', 'exam', 'obtained', 'max', 'percentage', 'gpa', 'grade', 'outcome'],
    true
  ),
  (
    'class_test_result', 'en', 'Class test result (English)',
    '{school}: {student} scored {obtained}/{max} in {test} ({subject}) on {date}.',
    array['school', 'student', 'obtained', 'max', 'test', 'subject', 'date'],
    true
  ),
  (
    'class_test_result', 'bn', 'Class test result (Bangla)',
    '{school}: {date} তারিখে {test} ({subject}) পরীক্ষায় {student} পেয়েছে {obtained}/{max}।',
    array['school', 'student', 'obtained', 'max', 'test', 'subject', 'date'],
    true
  ),
  (
    'account_otp', 'en', 'Account code (English)',
    '{school}: your verification code is {code}. It expires in {minutes} minutes. Do not share it.',
    array['school', 'code', 'minutes'],
    true
  )
on conflict (type, language, name) do nothing;

-- ===========================================================================
-- queue_daily_attendance — one job per student per school day
-- ---------------------------------------------------------------------------
-- Builds the summary jobs for one date. Re-runnable by construction: the
-- dedupe key is `daily_attendance|<student>|<date>`, so a second run inserts
-- nothing and reports how many it skipped.
--
-- What it deliberately does NOT do:
--   * It does not send. It queues.
--   * It does not queue for a day with no submitted attendance at all. A
--     summary saying "present 0/0" is worse than silence: it reads as an
--     absence when the truth is that no teacher submitted.
--   * It does not queue for a student with no SMS contact on record, and says
--     so, rather than creating a job that can only fail.
-- ===========================================================================
create or replace function public.queue_daily_attendance(p_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.school_settings%rowtype;
  v_queued   integer := 0;
  v_skipped_existing integer := 0;
  v_skipped_no_phone integer := 0;
  v_skipped_no_data  integer := 0;
  v_scheduled_for timestamptz;
  r          record;
begin
  if not app.is_authority() then
    raise exception 'only the school office may queue notifications'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_settings from public.school_settings where id;

  -- The earliest moment a summary may go out: the last lesson's end plus the
  -- configured grace period, but never before the configured earliest time.
  -- Both are columns the office can change.
  select greatest(
           (p_date + max(ts.ends_at) + make_interval(mins => v_settings.daily_sms_grace_minutes))
             at time zone v_settings.timezone,
           (p_date + v_settings.daily_sms_earliest_time) at time zone v_settings.timezone
         )
    into v_scheduled_for
  from public.teaching_sessions ts
  where ts.session_date = p_date and ts.submitted_at is not null;

  v_scheduled_for := coalesce(
    v_scheduled_for,
    (p_date + v_settings.daily_sms_earliest_time) at time zone v_settings.timezone
  );

  for r in
    select
      se.student_id,
      st.full_name,
      (select sc.phone
         from public.student_contacts sc
        where sc.student_id = se.student_id
        order by sc.is_sms_target desc, sc.created_at
        limit 1) as phone,
      count(sa.id) filter (where sa.status in ('present', 'late')) as present,
      count(sa.id) as lessons
    from public.student_enrollments se
    join public.students st on st.id = se.student_id
    join public.academic_years ay
      on ay.id = se.academic_year_id and ay.is_current
    left join public.teaching_sessions ts
      on ts.section_id = se.section_id
     and ts.session_date = p_date
     and ts.submitted_at is not null
     and not ts.is_cancelled
    left join public.student_attendance sa
      on sa.teaching_session_id = ts.id and sa.student_id = se.student_id
    where se.status = 'active'
    group by se.student_id, st.full_name
  loop
    -- No submitted lesson touched this student today: say nothing.
    if r.lessons = 0 then
      v_skipped_no_data := v_skipped_no_data + 1;
      continue;
    end if;

    if r.phone is null then
      v_skipped_no_phone := v_skipped_no_phone + 1;
      continue;
    end if;

    begin
      insert into public.notification_jobs (
        type, student_id, target_phone, job_date, payload, status,
        scheduled_for, dedupe_key
      )
      values (
        'daily_attendance', r.student_id, r.phone, p_date,
        jsonb_build_object(
          'student', r.full_name,
          'date', to_char(p_date, 'DD Mon YYYY'),
          'present', r.present,
          'lessons', r.lessons,
          'status', case
                      when r.present = r.lessons then 'present'
                      when r.present = 0 then 'absent'
                      else 'partly present'
                    end,
          'school', coalesce(v_settings.short_name, v_settings.name)
        ),
        'pending',
        v_scheduled_for,
        'daily_attendance|' || r.student_id || '|' || p_date
      );
      v_queued := v_queued + 1;
    exception when unique_violation then
      -- The dedupe index did its job. This is the normal outcome of a re-run,
      -- not an error worth failing the whole batch for.
      v_skipped_existing := v_skipped_existing + 1;
    end;
  end loop;

  return jsonb_build_object(
    'date', p_date,
    'queued', v_queued,
    'already_queued', v_skipped_existing,
    'no_contact', v_skipped_no_phone,
    'no_submitted_attendance', v_skipped_no_data,
    'scheduled_for', v_scheduled_for,
    'enabled', v_settings.daily_sms_enabled
  );
end;
$$;

comment on function public.queue_daily_attendance(date) is
  'Queues one daily attendance summary per student for a date. Re-runnable: duplicates are refused by the dedupe index.';

revoke all on function public.queue_daily_attendance(date) from public, anon;
grant execute on function public.queue_daily_attendance(date) to authenticated;

-- ===========================================================================
-- queue_exam_results — one job per student whose result is published
-- ===========================================================================
create or replace function public.queue_exam_results(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.school_settings%rowtype;
  v_exam     public.exams%rowtype;
  v_queued   integer := 0;
  v_existing integer := 0;
  v_no_phone integer := 0;
  r          record;
begin
  if not app.is_authority() then
    raise exception 'only the school office may queue notifications'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_settings from public.school_settings where id;
  select * into v_exam from public.exams where id = p_exam_id;

  if not found then
    raise exception 'unknown exam' using errcode = 'no_data_found';
  end if;

  -- Results that are not published have nothing to announce, and announcing a
  -- draft is the one failure this whole module exists to prevent.
  if v_exam.results_published_at is null then
    raise exception 'results for this exam are not published yet'
      using errcode = 'check_violation';
  end if;

  for r in
    select
      pr.student_id, st.full_name,
      pr.total_obtained, pr.total_max, pr.percentage, pr.gpa, pr.grade, pr.is_pass,
      (select sc.phone from public.student_contacts sc
        where sc.student_id = pr.student_id
        order by sc.is_sms_target desc, sc.created_at limit 1) as phone
    from public.published_results pr
    join public.students st on st.id = pr.student_id
    where pr.exam_id = p_exam_id
  loop
    if r.phone is null then
      v_no_phone := v_no_phone + 1;
      continue;
    end if;

    begin
      insert into public.notification_jobs (
        type, student_id, target_phone, job_date, payload, status, scheduled_for, dedupe_key
      )
      values (
        'exam_result', r.student_id, r.phone, v_exam.results_published_at::date,
        jsonb_build_object(
          'student', r.full_name,
          'exam', v_exam.name,
          'obtained', round(r.total_obtained, 2),
          'max', round(r.total_max, 2),
          'percentage', round(r.percentage, 2),
          'gpa', coalesce(to_char(r.gpa, 'FM990.00'), 'n/a'),
          'grade', coalesce(r.grade, '-'),
          'outcome', case when r.is_pass then 'Passed' else 'Not passed' end,
          'school', coalesce(v_settings.short_name, v_settings.name)
        ),
        'pending', now(),
        'exam_result|' || r.student_id || '|' || p_exam_id
      );
      v_queued := v_queued + 1;
    exception when unique_violation then
      v_existing := v_existing + 1;
    end;
  end loop;

  return jsonb_build_object(
    'exam_id', p_exam_id,
    'queued', v_queued,
    'already_queued', v_existing,
    'no_contact', v_no_phone
  );
end;
$$;

comment on function public.queue_exam_results(uuid) is
  'Queues result SMS for a PUBLISHED exam, one per student. Refuses while results are unpublished.';

revoke all on function public.queue_exam_results(uuid) from public, anon;
grant execute on function public.queue_exam_results(uuid) to authenticated;

-- ===========================================================================
-- queue_class_test_results — the teacher's own test, one job per marked student
-- ---------------------------------------------------------------------------
-- Called by send_class_test_result, which already owns the once-only guard on
-- class_tests.result_sent_at. This adds the per-student jobs so a class test
-- behaves like every other message: queued, costed, reportable.
-- ===========================================================================
create or replace function public.queue_class_test_results(p_class_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.school_settings%rowtype;
  v_test     public.class_tests%rowtype;
  v_subject  text;
  v_queued   integer := 0;
  v_existing integer := 0;
  v_no_phone integer := 0;
  r          record;
begin
  select * into v_test from public.class_tests where id = p_class_test_id;
  if not found then
    raise exception 'unknown class test' using errcode = 'no_data_found';
  end if;

  if not coalesce(
       app.is_authority() or v_test.teacher_id = app.current_teacher_id(), false
     ) then
    raise exception 'that class test belongs to another teacher'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_settings from public.school_settings where id;
  select name into v_subject from public.subjects where id = v_test.subject_id;

  for r in
    select
      m.student_id, st.full_name, m.marks_obtained, m.is_absent,
      (select sc.phone from public.student_contacts sc
        where sc.student_id = m.student_id
        order by sc.is_sms_target desc, sc.created_at limit 1) as phone
    from public.class_test_marks m
    join public.students st on st.id = m.student_id
    where m.class_test_id = p_class_test_id
  loop
    if r.phone is null then
      v_no_phone := v_no_phone + 1;
      continue;
    end if;

    begin
      insert into public.notification_jobs (
        type, student_id, target_phone, job_date, payload, status, scheduled_for, dedupe_key
      )
      values (
        'class_test_result', r.student_id, r.phone, v_test.test_date,
        jsonb_build_object(
          'student', r.full_name,
          'test', v_test.name,
          'subject', v_subject,
          'obtained', case when r.is_absent then 'absent'
                           else trim(to_char(r.marks_obtained, 'FM999990.99')) end,
          'max', trim(to_char(v_test.max_marks, 'FM999990.99')),
          'date', to_char(v_test.test_date, 'DD Mon YYYY'),
          'school', coalesce(v_settings.short_name, v_settings.name)
        ),
        'pending', now(),
        'class_test_result|' || r.student_id || '|' || p_class_test_id
      );
      v_queued := v_queued + 1;
    exception when unique_violation then
      v_existing := v_existing + 1;
    end;
  end loop;

  return jsonb_build_object(
    'class_test_id', p_class_test_id,
    'queued', v_queued,
    'already_queued', v_existing,
    'no_contact', v_no_phone
  );
end;
$$;

revoke all on function public.queue_class_test_results(uuid) from public, anon;
grant execute on function public.queue_class_test_results(uuid) to authenticated;

-- ===========================================================================
-- claim_notification_jobs — hand the dispatcher a batch, exactly once
-- ---------------------------------------------------------------------------
-- `for update skip locked` is the whole point: two dispatchers running at once
-- take different rows rather than both taking the same one. Marking them
-- 'queued' in the same statement means a crash after claiming leaves them
-- visibly stuck in 'queued' rather than silently re-sendable.
-- ===========================================================================
create or replace function public.claim_notification_jobs(p_limit integer default 50)
returns table (
  id           uuid,
  type         public.notification_type,
  student_id   uuid,
  teacher_id   uuid,
  target_phone text,
  payload      jsonb
)
language sql
volatile
security definer
set search_path = ''
as $$
  with claimed as (
    select j.id
    from public.notification_jobs j
    where j.status in ('pending', 'queued')
      and (j.scheduled_for is null or j.scheduled_for <= now())
      and app.is_authority()
    order by j.scheduled_for nulls first, j.created_at
    limit greatest(1, least(p_limit, 500))
    for update skip locked
  )
  update public.notification_jobs j
     set status = 'queued', attempts = j.attempts + 1
    from claimed
   where j.id = claimed.id
  returning j.id, j.type, j.student_id, j.teacher_id, j.target_phone, j.payload;
$$;

comment on function public.claim_notification_jobs(integer) is
  'Claims a batch for dispatch with skip-locked, so two dispatchers never take the same job.';

revoke all on function public.claim_notification_jobs(integer) from public, anon;
grant execute on function public.claim_notification_jobs(integer) to authenticated;

-- ===========================================================================
-- settle_notification_job — record the outcome of one dispatch
-- ===========================================================================
create or replace function public.settle_notification_job(
  p_job_id uuid,
  p_status public.notification_status,
  p_body text,
  p_segments smallint,
  p_is_unicode boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_authority() then
    raise exception 'only the school office may settle a notification'
      using errcode = 'insufficient_privilege';
  end if;

  update public.notification_jobs
     set status = p_status,
         body = coalesce(p_body, body),
         segments = coalesce(p_segments, segments),
         is_unicode = coalesce(p_is_unicode, is_unicode),
         last_error = p_error,
         -- sent_at marks a dispatch attempt that reached its destination. In
         -- simulate mode nothing reaches a phone, so the caller passes
         -- 'skipped' and this stays null — which is what keeps a simulated run
         -- from ever looking like a delivered one in the reporting.
         sent_at = case when p_status = 'sent' then now() else sent_at end
   where id = p_job_id;
end;
$$;

revoke all on function public.settle_notification_job(uuid, public.notification_status, text, smallint, boolean, text) from public, anon;
grant execute on function public.settle_notification_job(uuid, public.notification_status, text, smallint, boolean, text) to authenticated;

-- ===========================================================================
-- notification_overview — what the office needs to see
-- ---------------------------------------------------------------------------
-- Segment counts are reported because they are the bill. A Bangla message is
-- 70 characters per segment, so the same sentence can cost three times what its
-- English equivalent does, and the office should be able to see that before
-- choosing a language rather than after the invoice.
-- ===========================================================================
create or replace function public.notification_overview(
  p_from date default null,
  p_to date default null
)
returns table (
  type            public.notification_type,
  status          public.notification_status,
  jobs            bigint,
  segments        bigint,
  unicode_jobs    bigint,
  simulated_sends bigint,
  live_sends      bigint,
  failures        bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    j.type,
    j.status,
    count(*) as jobs,
    coalesce(sum(j.segments), 0) as segments,
    count(*) filter (where j.is_unicode) as unicode_jobs,
    (select count(*) from public.sms_delivery_logs l
      where l.job_id = any (array_agg(j.id)) and l.mode = 'simulate') as simulated_sends,
    (select count(*) from public.sms_delivery_logs l
      where l.job_id = any (array_agg(j.id)) and l.mode = 'live') as live_sends,
    (select count(*) from public.sms_delivery_logs l
      where l.job_id = any (array_agg(j.id)) and l.status = 'failed') as failures
  from public.notification_jobs j
  where app.is_authority()
    and (p_from is null or coalesce(j.job_date, j.created_at::date) >= p_from)
    and (p_to is null or coalesce(j.job_date, j.created_at::date) <= p_to)
  group by j.type, j.status
  order by j.type, j.status;
$$;

revoke all on function public.notification_overview(date, date) from public, anon;
grant execute on function public.notification_overview(date, date) to authenticated;

-- --------------------------------------------------------------------------
-- Reading the delivery log
-- --------------------------------------------------------------------------
-- The policy already exists from migration 0016 ("authority reads delivery
-- logs"), so only the table grant is asserted here — the policy decides WHICH
-- rows, the grant decides whether the table can be addressed at all, and the
-- two are easy to confuse.
-- --------------------------------------------------------------------------
grant select on public.sms_delivery_logs to authenticated;
revoke all on table public.sms_delivery_logs from anon;
revoke all on table public.notification_jobs from anon;
