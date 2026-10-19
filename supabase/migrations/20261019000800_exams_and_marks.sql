-- ===========================================================================
-- 0008  Term exams, teacher mark entry, extra class tests, published results
-- ---------------------------------------------------------------------------
-- Authority-run term exams and teacher-run extra class tests are separate
-- tables on purpose. They have different owners, different permissions and
-- different notification rules, and collapsing them into one table would make
-- every RLS policy on marks conditional on a `kind` column.
--
-- Draft marks stay private until the authority publishes. Publication writes
-- an immutable snapshot so a later mark correction cannot silently rewrite a
-- result sheet a parent has already received.
-- ===========================================================================

create table public.exams (
  id                  uuid primary key default gen_random_uuid(),
  academic_year_id    uuid not null references public.academic_years (id) on delete cascade,
  term_id             uuid not null references public.terms (id) on delete cascade,
  name                text not null,
  status              public.exam_status not null default 'draft',
  starts_on           date,
  ends_on             date,

  grading_scale_id    uuid references public.grading_scales (id) on delete set null,

  -- Exam routine publication is separate from result publication: students may
  -- see the schedule long before any marks exist.
  routine_published_at timestamptz,
  routine_published_by uuid references public.profiles (id) on delete set null,

  results_published_at timestamptz,
  results_published_by uuid references public.profiles (id) on delete set null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references public.profiles (id) on delete set null,

  constraint exams_date_order check (
    starts_on is null or ends_on is null or ends_on >= starts_on
  ),
  constraint exams_published_consistency check (
    status <> 'published' or results_published_at is not null
  ),
  unique (term_id, name)
);

create index exams_year_idx on public.exams (academic_year_id, status);

create trigger exams_touch_updated_at
  before update on public.exams
  for each row execute function app.touch_updated_at();

comment on column public.exams.routine_published_at is
  'Students see the exam schedule only once this is set. Independent of results.';

-- --------------------------------------------------------------------------
-- exam_subjects — one row per class per subject sat in an exam
-- --------------------------------------------------------------------------
create table public.exam_subjects (
  id          uuid primary key default gen_random_uuid(),
  exam_id     uuid not null references public.exams (id) on delete cascade,
  class_id    uuid not null references public.classes (id) on delete cascade,
  subject_id  uuid not null references public.subjects (id) on delete restrict,

  max_marks   numeric(6,2) not null check (max_marks > 0),
  pass_marks  numeric(6,2) check (pass_marks is null or pass_marks >= 0),

  exam_date   date,
  starts_at   time,
  ends_at     time,
  -- Printed on admit cards and seat tokens.
  room        text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint exam_subjects_pass_within_max check (
    pass_marks is null or pass_marks <= max_marks
  ),
  constraint exam_subjects_time_order check (
    starts_at is null or ends_at is null or ends_at > starts_at
  ),
  unique (exam_id, class_id, subject_id)
);

create index exam_subjects_exam_idx on public.exam_subjects (exam_id, class_id);

create trigger exam_subjects_touch_updated_at
  before update on public.exam_subjects
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------------------------------
-- marks — one row per student per exam subject
-- --------------------------------------------------------------------------
create table public.marks (
  id                uuid primary key default gen_random_uuid(),
  exam_subject_id   uuid not null references public.exam_subjects (id) on delete cascade,
  student_id        uuid not null references public.students (id) on delete cascade,

  -- NULL with is_absent = false means "not yet entered", which is different
  -- from a zero and different from an absence.
  marks_obtained    numeric(6,2) check (marks_obtained is null or marks_obtained >= 0),
  is_absent         boolean not null default false,

  entered_by        uuid references public.profiles (id) on delete set null,
  entered_at        timestamptz,
  updated_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),

  constraint marks_absent_has_no_score check (
    not is_absent or marks_obtained is null
  ),
  unique (exam_subject_id, student_id)
);

create index marks_student_idx on public.marks (student_id);

create trigger marks_touch_updated_at
  before update on public.marks
  for each row execute function app.touch_updated_at();

comment on column public.marks.marks_obtained is
  'NULL with is_absent false means not entered yet. Never treat as zero.';

-- A mark may not exceed the maximum configured for its exam subject.
create or replace function app.enforce_marks_within_max()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max numeric(6,2);
begin
  if new.marks_obtained is null then
    return new;
  end if;

  select max_marks into v_max
  from public.exam_subjects
  where id = new.exam_subject_id;

  if new.marks_obtained > v_max then
    raise exception 'marks_obtained (%) exceeds max_marks (%) for this exam subject',
      new.marks_obtained, v_max
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger marks_within_max
  before insert or update of marks_obtained on public.marks
  for each row execute function app.enforce_marks_within_max();

-- --------------------------------------------------------------------------
-- mark_submissions — which teacher has finished which subject for which section
-- --------------------------------------------------------------------------
-- Drives the authority's "who is still pending" view and the notification sent
-- when every required submission is in.
-- --------------------------------------------------------------------------
create table public.mark_submissions (
  id              uuid primary key default gen_random_uuid(),
  exam_subject_id uuid not null references public.exam_subjects (id) on delete cascade,
  section_id      uuid not null references public.sections (id) on delete cascade,
  teacher_id      uuid not null references public.teachers (id) on delete restrict,
  submitted_at    timestamptz not null default now(),
  submitted_by    uuid references public.profiles (id) on delete set null,
  -- Set when the authority reopens entry after a submission.
  reopened_at     timestamptz,
  reopened_by     uuid references public.profiles (id) on delete set null,
  reopen_reason   text,
  unique (exam_subject_id, section_id)
);

create index mark_submissions_teacher_idx
  on public.mark_submissions (teacher_id, submitted_at desc);

-- --------------------------------------------------------------------------
-- published_results — immutable snapshot taken at publication
-- --------------------------------------------------------------------------
create table public.published_results (
  id               uuid primary key default gen_random_uuid(),
  exam_id          uuid not null references public.exams (id) on delete cascade,
  student_id       uuid not null references public.students (id) on delete cascade,
  -- The enrollment the result belongs to, so a later promotion does not move
  -- an old result sheet into the new class.
  enrollment_id    uuid not null references public.student_enrollments (id) on delete restrict,

  total_obtained   numeric(8,2) not null,
  total_max        numeric(8,2) not null check (total_max > 0),
  percentage       numeric(5,2) not null,
  gpa              numeric(4,2),
  grade            text,
  is_pass          boolean not null,
  -- Attendance over the term's configured window, as printed on the sheet.
  attendance_pct   numeric(5,2),
  position_in_class integer,

  -- Full subject-wise breakdown exactly as published, so the sheet can be
  -- reprinted identically even if marks are later corrected.
  snapshot         jsonb not null,

  published_at     timestamptz not null default now(),
  published_by     uuid references public.profiles (id) on delete set null,

  unique (exam_id, student_id)
);

create index published_results_student_idx
  on public.published_results (student_id, published_at desc);

comment on column public.published_results.snapshot is
  'Frozen subject-wise figures as published. A later mark edit does not alter this.';

-- --------------------------------------------------------------------------
-- class_tests — teacher-created extra tests
-- --------------------------------------------------------------------------
create table public.class_tests (
  id               uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years (id) on delete cascade,
  term_id          uuid references public.terms (id) on delete set null,
  class_id         uuid not null references public.classes (id) on delete restrict,
  section_id       uuid not null references public.sections (id) on delete cascade,
  subject_id       uuid not null references public.subjects (id) on delete restrict,
  teacher_id       uuid not null references public.teachers (id) on delete restrict,

  name             text not null,
  max_marks        numeric(6,2) not null check (max_marks > 0),
  test_date        date not null,

  status           public.class_test_status not null default 'draft',

  -- Set the first time "Send Result to Parents" succeeds. Checked before any
  -- further send so a double click cannot produce two rounds of SMS.
  result_sent_at   timestamptz,
  result_sent_by   uuid references public.profiles (id) on delete set null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint class_tests_sent_consistency check (
    status <> 'sent' or result_sent_at is not null
  )
);

create index class_tests_section_idx
  on public.class_tests (section_id, test_date desc);

create index class_tests_teacher_idx
  on public.class_tests (teacher_id, test_date desc);

create trigger class_tests_touch_updated_at
  before update on public.class_tests
  for each row execute function app.touch_updated_at();

comment on column public.class_tests.result_sent_at is
  'Guard against duplicate result SMS. Checked before dispatch, set within the same transaction.';

create table public.class_test_marks (
  id             uuid primary key default gen_random_uuid(),
  class_test_id  uuid not null references public.class_tests (id) on delete cascade,
  student_id     uuid not null references public.students (id) on delete cascade,
  marks_obtained numeric(6,2) check (marks_obtained is null or marks_obtained >= 0),
  is_absent      boolean not null default false,
  entered_by     uuid references public.profiles (id) on delete set null,
  entered_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint class_test_marks_absent_has_no_score check (
    not is_absent or marks_obtained is null
  ),
  unique (class_test_id, student_id)
);

create index class_test_marks_student_idx on public.class_test_marks (student_id);

create trigger class_test_marks_touch_updated_at
  before update on public.class_test_marks
  for each row execute function app.touch_updated_at();

create or replace function app.enforce_class_test_marks_within_max()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max numeric(6,2);
begin
  if new.marks_obtained is null then
    return new;
  end if;

  select max_marks into v_max
  from public.class_tests
  where id = new.class_test_id;

  if new.marks_obtained > v_max then
    raise exception 'marks_obtained (%) exceeds max_marks (%) for this class test',
      new.marks_obtained, v_max
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger class_test_marks_within_max
  before insert or update of marks_obtained on public.class_test_marks
  for each row execute function app.enforce_class_test_marks_within_max();
