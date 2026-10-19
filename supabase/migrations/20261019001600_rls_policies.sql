-- ===========================================================================
-- 0016  Row Level Security
-- ---------------------------------------------------------------------------
-- RLS is enabled on every table in public, including the ones nobody is
-- expected to read directly. A table with RLS enabled and no policy denies
-- everything, which is the correct default; tables that should stay
-- service-role-only are left policy-free on purpose and marked as such.
--
-- RLS is enabled but NOT forced. Forcing it would also apply policies to the
-- table owner, which would break the audit trigger's insert into audit_logs
-- and every SECURITY DEFINER helper that reads profiles to answer "who is
-- this?". Those run as the owner precisely so they can see past RLS.
--
-- Conventions used throughout:
--   * Policy calls are wrapped as (select app.is_authority()) so the planner
--     evaluates the helper once per statement rather than once per row.
--   * Students get SELECT only. Every student write goes through a SECURITY
--     DEFINER function, so the shape of what they may write is fixed in SQL
--     rather than trusted from the client.
--   * Teachers are scoped by teacher_assignments, never by a client-supplied
--     class or section id.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Enable RLS everywhere in public
-- --------------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  for v_table in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', v_table);
  end loop;
end;
$$;

-- The service role is used by schedulers, the SMS dispatcher and the K40
-- bridge. It bypasses RLS by design; those code paths are server-only.

-- ===========================================================================
-- Reference and configuration data
-- ---------------------------------------------------------------------------
-- Readable by every signed-in user: the timetable, class list and subject list
-- are not secrets, and every portal needs them to render. Writable by authority.
-- ===========================================================================
create policy "config readable by authenticated"
  on public.school_settings for select to authenticated using (true);
create policy "config writable by admin"
  on public.school_settings for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

do $$
declare
  v_table text;
  v_tables text[] := array[
    'academic_years', 'terms', 'classes', 'sections', 'subjects',
    'class_subjects', 'grading_scales', 'grade_bands',
    'school_weekends', 'school_holidays', 'fee_types', 'fee_rates',
    'document_templates', 'work_shifts'
  ];
begin
  foreach v_table in array v_tables loop
    execute format(
      'create policy "readable by authenticated" on public.%I
         for select to authenticated using (true)', v_table);
    execute format(
      'create policy "writable by authority" on public.%I
         for all to authenticated
         using ((select app.is_authority()))
         with check ((select app.is_authority()))', v_table);
  end loop;
end;
$$;

-- ===========================================================================
-- profiles
-- ===========================================================================
create policy "own profile readable"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "authority reads all profiles"
  on public.profiles for select to authenticated
  using ((select app.is_authority()));

-- Role and activation state are set by the authority or by the activation
-- function. A user cannot grant themselves a role.
create policy "admin manages profiles"
  on public.profiles for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- ===========================================================================
-- students
-- ===========================================================================
create policy "authority reads students"
  on public.students for select to authenticated
  using ((select app.is_authority()));

create policy "authority writes students"
  on public.students for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

-- A student sees exactly one row: their own.
create policy "student reads own record"
  on public.students for select to authenticated
  using (id = (select app.current_student_id()));

-- A teacher sees only students enrolled in a section they teach.
create policy "teacher reads taught students"
  on public.students for select to authenticated
  using ((select app.is_teacher()) and app.teaches_student(id));

-- student_private_ids: authority only. No teacher policy, no student policy.
create policy "authority only private ids"
  on public.student_private_ids for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

-- student_contacts: authority manages; a student may see their own numbers.
-- Teachers get no access to guardian phone numbers.
create policy "authority manages contacts"
  on public.student_contacts for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "student reads own contacts"
  on public.student_contacts for select to authenticated
  using (student_id = (select app.current_student_id()));

-- student_enrollments
create policy "authority manages enrollments"
  on public.student_enrollments for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "student reads own enrollments"
  on public.student_enrollments for select to authenticated
  using (student_id = (select app.current_student_id()));

create policy "teacher reads enrollments in taught sections"
  on public.student_enrollments for select to authenticated
  using ((select app.is_teacher()) and app.teaches_section(section_id));

-- ===========================================================================
-- teachers
-- ===========================================================================
create policy "authority reads teachers"
  on public.teachers for select to authenticated
  using ((select app.is_authority()));

create policy "authority writes teachers"
  on public.teachers for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "teacher reads own record"
  on public.teachers for select to authenticated
  using (id = (select app.current_teacher_id()));

-- Students see the name of a teacher who teaches them, for the routine and the
-- feedback form. Phone numbers and NIDs are not in this grant: the student
-- portal selects an explicit column list, and NIDs live in another table.
create policy "student reads own teachers"
  on public.teachers for select to authenticated
  using (
    (select app.is_student())
    and exists (
      select 1 from public.teacher_assignments ta
      where ta.teacher_id = teachers.id
        and ta.section_id = (select app.current_student_section_id())
    )
  );

create policy "authority only teacher private ids"
  on public.teacher_private_ids for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

-- teacher_assignments
create policy "authority manages assignments"
  on public.teacher_assignments for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "teacher reads own assignments"
  on public.teacher_assignments for select to authenticated
  using (teacher_id = (select app.current_teacher_id()));

create policy "student reads assignments for own section"
  on public.teacher_assignments for select to authenticated
  using (section_id = (select app.current_student_section_id()));

-- leave_requests
create policy "authority manages leave"
  on public.leave_requests for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "teacher reads own leave"
  on public.leave_requests for select to authenticated
  using (teacher_id = (select app.current_teacher_id()));

-- A teacher may raise a request, but only for themselves and only as pending.
create policy "teacher requests own leave"
  on public.leave_requests for insert to authenticated
  with check (
    teacher_id = (select app.current_teacher_id())
    and status = 'pending'
    and decided_by is null
    and decided_at is null
  );

-- ===========================================================================
-- Routine and attendance
-- ===========================================================================
create policy "authority manages routine"
  on public.routine_periods for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "teacher reads own routine"
  on public.routine_periods for select to authenticated
  using (teacher_id = (select app.current_teacher_id()));

create policy "student reads own section routine"
  on public.routine_periods for select to authenticated
  using (section_id = (select app.current_student_section_id()));

create policy "authority manages cancellations"
  on public.cancelled_periods for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "cancellations readable by authenticated"
  on public.cancelled_periods for select to authenticated using (true);

-- teaching_sessions
create policy "authority manages sessions"
  on public.teaching_sessions for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "teacher reads own sessions"
  on public.teaching_sessions for select to authenticated
  using (teacher_id = (select app.current_teacher_id()));

-- A teacher opens the lesson they are about to mark. The teacher_id on the new
-- row must be their own, so a session cannot be created on someone else's behalf.
create policy "teacher creates own session"
  on public.teaching_sessions for insert to authenticated
  with check (
    teacher_id = (select app.current_teacher_id())
    and app.teaches_section_subject(section_id, subject_id, session_date)
  );

create policy "teacher submits own session"
  on public.teaching_sessions for update to authenticated
  using (teacher_id = (select app.current_teacher_id()))
  with check (teacher_id = (select app.current_teacher_id()));

create policy "student reads own sessions"
  on public.teaching_sessions for select to authenticated
  using (section_id = (select app.current_student_section_id()));

-- student_attendance
create policy "authority manages attendance"
  on public.student_attendance for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "teacher reads attendance for own sessions"
  on public.student_attendance for select to authenticated
  using (
    (select app.is_teacher())
    and app.owns_teaching_session(teaching_session_id)
  );

create policy "teacher marks attendance for own sessions"
  on public.student_attendance for insert to authenticated
  with check (
    (select app.is_teacher())
    and app.owns_teaching_session(teaching_session_id)
  );

create policy "teacher corrects attendance for own sessions"
  on public.student_attendance for update to authenticated
  using ((select app.is_teacher()) and app.owns_teaching_session(teaching_session_id))
  with check ((select app.is_teacher()) and app.owns_teaching_session(teaching_session_id));

create policy "student reads own attendance"
  on public.student_attendance for select to authenticated
  using (student_id = (select app.current_student_id()));

-- ===========================================================================
-- Fingerprint terminal
-- ---------------------------------------------------------------------------
-- raw_punch_events is written only by the on-site bridge using the service
-- role. There is deliberately no INSERT policy for any interactive user.
-- ===========================================================================
create policy "authority manages devices"
  on public.devices for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "authority manages device users"
  on public.device_users for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "teacher reads own device mapping"
  on public.device_users for select to authenticated
  using (teacher_id = (select app.current_teacher_id()));

create policy "authority reads punches"
  on public.raw_punch_events for select to authenticated
  using ((select app.is_authority()));

create policy "teacher reads own punches"
  on public.raw_punch_events for select to authenticated
  using (teacher_id = (select app.current_teacher_id()));

create policy "authority manages teacher attendance"
  on public.teacher_daily_attendance for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "teacher reads own daily attendance"
  on public.teacher_daily_attendance for select to authenticated
  using (teacher_id = (select app.current_teacher_id()));

create policy "authority manages teacher shifts"
  on public.teacher_shifts for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "teacher reads own shift"
  on public.teacher_shifts for select to authenticated
  using (teacher_id = (select app.current_teacher_id()));

-- ===========================================================================
-- Exams and marks
-- ===========================================================================
create policy "authority manages exams"
  on public.exams for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "teacher reads exams"
  on public.exams for select to authenticated
  using ((select app.is_teacher()));

-- Students see an exam only once its routine has been published.
create policy "student reads published exams"
  on public.exams for select to authenticated
  using ((select app.is_student()) and routine_published_at is not null);

create policy "authority manages exam subjects"
  on public.exam_subjects for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "teacher reads exam subjects"
  on public.exam_subjects for select to authenticated
  using ((select app.is_teacher()));

create policy "student reads published exam subjects"
  on public.exam_subjects for select to authenticated
  using (
    (select app.is_student())
    and exists (
      select 1 from public.exams e
      where e.id = exam_subjects.exam_id
        and e.routine_published_at is not null
    )
  );

-- marks: draft marks are never visible to students. Students read results from
-- published_results only.
create policy "authority manages marks"
  on public.marks for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "teacher reads own subject marks"
  on public.marks for select to authenticated
  using ((select app.is_teacher()) and app.may_enter_marks(exam_subject_id));

create policy "teacher enters own subject marks"
  on public.marks for insert to authenticated
  with check (
    (select app.is_teacher())
    and app.may_enter_marks(exam_subject_id)
    and app.teaches_student(student_id)
  );

create policy "teacher updates own subject marks"
  on public.marks for update to authenticated
  using ((select app.is_teacher()) and app.may_enter_marks(exam_subject_id))
  with check ((select app.is_teacher()) and app.may_enter_marks(exam_subject_id));

create policy "authority manages mark submissions"
  on public.mark_submissions for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "teacher reads own submissions"
  on public.mark_submissions for select to authenticated
  using (teacher_id = (select app.current_teacher_id()));

create policy "teacher records own submission"
  on public.mark_submissions for insert to authenticated
  with check (teacher_id = (select app.current_teacher_id()));

-- published_results
create policy "authority manages published results"
  on public.published_results for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "student reads own published results"
  on public.published_results for select to authenticated
  using (student_id = (select app.current_student_id()));

create policy "teacher reads results of taught students"
  on public.published_results for select to authenticated
  using ((select app.is_teacher()) and app.teaches_student(student_id));

-- class_tests
create policy "authority reads class tests"
  on public.class_tests for select to authenticated
  using ((select app.is_authority()));

create policy "teacher manages own class tests"
  on public.class_tests for all to authenticated
  using (teacher_id = (select app.current_teacher_id()))
  with check (
    teacher_id = (select app.current_teacher_id())
    and app.teaches_section_subject(section_id, subject_id, test_date)
  );

-- Students see a class test only once its result has been sent.
create policy "student reads sent class tests"
  on public.class_tests for select to authenticated
  using (
    section_id = (select app.current_student_section_id())
    and result_sent_at is not null
  );

create policy "authority reads class test marks"
  on public.class_test_marks for select to authenticated
  using ((select app.is_authority()));

create policy "teacher manages own class test marks"
  on public.class_test_marks for all to authenticated
  using (
    (select app.is_teacher())
    and exists (
      select 1 from public.class_tests ct
      where ct.id = class_test_marks.class_test_id
        and ct.teacher_id = (select app.current_teacher_id())
    )
  )
  with check (
    (select app.is_teacher())
    and exists (
      select 1 from public.class_tests ct
      where ct.id = class_test_marks.class_test_id
        and ct.teacher_id = (select app.current_teacher_id())
    )
  );

create policy "student reads own sent class test marks"
  on public.class_test_marks for select to authenticated
  using (
    student_id = (select app.current_student_id())
    and exists (
      select 1 from public.class_tests ct
      where ct.id = class_test_marks.class_test_id
        and ct.result_sent_at is not null
    )
  );

-- ===========================================================================
-- Fees
-- ---------------------------------------------------------------------------
-- Teachers have no access to any student's money. Students read their own.
-- ===========================================================================
create policy "authority manages charges"
  on public.fee_charges for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "student reads own charges"
  on public.fee_charges for select to authenticated
  using (student_id = (select app.current_student_id()));

create policy "authority manages payments"
  on public.payments for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "student reads own payments"
  on public.payments for select to authenticated
  using (student_id = (select app.current_student_id()));

create policy "authority manages allocations"
  on public.payment_allocations for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "student reads own allocations"
  on public.payment_allocations for select to authenticated
  using (
    exists (
      select 1 from public.payments p
      where p.id = payment_allocations.payment_id
        and p.student_id = (select app.current_student_id())
    )
  );

create policy "authority manages receipts"
  on public.receipts for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "student reads own receipts"
  on public.receipts for select to authenticated
  using (
    exists (
      select 1 from public.payments p
      where p.id = receipts.payment_id
        and p.student_id = (select app.current_student_id())
    )
  );

-- ===========================================================================
-- Feedback
-- ---------------------------------------------------------------------------
-- The access rules that matter here:
--   * A teacher can read NEITHER feedback_responses NOR feedback_comments, at
--     any aggregation. There is no teacher policy on those tables at all.
--   * A student can read their own targets and their own completion row, and
--     cannot read responses either — not even their own, because nothing
--     records which responses were theirs.
--   * Students never INSERT directly. submit_feedback() does it.
-- ===========================================================================
create policy "authority manages campaigns"
  on public.feedback_campaigns for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "campaigns readable by authenticated"
  on public.feedback_campaigns for select to authenticated using (true);

create policy "authority manages questions"
  on public.feedback_questions for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "student reads questions"
  on public.feedback_questions for select to authenticated
  using ((select app.is_student()));

create policy "authority manages targets"
  on public.feedback_targets for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "student reads own targets"
  on public.feedback_targets for select to authenticated
  using (student_id = (select app.current_student_id()));

create policy "authority reads completions"
  on public.feedback_completions for select to authenticated
  using ((select app.is_authority()));

create policy "student reads own completion"
  on public.feedback_completions for select to authenticated
  using (student_id = (select app.current_student_id()));

-- Authority sees analysis. Note there is no teacher policy below, and none
-- should ever be added: a teacher reading these tables, even aggregated in a
-- view, would break the anonymity guarantee the model is built on.
create policy "authority reads responses"
  on public.feedback_responses for select to authenticated
  using ((select app.is_authority()));

create policy "authority reads comments"
  on public.feedback_comments for select to authenticated
  using ((select app.is_authority()));

-- ===========================================================================
-- Documents, QR and eligibility
-- ===========================================================================
create policy "authority manages qr tokens"
  on public.qr_tokens for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

-- A student may read their own token so the portal can render their card.
-- Anonymous visitors never read this table; they call get_public_card().
create policy "student reads own qr token"
  on public.qr_tokens for select to authenticated
  using (student_id = (select app.current_student_id()));

create policy "authority manages admit rules"
  on public.admit_card_rules for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "admit rules readable by authenticated"
  on public.admit_card_rules for select to authenticated using (true);

-- Overrides require high-privilege authority, not ordinary office staff.
create policy "admin manages overrides"
  on public.admit_card_overrides for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy "authority reads overrides"
  on public.admit_card_overrides for select to authenticated
  using ((select app.is_authority()));

create policy "authority manages generated documents"
  on public.generated_documents for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "student reads own documents"
  on public.generated_documents for select to authenticated
  using (student_id = (select app.current_student_id()));

-- ===========================================================================
-- Library — browsable by teachers and students once published
-- ===========================================================================
create policy "authority manages library"
  on public.library_books for all to authenticated
  using ((select app.is_authority())) with check ((select app.is_authority()));

create policy "published books readable"
  on public.library_books for select to authenticated
  using (is_published);

-- ===========================================================================
-- Notifications, OTP, auth attempts and audit
-- ---------------------------------------------------------------------------
-- These are written exclusively by server code holding the service role.
-- otp_challenges and auth_attempts have NO policy for authenticated users at
-- all: a signed-in user has no business reading the OTP table, not even their
-- own row, because the hash and attempt counter are the rate-limit state.
-- ===========================================================================
create policy "authority reads notification jobs"
  on public.notification_jobs for select to authenticated
  using ((select app.is_authority()));

create policy "authority reads delivery logs"
  on public.sms_delivery_logs for select to authenticated
  using ((select app.is_authority()));

-- Audit is append-only from the application's point of view: there is no
-- UPDATE or DELETE policy, and inserts come from the trigger, which runs as
-- the function owner rather than as the caller.
create policy "authority reads audit log"
  on public.audit_logs for select to authenticated
  using ((select app.is_authority()));

-- ===========================================================================
-- Deliberately policy-free (service role only, deny-all for everyone else):
--   otp_challenges   — OTP hashes and attempt counters
--   auth_attempts    — rate-limiting ledger
-- Both have RLS enabled above, so these denials are active, not implied.
-- ===========================================================================
